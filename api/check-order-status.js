// api/check-order-status.js
import { google } from "googleapis";

function getGoogleAuth() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    console.error("Missing Google Service Account credentials");
    return null;
  }
  
  return new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
  });
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  const allowedOrigins = ["https://heavenxentph.com", "http://localhost:3000"];
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  
  try {
    const { payment_id, session_id, email, ref } = req.query;
    
    console.log("🔍 Checking order status for:", { payment_id, session_id, email, ref });
    
    // Check in-memory store first
    const inMemoryOrder = global.orderStore?.get(ref);
    if (inMemoryOrder) {
      console.log("✅ Found order in memory:", inMemoryOrder);
    }
    
    // Check Google Sheets for paid orders
    let sheetOrder = null;
    
    if (process.env.GOOGLE_SHEETS_ID && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
      try {
        const auth = getGoogleAuth();
        if (auth) {
          const sheets = google.sheets({ version: "v4", auth });
          
          const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEETS_ID,
            range: "Sheet1!A:H",
          });
          
          const rows = response.data.values || [];
          console.log(`📊 Found ${rows.length} rows in Google Sheets`);
          
          if (rows.length > 1) {
            // Headers: Date, Name, Email, Type, Amount, DriveUrl, Ref, PaymentId
            for (let i = 1; i < rows.length; i++) {
              const row = rows[i];
              const rowRef = row[6];      // Column G - Ref
              const rowEmail = row[2];    // Column C - Email
              const rowPaymentId = row[7]; // Column H - PaymentId
              
              if ((ref && rowRef === ref) ||
                  (email && rowEmail && rowEmail.toLowerCase() === email.toLowerCase()) ||
                  (payment_id && rowPaymentId === payment_id) ||
                  (session_id && rowPaymentId === session_id)) {
                
                // Parse amount from sheet (should be like "₱199" or "₱199")
                let amountDisplay = row[4] || "₱199";
                let amountCents = 19900;
                if (amountDisplay.includes("199")) amountCents = 19900;
                if (amountDisplay.includes("199")) amountCents = 19900;
                
                sheetOrder = {
                  date: row[0],
                  name: row[1],
                  email: row[2],
                  type: row[3],
                  amount: amountCents,  // Store in cents
                  amountDisplay: amountDisplay,
                  driveFileUrl: row[5],
                  ref: row[6],
                  paymentId: row[7],
                  status: "paid",
                  payment_status: "paid",
                  source: "google_sheets"
                };
                console.log("✅ Found PAID order in Google Sheets:", sheetOrder);
                break;
              }
            }
          }
        }
      } catch (err) {
        console.error("⚠️ Error reading from Google Sheets:", err.message);
      }
    }
    
    // If found in Google Sheets (paid), return that immediately
    if (sheetOrder) {
      return res.status(200).json(sheetOrder);
    }
    
    // If found in memory but not yet in Sheets, return as pending
    if (inMemoryOrder) {
      return res.status(200).json({
        ...inMemoryOrder,
        status: "pending",
        payment_status: "pending",
        message: "Payment received, waiting for bank confirmation..."
      });
    }
    
    // If we have ref but no data yet, return pending with basic info
    if (ref) {
      return res.status(200).json({
        ref: ref,
        email: email || null,
        name: null,
        type: null,
        status: "pending",
        payment_status: "pending",
        message: "Awaiting payment confirmation..."
      });
    }
    
    return res.status(200).json({
      status: "not_found",
      payment_status: "unknown",
      message: "Order not found. Please check your email for confirmation."
    });
    
  } catch (err) {
    console.error("❌ Error checking order status:", err);
    return res.status(500).json({ 
      error: "Failed to check order status",
      message: err.message 
    });
  }
}