import { uploadToDrive } from "./drive.js";
import nodemailer from "nodemailer";

export default async function handler(req, res) {
  try {
    console.log("🔥 Webhook hit");

    // --- Only accept POST ---
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const event = req.body;

    // --- Optional: Verify PayMongo webhook signature ---
    // (skip for now if not configured)
    // const signature = req.headers["paymongo-signature"];

    // --- Check event type ---
    if (event.data?.attributes?.type !== "payment.paid") {
      console.log("Ignored event:", event.data?.attributes?.type);
      return res.status(200).json({ received: true });
    }

    const paymentData = event.data.attributes.data.attributes;

    const metadata = paymentData.metadata || {};
    const email = metadata.email;
    const name = metadata.name;
    const type = metadata.type || "PDF";

    console.log("✅ Payment confirmed for:", email);

    // --- IMPORTANT ---
    // We allow two workflows:
    // 1) checkout already uploaded PDF and saved driveFileId/driveFileUrl in metadata
    // 2) webhook receives base64 PDF and uploads it now (fallback)

    const pdfBase64 = metadata.pdf;
    const driveFileId = metadata.driveFileId;
    const driveFileUrl = metadata.driveFileUrl;

    let finalFileUrl = null;

    if (driveFileUrl) {
      finalFileUrl = driveFileUrl;
      console.log("✅ Using existing Drive file URL from metadata:", finalFileUrl);
    } else if (driveFileId) {
      finalFileUrl = `https://drive.google.com/file/d/${driveFileId}/view`;
      console.log("✅ Constructed Drive file URL from metadata file ID:", finalFileUrl);
    } else if (pdfBase64) {
      //--- Upload to Google Drive fallback (if PDF is included directly) ---
      const fileName = `${type}-ORD-${Date.now()}.pdf`;
      const folderId =
        type === "PDF"
          ? process.env.GOOGLE_DRIVE_FOLDER_ID
          : process.env.GOOGLE_DRIVE_FOLDER_ID_PRINT;

      const result = await uploadToDrive({
        base64PDF: pdfBase64,
        fileName,
        folderId,
      });
      finalFileUrl = result.fileUrl;
      console.log("✅ Uploaded to Drive in webhook:", finalFileUrl);
    } else {
      console.warn("⚠️ No PDF or Drive file metadata available; skipping upload.");
    }

    // --- Send Email ---
    const transporter = nodemailer.createTransport({
      host: "smtp.resend.email",
      port: 587,
      auth: {
        user: process.env.RESEND_API_KEY,
        pass: process.env.RESEND_API_KEY,
      },
    });

    let subject = "";
    let message = "";

    if (type === "PDF") {
      subject = "Your Wedding Tag PDF is Ready";
      if (finalFileUrl) {
        message = `
Hi ${name},

Your wedding tag PDF is ready!

Download here:
${finalFileUrl}

Thank you for your purchase 💖
        `;
      } else {
        message = `
Hi ${name},

We have confirmed your payment, but the PDF URL is not available yet.
Our team will send your download link shortly.

Thank you for your purchase 💖
        `;
      }
    } else {
      const ref = `PRINT-${Date.now()}`;
      subject = "Your Print Order is Received";
      message = `
Hi ${name},

Your print order (${ref}) has been received.

We will process it within 5–7 days.

Thank you 💖
      `;
    }

    await transporter.sendMail({
      from: "no-reply@heavenxentph.com",
      to: email,
      subject,
      text: message,
    });

    console.log("✅ Email sent to:", email);

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("❌ Webhook error:", err);
    return res.status(500).json({ error: err.message });
  }
}