import type { VercelRequest, VercelResponse } from '@vercel/node';
import Razorpay from 'razorpay';

// Price lives here, server-side — never trust an amount sent from the
// browser. Change this one line to change the price everywhere.
const REPORT_PRICE_PAISE = 14900; // ₹149.00 (Razorpay amounts are in paise)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    console.error('Razorpay keys are not configured');
    res.status(500).json({ error: 'Payments are not configured' });
    return;
  }

  try {
    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });

    const order = await razorpay.orders.create({
      amount: REPORT_PRICE_PAISE,
      currency: 'INR',
      receipt: `capornot_${Date.now()}`,
    });

    // key_id is safe to return — it's the PUBLIC key, meant to be used in
    // the browser to open Checkout. key_secret never leaves this function.
    res.status(200).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId,
    });
  } catch (err) {
    console.error('create-order error', err);
    res.status(500).json({ error: 'Could not create order' });
  }
}