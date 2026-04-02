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
    // You must already have stored the PDF (base64) somewhere earlier
    // For now we assume you passed it via metadata or temporary storage

    const pdfBase64 = metadata.pdf; // ⚠️ must exist

    if (!pdfBase64) {
      console.error("❌ No PDF found in metadata");
      return res.status(400).json({ error: "Missing PDF" });
    }

    // --- Upload to Google Drive ---
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

    console.log("✅ Uploaded to Drive:", result.fileUrl);

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
      message = `
Hi ${name},

Your wedding tag PDF is ready!

Download here:
${result.fileUrl}

Thank you for your purchase 💖
      `;
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