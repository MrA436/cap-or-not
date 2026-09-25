import { analyzeOpportunity, toPublicResult } from '../../src/services/analyzer.js';
import type { OpportunityInput, AnalyzeResponse, PreviewTier } from '../../src/types/analysis.js';
import { checkRateLimit, getClientIp } from '../../src/services/rateLimit.js';
import { consumeFreeCheck } from '../../src/services/freeChecks.js';

const json = (data: unknown, status = 200, extraHeaders?: Record<string, string>) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });

// This is the ONLY place the full analysis is computed for a fresh check.
// The full result never leaves this function, free screening or not —
// only toPublicResult()'s preview output is sent back. The full result is
// recomputed again, from scratch, inside unlock.ts only after a real
// payment signature is verified.
export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const ip = getClientIp(req);
  const rateLimit = checkRateLimit(`analyze:${ip}`, 10, 60_000); // 10 checks/minute/IP
  if (!rateLimit.allowed) {
    return json(
      { error: 'Too many requests. Please wait a moment and try again.' },
      429,
      rateLimit.retryAfterSeconds ? { 'Retry-After': String(rateLimit.retryAfterSeconds) } : undefined,
    );
  }

  try {
    const input = (await req.json()) as Partial<OpportunityInput>;

    if (!input || typeof input !== 'object') {
      return json({ error: 'Invalid request body' }, 400);
    }

    // Basic shape safety — every field is treated as untrusted text, never
    // as instructions (relevant if AI analysis is added later; the current
    // rule-based analyzer just pattern-matches strings, so there's no
    // prompt-injection surface today, but this keeps the input normalized).
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

    const hasContent = [
      safeInput.company, safeInput.recruiterName, safeInput.recruiterEmail,
      safeInput.companyWebsite, safeInput.jobTitle, safeInput.jobPostingUrl,
      safeInput.description, safeInput.recruiterMessage, safeInput.offerLetter,
    ].some((v) => v.trim().length > 0);

    if (!hasContent) {
      return json({ error: 'At least one field is required' }, 400);
    }

    const fullResult = await analyzeOpportunity(safeInput);

    // 5 free screenings, lifetime, per IP (best-effort — see
    // freeChecks.ts). This only decides how rich the preview is — the
    // richer 'standard' tier while free screenings remain, the smaller
    // but still genuinely useful 'limited' tier once they're used up.
    // Neither tier ever includes the full report; that only ever comes
    // from /api/unlock after a verified payment.
    const freeCheck = consumeFreeCheck(ip);
    const tier: PreviewTier = freeCheck.withinFreeTrial ? 'standard' : 'limited';
    const publicResult = toPublicResult(fullResult, tier);

    const response: AnalyzeResponse = {
      publicResult,
      freeChecksRemaining: freeCheck.remaining,
    };

    return json(response);
  } catch (err) {
    console.error('analyze error', err);
    return json({ error: 'Analysis failed' }, 500);
  }
};