import { toPublicResult } from '../../src/services/analyzer.js';
import type { AnalyzeResponse, AnalysisResult, OpportunityInput } from '../../src/types/analysis.js';
import { checkRateLimit, getClientIp } from '../../src/services/rateLimit.js';
import { readUserIdCookie } from '../_lib/identity.js';
import { openDbClient } from '../_lib/db.js';
import { getReport, getFreeChecksRemaining } from '../_lib/store.js';
import type { Env } from '../_lib/types.js';

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
export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(`report:${ip}`, 30, 60_000); // 30/minute/IP
  if (!rateLimit.allowed) {
    return json(
      { error: 'Too many requests. Please wait a moment and try again.' },
      429,
      rateLimit.retryAfterSeconds ? { 'Retry-After': String(rateLimit.retryAfterSeconds) } : undefined,
    );
  }

  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return json({ error: 'Missing id' }, 400);
  }

  const userId = readUserIdCookie(request);

  const client = openDbClient(env.HYPERDRIVE);
  await client.connect();

  try {
    const report = userId ? await getReport(client, id) : null;
    if (!report || report.userId !== userId) {
      return json({ error: 'Report not found' }, 404);
    }

    const freeChecksRemaining = await getFreeChecksRemaining(client, userId as string);
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
  } finally {
    waitUntil(client.end());
  }
};