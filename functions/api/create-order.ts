import { checkRateLimit, getClientIp } from '../../src/services/rateLimit.js';
import { readUserIdCookie } from '../_lib/identity.js';
import { openDbClient } from '../_lib/db.js';
import { getReport, createPaymentOrder } from '../_lib/store.js';
import type { Env } from '../_lib/types.js';

const json = (data: unknown, status = 200, extraHeaders?: Record<string, string>) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });

// Price lives here, server-side — never trust an amount sent from the
// browser. Change this one line to change the price everywhere.
const REPORT_PRICE_PAISE = 19900; // ₹199.00 (Razorpay amounts are in paise)

// Calls Razorpay's Orders API directly via fetch rather than the
// `razorpay` npm package. That package depends on axios, whose Node
// HTTP-adapter path isn't guaranteed to work under Cloudflare Workers'
// nodejs_compat — fetch is a first-class, fully-native Workers API with
// no such uncertainty, and Razorpay's API is a plain REST endpoint
// (Basic Auth with key_id:key_secret) with nothing the SDK does that
// fetch can't do directly. See https://razorpay.com/docs/api/orders/create
async function createRazorpayOrder(keyId: string, keySecret: string, body: Record<string, unknown>) {
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { id?: string; amount?: number; currency?: string; error?: { description?: string } };
  if (!res.ok || !data.id) {
    throw new Error(data.error?.description ?? `Razorpay order creation failed (${res.status})`);
  }
  return data as { id: string; amount: number; currency: string };
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const ip = getClientIp(request);
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

  const keyId = env.RAZORPAY_KEY_ID;
  const keySecret = env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    console.error('Razorpay keys are not configured');
    return json({ error: 'Payments are not configured' }, 500);
  }

  const client = openDbClient(env.HYPERDRIVE);
  await client.connect();

  try {
    const body = (await request.json().catch(() => null)) as { reportId?: string } | null;
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
    const userId = readUserIdCookie(request);
    if (!userId) {
      return json({ error: 'No screening found for this browser. Run a screening first.' }, 401);
    }
    const report = await getReport(client, reportId);
    if (!report || report.userId !== userId) {
      return json({ error: 'Report not found' }, 404);
    }
    if (report.paid) {
      return json({ error: 'This report is already unlocked' }, 409);
    }

    const order = await createRazorpayOrder(keyId, keySecret, {
      amount: REPORT_PRICE_PAISE,
      currency: 'INR',
      receipt: `capornot_${Date.now()}`,
    });

    await createPaymentOrder(client, {
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
  } finally {
    waitUntil(client.end());
  }
};