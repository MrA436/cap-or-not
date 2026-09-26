import { analyzeOpportunity, toPublicResult } from '../../src/services/analyzer.js';
import type { OpportunityInput, AnalyzeResponse, PreviewTier } from '../../src/types/analysis.js';
import { checkRateLimit, getClientIp } from '../../src/services/rateLimit.js';
import { resolveUserId, userIdSetCookieHeader } from './_lib/identity.js';
import { ensureUser, consumeFreeCheck, saveReport } from './_lib/store.js';

const json = (data: unknown, status = 200, extraHeaders?: Record<string, string>) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });

// This is the ONLY place the full analysis is computed for a fresh check.
// The full result never leaves this function, free screening or not —
// only toPublicResult()'s preview output is sent back. It's persisted to
// Postgres (see _lib/store.ts) so the same report can be reopened, and so
// unlock.ts can hand back the exact thing that was previewed instead of
// trusting a client-resent copy of the input. The full result is only
// ever sent to the browser from report.ts/unlock.ts, and only once
// reports.paid is true for that report.
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

    // Persistent anonymous identity — a server-issued, HttpOnly cookie,
    // not anything the frontend can read or set (see _lib/identity.ts).
    // This is what lets someone leave and come back later to the same
    // report/free-check allowance, on this browser, without an account.
    const { userId } = resolveUserId(req);
    await ensureUser(userId);

    const fullResult = await analyzeOpportunity(safeInput);

    // 5 free screenings, lifetime, per persistent user id (not per IP —
    // see _lib/store.ts). This only decides how rich the preview is —
    // the richer 'standard' tier while free screenings remain, the
    // smaller but still genuinely useful 'limited' tier once they're
    // used up. Neither tier ever includes the full report; that only
    // ever comes from /api/report or /api/unlock once reports.paid is
    // true for this specific report.
    const freeCheck = await consumeFreeCheck(userId);
    const tier: PreviewTier = freeCheck.withinFreeTrial ? 'standard' : 'limited';
    const publicResult = toPublicResult(fullResult, tier);

    await saveReport({
      id: publicResult.id,
      userId,
      input: safeInput,
      fullResult,
      previewTier: tier,
    });

    const response: AnalyzeResponse = {
      publicResult,
      freeChecksRemaining: freeCheck.remaining,
    };

    // Always resent, even for a returning cookie, to refresh its 2-year
    // expiry on every visit.
    return json(response, 200, { 'Set-Cookie': userIdSetCookieHeader(userId) });
  } catch (err) {
    console.error('analyze error', err);
    return json({ error: 'Analysis failed' }, 500);
  }
};