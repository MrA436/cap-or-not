/**
 * Regression tests: government-ID severity follows TIMING and CONTEXT, not the
 * document's name alone.
 *
 *   - routine post-selection onboarding, with no suspicious context -> caution
 *   - application-stage / unspecified timing -> critical
 *   - coercion, messaging-app channel, candidate payment, financial details,
 *     offer-without-interview, unrealistic promises -> critical
 *   - a NAMED identifier (Aadhaar, PAN) is not proof of fraud by itself
 *   - finding text states only what was requested (document vs number)
 *   - "photo ID" is not double-counted as a separate photograph
 *
 * Run: npx tsx scripts/test-gov-id-severity.mts
 */
import { analyzeOpportunity } from '../src/services/analyzer.ts';
import type { AnalysisResult } from '../src/types/analysis.ts';

const base = {
  company: '', recruiterName: '', recruiterEmail: '', companyWebsite: '', jobTitle: '',
  jobPostingUrl: '', description: '', recruiterMessage: '', offerLetter: '', agreeToTerms: true,
};
const FIELDS = ['description', 'recruiterMessage', 'offerLetter'] as const;

let bad = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(cond ? 'PASS' : 'FAIL', '-', name, extra);
  if (!cond) bad++;
}

const all = (r: AnalysisResult) => [...r.majorWarnings, ...r.cautionSignals];
const idFinding = (r: AnalysisResult) => all(r).find((f) => f.title === 'Government ID requested');
const photoFinding = (r: AnalysisResult) => all(r).find((f) => f.title === 'Photograph requested');
const run = (text: string, field: (typeof FIELDS)[number] = 'recruiterMessage') =>
  analyzeOpportunity({ ...base, [field]: text });

// ───────────── routine post-selection onboarding → caution ─────────────
console.log('\n# Routine post-selection onboarding: caution, not a major warning');
const ROUTINE = [
  'Selected candidates must submit a government ID before joining for HR verification.',
  'Please provide ID proof before joining.',
  'On your first day, please bring your government ID for verification by HR.',
  // Named identifiers are NOT proof of fraud by themselves (timing + context decide):
  'Selected candidates must submit a copy of their Aadhaar card during onboarding.',
  'Selected candidates must share their PAN number for payroll setup after joining.',
];
for (const text of ROUTINE) {
  for (const field of FIELDS) {
    const r = await run(text, field);
    check(`[${field}] caution: "${text.slice(0, 62)}…"`, idFinding(r)?.severity === 'caution', `(severity=${idFinding(r)?.severity})`);
  }
  const r = await run(text);
  check(`not in majorWarnings, score ≤ 40, below HIGH RISK: "${text.slice(0, 40)}…"`,
    !r.majorWarnings.some((f) => f.title === 'Government ID requested') && r.riskScore <= 40 && !['HIGH RISK', 'VERY HIGH RISK'].includes(r.riskLevel),
    `(score=${r.riskScore}, ${r.riskLevel})`);
}

// ───────────── the Silverline posting, end to end ─────────────
console.log('\n# Silverline Talent Partners posting');
const SILVERLINE = `Company: Silverline Talent Partners
Position: Remote Marketing Associate Intern
Duration: 3 months
Location: Remote
Stipend: ₹12,000 per month
Responsibilities:

* Assist with social media campaigns.
* Research potential customers.
* Prepare weekly marketing reports.
* Attend team meetings and training sessions.

Requirements:

* Basic writing and communication skills.
* No prior experience required.
* Must have access to a smartphone and laptop.

Selection Process:
Applicants are shortlisted based on their CV and a short written assignment. Selected candidates receive an offer by email.
Recruiter: Kavya Singh
Contact: silverline.talent@gmail.com
Website: https://silverline-talent.example
Onboarding:
Selected candidates must submit their government ID and a passport-size photograph for identity verification. The company says these documents are required before the internship begins.
Candidates may be invited to join an optional paid professional development program. Details, including any costs, are provided separately. Participation in this program is not stated to be mandatory for employment.
Applications close on 8 November 2026.
No application fee is charged. The company pays the stated stipend directly to selected interns.`;
const silverlineInput = {
  ...base, company: 'Silverline Talent Partners', recruiterName: 'Kavya Singh', recruiterEmail: 'silverline.talent@gmail.com',
  companyWebsite: 'https://silverline-talent.example', jobTitle: 'Remote Marketing Associate Intern', description: SILVERLINE,
};
const offlineProbes = { probes: {
  website: async () => ({ status: 'unable_to_verify', reason: 'timeout' }) as any,
  domainAge: async () => ({ status: 'unable_to_verify', ageDays: null, registeredDate: null }) as any,
} };
{
  const r = await analyzeOpportunity(silverlineInput, offlineProbes);
  const f = idFinding(r);
  check('ID request is caution, not critical', f?.severity === 'caution', `(severity=${f?.severity})`);
  check('no major warnings at all', r.majorWarnings.length === 0, `(major=${r.majorWarnings.map((x) => x.title).join('|')})`);
  check('score is proportionate (18–30) and below HIGH RISK', r.riskScore >= 18 && r.riskScore <= 30 && !['HIGH RISK', 'VERY HIGH RISK'].includes(r.riskLevel), `(score=${r.riskScore}, ${r.riskLevel})`);
  check('finding says a DOCUMENT was requested, not an ID number', /identity document/.test(f?.finding ?? '') && !/ID number/.test(f?.finding ?? ''), `("${f?.finding}")`);
  check('independent free-email caution is still reported', all(r).some((x) => /free email/i.test(x.title)));
  check('separate passport-size photograph still reported (distinct item)', photoFinding(r)?.severity === 'caution');
  check('"No application fee" is not a payment demand', !all(r).some((x) => x.tag === 'payment.demand'));
  const fee = await run('You must pay a registration fee of Rs 999 before we proceed.');
  check('routine ID scores below an explicit fee demand', r.riskScore < fee.riskScore, `(silverline=${r.riskScore}, fee demand=${fee.riskScore})`);
}

// ───────────── application-stage / unspecified timing → critical ─────────────
console.log('\n# Application-stage or unspecified timing: stays critical');
const EARLY = [
  'Upload a copy of your government ID with your application to be considered.',
  'Enter your Aadhaar number in the application form to register.',
  'Shortlisted candidates must submit their government ID.',
  'Selected candidates must submit their government ID to receive the offer letter.',
  'Please share your government ID before the interview.',
  'Please send your government ID.',
  'Send your PAN card and Aadhaar for verification.',
  'Please send Aadhaar card + passport-size photograph.',
];
for (const text of EARLY) {
  for (const field of FIELDS) {
    const r = await run(text, field);
    check(`[${field}] critical: "${text.slice(0, 62)}…"`, idFinding(r)?.severity === 'critical', `(severity=${idFinding(r)?.severity})`);
  }
}

// ───────────── suspicious context overrides post-selection wording ─────────────
console.log('\n# Coercion, suspicious channel, payment, financial details: stays critical');
const SUSPICIOUS: [string, string][] = [
  ['coercive urgency', 'Selected candidates must submit their government ID immediately or the offer will be cancelled.'],
  ['messaging-app channel', 'Selected candidates must send their government ID on WhatsApp.'],
  ['messaging app elsewhere in the text', 'Contact us on WhatsApp. Selected candidates must submit their government ID before joining.'],
  ['candidate payment demand', 'Selected candidates must submit their government ID and pay a registration fee of Rs 500.'],
  ['bank / financial details', 'Selected candidates must send their government ID and bank account details.'],
  ['offer without interview', 'No interview required. Selected candidates must submit their government ID.'],
  ['unrealistic promise', 'Guaranteed job for all. Selected candidates must submit their government ID.'],
];
for (const [why, text] of SUSPICIOUS) {
  for (const field of FIELDS) {
    const r = await run(text, field);
    check(`[${field}] critical (${why})`, idFinding(r)?.severity === 'critical', `(severity=${idFinding(r)?.severity})`);
  }
}
{
  const r = await run('Selected candidates must submit their government ID and pay a registration fee of Rs 500.');
  check('payment demand itself is still reported alongside', all(r).some((x) => x.tag === 'payment.demand'));
  const b = await run('Selected candidates must send their government ID and bank account details.');
  check('bank-details finding is still reported alongside', all(b).some((x) => x.title === 'Bank or financial account details requested'));
}

// ───────────── negation ─────────────
console.log('\n# Negation: no finding');
for (const text of ['We never ask for a government ID.', 'No government ID is required at any stage.', 'We never ask for your Aadhaar or bank details. No photograph required either.']) {
  for (const field of FIELDS) {
    const r = await run(text, field);
    check(`[${field}] no ID finding: "${text.slice(0, 55)}…"`, !idFinding(r) && !photoFinding(r));
  }
}

// ───────────── finding text matches what was requested ─────────────
console.log('\n# Finding wording is accurate');
{
  const doc = idFinding(await run('Upload a copy of your government ID with your application.'));
  check('document request (critical) → "identity document", never "ID number"', /identity document/.test(doc?.finding ?? '') && !/ID number/.test(doc?.finding ?? ''), `("${doc?.finding}")`);
  const num = idFinding(await run('Enter your Aadhaar number in the application form.'));
  check('number request → "ID number"', /ID number/.test(num?.finding ?? ''), `("${num?.finding}")`);
  const pan = idFinding(await run('Selected candidates must share their PAN number for payroll setup after joining.'));
  check('post-selection number request (caution) → "ID number"', /ID number/.test(pan?.finding ?? '') && pan?.severity === 'caution', `("${pan?.finding}")`);
  const card = idFinding(await run('Selected candidates must submit a copy of their Aadhaar card during onboarding.'));
  check('post-selection card/copy request → document, not number', /identity document/.test(card?.finding ?? '') && !/asks for a government-issued ID number/.test(card?.finding ?? ''), `("${card?.finding}")`);
  const vague = idFinding(await run('Selected candidates must share their Aadhaar during onboarding.'));
  check('bare "Aadhaar" → does not claim a number or a document', /does not say whether/.test(vague?.finding ?? '') && !/asks for a government-issued ID number/.test(vague?.finding ?? ''), `("${vague?.finding}")`);
}

// ───────────── photograph is not double-counted ─────────────
console.log('\n# Photograph vs ID: one request, one label');
{
  const r = await run('Selected candidates must bring a photo ID such as Aadhaar on their first day.');
  check('"photo ID" is not also reported as a photograph', !photoFinding(r) && !!idFinding(r), `(titles=${all(r).map((x) => x.title).join('|')})`);
  check('…so it adds no duplicate score (ID caution alone = 18)', r.riskScore === 18, `(score=${r.riskScore})`);
  const both = await run('Selected candidates must submit their government ID and a passport-size photograph before joining.');
  check('ID + a genuinely separate photograph → both reported', !!idFinding(both) && !!photoFinding(both));
  check('…with only the bounded corroboration uplift (≤ 22)', both.riskScore <= 22, `(score=${both.riskScore})`);
  const alone = await run('Please share a passport-size photograph for your ID badge.');
  check('photograph alone is still a caution with no ID finding', photoFinding(alone)?.severity === 'caution' && !idFinding(alone));
}

// ───────────── existing clean and payment-demand cases ─────────────
console.log('\n# Existing clean / payment-demand behaviour unchanged');
{
  const clean = await analyzeOpportunity({ ...base, description: 'We are hiring a data analyst intern for a 3 month paid internship.' });
  check('clean posting → no findings, score 0', all(clean).length === 0 && clean.riskScore === 0, `(score=${clean.riskScore})`);
  const pay = await run('You must pay a registration fee of Rs 999 before we proceed.');
  const p = all(pay).find((x) => x.tag === 'payment.demand');
  check('explicit payment demand → critical, score ≥ 65', p?.severity === 'critical' && pay.riskScore >= 65, `(score=${pay.riskScore})`);
  const nofee = await run('No application fee is charged. The company pays the stated stipend directly to selected interns.');
  check('"no fee" text → no payment finding', !all(nofee).some((x) => x.tag === 'payment.demand'));
}

if (bad > 0) throw new Error(`${bad} check(s) failed`);
console.log('\nall passed');