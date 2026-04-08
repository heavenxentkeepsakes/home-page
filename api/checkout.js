import { uploadToDrive } from "./drive.js";
import { Resend } from "resend";
import fetch from "node-fetch";

const resend = new Resend(process.env.RESEND_API_KEY);

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
      return res.status(500).json({ error: "Server configuration error. Missing: " + missingVars.join(", ") });
    }

    const folderId =
      type === "PDF"
        ? process.env.GOOGLE_DRIVE_FOLDER_ID
        : process.env.GOOGLE_DRIVE_FOLDER_ID_PRINT || process.env.GOOGLE_DRIVE_FOLDER_ID;

    if (!folderId) {
      return res.status(500).json({ error: "Google Drive folder not configured" });
    }

    const fileName = `${type}-ORD-${Date.now()}.pdf`;

    // --- ✅ Upload FIRST so we have the URL for PayMongo metadata ---
    const uploadResult = await uploadToDrive({ base64PDF: pdfBase64, fileName, folderId });
    const driveFileId = uploadResult.fileId;
    const driveFileUrl = uploadResult.fileUrl;

    // --- 🚀 Create PayMongo checkout with drive URL in metadata ---
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
            payment_method_types: ["gcash", "card"],
            // ✅ Drive URL is now included so webhook can send it in the email
            metadata: { name, email, type, address, driveFileId, driveFileUrl },
            success_url: "https://heavenxentph.com/success.html",
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

    // --- 🚀 Send order received email in background (non-blocking) ---
    resend.emails.send({
      from: "HeavenXent Keepsakes <no-reply@heavenxentph.com>",
      to: email,
      subject: type === "PDF" ? "Your order has been received" : "Print Order Received",
      text:
        type === "PDF"
          ? `Hi ${name},\n\nWe received your order! Your download link will be emailed to you once payment is confirmed.\n\nThank you! 💖`
          : `Hi ${name},\n\nYour print order has been received. We will process it within 5–7 days.\n\nThank you! 💖`,
    }).catch((err) => {
      console.error("⚠️ Order email failed (non-fatal):", err.message);
    });

    // --- ✅ Return checkout URL ---
    return res.status(200).json({ checkout_url: checkoutUrl });

  } catch (err) {
    console.error("Backend error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}