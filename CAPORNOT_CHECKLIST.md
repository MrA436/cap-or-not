# CAPORNOT MASTER CHECKLIST

> Source of truth for Capornot's current build, testing, launch, and validation work.
>
> Rule: Do not mark a task `[x]` unless it has actually been implemented AND tested.

---

# 0. PRODUCT SCOPE

## Current offer

- [ ] Free screening gives a useful limited preview
- [ ] Full verification report is locked from the first screening
- [ ] User gets 5 free screening previews
- [ ] After 5 free screenings, user can still run a limited preview
- [ ] ₹199 unlocks ONE full verification report
- [ ] ₹199 does NOT unlock unlimited future reports
- [ ] Purchased reports remain accessible permanently
- [ ] No fake countdowns or artificial urgency
- [ ] Product language avoids definitive "SCAM / NOT SCAM" claims
- [ ] Risk and verification confidence are treated separately

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

- [ ] Generate a persistent anonymous user ID on first visit
- [ ] Store user ID in a Secure, HttpOnly cookie
- [ ] Use appropriate SameSite setting
- [ ] Ensure cookie is secure in production
- [ ] Restore the same user after refresh
- [ ] Restore the same user after closing/reopening browser
- [ ] Test that frontend JavaScript cannot directly modify the identity cookie

## Email identity

- [ ] Capture email during purchase
- [ ] Associate verified email with the user account
- [ ] Do NOT treat merely typed email as proof of ownership
- [ ] Implement email verification/recovery
- [ ] Implement magic-link recovery if needed
- [ ] Test report recovery after losing the original cookie

---

# 2. DATABASE

Use a proper relational database such as PostgreSQL/Supabase.

## Users

- [ ] Create `users` table
- [ ] Store anonymous user ID
- [ ] Store email when available
- [ ] Store creation timestamp

## Reports

- [ ] Create `reports` table
- [ ] Link each report to a user
- [ ] Store report ID
- [ ] Store report input/data needed for persistence
- [ ] Store generated report data
- [ ] Store creation timestamp
- [ ] Store payment/unlock status

## Payments

- [ ] Create `payments` table
- [ ] Store user ID
- [ ] Store report ID
- [ ] Store Razorpay order ID
- [ ] Store Razorpay payment ID
- [ ] Store amount
- [ ] Store payment status
- [ ] Store verification timestamp

## Usage

- [ ] Track free screening usage server-side
- [ ] Enforce the 5-free-screening rule server-side
- [ ] Ensure localStorage cannot reset free usage
- [ ] Ensure changing frontend state cannot unlock reports

---

# 3. RAZORPAY PAYMENT SYSTEM

## Order creation

- [ ] Create Razorpay orders server-side
- [ ] Never create trusted payment state from the frontend
- [ ] Keep Razorpay Key Secret server-side only

## Verification

- [ ] Verify successful payment server-side
- [ ] Verify payment belongs to the correct order
- [ ] Verify expected amount
- [ ] Verify payment status
- [ ] Handle duplicate payment/webhook events safely
- [ ] Mark report as paid only after successful verification

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

---

# 4. REPORT ENGINE ARCHITECTURE

## Canonical extraction

Build ONE structured extraction object from the raw posting/input.

- [ ] Extract claimed company name
- [ ] Extract website URL
- [ ] Extract email addresses
- [ ] Extract recruiter name
- [ ] Extract payment request
- [ ] Extract payment amount
- [ ] Extract compensation/stipend
- [ ] Extract interview requirement
- [ ] Extract communication channels
- [ ] Extract relevant claims
- [ ] Extract document/offer information

## Critical distinction

- [ ] Preserve exact claimed company name
- [ ] Do not derive company name from domain when explicit company name exists
- [ ] Distinguish CLAIMED from VERIFIED
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

## Email

- [ ] Extract email domain
- [ ] Compare email domain with provided website domain
- [ ] Detect public email providers
- [ ] Avoid claiming company identity is verified merely because domains match

## Website/domain

- [ ] Extract canonical domain
- [ ] Check website accessibility
- [ ] Handle unreachable websites
- [ ] Do not automatically classify unreachable as major risk
- [ ] Add RDAP/domain-age verification
- [ ] Calculate domain age when available
- [ ] Distinguish domain evidence from company verification

## Company identity

- [ ] Compare claimed company against available domain/company evidence
- [ ] Detect obvious mismatch
- [ ] Avoid domain-slug → company-name inference when explicit company name exists

## Hiring process

- [ ] Detect interview requirement
- [ ] Detect explicit "no interview" statements
- [ ] Handle negation correctly
- [ ] Detect WhatsApp/Telegram recruitment
- [ ] Detect urgency language

## Financial requests

- [ ] Detect registration fees
- [ ] Detect security deposits
- [ ] Detect training fees
- [ ] Detect application fees
- [ ] Detect other applicant payment requests
- [ ] Do NOT flag salary/stipend as applicant payment
- [ ] Do NOT confuse compensation with a payment request

---

# 6. FINDINGS SYSTEM

Do not let individual rules directly write arbitrary report prose.

Create structured findings.

Each finding should contain:

- [ ] Finding ID
- [ ] Category
- [ ] Status
- [ ] Severity
- [ ] Evidence
- [ ] Explanation
- [ ] Recommended action

## Categories

- [ ] Payment
- [ ] Process
- [ ] Company
- [ ] Recruiter
- [ ] Contact & Email
- [ ] Claims
- [ ] Documents
- [ ] Domain

---

# 7. RISK SCORE

- [ ] Risk score is deterministic
- [ ] Score consumes structured findings
- [ ] PASS does not create risk
- [ ] UNKNOWN does not create risk
- [ ] FAIL creates risk according to defined severity
- [ ] Correlated findings are not double-counted
- [ ] Payment request and payment amount are not counted as two independent major risks
- [ ] Score has documented weighting
- [ ] Score output is reproducible for the same input

## Risk language

Use:

- [ ] Low Risk
- [ ] Moderate Risk
- [ ] High Risk
- [ ] Suspicious
- [ ] Unable to Verify
- [ ] Appears Consistent

Avoid:

- [ ] "This is definitely a scam"
- [ ] "100% legitimate"
- [ ] Other claims of certainty the evidence cannot support

---

# 8. CONTRADICTION VALIDATOR

Before displaying the report:

- [ ] If `interview_required = false`, report never says formal interview exists
- [ ] If `payment_requested = false`, report never says payment was requested
- [ ] Compensation is never described as applicant payment
- [ ] Explicit company name is always preserved
- [ ] Website unreachable does not automatically become company fraud
- [ ] UNKNOWN is never presented as confirmed negative evidence
- [ ] Every finding has traceable evidence
- [ ] Report score matches the actual findings
- [ ] Summary matches the detailed report
- [ ] Recommended actions match detected risks

---

# 9. REPORT UI

## Free screening

- [ ] Show overall risk level
- [ ] Show risk score
- [ ] Show 2-3 meaningful findings
- [ ] Show enough evidence to establish trust
- [ ] Show verification gaps
- [ ] Clearly explain that deeper verification is available
- [ ] Do not make the free report useless

## Paid report

- [ ] Overall assessment
- [ ] Risk breakdown
- [ ] Company information
- [ ] Recruiter information
- [ ] Email/domain analysis
- [ ] Offer analysis
- [ ] Payment/red-flag analysis
- [ ] Positive legitimacy signals
- [ ] Evidence
- [ ] Verification gaps
- [ ] Safe verification route
- [ ] Recommended actions
- [ ] What NOT to send/pay
- [ ] Questions to ask the recruiter

## Paid report persistence

- [ ] Purchased report can be reopened
- [ ] Purchased report remains available after refresh
- [ ] Purchased report remains available after leaving the site
- [ ] Purchased report remains available after returning later
- [ ] Access is checked server-side

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

---

# 11. SECURITY

- [ ] Razorpay Key Secret is server-side only
- [ ] No secrets committed to Git
- [ ] `.env` files are ignored
- [ ] Frontend cannot directly unlock paid reports
- [ ] Frontend cannot change free-screening count
- [ ] Report ownership is checked server-side
- [ ] Payment verification is server-side
- [ ] Users cannot access another user's reports by changing IDs
- [ ] Validate/sanitize user input
- [ ] Protect server endpoints against obvious abuse
- [ ] Check production environment variables
- [ ] Check repository for accidentally exposed secrets

---

# 12. REGRESSION TESTS

Create test cases for:

- [ ] Legitimate company + matching domain
- [ ] Legitimate company + third-party recruitment domain
- [ ] Fake company
- [ ] Unreachable website
- [ ] Matching email/domain
- [ ] Mismatched email/domain
- [ ] Public email address
- [ ] Payment requested
- [ ] No payment requested
- [ ] Salary/stipend mentioned
- [ ] No interview required
- [ ] Interview required
- [ ] WhatsApp recruitment
- [ ] Telegram recruitment
- [ ] Urgent offer
- [ ] Missing recruiter name
- [ ] Missing recruiter email
- [ ] Missing offer letter
- [ ] Missing domain-age data
- [ ] Missing company verification data
- [ ] Compensation language
- [ ] Security deposit language
- [ ] Registration fee language

## Contradiction regression tests

- [ ] "No technical interview is required" does not trigger "formal interview"
- [ ] "₹25,000/month stipend" does not trigger payment-request finding
- [ ] "Company pays ₹X" does not trigger applicant-payment finding
- [ ] Explicit company name remains unchanged
- [ ] Matching email/domain does not imply company verification
- [ ] Unreachable website does not automatically become high risk
- [ ] UNKNOWN does not become FAIL

---

# 13. ANALYTICS

- [ ] Google Analytics installed
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

---

# 14. PRE-LAUNCH

- [ ] Complete critical report-engine fixes
- [ ] Complete payment flow
- [ ] Complete persistent report access
- [ ] Complete security checks
- [ ] Complete mobile testing
- [ ] Complete regression tests
- [ ] Test production environment
- [ ] Test real ₹199 payment
- [ ] Test purchased-report recovery
- [ ] Verify domain
- [ ] Verify analytics
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