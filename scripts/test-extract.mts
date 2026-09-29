import { inferRecruiterName as f } from '../src/services/extract.ts';
const cases: [string, string|null][] = [
  ['Recruiter: Ankit Sharma', 'Ankit Sharma'],
  ['Job: Data Entry\nRecruiter: Ankit Sharma\nEmail: a@gmail.com', 'Ankit Sharma'],
  ['📌 Recruiter - Priya Nair | HR', 'Priya Nair'],
  ['Hiring Manager: Mr. Rahul Verma, Nexora', 'Rahul Verma'],
  ['RECRUITER: ANKIT SHARMA', 'Ankit Sharma'],
  ['Recruiter: Priya', 'Priya'],
  ['Recruiter: N/A', null],
  ['Recruiter: HR Team', null],
  ['Recruiter: contact us on WhatsApp', null],
  ['Recruiter: Not provided', null],
  ['Our recruiter: Ankit will call you', null],
  ['Recruiter:', null],
  ['Recruiter: +91 98765 43210', null],
  ['Posted by: Anne-Marie O\'Neil', "Anne-Marie O'Neil"],
  ['', null],
];
let bad = 0;
for (const [i, e] of cases) { const g = f(i); const ok = g === e; if (!ok) bad++; console.log(ok?'PASS':'FAIL', JSON.stringify(i), '->', g, ok?'':`(want ${e})`); }
console.log(bad ? `${bad} failed` : 'all passed');