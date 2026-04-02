// Create a serverless function in Vercel to create a PayMongo checkout session in test mode
// Input: buyer name, email, PDF info
// Output: checkout URL

const paymongo = require('paymongo-node');
const { VERCEL_PG_CONNECTION_STRING } = process.env;

const client = new paymongo.Client({
  secretKey: process.env.PAYMONGO_SECRET_KEY,
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, pdfInfo } = req.body;

  if (!name || !email || !pdfInfo) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Create a payment intent
    const paymentIntent = await client.paymentIntents.create({
      amount: pdfInfo.price * 100, // Convert to cents
      currency: 'PHP',
      payment_method_types: ['card'],
      description: `Payment for ${pdfInfo.title}`,
    });
    
    // Create a checkout session
    const checkoutSession = await client.checkout.sessions.create({
      payment_intent: paymentIntent.id,
      success_url: 'https://yourdomain.com/success',
      cancel_url: 'https://yourdomain.com/cancel',
      customer_email: email,
    });

    res.status(200).json({ checkoutUrl: checkoutSession.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};  

