import { google } from "googleapis";
import { Readable } from "stream";

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "https://developers.google.com/oauthplayground"
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

export async function uploadToDrive({ base64PDF, fileName, folderId }) {
  try {
    if (!base64PDF) {
      throw new Error("Missing base64 PDF data");
    }
    if (!folderId) {
      throw new Error("Missing Google Drive folder ID");
    }

    console.log("📁 Uploading to folder:", folderId);

    // --- 1. Convert base64 → Buffer → Stream ---
    const buffer = Buffer.from(base64PDF, "base64");
    const stream = Readable.from(buffer);

    // --- 2. Drive client using OAuth2 ---
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    // --- 3. Upload file ---
    const response = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
      },
      media: {
        mimeType: "application/pdf",
        body: stream,
      },
      fields: "id",
    });

    const fileId = response.data.id;
    if (!fileId) throw new Error("Upload failed: No file ID returned");

    // --- 4. Make file public ---
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    // --- 5. Generate URL ---
    const fileUrl = `https://drive.google.com/file/d/${fileId}/view`;
    console.log("✅ Uploaded to Drive:", fileUrl);

    return { fileId, fileUrl };

  } catch (error) {
    console.error("❌ Drive upload error:", error.message || error);
    throw error;
  }
}