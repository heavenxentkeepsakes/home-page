import { uploadToDrive } from "./drive.js";
import { Resend } from "resend";
import { google } from "googleapis";

const resend = new Resend(process.env.RESEND_API_KEY);

// ✅ Reuse same OAuth2 client as drive.js
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "https://developers.google.com/oauthplayground"
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

async function logToSheets({ date, name, email, type, amount, driveUrl, ref }) {
  try {
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: "Sheet1!A:G",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[date, name, email, type, amount, driveUrl, ref]],
      },
    });

    console.log("✅ Logged to Google Sheets");
  } catch (err) {
    console.error("⚠️ Google Sheets logging failed (non-fatal):", err.message);
  }
}

export default async function handler(req, res) {
  console.log("🔥 Webhook hit");

  // ✅ Always respond immediately to PayMongo
  res.status(200).json({ received: true });

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

      // ✅ Pull everything from PayMongo billing info, metadata as fallback
      const email = paymentData.billing?.email || metadata.email;
      const name = paymentData.billing?.name || metadata.name || "Customer";
      const type = metadata.type || "PDF";
      const driveFileId = metadata.driveFileId;
      const driveFileUrl = metadata.driveFileUrl;
      const amount = type === "PDF" ? "₱99" : "₱199";
      const ref = `${type}-${Date.now()}`;
      const date = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" });

      console.log("✅ Payment confirmed for:", email);
      console.log("👤 Customer name:", name);

      // --- Build Drive URL ---
      let finalFileUrl = null;

      if (driveFileUrl) {
        finalFileUrl = driveFileUrl;
        console.log("✅ Using Drive URL from metadata");
      } else if (driveFileId) {
        finalFileUrl = `https://drive.google.com/file/d/${driveFileId}/view`;
        console.log("✅ Constructed URL from Drive file ID");
      } else {
        console.warn("⚠️ No Drive file data found in metadata");
      }

      // --- Log to Google Sheets ---
      await logToSheets({
        date,
        name,
        email: email || "N/A",
        type,
        amount,
        driveUrl: finalFileUrl || "N/A",
        ref,
      });

      if (!email) {
        console.warn("⚠️ No email found, skipping emails");
        return;
      }

      // --- Email content ---
      let customerSubject = "";
      let customerText = "";

      if (type === "PDF") {
        customerSubject = "Your Wedding Tag PDF is Ready 💖";
        customerText = finalFileUrl
          ? `Hi ${name},\n\nYour payment is confirmed and your wedding tag PDF is ready!\n\nDownload here:\n${finalFileUrl}\n\nThank you for your purchase 💖`
          : `Hi ${name},\n\nYour payment is confirmed! Your file is still processing and we will send your download link shortly.\n\nThank you 💖`;
      } else {
        customerSubject = "Your Print Order is Confirmed 💖";
        customerText = `Hi ${name},\n\nYour payment is confirmed and your print order (${ref}) has been received.\n\nWe will process it within 5–7 days.\n\nThank you 💖`;
      }

      // --- Send customer email + owner notification in parallel ---
      await Promise.all([
        // ✅ Email to customer
        resend.emails.send({
          from: "no-reply@heavenxentph.com",
          to: email,
          subject: customerSubject,
          text: customerText,
        }),

        // ✅ Notification email to you
        resend.emails.send({
          from: "no-reply@heavenxentph.com",
          to: "heavenxentkeepsakes@gmail.com",
          subject: `🛍️ New ${type} Order — ${name}`,
          text: `New order received!\n\nReference: ${ref}\nDate: ${date}\nName: ${name}\nEmail: ${email}\nType: ${type}\nAmount: ${amount}\nDrive URL: ${finalFileUrl || "N/A"}\n\nCheck your Google Sheet for full order history.`,
        }),
      ]);

      console.log("✅ Customer email sent to:", email);
      console.log("✅ Notification email sent to: heavenxentkeepsakes@gmail.com");

    } catch (err) {
      console.error("❌ Background webhook error:", err);
    }
  })();
}