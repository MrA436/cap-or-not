/**
 * CANONICAL FACTS LAYER — the only place in the engine that reads raw posting
 * text.
 *
 *   RAW POSTING → extractFacts() → CanonicalFacts → analyzers → findings → score
 *
 * Why this exists: before this layer every analyze*() function re-scanned the
 * raw strings with its own loose matching (substring brand lookup, "any amount
 * in the same sentence", first-amount-wins ...) and interpolated whatever it
 * found straight into finding text. Extraction results were then merged back
 * into the same string bag as the raw paste. Trusted and untrusted data were
 * indistinguishable, so each analyzer could invent facts independently.
 *
 * Rules enforced here:
 *  1. EVERY fact carries provenance: an origin (typed / labelled / prose / llm /
 *     derived) and a Span — the exact [start, end) range of the raw field it
 *     was read from.
 *  2. EVERY fact is re-verified before it is exposed: the span must slice back
 *     to its quote, and the fact's value must be derivable from that quote.
 *     A fact that fails verification is dropped (UNKNOWN), never passed on.
 *  3. Only this file can mint `Verified<…>` values (see `mint`). Analyzers get
 *     `CanonicalFacts` and never see the raw input, so they cannot re-derive.
 *  4. Payment has an explicit direction, decided per clause, so a stipend and
 *     a training fee can never be mixed.
 *  5. A lexical hit is not a claim. Every payment cue passes ONE polarity gate
 *     (claims.ts: negated / warning / zero-amount are suppressed, never emitted),
 *     and "pressure" exists only when a time constraint is coupled to a
 *     consequence or a demand. Suppressed hits are kept in `suppressed` for
 *     diagnostics; analyzers cannot see them.
 *  6. External probes (website reachability, domain age) run HERE and enter as
 *     verified `observation` facts with a typed outcome. analyzer.ts performs
 *     no I/O. A failed probe is only evidence if the probe could observe at all.
 *  7. The LLM is an extractor of CANDIDATES only. A candidate becomes a fact
 *     only if its quote is located in the real text and contains its value.
 *     Any failure → UNKNOWN.
 */

import type { OpportunityInput } from '../types/analysis.js';
import { findRecruiterName, findCompanyLabelled, findCompanyProse, type Hit } from './extract.js';
import { extractWithLlm, UNKNOWN_LLM_RESULT, type LlmExtractionResult } from './llmExtract.js';
import { lookupDomainAge, type DomainAgeResult } from './rdap.js';
import { checkWebsiteReachable, type WebsiteReachabilityResult } from './websiteCheck.js';
import {
  negatedBefore, polarityOf, allZero, companyBearsCost, classifyIdRequest, type IdContext,
  URGENCY_TERMS, URGENCY_PATTERN, SELF_CONTAINED_COERCION, CONSEQUENCE_CUES, CONSEQUENCE_LEAD,
  EXPIRY_CUES, COMPRESSED_URGENCY,
} from './claims.js';

// Non-global copy so .test() is stateless (URGENCY_PATTERN carries the g flag for matchAll).
const COMPRESSED_TIME_PATTERN = new RegExp(URGENCY_PATTERN.source, 'i');

// ───────────────────────────── types ─────────────────────────────

export type SourceField =
  | 'company' | 'recruiterName' | 'recruiterEmail' | 'companyWebsite' | 'jobTitle'
  | 'jobPostingUrl' | 'description' | 'recruiterMessage' | 'offerLetter';

/** The three free-text fields. Everything text-derived comes from these. */
export const TEXT_FIELDS: SourceField[] = ['description', 'recruiterMessage', 'offerLetter'];

export interface Span {
  field: SourceField;
  start: number;
  end: number;
  /** Verbatim: `sources[field].slice(start, end) === quote`. */
  quote: string;
}

export type FactOrigin = 'typed' | 'labelled' | 'prose' | 'llm' | 'derived';

declare const verifiedBrand: unique symbol;
/** Only `mint()` in this file produces these. Findings may cite nothing else. */
export type Verified<T> = T & { readonly [verifiedBrand]: true };

interface BaseFact { id: string; origin: FactOrigin; span: Span }

export type IdentityKind = 'company' | 'recruiter_name' | 'recruiter_email' | 'website' | 'job_title' | 'job_url';
export interface IdentityFact extends BaseFact { kind: IdentityKind; value: string }

export interface BrandFact extends BaseFact {
  kind: 'brand';
  /** Canonical lowercase brand name from BRAND_NAMES. */
  value: string;
  /** True when the brand is part of the company name itself (vs. a mention in the text). */
  viaCompanyField: boolean;
}

/**
 * Who pays whom. This is a property of a FACT, decided once, per clause:
 *  - candidate_pays:     money flows candidate → company (fee, deposit, "you pay").
 *  - candidate_receives: money flows company → candidate (stipend, salary, "we pay").
 *  - unknown:            an amount with no direction evidence. Never scored.
 */
export type PaymentDirection = 'candidate_pays' | 'candidate_receives' | 'unknown';
export interface PaymentFact extends BaseFact {
  kind: 'payment';
  direction: PaymentDirection;
  /** Human-facing purpose for a candidate_pays fact, e.g. "training fee". */
  purpose: string | null;
  /** The cue phrases that decided the direction, as written in the quote. */
  cues: string[];
  /** Only the amounts that belong to THIS direction within the clause. */
  amounts: string[];
}

export type SignalKind =
  | 'pressure' | 'messaging_platform' | 'scam_promise' | 'gov_claim'
  | 'sens_gov_id' | 'sens_gov_id_generic' | 'sens_financial' | 'sens_photo'
  | 'no_interview' | 'instant_selection' | 'interview' | 'interview_round'
  | 'offer_letter_mention' | 'account_creation' | 'download' | 'app_or_software'
  | 'work_from_home' | 'template_phrase' | 'offer_date' | 'offer_compensation_term'
  | 'offer_names_company' | 'recruiter_name_in_text'
  | 'mentorship' | 'certificate' | 'salary_or_stipend' | 'unpaid' | 'sales_target'
  | 'project' | 'team_or_manager' | 'assessment' | 'comp_context';

export interface SignalFact extends BaseFact {
  kind: 'signal';
  signal: SignalKind;
  /** Canonical phrase that matched (from our lexicon), e.g. "urgent", "whatsapp". */
  phrase: string;
  /** True when a negation word precedes the mention ("we never ask for your Aadhaar"). */
  negated: boolean;
  /** Government-ID mentions only: when in the process it is asked for, and whether a number or a document. */
  idContext?: IdContext;
}

/** One per non-empty free-text field; lets "nothing found" findings cite something real. */
export interface DocumentFact extends BaseFact { kind: 'document'; value: SourceField }

/**
 * A result from an external probe, anchored to the typed website it was about.
 *  website_reachability: 'reachable' | 'dns_not_found' (resolver said the name does
 *    not exist AND a control probe proved the observer's DNS/egress works) |
 *    'inconclusive' (timeouts, TLS, refusals, blocked, or an observer that could
 *    not see the network — says nothing about the site).
 *  domain_age: 'known' (authoritative registry date) | 'inconclusive'.
 */
export interface ObservationFact extends BaseFact {
  kind: 'observation';
  probe: 'website_reachability' | 'domain_age';
  outcome: 'reachable' | 'dns_not_found' | 'known' | 'inconclusive';
  httpStatus?: number;
  ageDays?: number | null;
  registeredDate?: string | null;
}

export type Fact = IdentityFact | BrandFact | PaymentFact | SignalFact | DocumentFact | ObservationFact;

export interface CanonicalFacts {
  company: Verified<IdentityFact> | null;
  recruiterName: Verified<IdentityFact> | null;
  recruiterEmail: Verified<IdentityFact> | null;
  website: Verified<IdentityFact> | null;
  jobTitle: Verified<IdentityFact> | null;
  jobUrl: Verified<IdentityFact> | null;
  brands: Verified<BrandFact>[];
  payments: Verified<PaymentFact>[];
  signals: Verified<SignalFact>[];
  documents: Verified<DocumentFact>[];
  observations: Verified<ObservationFact>[];
  /** Hits that matched a lexicon but did NOT become claims (negated, warning, zero, neutral urgency). */
  suppressed: { kind: 'payment' | 'pressure'; reason: string; quote: string }[];
  /** Words / characters across description + recruiterMessage + offerLetter. */
  wordCount: number;
  textChars: number;
  /** True only if the LLM call completed (regardless of whether anything verified). */
  llmUsed: boolean;
  /** Facts that failed verification and were dropped — for tests/diagnostics only. */
  dropped: { kind: string; reason: string }[];
  /** Every verified fact by id — the integrity guard checks citations against this. */
  byId: ReadonlyMap<string, Verified<Fact>>;
}

// ───────────────────────────── lexicons ─────────────────────────────

export const BRAND_NAMES = [
  'amazon', 'google', 'microsoft', 'apple', 'facebook', 'meta', 'netflix',
  'ibm', 'oracle', 'salesforce', 'adobe', 'intel', 'cisco', 'tesla',
  'walmart', 'target', 'jpmorgan', 'goldman sachs', 'morgan stanley',
  'deloitte', 'ey', 'pwc', 'kpmg', 'accenture', 'capgemini', 'tata',
  'infosys', 'wipro', 'tcs', 'hcl', 'cognizant', 'flipkart', 'swiggy',
  'zomato', 'paytm', 'phonepe', 'reliance', 'airtel', 'jio',
];

// Brands that are ordinary English words. They count as an affiliation claim
// only in an unmistakable corporate context (see extractBrands).
const AMBIGUOUS_BRANDS = new Set(['target', 'apple', 'meta', 'oracle', 'intel', 'ey', 'reliance']);

// "Google Meet", "Microsoft Teams": the brand names a TOOL the interview/form
// uses — not a claim that the employer is that brand.
const TOOL_SUFFIX: Record<string, string> = {
  google: 'meet|forms?|docs?|sheets?|slides|drive|calendar|chat|classroom|hangouts?|workspace|colab|keep|jamboard|duo|voice|translate|analytics|ads|play|pay|maps|search|account|login|sign[- ]?in',
  microsoft: 'teams|forms?|office|word|excel|powerpoint|outlook|onenote|sharepoint|365|team|account|login',
  meta: 'business|quest|verified|pixel',
  amazon: 'pay|prime|music|alexa',
  apple: 'pay|music|id|store',
};

const CORPORATE_SUFFIX_WORDS = ['inc', 'corp', 'corporation', 'ltd', 'limited', 'llc', 'llp', 'pvt', 'private', 'india', 'co'];

const FEE_TERMS = [
  'registration fee', 'application fee', 'security deposit', 'training fee',
  'training cost', 'certification fee', 'certificate fee', 'laptop deposit',
  'equipment deposit', 'equipment fee', 'refundable deposit', 'onboarding fee',
  'onboarding charge', 'interview fee', 'registration charge', 'processing fee',
  'security money', 'advance payment', 'upfront payment', 'registration amount',
  'payment required', 'training charges', 'course fee',
];
const PAY_VERB_CUES = ['pay ₹', 'pay rs', 'pay $'];
// "Candidates must purchase a ₹1,499 training package" is a payment demand even
// though it contains neither a fee noun nor "pay". A purchase counts only with
// (a) an amount after the verb, (b) a program/product noun in the same clause
// ("lunch at the canteen" is not a demand), and (c) a candidate subject.
const PURCHASE_VERBS = ['purchase', 'buy', 'enroll in', 'enrol in', 'subscribe to', 'invest'];
const PURCHASE_OBJECT = /\b(?:package|kit|course|program(?:me)?|bundle|licen[sc]e|membership|subscription|certification|training|laptop|software|plan)\b/i;
const PURCHASE_PURPOSE = /^\s+((?:[A-Za-z-]+\s+){0,6}?(?:package|kit|course|program(?:me)?|bundle|fee|charges?|deposit|licen[sc]e|plan|subscription|membership))\b/i;
const TRANSFER_CUES = [
  'transfer funds', 'wire transfer', 'bank transfer', 'wire money', 'send money',
  'gift card', 'amazon gift', 'itunes gift', 'google play gift',
];
const CRYPTO_TERMS = ['bitcoin', 'cryptocurrency', 'crypto payment', 'usdt', 'ether', 'eth wallet'];
const PAYMENT_DEMAND_VERBS = ['pay', 'payment', 'send', 'transfer', 'deposit', 'wire'];

// Strong = the clause is explicitly about money going TO the candidate.
const STRONG_COMP_CUES = [
  'salary', 'compensation', 'stipend', 'paid trial', 'paid internship', 'you will be paid',
  'you will receive', 'you will earn', 'you will get', 'we pay', 'we will pay', 'earned by',
  'monthly pay', 'take-home', 'base pay', 'pay range', 'above market', 'market average',
  'earn up to', 'ctc', 'remuneration', 'credited', 'incentive', 'bonus',
];
const RATE_CUES = ['per month', '/month', 'per week', '/week', 'per hour', '/hour', 'per day'];
// Exported for the quality-notes signal (same list the old analyzer used).
const COMPENSATION_CONTEXT_PATTERNS = [...RATE_CUES, ...STRONG_COMP_CUES.filter((c) =>
  ['salary', 'compensation', 'stipend', 'paid trial', 'you will be paid', 'you will receive', 'we pay',
    'earned by', 'monthly pay', 'take-home', 'base pay', 'pay range', 'above market', 'market average',
    'earn up to'].includes(c))];

const COMPANY_SUBJECT = new Set(['we', 'company', 'employer', 'organization', 'organisation', 'firm', 'they', 'us', 'management']);
const CANDIDATE_SUBJECT = new Set([
  'you', 'candidate', 'candidates', 'applicant', 'applicants', 'intern', 'interns', 'student', 'students',
  'trainee', 'trainees', 'participant', 'participants', 'must', 'need', 'needs', 'required', 'have', 'should',
  'please', 'kindly', 'first', 'immediately', 'then', 'to', 'now', 'shall',
]);

const FREE_OF_CHARGE = /\b(?:free of (?:cost|charge)|no (?:cost|charges?|fees?)|zero (?:fees?|cost)|100% free|completely free|without (?:any )?(?:fee|charges?|payment))\b/i;

// ───────────────────────────── phrase scanning ─────────────────────────────

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Boundary applies only on sides whose edge character is alphanumeric ("pay ₹" is open-ended). */
function phraseRe(phrase: string): RegExp {
  const body = escapeRe(phrase.trim()).replace(/ /g, '\\s+');
  const left = /^[A-Za-z0-9]/.test(phrase) ? '(?<![A-Za-z0-9])' : '';
  const right = /[A-Za-z0-9]$/.test(phrase) ? '(?![A-Za-z0-9])' : '';
  return new RegExp(left + body + right, 'gi');
}

interface Mention { phrase: string; start: number; end: number; negated: boolean }

/** `negationAware` is the same boolean the old per-family window was; the definition lives in claims.ts. */
function findMentions(text: string, phrases: string[], negationAware: number | boolean = 0): Mention[] {
  const out: Mention[] = [];
  for (const phrase of phrases) {
    const re = phraseRe(phrase);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      out.push({ phrase, start: m.index, end: m.index + m[0].length, negated: negationAware ? negatedBefore(text, m.index) : false });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

const MONTHS = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DATE_PATTERNS = [
  /(?<![0-9])\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}(?![0-9])/g,
  new RegExp(`(?<![A-Za-z0-9])\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTHS}\\.?,?\\s+\\d{4}`, 'gi'),
  new RegExp(`(?<![A-Za-z0-9])${MONTHS}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}`, 'gi'),
];

// ───────────────────────────── signal lexicon ─────────────────────────────

interface SignalDef {
  kind: SignalKind;
  phrases: string[];
  /** Negation window in chars; 0 = not negation-aware. */
  negationWindow?: number;
  fields?: SourceField[];
  patterns?: RegExp[];
}

const SIGNAL_DEFS: SignalDef[] = [
  // 'pressure' is deliberately absent: it is resolved from coupled cues in extractFacts().
  // "signal" alone is an ordinary word; only count it in a messaging-app context.
  { kind: 'messaging_platform', phrases: [
    'whatsapp', 'telegram', 'discord', 'wechat',
    'on signal', 'via signal', 'using signal', 'signal app', 'signal messenger', 'signal group', 'signal number'] },
  { kind: 'scam_promise', phrases: [
    'guaranteed income', 'guaranteed job', 'guaranteed employment',
    'instant selection', 'immediate selection', 'selected immediately',
    'earn money online', 'easy money', 'get rich',
    'data entry jobs', 'typing jobs', 'form filling', 'captcha work',
    'unlimited earning', 'be your own boss'] },
  { kind: 'gov_claim', phrases: [
    'government approved', 'govt approved', 'msme approved', 'msme registered',
    'aicte approved', 'aicte', 'government recognized', 'govt recognized',
    'ministry of', 'official partner of', 'affiliated with government',
    'government internship', 'govt internship', 'niti aayog'] },
  { kind: 'sens_gov_id', negationWindow: 60, phrases: [
    'aadhaar', 'aadhar', 'pan card', 'pan number', 'ssn', 'social security',
    'passport number', 'passport copy', 'copy of your passport',
    'driving license', "driver's license", 'voter id', 'voter card', 'ration card'] },
  { kind: 'sens_financial', negationWindow: 60, phrases: [
    'bank account', 'bank details', 'banking details', 'account number',
    'ifsc', 'credit card', 'debit card', 'card number', 'cvv',
    'net banking', 'upi pin', 'atm pin'] },
  { kind: 'sens_photo', negationWindow: 60, phrases: [
    'passport-size photograph', 'passport size photograph',
    'passport photo', 'photograph', 'photo id'] },
  { kind: 'sens_gov_id_generic', negationWindow: 60, phrases: ['identity proof', 'id proof', 'government id', 'govt id'] },
  { kind: 'no_interview', phrases: ['no interview required', 'no interview', 'no interviews', 'without interview', 'without an interview'] },
  { kind: 'instant_selection', phrases: [
    'instant selection', 'instant offer', 'instant hiring', 'instantly selected',
    'immediately selected', 'selected on the spot', 'on the spot selection', 'selected immediately'] },
  { kind: 'interview', negationWindow: 25, phrases: ['interview', 'interviews'] },
  { kind: 'interview_round', negationWindow: 25, phrases: ['round', 'rounds', 'technical', 'hr round'] },
  { kind: 'offer_letter_mention', phrases: ['offer letter'] },
  { kind: 'account_creation', phrases: ['create an account', 'register on', 'sign up on', 'create your profile on'] },
  { kind: 'download', phrases: ['download'] },
  // "application" must not count as "app" — word boundaries guarantee that.
  { kind: 'app_or_software', phrases: ['app', 'apk', 'software'] },
  { kind: 'work_from_home', phrases: ['work from home'] },
  { kind: 'template_phrase', fields: ['offerLetter'], phrases: [
    'dear candidate', 'dear applicant', 'congratulations on being selected', 'we are pleased to offer'] },
  // "candidate" / "update" contain the letters "date"; only the WORD or a real date counts.
  { kind: 'offer_date', fields: ['offerLetter'], phrases: ['date', 'dated'], patterns: DATE_PATTERNS },
  { kind: 'offer_compensation_term', fields: ['offerLetter'], phrases: ['salary', 'stipend', 'compensation', 'pay', 'paid', 'ctc', 'remuneration'] },
  { kind: 'mentorship', phrases: ['mentor', 'mentorship', 'mentoring'] },
  { kind: 'certificate', phrases: ['certificate'] },
  { kind: 'salary_or_stipend', negationWindow: 25, phrases: ['salary', 'stipend'] },
  { kind: 'unpaid', phrases: ['unpaid', 'no stipend', 'no salary'] },
  { kind: 'sales_target', phrases: ['sales target', 'fundraising', 'raise funds'] },
  { kind: 'project', phrases: ['project', 'projects'] },
  { kind: 'team_or_manager', phrases: ['team', 'manager'] },
  { kind: 'assessment', negationWindow: 25, phrases: ['assessment'] },
  { kind: 'comp_context', phrases: COMPENSATION_CONTEXT_PATTERNS },
];

// ───────────────────────────── money ─────────────────────────────

const CUR = '(?:₹|\\$|€|£|Rs\\.?|INR)';
const NUM = '\\d+(?:,\\d{2,3})*(?:\\.\\d+)?';
const SUF = '(?:\\s?(?:k|K|lakh|lakhs|crore|crores))?';
const PERIOD = '(?:\\s?\\/\\s?(?:month|mo|week|wk|hour|hr|day))?';
const MONEY_PREFIXED = new RegExp(`${CUR}\\s?${NUM}${SUF}(?:\\s?(?:-|–|—|to)\\s?(?:${CUR}\\s?)?${NUM}${SUF})?${PERIOD}`, 'g');
const MONEY_SUFFIXED = new RegExp(`(?<![A-Za-z0-9₹$€£.,])${NUM}\\s?(?:INR|rupees?|Rs\\.?)(?![A-Za-z])${PERIOD}`, 'gi');

function findAmounts(s: string): { text: string; idx: number }[] {
  const out: { text: string; idx: number }[] = [];
  for (const re of [MONEY_PREFIXED, MONEY_SUFFIXED]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      if (!out.some((o) => m!.index < o.idx + o.text.length && o.idx < m!.index + m![0].length)) {
        out.push({ text: m[0].trim(), idx: m.index });
      }
    }
  }
  return out.sort((a, b) => a.idx - b.idx);
}

// ───────────────────────────── clause splitting ─────────────────────────────

const MASKED_ABBREV = /\b(?:Rs|Pvt|Ltd|Mr|Mrs|Ms|Dr|Jr|Sr|No|approx|etc)\.|\b(?:e\.g|i\.e)\./gi;

/**
 * Splits a field into clauses: one per line, then by sentence end, ';', ' | '
 * and contrastive conjunctions. Splitting runs on a same-length MASKED copy
 * ("Rs." must not end a sentence) and slices the ORIGINAL, so offsets are exact.
 */
function splitClauses(text: string): { start: number; end: number }[] {
  const masked = text.replace(MASKED_ABBREV, (m) => m.slice(0, -1) + '~');
  const out: { start: number; end: number }[] = [];
  const splitter = /(?<=[a-z0-9)\]"'][.!?])\s+|;\s*|\s+\|\s+|\s+(?:but|while|whereas|however)\s+/gi;
  let lineStart = 0;
  for (const line of masked.split('\n')) {
    let cursor = 0;
    let m: RegExpExecArray | null;
    splitter.lastIndex = 0;
    const push = (a: number, b: number) => {
      let s = lineStart + a, e = lineStart + b;
      while (s < e && /\s/.test(text[s])) s++;
      while (e > s && /\s/.test(text[e - 1])) e--;
      if (e > s) out.push({ start: s, end: e });
    };
    while ((m = splitter.exec(line))) {
      push(cursor, m.index);
      cursor = m.index + m[0].length;
      if (m[0].length === 0) splitter.lastIndex++;
    }
    push(cursor, line.length);
    lineStart += line.length + 1;
  }
  return out;
}

function payVerbDirection(clause: string, idx: number): 'candidate_pays' | 'candidate_receives' | null {
  const words = clause.slice(0, idx).toLowerCase().split(/[^a-z']+/).filter(Boolean);
  if (words.length === 0) return 'candidate_pays'; // imperative: "Pay ₹999 to confirm"
  for (let i = words.length - 1, seen = 0; i >= 0 && seen < 4; i--, seen++) {
    if (COMPANY_SUBJECT.has(words[i])) return 'candidate_receives';
    if (CANDIDATE_SUBJECT.has(words[i])) return 'candidate_pays';
  }
  return null; // no subject evidence → not enough to call it a demand
}

interface Cue { phrase: string; idx: number }

type PayShape = Omit<PaymentFact, 'id' | 'origin' | 'span'>;
interface ClauseAnalysis {
  pay: PayShape | null;
  recv: PayShape | null;
  unknown: string[];
  /** Cues that matched but were not asserted (negated / warning / zero / free-of-charge). */
  suppressed: { cue: string; reason: string }[];
}

function analyseClause(c: string, lineTail = ''): ClauseAnalysis {
  const blanketFree = FREE_OF_CHARGE.test(c);
  const strongComp: Cue[] = findMentions(c, STRONG_COMP_CUES).map((m) => ({ phrase: m.phrase, idx: m.start }));
  const weakComp = findMentions(c, RATE_CUES);
  const amounts = findAmounts(c);

  const payCues: Cue[] = [];
  const recvCues: Cue[] = [...strongComp];
  const suppressed: { cue: string; reason: string }[] = [];
  let purpose: string | null = null;

  /**
   * THE gate. Every candidate-payment cue, whichever family it came from (fee
   * term, "pay ₹", purchase, transfer, crypto), is admitted only here.
   */
  const admit = (start: number, end: number, phrase: string, why: string): boolean => {
    const pol = blanketFree ? 'negated' : polarityOf(c, start, end, lineTail);
    if (pol !== 'asserted') { suppressed.push({ cue: phrase, reason: pol }); return false; }
    payCues.push({ phrase, idx: start });
    purpose ??= why;
    return true;
  };

  for (const m of findMentions(c, FEE_TERMS)) {
    // A fee the COMPANY pays ("the company bears the certification fee") is not a demand on the candidate.
    if (companyBearsCost(c, m.start, m.end)) {
      suppressed.push({ cue: c.slice(m.start, m.end), reason: 'company_bears' });
      continue;
    }
    admit(m.start, m.end, c.slice(m.start, m.end), m.phrase);
  }
  for (const m of findMentions(c, PAY_VERB_CUES)) {
    const dir = payVerbDirection(c, m.start);
    if (dir === 'candidate_pays') admit(m.start, m.end, c.slice(m.start, m.end), 'payment request');
    else if (dir === 'candidate_receives') recvCues.push({ phrase: c.slice(m.start, m.end), idx: m.start });
  }
  if (PURCHASE_OBJECT.test(c)) {
    for (const m of findMentions(c, PURCHASE_VERBS)) {
      const amt = amounts.find((a) => a.idx >= m.end && a.idx - m.end <= 60);
      if (!amt) continue;
      // Only a candidate subject (or an imperative) makes it a demand. "We will
      // purchase a laptop worth ₹50,000 for you" is the company spending, not a fee.
      if (payVerbDirection(c, m.start) !== 'candidate_pays') continue;
      const np = c.slice(amt.idx + amt.text.length).match(PURCHASE_PURPOSE);
      admit(m.start, m.end, c.slice(m.start, m.end), np ? np[1].trim() : 'mandatory purchase');
    }
  }
  // Transfers / gift cards / crypto are demands unless the clause is about pay TO the candidate.
  if (strongComp.length === 0) {
    for (const m of findMentions(c, TRANSFER_CUES)) {
      admit(m.start, m.end, c.slice(m.start, m.end), m.phrase);
    }
    if (findMentions(c, PAYMENT_DEMAND_VERBS).length > 0) {
      for (const m of findMentions(c, CRYPTO_TERMS)) {
        admit(m.start, m.end, c.slice(m.start, m.end), 'crypto payment');
      }
    }
  }

  // "Training fee: ₹0 (waived)" — a zero amount is the absence of a payment.
  if (payCues.length > 0 && amounts.length > 0 && allZero(amounts.map((a) => a.text))) {
    for (const q of payCues) suppressed.push({ cue: q.phrase, reason: 'zero_amount' });
    payCues.length = 0;
  }

  const role = (a: { idx: number }): PaymentDirection => {
    const dPay = Math.min(...payCues.map((q) => Math.abs(q.idx - a.idx)), Infinity);
    const dRecv = Math.min(...recvCues.map((q) => Math.abs(q.idx - a.idx)), Infinity);
    if (payCues.length && !recvCues.length) return 'candidate_pays';
    if (recvCues.length && !payCues.length) return 'candidate_receives';
    if (payCues.length && recvCues.length) return dRecv < dPay ? 'candidate_receives' : 'candidate_pays'; // tie → pay (safe side)
    return weakComp.length ? 'candidate_receives' : 'unknown';
  };
  const byRole = (d: PaymentDirection) => amounts.filter((a) => role(a) === d).map((a) => a.text);

  const uniq = (xs: string[]) => Array.from(new Set(xs));
  return {
    pay: payCues.length
      ? { kind: 'payment', direction: 'candidate_pays', purpose, cues: uniq(payCues.map((q) => q.phrase)), amounts: byRole('candidate_pays') }
      : null,
    recv: byRole('candidate_receives').length
      ? { kind: 'payment', direction: 'candidate_receives', purpose: null, cues: uniq(recvCues.map((q) => q.phrase)), amounts: byRole('candidate_receives') }
      : null,
    unknown: payCues.length || recvCues.length || weakComp.length ? [] : byRole('unknown'),
    suppressed,
  };
}

function domainOf(url: string): string | null {
  try {
    const u = new URL(url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

// ───────────────────────────── verification (the only minting point) ─────────────────────────────

type Sources = Record<SourceField, string>;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const flexIncludes = (hay: string, needle: string) => hay.toLowerCase().replace(/\s+/g, ' ').includes(needle.toLowerCase().replace(/\s+/g, ' '));

function spanHolds(span: Span, sources: Sources): boolean {
  return span.end > span.start && sources[span.field].slice(span.start, span.end) === span.quote;
}

/** Returns a reason string if the fact is NOT supported by its own span. */
function whyUnsupported(f: Fact, sources: Sources): string | null {
  if (!spanHolds(f.span, sources)) return 'span does not slice back to its quote';
  const q = f.span.quote;
  switch (f.kind) {
    case 'company': case 'recruiter_name':
      return norm(q).includes(norm(f.value)) && norm(f.value).length >= 2 ? null : 'value not derivable from quote';
    case 'recruiter_email': case 'website': case 'job_title': case 'job_url':
      return q.trim() === f.value.trim() ? null : 'typed value differs from its field';
    case 'brand':
      return phraseRe(f.value).test(q) ? null : 'brand not present in quote';
    case 'payment':
      if (!f.amounts.every((a) => flexIncludes(q, a))) return 'amount not present in quote';
      if (!f.cues.every((c) => flexIncludes(q, c))) return 'cue not present in quote';
      return null;
    case 'signal':
      return f.signal === 'offer_names_company' || f.signal === 'recruiter_name_in_text' || f.signal === 'offer_date'
        || phraseRe(f.phrase).test(q) ? null : 'phrase not present in quote';
    case 'document':
    case 'observation':
      return null;
  }
}

/** The ONLY function that creates `Verified<T>`. Not exported. */
function mint<T extends Fact>(f: T): Verified<T> {
  return f as Verified<T>;
}

// ───────────────────────────── extraction ─────────────────────────────

export interface ExtractOptions {
  /** Test seam / override for the external probes. Defaults to the real network probes. */
  probes?: {
    website?: (url: string) => Promise<WebsiteReachabilityResult>;
    domainAge?: (domain: string) => Promise<DomainAgeResult>;
  };
  llmApiKey?: string;
  /** Injection point for tests; defaults to the OpenRouter extractor. */
  llmExtractor?: (text: string) => Promise<LlmExtractionResult>;
}

function locateQuote(quote: string, sources: Sources): Span | null {
  const q = quote.trim();
  if (q.length < 2) return null;
  for (const field of TEXT_FIELDS) {
    const i = sources[field].indexOf(q);
    if (i >= 0) return { field, start: i, end: i + q.length, quote: q };
  }
  const flexible = new RegExp(escapeRe(q).replace(/\s+/g, '\\s+'), 'i');
  for (const field of TEXT_FIELDS) {
    const m = flexible.exec(sources[field]);
    if (m) return { field, start: m.index, end: m.index + m[0].length, quote: m[0] };
  }
  return null;
}

function hitSpan(hit: Hit, field: SourceField, text: string): Span {
  return { field, start: hit.start, end: hit.end, quote: text.slice(hit.start, hit.end) };
}

export async function extractFacts(input: OpportunityInput, options: ExtractOptions = {}): Promise<CanonicalFacts> {
  const sources: Sources = {
    company: input.company, recruiterName: input.recruiterName, recruiterEmail: input.recruiterEmail,
    companyWebsite: input.companyWebsite, jobTitle: input.jobTitle, jobPostingUrl: input.jobPostingUrl,
    description: input.description, recruiterMessage: input.recruiterMessage, offerLetter: input.offerLetter,
  };

  let n = 0;
  const nextId = () => `fact-${++n}`;
  const candidates: Fact[] = [];
  const suppressedList: CanonicalFacts['suppressed'] = [];
  const add = <T extends Fact>(f: T): T => { candidates.push(f); return f; };

  // 1. Typed identity fields — the user entered these, so the whole trimmed field is the quote.
  const typed = (field: SourceField, kind: IdentityKind): IdentityFact | null => {
    const raw = sources[field];
    const value = raw.trim();
    if (!value) return null;
    const start = raw.indexOf(value);
    return add({ id: nextId(), kind, origin: 'typed', value, span: { field, start, end: start + value.length, quote: value } });
  };
  let company = typed('company', 'company');
  let recruiterName = typed('recruiterName', 'recruiter_name');
  const recruiterEmail = typed('recruiterEmail', 'recruiter_email');
  const website = typed('companyWebsite', 'website');
  const jobTitle = typed('jobTitle', 'job_title');
  const jobUrl = typed('jobPostingUrl', 'job_url');

  // 2. Labelled / prose extraction from the pasted text, per field (so spans are exact).
  const fromText = <R,>(find: (t: string) => Hit | null, build: (hit: Hit, field: SourceField) => R): R | null => {
    for (const field of ['recruiterMessage', 'description', 'offerLetter'] as SourceField[]) {
      const hit = find(sources[field]);
      if (hit) return build(hit, field);
    }
    return null;
  };

  if (!company) {
    company = fromText(findCompanyLabelled, (hit, field) =>
      add({ id: nextId(), kind: 'company' as const, origin: 'labelled' as const, value: hit.value, span: hitSpan(hit, field, sources[field]) }));
  }
  if (!company) {
    company = fromText(findCompanyProse, (hit, field) =>
      add({ id: nextId(), kind: 'company' as const, origin: 'prose' as const, value: hit.value, span: hitSpan(hit, field, sources[field]) }));
  }
  if (!recruiterName) {
    recruiterName = fromText(findRecruiterName, (hit, field) =>
      add({ id: nextId(), kind: 'recruiter_name' as const, origin: 'labelled' as const, value: hit.value, span: hitSpan(hit, field, sources[field]) }));
  }

  // 3. LLM — a CANDIDATE source, consulted only for what is still missing. Any
  //    failure, or a candidate whose quote can't be located, leaves it UNKNOWN.
  let llmUsed = false;
  if ((!company || !recruiterName) && (options.llmExtractor || options.llmApiKey)) {
    const combined = TEXT_FIELDS.map((f) => sources[f]).join('\n');
    let llm: LlmExtractionResult = UNKNOWN_LLM_RESULT;
    try {
      llm = options.llmExtractor
        ? await options.llmExtractor(combined)
        : await extractWithLlm(combined, options.llmApiKey);
    } catch {
      llm = UNKNOWN_LLM_RESULT;
    }
    llmUsed = llm.usedLlm;
    if (!company && llm.company && llm.companyQuote) {
      const span = locateQuote(llm.companyQuote, sources);
      if (span) company = add({ id: nextId(), kind: 'company', origin: 'llm', value: llm.company, span });
    }
    if (!recruiterName && llm.recruiterName && llm.recruiterQuote) {
      const span = locateQuote(llm.recruiterQuote, sources);
      if (span) recruiterName = add({ id: nextId(), kind: 'recruiter_name', origin: 'llm', value: llm.recruiterName, span });
    }
  }

  // 4. Documents.
  for (const field of TEXT_FIELDS) {
    const raw = sources[field];
    if (!raw.trim()) continue;
    const start = raw.search(/\S/);
    const end = Math.min(raw.length, start + 80);
    add({ id: nextId(), kind: 'document', origin: 'derived', value: field, span: { field, start, end, quote: raw.slice(start, end) } });
  }

  // 5. Brands.
  extractBrands(sources, company, add, nextId);

  // 6. Payments, with direction.
  for (const field of TEXT_FIELDS) {
    const text = sources[field];
    const clauses = splitClauses(text);
    for (let i = 0; i < clauses.length; i++) {
      let { start, end } = clauses[i];
      let clause = text.slice(start, end);
      // "Training fee:\n₹999" — a label line followed by an amount-only line.
      const nextC = clauses[i + 1];
      if (nextC && /[:\-–—]\s*$/.test(clause) && FEE_TERMS.some((t) => phraseRe(t).test(clause)) && findAmounts(clause).length === 0) {
        const nextText = text.slice(nextC.start, nextC.end);
        const amts = findAmounts(nextText);
        if (amts.length === 1 && amts[0].text.length >= nextText.trim().length - 6) {
          end = nextC.end; clause = text.slice(start, end); i++;
        }
      }
      const lineEnd = text.indexOf('\n', end);
      const a = analyseClause(clause, text.slice(end, lineEnd === -1 ? text.length : lineEnd));
      for (const x of a.suppressed) suppressedList.push({ kind: 'payment', reason: `${x.reason}: ${x.cue}`, quote: clause });
      const span: Span = { field, start, end, quote: clause };
      if (a.pay) add({ id: nextId(), origin: 'derived', span, ...a.pay });
      if (a.recv) add({ id: nextId(), origin: 'derived', span, ...a.recv });
      if (a.unknown.length) add({ id: nextId(), kind: 'payment', origin: 'derived', span, direction: 'unknown', purpose: null, cues: [], amounts: a.unknown });
    }
  }

  // 7. Signals (atomic, word-boundary, negation-aware mentions with spans).
  for (const def of SIGNAL_DEFS) {
    for (const field of def.fields ?? TEXT_FIELDS) {
      const text = sources[field];
      if (!text.trim()) continue;
      for (const m of findMentions(text, def.phrases, def.negationWindow ?? 0)) {
        let phrase = m.phrase;
        if (def.kind === 'messaging_platform' && /signal/.test(phrase)) phrase = 'signal';
        add({ id: nextId(), kind: 'signal', origin: 'derived', signal: def.kind, phrase, negated: m.negated,
            ...(def.kind === 'sens_gov_id' || def.kind === 'sens_gov_id_generic'
            ? { idContext: classifyIdRequest(text, m.start, m.end, phrase) } : {}),
          span: { field, start: m.start, end: m.end, quote: text.slice(m.start, m.end) } });
      }
      for (const re of def.patterns ?? []) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
          add({ id: nextId(), kind: 'signal', origin: 'derived', signal: def.kind, phrase: 'date', negated: false,
            span: { field, start: m.index, end: m.index + m[0].length, quote: m[0] } });
        }
      }
    }
  }

  // 7b. Pressure = a time constraint COUPLED to coercion. A deadline, "urgent
  //     hiring" or "apply immediately" alone is a schedule, not pressure; it
  //     counts only with a stated consequence, an asserted payment demand, or a
  //     sensitive-data request in the same clause (or a consequence leading the next).
  const demandFacts = candidates.filter((f): f is PaymentFact => f.kind === 'payment' && f.direction === 'candidate_pays');
  const sensitiveFacts = candidates.filter((f): f is SignalFact => f.kind === 'signal' && f.signal.startsWith('sens_') && !f.negated);
  const overlaps = (sp: Span, field: SourceField, a: number, b: number) => sp.field === field && sp.start < b && a < sp.end;
  for (const field of TEXT_FIELDS) {
    const text = sources[field];
    if (!text.trim()) continue;
    const clauses = splitClauses(text);
    for (let i = 0; i < clauses.length; i++) {
      const { start, end } = clauses[i];
      const clause = text.slice(start, end);
      const urgency = [
        ...findMentions(clause, URGENCY_TERMS).map((m) => ({ s: m.start, e: m.end })),
        ...Array.from(clause.matchAll(URGENCY_PATTERN)).map((m) => ({ s: m.index!, e: m.index! + m[0].length })),
      ];
      // Expiry wording ("offer will expire") is a time limit; it is coercive only when the
      // same clause also has a COMPRESSED time constraint ("within 2 hours", "immediately").
      const compressed = COMPRESSED_TIME_PATTERN.test(clause) || findMentions(clause, COMPRESSED_URGENCY).length > 0;
      const expiry = compressed ? findMentions(clause, EXPIRY_CUES).map((m) => ({ s: m.start, e: m.end })) : [];
      const selfContained = [
        ...findMentions(clause, SELF_CONTAINED_COERCION).map((m) => ({ s: m.start, e: m.end })),
        ...expiry,
      ];
      if (urgency.length === 0 && selfContained.length === 0) continue;

      const nextText = i + 1 < clauses.length ? text.slice(clauses[i + 1].start, clauses[i + 1].end) : '';
      const coupled = findMentions(clause, CONSEQUENCE_CUES).length > 0
        || CONSEQUENCE_LEAD.test(nextText)
        || demandFacts.some((p) => overlaps(p.span, field, start, end))
        || sensitiveFacts.some((g) => overlaps(g.span, field, start, end));
      const emit = selfContained.length > 0 ? [...selfContained, ...urgency] : coupled ? urgency : [];
      if (emit.length === 0) {
        suppressedList.push({ kind: 'pressure', reason: 'time constraint without coercion (schedule / deadline)', quote: clause });
        continue;
      }
      for (const c of emit) {
        add({ id: nextId(), kind: 'signal', origin: 'derived', signal: 'pressure', negated: false,
          phrase: clause.slice(c.s, c.e).toLowerCase(),
          span: { field, start: start + c.s, end: start + c.e, quote: text.slice(start + c.s, start + c.e) } });
      }
    }
  }

  // 7c. External observations. Probes run HERE so that analyzer.ts is a pure
  //     function of verified facts. Each result is typed; a failure that could
  //     not have been observed (timeout, TLS, blocked, observer offline) is
  //     'inconclusive', never evidence about the site.
  if (website) {
    const domain = domainOf(website.value);
    const runSite = options.probes?.website ?? checkWebsiteReachable;
    const runAge = options.probes?.domainAge ?? lookupDomainAge;
    const unableSite: WebsiteReachabilityResult = { status: 'unable_to_verify' };
    const unableAge: DomainAgeResult = { status: 'unable_to_verify', ageDays: null, registeredDate: null };
    const [site, age] = await Promise.all([
      runSite(website.value).catch(() => unableSite),
      domain ? runAge(domain).catch(() => unableAge) : Promise.resolve(unableAge),
    ]);
    add({ id: nextId(), kind: 'observation', origin: 'derived', span: website.span, probe: 'website_reachability',
      outcome: site.status === 'reachable' ? 'reachable' : site.status === 'unreachable' ? 'dns_not_found' : 'inconclusive',
      httpStatus: site.httpStatus });
    add({ id: nextId(), kind: 'observation', origin: 'derived', span: website.span, probe: 'domain_age',
      outcome: age.status === 'known' && age.ageDays !== null ? 'known' : 'inconclusive',
      ageDays: age.ageDays, registeredDate: age.registeredDate });
  }

  // 8. Derived relations between verified facts and the text.
  if (company && sources.offerLetter.trim()) {
    const core = company.value
      .replace(new RegExp(`\\b(?:${CORPORATE_SUFFIX_WORDS.join('|')})\\b\\.?`, 'gi'), '')
      .replace(/[\s,.-]+$/, '').trim();
    if (core.length >= 2) {
      const m = new RegExp(escapeRe(core).replace(/\s+/g, '\\s+'), 'i').exec(sources.offerLetter);
      if (m) add({ id: nextId(), kind: 'signal', origin: 'derived', signal: 'offer_names_company', phrase: core, negated: false,
        span: { field: 'offerLetter', start: m.index, end: m.index + m[0].length, quote: m[0] } });
    }
  }
  if (recruiterName?.origin === 'typed') {
    // Only meaningful for a name the user typed; a name pulled OUT of the text is circular.
    const first = recruiterName.value.split(/\s+/)[0];
    for (const field of TEXT_FIELDS) {
      const m = phraseRe(first).exec(sources[field]);
      if (m) {
        add({ id: nextId(), kind: 'signal', origin: 'derived', signal: 'recruiter_name_in_text', phrase: first, negated: false,
          span: { field, start: m.index, end: m.index + m[0].length, quote: m[0] } });
        break;
      }
    }
  }

  // 9. Verify everything; only survivors are minted.
  const dropped: { kind: string; reason: string }[] = [];
  const verified: Verified<Fact>[] = [];
  const byId = new Map<string, Verified<Fact>>();
  for (const f of candidates) {
    const why = whyUnsupported(f, sources);
    if (why) { dropped.push({ kind: f.kind, reason: why }); continue; }
    const v = mint(f);
    verified.push(v);
    byId.set(v.id, v);
  }
  const ofKind = <K extends Fact['kind']>(k: K) => verified.filter((f): f is Verified<Extract<Fact, { kind: K }>> => f.kind === k);
  const identity = (f: IdentityFact | null) => (f && byId.has(f.id) ? (byId.get(f.id) as Verified<IdentityFact>) : null);

  const text = TEXT_FIELDS.map((f) => sources[f]).join(' ').trim();
  return {
    company: identity(company),
    recruiterName: identity(recruiterName),
    recruiterEmail: identity(recruiterEmail),
    website: identity(website),
    jobTitle: identity(jobTitle),
    jobUrl: identity(jobUrl),
    brands: ofKind('brand'),
    payments: ofKind('payment'),
    signals: ofKind('signal'),
    documents: ofKind('document'),
    observations: ofKind('observation'),
    suppressed: suppressedList,
    wordCount: text ? text.split(/\s+/).length : 0,
    textChars: text.length,
    llmUsed,
    dropped,
    byId,
  };
}

function extractBrands(
  sources: Sources,
  company: IdentityFact | null,
  add: <T extends Fact>(f: T) => T,
  nextId: () => string,
): void {
  const seen = new Set<string>();
  const stripCorp = (s: string) => s.replace(new RegExp(`\\b(?:${CORPORATE_SUFFIX_WORDS.join('|')})\\b\\.?`, 'gi'), '').replace(/[\s,.-]+/g, ' ').trim().toLowerCase();

  // (a) Brand inside the claimed company name itself.
  if (company) {
    for (const brand of BRAND_NAMES) {
      if (seen.has(brand) || !phraseRe(brand).test(company.value)) continue;
      if (AMBIGUOUS_BRANDS.has(brand) && stripCorp(company.value) !== brand) continue; // "Target Infosystems" ≠ Target
      seen.add(brand);
      add({ id: nextId(), kind: 'brand', origin: 'derived', value: brand, viaCompanyField: true, span: company.span });
    }
  }

  // (b) Brand claimed in free text.
  for (const field of TEXT_FIELDS) {
    const text = sources[field];
    for (const brand of BRAND_NAMES) {
      if (seen.has(brand)) continue;
      const re = phraseRe(brand);
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const start = m.index, end = m.index + m[0].length;
        if (!/^[A-Z]/.test(m[0])) continue; // a brand is a proper noun; lowercase prose isn't a claim

        // Part of a URL / email / domain token ("docs.google.com") is not an affiliation claim.
        let ts = start, te = end;
        while (ts > 0 && !/\s/.test(text[ts - 1])) ts--;
        while (te < text.length && !/\s/.test(text[te])) te++;
        if (/@|:\/\/|[A-Za-z0-9]\.[A-Za-z]{2,}/.test(text.slice(ts, te).replace(/[.,;:!?)]+$/, ''))) continue;

        const tail = text.slice(end, end + 30);
        const tools = TOOL_SUFFIX[brand];
        if (tools && new RegExp(`^\\s+(?:${tools})(?![A-Za-z0-9])`, 'i').test(tail)) continue; // "Google Meet"

        if (AMBIGUOUS_BRANDS.has(brand)) {
          const before = text.slice(Math.max(0, start - 20), start);
          const corpAfter = new RegExp(`^\\s+(?:${CORPORATE_SUFFIX_WORDS.join('|')}|careers|hr|recruitment|recruiter|team|hiring|technologies|platforms)(?![A-Za-z0-9])`, 'i');
          const corpBefore = /(?:\b(?:at|with|from|join|joining|for|by|representing)\s+)$/i;
          if (!corpAfter.test(tail) && !corpBefore.test(before)) continue;
        }

        seen.add(brand);
        add({ id: nextId(), kind: 'brand', origin: 'derived', value: brand, viaCompanyField: false,
          span: { field, start, end, quote: text.slice(start, end) } });
        break;
      }
    }
  }
}

// ───────────────────────────── read-only accessors for analyzers ─────────────────────────────

export function signalsOf(
  facts: CanonicalFacts,
  kind: SignalKind,
  opts: { field?: SourceField; includeNegated?: boolean } = {},
): Verified<SignalFact>[] {
  return facts.signals.filter((s) =>
    s.signal === kind && (opts.includeNegated || !s.negated) && (!opts.field || s.span.field === opts.field));
}

/** Distinct canonical phrases, in first-seen order. */
export function phrasesOf(signals: SignalFact[]): string[] {
  const seen = new Set<string>();
  for (const s of signals) seen.add(s.phrase.toLowerCase());
  return Array.from(seen);
}

export function paymentsOf(facts: CanonicalFacts, direction: PaymentDirection): Verified<PaymentFact>[] {
  return facts.payments.filter((p) => p.direction === direction);
}