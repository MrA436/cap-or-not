import Razorpay from 'razorpay';
import { checkRateLimit, getClientIp } from '../../src/services/rateLimit.js';
import { readUserIdCookie } from './_lib/identity.js';
import { getReport, createPaymentOrder } from './_lib/store.js';

const json = (data: unknown, status = 200, extraHeaders?: Record<string, string>) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });

// Price lives here, server-side — never trust an amount sent from the
// browser. Change this one line to change the price everywhere.
const REPORT_PRICE_PAISE = 19900; // ₹199.00 (Razorpay amounts are in paise)

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
    const body = (await req.json().catch(() => null)) as { reportId?: string } | null;
    const reportId = body?.reportId;
    if (!reportId) {
      return json({ error: 'Missing reportId' }, 400);
    }

    // ₹199 unlocks ONE specific report, permanently, for the user who
    // ran it — not unlimited future reports, and only for the person who
    // ran it. That's enforced right here, before Razorpay is even
    // involved: only the report's own owner (per the identity cookie —
    // never trusted from anything the client sends explicitly) can
    // start a purchase for it, and an already-paid report can't be
    // "bought" again.
    const userId = readUserIdCookie(req);
    if (!userId) {
      return json({ error: 'No screening found for this browser. Run a screening first.' }, 401);
    }
    const report = await getReport(reportId);
    if (!report || report.userId !== userId) {
      return json({ error: 'Report not found' }, 404);
    }
    if (report.paid) {
      return json({ error: 'This report is already unlocked' }, 409);
    }

    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });

    const order = await razorpay.orders.create({
      amount: REPORT_PRICE_PAISE,
      currency: 'INR',
      receipt: `capornot_${Date.now()}`,
    });

    await createPaymentOrder({
      userId,
      reportId,
      razorpayOrderId: order.id,
      amountPaise: REPORT_PRICE_PAISE,
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