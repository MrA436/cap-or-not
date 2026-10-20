/**
 * Deterministic, span-returning field extractors for pasted free text.
 *
 * Design rule: precision over recall. A missed extraction becomes an honest
 * UNKNOWN; a WRONG extraction would put a made-up fact in front of the user.
 *
 * Every extractor here returns a `Hit`: the normalized value PLUS the exact
 * [start, end) range of the raw text it came from. facts.ts turns hits into
 * canonical facts and re-verifies the range before anything may rely on it.
 * Nothing in this file is imported by the analyzers; only facts.ts is.
 */

/** `text.slice(start, end)` is the verbatim quote the value was read from. */
export interface Hit {
  value: string;
  start: number;
  end: number;
}

type Parsed = Hit; // offsets relative to the string handed to the parser

const RECRUITER_LABELS = [
  'recruiter name', 'recruiter', 'hiring manager', 'hr manager', 'hr executive',
  'hr name', 'talent acquisition', 'contact person', 'point of contact', 'posted by',
];

const COMPANY_LABELS = [
  'company name', 'company', 'organization', 'organisation', 'hiring company',
  'employer', 'about the company',
];

const TITLE_PREFIX = /^(?:mr|mrs|ms|miss|dr|shri|smt)\.?\s+/i;

// Words that mean the "name" is a placeholder, a team, or a phrase — used for
// PERSON names only. Company names legitimately contain "solutions", "pvt", ...
const NON_NAME_WORDS = new Set([
  'team', 'department', 'dept', 'hr', 'recruitment', 'recruiting', 'hiring',
  'careers', 'support', 'admin', 'office', 'desk', 'manager', 'executive',
  'company', 'pvt', 'ltd', 'llp', 'inc', 'solutions', 'technologies',
  'contact', 'call', 'whatsapp', 'email', 'mail', 'phone', 'apply', 'via',
  'on', 'at', 'to', 'us', 'the', 'will', 'is', 'are', 'not', 'none', 'na',
  'n/a', 'nil', 'tbd', 'unknown', 'anonymous', 'confidential', 'provided',
  'available', 'details', 'name', 'and', 'or', 'for', 'from', 'with',
]);

// Whole-value placeholders — a company name legitimately contains "company"/"ltd".
const PLACEHOLDER_COMPANY_VALUES = new Set([
  'n/a', 'na', 'nil', 'tbd', 'unknown', 'anonymous', 'confidential',
  'not provided', 'not disclosed', 'not specified', 'various', 'multiple',
  'company name', 'your company', 'company', 'reputed company',
  'leading company', 'pvt ltd', 'private limited', 'the company',
  'xyz company', 'abc company', 'xyz pvt ltd', 'xyz corp',
]);

const COMMON_NON_COMPANY_WORDS = new Set([
  'we', 'our', 'the', 'this', 'you', 'your', 'about', 'role', 'job',
  'position', 'team', 'company', 'apply', 'work', 'i', 'a', 'an',
]);

const EMPHASIS = /[*_`~]/;

function isNameToken(tok: string): boolean {
  return /^[A-Z][A-Za-z'’-]*\.?$/.test(tok);
}

function toTitleCase(tok: string): string {
  return tok.length > 1 && tok === tok.toUpperCase() ? tok.charAt(0) + tok.slice(1).toLowerCase() : tok;
}

/** Strips markdown emphasis / spaces from both ends, returning the trimmed range. */
function trimRange(s: string, start: number, end: number): [number, number] {
  while (start < end && (EMPHASIS.test(s[start]) || /\s/.test(s[start]))) start++;
  while (end > start && (EMPHASIS.test(s[end - 1]) || /\s/.test(s[end - 1]))) end--;
  return [start, end];
}

function parseNameFromRemainder(remainder: string): Parsed | null {
  // Stop at the first separator that ends a name. Only 3+ spaces or a tab
  // count as a column break — a double space inside "Ankit  Sharma" must not.
  const cut = remainder.split(/[,|(<@\d:;/\\]|\s[-–—]\s|\t|\s{3,}/)[0];
  let [s, e] = trimRange(cut, 0, cut.length);
  const tp = cut.slice(s, e).match(TITLE_PREFIX);
  if (tp) s += tp[0].length;
  const rest = cut.slice(s, e);
  if (!rest) return null;

  const tokens: { t: string; s: number; e: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest))) {
    const tok = m[0];
    if (!isNameToken(tok)) break;
    if (NON_NAME_WORDS.has(tok.toLowerCase().replace(/\.$/, ''))) break;
    tokens.push({ t: tok, s: s + m.index, e: s + m.index + tok.length });
    if (tokens.length === 4) break;
  }
  if (tokens.length === 0) return null;

  const last = tokens[tokens.length - 1];
  const value = tokens.map((x) => toTitleCase(x.t)).join(' ').replace(/\.$/, '');
  if (value.replace(/[^A-Za-z]/g, '').length < 2) return null;
  return { value, start: tokens[0].s, end: last.t.endsWith('.') ? last.e - 1 : last.e };
}

function parseCompanyFromRemainder(remainder: string): Parsed | null {
  // Allow internal commas/periods/ampersands/parens ("Tata Consultancy Services Ltd.", "AT&T").
  const cut = remainder.split(/[|<@]|\s[-–—]\s|\t|\s{3,}/)[0];
  let [s, e] = trimRange(cut, 0, cut.length);
  if (e > s && cut[e - 1] === '.') [s, e] = trimRange(cut, s, e - 1);
  const value = cut.slice(s, e);
  if (value.length < 2 || value.length > 80) return null;
  if (!/[A-Za-z]/.test(value)) return null;
  if (/https?:\/\/|^www\./i.test(value)) return null;
  if (PLACEHOLDER_COMPANY_VALUES.has(value.toLowerCase())) return null;
  if (/^(pvt\.?\s*ltd\.?|private\s*limited|llp|inc\.?|llc)$/i.test(value)) return null;
  return { value, start: s, end: e };
}

/**
 * Scans `text` line by line for any of `labels` introducing a value, either on
 * the SAME line ("Label: value", also "**Label:** value") or, when the label
 * line has nothing after it, on the NEXT non-blank line.
 */
function findLabelledHit(
  text: string,
  labels: string[],
  parse: (remainder: string) => Parsed | null,
): Hit | null {
  if (!text.trim()) return null;
  const lines = text.split('\n');
  const offsets: number[] = [];
  let acc = 0;
  for (const l of lines) { offsets.push(acc); acc += l.length + 1; }
  const body = (i: number) => lines[i].replace(/\r$/, '');

  for (let i = 0; i < lines.length; i++) {
    for (const label of labels) {
      const re = new RegExp(
        `^[\\s>*_#\`•\\-–—\\p{Extended_Pictographic}\\uFE0F]*${label.replace(/ /g, '\\s+')}[*_\`\\s]*(?::|-|–|—)[*_\`\\s]*(.*)$`,
        'iu',
      );
      const line = body(i);
      const m = line.match(re);
      if (!m) continue;

      // The capture is always a suffix of the line, so its offset is exact.
      const remStart = offsets[i] + line.length - m[1].length;
      const same = parse(m[1]);
      if (same) return { value: same.value, start: remStart + same.start, end: remStart + same.end };

      // Only fall through to the next line when the label line was ONLY the label.
      if (m[1].trim().length === 0) {
        for (let j = i + 1; j < lines.length; j++) {
          const next = body(j);
          if (!next.trim()) continue;
          const nv = parse(next);
          if (nv) return { value: nv.value, start: offsets[j] + nv.start, end: offsets[j] + nv.end };
          break; // first non-blank line didn't work — don't scan past it
        }
      }
    }
  }
  return null;
}

export function findRecruiterName(text: string): Hit | null {
  return findLabelledHit(text, RECRUITER_LABELS, parseNameFromRemainder);
}

/** An explicit labelled company ("Company: X") — a direct claim in the posting. */
export function findCompanyLabelled(text: string): Hit | null {
  return findLabelledHit(text, COMPANY_LABELS, parseCompanyFromRemainder);
}

/**
 * Loose prose inference ("Join Acme Corp as...") — weaker than a label, so
 * facts.ts tags it origin='prose' and the report words it as best-effort.
 */
export function findCompanyProse(text: string): Hit | null {
  const patterns = [
    /\babout\s+(?:the\s+job\s*[\r\n]+)?([A-Z][A-Za-z0-9&.,'-]{1,40}?)\s+(?:creates|is|builds|provides|offers|helps|was founded|specializes|develops)\b/i,
    /\bjoin\s+([A-Z][A-Za-z0-9&.,'-]{1,40}?)(?:[.,!]|\s+as\s+|\s+to\s+)/,
    /^([A-Z][A-Za-z0-9&.,'-]{1,40}?)\s+is\s+(?:a|an|looking for|hiring|seeking)\b/m,
    /\bat\s+([A-Z][A-Za-z0-9&.,'-]{1,40}?)[.,!\n]/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    const candidate = m?.[1]?.trim();
    if (!m || m.index === undefined || !candidate) continue;
    if (candidate.length < 2 || COMMON_NON_COMPANY_WORDS.has(candidate.toLowerCase())) continue;
    const at = m.index + m[0].indexOf(candidate, 1);
    return { value: candidate, start: at, end: at + candidate.length };
  }
  return null;
}

// String-returning wrappers, kept for scripts/test-extract.mts and callers
// that only need the value.
export function inferRecruiterName(text: string): string | null {
  return findRecruiterName(text)?.value ?? null;
}
export function inferCompanyNameFromLabel(text: string): string | null {
  return findCompanyLabelled(text)?.value ?? null;
}