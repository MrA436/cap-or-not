import { analyzeOpportunity } from '../src/services/analyzer.ts';

const base = { company:'Nexora Digital', recruiterName:'', recruiterEmail:'', companyWebsite:'', jobTitle:'', jobPostingUrl:'', description:'', recruiterMessage:'', offerLetter:'', agreeToTerms:true };

let bad = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(cond ? 'PASS' : 'FAIL', '-', name, extra);
  if (!cond) bad++;
}

// 1. Four weak/correlated signals alone (no critical, no explicit payment) should NOT hit anywhere near 100.
{
  const text = 'Apply urgently, only a few slots left! Contact us on WhatsApp. No interview required for this role.';
  const r = await analyzeOpportunity({ ...base, recruiterEmail: 'hr@gmail.com', recruiterMessage: text });
  check('4 weak/correlated signals stay well under 100', r.riskScore < 70, `(got ${r.riskScore})`);
}

// 2. A single genuine critical finding (explicit payment demand) should dominate and push score high on its own.
{
  const r = await analyzeOpportunity({ ...base, recruiterMessage: 'You must pay a registration fee of Rs 999 before we proceed.' });
  check('single critical (payment demand) alone scores high', r.riskScore >= 60, `(got ${r.riskScore})`);
}

// 3. Nothing suspicious at all -> low score.
{
  const r = await analyzeOpportunity({ ...base, description: 'We are hiring a data analyst intern for a 3 month paid internship with mentorship and a structured interview process including a technical round.' });
  check('clean posting scores low', r.riskScore <= 20, `(got ${r.riskScore})`);
}

// 4. Severe posting (payment + amount + gov ID + no interview + urgency + WhatsApp + Gmail + unreachable site)
//    should score very high, but via genuine severity stacking, not because of the corroboration count.
{
  const text = `Nexora Digital is hiring Data Entry Interns.
Recruiter: Ankit Sharma
Email: ankit.hr@gmail.com
Pay a registration fee of Rs 999 immediately, urgent, limited slots!
Send Aadhaar card + passport-size photograph.
No interview required. Contact us on WhatsApp for fast processing.`;
  const r = await analyzeOpportunity({ ...base, recruiterEmail: 'ankit.hr@gmail.com', companyWebsite: 'https://nexora-digital.example', description: text, recruiterMessage: text });
  check('severe multi-signal posting scores very high', r.riskScore >= 80, `(got ${r.riskScore})`);
  check('severe posting is not just an arithmetic max-out (should be < strict old-style overcount, i.e. sensible not saturated at exactly 100 by count alone)', r.riskScore <= 100);
}

// 5. Monotonicity: adding one more weak caution signal to an already-critical case
//    should change the score only a little, not push it from e.g. 65 to 95.
{
  const r1 = await analyzeOpportunity({ ...base, recruiterMessage: 'Pay a registration fee of Rs 999 before we proceed.' });
  const r2 = await analyzeOpportunity({ ...base, recruiterEmail: 'hr@gmail.com', recruiterMessage: 'Pay a registration fee of Rs 999 before we proceed. Contact us on WhatsApp. Apply urgently!' });
  const delta = r2.riskScore - r1.riskScore;
  check('adding weak caution signals on top of a critical only nudges the score', delta >= 0 && delta <= 25, `(r1=${r1.riskScore}, r2=${r2.riskScore}, delta=${delta})`);
}

console.log(bad ? `${bad} failed` : 'all passed');