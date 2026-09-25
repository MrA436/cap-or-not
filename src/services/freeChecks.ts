// Lifetime (not monthly) free-screening allowance: the first
// FREE_CHECK_LIMIT screenings from a given IP get the richer 'standard'
// preview tier (see PreviewTier in types/analysis.ts). After that, every
// screening still works — it just falls back to the smaller 'limited'
// preview tier. Neither tier ever includes the full report; the full
// report only ever comes from /api/unlock after a verified payment. This
// module only decides which preview tier a screening gets — it has no
// say over report access.
//
// Same tradeoff as rateLimit.ts: this is an in-memory, per-function-
// instance Map, not a real database. It genuinely stops the common case
// (a person using the tool a handful of times from one browser/network)
// but resets on a cold start and isn't shared across warm instances, so a
// motivated person can get more than 5 by waiting or switching networks.
// That's an accepted, deliberate tradeoff for the MVP — see the product
// notes this was scoped against — not an oversight. Upgrade to a real
// store (Netlify Blobs, Upstash Redis, etc.) if abuse becomes a real
// problem; don't advertise this as a hard limit until then.
const FREE_CHECK_LIMIT = 5;

const freeCheckCounts = new Map<string, number>();

export interface FreeCheckResult {
  /** True if this screening still falls within the 5 lifetime free ones. */
  withinFreeTrial: boolean;
  remaining: number;
}

/** Call once per completed analysis. Consumes one credit if any remain. */
export function consumeFreeCheck(ip: string): FreeCheckResult {
  const used = freeCheckCounts.get(ip) ?? 0;
  if (used >= FREE_CHECK_LIMIT) {
    return { withinFreeTrial: false, remaining: 0 };
  }
  freeCheckCounts.set(ip, used + 1);
  return { withinFreeTrial: true, remaining: FREE_CHECK_LIMIT - (used + 1) };
}

/** Read-only peek, e.g. for showing "N free checks left" before submitting. */
export function getFreeChecksRemaining(ip: string): number {
  const used = freeCheckCounts.get(ip) ?? 0;
  return Math.max(0, FREE_CHECK_LIMIT - used);
}

export { FREE_CHECK_LIMIT };