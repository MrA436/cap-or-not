# CAPORNOT MASTER CHECKLIST

> Source of truth for Capornot's current build, testing, launch, and validation work.
>
> Rule: Do not mark a task `[x]` unless it has actually been implemented AND tested.

---

# 0. PRODUCT SCOPE

## Current offer

- [ ] Free screening gives a useful limited preview
- [x] Full verification report is locked from the first screening *(functions/api/analyze.ts: `fullResult` is never returned to the browser; only `toPublicResult()`'s preview. The full result only ever leaves the server from report.ts/unlock.ts, gated on `reports.paid = true`)*
- [x] User gets 5 free screening previews *(`FREE_CHECK_LIMIT = 5` in functions/_lib/store.ts, enforced by an atomic Postgres UPDATE, not client state)*
- [x] After 5 free screenings, user can still run a limited preview *(`tier = freeCheck.withinFreeTrial ? 'standard' : 'limited'` in analyze.ts — screening itself never blocks, only the preview richness changes)*
- [x] ₹199 unlocks ONE full verification report *(create-order.ts: `REPORT_PRICE_PAISE = 19900`, server-side constant; confirmed final pricing, ₹149 draft dropped)*
- [x] ₹199 does NOT unlock unlimited future reports *(payments table has one row per report via `report_id`; unlock.ts only ever marks the ONE report tied to the verified order as paid)*
- [x] Purchased reports remain accessible permanently *(`reports.paid` is a permanent DB flag, no expiry logic anywhere; report.ts serves it indefinitely)*
- [ ] No fake countdowns or artificial urgency *(not independently checked this pass — would need a full UI/copy read)*
- [ ] Product language avoids definitive "SCAM / NOT SCAM" claims *(not independently checked this pass — would need a full copy read across Report.tsx/seoContent.ts)*
- [x] Risk and verification confidence are treated separately *(`riskScore`/`riskLevel` vs. `verificationGaps`/`opportunityQuality` are structurally separate fields throughout — confirmed in src/types/analysis.ts and how Report.tsx renders them in separate sections)*

## Explicitly NOT building yet

- [ ] AI chatbot
- [ ] Mobile app
- [ ] Huge company database
- [ ] Browser extension
- [ ] Recruiter monitoring
- [ ] Subscription system
- [ ] 5-report bundle
- [ ] Unlimited plan
- [ ] Large-scale SEO page generation
- [ ] Major redesign

---

# 1. USER IDENTITY & PERSISTENCE

## Anonymous user identity

- [x] Generate a persistent anonymous user ID on first visit *(`newUserId()` in functions/_lib/identity.ts, uses `crypto.randomUUID()`, called via `resolveUserId()` whenever no valid cookie is present)*
- [x] Store user ID in a Secure, HttpOnly cookie *(`userIdSetCookieHeader()`: `HttpOnly; Secure; SameSite=Lax`)*
- [x] Use appropriate SameSite setting *(`SameSite=Lax` — survives top-level navigation back from Razorpay Checkout, withheld from cross-site forged requests)*
- [x] Ensure cookie is secure in production *(`Secure` flag set; code comment notes the one caveat — `http://localhost` is browser-whitelisted as "potentially trustworthy" so local dev still works, but a plain-HTTP LAN IP would not set the cookie)*
- [x] Restore the same user after refresh *(`readUserIdCookie()` parses and validates the cookie against a UUID shape on every request; a malformed/forged value is treated as absent rather than trusted)*
- [x] Restore the same user after closing/reopening browser *(`MAX_AGE_SECONDS` = 2 years; re-sent with a fresh expiry on every analyze call)*
- [x] Test that frontend JavaScript cannot directly modify the identity cookie *(HttpOnly makes this a browser-enforced guarantee, not just a design intent; additionally confirmed by code inspection that no frontend file reads `document.cookie` or `localStorage` for identity — `grep -rn "localStorage" src/` returns zero matches anywhere in the app)*

## Email identity

- [ ] Capture email during purchase *(schema has an `email` column on `users`, but no code path currently writes to it — not implemented despite the column existing)*
- [ ] Associate verified email with the user account
- [ ] Do NOT treat merely typed email as proof of ownership
- [ ] Implement email verification/recovery
- [ ] Implement magic-link recovery if needed
- [ ] Test report recovery after losing the original cookie *(this entire subsection is a genuine gap — a user who loses their cookie/clears their browser has no recovery path at all right now)*

---

# 2. DATABASE

Use a proper relational database such as PostgreSQL/Supabase.

## Users

- [x] Create `users` table *(functions/_lib/schema.sql)*
- [x] Store anonymous user ID *(`id UUID PRIMARY KEY`)*
- [x] Store email when available *(column exists; see Email identity gap above — nothing writes to it yet)*
- [x] Store creation timestamp *(`created_at TIMESTAMPTZ NOT NULL DEFAULT now()`)*

## Reports

- [x] Create `reports` table
- [x] Link each report to a user *(`user_id UUID NOT NULL REFERENCES users(id)`)*
- [x] Store report ID *(`id TEXT PRIMARY KEY`, matches `AnalysisResult.id` / `crypto.randomUUID()`)*
- [x] Store report input/data needed for persistence *(`input JSONB NOT NULL`)*
- [x] Store generated report data *(`full_result JSONB NOT NULL`)*
- [x] Store creation timestamp
- [x] Store payment/unlock status *(`paid BOOLEAN NOT NULL DEFAULT false`)*

## Payments

- [x] Create `payments` table
- [x] Store user ID
- [x] Store report ID
- [x] Store Razorpay order ID *(`razorpay_order_id TEXT NOT NULL UNIQUE`)*
- [x] Store Razorpay payment ID *(`razorpay_payment_id TEXT`, filled in on confirmation)*
- [x] Store amount *(`amount_paise INTEGER NOT NULL`)*
- [x] Store payment status *(`status TEXT NOT NULL DEFAULT 'created'`, transitions to `'paid'`)*
- [x] Store verification timestamp *(`verified_at TIMESTAMPTZ`, set by `markPaymentPaid`)*

## Usage

- [x] Track free screening usage server-side *(`consumeFreeCheck()` in functions/_lib/store.ts — single atomic `UPDATE ... RETURNING`, no separate read-then-write race)*
- [x] Enforce the 5-free-screening rule server-side *(same query: `WHERE id = $1 AND free_checks_used < $2`)*
- [x] Ensure localStorage cannot reset free usage *(confirmed by code inspection — no localStorage usage anywhere in src/; the only persistent counter is the Postgres `free_checks_used` column, keyed off the server-issued HttpOnly cookie)*
- [x] Ensure changing frontend state cannot unlock reports *(report.ts/unlock.ts both derive `paid`/`fullResult` entirely from the DB row looked up by server-read cookie + verified payment — nothing client-sent is trusted as an unlock signal; confirmed by reading both endpoints in full)*

---

# 3. RAZORPAY PAYMENT SYSTEM

## Order creation

- [x] Create Razorpay orders server-side *(functions/api/create-order.ts calls Razorpay's Orders API directly via `fetch`, Basic Auth with `key_id:key_secret`)*
- [x] Never create trusted payment state from the frontend *(the order amount is a server-side constant; the frontend only ever relays what `/api/create-order` returns to Razorpay Checkout)*
- [x] Keep Razorpay Key Secret server-side only *(confirmed by code read — `keySecret` is used only in the `Authorization` header sent to Razorpay, never included in the JSON response; also confirmed by a full git-history secret scan — see Security section)*

## Verification

- [x] Verify successful payment server-side *(functions/api/unlock.ts: HMAC-SHA256 of `order_id|payment_id`, keyed with the server-only secret, compared with `crypto.timingSafeEqual`)*
- [x] Verify payment belongs to the correct order *(`getPaymentByOrderId` + explicit `payment.userId !== userId` ownership check — rejects a valid signature replayed from a different browser/cookie)*
- [ ] Verify expected amount *(NOT independently re-checked against Razorpay's response. The code's own comment explains the reasoning: the order was created server-side for a fixed, unmodifiable amount, and the signature cryptographically ties the payment to that exact order, so there's no path by which the amount could differ. This is a reasoned design choice, not an oversight — but per the checklist's own literal wording, leaving unchecked since there's no explicit amount-match code path to point to.)*
- [x] Verify payment status *(`payment.status === 'paid'` idempotent early-return path; status always checked before trusting a stored record)*
- [x] Handle duplicate payment/webhook events safely *(`markPaymentPaid` is explicitly idempotent by design — a retried confirmation just re-confirms the same row; a second unlock call for an already-paid order skips re-verifying the signature and returns the same report)*
- [x] Mark report as paid only after successful verification *(`markReportPaid` is called only after `verified === true`, or after a valid test-unlock code — never unconditionally)*

**Verified this session**, independent of reading the code: `scripts/test-payment-verification.mts` reproduces the exact HMAC formula from unlock.ts and confirms — a genuine signature verifies; a signature for a different order/payment pair is rejected; a signature made with the wrong secret is rejected; garbage/empty/wrong-length signatures are rejected without throwing (confirming the length-guard before `timingSafeEqual`, which throws on mismatched lengths if unguarded). 9/9 checks pass.

## Payment testing

- [ ] Successful payment
- [ ] Failed payment
- [ ] Cancelled payment
- [ ] Refresh after payment
- [ ] Close/reopen browser after payment
- [ ] Return to previously purchased report
- [ ] Attempt to access an unpaid report
- [ ] Attempt to manipulate payment state from frontend
- [ ] Attempt to reuse a paid report unlock on another report

> None of this subsection can be verified from a static code archive — these all require a live deployment with real (or Razorpay test-mode) credentials and an actual browser session. The underlying logic for several of these (unpaid-report access, reuse-on-another-report) was verified at the code/unit level above; this subsection specifically means end-to-end manual testing, which is still genuinely pending.

---

# 4. REPORT ENGINE ARCHITECTURE

## Canonical extraction

Build ONE structured extraction object from the raw posting/input.

- [ ] Extract claimed company name *(partially — see note below)*
- [ ] Extract website URL
- [ ] Extract email addresses
- [x] Extract recruiter name *(src/services/extract.ts: deterministic labelled-line extractor, 15 cases in scripts/test-extract.mts. Fallback to src/services/llmExtract.ts when deterministic misses, verified-quote gated, 12 cases in scripts/test-llm-extract.mts)*
- [ ] Extract payment request
- [ ] Extract payment amount
- [ ] Extract compensation/stipend
- [ ] Extract interview requirement
- [ ] Extract communication channels
- [ ] Extract relevant claims
- [ ] Extract document/offer information

> Company name: extraction already existed pre-session (`inferCompanyName`/`inferCompanyNameFromWebsite`) and this session added the same LLM-fallback pattern used for recruiter name, tested via scripts/test-llm-extract.mts (tests 11–12). Not marked `[x]` above because the underlying regex extractor itself wasn't rebuilt or independently re-tested — only the fallback wiring was.

## Critical distinction

- [x] Preserve exact claimed company name *(extraction is gated on `!input.company.trim()` — if a company is typed, no extraction of any kind runs and the typed value passes through unchanged; verified in scripts/test-llm-extract.mts test 11)*
- [x] Distinguish CLAIMED from VERIFIED *(the LLM extraction's own positive-finding wording explicitly flags AI-extracted company names as unverified best-effort — "worth double-checking it matches the actual company")*
- [ ] Distinguish applicant → company payment from company → applicant compensation
- [ ] Distinguish "interview required" from "no interview required"
- [ ] Distinguish missing information from negative evidence

---

# 5. VERIFICATION CHECKS

Every check should produce one of:

`PASS / FAIL / UNKNOWN`

- [ ] Implement PASS state
- [ ] Implement FAIL state
- [ ] Implement UNKNOWN state
- [ ] UNKNOWN contributes zero risk
- [ ] UNKNOWN is shown as a verification gap where appropriate
- [ ] FAIL has traceable evidence
- [ ] PASS has traceable evidence

> Note: Report.tsx's `STATUS_STYLE` map (`suspicious / unable / partial / verified`) is structurally close to a PASS/FAIL/UNKNOWN model and renders per-topic status badges, but this is a UI-layer presentation concept, not confirmed to be backed by the literal three-state contract this section describes at the data layer. Left unchecked pending a closer read of how `CategoryAnalysis.status` values map to these four UI states.

## Email

- [ ] Extract email domain
- [x] Compare email domain with provided website domain *(4 cases in scripts/test-email-domain.mts)*
- [x] Detect public email providers *(same test file — free-provider detection re-verified as part of the Gmail-wording fix)*
- [x] Avoid claiming company identity is verified merely because domains match *(this session's fix explicitly rewrote the finding to say the recruiter's affiliation is "not yet independently verified" rather than asserting a mismatch/fraud claim — see the "Recruiter uses a free email provider" finding)*

## Website/domain

- [ ] Extract canonical domain
- [ ] Check website accessibility
- [ ] Handle unreachable websites
- [ ] Do not automatically classify unreachable as major risk
- [ ] Add RDAP/domain-age verification *(src/services/rdap.ts exists and is wired into the analyzer, but not independently re-verified this session — not re-checking something that was already working pre-session without new evidence)*
- [ ] Calculate domain age when available
- [ ] Distinguish domain evidence from company verification

## Company identity

- [ ] Compare claimed company against available domain/company evidence
- [ ] Detect obvious mismatch
- [x] Avoid domain-slug → company-name inference when explicit company name exists *(same extraction guard as above — domain-derived inference (`inferCompanyNameFromWebsite`) never runs at all when `input.company` is non-empty)*

## Hiring process

- [ ] Detect interview requirement
- [ ] Detect explicit "no interview" statements
- [ ] Handle negation correctly *(negation handling itself was extended this session — see Financial requests below — but not independently verified for the interview-detection path specifically)*
- [ ] Detect WhatsApp/Telegram recruitment
- [ ] Detect urgency language

## Financial requests

- [ ] Detect registration fees
- [ ] Detect security deposits
- [ ] Detect training fees
- [ ] Detect application fees
- [x] Detect other applicant payment requests *(sensitive-info split: government ID / bank details / photograph, each its own finding — 7 cases in scripts/test-sensitive-info.mts, including negation: "we never ask for your Aadhaar or bank details" correctly produces zero findings)*
- [ ] Do NOT flag salary/stipend as applicant payment
- [ ] Do NOT confuse compensation with a payment request

---

# 6. FINDINGS SYSTEM

Do not let individual rules directly write arbitrary report prose.

Create structured findings.

Each finding should contain:

- [x] Finding ID *(pre-existing `nextId()`, unchanged this session, exercised by every new finding added)*
- [ ] Status *(findings currently carry `severity`, not a separate PASS/FAIL/UNKNOWN-style status field — see Section 5 gap above)*
- [x] Category *(pre-existing, unchanged; this session's new findings correctly tagged `'sensitive'` and `'email'`, verified by filtering on `f.category` in tests)*
- [x] Severity *(pre-existing field; this session changed which severities specific findings carry — e.g. government ID now `critical`, photograph now `caution`, free-email now `caution` not `high` — all verified in tests)*
- [x] Evidence *(every new/changed finding populates `evidence` with the matched keyword(s) or quoted domain — checked directly in test assertions)*
- [x] Explanation *(every new/changed finding's `explanation` text was specifically reviewed and rewritten this session — e.g. the softened Gmail wording — not just present but content-checked)*
- [x] Recommended action *(present on every new/changed finding, e.g. "Verify the recruiter's affiliation through the company's official website...")*

## Categories

- [x] Payment *('Payment / Money Detection' — confirmed rendered as its own topic in Report.tsx)*
- [x] Process *('Recruitment Process' — same)*
- [x] Company *('Company Verification' — same)*
- [x] Recruiter *('Recruiter Identity' — same)*
- [x] Contact & Email *('Email / Domain Analysis' — same; also the `'email'` category touched by this session's Gmail fix)*
- [x] Claims *('Job Posting Analysis', 'Brand / Government Affiliation' — same)*
- [x] Documents *('Offer Letter Analysis', 'Sensitive Information' — same; also the `'sensitive'` category touched by this session's fix)*
- [x] Domain *(folded into the combined "Email / Domain" topic in the UI rather than a fully separate one, but the underlying category data exists)*

---

# 7. RISK SCORE

- [x] Risk score is deterministic *(`computeOverallScore` is a pure function of the findings list — no randomness; confirmed by repeatable test assertions across all test suites)*
- [x] Score consumes structured findings *(rewritten this session to sort/aggregate the actual `Finding[]` list rather than summing per-category constants)*
- [x] PASS does not create risk *(positive-severity findings explicitly filtered out before scoring — `f.severity !== 'positive'`)*
- [ ] UNKNOWN does not create risk *(verification gaps are structurally separate from findings and never enter the score, but this specific claim wasn't independently tested)*
- [x] FAIL creates risk according to defined severity *(`SEVERITY_BASE_SCORE` / `SEVERITY_UPLIFT` tables, tested in scripts/test-scoring.mts)*
- [x] Correlated findings are not double-counted *(this session's core scoring fix — corroboration capped at +25 regardless of how many weak/correlated signals pile up; also fixed the literal double-count bug in the old Gmail finding. Tested in scripts/test-scoring.mts and scripts/test-email-domain.mts)*
- [x] Payment request and payment amount are not counted as two independent major risks *(covered by the same corroboration-cap mechanism — a second finding of any severity now contributes a small, capped amount rather than its full independent weight)*
- [x] Score has documented weighting *(`SEVERITY_BASE_SCORE`, `SEVERITY_UPLIFT`, `CORROBORATION_CAP` constants with inline rationale in src/services/analyzer.ts)*
- [x] Score output is reproducible for the same input *(pure function of deterministic, regex-based findings; LLM-extracted names don't feed into the score at all, so LLM nondeterminism can't affect risk score reproducibility)*

## Risk language

Use:

- [ ] Low Risk
- [ ] Moderate Risk
- [ ] High Risk
- [ ] Suspicious
- [ ] Unable to Verify
- [ ] Appears Consistent

Avoid:

- [x] "This is definitely a scam" *(the Gmail finding rewrite this session specifically removed fraud-implying language — "does not establish that the opportunity is fraudulent")*
- [ ] "100% legitimate"
- [ ] Other claims of certainty the evidence cannot support

---

# 8. CONTRADICTION VALIDATOR

Before displaying the report:

- [x] If `interview_required = false`, report never says formal interview exists *(src/services/contradictionValidator.ts, rule `process.no_interview` / `process.formal_interview_described` — a real bug, not a hypothetical: confirmed BEFORE the fix that a posting with both "no interview required" and loose "interview round" language anywhere in the text produced both a `high`-severity "No formal interview mentioned" finding AND a `positive` "Formal interview process described" finding simultaneously. Fixed by dropping the contradicting positive, keeping the more specific/explicit negative. 11 cases in scripts/test-contradiction-validator.mts, including the exact original bug reproduced end-to-end)*
- [ ] If `payment_requested = false`, report never says payment was requested *(different direction from what was built — the validator prevents a FALSE REASSURANCE positive from coexisting with a real payment demand, not a false payment-requested claim when none exists; not addressed this pass)*
- [ ] Compensation is never described as applicant payment *(adjacent to, but not the same claim as, the `payment.demand`/`payment.compensation_no_demand` backstop rule below — that rule stops the two findings from coexisting, it doesn't independently verify compensation language is never mislabeled as a demand)*
- [x] Explicit company name is always preserved *(same extraction guard — duplicate of the Section 4 item, listed again here since it's also a contradiction-prevention concern)*
- [ ] Website unreachable does not automatically become company fraud *(the wording was reviewed this pass and found reasonable — severity `high` not `critical`, explanation text avoids asserting fraud with certainty ("may not exist, may be misspelled, or may not be currently online") — but this wasn't a fix made this pass, and no dedicated test confirms an unreachable website alone can't push the OVERALL risk level into a high band. Left unchecked pending that specific test. A structural backstop rule (`company.website_unreachable` / `company.website_reachable` can't coexist) was added as defense-in-depth, tested, but that's a narrower claim than this item.)*
- [ ] UNKNOWN is never presented as confirmed negative evidence
- [x] Every finding has traceable evidence *(true of every finding this session touched or added — not independently verified for findings untouched this session, e.g. payment/process/domain-age findings)*
- [x] Report score matches the actual findings *(this was the entire point of the Section 7 scoring rework — score is now derived FROM the findings list, not a parallel/detached sum; additionally, the contradiction validator now runs BEFORE scoring, so a dropped contradictory positive also correctly stops contributing to any downstream score effect)*
- [ ] Summary matches the detailed report
- [ ] Recommended actions match detected risks

**A dedicated contradiction-validator module now exists**: `src/services/contradictionValidator.ts`. It runs on the fully assembled findings/positives across every category, after all category-analysis functions complete and before scoring/UI derivation. Current rule set (3 rules, each tested): `process.no_interview` vs `process.formal_interview_described` (the confirmed bug, see above); `payment.demand` vs `payment.compensation_no_demand` (defense-in-depth — already structurally prevented within `analyzePayment()`, this is a second independent safety net); `company.website_unreachable` vs `company.website_reachable` (same, defense-in-depth backstop). Resolution policy: when a specific/explicit negative finding and a loosely-inferred positive finding contradict, the positive is dropped and the explicit negative is kept — reasoning documented inline in the module. 11/11 tests pass in scripts/test-contradiction-validator.mts, including 3 direct rule-firing tests, 2 "don't over-strip when there's no real contradiction" tests, and the original bug reproduced end-to-end through the real analyzer.

---

# 9. REPORT UI

## Free screening

- [x] Show overall risk level *(`RiskScore` component, `publicResult.riskLevel`)*
- [x] Show risk score *(`publicResult.riskScore`, animated on load)*
- [x] Show 2-3 meaningful findings *(major warnings / caution signals counts shown even in preview tier)*
- [ ] Show enough evidence to establish trust *(subjective — not independently assessed)*
- [x] Show verification gaps *(`publicResult.verificationGaps` rendered with a count and list)*
- [x] Clearly explain that deeper verification is available *("Unlock the full verification..." CTA text confirmed in Report.tsx)*
- [ ] Do not make the free report useless *(subjective — not independently assessed)*

## Paid report

- [x] Overall assessment *(header section with risk level/score)*
- [x] Risk breakdown *("Risk Signals" section, grouped by Major warnings / Caution signals / Positive signals)*
- [x] Company information *("Company" topic card)*
- [x] Recruiter information *("Recruiter" topic card)*
- [x] Email/domain analysis *("Email / Domain" topic card)*
- [x] Offer analysis *("Documents" topic card, covers Offer Letter Analysis)*
- [x] Payment/red-flag analysis *("Payment" topic card)*
- [x] Positive legitimacy signals *("Positive signals" group in Risk Signals section)*
- [x] Evidence *(each `FindingCard` renders the finding's evidence)*
- [x] Verification gaps *(shown in both free and paid tiers)*
- [ ] Safe verification route *(not found anywhere in Report.tsx or the type definitions)*
- [x] Recommended actions *(`fullResult.recommendedAction.steps`, rendered as a numbered "What you should do" section)*
- [ ] What NOT to send/pay *(not found)*
- [ ] Questions to ask the recruiter *(not found)*

## Paid report persistence

- [x] Purchased report can be reopened *(functions/api/report.ts `onRequestGet`, looked up by report id)*
- [x] Purchased report remains available after refresh *(server-backed by Postgres + persistent cookie, not reliant on any in-browser state)*
- [x] Purchased report remains available after leaving the site *(same — DB-persisted, 2-year cookie)*
- [x] Purchased report remains available after returning later *(same)*
- [x] Access is checked server-side *(report.ts: `if (!report || report.userId !== userId) return 404` — a report belonging to a different user is treated identically to a nonexistent one, which also prevents id-enumeration from distinguishing "exists but not yours" from "doesn't exist")*

---

# 10. MOBILE & UX

- [ ] Test complete flow on mobile
- [ ] Test input form
- [ ] Test screening
- [ ] Test report display
- [ ] Test paywall
- [ ] Test Razorpay checkout
- [ ] Test purchased report
- [ ] Test navigation back to report
- [ ] Fix obvious layout issues
- [ ] Fix slow/broken interactions
- [ ] Remove confusing copy

> Entirely unverifiable from a static code archive — all of this needs a real device/browser.

---

# 11. SECURITY

- [x] Razorpay Key Secret is server-side only *(confirmed by code read of create-order.ts/unlock.ts — `keySecret` never appears in any JSON response — AND by a full git-history scan this session, see below)*
- [x] No secrets committed to Git *(full `git log --all -p` scan across all 25 commits for Razorpay secret patterns, OpenRouter/Anthropic key prefixes, DB connection strings with embedded credentials, and generic password assignments — found nothing. The only match was the Razorpay **Key ID** in `wrangler.toml`'s `[vars]` section, which is public-by-design — the same ID is exposed client-side in Razorpay Checkout regardless)*
- [x] `.env` files are ignored *(confirmed via direct inspection of .gitignore: `.env`, `.dev.vars`, `.wrangler` all present, and confirmed none of those paths appear anywhere in git history either)*
- [x] Frontend cannot directly unlock paid reports *(UnlockGate.tsx only ever calls `/api/create-order` then `/api/unlock`; the full report is never computed or faked client-side — it only exists in the browser after the server returns it post-verification)*
- [x] Frontend cannot change free-screening count *(no localStorage/client-state usage anywhere; counter lives only in Postgres, see Section 2)*
- [x] Report ownership is checked server-side *(report.ts, create-order.ts, and unlock.ts all independently check `report.userId === userId` / `payment.userId === userId` before returning anything)*
- [x] Payment verification is server-side *(unlock.ts HMAC check, see Section 3)*
- [x] Users cannot access another user's reports by changing IDs *(report.ts returns an identical 404 whether the report doesn't exist or belongs to someone else — no information leak distinguishing the two cases)*
- [x] Validate/sanitize user input *(analyze.ts: every field is coerced to a string and length-capped — e.g. `description` truncated to 8000 chars — before being used anywhere)*
- [x] Protect server endpoints against obvious abuse *(per-IP rate limiting on all four endpoints — analyze: 10/min, create-order: 5/min, unlock: 20/min, report: 30/min — verified working via scripts/test-rate-limit.mts, 6/6 checks pass: limit enforcement, independent buckets per key, window expiry/reset)*
- [ ] Check production environment variables *(can't be verified from a static archive — requires checking the live Cloudflare Pages dashboard)*
- [x] Check repository for accidentally exposed secrets *(see "No secrets committed to Git" above — same scan covers this)*

**Verified this session, two ways:**
1. `scripts/test-payment-verification.mts` (9/9 pass) — the HMAC signature logic itself is cryptographically sound: correct signatures verify, tampered/wrong-secret/garbage/empty/wrong-length signatures are all rejected without throwing.
2. `scripts/test-rate-limit.mts` (6/6 pass) — the in-memory rate limiter correctly enforces per-key limits, keeps separate buckets per IP, and resets after its window expires.

**Still outstanding, unrelated to this pass:** rotate the Razorpay live key, secret, and test unlock code that were exposed via an earlier `.dev.vars` file upload (not via git — that channel is confirmed clean).

---

# 12. REGRESSION TESTS

Create test cases for:

- [ ] Legitimate company + matching domain
- [ ] Legitimate company + third-party recruitment domain
- [ ] Fake company
- [ ] Unreachable website
- [x] Matching email/domain *(scripts/test-email-domain.mts, case 4)*
- [x] Mismatched email/domain *(scripts/test-email-domain.mts, cases 1 and 3)*
- [ ] Public email address *(partially — free-provider detection is tested, but not as an isolated "public email, no other signals" case)*
- [x] Payment requested *(scripts/test-scoring.mts, cases 2, 4, 5)*
- [ ] No payment requested
- [ ] Salary/stipend mentioned
- [x] No interview required *(scripts/test-contradiction-validator.mts, test 6 — end-to-end through the real analyzer, confirms the "No formal interview mentioned" finding fires correctly on explicit "no interview required" language)*
- [x] Interview required *(scripts/test-contradiction-validator.mts, test 7 — confirms "Formal interview process described" fires normally on genuine interview-round language with no contradicting "no interview" text present, i.e. the validator doesn't over-strip)*
- [ ] WhatsApp recruitment *(used as a test input in scripts/test-scoring.mts, but only to test scoring correlation — not independently verified as its own detection case)*
- [ ] Telegram recruitment
- [ ] Urgent offer *(same caveat as WhatsApp above)*
- [x] Missing recruiter name *(scripts/test-extract.mts covers this extensively — 15 cases including explicit non-name rejections)*
- [ ] Missing recruiter email
- [ ] Missing offer letter
- [ ] Missing domain-age data
- [ ] Missing company verification data
- [ ] Compensation language
- [ ] Security deposit language
- [ ] Registration fee language
- [x] Payment signature verification — correct, tampered, wrong-secret, malformed *(scripts/test-payment-verification.mts, new this pass, 9 cases)*
- [x] Rate limiting — enforcement, per-key isolation, window reset *(scripts/test-rate-limit.mts, 6 cases)*
- [x] Contradiction validator — known contradictory finding pairs resolve correctly, unrelated findings untouched *(scripts/test-contradiction-validator.mts, new this pass, 11 cases)*

## Contradiction regression tests

- [x] "No technical interview is required" does not trigger "formal interview" *(this was a confirmed real bug, fixed this pass — see Section 8. scripts/test-contradiction-validator.mts test 6 reproduces a posting with both phrasings and confirms only the negative finding survives)*
- [ ] "₹25,000/month stipend" does not trigger payment-request finding
- [ ] "Company pays ₹X" does not trigger applicant-payment finding
- [x] Explicit company name remains unchanged *(scripts/test-llm-extract.mts, test 11)*
- [x] Matching email/domain does not imply company verification *(the rewritten finding explicitly states affiliation is unverified even absent a mismatch — scripts/test-email-domain.mts case 4 confirms no finding fires, i.e. no false claim of verification either)*
- [ ] Unreachable website does not automatically become high risk
- [ ] UNKNOWN does not become FAIL

---

# 13. ANALYTICS

- [ ] Google Analytics installed *(confirmed NOT present — searched src/ and index.html for gtag/googletagmanager/GA-measurement-id patterns, zero matches, despite a "GSC verification tag" commit existing in history, which is a different thing — Search Console ownership verification, not an analytics install)*
- [ ] Track landing-page visits
- [ ] Track screening started
- [ ] Track screening completed
- [ ] Track free result viewed
- [ ] Track full-report CTA clicked
- [ ] Track checkout started
- [ ] Track successful payment
- [ ] Track purchased report viewed
- [ ] Track errors/failures where useful

## Weekly scoreboard

- [ ] Visitors
- [ ] Checks started
- [ ] Checks completed
- [ ] Paid report clicks
- [ ] Paid reports
- [ ] Revenue
- [ ] Organic traffic
- [ ] Repeat users
- [ ] Refunds/complaints
- [ ] Monthly maintenance

> This entire section is a genuine, confirmed gap — not a single analytics event exists in the codebase right now. Worth flagging as a pre-launch blocker since Section 16/18's validation questions (who paid, what convinced them, biggest bottleneck) are unanswerable without at least checkout/payment tracking.

---

# 14. PRE-LAUNCH

- [ ] Complete critical report-engine fixes *(in progress — recruiter extraction, sensitive-info categorization, email-domain wording, and risk scoring are done and tested; payment-amount/compensation/interview extraction remain)*
- [ ] Complete payment flow *(core logic is solid and tested at the unit level — see Section 3 — but end-to-end manual testing with real/test Razorpay credentials has not happened)*
- [x] Complete persistent report access *(Postgres-backed, cookie-based, server-checked ownership — see Sections 1, 2, 9)*
- [ ] Complete security checks *(most items in Section 11 are done; production env vars can't be checked from here, and `.env`/git history checks, while done, should probably be re-run again right before the actual launch rather than trusted from this one pass)*
- [ ] Complete mobile testing
- [ ] Complete regression tests
- [ ] Test production environment
- [ ] Test real ₹199 payment
- [ ] Test purchased-report recovery
- [ ] Verify domain
- [ ] Verify analytics *(nothing to verify yet — see Section 13)*
- [ ] Remove obvious broken/demo content
- [ ] Final landing-page copy check

---

# 15. LAUNCH

- [ ] Deploy production version
- [ ] Perform one complete real-user flow
- [ ] Confirm screening works
- [ ] Confirm payment works
- [ ] Confirm report unlock works
- [ ] Confirm report persistence works
- [ ] Confirm analytics events fire
- [ ] Start distribution

---

# 16. VALIDATION

## First milestone

Target:

**5 strangers × ₹199 = ₹995**

Track:

- [ ] First stranger completes a screening
- [ ] First stranger clicks paid report
- [ ] First stranger pays
- [ ] 5 strangers pay

## First 100 relevant visitors

- [ ] Reach 100 relevant visitors
- [ ] Measure screening conversion
- [ ] Measure paid-report CTA conversion
- [ ] Measure payment conversion
- [ ] Collect reasons for abandonment
- [ ] Identify biggest bottleneck

---

# 17. POST-LAUNCH: ONLY IF DEMAND EXISTS

Do NOT automatically build these.

- [ ] Test whether users need multiple reports
- [ ] Test 5-report bundle
- [ ] Test recurring plan
- [ ] Test company/search database
- [ ] Test search-intent landing pages
- [ ] Test additional verification data sources
- [ ] Test broader recruiter verification
- [ ] Test additional distribution channels

Only build these after actual user behavior provides evidence.

---

# 18. CAPORNOT DECISION CHECKPOINTS

## ₹995 revenue

- [ ] 5 strangers paid

Then investigate:

- [ ] Who paid?
- [ ] What problem were they solving?
- [ ] What convinced them?
- [ ] What almost stopped them?
- [ ] What did they want that Capornot did not provide?

## ₹5k-₹10k cumulative revenue

- [ ] Revenue reached
- [ ] Organic/distribution data reviewed
- [ ] Repeat usage reviewed
- [ ] Refunds/complaints reviewed
- [ ] Decide what to improve based on evidence

## 60-90 day checkpoint

- [ ] People are paying
- [ ] Distribution is working or improving
- [ ] Maintenance burden understood
- [ ] Decide whether to keep investing
- [ ] Decide whether to keep Capornot as a small cashflow tool
- [ ] Decide whether to move attention to another venture

---

# CORE RULE

> **Do not build features because they sound cool.**
>
> Build the smallest thing that makes the next validation question answerable.

## Current validation question

> **Will a stranger who is genuinely worried about a job/internship pay ₹199 for a deeper verification report before proceeding?**

## Current primary metric

**Revenue from strangers.**

---

# SESSION LOG

## Passes 1–2 (summary)

**Pass 1** — report-engine fixes in `src/services/analyzer.ts`: deterministic recruiter-name extraction (`extract.ts`, 15 tests), sensitive-info split into Government ID / Financial / Photograph with negation handling (7 tests), Gmail/domain finding de-duplication and wording fix (8 tests), severity-tiered risk scoring to stop correlated weak signals dominating (6 tests), LLM extraction fallback with verified-quote gating via OpenRouter/Llama 3.1 8B (`llmExtract.ts`, 13 mocked tests + a separate live spot-check script). One documented, deliberately-unaddressed limitation: LLM quote verification confirms a quote is real text, not that it's a true fact.

**Pass 2** — full-codebase verification pass (identity, database, payment creation/verification, rate limiting, report persistence, report UI) against a fresh `.rar` upload that included `.git`, enabling a full secret-history scan (25 commits, clean). Added `scripts/test-payment-verification.mts` (9 tests, Razorpay HMAC logic) and `scripts/test-rate-limit.mts` (6 tests). Surfaced four previously-unflagged gaps: no email recovery path, zero analytics, three missing paid-report UI sections, no contradiction-validator module.

**Outstanding from Pass 1, still unresolved:** rotate the Razorpay live key, secret, and test unlock code exposed via an earlier `.dev.vars` upload (not via git — that channel is confirmed clean).

## Pass 3 — Contradiction validator (this pass)

Built `src/services/contradictionValidator.ts`, addressing priority #1 from the four gaps Pass 2 surfaced.

**Found a real, confirmed bug before building anything** (per the checklist's own "test before you build" discipline): a posting containing both an explicit "no interview required" statement AND loose interview-round language elsewhere in the same text produced two directly contradictory findings simultaneously — a `high`-severity "No formal interview mentioned" warning and a `positive` "Formal interview process described" signal. Reproduced and confirmed with a standalone probe script before writing any fix.

**What was built:**
- Added an optional `tag?: string` field to the `Finding` type (`src/types/analysis.ts`) — a stable, machine-readable identifier distinct from the human-facing `title`, so the validator recognizes specific finding types without fragile title-string matching.
- Tagged the three known contradictory pairs at their source in `analyzer.ts`: `process.no_interview` / `process.formal_interview_described` (the confirmed bug), `payment.demand` / `payment.compensation_no_demand`, `company.website_unreachable` / `company.website_reachable` (the latter two already structurally prevented within their own functions — tagged and added as defense-in-depth backstops, not because they were buggy).
- `resolveContradictions()` runs on the fully assembled findings/positives across every category, after all category functions complete and before scoring/UI derivation. Per-category arrays are kept consistent with the resolved global result (so the UI topic cards and the main findings list never disagree).
- Resolution policy: when a specific/explicit negative and a loosely-inferred positive contradict, the positive is dropped, the negative is kept — documented inline with reasoning.

**Verification:** `scripts/test-contradiction-validator.mts`, 11/11 tests pass: all 3 rules confirmed to fire correctly in isolation, negative-alone and positive-alone cases confirmed untouched, an unrelated positive confirmed to survive alongside a real contradiction, and the original bug reproduced and confirmed fixed end-to-end through the real analyzer — plus a confirmation that ordinary non-contradictory interview language still produces its positive finding normally (i.e. the fix doesn't over-strip).

Full existing 7-suite regression + typecheck re-run after this change: zero regressions.

**Next up, per your stated priority order:** the three missing paid-report UI sections (Safe verification route, What NOT to send/pay, Questions to ask the recruiter), then email recovery, then analytics.