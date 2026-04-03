import { google } from "googleapis";
import { Readable } from "stream";

export async function uploadToDrive({ base64PDF, fileName, folderId }) {
  try {
    if (!base64PDF) {
      throw new Error("Missing base64 PDF data");
    }

    if (!folderId) {
      throw new Error("Missing Google Drive folder ID");
    }

    console.log("📁 Uploading to folder:", folderId);

    // --- 1. Convert base64 → Buffer ---
    const buffer = Buffer.from(base64PDF, "base64");

    // --- 2. Convert Buffer → Stream ---
    const stream = Readable.from(buffer);

    // --- 3. Google Auth (FIXED SCOPE) ---
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/drive"], // ✅ FULL ACCESS
    });

    const drive = google.drive({ version: "v3", auth });

    // --- 4. Upload file ---
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

    if (!fileId) {
      throw new Error("Upload failed: No file ID returned");
    }

    // --- 5. Make file public ---
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    // --- 6. Generate URL ---
    const fileUrl = `https://drive.google.com/file/d/${fileId}/view`;

    console.log("✅ Uploaded to Drive:", fileUrl);

    return {
      fileId,
      fileUrl,
    };

  } catch (error) {
    console.error("❌ Drive upload error:", error.message || error);

    // ❗ Important: rethrow so caller can handle it (but webhook won't break)
    throw error;
  }
}