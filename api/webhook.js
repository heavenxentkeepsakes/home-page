import { Resend } from "resend";
import { google } from "googleapis";
import crypto from "crypto";

const resend = new Resend(process.env.RESEND_API_KEY);

// Google Auth for Sheets
function getGoogleAuth() {
  return new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
  });
}

// Verify PayMongo webhook signature
function verifyPayMongoSignature(req, rawBody) {
  const signatureHeader = req.headers['paymongo-signature'];
  const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET;

  if (!signatureHeader || !webhookSecret) {
    console.error("❌ Missing signature or webhook secret");
    return false;
  }

  try {
    const parts = signatureHeader.split(',');
    let timestamp = null;
    let signature = null;

    for (const part of parts) {
      if (part.startsWith('t=')) {
        timestamp = part.substring(2);
      } else if (part.startsWith('te=')) {
        signature = part.substring(3);
      }
    }

    if (!timestamp || !signature) {
      console.error("❌ Invalid signature header format");
      return false;
    }

    const signedPayload = `${timestamp}.${rawBody}`;
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(signedPayload)
      .digest('hex');

    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (signatureBuffer.length !== expectedBuffer.length) {
      console.error("❌ Signature length mismatch");
      return false;
    }

    const isValid = crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

    const now = Math.floor(Date.now() / 1000);
    const timestampNum = parseInt(timestamp);
    const timeDiff = Math.abs(now - timestampNum);

    if (timeDiff > 300) {
      console.error(`❌ Webhook timestamp too old: ${timeDiff} seconds difference`);
      return false;
    }

    if (isValid) {
      console.log("✅ Webhook signature verified");
    } else {
      console.error("❌ Invalid webhook signature");
    }

    return isValid;
  } catch (err) {
    console.error("❌ Signature verification error:", err.message);
    return false;
  }
}

// Check if payment already processed (prevents duplicates)
async function isPaymentAlreadyProcessed(paymentId) {
  try {
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: "Sheet1!H:H",
    });

    const rows = response.data.values || [];
    return rows.some(row => row[0] === paymentId);
  } catch (err) {
    console.error("⚠️ Error checking for duplicate payment:", err.message);
    return false;
  }
}

async function logToSheets({ date, name, email, type, amount, driveUrl, ref, paymentId }) {
  try {
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });

    console.log("📊 Using Spreadsheet ID:", process.env.GOOGLE_SHEETS_ID);

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
      range: "Sheet1!A:H",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[date, name, email, type, amount, driveUrl, ref, paymentId]],
      },
    });

    console.log("✅ Logged to Google Sheets");
    return true;
  } catch (err) {
    console.error("⚠️ Google Sheets logging failed:", err.message);
    console.error("⚠️ Error code:", err.code);
    console.error("⚠️ Error status:", err.status);
    return false;
  }
}

export default async function handler(req, res) {
  console.log("🔥 Webhook hit");

  const rawBody = JSON.stringify(req.body);

  const isValidSignature = verifyPayMongoSignature(req, rawBody);
  if (!isValidSignature && process.env.NODE_ENV === "production") {
    console.error("❌ Invalid webhook signature - rejecting request");
    return res.status(401).json({ error: "Invalid signature" });
  }

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

    const paymentId = event.data.id;
    console.log("💰 Processing payment ID:", paymentId);

    const alreadyProcessed = await isPaymentAlreadyProcessed(paymentId);
    if (alreadyProcessed) {
      console.log(`⚠️ Payment ${paymentId} already processed, skipping duplicate webhook`);
      return res.status(200).json({ received: true });
    }

    const paymentData = event.data.attributes.data.attributes;
    const metadata = paymentData.metadata || {};

    const email = paymentData.billing?.email || metadata.email;
    const name = paymentData.billing?.name || metadata.name || "Customer";
    const type = metadata.type || "PDF";
    const driveFileUrl = metadata.driveFileUrl;
    const driveFileId = metadata.driveFileId;
    const amount = type === "PDF" ? "₱149" : "₱199";
    const ref = metadata.ref || `${type}-${Date.now()}`;
    const date = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" });

    console.log("✅ Payment confirmed for:", email);
    console.log("👤 Customer name:", name);
    console.log("📦 Order type:", type);
    console.log("🔑 Reference:", ref);

    // Build Drive URL
    let finalFileUrl = driveFileUrl;
    if (!finalFileUrl && driveFileId) {
      finalFileUrl = `https://drive.google.com/file/d/${driveFileId}/view`;
    }

    if (finalFileUrl) {
      console.log("✅ Drive URL ready:", finalFileUrl);
    } else {
      console.warn("⚠️ No Drive URL found in metadata");
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
      paymentId,
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
        resend.emails.send({
          from: "HeavenXent Keepsakes <no-reply@heavenxentph.com>",
          to: email,
          subject: customerSubject,
          text: customerText,
          html: customerHtml,
        }),
        resend.emails.send({
          from: "HeavenXent Keepsakes <no-reply@heavenxentph.com>",
          to: "heavenxentkeepsakes@gmail.com",
          subject: `🛍️ New ${type} Order — ${name}`,
          text: `New order received!\n\nPayment ID: ${paymentId}\nReference: ${ref}\nDate: ${date}\nName: ${name}\nEmail: ${email}\nType: ${type}\nAmount: ${amount}\nDrive URL: ${finalFileUrl || "N/A"}\n\nCheck your Google Sheet for full order history.`,
          html: `
            <div style="font-family: Arial, sans-serif;">
              <h2>🛍️ New Order Received</h2>
              <table style="border-collapse: collapse;">
                <tr><td style="padding: 8px;"><strong>Payment ID:</strong></td><td>${paymentId}</td></tr>
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
    console.error("❌ Webhook error:", err);
  }

  return res.status(200).json({ received: true });
}