export default async function handler(req, res) {
  // ✅ CORS HEADERS (ADD THIS BLOCK)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ✅ Handle preflight request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { name, email, type } = req.body;

  const ref = `PDF-${Date.now()}`;

  try {
    const response = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + Buffer.from(process.env.PAYMONGO_SECRET_KEY + ":").toString("base64")
      },
      body: JSON.stringify({
        data: {
          attributes: {
            billing: {
              name,
              email
            },
            send_email_receipt: false,
            show_description: true,
            show_line_items: true,
            line_items: [
              {
                currency: "PHP",
                amount: type === "PRINT" ? 19900 : 9900, // adjust price
                name: type === "PRINT" ? "Printed Tags (24pcs)" : "Wedding Tag PDF",
                quantity: 1
              }
            ],
            payment_method_types: ["card", "gcash"],
            success_url: "https://your-site.com/success",
            cancel_url: "https://your-site.com/cancel",
            metadata: {
              email,
              name,
              type,
              ref
            }
          }
        }
      })
    });

    const data = await response.json();

    return res.status(200).json({
      checkout_url: data.data.attributes.checkout_url
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Checkout creation failed" });
  }
}