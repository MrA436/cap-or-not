import crypto from 'crypto';
import { analyzeOpportunity } from '../../src/services/analyzer.js';
import type { OpportunityInput } from '../../src/types/analysis.js';
import { checkRateLimit, getClientIp } from '../../src/services/rateLimit.js';

const json = (data: unknown, status = 200, extraHeaders?: Record<string, string>) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });

// This is the fix for the paywall bypass: the full report is only ever
// computed and returned here, AFTER the Razorpay signature is verified
// against our server-only key secret. Nothing about "is this unlocked" is
// ever decided in the browser.
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

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const testUnlockCode = process.env.TEST_UNLOCK_CODE;

  try {
    const body = (await req.json()) as {
      razorpay_order_id?: string;
      razorpay_payment_id?: string;
      razorpay_signature?: string;
      testCode?: string;
      input?: Partial<OpportunityInput>;
    };
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, testCode, input } = body;

    if (!input) {
      return json({ error: 'Missing input' }, 400);
    }

    // Test/dev bypass: only usable at all if TEST_UNLOCK_CODE is actually
    // set in the environment (unset in production if you don't want this
    // path to exist), and only succeeds if the submitted code matches it
    // exactly. The real code value never reaches the browser — it's
    // compared server-side only, same trust boundary as the Razorpay
    // secret below.
    let verified = false;
    if (testUnlockCode && testCode) {
      verified = testCode === testUnlockCode;
      if (!verified) {
        return json({ error: 'Invalid access code' }, 400);
      }
    } else {
      if (!keySecret) {
        console.error('RAZORPAY_KEY_SECRET is not configured');
        return json({ error: 'Payments are not configured' }, 500);
      }
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return json({ error: 'Missing payment verification fields' }, 400);
      }

      // Official Razorpay verification formula: HMAC-SHA256 of
      // "order_id|payment_id" using the key secret, compared to the
      // signature Checkout returned. If this doesn't match, either the
      // payment wasn't real or the data was tampered with in transit.
      const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      const expectedBuffer = new Uint8Array(Buffer.from(expectedSignature, 'utf-8'));
      const actualBuffer = new Uint8Array(Buffer.from(razorpay_signature, 'utf-8'));

      verified =
        expectedBuffer.length === actualBuffer.length &&
        crypto.timingSafeEqual(expectedBuffer, actualBuffer);

      if (!verified) {
        return json({ error: 'Payment could not be verified' }, 400);
      }
    }

    // Signature or test code is genuine — safe to recompute and return
    // the full report.
    const safeInput: OpportunityInput = {
      company: String(input.company ?? '').slice(0, 500),
      recruiterName: String(input.recruiterName ?? '').slice(0, 200),
      recruiterEmail: String(input.recruiterEmail ?? '').slice(0, 320),
      companyWebsite: String(input.companyWebsite ?? '').slice(0, 500),
      jobTitle: String(input.jobTitle ?? '').slice(0, 300),
      jobPostingUrl: String(input.jobPostingUrl ?? '').slice(0, 1000),
      description: String(input.description ?? '').slice(0, 8000),
      recruiterMessage: String(input.recruiterMessage ?? '').slice(0, 8000),
      offerLetter: String(input.offerLetter ?? '').slice(0, 8000),
      agreeToTerms: Boolean(input.agreeToTerms),
    };

    const fullResult = await analyzeOpportunity(safeInput);
    return json({ fullResult });
  } catch (err) {
    console.error('unlock error', err);
    return json({ error: 'Unlock failed' }, 500);
  }
};