interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory, per-function-instance. Netlify Functions run on Lambda, which
// stays warm between requests for a while, so this genuinely throttles a
// burst of rapid requests from the same source — it just doesn't persist
// across cold starts or share state between multiple warm instances. Same
// "best-effort, not a distributed system" tradeoff as the RDAP cache.
// Good enough to stop casual abuse of a micro tool; a real attacker with
// many IPs would need a proper distributed limiter (Netlify Rate Limiting,
// Upstash Redis, etc.) — worth upgrading only if this stops being enough.
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
 * Netlify forwards the real client IP through these headers. Falls back
 * to a constant if neither is present (e.g. some local/dev invocations),
 * which just means everyone shares one bucket in that edge case rather
 * than the limiter throwing.
 */
export function getClientIp(req: Request): string {
  const nfIp = req.headers.get('x-nf-client-connection-ip');
  if (nfIp) return nfIp;
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'unknown';
}