export interface WebsiteReachabilityResult {
  status: 'reachable' | 'unreachable' | 'unable_to_verify';
  httpStatus?: number;
}

function normalizeUrl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl.trim().startsWith('http') ? rawUrl.trim() : `https://${rawUrl.trim()}`);
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Actually visits the claimed company website, server-side, to check
 * whether anything real is running there — this is the gap RDAP doesn't
 * cover (RDAP only confirms domain *registration*, not that a live site
 * exists). A domain can be registered, or even genuinely old, and still
 * serve nothing.
 *
 * Any real HTTP response — even a 403 or 500 — counts as "reachable",
 * because it proves DNS resolved and a server answered. Only an outright
 * connection failure (DNS doesn't resolve, connection refused, timeout)
 * counts as "unreachable". This matters because some legitimate sites
 * block non-browser requests with bot protection that returns a 403 —
 * that's still a real server responding, not evidence of a fake site.
 */
export async function checkWebsiteReachable(rawUrl: string): Promise<WebsiteReachabilityResult> {
  const url = normalizeUrl(rawUrl);
  if (!url) return { status: 'unable_to_verify' };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'CapOrNot/1.0 (+https://capornot.com) website-check' },
    });
    clearTimeout(timeoutId);

    return { status: 'reachable', httpStatus: res.status };
  } catch (err) {
    console.warn('[websiteCheck] unreachable:', url, err instanceof Error ? err.message : err);
    return { status: 'unreachable' };
  }
}