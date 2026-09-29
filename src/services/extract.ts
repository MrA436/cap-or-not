/**
 * Deterministic field extraction from pasted free text.
 *
 * Design rule: precision over recall. A missed extraction falls back to the
 * honest "not provided" gap; a WRONG extraction would put a made-up fact in
 * front of the user. So every candidate is validated, and anything that looks
 * like a placeholder, a team/department, or a sentence fragment is rejected.
 *
 * This is also the fallback path for a future LLM extraction layer: if the
 * LLM call fails or times out, this still runs.
 */

// Labels that introduce a named person. Order doesn't matter; all are tried.
const RECRUITER_LABELS = [
  'recruiter name',
  'recruiter',
  'hiring manager',
  'hr manager',
  'hr executive',
  'hr name',
  'talent acquisition',
  'contact person',
  'point of contact',
  'posted by',
];

const TITLE_PREFIX = /^(?:mr|mrs|ms|miss|dr|shri|smt)\.?\s+/i;

// Words that mean the "name" is actually a placeholder, a team, or a phrase.
const NON_NAME_WORDS = new Set([
  'team', 'department', 'dept', 'hr', 'recruitment', 'recruiting', 'hiring',
  'careers', 'support', 'admin', 'office', 'desk', 'manager', 'executive',
  'company', 'pvt', 'ltd', 'llp', 'inc', 'solutions', 'technologies',
  'contact', 'call', 'whatsapp', 'email', 'mail', 'phone', 'apply', 'via',
  'on', 'at', 'to', 'us', 'the', 'will', 'is', 'are', 'not', 'none', 'na',
  'n/a', 'nil', 'tbd', 'unknown', 'anonymous', 'confidential', 'provided',
  'available', 'details', 'name', 'and', 'or', 'for', 'from', 'with',
]);

function isNameToken(tok: string): boolean {
  // "Ankit", "Sharma", "O'Neil", "Anne-Marie", "K." — must start uppercase
  // (or be an all-caps word like "ANKIT", handled by the caller).
  return /^[A-Z][A-Za-z'’-]*\.?$/.test(tok);
}

function toTitleCase(tok: string): string {
  return tok.length > 1 && tok === tok.toUpperCase()
    ? tok.charAt(0) + tok.slice(1).toLowerCase()
    : tok;
}

/**
 * Takes the remainder of a line after a label and returns a person's name,
 * or null if it doesn't look like one. Accepts 1-4 name tokens (a single
 * first name like "Priya" is a legitimate recruiter identity).
 */
function parseNameFromRemainder(remainder: string): string | null {
  // Stop at the first separator that ends a name on a line.
  const cut = remainder.split(/[,|(<@\d:;/\\]|\s[-–—]\s|\s{2,}/)[0].trim();
  let rest = cut.replace(TITLE_PREFIX, '');
  if (!rest) return null;

  const tokens: string[] = [];
  for (const tok of rest.split(/\s+/)) {
    if (!isNameToken(tok)) break;
    if (NON_NAME_WORDS.has(tok.toLowerCase().replace(/\.$/, ''))) break;
    tokens.push(tok);
    if (tokens.length === 4) break;
  }
  if (tokens.length === 0) return null;

  // If a stop-word directly follows the name tokens that's fine ("Ankit Sharma
  // on WhatsApp") — we already cut at the first non-name token. But if NOTHING
  // valid was consumed from the start of the remainder, reject.
  const name = tokens.map(toTitleCase).join(' ').replace(/\.$/, '');
  if (name.replace(/[^A-Za-z]/g, '').length < 2) return null;
  return name;
}

/**
 * Finds a recruiter name written as a labelled field, e.g.
 *   "Recruiter: Ankit Sharma"
 *   "Hiring Manager - Priya Nair"
 *   "Contact Person : Mr. Rahul Verma"
 * Returns null if nothing trustworthy is found.
 */
export function inferRecruiterName(text: string): string | null {
  if (!text.trim()) return null;

  for (const line of text.split(/\r?\n/)) {
    for (const label of RECRUITER_LABELS) {
      // Label must start the line (after bullets/emoji/whitespace) so we don't
      // match "our recruiter: ..." buried inside a sentence.
      const re = new RegExp(
        `^[\\s>*•\\-–—\\p{Extended_Pictographic}\\uFE0F]*${label.replace(/ /g, '\\s+')}\\s*(?::|-|–|—)\\s*(.+)$`,
        'iu',
      );
      const m = line.match(re);
      if (!m) continue;
      const name = parseNameFromRemainder(m[1]);
      if (name) return name;
    }
  }
  return null;
}