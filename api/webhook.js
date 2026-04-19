import { Resend } from "resend";
import { google } from "googleapis";
import crypto from "crypto";

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

// ✅ NEW: Get Drive auth for moving files
function getDriveAuth() {
  return new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive'],
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
  });
}

// ✅ NEW: Verify PayMongo webhook signature
// ✅ FIXED: Verify PayMongo webhook signature (matches actual PayMongo format)
function verifyPayMongoSignature(req, rawBody) {
  const signatureHeader = req.headers['paymongo-signature'];
  const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET;

  if (!signatureHeader || !webhookSecret) {
    console.error("❌ Missing signature or webhook secret");
    return false;
  }

  try {
    // Parse the header: "t=123456,te=abcdef,li="
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
      console.log("Parsed - timestamp:", timestamp, "signature exists:", !!signature);
      return false;
    }

    console.log("✅ Parsed signature - timestamp:", timestamp);
    console.log("✅ Parsed signature - first 20 chars:", signature.substring(0, 20) + "...");

    // Create the signed payload: timestamp + "." + raw body
    const signedPayload = `${timestamp}.${rawBody}`;

    // Compute expected signature
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(signedPayload)
      .digest('hex');

    console.log("Expected signature - first 20 chars:", expectedSignature.substring(0, 20) + "...");

    // Compare signatures
    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    // Check lengths match
    if (signatureBuffer.length !== expectedBuffer.length) {
      console.error("❌ Signature length mismatch");
      return false;
    }

    const isValid = crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

    // Check timestamp is within 5 minutes
    const now = Math.floor(Date.now() / 1000);
    const timestampNum = parseInt(timestamp);
    const timeDiff = Math.abs(now - timestampNum);

    if (timeDiff > 300) {
      console.error(`❌ Webhook timestamp too old: ${timeDiff} seconds difference`);
      return false;
    }

    if (isValid) {
      console.log("✅ Webhook signature verified successfully");
    } else {
      console.error("❌ Invalid webhook signature - hash mismatch");
    }

    return isValid;

  } catch (err) {
    console.error("❌ Signature verification error:", err.message);
    return false;
  }
}

// ✅ NEW: Move file from temp folder to final folder after payment
async function moveFileToFinalFolder(fileId, finalFolderId) {
  try {
    const auth = getDriveAuth();
    const drive = google.drive({ version: "v3", auth });

    // Get current parents
    const file = await drive.files.get({
      fileId: fileId,
      fields: 'parents'
    });

    const previousParents = file.data.parents || [];

    // Move to final folder
    await drive.files.update({
      fileId: fileId,
      addParents: finalFolderId,
      removeParents: previousParents.join(','),
      fields: 'id, parents'
    });

    console.log(`✅ Moved file ${fileId} to final folder`);
    return true;
  } catch (err) {
    console.error("❌ Failed to move file:", err.message);
    return false;
  }
}

// ✅ NEW: Check if payment already processed (prevents duplicates)
async function isPaymentAlreadyProcessed(paymentId) {
  try {
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: "Sheet1!G:G", // Column G stores payment_id
    });

    const rows = response.data.values || [];
    // Check if payment_id already exists
    return rows.some(row => row[0] === paymentId);
  } catch (err) {
    console.error("⚠️ Error checking for duplicate payment:", err.message);
    // If we can't check, assume not processed to avoid blocking legitimate payments
    return false;
  }
}

async function logToSheets({ date, name, email, type, amount, driveUrl, ref, paymentId }) {
  try {
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
      range: "Sheet1!A:H", // Added H column for payment_id
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
    console.error("⚠️ Spreadsheet ID used:", process.env.GOOGLE_SHEETS_ID);
    return false;
  }
}

export default async function handler(req, res) {
  console.log("🔥 Webhook hit");
  console.log("📝 Headers:", JSON.stringify(req.headers, null, 2));

  // ✅ Get raw body for signature verification
  const rawBody = JSON.stringify(req.body);

  // 🔍 DEBUG: Log everything to see what PayMongo is sending
  console.log("=== WEBHOOK DEBUG START ===");
  console.log("1. Raw body (first 500 chars):", rawBody.substring(0, 500));
  console.log("2. paymongo-signature header:", req.headers['paymongo-signature']);
  console.log("3. All header keys:", Object.keys(req.headers));
  console.log("4. Any header with 'signature':", Object.keys(req.headers).filter(k => k.toLowerCase().includes('signature')));
  console.log("5. PAYMONGO_WEBHOOK_SECRET exists:", !!process.env.PAYMONGO_WEBHOOK_SECRET);
  console.log("=== WEBHOOK DEBUG END ===");

  // ✅ Verify webhook signature
  const isValidSignature = verifyPayMongoSignature(req, rawBody);
  console.log("🔍 Signature valid result:", isValidSignature);

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

    const paymentId = event.data.id; // ✅ NEW: Get payment ID for duplicate check
    console.log("💰 Processing payment ID:", paymentId);

    // ✅ NEW: Check for duplicate webhook
    const alreadyProcessed = await isPaymentAlreadyProcessed(paymentId);
    if (alreadyProcessed) {
      console.log(`⚠️ Payment ${paymentId} already processed, skipping duplicate webhook`);
      return res.status(200).json({ received: true });
    }

    const paymentData = event.data.attributes.data.attributes;
    const metadata = paymentData.metadata || {};

    // Pull from PayMongo billing first, metadata as fallback
    const email = paymentData.billing?.email || metadata.email;
    const name = paymentData.billing?.name || metadata.name || "Customer";
    const type = metadata.type || "PDF";
    const tempFileId = metadata.tempFileId; // ✅ NEW: Get temp file ID
    const fileName = metadata.fileName;
    const amount = type === "PDF" ? "₱149" : "₱199";
    const ref = metadata.ref || `${type}-${Date.now()}`;
    const date = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" });

    console.log("✅ Payment confirmed for:", email);
    console.log("👤 Customer name:", name);
    console.log("📦 Order type:", type);
    console.log("🔑 Reference:", ref);
    console.log("📁 Temp file ID:", tempFileId);

    // ✅ NEW: Move file from temp folder to final folder
    let finalFileUrl = null;

    if (tempFileId) {
      const finalFolderId = type === "PDF"
        ? process.env.GOOGLE_DRIVE_FOLDER_ID
        : process.env.GOOGLE_DRIVE_FOLDER_ID_PRINT;

      if (finalFolderId) {
        const moved = await moveFileToFinalFolder(tempFileId, finalFolderId);
        if (moved) {
          finalFileUrl = `https://drive.google.com/file/d/${tempFileId}/view`;
          console.log("✅ File moved to final folder and URL generated");
        } else {
          console.warn("⚠️ Failed to move file, but continuing with existing URL if available");
          // Fallback to metadata URL if move fails
          finalFileUrl = metadata.driveFileUrl || null;
        }
      } else {
        console.warn("⚠️ No final folder configured, using temp file URL");
        finalFileUrl = metadata.driveFileUrl || `https://drive.google.com/file/d/${tempFileId}/view`;
      }
    } else {
      // Fallback to existing logic for backward compatibility
      console.log("⚠️ No tempFileId found, using existing URL logic");
      finalFileUrl = metadata.driveFileUrl;
      if (!finalFileUrl && metadata.driveFileId) {
        finalFileUrl = `https://drive.google.com/file/d/${metadata.driveFileId}/view`;
      }
    }

    // Log to Google Sheets with payment ID
    await logToSheets({
      date,
      name,
      email: email || "N/A",
      type,
      amount,
      driveUrl: finalFileUrl || "N/A",
      ref,
      paymentId, // ✅ NEW: Include payment ID
    });

    // Send emails (YOUR EXISTING LOGIC - PRESERVED)
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

  // Always respond 200 to PayMongo
  return res.status(200).json({ received: true });
}