// shopee-reference.js - generates a reference code for Shopee print orders
import { uploadToDrive } from "./drive.js";
import { generateShopeeCode } from "./utils.js";
import { Resend } from "resend";
import { google } from "googleapis";

const resend = new Resend(process.env.RESEND_API_KEY);

const rateLimitMap = new Map();

function checkRateLimit(identifier, limit = 2, windowMs = 60000) {
  const now = Date.now();
  const windowStart = now - windowMs;

  for (const [key, timestamps] of rateLimitMap.entries()) {
    const filtered = timestamps.filter(t => t > windowStart);
    if (filtered.length === 0) rateLimitMap.delete(key);
    else rateLimitMap.set(key, filtered);
  }

  const userRequests = rateLimitMap.get(identifier) || [];
  if (userRequests.length >= limit) return false;

  userRequests.push(now);
  rateLimitMap.set(identifier, userRequests);
  return true;
}

function getSessionId(req) {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
}

function getGoogleAuth() {
  return new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
  });
}

async function logReferenceToSheets({ date, name, email, code, driveUrl }) {
  try {
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: "Sheet1!A:H",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[date, name, email, "ShopeeRef", "-", driveUrl, code, "-"]],
      },
    });
    return true;
  } catch (err) {
    console.error("⚠️ Sheets logging failed (non-fatal):", err.message);
    return false;
  }
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  const allowedOrigins = ["https://heavenxentph.com", "http://localhost:3000"];

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "https://heavenxentph.com");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name, email, designId, designName, shopeeUrl, pdf: pdfBase64 } = req.body;

    const sessionId = getSessionId(req);
    const rateLimitKey = `${sessionId}:${email || 'anonymous'}`;
    if (!checkRateLimit(rateLimitKey, 2, 60000)) {
      return res.status(429).json({
        error: "Too many requests. Please wait a moment before trying again."
      });
    }

    if (!name || !email || !designId) {
      return res.status(400).json({ error: "Missing required fields: name, email, designId" });
    }
    if (!pdfBase64) {
      return res.status(400).json({ error: "PDF data is required" });
    }

    try {
      Buffer.from(pdfBase64, "base64");
    } catch {
      return res.status(400).json({ error: "Invalid base64 PDF data" });
    }

    const requiredEnvVars = [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_REFRESH_TOKEN",
      "GOOGLE_DRIVE_FOLDER_ID",
      "RESEND_API_KEY",
    ];
    const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
    if (missingVars.length > 0) {
      console.error("Missing environment variables:", missingVars);
      return res.status(500).json({ error: "Server configuration error" });
    }

    const code = generateShopeeCode(designId);
    const fileName = `${code}.pdf`;

    console.log(`📤 Uploading Shopee reference PDF: ${fileName}`);
    const uploadResult = await uploadToDrive({
      base64PDF: pdfBase64,
      fileName,
      folderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
    });

    const driveFileUrl = uploadResult.fileUrl;
    console.log(`✅ Uploaded: ${driveFileUrl}`);

    const date = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" });

    await logReferenceToSheets({ date, name, email, code, driveUrl: driveFileUrl });

    resend.emails.send({
      from: "HeavenXent Keepsakes <no-reply@heavenxentph.com>",
      to: email,
      subject: `Your Shopee order code: ${code}`,
      text: `Hi ${name},\n\nHere's your reference code for ordering "${designName || designId}" as a printed tag via Shopee:\n\n${code}\n\nHow to use it:\n1. Go to our Shopee listing: ${shopeeUrl || "(link not available)"}\n2. Place your order (selecting a matching design variant helps, but isn't required — we print from your exact saved file either way)\n3. Paste this code in your order note, or send it to us in Shopee chat\n\nWe'll match it to your exact design and print it as-is.\n\nThank you! 💖`,
    }).catch(err => console.error("⚠️ Buyer email failed (non-fatal):", err.message));

    resend.emails.send({
      from: "HeavenXent Keepsakes <no-reply@heavenxentph.com>",
      to: "heavenxentkeepsakes@gmail.com",
      subject: `Shopee Ref: ${code} — ${designName || designId}`,
      text: `New Shopee print reservation.\n\nCode: ${code}\nDesign: ${designName || designId}\nDate: ${date}\nName: ${name}\nEmail: ${email}\nDrive file: ${driveFileUrl}\n\nSearch this code when the matching Shopee order comes in.`,
    }).catch(err => console.error("⚠️ Business email failed (non-fatal):", err.message));

    return res.status(200).json({ code, driveFileUrl });

  } catch (err) {
    console.error("❌ Backend error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}