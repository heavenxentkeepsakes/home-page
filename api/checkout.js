import { google } from "googleapis";
import nodemailer from "nodemailer";
import fetch from "node-fetch";

export default async function handler(req, res) {
  // CORS for your frontend domain - set FIRST before any logic
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

  // Handle preflight OPTIONS requests
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name, email, type, pdf: pdfBase64, address } = req.body;

    // Validate required fields
    if (!name || !email || !type) {
      return res.status(400).json({ error: "Missing required fields: name, email, type" });
    }

    if (!pdfBase64) {
      return res.status(400).json({ error: "PDF data is required" });
    }

    // --- Convert PDF base64 to Buffer ---
    let pdfBuffer;
    try {
      pdfBuffer = Buffer.from(pdfBase64, "base64");
    } catch (e) {
      return res.status(400).json({ error: "Invalid base64 PDF data" });
    }

    // Check environment variables
    const requiredEnvVars = [
      'GOOGLE_CLIENT_EMAIL',
      'GOOGLE_PRIVATE_KEY',
      'GOOGLE_DRIVE_FOLDER_ID',
      'PAYMONGO_SECRET_KEY',
      'RESEND_API_KEY'
    ];
    
    const missingVars = requiredEnvVars.filter(v => !process.env[v]);
    if (missingVars.length > 0) {
      console.error("Missing environment variables:", missingVars);
      return res.status(500).json({ error: "Server configuration error. Missing: " + missingVars.join(", ") });
    }

    // --- Google Drive Auth ---
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
      },
      scopes: ["https://www.googleapis.com/auth/drive.file"]
    });

    const drive = google.drive({ version: "v3", auth });

    // --- Decide folder based on type ---
    const folderId = type === "PDF"
      ? process.env.GOOGLE_DRIVE_FOLDER_ID     // PDF folder
      : (process.env.GOOGLE_DRIVE_FOLDER_ID_PRINT || process.env.GOOGLE_DRIVE_FOLDER_ID); // Print folder

    if (!folderId) {
      return res.status(500).json({ error: "Google Drive folder not configured" });
    }

    const fileName = `${type}-ORD-${Date.now()}.pdf`;

    // --- Upload PDF to Google Drive ---
    await drive.files.create({
      requestBody: { name: fileName, parents: [folderId] },
      media: { mimeType: "application/pdf", body: pdfBuffer }
    });

    // --- Send confirmation email ---
    const transporter = nodemailer.createTransport({
      host: "smtp.resend.email",
      port: 587,
      auth: {
        user: process.env.RESEND_API_KEY,
        pass: process.env.RESEND_API_KEY
      }
    });

    let emailText = "";
    if (type === "PDF") {
      emailText = `Hi ${name},\n\nYour PDF has been generated successfully. You can download it after payment.\n\nThank you!`;
    } else {
      const ref = `PRINT-${Date.now()}`;
      emailText = `Hi ${name},\n\nYour print order (${ref}) has been received. We will process it within a week.\n\nThank you!`;
      // Optional: log print orders to Google Sheets here for tracking
    }

    await transporter.sendMail({
      from: "no-reply@heavenxentph.com",
      to: email,
      subject: type === "PDF" ? "Your PDF is ready" : "Print Order Received",
      text: emailText
    });

    // --- Create PayMongo checkout ---
    const checkoutRes = await fetch("https://api.paymongo.com/v1/checkout", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${Buffer.from(process.env.PAYMONGO_SECRET_KEY + ":").toString("base64")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        data: {
          attributes: {
            amount: type === "PDF" ? 9900 : 19900, // adjust prices
            currency: "PHP",
            metadata: { name, email, type, address },
            success_url: "https://heavenxentph.com/success.html",
            cancel_url: "https://heavenxentph.com/cancel.html"
          }
        }
      })
    });

    if (!checkoutRes.ok) {
      const errorText = await checkoutRes.text();
      console.error("PayMongo error:", checkoutRes.status, errorText);
      return res.status(500).json({ error: "Payment gateway error" });
    }

    const checkoutData = await checkoutRes.json();

    if (!checkoutData.data?.attributes?.checkout_url) {
      console.error("Invalid PayMongo response:", checkoutData);
      return res.status(500).json({ error: "Invalid payment response" });
    }

    return res.status(200).json({ checkout_url: checkoutData.data.attributes.checkout_url });

  } catch (err) {
    console.error("Backend error:", err);
    // CORS headers are already set above, so error response will include them
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}