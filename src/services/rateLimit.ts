interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory, per-isolate. Cloudflare Workers isolates stay warm between
// requests for a while, so this genuinely throttles a burst of rapid
// requests from the same source — it just doesn't persist across a cold
// start or share state between multiple concurrent isolates. Same
// "best-effort, not a distributed system" tradeoff as the RDAP cache.
// Good enough to stop casual abuse of a micro tool; a real attacker with
// many IPs would need a proper distributed limiter (Cloudflare Rate
// Limiting rules, Durable Objects, Upstash Redis, etc.) — worth
// upgrading only if this stops being enough.
const buckets = new Map<string, RateLimitEntry>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export function checkRateLimit(key: string, maxRequests: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count += 1;
  return { allowed: true };
}

/**
 * Cloudflare sets CF-Connecting-IP on every request at its edge — this is
 * the reliable one, not spoofable by the client (Cloudflare overwrites
 * it). Falls back to x-forwarded-for, then a constant, for local dev
 * (`wrangler pages dev`) where CF-Connecting-IP isn't set — that just
 * means everyone shares one bucket in that case rather than the limiter
 * throwing.
 */
export function getClientIp(req: Request): string {
  const cfIp = req.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp;
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'unknown';
}