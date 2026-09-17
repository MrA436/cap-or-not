import Razorpay from 'razorpay';
import { checkRateLimit, getClientIp } from '../../src/services/rateLimit.js';

const json = (data: unknown, status = 200, extraHeaders?: Record<string, string>) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });

// Price lives here, server-side — never trust an amount sent from the
// browser. Change this one line to change the price everywhere.
const REPORT_PRICE_PAISE = 14900; // ₹149.00 (Razorpay amounts are in paise)

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const ip = getClientIp(req);
  // Stricter than analyze — each call here is a real API request to
  // Razorpay, not just local computation.
  const rateLimit = checkRateLimit(`create-order:${ip}`, 5, 60_000); // 5/minute/IP
  if (!rateLimit.allowed) {
    return json(
      { error: 'Too many requests. Please wait a moment and try again.' },
      429,
      rateLimit.retryAfterSeconds ? { 'Retry-After': String(rateLimit.retryAfterSeconds) } : undefined,
    );
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    console.error('Razorpay keys are not configured');
    return json({ error: 'Payments are not configured' }, 500);
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
    return json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId,
    });
  } catch (err) {
    console.error('create-order error', err);
    return json({ error: 'Could not create order' }, 500);
  }
};