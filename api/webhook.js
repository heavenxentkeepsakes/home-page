import { uploadToDrive } from "./drive.js";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  console.log("🔥 Webhook hit");

  // ✅ Always respond immediately to PayMongo
  res.status(200).json({ received: true });

  // ✅ Process everything in background
  (async () => {
    try {
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
      const address = metadata.address || "";

      console.log("✅ Payment confirmed for:", email);

      // --- File Handling ---
      // Since upload is now done in background during checkout,
      // we try to use whatever is available in metadata
      const driveFileId = metadata.driveFileId;
      const driveFileUrl = metadata.driveFileUrl;
      const pdfBase64 = metadata.pdf;

      let finalFileUrl = null;

      if (driveFileUrl) {
        finalFileUrl = driveFileUrl;
        console.log("✅ Using existing Drive URL from metadata");
      } else if (driveFileId) {
        finalFileUrl = `https://drive.google.com/file/d/${driveFileId}/view`;
        console.log("✅ Constructed URL from Drive file ID");
      } else if (pdfBase64) {
        // Fallback: upload now if background upload during checkout failed
        console.log("⚠️ No Drive URL in metadata, uploading now as fallback...");
        const folderId =
          type === "PDF"
            ? process.env.GOOGLE_DRIVE_FOLDER_ID
            : process.env.GOOGLE_DRIVE_FOLDER_ID_PRINT || process.env.GOOGLE_DRIVE_FOLDER_ID;

        const fileName = `${type}-ORD-${Date.now()}.pdf`;
        const result = await uploadToDrive({ base64PDF: pdfBase64, fileName, folderId });
        finalFileUrl = result.fileUrl;
        console.log("✅ Fallback upload done:", finalFileUrl);
      } else {
        console.warn("⚠️ No file data found in metadata");
      }

      // --- Send post-payment email ---
      if (!email) {
        console.warn("⚠️ No email found in metadata, skipping email");
        return;
      }

      let subject = "";
      let text = "";

      if (type === "PDF") {
        subject = "Your Wedding Tag PDF is Ready 💖";
        text = finalFileUrl
          ? `Hi ${name},\n\nYour payment is confirmed and your wedding tag PDF is ready!\n\nDownload here:\n${finalFileUrl}\n\nThank you for your purchase 💖`
          : `Hi ${name},\n\nYour payment is confirmed! Your file is still processing and we will send your download link shortly.\n\nThank you 💖`;
      } else {
        const ref = `PRINT-${Date.now()}`;
        subject = "Your Print Order is Confirmed 💖";
        text = `Hi ${name},\n\nYour payment is confirmed and your print order (${ref}) has been received.\n\nWe will process it within 5–7 days.\n\nThank you 💖`;
      }

      await resend.emails.send({
        from: "no-reply@heavenxentph.com",
        to: email,
        subject,
        text,
      });

      console.log("✅ Post-payment email sent to:", email);

    } catch (err) {
      console.error("❌ Background webhook error:", err);
    }
  })();
}