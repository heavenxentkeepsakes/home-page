import { google } from "googleapis";
import { Readable } from "stream";

// Use service account instead of OAuth2 refresh token
function getDriveAuth() {
  return new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
  });
}

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

    // --- 2. Drive client using Service Account ---
    const auth = getDriveAuth();
    const drive = google.drive({ version: "v3", auth });

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

    // --- 4. Make file publicly accessible ---
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