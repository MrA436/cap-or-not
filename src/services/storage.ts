import type { PublicAnalysisResult, AnalysisResult, OpportunityInput } from '@/types/analysis';

const CHECKS_KEY = 'capornot_checks';
const MAX_STORED = 20;

interface StoredCheck {
  publicResult: PublicAnalysisResult;
  input: OpportunityInput;
  fullResult: AnalysisResult | null;
  // How many of the 5 lifetime free checks were left *after* this one, per
  // /api/analyze's response. Undefined for checks saved before this field
  // existed — treat that the same as "unknown", not "zero".
  freeChecksRemaining?: number;
}

/**
 * Only the PUBLIC (free-tier) result and the original input are ever
 * stored here — never the full analysis, until a real payment is
 * verified and cacheFullResult() below is called.
 *
 * This is a same-tab, same-session convenience cache ONLY — it's what
 * lets CheckPage -> ResultPage navigate instantly without a network
 * round trip. It is NOT how "leave and come back later" persistence
 * works; sessionStorage is cleared when the browser/tab closes. That
 * persistence is server-side (Postgres, keyed by the identity cookie —
 * see netlify/functions/_lib/store.ts) and ResultPage always re-asks the
 * server for the authoritative version regardless of what's cached here.
 */
export function saveCheck(publicResult: PublicAnalysisResult, input: OpportunityInput, freeChecksRemaining?: number): void {
  try {
    const raw = sessionStorage.getItem(CHECKS_KEY);
    const all: StoredCheck[] = raw ? JSON.parse(raw) : [];
    all.unshift({ publicResult, input, fullResult: null, freeChecksRemaining });
    sessionStorage.setItem(CHECKS_KEY, JSON.stringify(all.slice(0, MAX_STORED)));
  } catch {
    // storage unavailable — ResultPage's server fetch still works fine
    // without this; it's a pure latency optimization, not a dependency.
  }
}

export function getCheck(id: string): StoredCheck | null {
  try {
    const raw = sessionStorage.getItem(CHECKS_KEY);
    if (!raw) return null;
    const all: StoredCheck[] = JSON.parse(raw);
    return all.find((c) => c.publicResult.id === id) ?? null;
  } catch {
    return null;
  }
}

// Called once /api/unlock has verified a real Razorpay payment and
// returned the full analysis. Cached locally so re-visiting the same
// /result/:id in this session doesn't need to pay again or re-verify.
export function cacheFullResult(id: string, fullResult: AnalysisResult): void {
  try {
    const raw = sessionStorage.getItem(CHECKS_KEY);
    if (!raw) return;
    const all: StoredCheck[] = JSON.parse(raw);
    const updated = all.map((c) => (c.publicResult.id === id ? { ...c, fullResult } : c));
    sessionStorage.setItem(CHECKS_KEY, JSON.stringify(updated));
  } catch {
    // non-fatal — the unlocked view still works for the current page load
  }
}