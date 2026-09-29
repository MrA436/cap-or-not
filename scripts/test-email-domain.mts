import { analyzeOpportunity } from '../src/services/analyzer.ts';

const base = { company:'Nexora Digital', recruiterName:'', recruiterEmail:'', companyWebsite:'', jobTitle:'', jobPostingUrl:'', description:'', recruiterMessage:'', offerLetter:'', agreeToTerms:true };

function emailFindings(result: any) {
  return [...result.majorWarnings, ...result.cautionSignals].filter((f: any) => f.category === 'email');
}

let bad = 0;
function check(name: string, cond: boolean) {
  console.log(cond ? 'PASS' : 'FAIL', '-', name);
  if (!cond) bad++;
}

// 1. Gmail + mismatched website domain: exactly ONE email finding, caution, new title.
{
  const r = await analyzeOpportunity({ ...base, recruiterEmail: 'ankit.hr@gmail.com', companyWebsite: 'https://nexora-digital.example' });
  const f = emailFindings(r);
  check('exactly one email finding (no double count)', f.length === 1);
  check('title is the softened one', f[0]?.title === 'Recruiter uses a free email provider');
  check('severity is caution, not high', f[0]?.severity === 'caution');
  check('finding text does not use "doesn\'t match" framing', !/doesn't match/i.test(f[0]?.finding ?? ''));
  check('finding mentions both the free domain and the company domain', /gmail\.com/.test(f[0]?.finding) && /nexora-digital\.example/.test(f[0]?.finding));
}

// 2. Gmail with no website provided at all: still one caution finding, generic wording.
{
  const r = await analyzeOpportunity({ ...base, recruiterEmail: 'ankit.hr@gmail.com' });
  const f = emailFindings(r);
  check('gmail w/ no website -> exactly one finding', f.length === 1);
  check('gmail w/ no website -> caution severity', f[0]?.severity === 'caution');
}

// 3. Non-free email that mismatches company website -> untouched by this fix (still its own path).
{
  const r = await analyzeOpportunity({ ...base, recruiterEmail: 'ankit@otherhr.example', companyWebsite: 'https://nexora-digital.example' });
  const f = emailFindings(r);
  check('non-free mismatched domain still produces a finding', f.length >= 1);
  check('non-free mismatched domain finding is not the free-provider title', f.every((x: any) => x.title !== 'Recruiter uses a free email provider'));
}

// 4. Matching company email domain -> positive signal, no findings.
{
  const r = await analyzeOpportunity({ ...base, recruiterEmail: 'ankit@nexora-digital.example', companyWebsite: 'https://nexora-digital.example' });
  const f = emailFindings(r);
  check('matching domain -> no email findings', f.length === 0);
}

console.log(bad ? `${bad} failed` : 'all passed');