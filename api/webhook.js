import { Resend } from "resend";
import { google } from "googleapis";

const resend = new Resend(process.env.RESEND_API_KEY);

// ✅ SWITCH TO SERVICE ACCOUNT (no more expired tokens!)
function getGoogleAuth() {
  return new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
  });
}

async function logToSheets({ date, name, email, type, amount, driveUrl, ref }) {
  try {
    // ✅ Use Service Account instead of oauth2Client
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });

    console.log("📊 Using Spreadsheet ID:", process.env.GOOGLE_SHEETS_ID);

    // Optional: Verify access to spreadsheet first
    try {
      await sheets.spreadsheets.get({
        spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      });
      console.log("✅ Spreadsheet access verified");
    } catch (err) {
      console.error("❌ Cannot access spreadsheet. Make sure you've shared it with:", process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
      throw err;
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: "Sheet1!A:G",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[date, name, email, type, amount, driveUrl, ref]],
      },
    });

    console.log("✅ Logged to Google Sheets");
    return true;
  } catch (err) {
    console.error("⚠️ Google Sheets logging failed:", err.message);
    console.error("⚠️ Error code:", err.code);
    console.error("⚠️ Error status:", err.status);
    console.error("⚠️ Spreadsheet ID used:", process.env.GOOGLE_SHEETS_ID);
    return false;
  }
}

export default async function handler(req, res) {
  console.log("🔥 Webhook hit");

  if (req.method !== "POST") {
    return res.status(200).json({ received: true });
  }

  try {
    const event = req.body;
    const eventType = event?.data?.attributes?.type;

    if (eventType !== "payment.paid") {
      console.log("Ignored event:", eventType);
      return res.status(200).json({ received: true });
    }

    const paymentData = event.data.attributes.data.attributes;
    const metadata = paymentData.metadata || {};

    // Pull from PayMongo billing first, metadata as fallback
    const email = paymentData.billing?.email || metadata.email;
    const name = paymentData.billing?.name || metadata.name || "Customer";
    const type = metadata.type || "PDF";
    const driveFileId = metadata.driveFileId;
    const driveFileUrl = metadata.driveFileUrl;
    const amount = type === "PDF" ? "₱149" : "₱199";
    const ref = metadata.ref || `${type}-${Date.now()}`;
    const date = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" });

    console.log("✅ Payment confirmed for:", email);
    console.log("👤 Customer name:", name);
    console.log("📦 Order type:", type);
    console.log("🔑 Reference:", ref);

    // Build Drive URL
    let finalFileUrl = null;

    if (driveFileUrl) {
      finalFileUrl = driveFileUrl;
      console.log("✅ Using Drive URL from metadata");
    } else if (driveFileId) {
      finalFileUrl = `https://drive.google.com/file/d/${driveFileId}/view`;
      console.log("✅ Constructed URL from Drive file ID:", driveFileId);
    } else {
      console.warn("⚠️ No Drive file data found in metadata");
    }

    // Log to Google Sheets
    await logToSheets({
      date,
      name,
      email: email || "N/A",
      type,
      amount,
      driveUrl: finalFileUrl || "N/A",
      ref,
    });

    // Send emails
    if (email) {
      let customerSubject = "";
      let customerText = "";
      let customerHtml = "";

      if (type === "PDF") {
        customerSubject = "Your Wedding Tag PDF is Ready 💖";
        customerText = finalFileUrl
          ? `Hi ${name},\n\nYour payment is confirmed and your wedding tag PDF is ready!\n\nDownload here:\n${finalFileUrl}\n\nThank you for your purchase 💖`
          : `Hi ${name},\n\nYour payment is confirmed! Your file is still processing and we will send your download link shortly.\n\nThank you 💖`;
        
        customerHtml = finalFileUrl
          ? `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #c4956a;">✨ Your Wedding Tag PDF is Ready! ✨</h2>
              <p>Hi ${name},</p>
              <p>Your payment is confirmed and your wedding tag PDF is ready!</p>
              <p style="margin: 30px 0;">
                <a href="${finalFileUrl}" style="background-color: #c4956a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">Download Your PDF</a>
              </p>
              <p>Thank you for your purchase 💖</p>
              <p style="margin-top: 30px; color: #666; font-size: 12px;">HeavenXent Keepsakes</p>
            </div>
          `
          : `<div>Your file is processing...</div>`;
      } else {
        customerSubject = "Your Print Order is Confirmed 💖";
        customerText = `Hi ${name},\n\nYour payment is confirmed and your print order (${ref}) has been received.\n\nWe will process it within 5–7 days.\n\nThank you 💖`;
        customerHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #c4956a;">✨ Print Order Confirmed! ✨</h2>
            <p>Hi ${name},</p>
            <p>Your payment is confirmed and your print order <strong>${ref}</strong> has been received.</p>
            <p>We will process it within 5–7 business days.</p>
            <p>Thank you for your purchase 💖</p>
            <p style="margin-top: 30px; color: #666; font-size: 12px;">HeavenXent Keepsakes</p>
          </div>
        `;
      }

      await Promise.all([
        // Customer email
        resend.emails.send({
          from: "HeavenXent Keepsakes <no-reply@heavenxentph.com>",
          to: email,
          subject: customerSubject,
          text: customerText,
          html: customerHtml,
        }),

        // Owner notification
        resend.emails.send({
          from: "HeavenXent Keepsakes <no-reply@heavenxentph.com>",
          to: "heavenxentkeepsakes@gmail.com",
          subject: `🛍️ New ${type} Order — ${name}`,
          text: `New order received!\n\nReference: ${ref}\nDate: ${date}\nName: ${name}\nEmail: ${email}\nType: ${type}\nAmount: ${amount}\nDrive URL: ${finalFileUrl || "N/A"}\n\nCheck your Google Sheet for full order history.`,
          html: `
            <div style="font-family: Arial, sans-serif;">
              <h2>🛍️ New Order Received</h2>
              <table style="border-collapse: collapse;">
                <tr><td style="padding: 8px;"><strong>Reference:</strong></td><td>${ref}</td></tr>
                <tr><td style="padding: 8px;"><strong>Date:</strong></td><td>${date}</td></tr>
                <tr><td style="padding: 8px;"><strong>Name:</strong></td><td>${name}</td></tr>
                <tr><td style="padding: 8px;"><strong>Email:</strong></td><td>${email}</td></tr>
                <tr><td style="padding: 8px;"><strong>Type:</strong></td><td>${type}</td></tr>
                <tr><td style="padding: 8px;"><strong>Amount:</strong></td><td>${amount}</td></tr>
                <tr><td style="padding: 8px;"><strong>Drive URL:</strong></td><td><a href="${finalFileUrl}">${finalFileUrl || "N/A"}</a></td></tr>
              </table>
            </div>
          `,
        }),
      ]);

      console.log("✅ Customer email sent to:", email);
      console.log("✅ Notification sent to: heavenxentkeepsakes@gmail.com");
    } else {
      console.warn("⚠️ No email found, skipping emails");
    }

  } catch (err) {
    console.error("❌ Webhook error: ", err);
  }

  // Always respond 200 to PayMongo
  return res.status(200).json({ received: true });
}