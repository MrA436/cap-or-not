import { analyzeOpportunity } from '../src/services/analyzer.ts';

const base = { company:'', recruiterName:'', recruiterEmail:'', companyWebsite:'', jobTitle:'', jobPostingUrl:'', description:'', recruiterMessage:'', offerLetter:'', agreeToTerms:true };

type Check = { name: string; input: any; expectTitles: string[]; expectNotTitles?: string[] };

const checks: Check[] = [
  {
    name: 'Aadhaar + photograph (user\'s exact case)',
    input: { ...base, recruiterMessage: 'Please send Aadhaar card + passport-size photograph.' },
    expectTitles: ['Government ID requested', 'Photograph requested'],
  },
  {
    name: 'photograph alone -> caution only, no government ID finding',
    input: { ...base, recruiterMessage: 'Please share a passport-size photograph for your ID badge.' },
    expectTitles: ['Photograph requested'],
    expectNotTitles: ['Government ID requested'],
  },
  {
    name: 'bank details -> financial finding',
    input: { ...base, recruiterMessage: 'Share your bank account number and IFSC code for stipend payment.' },
    expectTitles: ['Bank or financial account details requested'],
  },
  {
    name: 'negation: "we never ask for your Aadhaar" -> no finding',
    input: { ...base, recruiterMessage: 'We never ask for your Aadhaar or bank details. No photograph required either.' },
    expectTitles: [],
    expectNotTitles: ['Government ID requested', 'Bank or financial account details requested', 'Photograph requested'],
  },
  {
    name: 'PAN + passport -> one government ID finding',
    input: { ...base, recruiterMessage: 'Kindly submit PAN card and passport copy for verification.' },
    expectTitles: ['Government ID requested'],
  },
  {
    name: 'generic "ID proof" only -> still flagged as government ID',
    input: { ...base, recruiterMessage: 'Please provide ID proof before joining.' },
    expectTitles: ['Government ID requested'],
  },
  {
    name: 'nothing sensitive -> no findings',
    input: { ...base, description: 'We are hiring a data analyst intern for a 3 month paid internship.' },
    expectTitles: [],
    expectNotTitles: ['Government ID requested', 'Bank or financial account details requested', 'Photograph requested'],
  },
];

let bad = 0;
for (const c of checks) {
  const result = await analyzeOpportunity(c.input);
  const titles = [...result.majorWarnings, ...result.cautionSignals]
    .filter(f => f.category === 'sensitive').map(f => f.title);
  let ok = true;
  for (const t of c.expectTitles) if (!titles.includes(t)) { ok = false; }
  for (const t of c.expectNotTitles ?? []) if (titles.includes(t)) { ok = false; }
  if (!ok) bad++;
  console.log(ok ? 'PASS' : 'FAIL', '-', c.name, '| got:', titles);
}
console.log(bad ? `${bad} failed` : 'all passed');