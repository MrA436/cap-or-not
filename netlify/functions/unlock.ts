import crypto from 'crypto';
import { checkRateLimit, getClientIp } from '../../src/services/rateLimit.js';
import { readUserIdCookie } from './_lib/identity.js';
import { getReport, getPaymentByOrderId, markPaymentPaid, markReportPaid } from './_lib/store.js';

const json = (data: unknown, status = 200, extraHeaders?: Record<string, string>) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });

// This is the fix for the paywall bypass: the full report is only ever
// sent back here, AFTER (a) the Razorpay signature is verified against
// our server-only key secret, AND (b) the order it's for was one WE
// created (create-order.ts), for THIS specific report, for THIS specific
// user (identity cookie) — not just any signature for any order. Nothing
// about "is this unlocked" is ever decided in the browser, and the
// report content itself comes from Postgres (what /api/analyze already
// computed and stored), never recomputed from a client-resent copy of
// the input.
export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const ip = getClientIp(req);
  // More generous than the other endpoints — this is already gated by a
  // real signature check, so the limit here is just to stop someone
  // hammering it with junk requests, not to protect against bypass.
  const rateLimit = checkRateLimit(`unlock:${ip}`, 20, 60_000); // 20/minute/IP
  if (!rateLimit.allowed) {
    return json(
      { error: 'Too many requests. Please wait a moment and try again.' },
      429,
      rateLimit.retryAfterSeconds ? { 'Retry-After': String(rateLimit.retryAfterSeconds) } : undefined,
    );
  }

  const userId = readUserIdCookie(req);
  if (!userId) {
    return json({ error: 'No screening found for this browser. Run a screening first.' }, 401);
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const testUnlockCode = process.env.TEST_UNLOCK_CODE;

  try {
    const body = (await req.json()) as {
      razorpay_order_id?: string;
      razorpay_payment_id?: string;
      razorpay_signature?: string;
      testCode?: string;
      reportId?: string;
    };
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, testCode, reportId } = body;

    // Test/dev bypass: only usable at all if TEST_UNLOCK_CODE is actually
    // set in the environment (unset in production if you don't want this
    // path to exist), and only succeeds if the submitted code matches it
    // exactly. The real code value never reaches the browser — it's
    // compared server-side only, same trust boundary as the Razorpay
    // secret below. Still goes through the same ownership + persistence
    // as a real payment, so testing exercises the real access-control
    // path.
    if (testUnlockCode && testCode) {
      if (testCode !== testUnlockCode) {
        return json({ error: 'Invalid access code' }, 400);
      }
      if (!reportId) {
        return json({ error: 'Missing reportId' }, 400);
      }
      const report = await getReport(reportId);
      if (!report || report.userId !== userId) {
        return json({ error: 'Report not found' }, 404);
      }
      await markReportPaid(reportId);
      return json({ fullResult: report.fullResult });
    }

    if (!keySecret) {
      console.error('RAZORPAY_KEY_SECRET is not configured');
      return json({ error: 'Payments are not configured' }, 500);
    }
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return json({ error: 'Missing payment verification fields' }, 400);
    }

    // The order must be one we actually created for this user (see
    // create-order.ts) — not just any order id someone happens to send.
    const payment = await getPaymentByOrderId(razorpay_order_id);
    if (!payment) {
      return json({ error: 'Payment could not be verified' }, 400);
    }
    if (payment.userId !== userId) {
      // Same signature, different browser/cookie than the one that
      // started the purchase — refuse rather than hand the report to
      // whoever's making this particular request.
      return json({ error: 'Payment could not be verified' }, 403);
    }

    // Already processed — most likely Checkout's success handler firing
    // more than once, or the browser retrying. Re-confirm rather than
    // error, and don't re-verify a signature we've already accepted.
    if (payment.status === 'paid') {
      const report = await getReport(payment.reportId);
      if (!report) {
        return json({ error: 'Report not found' }, 404);
      }
      return json({ fullResult: report.fullResult });
    }

    // Official Razorpay verification formula: HMAC-SHA256 of
    // "order_id|payment_id" using the key secret, compared to the
    // signature Checkout returned. If this doesn't match, either the
    // payment wasn't real or the data was tampered with in transit.
    // (The amount itself isn't re-checked against Razorpay here because
    // it doesn't need to be: this order was created server-side, for a
    // fixed amount we chose, and never modified — see
    // createPaymentOrder() in create-order.ts. The signature ties this
    // payment to exactly that order, so there is no path by which the
    // amount could have changed.)
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    const expectedBuffer = new Uint8Array(Buffer.from(expectedSignature, 'utf-8'));
    const actualBuffer = new Uint8Array(Buffer.from(razorpay_signature, 'utf-8'));

    const verified =
      expectedBuffer.length === actualBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, actualBuffer);

    if (!verified) {
      return json({ error: 'Payment could not be verified' }, 400);
    }

    const report = await getReport(payment.reportId);
    if (!report) {
      return json({ error: 'Report not found' }, 404);
    }

    await markPaymentPaid(razorpay_order_id, razorpay_payment_id);
    await markReportPaid(payment.reportId);

    return json({ fullResult: report.fullResult });
  } catch (err) {
    console.error('unlock error', err);
    return json({ error: 'Unlock failed' }, 500);
  }
};