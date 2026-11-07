/**
 * Keeps the legal pages honest. Run:  npx tsx scripts/check-legal.mts
 * Before launch:                       npx tsx scripts/check-legal.mts --strict
 *
 * It does not judge the legal wording. It checks that the pages exist and are
 * wired in, and that every FACT the policies state still matches the code:
 * price, free-check limit, cookie, "no analytics trackers", "IP not stored",
 * and that every outside service the code talks to is named in the Privacy Policy.
 * --strict also fails while src/config/legal.ts still holds a REPLACE_ placeholder.
 */
import { readFileSync, existsSync } from 'node:fs';
import { LEGAL, unfilledLegalFields } from '../src/config/legal.ts';
import { LEGAL_PAGES, privacyContent, termsContent, refundContent } from '../src/pages/legalContent.ts';

const STRICT = process.argv.includes('--strict');
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : '');
let bad = 0;
const check = (name: string, cond: boolean, extra = '') => { console.log(cond ? 'PASS' : 'FAIL', '-', name, cond ? '' : extra); if (!cond) bad++; };
const text = (c: typeof termsContent) => [c.h1, c.intro, ...c.sections.flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.list ?? [])])].join('\n');

const app = read('src/App.tsx');
const meta = read('src/seo/meta.ts');
const sitemap = read('public/sitemap.xml');
const layout = read('src/components/Layout.tsx');
const form = read('src/components/OpportunityForm.tsx');
const unlock = read('src/components/UnlockGate.tsx');
const createOrder = read('functions/api/create-order.ts');
const store = read('functions/_lib/store.ts');
const identity = read('functions/_lib/identity.ts');
const schema = read('functions/_lib/schema.sql');
const indexHtml = read('index.html');
const privacy = text(privacyContent);

console.log('\n# wiring: every page is routed, prerendered, in the sitemap and in the footer');
for (const page of LEGAL_PAGES) {
  check(`${page.path}: route in App.tsx`, app.includes(`path="${page.path}"`));
  check(`${page.path}: in PRERENDERED_ROUTES and pageMeta`, meta.includes(`'${page.path}',`) && meta.includes(`'${page.path}': {`));
  check(`${page.path}: in sitemap.xml`, sitemap.includes(`${LEGAL.siteUrl}${page.path}</loc>`));
  check(`${page.path}: linked from the footer`, layout.includes(`to="${page.path}"`));
  check(`${page.path}: has a title, h1, intro and at least 2 sections`, !!page.title && !!page.h1 && page.intro.length > 40 && page.sections.length >= 2);
}
check('consent checkbox links to Terms and Privacy', form.includes('href="/terms"') && form.includes('href="/privacy"'));
check('payment box links to Terms and Refund Policy', unlock.includes('href="/terms"') && unlock.includes('href="/refund-policy"'));

console.log('\n# facts: what the policies say must match what the code does');
const paise = Number((createOrder.match(/REPORT_PRICE_PAISE\s*=\s*(\d+)/) ?? [])[1]);
check(`price in config (${LEGAL.reportPrice}) equals REPORT_PRICE_PAISE in create-order.ts`, paise > 0 && LEGAL.reportPrice === `₹${paise / 100}`, `code says ₹${paise / 100}`);
const freeLimit = Number((store.match(/FREE_CHECK_LIMIT\s*=\s*(\d+)/) ?? [])[1]);
check(`free checks in config (${LEGAL.freeChecksPerVisitor}) equals FREE_CHECK_LIMIT in store.ts`, freeLimit === LEGAL.freeChecksPerVisitor, `code says ${freeLimit}`);
const cookie = (identity.match(/COOKIE_NAME\s*=\s*'([^']+)'/) ?? [])[1];
check(`Privacy Policy names the real cookie (${cookie})`, !!cookie && privacy.includes(cookie));
check('Privacy Policy says the cookie lasts two years, matching MAX_AGE_SECONDS', /60\s*\*\s*60\s*\*\s*24\s*\*\s*365\s*\*\s*2/.test(identity) && /two years/i.test(privacy));
check('terms and refund pages state the same price as the code', text(termsContent).includes(LEGAL.reportPrice) && text(refundContent).includes(LEGAL.reportPrice));

console.log('\n# claims: "no analytics trackers" and "IP not stored" are still true');
const TRACKERS = /gtag\(|google-analytics|googletagmanager|plausible\.io|posthog|mixpanel|clarity\.ms|connect\.facebook\.net|fbq\(|hotjar|segment\.com|amplitude|static\.cloudflareinsights/i;
const sources = ['index.html', 'src/main.tsx', 'src/App.tsx', 'src/components/Layout.tsx'].map(read).join('\n');
check('no analytics / advertising tracker is loaded by the site (Privacy Policy says none)', !TRACKERS.test(sources), 'a tracker was added: update the Privacy Policy, then update this check');
check('the database has no IP-address column (Privacy Policy says IPs are not stored)', !/\bip(_address)?\b/i.test(schema.replace(/--.*$/gm, '')));

console.log('\n# disclosure: every outside service the code talks to is named in the Privacy Policy');
const codeAll = ['src/services/llmExtract.ts', 'src/services/claimReader.ts', 'src/services/rdap.ts', 'src/services/websiteCheck.ts', 'functions/api/create-order.ts', 'functions/_lib/db.ts', 'wrangler.toml'].map(read).join('\n');
const services: [string, RegExp, RegExp][] = [
  ['Razorpay (payments)', /razorpay/i, /razorpay/i],
  ['OpenRouter (language model)', /openrouter/i, /openrouter/i],
  ['Cloudflare Workers AI (language model)', /workers ai|\/ai\/run|\[ai\]/i, /workers ai/i],
  ['public domain registries (RDAP)', /rdap/i, /registr/i],
  ['Cloudflare (hosting)', /hyperdrive|wrangler|cloudflare/i, /cloudflare/i],
  ['Supabase (database)', /supabase|pooler\.supabase/i, /supabase/i],
];
for (const [name, inCode, inPolicy] of services) {
  // Supabase appears only in the connection string (not in the repo), so it is checked against the policy unconditionally.
  const used = name.startsWith('Supabase') ? true : inCode.test(codeAll);
  check(`${name}: ${used ? 'used by the code and' : 'not used; policy'} ${used ? 'named in the Privacy Policy' : 'need not mention it'}`, !used || inPolicy.test(privacy));
}

console.log('\n# launch readiness (src/config/legal.ts)');
const unfilled = unfilledLegalFields();
if (unfilled.length) {
  console.log(`${STRICT ? 'FAIL' : 'WARN'} - still a placeholder: ${unfilled.join(', ')}  (the production build refuses to run until it is filled in)`);
  if (STRICT) bad++;
} else {
  check('contact email looks like an email address', /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(LEGAL.contactEmail));
}
check('no page mentions courts, jurisdiction cities or physical addresses we no longer ask for', ![...LEGAL_PAGES].some((p) => /court|jurisdiction|registered address|business address/i.test(text(p))));

console.log(bad === 0 ? '\nall passed' : `\n${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);