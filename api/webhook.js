import { uploadToDrive } from "./drive.js";
import nodemailer from "nodemailer";

export default async function handler(req, res) {
  console.log("🔥 Webhook hit");

  // ✅ ALWAYS respond immediately to PayMongo
  res.status(200).json({ received: true });

  // ✅ Process everything in background
  (async () => {
    try {
      // --- Ignore non-POST (but don't fail) ---
      if (req.method !== "POST") {
        console.log("Ignored non-POST request");
        return;
      }

      const event = req.body;

      const eventType = event?.data?.attributes?.type;
      if (eventType !== "payment.paid") {
        console.log("Ignored event:", eventType);
        return;
      }

      const paymentData = event.data.attributes.data.attributes;
      const metadata = paymentData.metadata || {};

      const email = metadata.email;
      const name = metadata.name || "Customer";
      const type = metadata.type || "PDF";

      console.log("✅ Payment confirmed for:", email);

      // --- File Handling ---
      const pdfBase64 = metadata.pdf;
      const driveFileId = metadata.driveFileId;
      const driveFileUrl = metadata.driveFileUrl;

      let finalFileUrl = null;

      if (driveFileUrl) {
        finalFileUrl = driveFileUrl;
        console.log("Using existing Drive URL");
      } else if (driveFileId) {
        finalFileUrl = `https://drive.google.com/file/d/${driveFileId}/view`;
        console.log("Constructed URL from file ID");
      } else if (pdfBase64) {
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
        console.log("Uploaded PDF to Drive");
      } else {
        console.warn("No file data found in metadata");
      }

      // --- Email Setup ---
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

        message = finalFileUrl
          ? `Hi ${name},

Your wedding tag PDF is ready!

Download here:
${finalFileUrl}

Thank you for your purchase 💖`
          : `Hi ${name},

We have confirmed your payment, but your file is still processing.

We will send your download link shortly.

Thank you 💖`;
      } else {
        const ref = `PRINT-${Date.now()}`;

        subject = "Your Print Order is Received";
        message = `Hi ${name},

Your print order (${ref}) has been received.

We will process it within 5–7 days.

Thank you 💖`;
      }

      // --- Send Email ---
      if (email) {
        await transporter.sendMail({
          from: "no-reply@heavenxentph.com",
          to: email,
          subject,
          text: message,
        });

        console.log("✅ Email sent to:", email);
      } else {
        console.warn("⚠️ No email found in metadata");
      }

    } catch (err) {
      // ❗ NEVER throw / NEVER respond with error
      console.error("❌ Background webhook error:", err);
    }
  })();
}