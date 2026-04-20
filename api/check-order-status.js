// api/check-order-status.js
import { google } from "googleapis";

function getGoogleAuth() {
  return new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
  });
}

export default async function handler(req, res) {
  // Enable CORS
  const origin = req.headers.origin;
  const allowedOrigins = ["https://heavenxentph.com", "http://localhost:3000"];
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  
  try {
    const { payment_id, session_id, email, ref } = req.query;
    
    if (!process.env.GOOGLE_SHEETS_ID) {
      return res.status(200).json({ 
        status: "pending", 
        message: "Order tracking available after webhook processes payment" 
      });
    }
    
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });
    
    // Get all orders from Sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: "Sheet1!A:H",
    });
    
    const rows = response.data.values || [];
    if (rows.length === 0) {
      return res.status(200).json({ status: "pending", found: false });
    }
    
    // Headers: Date, Name, Email, Type, Amount, DriveUrl, Ref, PaymentId
    let matchingOrder = null;
    
    for (let i = 1; i < rows.length; i++) { // Skip header row
      const row = rows[i];
      const rowPaymentId = row[7]; // Column H
      const rowEmail = row[2];      // Column C
      const rowRef = row[6];        // Column G
      
      if ((payment_id && rowPaymentId === payment_id) ||
          (session_id && rowPaymentId === session_id) ||
          (email && rowEmail && rowEmail.toLowerCase() === email.toLowerCase()) ||
          (ref && rowRef === ref)) {
        matchingOrder = {
          date: row[0],
          name: row[1],
          email: row[2],
          type: row[3],
          amount: row[4],
          driveFileUrl: row[5],
          ref: row[6],
          paymentId: row[7],
          status: "paid",
          payment_status: "paid"
        };
        break;
      }
    }
    
    if (matchingOrder) {
      return res.status(200).json(matchingOrder);
    } else {
      return res.status(200).json({ 
        status: "pending", 
        found: false,
        message: "Payment still processing or webhook pending"
      });
    }
    
  } catch (err) {
    console.error("Error checking order status:", err);
    return res.status(500).json({ error: "Failed to check order status" });
  }
}