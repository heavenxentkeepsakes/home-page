import { google } from "googleapis";

export async function uploadToDrive(buffer, filename) {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/drive"]
  );

  const drive = google.drive({ version: "v3", auth });

  const fileMetadata = {
    name: `${filename}.pdf`,
    parents: [process.env.GOOGLE_DRIVE_FOLDER_ID]
  };

  const media = {
    mimeType: "application/pdf",
    body: buffer
  };

  const file = await drive.files.create({
    resource: fileMetadata,
    media,
    fields: "id"
  });

  const fileId = file.data.id;

  await drive.permissions.create({
    fileId,
    requestBody: {
      role: "reader",
      type: "anyone"
    }
  });

  return `https://drive.google.com/file/d/${fileId}/view`;
}