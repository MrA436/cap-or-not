export interface DomainAgeResult {
  status: 'known' | 'unable_to_verify';
  ageDays: number | null;
  registeredDate: string | null;
}

// Best-effort in-memory cache. Serverless functions are stateless between
// cold starts, so this only helps on a warm instance — it's not a real
// distributed cache. Good enough for now; upgrading to Vercel KV/Redis is
// a later, only-if-needed step per the checklist's own build-order rule.
const cache = new Map<string, { result: DomainAgeResult; expires: number }>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

function cleanDomain(raw: string): string | null {
  let d = raw.trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^https?:\/\//, '');
  d = d.split('/')[0];
  d = d.replace(/^www\./, '');
  d = d.split(':')[0];
  return d || null;
}

/**
 * Looks up a domain's registration date via RDAP and returns its age in
 * days. Uses rdap.org as a bootstrap redirector so we don't have to
 * implement IANA's per-TLD RDAP server resolution ourselves — it forwards
 * the request to whichever registry actually holds the record.
 *
 * Never throws. Any failure (domain not found, registry timeout, privacy/
 * redacted registration, unsupported TLD) resolves to 'unable_to_verify' —
 * this is a signal to fold into "verification confidence," not a red flag
 * on its own. A domain we can't check is not evidence of anything.
 */
export async function lookupDomainAge(rawDomain: string): Promise<DomainAgeResult> {
  const domain = cleanDomain(rawDomain);
  const unableToVerify: DomainAgeResult = { status: 'unable_to_verify', ageDays: null, registeredDate: null };
  if (!domain) return unableToVerify;

  const cached = cache.get(domain);
  if (cached && cached.expires > Date.now()) return cached.result;

  const remember = (result: DomainAgeResult) => {
    cache.set(domain, { result, expires: Date.now() + CACHE_TTL_MS });
    return result;
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/rdap+json' },
    });
    clearTimeout(timeoutId);

    if (!res.ok) return remember(unableToVerify);

    const data = await res.json();
    const events: Array<{ eventAction?: string; eventDate?: string }> = Array.isArray(data?.events) ? data.events : [];
    const registration = events.find((e) => e.eventAction === 'registration');

    if (!registration?.eventDate) return remember(unableToVerify);

    const registeredMs = new Date(registration.eventDate).getTime();
    if (Number.isNaN(registeredMs)) return remember(unableToVerify);

    const ageDays = Math.max(0, Math.floor((Date.now() - registeredMs) / (1000 * 60 * 60 * 24)));

    return remember({ status: 'known', ageDays, registeredDate: registration.eventDate });
  } catch {
    // Network error, timeout, malformed JSON, etc. — treat as unknown,
    // never as a warning sign.
    return unableToVerify;
  }
}