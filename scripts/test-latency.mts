/**
 * Latency regression. Run:  npx tsx scripts/test-latency.mts
 *  1. The LLM call and the external probes must OVERLAP (mocked: llm 1200ms, probes 1000ms;
 *     sequential would be >= 2200ms, concurrent is ~1200ms).
 *  2. A slow probe can never stall a report: each probe has a hard wait limit
 *     (default 2500ms); on expiry that part is "could not verify", not an error.
 */
import { analyzeOpportunity } from '../src/services/analyzer.ts';
import { extractFacts } from '../src/services/facts.ts';

const base = {
  company: '', recruiterName: '', recruiterEmail: '', companyWebsite: 'https://acme-labs.example', jobTitle: '',
  jobPostingUrl: '', description: 'Hi, this is Meera from Acme Labs. Reach me on WhatsApp.', recruiterMessage: '', offerLetter: '', agreeToTerms: true,
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (name: string, cond: boolean, extra = '') => { console.log(cond ? 'PASS' : 'FAIL', '-', name, cond ? '' : extra); if (!cond) bad++; };

const t = Date.now();
const f = await extractFacts(base, {
  llmExtractor: async () => { await sleep(1200); return { company: 'Acme Labs', companyQuote: 'Acme Labs', recruiterName: 'Meera', recruiterQuote: 'this is Meera', usedLlm: true }; },
  probes: {
    website: async () => { await sleep(1000); return { status: 'reachable' as const, httpStatus: 200 }; },
    domainAge: async () => { await sleep(1000); return { status: 'known' as const, ageDays: 900, registeredDate: '2024-01-01' }; },
  },
});
const wall = Date.now() - t;
console.log(`  wall ${wall}ms | llm ${f.timingsMs.llm}ms | probes ${f.timingsMs.probes}ms | total ${f.timingsMs.total}ms`);
check('LLM result was used', f.company?.origin === 'llm' && f.recruiterName?.value === 'Meera');
check('probes ran and produced observations', f.observations.length === 2);
check('stages overlap: wall time < llm + probes (would be >= 2200ms if sequential)', wall < 1900, `${wall}ms`);
check('stages overlap: wall time is about max(llm, probes)', wall < 1600, `${wall}ms`);
check('timings are reported per stage', f.timingsMs.llm >= 1100 && f.timingsMs.probes >= 900);

// ───────── 2. hard wait limit on probes
const slowProbe = async () => { await sleep(6000); return { status: 'reachable' as const, httpStatus: 200 }; };
const slowAge = async () => { await sleep(6000); return { status: 'known' as const, ageDays: 900, registeredDate: '2024-01-01' }; };
{
  const t1 = Date.now();
  const f1 = await extractFacts(base, { probes: { website: slowProbe, domainAge: slowAge }, probesDeadlineMs: 300 });
  const w1 = Date.now() - t1;
  console.log(`  custom limit 300ms: wall ${w1}ms | probes ${f1.timingsMs.probes}ms`);
  check('custom probe limit (300ms) is honoured even when probes take 6000ms', w1 < 1200, `${w1}ms`);
  check('...both observations are inconclusive, not errors', f1.observations.length === 2 && f1.observations.every((o) => o.outcome === 'inconclusive'));

  const t2 = Date.now();
  const f2 = await extractFacts(base, { probes: { website: slowProbe, domainAge: slowAge } });
  const w2 = Date.now() - t2;
  console.log(`  default limit: wall ${w2}ms`);
  check('default probe limit bounds the wait (< 3500ms) when probes take 6000ms', w2 < 3500, `${w2}ms`);
  check('...and the facts layer still returns normally', f2.observations.length === 2);

  const r = await analyzeOpportunity({ ...base, description: 'Company: Acme Labs\nRole: Backend intern\nStipend: ₹20,000/month' }, { probes: { website: slowProbe, domainAge: slowAge }, probesDeadlineMs: 300 });
  check('report: a timed-out probe is a verification gap, not a finding', r.verificationGaps.some((g) => /reachable|registration date/i.test(g.item)) && ![...r.majorWarnings, ...r.cautionSignals].some((f) => /website|domain/i.test(f.title)));
  check('report: score is unaffected by the timed-out probes', r.riskScore === 0, String(r.riskScore));

  let timings: { llm: number; probes: number; claims: number; total: number } | null = null;
  await analyzeOpportunity({ ...base, description: 'Stipend: ₹20,000/month' }, { onTimings: (t) => { timings = t; } });
  check('onTimings reports per-stage costs for logging', !!timings && typeof (timings as { total: number }).total === 'number');
}

console.log(bad === 0 ? '\nall passed' : `\n${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);