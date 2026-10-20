/**
 * Regression tests for three confirmed false-positive classes:
 *   1. explicit "no payment" / company-pays text becoming a candidate payment demand
 *   2. ordinary application / offer deadlines becoming "pressure"
 *   3. an unreachable website being scored like a major warning
 * Each negative case is paired with positive controls proving genuine payment
 * demands and genuinely coercive urgency STILL trigger.
 *
 * Run: npx tsx scripts/test-regression-payment-pressure-website.mts
 */
import { analyzeOpportunity } from '../src/services/analyzer.ts';
import type { AnalysisResult } from '../src/types/analysis.ts';

const base = {
  company: 'Nexora Digital', recruiterName: '', recruiterEmail: '', companyWebsite: '', jobTitle: '',
  jobPostingUrl: '', description: '', recruiterMessage: '', offerLetter: '', agreeToTerms: true,
};
const FIELDS = ['description', 'recruiterMessage', 'offerLetter'] as const;

let bad = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(cond ? 'PASS' : 'FAIL', '-', name, extra);
  if (!cond) bad++;
}

const negatives = (r: AnalysisResult) => [...r.majorWarnings, ...r.cautionSignals];
const paymentFindings = (r: AnalysisResult) =>
  negatives(r).filter((f) => f.tag === 'payment.demand' || /payment requirement in offer letter/i.test(f.title));
const pressureFindings = (r: AnalysisResult) =>
  negatives(r).filter((f) => /urgency or pressure language/i.test(f.finding));

async function inEveryField(text: string) {
  const out: { field: string; r: AnalysisResult }[] = [];
  for (const field of FIELDS) out.push({ field, r: await analyzeOpportunity({ ...base, [field]: text }) });
  return out;
}

// ───────────── BUG 1: false payment warning ─────────────
console.log('\n# Bug 1 — explicit no-payment / company-pays text must NOT be a payment demand');
const NO_PAYMENT = [
  'We do not charge any registration fee, security deposit or training fee from candidates.',
  'Candidates do not need to pay any fees. Stipend: Rs 10,000 per month, paid by the company.',
  'There is no registration fee. Candidates are not required to pay any fees at any stage of the process.',
  'Registration is free. No fee is charged at any stage of selection.',
  'Fees: Nil. Registration fee: Rs 0. Training fee: None.',
  'Neither a registration fee nor a security deposit is required.',
  'You will never be asked to pay or deposit money. Please report anyone who asks for a registration fee.',
  'Do not pay any fee to anyone claiming to represent us; we never charge candidates.',
  'Training will be provided at no cost to you. The company bears the certification fee.',
  'The training fee is borne by the company. You do not pay anything.',
  'We cover the course fee and the certification fee for all selected interns.',
  'This is a paid internship. The company will pay you a stipend of Rs 15,000 per month.',
];
for (const text of NO_PAYMENT) {
  for (const { field, r } of await inEveryField(text)) {
    const p = paymentFindings(r);
    check(`[${field}] no payment finding: "${text.slice(0, 60)}…"`, p.length === 0, p.length ? `(got ${p.map((f) => f.title).join(' | ')})` : '');
  }
}

console.log('\n# Bug 1 — positive controls: genuine candidate→company payment demands still trigger');
const PAYMENT_DEMANDS = [
  'You must pay a registration fee of Rs 999 before we proceed.',
  'Candidates need to pay Rs 2,000 as a refundable security deposit before joining.',
  // Third-party-warning detector must not swallow a demand that merely starts with "anyone":
  'Anyone who wants to join must pay a registration fee of Rs 500.',
  'Anyone who asks must pay a registration fee of Rs 500.',
  // Company bearing ONE cost must not clear a separate demanded cost:
  'The company bears the training cost, but you must pay Rs 999 as a registration fee.',
  // Pay-first-then-reimbursed is a scam shape, not a company-paid fee:
  'Pay a Rs 2,000 registration fee now; the company will reimburse it after joining.',
];
for (const text of PAYMENT_DEMANDS) {
  for (const { field, r } of await inEveryField(text)) {
    check(`[${field}] payment demand detected: "${text.slice(0, 60)}…"`, paymentFindings(r).length > 0);
  }
}
{
  // A company-paid stipend alone must be a positive, never a payment demand.
  const r = await analyzeOpportunity({ ...base, description: 'The company will pay you a stipend of Rs 15,000 per month.' });
  check('stipend alone → no payment finding', paymentFindings(r).length === 0);
}

// ───────────── BUG 2: false pressure warning ─────────────
console.log('\n# Bug 2 — ordinary deadlines / validity dates must NOT be pressure');
const DEADLINES = [
  'Applications close on 30 November 2026.',
  'Last date to apply: 15 Nov 2026. Late applications will not be considered.',
  'Apply now! Applications are now open. Deadline: 25 October 2026.',
  'Apply immediately via the careers page. Urgent requirement for Data Analyst.',
  'Applications received after the deadline will not be considered.',
  'Deadline to apply is 28 Feb. After the deadline the application link will expire.',
  'This offer will expire on 30 October 2026 if not accepted. Please sign and return the letter by that date.',
  'Register now, the offer will expire after 7 days of the date of issue.',
  'Closing soon: apply before 12 Nov to be considered for the Dec cohort.',
  'Send your documents within 24 hours so we can schedule the interview.',
];
for (const text of DEADLINES) {
  for (const { field, r } of await inEveryField(text)) {
    const p = pressureFindings(r);
    check(`[${field}] no pressure finding: "${text.slice(0, 60)}…"`, p.length === 0, p.length ? `(got ${p.map((f) => f.evidence).join(' | ')})` : '');
  }
}

console.log('\n# Bug 2 — positive controls: genuine coercive urgency still triggers');
const COERCIVE = [
  'Pay the registration fee within 2 hours or your offer will be cancelled.',
  'Confirm within 2 hours or the offer will expire.',
  'Your offer will expire in 24 hours, so reply immediately.',
  'Send your Aadhaar and bank details right away or your selection will be revoked.',
  'Last chance to confirm your seat. Transfer the fee immediately.',
  'You must pay Rs 1,500 as a security deposit immediately.',
];
for (const text of COERCIVE) {
  for (const { field, r } of await inEveryField(text)) {
    check(`[${field}] pressure detected: "${text.slice(0, 60)}…"`, pressureFindings(r).length > 0);
  }
}

// ───────────── BUG 3: unreachable website severity ─────────────
console.log('\n# Bug 3 — unreachable website is a verification concern, not a major warning');
const unableAge = async () => ({ status: 'unable_to_verify', ageDays: null, registeredDate: null }) as any;
const probes = (website: any) => ({ probes: { website: async () => website, domainAge: unableAge } });
const DNS_FAIL = probes({ status: 'unreachable', reason: 'dns_not_found' });
const REACHABLE = probes({ status: 'reachable', httpStatus: 200 });
const TIMEOUT = probes({ status: 'unable_to_verify', reason: 'timeout' });
const site = { ...base, companyWebsite: 'https://nexora-digital.example', description: 'Data analyst intern. Stipend Rs 10,000 per month. Interview includes a technical round.' };
const siteFinding = (r: AnalysisResult) => negatives(r).filter((f) => f.tag === 'company.website_unreachable');

{
  const r = await analyzeOpportunity(site, DNS_FAIL);
  const f = siteFinding(r);
  check('DNS failure produces exactly one website finding', f.length === 1);
  check('…and it is NOT critical/high (not a major warning)', f.length === 1 && f[0].severity !== 'critical' && f[0].severity !== 'high', `(severity=${f[0]?.severity})`);
  check('…and it is not listed under majorWarnings', r.majorWarnings.length === 0);
  check('…and on its own the overall level stays LOW RISK', r.riskLevel === 'LOW RISK' && r.riskScore <= 20, `(score=${r.riskScore}, level=${r.riskLevel})`);
  check('…and the wording does not assert fraud', !/\b(fraud|fake|scam)\b/i.test(f[0]?.finding ?? '') || /not (proof|evidence)/i.test(f[0]?.explanation ?? ''));
}
{
  const r = await analyzeOpportunity(site, TIMEOUT);
  check('timeout / unverifiable → no website finding at all', siteFinding(r).length === 0 && r.riskScore === 0, `(score=${r.riskScore})`);
  check('…recorded as a verification gap instead', r.verificationGaps.some((g) => /website/i.test(g.item)));
}
{
  const r = await analyzeOpportunity(site, REACHABLE);
  check('reachable site → no website risk finding', siteFinding(r).length === 0);
}
{
  // Scoring consistency: it must not inflate a genuinely critical posting, and must not hide independent signals.
  const bad_ = { ...site, recruiterMessage: 'You must pay a registration fee of Rs 999 before we proceed.' };
  const withDns = await analyzeOpportunity(bad_, DNS_FAIL);
  const withOk = await analyzeOpportunity(bad_, REACHABLE);
  check('critical payment demand is still the top finding with a dead site', paymentFindings(withDns).length === 1 && withDns.majorWarnings[0]?.tag === 'payment.demand');
  check('dead site adds only a small, bounded amount on top of the critical', withDns.riskScore - withOk.riskScore >= 0 && withDns.riskScore - withOk.riskScore <= 4, `(dns=${withDns.riskScore}, reachable=${withOk.riskScore})`);
  check('independent critical signal is NOT hidden (level HIGH RISK or above)', ['HIGH RISK', 'VERY HIGH RISK'].includes(withDns.riskLevel), `(level=${withDns.riskLevel})`);

  const many = await analyzeOpportunity({ ...site, recruiterEmail: 'hr@gmail.com', recruiterMessage: 'Contact us on WhatsApp.' }, DNS_FAIL);
  const titles = negatives(many).map((f) => f.title).join(' | ');
  check('other independent caution signals remain visible next to the website finding',
    /messaging app/i.test(titles) && /free email/i.test(titles) && /did not resolve/i.test(titles), `(${titles})`);
  check('several cautions together stay below HIGH RISK (no pile-up into a major warning)', ['LOW RISK', 'GENERALLY LOW RISK', 'CAUTION'].includes(many.riskLevel), `(level=${many.riskLevel}, score=${many.riskScore})`);
}

console.log(bad ? `\n${bad} failed` : '\nall passed');
if (bad > 0) throw new Error(`${bad} check(s) failed`);