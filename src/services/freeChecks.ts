// Lifetime (not monthly) free-check allowance: the first FREE_CHECK_LIMIT
// checks from a given IP get the full report automatically, no payment
// step. After that, /api/analyze falls back to the normal preview +
// pay-to-unlock flow.
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
  granted: boolean;
  remaining: number;
}

/** Call once per completed analysis. Consumes one credit if any remain. */
export function consumeFreeCheck(ip: string): FreeCheckResult {
  const used = freeCheckCounts.get(ip) ?? 0;
  if (used >= FREE_CHECK_LIMIT) {
    return { granted: false, remaining: 0 };
  }
  freeCheckCounts.set(ip, used + 1);
  return { granted: true, remaining: FREE_CHECK_LIMIT - (used + 1) };
}

/** Read-only peek, e.g. for showing "N free checks left" before submitting. */
export function getFreeChecksRemaining(ip: string): number {
  const used = freeCheckCounts.get(ip) ?? 0;
  return Math.max(0, FREE_CHECK_LIMIT - used);
}

export { FREE_CHECK_LIMIT };