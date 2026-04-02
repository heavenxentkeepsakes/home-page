import { google } from "googleapis";
import { Readable } from "stream";

export async function uploadToDrive({ base64PDF, fileName, folderId }) {
  try {
    // --- 1. Convert base64 → Buffer ---
    const buffer = Buffer.from(base64PDF, "base64");

    // --- 2. Convert Buffer → Stream (FIX for your error) ---
    const stream = Readable.from(buffer);

    // --- 3. Google Auth ---
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });

    const drive = google.drive({ version: "v3", auth });

    // --- 4. Upload to Drive ---
    const response = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
      },
      media: {
        mimeType: "application/pdf",
        body: stream, // ✅ REQUIRED (not buffer)
      },
    });

    const fileId = response.data.id;

    // --- 5. Make file publicly viewable (optional but useful) ---
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    // --- 6. Generate public link ---
    const fileUrl = `https://drive.google.com/file/d/${fileId}/view`;

    console.log("✅ Uploaded to Drive:", fileUrl);

    return {
      fileId,
      fileUrl,
    };

  } catch (error) {
    console.error("❌ Drive upload error:", error);
    throw error;
  }
}