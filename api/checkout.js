// checkout.js - updated success_url with order reference
import { uploadToDrive } from "./drive.js";
import { Resend } from "resend";
import fetch from "node-fetch";

const resend = new Resend(process.env.RESEND_API_KEY);

// Simple in-memory rate limiting
const rateLimitMap = new Map();

function checkRateLimit(identifier, limit = 3, windowMs = 60000) {
  const now = Date.now();
  const windowStart = now - windowMs;

  for (const [key, timestamps] of rateLimitMap.entries()) {
    const filtered = timestamps.filter(t => t > windowStart);
    if (filtered.length === 0) {
      rateLimitMap.delete(key);
    } else {
      rateLimitMap.set(key, filtered);
    }
  }

  const userRequests = rateLimitMap.get(identifier) || [];
  if (userRequests.length >= limit) {
    return false;
  }

  userRequests.push(now);
  rateLimitMap.set(identifier, userRequests);
  return true;
}

function getSessionId(req) {
  return req.headers['x-forwarded-for'] ||
    req.socket.remoteAddress ||
    'unknown';
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
    const { name, email, type, pdf: pdfBase64, address } = req.body;

    // Rate limiting
    const sessionId = getSessionId(req);
    const rateLimitKey = `${sessionId}:${email || 'anonymous'}`;
    if (!checkRateLimit(rateLimitKey, 3, 60000)) {
      console.warn(`⚠️ Rate limit exceeded for ${rateLimitKey}`);
      return res.status(429).json({
        error: "Too many requests. Please wait a moment before trying again."
      });
    }

    if (!name || !email || !type) {
      return res.status(400).json({ error: "Missing required fields: name, email, type" });
    }
    if (!pdfBase64) {
      return res.status(400).json({ error: "PDF data is required" });
    }

    try {
      Buffer.from(pdfBase64, "base64");
    } catch (e) {
      return res.status(400).json({ error: "Invalid base64 PDF data" });
    }

    const requiredEnvVars = [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_REFRESH_TOKEN",
      "GOOGLE_DRIVE_FOLDER_ID",
      "PAYMONGO_SECRET_KEY",
      "RESEND_API_KEY",
    ];

    const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
    if (missingVars.length > 0) {
      console.error("Missing environment variables:", missingVars);
      return res.status(500).json({ error: "Server configuration error" });
    }

    const folderId = type === "PDF"
      ? process.env.GOOGLE_DRIVE_FOLDER_ID
      : process.env.GOOGLE_DRIVE_FOLDER_ID_PRINT || process.env.GOOGLE_DRIVE_FOLDER_ID;

    if (!folderId) {
      return res.status(500).json({ error: "Google Drive folder not configured" });
    }

    const fileName = `${type}-ORD-${Date.now()}.pdf`;
    const ref = `${type}-${Date.now()}`;

    // Upload to Drive
    console.log(`📤 Uploading to Drive folder: ${folderId}`);
    const uploadResult = await uploadToDrive({
      base64PDF: pdfBase64,
      fileName,
      folderId
    });

    const driveFileId = uploadResult.fileId;
    const driveFileUrl = uploadResult.fileUrl;
    console.log(`✅ File uploaded with ID: ${driveFileId}`);

    // Create PayMongo checkout session
    const checkoutRes = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(process.env.PAYMONGO_SECRET_KEY + ":").toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: {
          attributes: {
            billing: { name, email },
            line_items: [
              {
                currency: "PHP",
                amount: type === "PDF" ? 14900 : 19900,
                name: type === "PDF" ? "PDF Download" : "Print Order",
                quantity: 1,
              },
            ],
            "payment_method_types": [
              "card",
              "gcash",
              "paymaya",
              "qrph",
              "online_banking"
            ],
            metadata: {
              name,
              email,
              type,
              address,
              driveFileId,
              driveFileUrl,
              fileName,
              ref
            },
            // IMPORTANT: Pass order reference in success URL
            success_url: `https://heavenxentph.com/success.html?ref=${encodeURIComponent(ref)}&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}&type=${type}`,
            cancel_url: "https://heavenxentph.com/cancel.html",
          },
        },
      }),
    });

    if (!checkoutRes.ok) {
      const errorText = await checkoutRes.text();
      console.error("PayMongo status:", checkoutRes.status);
      console.error("PayMongo error:", errorText);
      return res.status(500).json({ error: "Payment gateway error" });
    }

    const checkoutData = await checkoutRes.json();
    const checkoutUrl = checkoutData.data?.attributes?.checkout_url;

    if (!checkoutUrl) {
      console.error("Invalid PayMongo response:", checkoutData);
      return res.status(500).json({ error: "Invalid payment response" });
    }

    // Store order info temporarily (for 15 minutes) so success page can retrieve it
    // Using a simple in-memory store - for production, use Redis or similar
    const orderStore = global.orderStore || new Map();
    global.orderStore = orderStore;
    orderStore.set(ref, {
      name,
      email,
      type,
      ref,
      driveFileUrl,
      driveFileId,
      fileName,
      createdAt: Date.now()
    });

    // Clean up old entries after 15 minutes
    setTimeout(() => {
      if (orderStore.has(ref)) {
        orderStore.delete(ref);
      }
    }, 15 * 60 * 1000);

    // Send order received email (non-blocking)
    resend.emails.send({
      from: "HeavenXent Keepsakes <no-reply@heavenxentph.com>",
      to: email,
      subject: type === "PDF" ? "Your order has been received" : "Print Order Received",
      text: type === "PDF"
        ? `Hi ${name},\n\nWe received your order! Your download link will be emailed to you once payment is confirmed.\n\nReference: ${ref}\n\nThank you! 💖`
        : `Hi ${name},\n\nYour print order has been received. We will process it within 5–7 days.\n\nReference: ${ref}\n\nThank you! 💖`,
    }).catch((err) => {
      console.error("⚠️ Order email failed (non-fatal):", err.message);
    });

    console.log(`✅ Checkout created: ${checkoutUrl}`);
    console.log(`📝 Order reference: ${ref}`);

    return res.status(200).json({ checkout_url: checkoutUrl });

  } catch (err) {
    console.error("❌ Backend error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}