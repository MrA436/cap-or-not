/**
 * CLAIM RESOLUTION — the gate between "a word appeared" and "the posting asserts X".
 *
 * facts.ts used to promote every lexical hit straight into a fact, and each
 * fact family decided context for itself: fee terms looked 40 characters back
 * for a negator, "pay ₹" looked nowhere, "₹0 (waived)" and "Fee: None" were
 * not understood, "Beware of fraudsters asking for a registration fee" read as
 * a demand, and "deadline" / "urgent" were facts on their own. A hit is not a
 * claim. This file is the single definition of when a hit becomes one:
 *
 *   polarityOf()      is the cue asserted, negated ("no fee", "Fee: none",
 *                     "never ask you to pay"), or a warning about fraud?
 *   allZero()         a "fee" of ₹0 is not a payment.
 *   pressure cues     time constraint alone is NOT pressure; it must be
 *                     coupled to a consequence or a demand (see facts.ts).
 *
 * Pure string functions, no I/O, no dependency on facts.ts.
 */

// ───────────────────────────── polarity ─────────────────────────────

const NEGATOR = /(?<![A-Za-z0-9'’])(?:no|not|without|never|none|nothing|nor|neither|cannot|zero|nil|can't|won't|don't|doesn't|isn't|aren't|cant|wont|dont|doesnt|isnt|arent|free of|free from|waive[sd]?|exempt(?:ed)?)(?![A-Za-z0-9'’])/gi;

// Where a negator's reach ends: another sentence, a label/value colon, a dash,
// a contrastive conjunction.
const HARD_BOUNDARY = /[\n;:]|[.!?](?=\s)|\s[-–—]\s|\s\|\s|\b(?:but|while|whereas|however)\b/gi;

// A new predicate after "and"/"," ("...do not provide a stipend AND candidates
// must pay") ends the negation; a noun list ("no fee AND deposit") does not.
const NEW_PREDICATE = /(?:,|\band\b|\bthen\b|\bso\b)\s+(?:(?:the|all|any|these|those)\s+)?(?:candidates?|you|they|we|applicants?|interns?|students?|must|need|needs|should|will|shall|are|is|have|has)\b/i;

const MAX_NEGATION_TOKENS = 10;

// "Training fee is not applicable", "Fee: None", "deposit? Not needed",
// "security deposit requests are fraud", "fee waived".
const AFTER_NEGATION = /^[\s:=\-–—?(\[]*(?:(?:requests?|demands?|charges?|payments?)\s+)?(?:(?:is|are|will\s+be|shall\s+be|would\s+be)\s+)?(?:(?:a|an)\s+)?(?:not\s+(?:required|applicable|needed|charged|collected|taken|payable|mandatory|asked)|never\s+\w+|waived(?:\s+off)?|nil|none|zero|free|n\/?a|exempt(?:ed)?|prohibited|illegal|fraud\w*|scam\w*|0(?![\d,]))(?![A-Za-z0-9])/i;

// Awareness language BEFORE the cue: the posting is warning about fees, not asking for one.
const WARNING_BEFORE = /(?<![A-Za-z0-9'’])(?:beware|fraud(?:s|ster|sters|ulent)?|scam(?:s|mer|mers)?|fake|phishing)(?![A-Za-z0-9'’])/i;

// A fee named while warning about OTHER parties ("report anyone who asks for a
// registration fee") is awareness language, not an ask. The actor must be an
// indefinite third party and a solicitation verb must sit right before the cue,
// so "anyone who wants the job must pay a fee" (a demand) is NOT matched.
const THIRD_PARTY_SOLICITATION = /(?<![A-Za-z0-9'’])(?:anyone|anybody|someone|somebody|any\s+(?:person|individual|party|agent|recruiter)|(?:those|people|persons|individuals)\s+(?:who|that)|unauthori[sz]ed\s+\w+|third[- ]part(?:y|ies))\b[^.!?;\n]{0,40}?\b(?:asks?|asking|demands?|demanding|requests?|requesting|charges?|charging|collects?|collecting)\b(?:\s+(?!(?:must|need|needs|should|shall|will|pay|has|have)\b)[A-Za-z'’-]+){0,3}\s*$/i;

// Who bears a cost. "The company bears the certification fee" / "the training
// fee is borne by us" name the COMPANY as payer, so the fee noun is not a demand
// on the candidate. Reimburse/refund are deliberately NOT here: "pay first, we
// will reimburse you" is a common scam shape, so it must stay a demand.
const COMPANY_ACTOR = '(?:the\\s+)?(?:company|employer|organi[sz]ation|firm|management|we|us)';
const COST_BEARING_VERB = '(?:bears?|will\\s+bear|covers?|will\\s+cover|pays?\\s+for|will\\s+pay\\s+for|pays?|will\\s+pay|sponsors?|will\\s+sponsor|funds?|will\\s+fund|waives?|will\\s+waive)';
const COMPANY_BEARS_BEFORE = new RegExp(`(?<![A-Za-z0-9'’])${COMPANY_ACTOR}\\s+(?:also\\s+|fully\\s+|entirely\\s+)?${COST_BEARING_VERB}\\b((?:\\s+[A-Za-z'’-]+){0,6})\\s*$`, 'i');
const COMPANY_BEARS_AFTER = /^\W*(?:is|are|will\s+be|shall\s+be)\s+(?:fully\s+|entirely\s+)?(?:borne|paid|covered|sponsored|funded|waived)\s+(?:for\s+)?by\s+(?:the\s+)?(?:company|employer|organi[sz]ation|firm|management|us)\b/i;
const CANDIDATE_PAYS_WORDS = /\b(?:pay|must|you|candidates?|applicants?)\b/i;

/** True when the text around [start,end) names the COMPANY as the party paying for that cost. */
export function companyBearsCost(text: string, start: number, end: number): boolean {
  const before = COMPANY_BEARS_BEFORE.exec(text.slice(scopeStart(text, start), start));
  if (before && !CANDIDATE_PAYS_WORDS.test(before[1] ?? '')) return true;
  return COMPANY_BEARS_AFTER.test(text.slice(end, end + 90));
}

function scopeStart(text: string, pos: number): number {
  let s = 0;
  const head = text.slice(0, pos);
  HARD_BOUNDARY.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HARD_BOUNDARY.exec(head))) {
    s = m.index + m[0].length;
    if (m[0].length === 0) HARD_BOUNDARY.lastIndex++;
  }
  return s;
}

/**
 * True when a negator governs position `pos`: same clause, within
 * MAX_NEGATION_TOKENS words, and no new predicate in between.
 * The one negation definition for payment cues AND signals.
 */
export function negatedBefore(text: string, pos: number): boolean {
  const seg = text.slice(scopeStart(text, pos), pos);
  let last: RegExpExecArray | null = null;
  NEGATOR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NEGATOR.exec(seg))) {
    last = m;
    if (m[0].length === 0) NEGATOR.lastIndex++;
  }
  if (!last) return false;
  const between = seg.slice(last.index + last[0].length);
  if (between.split(/\s+/).filter(Boolean).length > MAX_NEGATION_TOKENS) return false;
  return !NEW_PREDICATE.test(between);
}

export type Polarity = 'asserted' | 'negated' | 'warning';

/**
 * Is the cue at [start,end) of `text` actually asserted by the posting?
 * `lineTail` is the rest of the same line after `text` (a clause may end at a
 * "?" that belongs to the cue: "Security deposit? Not needed.").
 */
export function polarityOf(text: string, start: number, end: number, lineTail = ''): Polarity {
  if (negatedBefore(text, start)) return 'negated';
  if (AFTER_NEGATION.test((text.slice(end) + lineTail).slice(0, 60))) return 'negated';
  const seg = text.slice(scopeStart(text, start), start);
  if (WARNING_BEFORE.test(seg) || THIRD_PARTY_SOLICITATION.test(seg)) return 'warning';
  return 'asserted';
}

/** True when every number in the given amounts is zero ("₹0", "Rs. 0.00"). */
export function allZero(amountTexts: string[]): boolean {
  if (amountTexts.length === 0) return false;
  return amountTexts.every((t) => {
    const nums = t.match(/\d[\d,]*(?:\.\d+)?/g);
    return !!nums && nums.every((n) => parseFloat(n.replace(/,/g, '')) === 0);
  });
}

// ───────────────────────────── pressure ─────────────────────────────
//
// Pressure is not "the text mentions time". An application deadline, "urgent
// hiring" or "apply immediately by sending your CV" describe a schedule. It
// becomes pressure when a time constraint is COUPLED to coercion: a stated
// consequence ("otherwise your seat will be cancelled") or a demand (a payment
// or sensitive-data request in the same clause). facts.ts does the coupling;
// these are the cues it couples.

/** Time constraints. Neutral on their own. */
export const URGENCY_TERMS = [
  'urgent', 'urgently', 'immediately', 'asap', 'right away', 'hurry', 'limited time',
  'deadline', "don't miss", 'act now', 'respond quickly', 'quick response',
  'closing soon', 'today only', 'apply now or', 'now', 'at once',
];
export const URGENCY_PATTERN = /\b(?:within|in)\s+(?:the\s+next\s+)?\d+\s*(?:hours?|hrs?|minutes?|mins?)\b/gi;

/** Phrases that already state a consequence; coercive on their own. */
export const SELF_CONTAINED_COERCION = [
  'offer will be withdrawn',
  'offer will be cancelled', 'offer will be canceled', 'last chance',
];

/** A consequence that couples to a time constraint in the same clause. */
export const CONSEQUENCE_CUES = [
  'otherwise', 'or else', 'failing which', 'will be cancelled', 'will be canceled',
  'will be withdrawn', 'will be revoked', 'will be forfeited', 'will be given to',
  'will be released', 'you will lose', 'will lose',
  'forfeit', 'seat will be', 'slot will be', 'position will be',
];

/** A consequence stated at the START of the next clause ("... immediately. Otherwise ..."). */
/**
 * Expiry wording states a time LIMIT ("offer will expire on 30 Oct", "the link
 * will expire after the deadline"), which every genuine offer has. It is
 * coercive only when the time limit is COMPRESSED (see below), never because of
 * a calendar date or the word "deadline".
 */
export const EXPIRY_CUES = ['offer expires', 'offer will expire', 'will expire', 'will lapse'];

/** Compressed time constraints (minutes/hours, "immediately"). Calendar deadlines are deliberately NOT here. */
export const COMPRESSED_URGENCY = ['urgent', 'urgently', 'immediately', 'asap', 'right away', 'at once', 'today only', 'act now', 'hurry'];

export const CONSEQUENCE_LEAD = /^\s*(?:otherwise|or else|failing which|else)\b/i;

// ───────────── government-ID requests: WHEN it is asked, and WHAT ─────────────
export type IdStage = 'post_selection' | 'application' | 'unspecified';
export type IdForm = 'number' | 'document' | 'unspecified';
export interface IdContext { stage: IdStage; form: IdForm }

const ID_POST_SELECTION = /\b(?:selected|successful)\s+(?:candidates?|applicants?|interns?)\b|\b(?:once|after|upon)\s+(?:you\s+(?:are|have\s+been|get|were)\s+)?(?:selected|selection)\b|\b(?:after|upon)\s+(?:you\s+)?(?:accept(?:ing|ance)?|receiv(?:ing|ed)|receipt\s+of)\s+(?:of\s+)?(?:the|your)\s+offer\b|\b(?:on|at|upon|during|after|before|prior\s+to)\s+(?:your\s+)?(?:joining|onboarding)\b|\bbefore\s+(?:the\s+)?(?:internship|job|role|employment|work)\s+(?:begins|starts|commences)\b|\bbefore\s+(?:your\s+|the\s+)?(?:start\s+date|first\s+day|day\s+one)\b|\b(?:on|during)\s+(?:your\s+)?(?:first|1st)\s+day\b|\bonce\s+you\s+(?:join|accept)\b|\bjoining\s+formalities\b|\bnew\s+joiners?\b|\bfor\s+onboarding\b/i;

const ID_EARLY_STAGE = /\b(?:to|for|while|when|before)\s+(?:apply(?:ing)?|regist(?:er|ering|ration)|submitting\s+(?:your\s+|an\s+)?application)\b|\b(?:with|along\s+with)\s+(?:your\s+|the\s+|an\s+)?(?:application|resume|cv)\b|\bapplication\s+form\b|\bat\s+the\s+time\s+of\s+(?:application|applying|registration)\b|\b(?:to|for)\s+(?:be\s+considered|be\s+shortlisted|get\s+shortlisted|schedule|book)\b|\b(?:before|prior\s+to)\s+(?:the\s+|your\s+)?(?:interview|assessment|assignment|test|shortlisting|selection|offer)\b|\bto\s+(?:confirm|secure|reserve|finali[sz]e|complete)\s+(?:your\s+)?(?:selection|seat|slot|candidature|application|registration|enrol(?:l)?ment|booking)\b|\bto\s+(?:receive|get|release|unlock|obtain|download)\s+(?:the\s+|your\s+)?offer\b|\bto\s+proceed\b|\bbefore\s+we\s+proceed\b|\bshortlisted\s+(?:candidates?|applicants?)\b/i;

const ID_NUMBER_AFTER = /^\s{0,3}(?:card\s+|id\s+)?(?:number|no\b\.?|num\b|#)/i;
const ID_DOCUMENT_AFTER = /^\s{0,3}(?:card|cards|copy|copies|document|documents|scan|scans|photocopy|proof)\b/i;
const ID_DOCUMENT_BEFORE = /\b(?:cop(?:y|ies)|scans?|scanned|photocopy|photocopies|upload|attach(?:ment)?|soft\s+copy|picture|image|photo)\s+(?:of\s+)?(?:your\s+|the\s+|a\s+|an\s+|their\s+)?(?:[A-Za-z-]+\s+){0,2}$/i;
const ID_NUMBER_PHRASE = /\bnumber\b|^(?:ssn|social security)$/;
const ID_DOCUMENT_PHRASE = /\b(?:card|copy|licen[sc]e|id|proof)\b/;
const SENTENCE_END = /[.!?\n]/;

/** Stage and form of one government-ID mention at [start,end) of `text`. */
export function classifyIdRequest(text: string, start: number, end: number, phrase: string): IdContext {
  let s = start;
  while (s > 0 && !SENTENCE_END.test(text[s - 1])) s--;
  let e = end;
  while (e < text.length && !SENTENCE_END.test(text[e])) e++;
  const sentence = text.slice(s, e);

  // Application-stage wording wins: "selected candidates ... to receive the offer" is not routine onboarding.
  const stage: IdStage = ID_EARLY_STAGE.test(sentence) ? 'application'
    : ID_POST_SELECTION.test(sentence) ? 'post_selection'
    : 'unspecified';

  const p = phrase.toLowerCase();
  const after = text.slice(end, end + 25);
  const before = text.slice(Math.max(s, start - 40), start);
  const form: IdForm = ID_NUMBER_PHRASE.test(p) || ID_NUMBER_AFTER.test(after) ? 'number'
    : ID_DOCUMENT_PHRASE.test(p) || ID_DOCUMENT_AFTER.test(after) || ID_DOCUMENT_BEFORE.test(before) ? 'document'
    : 'unspecified';
  return { stage, form };
}