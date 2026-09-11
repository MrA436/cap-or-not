export interface DomainAgeResult {
  status: 'known' | 'unable_to_verify';
  ageDays: number | null;
  registeredDate: string | null;
}

// Best-effort in-memory caches. Serverless functions are stateless between
// cold starts, so this only helps on a warm instance — not a real
// distributed cache. Good enough for now; Vercel KV/Redis is a later,
// only-if-needed step per the checklist's own build-order rule.
const domainCache = new Map<string, { result: DomainAgeResult; expires: number }>();
const DOMAIN_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

// The IANA bootstrap file itself changes rarely, so it gets a much longer
// cache than individual domain lookups.
let bootstrapCache: { services: Array<[string[], string[]]>; expires: number } | null = null;
const BOOTSTRAP_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

const REQUEST_HEADERS = {
  Accept: 'application/rdap+json',
  // A real UA matters — some RDAP-adjacent services bot-block requests
  // with no/generic User-Agent headers.
  'User-Agent': 'CapOrNot/1.0 (+https://capornot.com) domain-age-check',
};

function cleanDomain(raw: string): string | null {
  let d = raw.trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^https?:\/\//, '');
  d = d.split('/')[0];
  d = d.replace(/^www\./, '');
  d = d.split(':')[0];
  return d || null;
}

function getTld(domain: string): string | null {
  const parts = domain.split('.');
  if (parts.length < 2) return null;
  return parts[parts.length - 1];
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, headers: REQUEST_HEADERS });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetches and caches IANA's RDAP bootstrap registry for domain names
 * (RFC 7484 / RFC 9224 format): { services: [[tlds...], [baseUrls...]], ... }
 * This is the official mechanism for finding which registry's RDAP server
 * is authoritative for a given TLD — no third-party redirector involved.
 */
async function getBootstrapServices(): Promise<Array<[string[], string[]]> | null> {
  if (bootstrapCache && bootstrapCache.expires > Date.now()) return bootstrapCache.services;

  try {
    const res = await fetchWithTimeout('https://data.iana.org/rdap/dns.json', 5000);
    if (!res.ok) {
      console.warn('[rdap] bootstrap fetch non-ok, status:', res.status);
      return null;
    }
    const data = await res.json();
    const services = Array.isArray(data?.services) ? data.services : null;
    if (!services) {
      console.warn('[rdap] bootstrap response missing services array');
      return null;
    }
    bootstrapCache = { services, expires: Date.now() + BOOTSTRAP_CACHE_TTL_MS };
    return services;
  } catch (err) {
    console.error('[rdap] bootstrap fetch threw:', err instanceof Error ? err.message : err);
    return null;
  }
}

function findRdapBaseUrl(services: Array<[string[], string[]]>, tld: string): string | null {
  for (const [tlds, urls] of services) {
    if (tlds.some((t) => t.toLowerCase() === tld) && urls.length > 0) {
      return urls[0];
    }
  }
  return null;
}

function parseRegistrationEvent(data: unknown): string | null {
  const events: Array<{ eventAction?: string; eventDate?: string }> =
    Array.isArray((data as { events?: unknown })?.events) ? (data as { events: typeof events }).events : [];
  const registration = events.find((e) => e.eventAction === 'registration');
  return registration?.eventDate ?? null;
}

function daysSince(isoDate: string): number | null {
  const ms = new Date(isoDate).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / (1000 * 60 * 60 * 24)));
}

/**
 * Looks up a domain's registration date via RDAP and returns its age in
 * days. Primary path: resolve the authoritative registry via IANA's own
 * bootstrap file (RFC 7484) and query it directly — e.g. .com domains go
 * straight to Verisign's RDAP server. Falls back to rdap.org (a community
 * bootstrap redirector) only if the direct path fails for any reason.
 *
 * Never throws. Any failure (domain not found, registry timeout, privacy/
 * redacted registration, unsupported TLD) resolves to 'unable_to_verify' —
 * this is folded into "verification confidence," not treated as a red
 * flag. A domain we can't check is not evidence of anything.
 */
export async function lookupDomainAge(rawDomain: string): Promise<DomainAgeResult> {
  const domain = cleanDomain(rawDomain);
  const unableToVerify: DomainAgeResult = { status: 'unable_to_verify', ageDays: null, registeredDate: null };
  if (!domain) {
    console.warn('[rdap] no domain after cleaning, raw input was:', JSON.stringify(rawDomain));
    return unableToVerify;
  }

  const cached = domainCache.get(domain);
  if (cached && cached.expires > Date.now()) {
    console.log('[rdap] cache hit for', domain, cached.result);
    return cached.result;
  }

  const remember = (result: DomainAgeResult) => {
    domainCache.set(domain, { result, expires: Date.now() + DOMAIN_CACHE_TTL_MS });
    return result;
  };

  // --- Primary path: IANA bootstrap -> direct registry query ---
  const tld = getTld(domain);
  if (tld) {
    const services = await getBootstrapServices();
    const baseUrl = services ? findRdapBaseUrl(services, tld) : null;

    if (baseUrl) {
      try {
        const url = `${baseUrl.replace(/\/$/, '')}/domain/${encodeURIComponent(domain)}`;
        console.log('[rdap] fetching (direct registry):', url);
        const res = await fetchWithTimeout(url, 6000);

        if (res.ok) {
          const data = await res.json();
          const eventDate = parseRegistrationEvent(data);
          if (eventDate) {
            const ageDays = daysSince(eventDate);
            if (ageDays !== null) {
              console.log('[rdap] success (direct registry) for', domain, '- age days:', ageDays);
              return remember({ status: 'known', ageDays, registeredDate: eventDate });
            }
          }
          console.warn('[rdap] direct registry response had no usable registration event for', domain);
        } else {
          const body = await res.text().catch(() => '');
          console.warn('[rdap] direct registry non-ok for', domain, 'status:', res.status, 'body:', body.slice(0, 300));
        }
      } catch (err) {
        console.error('[rdap] direct registry threw for', domain, ':', err instanceof Error ? err.message : err);
      }
    } else {
      console.warn('[rdap] no bootstrap entry found for TLD:', tld);
    }
  }

  // --- Fallback: rdap.org community bootstrap redirector ---
  try {
    const url = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
    console.log('[rdap] fetching (fallback rdap.org):', url);
    const res = await fetchWithTimeout(url, 5000);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[rdap] fallback non-ok for', domain, 'status:', res.status, 'body:', body.slice(0, 300));
      return remember(unableToVerify);
    }

    const data = await res.json();
    const eventDate = parseRegistrationEvent(data);
    if (!eventDate) {
      console.warn('[rdap] fallback had no registration event for', domain);
      return remember(unableToVerify);
    }

    const ageDays = daysSince(eventDate);
    if (ageDays === null) {
      console.warn('[rdap] fallback unparseable eventDate for', domain, ':', eventDate);
      return remember(unableToVerify);
    }

    console.log('[rdap] success (fallback) for', domain, '- age days:', ageDays);
    return remember({ status: 'known', ageDays, registeredDate: eventDate });
  } catch (err) {
    console.error('[rdap] fallback threw for', domain, ':', err instanceof Error ? err.message : err);
    return remember(unableToVerify);
  }
}