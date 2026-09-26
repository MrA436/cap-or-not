import { toPublicResult } from '../../src/services/analyzer.js';
import type { AnalyzeResponse, AnalysisResult, OpportunityInput } from '../../src/types/analysis.js';
import { checkRateLimit, getClientIp } from '../../src/services/rateLimit.js';
import { readUserIdCookie } from './_lib/identity.js';
import { getReport, getFreeChecksRemaining } from './_lib/store.js';

const json = (data: unknown, status = 200, extraHeaders?: Record<string, string>) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });

export interface GetReportResponse extends AnalyzeResponse {
  input: OpportunityInput;
  fullResult: AnalysisResult | null;
}

// This is what makes "leave the site and come back later" work: the
// browser doesn't need sessionStorage to still have anything — it just
// re-asks the server for this report id, and the server decides what to
// send back based on who's asking (identity cookie) and whether it's
// paid, both stored in Postgres. A report belonging to a different user
// than the one asking is treated exactly like a nonexistent one — same
// response either way — so this endpoint can't be used to find out
// whether some other report id exists, let alone read anything about it.
export default async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const ip = getClientIp(req);
  const rateLimit = checkRateLimit(`report:${ip}`, 30, 60_000); // 30/minute/IP
  if (!rateLimit.allowed) {
    return json(
      { error: 'Too many requests. Please wait a moment and try again.' },
      429,
      rateLimit.retryAfterSeconds ? { 'Retry-After': String(rateLimit.retryAfterSeconds) } : undefined,
    );
  }

  const id = new URL(req.url).searchParams.get('id');
  if (!id) {
    return json({ error: 'Missing id' }, 400);
  }

  const userId = readUserIdCookie(req);

  try {
    const report = userId ? await getReport(id) : null;
    if (!report || report.userId !== userId) {
      return json({ error: 'Report not found' }, 404);
    }

    const freeChecksRemaining = await getFreeChecksRemaining(userId as string);
    const publicResult = toPublicResult(report.fullResult, report.previewTier);

    const response: GetReportResponse = {
      publicResult,
      freeChecksRemaining,
      input: report.input,
      fullResult: report.paid ? report.fullResult : null,
    };

    return json(response);
  } catch (err) {
    console.error('report error', err);
    return json({ error: 'Could not load report' }, 500);
  }
};