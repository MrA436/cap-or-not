import { randomUUID } from 'node:crypto';

// This is the primary identity mechanism for "the same user, returning
// later": a random id, set as a cookie the first time someone hits
// /api/analyze, that the server (not the browser) decides. The frontend
// never reads or sets it directly — see Report.tsx/UnlockGate.tsx, which
// never touch cookies at all, only call /api/* and let the browser carry
// whatever cookie it already has.
const COOKIE_NAME = 'co_uid';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2; // 2 years
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads the anonymous identity cookie from an incoming request, if
 * present and well-formed. A malformed/forged value (anything not
 * shaped like a UUID we would have issued) is treated as absent rather
 * than trusted — callers should fall back to newUserId().
 */
export function readUserIdCookie(req: Request): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  const match = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  const value = match.slice(COOKIE_NAME.length + 1);
  return UUID_RE.test(value) ? value : null;
}

export function newUserId(): string {
  return randomUUID();
}

/**
 * Set-Cookie value for the anonymous identity cookie.
 *  - HttpOnly: frontend JavaScript can neither read nor forge it — the
 *    thing item 5 asked for ("do not rely on frontend state").
 *  - Secure: HTTPS only. Modern browsers (Chrome, Firefox, Safari) special-
 *    case http://localhost as "potentially trustworthy" so this still
 *    works for local `netlify dev` — if you test over a plain-HTTP LAN
 *    IP instead of localhost, the cookie won't be set; use `netlify dev`
 *    on localhost or a real HTTPS deploy preview for that case.
 *  - SameSite=Lax: sent on normal top-level navigation (e.g. returning
 *    from Razorpay Checkout) but withheld from cross-site requests
 *    forged from another site — the standard balance for this kind of
 *    "remember this browser" cookie.
 *  - Path=/: shared by the whole site, since both the app and every
 *    /api/* function need to see the same identity.
 */
export function userIdSetCookieHeader(userId: string): string {
  return `${COOKIE_NAME}=${userId}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

/** Reads the existing identity cookie, or mints a new id if there isn't one. */
export function resolveUserId(req: Request): { userId: string; isNew: boolean } {
  const existing = readUserIdCookie(req);
  if (existing) return { userId: existing, isNew: false };
  return { userId: newUserId(), isNew: true };
}