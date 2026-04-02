import { uploadToDrive } from "./drive.js";
import { sendEmail } from "./email.js";

export default async function handler(req, res) {
  console.log("🔥 Webhook hit");

  if (req.method !== "POST") {
    return res.status(405).end();
  }

  try {
    const event = req.body;

    if (event.data.attributes.type === "payment.paid") {
      const metadata = event.data.attributes.data.attributes.metadata;

      const { email, name, type, ref } = metadata;

      console.log("✅ Payment confirmed for:", email);

      // TODO: replace with actual PDF data (for now placeholder)
      const dummyPDF = Buffer.from("Sample PDF");

      const driveLink = await uploadToDrive(dummyPDF, ref);

      await sendEmail(email, name, driveLink, ref, type);

      console.log("✅ Order completed:", ref);
    }

    res.status(200).json({ received: true });

  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).end();
  }
}