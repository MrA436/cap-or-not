/**
 * Regression tests for the canonical-facts architecture.
 * Run:  npx tsx scripts/test-facts-regression.mts
 *
 * These are NOT per-bug patches. Each scenario asserts a property of the
 * architecture (provenance, direction, integrity boundary), and a global
 * invariant is applied to EVERY scenario: no report text may name a brand or
 * an amount that is not present in what the user submitted.
 */
import { analyzeOpportunity } from '../src/services/analyzer.ts';
import { extractFacts, BRAND_NAMES } from '../src/services/facts.ts';
import { FindingFactory } from '../src/services/findingFactory.ts';
import type { LlmExtractionResult } from '../src/services/llmExtract.ts';

const base = {
  company: '', recruiterName: '', recruiterEmail: '', companyWebsite: '', jobTitle: '',
  jobPostingUrl: '', description: '', recruiterMessage: '', offerLetter: '', agreeToTerms: true,
};

let bad = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(cond ? 'PASS' : 'FAIL', '-', name, cond ? '' : extra);
  if (!cond) bad++;
}

const violations: string[] = [];

async function run(input: Record<string, unknown>) {
  const full = { ...base, ...input } as typeof base;
  const r = await analyzeOpportunity(full, { onIntegrityViolation: (v) => violations.push(`${v.title}: ${v.reason}`) });
  const findings = [...r.majorWarnings, ...r.cautionSignals];
  const all = [...findings, ...r.positiveSignals];

  // The global invariant, applied to every scenario.
  const reportText = [
    ...all.flatMap((f) => [f.title, f.finding, f.evidence]),
    ...r.verificationGaps.map((g) => g.item),
    r.summary,
  ].join('\n');
  const submitted = Object.values(full).filter((v) => typeof v === 'string').join('\n');
  const squash = (s: string) => s.toLowerCase().replace(/[\s,]/g, '');
  const leakedBrands = BRAND_NAMES.filter((b) =>
    new RegExp(`(?<![A-Za-z0-9])${b}(?![A-Za-z0-9])`, 'i').test(reportText)
    && !new RegExp(`(?<![A-Za-z0-9])${b}(?![A-Za-z0-9])`, 'i').test(submitted));
  const leakedAmounts = (reportText.match(/(?:₹|\$|€|£|Rs\.?|INR)\s?\d[\d,]*/gi) ?? [])
    .filter((a) => !squash(submitted).includes(squash(a)));
  check('invariant: report names no brand absent from the submission', leakedBrands.length === 0, `leaked: ${leakedBrands}`);
  check('invariant: report states no amount absent from the submission', leakedAmounts.length === 0, `leaked: ${leakedAmounts}`);
  check('invariant: every finding/positive cites facts', all.every((f) => (f.factIds?.length ?? 0) > 0));
  check('invariant: finding ids unique', new Set(all.map((f) => f.id)).size === all.length);
  return { r, findings, all, reportText };
}

// ───────────────────────────────────────────────────────────── 1. Nexora
console.log('\n# Nexora — explicit company/recruiter survive, domain never becomes the name');
{
  const text = 'Company: Nexora Digital Solutions\nRecruiter: Ankit Sharma\nRole: Data Entry Intern\nStipend: ₹18,000–₹25,000/month\nCandidate must pay ₹999 training fee';
  const { r, reportText } = await run({ description: text });
  check('company is exactly "Nexora Digital Solutions"', r.inputSummary.company === 'Nexora Digital Solutions', String(r.inputSummary.company));
  check('recruiter is exactly "Ankit Sharma"', r.inputSummary.recruiterName === 'Ankit Sharma', String(r.inputSummary.recruiterName));
  check('no "Recruiter name was not ..." gap', !r.verificationGaps.some((g) => /recruiter name was not/i.test(g.item)));
  check('no "Company name was not ..." gap', !r.verificationGaps.some((g) => /company name was not/i.test(g.item)));
  check('"Nexora-digital" appears nowhere', !/Nexora-digital/i.test(reportText));

  // With a website whose domain slug is tempting ("nexora-digital"): the name must still be the explicit one.
  const w = await run({ description: text, companyWebsite: 'https://nexora-digital.example' });
  check('with website: company still "Nexora Digital Solutions"', w.r.inputSummary.company === 'Nexora Digital Solutions');
  check('with website: "Nexora-digital" never appears', !/Nexora-digital/.test(w.reportText));
}

// ───────────────────────────────────────────────────────────── 2. VertexNova (real posting)
console.log('\n# VertexNova — real posting: explicit labels, purchase-style payment demand');
{
  const text = [
    'Company: VertexNova Solutions Pvt. Ltd.',
    'Position: Junior AI Research Intern',
    'Location: Remote',
    'Duration: 3 months',
    'Stipend: ₹18,000–₹25,000/month',
    'Responsibilities: dataset prep, ML models, papers, weekly reports, Slack/Meet',
    'Requirements: CS/AI/Data Science, Python, NumPy/Pandas/sklearn',
    'Selection: application screening, 30-min technical interview, short practical assignment, final interview',
    'Important: selected candidates must purchase a ₹1,499 refundable training and certification package before internship, refunded after successful completion',
    'Application: CV + college ID to careers@vertexnova-careers.com',
    'Website: https://vertexnova-careers.com',
    'Recruiter: Rahul Mehta',
    'Deadline: 30 Sept 2026',
  ].join('\n');
  const { r, findings } = await run({ recruiterMessage: text });
  const d = findings.find((f) => f.tag === 'payment.demand');
  check('company is "VertexNova Solutions Pvt. Ltd"', r.inputSummary.company === 'VertexNova Solutions Pvt. Ltd', String(r.inputSummary.company));
  check('recruiter is "Rahul Mehta"', r.inputSummary.recruiterName === 'Rahul Mehta', String(r.inputSummary.recruiterName));
  check('₹1,499 purchase is a critical payment demand', d?.severity === 'critical' && /₹1,499/.test(d.title), d ? d.title : 'no demand');
  check('stipend amounts never appear in the demand', !!d && !/18,000|25,000/.test(d.title + d.finding + d.evidence));
  check('risk is not LOW (a mandatory paid package is a major warning)', r.riskScore >= 65, String(r.riskScore));

  const facts = await extractFacts({ ...base, recruiterMessage: text });
  const dirs = facts.payments.map((p) => `${p.direction}:${p.amounts.join('|')}`).sort();
  check('facts: stipend = candidate_receives, ₹1,499 = candidate_pays',
    dirs.join(',') === 'candidate_pays:₹1,499,candidate_receives:₹18,000–₹25,000/month', dirs.join(','));

  // A stray markdown "**" in front of the first label must not change anything.
  const stray = await run({ recruiterMessage: '**' + text });
  check('stray "**" before first label: company unchanged', stray.r.inputSummary.company === 'VertexNova Solutions Pvt. Ltd', String(stray.r.inputSummary.company));

  // Recruiter format variants.
  for (const t of ['Recruiter: Priya Sharma', 'Recruiter:\nPriya Sharma', '*Recruiter*: Priya Sharma', 'Recruiter Name:\r\nPriya Sharma\r\n', 'Recruiter: Ankit  Sharma', '**Recruiter:** Rahul Mehta']) {
    const x = await run({ description: t });
    const want = t.includes('Ankit') ? 'Ankit Sharma' : t.includes('Rahul') ? 'Rahul Mehta' : 'Priya Sharma';
    check(`recruiter survives ${JSON.stringify(t)}`, x.r.inputSummary.recruiterName === want, String(x.r.inputSummary.recruiterName));
  }

  // Purchase wording: demand only for a candidate subject + product noun + amount.
  const kit = await run({ description: 'Candidates must purchase a ₹999 starter kit.' });
  check('"must purchase a ₹999 starter kit" → demand ₹999', /₹999/.test(kit.findings.find((f) => f.tag === 'payment.demand')?.title ?? ''));
  const laptop = await run({ description: 'We will purchase a laptop worth ₹50,000 for every intern.' });
  check('company purchases a laptop for you → NO demand', !laptop.findings.some((f) => f.tag === 'payment.demand'));
  const lunch = await run({ description: 'You can buy lunch at the canteen for ₹100.' });
  check('buying canteen lunch → NO demand', !lunch.findings.some((f) => f.tag === 'payment.demand'));
}

// ───────────────────────────────────────────────────────────── 3. BrightCore + Google Meet/Forms
console.log('\n# BrightCore / Google Meet + Forms — a tool name is not an employer claim');
{
  const text = [
    'Company: BrightCore Infoworks', 'Recruiter: Priya Sharma',
    'Interview will be on Google Meet. Please fill the Google Form at https://forms.google.com/abc',
    'Upload documents via Google Drive or docs.google.com. Microsoft Teams also works. They will review your profile.',
    'Key skills: survey design. We value metadata hygiene and an intelligent approach.',
  ].join('\n');
  const { r, reportText } = await run({ recruiterMessage: text, recruiterEmail: 'hr.brightcore@gmail.com' });
  check('no "google" anywhere in report', !/google/i.test(reportText));
  check('no brand-affiliation finding', !r.majorWarnings.concat(r.cautionSignals).some((f) => f.category === 'brand'));
  check('no "claims affiliation" text', !/claims affiliation/i.test(reportText));
  check('no brand gap invented', !r.verificationGaps.some((g) => /Relationship with/i.test(g.item)));
  check('company/recruiter preserved', r.inputSummary.company === 'BrightCore Infoworks' && r.inputSummary.recruiterName === 'Priya Sharma');
  check('free-email caution still reported (real signal kept)', r.cautionSignals.some((f) => f.category === 'email'));

  const facts = await extractFacts({ ...base, recruiterMessage: text, recruiterEmail: 'hr.brightcore@gmail.com' });
  check('facts: zero brand facts (no google, ey, meta, intel, microsoft)', facts.brands.length === 0, JSON.stringify(facts.brands.map((b) => b.value)));

  // Substring traps: "Intelligent Metaverse Labs", "They ... Key" must not become intel / meta / ey.
  const trap = await run({ company: 'Intelligent Metaverse Labs', recruiterEmail: 'x@gmail.com', description: 'They will call you. Key skills required.' });
  check('"Intelligent Metaverse Labs" is not intel/meta', !trap.findings.some((f) => f.category === 'brand') && !/\b(intel|meta|ey)\b/i.test(trap.reportText.replace(/Intelligent|Metaverse/g, '')));

  // Control: a REAL brand claim must still be caught (the detector isn't just disabled).
  const real = await run({ company: 'Google India Careers', recruiterEmail: 'recruit@gmail.com', description: 'Join Google as an intern. Interview via Google Meet.' });
  check('control: real "Google" company + gmail → brand finding present', real.findings.some((f) => /google/i.test(f.title + f.finding) && (f.category === 'company' || f.category === 'brand')));
}

// ───────────────────────────────────────────────────────────── 4. Payment direction
console.log('\n# Payment direction — compensation vs candidate payment');
{
  const demand = (r: Awaited<ReturnType<typeof run>>) => r.findings.find((f) => f.tag === 'payment.demand');

  const pays = await run({ description: 'Candidate must pay ₹999 training fee' });
  check('candidate pays ₹999 → critical payment demand', demand(pays)?.severity === 'critical');
  check('demand names ₹999', /₹999/.test(demand(pays)?.title ?? ''));

  const receives = await run({ description: 'We pay ₹20,000 per month to every intern.' });
  check('company pays ₹20k → NO payment demand', !demand(receives));
  check('company pays ₹20k → compensation positive', receives.all.some((f) => f.tag === 'payment.compensation_no_demand'));
  check('company pays ₹20k → no payment finding at all', !receives.findings.some((f) => f.category === 'payment'));

  const stipend = await run({ description: 'Stipend: ₹18,000–₹25,000/month' });
  check('stipend alone → no demand', !demand(stipend));

  // Both in one posting, BOTH orders: the demanded amount is ₹999 and never the stipend.
  for (const [label, text] of [
    ['stipend first', 'Stipend: ₹18,000–₹25,000/month\nCandidate must pay ₹999 training fee'],
    ['fee first', 'Candidate must pay ₹999 training fee\nStipend: ₹18,000–₹25,000/month'],
    ['one paragraph', 'Stipend is ₹18,000 per month. Candidate must pay ₹999 training fee.'],
    ['comma-joined', 'Stipend ₹18,000 per month, training fee ₹999 payable before joining'],
  ] as const) {
    const m = await run({ description: text });
    const d = demand(m);
    check(`${label}: demand is ₹999`, !!d && /₹999/.test(d.title));
    check(`${label}: stipend amount never in the demand`, !!d && !/18,000|25,000/.test(d.title + d.finding + d.evidence), d ? d.evidence : 'no demand');
  }

  const noFee = await run({ description: 'This is a free internship. No registration fee is charged. Salary is credited via bank transfer every month.' });
  check('"no registration fee" + "salary via bank transfer" → no demand', !demand(noFee));

  const label = await run({ description: 'Training fee:\n₹999\nStipend: Rs. 15,000 per month.' });
  check('label-then-amount line pairs fee with ₹999 only', /₹999/.test(demand(label)?.title ?? '') && !/15,000/.test((demand(label)?.title ?? '') + (demand(label)?.evidence ?? '')));

  const facts = await extractFacts({ ...base, description: 'Stipend: ₹18,000/month\nCandidate must pay ₹999 training fee' });
  const dirs = facts.payments.map((p) => `${p.direction}:${p.amounts.join('|')}`).sort();
  check('facts model direction explicitly', dirs.join(',') === 'candidate_pays:₹999,candidate_receives:₹18,000/month', dirs.join(','));
}

// ───────────────────────────────────────────────────────────── 5. Integrity boundary
console.log('\n# Integrity boundary — findings can only cite verified facts');
{
  const input = { ...base, company: 'Zenith Works', description: 'Interview via Google Meet. Stipend: ₹10,000 per month.' };
  const facts = await extractFacts(input);
  const seen: string[] = [];
  const fx = new FindingFactory(facts, (v) => seen.push(v.reason));
  const spec = { category: 'brand', severity: 'high' as const, title: 'x', finding: 'x', evidence: 'x', explanation: 'x', action: 'x' };
  const company = facts.company!;

  check('factory accepts a finding grounded in a cited fact', fx.make({ ...spec, title: 'Company Zenith Works', cites: [company] }) !== null);
  check('factory DROPS a finding naming a brand no cited fact contains', fx.make({ ...spec, title: 'Brand: google', cites: [company] }) === null);
  check('factory DROPS a finding stating an uncited amount', fx.make({ ...spec, finding: 'Pay ₹999 now', cites: [company] }) === null);
  check('factory DROPS a finding that cites nothing', fx.make({ ...spec, cites: [] }) === null);
  const forged = { ...company, id: 'fact-999' } as typeof company;
  check('factory DROPS a finding citing a forged fact object', fx.make({ ...spec, cites: [forged] }) === null);
  const clone = { ...company } as typeof company; // right id, wrong identity
  check('factory DROPS a finding citing a cloned (non-registered) fact', fx.make({ ...spec, cites: [clone] }) === null);
  check('violations are reported, not silent', seen.length === 5, String(seen.length));

  const a = new FindingFactory(facts), b = new FindingFactory(facts);
  a.nextId(); a.nextId();
  check('finding ids are per-request (no shared module counter)', b.nextId() === 'finding-1');
}

// ───────────────────────────────────────────────────────────── 6. LLM is extractor-only
console.log('\n# LLM — candidates only, verified or UNKNOWN');
{
  const text = 'Hi, this is Meera from Acme Robotics. Reach me on WhatsApp.';
  const withLlm = async (llm: LlmExtractionResult | 'throw') => extractFacts({ ...base, recruiterMessage: text }, {
    llmExtractor: async () => { if (llm === 'throw') throw new Error('boom'); return llm; },
  });
  const ok: LlmExtractionResult = { company: 'Acme Robotics', companyQuote: 'Acme Robotics', recruiterName: 'Meera', recruiterQuote: 'this is Meera', usedLlm: true };

  const good = await withLlm(ok);
  check('valid candidate (quote located, contains value) → fact, origin "llm"', good.company?.value === 'Acme Robotics' && good.company.origin === 'llm' && good.recruiterName?.value === 'Meera');
  check('accepted LLM fact has an exact span', !!good.company && text.slice(good.company.span.start, good.company.span.end) === 'Acme Robotics');

  const fake = await withLlm({ ...ok, company: 'Google', companyQuote: 'Google India Pvt Ltd' });
  check('fabricated quote → UNKNOWN', fake.company === null);
  const mismatch = await withLlm({ ...ok, company: 'Google', companyQuote: 'Acme Robotics' });
  check('real quote but value not in it → UNKNOWN', mismatch.company === null);
  const thrown = await withLlm('throw');
  check('LLM throws → UNKNOWN, extraction still works', thrown.company === null && thrown.recruiterName === null);

  const { r, reportText } = await (async () => {
    const res = await analyzeOpportunity({ ...base, recruiterMessage: text }, { llmExtractor: async () => ({ ...ok, company: 'Google', companyQuote: 'Google India Pvt Ltd' }) });
    return { r: res, reportText: JSON.stringify(res) };
  })();
  check('a hallucinating LLM cannot put "Google" into the report', !/google/i.test(reportText) && r.inputSummary.company === undefined);
  check('findings are template-built: LLM output never reaches finding text', !/Meera|Acme/.test([...r.majorWarnings, ...r.cautionSignals].map((f) => f.finding).join('')));
}

// ───────────────────────────────────────────────────────────── 7. No dropped facts / violations in normal runs
console.log('\n# Health');
check('no integrity violations across all scenarios', violations.length === 0, violations.join(' | '));

console.log(bad === 0 ? '\nall passed' : `\n${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);