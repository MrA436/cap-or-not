import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { analyzeOpportunity } from '../src/services/analyzer.js';
import type { OpportunityInput } from '../src/types/analysis.js';

// This is the fix for the paywall bypass: the full report is only ever
// computed and returned here, AFTER the Razorpay signature is verified
// against our server-only key secret. Nothing about "is this unlocked" is
// ever decided in the browser.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    console.error('RAZORPAY_KEY_SECRET is not configured');
    res.status(500).json({ error: 'Payments are not configured' });
    return;
  }

  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, input } = req.body as {
      razorpay_order_id?: string;
      razorpay_payment_id?: string;
      razorpay_signature?: string;
      input?: Partial<OpportunityInput>;
    };

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !input) {
      res.status(400).json({ error: 'Missing payment verification fields' });
      return;
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

    const isValid =
      expectedBuffer.length === actualBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, actualBuffer);

    if (!isValid) {
      res.status(400).json({ error: 'Payment could not be verified' });
      return;
    }

    // Signature is genuine — safe to recompute and return the full report.
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

    const fullResult = analyzeOpportunity(safeInput);
    res.status(200).json({ fullResult });
  } catch (err) {
    console.error('unlock error', err);
    res.status(500).json({ error: 'Unlock failed' });
  }
}