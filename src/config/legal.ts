/**
 * One place for every fact the legal pages state. Edit THIS file, nothing else:
 * Terms, Privacy, Refund and Contact all read it.
 *
 * The only value with no safe default is your support email, because the pages
 * must tell people how to reach you. The production build refuses to run until
 * it is filled in (see scripts/prerender.mjs). To build anyway while testing:
 * set ALLOW_LEGAL_PLACEHOLDERS=1.
 */
export const LEGAL = {
  siteName: 'Cap or Not',
  siteUrl: 'https://capornot.com',

  // ── FILL THIS IN ───────────────────────────────────────────────────────
  /** A mailbox you actually read: support, refunds, privacy and deletion requests go here. */
  contactEmail: 'akshatdeoli5@gmail.com',

  // ── OPTIONAL ───────────────────────────────────────────────────────────
  /** Leave empty to stay as "Cap or Not". If you add a name, it appears as "operated by …". */
  operatorName: '',

  // ── BUSINESS RULES (keep in step with the code; scripts/check-legal.mts verifies) ──
  /** Must equal REPORT_PRICE_PAISE / 100 in functions/api/create-order.ts. */
  reportPrice: '₹199',
  /** Must equal FREE_CHECK_LIMIT in functions/_lib/store.ts. */
  freeChecksPerVisitor: 5,
  supportResponseTime: '3 business days',
  /** How long after payment a refund request is accepted. YOUR decision. */
  refundRequestWindowDays: 7,
  refundProcessingTime: '5 to 7 business days',
  effectiveDate: '30 October 2026',
} as const;

const PLACEHOLDER = /^REPLACE_/;

/** Names of required fields that still hold a placeholder. Empty = ready to ship. */
export function unfilledLegalFields(): string[] {
  const required = ['contactEmail'] as const;
  return required.filter((k) => PLACEHOLDER.test(LEGAL[k]));
}