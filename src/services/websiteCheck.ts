export interface WebsiteReachabilityResult {
  /**
   * 'reachable'        a real server answered (any HTTP status).
   * 'unreachable'      the name DOES NOT RESOLVE (a resolver "not found" error) AND a
   *                    control probe proved this observer's own DNS/network works.
   *                    The only failure that is evidence about the domain.
   * 'unable_to_verify' everything else: timeouts, TLS errors, refused connections,
   *                    anti-bot blocks, a malformed URL, or an observer that could not
   *                    see the network at all. These say nothing about the site.
   */
  status: 'reachable' | 'unreachable' | 'unable_to_verify';
  httpStatus?: number;
  reason?: 'dns_not_found' | 'timeout' | 'tls' | 'refused' | 'no_control' | 'malformed_url' | 'other';
}

function normalizeUrl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl.trim().startsWith('http') ? rawUrl.trim() : `https://${rawUrl.trim()}`);
    return u.toString();
  } catch {
    return null;
  }
}

type FailureReason = NonNullable<WebsiteReachabilityResult['reason']>;

function classifyFailure(err: unknown): FailureReason {
  const e = err as { name?: string; code?: string; message?: string; cause?: { code?: string; message?: string } } | null;
  const codes = [e?.code, e?.cause?.code].filter(Boolean) as string[];
  const msg = `${e?.message ?? ''} ${e?.cause?.message ?? ''}`;
  if (e?.name === 'AbortError' || /abort|timeout|timed out/i.test(msg)) return 'timeout';
  if (codes.some((c) => c === 'ENOTFOUND' || c === 'EAI_NONAME')
    || /ENOTFOUND|EAI_NONAME|could not resolve host|name not resolved|no such host|nxdomain|dns lookup failed|failed to resolve/i.test(msg)) return 'dns_not_found';
  if (codes.includes('ECONNREFUSED')) return 'refused';
  if (/cert|ssl|tls/i.test(msg) || codes.some((c) => /CERT|SSL|TLS/i.test(c))) return 'tls';
  return 'other';
}

// A host that must resolve and answer from any working network.
const CONTROL_URL = 'https://www.cloudflare.com/cdn-cgi/trace';

/** Can THIS observer resolve names and reach the internet at all? */
async function observerCanSeeTheNetwork(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(CONTROL_URL, { method: 'GET', signal: controller.signal });
    clearTimeout(timeoutId);
    // A proxy / captive portal / egress filter also "answers". Only the control
    // host's own response (200 with its trace body) proves the network works.
    return res.ok && /(^|\n)ip=/.test(await res.text());
  } catch {
    return false;
  }
}

/**
 * Visits the claimed company website, server-side, and reports what was
 * actually observed.
 *
 * A negative result from a single GET is weak evidence: sites block datacenter
 * IPs, time out, serve broken TLS to non-browsers, and a sandboxed or offline
 * observer fails every request. So only ONE failure counts as "unreachable":
 * the resolver says the name does not exist, and a control probe confirms this
 * observer's DNS works. Everything else is 'unable_to_verify' with a reason.
 *
 * Any real HTTP response — even a 403 or 500 — counts as "reachable", because
 * it proves DNS resolved and a server answered.
 */
export async function checkWebsiteReachable(rawUrl: string): Promise<WebsiteReachabilityResult> {
  const url = normalizeUrl(rawUrl);
  if (!url) return { status: 'unable_to_verify', reason: 'malformed_url' };

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
    const reason = classifyFailure(err);
    console.warn('[websiteCheck] fetch failed:', url, reason, err instanceof Error ? err.message : err);
    if (reason !== 'dns_not_found') return { status: 'unable_to_verify', reason };
    // A "name not found" only means something if this observer could resolve names at all.
    if (!(await observerCanSeeTheNetwork())) return { status: 'unable_to_verify', reason: 'no_control' };
    return { status: 'unreachable', reason: 'dns_not_found' };
  }
}