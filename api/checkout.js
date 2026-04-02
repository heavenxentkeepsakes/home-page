import { google } from "googleapis";
import nodemailer from "nodemailer";
import fetch from "node-fetch";

export default async function handler(req, res) {
  // CORS for your frontend domain
  res.setHeader("Access-Control-Allow-Origin", "https://heavenxentph.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight OPTIONS requests
  if (req.method === "OPTIONS") {
    return res.status(204).end(); // No content
  }

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name, email, type, pdf: pdfBase64, address } = req.body;

    // --- Convert PDF base64 to Buffer ---
    const pdfBuffer = Buffer.from(pdfBase64, "base64");

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
      : process.env.GOOGLE_DRIVE_FOLDER_ID_PRINT; // Print folder

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

    const checkoutData = await checkoutRes.json();

    return res.status(200).json({ checkout_url: checkoutData.data.attributes.checkout_url });

  } catch (err) {
    console.error("Backend error:", err);
    return res.status(500).json({ error: err.message });
  }
}