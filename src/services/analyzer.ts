import type {
  Finding,
  CategoryResult,
  AnalysisResult,
  OpportunityInput,
  RiskLevel,
  OpportunityQuality,
  PublicAnalysisResult,
  VerificationConfidence,
  RecommendedActionPlan,
  PreviewTier,
} from '../types/analysis.js';
import { lookupDomainAge } from './rdap.js';
import { checkWebsiteReachable } from './websiteCheck.js';

function getDomainFromUrl(url: string): string | null {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function getDomainFromEmail(email: string): string | null {
  const match = email.trim().toLowerCase().match(/@([\w.-]+)/);
  return match ? match[1] : null;
}

const COMMON_NON_COMPANY_WORDS = new Set([
  'we', 'our', 'the', 'this', 'you', 'your', 'about', 'role', 'job',
  'position', 'team', 'company', 'apply', 'work', 'i', 'a', 'an',
]);

/**
 * Best-effort company name extraction from unstructured pasted text or a
 * website domain, used only when the person didn't type a company name
 * themselves. This is regex/heuristic-based, not real NLP — it exists so
 * an obviously-named company (e.g. "Parsewave creates high-quality...")
 * doesn't get reported as a verification gap when the name is sitting
 * right there in the text. Returns null rather than guessing wrong; a
 * missed extraction just falls back to the honest "not provided" gap.
 */
function inferCompanyName(text: string): string | null {
  const patterns = [
    /\babout\s+(?:the\s+job\s*[\r\n]+)?([A-Z][A-Za-z0-9&.,'-]{1,40}?)\s+(?:creates|is|builds|provides|offers|helps|was founded|specializes|develops)\b/i,
    /\bjoin\s+([A-Z][A-Za-z0-9&.,'-]{1,40}?)(?:[.,!]|\s+as\s+|\s+to\s+)/,
    /^([A-Z][A-Za-z0-9&.,'-]{1,40}?)\s+is\s+(?:a|an|looking for|hiring|seeking)\b/m,
    /\bat\s+([A-Z][A-Za-z0-9&.,'-]{1,40}?)[.,!\n]/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    const candidate = m?.[1]?.trim();
    if (candidate && candidate.length > 1 && !COMMON_NON_COMPANY_WORDS.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return null;
}

function inferCompanyNameFromWebsite(website: string): string | null {
  const domain = getDomainFromUrl(website);
  if (!domain) return null;
  const label = domain.split('.')[0];
  if (!label || label.length < 2) return null;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const FREE_EMAIL_PROVIDERS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com',
  'icloud.com', 'aol.com', 'protonmail.com', 'mail.com', 'yandex.com',
  'zoho.com', 'gmx.com', 'rediff.com', 'yahoo.co.in', 'rocketmail.com',
]);

const MESSAGING_PLATFORMS = ['whatsapp', 'telegram', 'signal', 'discord', 'wechat'];
const JOB_PLATFORMS = ['linkedin', 'indeed', 'glassdoor', 'naukri', 'internshala', 'monster', 'angel.co', 'wellfound'];

// Phrases that inherently describe the applicant being asked to pay the
// company — these are safe to flag on their own.
const PAYMENT_DEMAND_KEYWORDS = [
  'registration fee', 'application fee', 'security deposit', 'training fee',
  'training cost', 'certification fee', 'certificate fee', 'laptop deposit',
  'equipment deposit', 'equipment fee', 'refundable deposit', 'onboarding fee',
  'onboarding charge', 'interview fee', 'registration charge', 'processing fee',
  'security money', 'advance payment', 'upfront payment',
  'pay ₹', 'pay rs', 'pay $', 'transfer funds', 'wire transfer', 'bank transfer',
  'gift card', 'amazon gift', 'itunes gift', 'google play gift',
  'wire money', 'send money', 'registration amount', 'payment required',
  'training charges', 'course fee',
];

// Crypto terms are only meaningful as a red flag when paired with an
// actual payment-demand verb nearby — a bare mention of "ether" or
// "crypto" isn't evidence of anything asked of the applicant.
const CRYPTO_TERMS = ['bitcoin', 'cryptocurrency', 'crypto payment', 'usdt', 'ether', 'eth wallet'];
const PAYMENT_DEMAND_VERBS = ['pay', 'payment', 'send', 'transfer', 'deposit', 'wire'];

// If these appear in the same sentence as a dollar amount, that amount is
// compensation being offered TO the applicant, not a payment being
// demanded FROM them — the opposite of a red flag.
const COMPENSATION_CONTEXT_PATTERNS = [
  'per month', '/month', 'per week', '/week', 'per hour', '/hour', 'per day',
  'salary', 'compensation', 'stipend', 'paid trial', 'you will be paid',
  'you will receive', 'we pay', 'earned by', 'monthly pay', 'take-home',
  'base pay', 'pay range', 'above market', 'market average', 'earn up to',
];

const PRESSURE_KEYWORDS = [
  'urgent', 'immediately', 'asap', 'right away', 'limited time', 'offer expires',
  'act now', 'respond quickly', 'quick response', 'deadline', 'last chance',
  'hurry', 'don\'t miss', 'closing soon', 'apply now or',
];

const SCAM_JOB_KEYWORDS = [
  'no experience required', 'no experience needed', 'no skills required',
  'no interview required', 'guaranteed income', 'guaranteed job',
  'guaranteed employment', 'instant selection', 'immediate selection',
  'selected immediately', 'work from home', 'earn money online',
  'easy money', 'get rich', 'earn ₹', 'earn $', 'per day', 'per week',
  'data entry jobs', 'typing jobs', 'form filling', 'captcha work',
  'unlimited earning', 'be your own boss',
];

const BRAND_NAMES = [
  'amazon', 'google', 'microsoft', 'apple', 'facebook', 'meta', 'netflix',
  'ibm', 'oracle', 'salesforce', 'adobe', 'intel', 'cisco', 'tesla',
  'walmart', 'target', 'jpmorgan', 'goldman sachs', 'morgan stanley',
  'deloitte', 'ey', 'pwc', 'kpmg', 'accenture', 'capgemini', 'tata',
  'infosys', 'wipro', 'tcs', 'hcl', 'cognizant', 'flipkart', 'swiggy',
  'zomato', 'paytm', 'phonepe', 'reliance', 'airtel', 'jio',
];

const GOVERNMENT_KEYWORDS = [
  'government approved', 'govt approved', 'msme approved', 'msme registered',
  'aicte approved', 'aicte', 'government recognized', 'govt recognized',
  'ministry of', 'official partner of', 'affiliated with government',
  'government internship', 'govt internship', 'niti aayog',
];

const SENSITIVE_INFO_KEYWORDS = [
  'aadhaar', 'pan card', 'ssn', 'social security', 'passport',
  'bank account', 'bank details', 'banking details', 'credit card',
  'debit card', 'identity proof', 'id proof', 'photograph',
  'driving license', 'voter id', 'ration card',
];

let findingCounter = 0;
function nextId(): string {
  findingCounter += 1;
  return `finding-${findingCounter}`;
}

const NEGATION_MARKERS = [
  'no', 'not', 'without', 'never', 'none', "isn't", "aren't", "doesn't",
  "don't", "won't", 'isnt', 'arent', 'doesnt', 'dont', 'wont', 'lacking', 'lacks',
];

/**
 * True if `keyword` appears in `text` at least once WITHOUT a negation
 * word (no, not, without, never, ...) within the preceding ~25
 * characters. This is what "positive signal" checks need to use instead
 * of a bare .includes() — otherwise "No technical interview is required"
 * gets read as "interview mentioned = good sign", which is exactly
 * backwards. If every occurrence of the keyword is negated (or the
 * keyword never appears at all), this returns false.
 */
function hasNonNegatedMention(text: string, keyword: string, windowChars = 25): boolean {
  const lower = text.toLowerCase();
  const kw = keyword.toLowerCase();
  let idx = lower.indexOf(kw);
  while (idx !== -1) {
    const before = lower.slice(Math.max(0, idx - windowChars), idx);
    const negated = NEGATION_MARKERS.some((n) => new RegExp(`\\b${n}\\b`).test(before));
    if (!negated) return true;
    idx = lower.indexOf(kw, idx + kw.length);
  }
  return false;
}

function containsAny(text: string, keywords: string[]): string[] {
  // Word-boundary matching, not raw substring containment. Substring
  // matching was causing real false positives — e.g. the keyword "ether"
  // (crypto slang) matching inside the ordinary word "whether", since
  // "whether".includes("ether") is true. \b correctly rejects that while
  // still matching "ether" as its own word, and works the same way for
  // multi-word phrases like "registration fee".
  return keywords.filter((k) => {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
  });
}

function detectLookalikeDomain(emailDomain: string, companyDomain: string): boolean {
  if (!emailDomain || !companyDomain) return false;
  if (emailDomain === companyDomain) return false;
  const levenshtein = (a: string, b: string): number => {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n];
  };
  const dist = levenshtein(emailDomain, companyDomain);
  return dist > 0 && dist <= 3 && emailDomain.length > 5;
}

function isSubdomain(domain: string, rootDomain: string): boolean {
  return domain !== rootDomain && domain.endsWith(`.${rootDomain}`);
}

const RISK_LEVEL_ORDER: RiskLevel[] = ['LOW RISK', 'GENERALLY LOW RISK', 'CAUTION', 'HIGH RISK', 'VERY HIGH RISK'];

function computeRiskLevel(score: number, majorWarnings: Finding[]): RiskLevel {
  let level: RiskLevel;
  if (score <= 20) level = 'LOW RISK';
  else if (score <= 40) level = 'GENERALLY LOW RISK';
  else if (score <= 60) level = 'CAUTION';
  else if (score <= 80) level = 'HIGH RISK';
  else level = 'VERY HIGH RISK';

  // A single genuine critical-severity finding (an explicit payment
  // demand, a lookalike domain, etc.) is strong enough on its own that
  // the overall risk level should never undersell it just because the
  // cumulative score happened to land in a low band. This is the "one
  // strong financial-category hit should outweigh several weak hits"
  // principle from the checklist, applied to the final level too, not
  // just to individual score contributions.
  const hasCritical = majorWarnings.some((f) => f.severity === 'critical');
  const hasMultipleHigh = majorWarnings.filter((f) => f.severity === 'high' || f.severity === 'critical').length >= 2;
  const floor: RiskLevel = hasCritical ? 'HIGH RISK' : hasMultipleHigh ? 'CAUTION' : 'LOW RISK';

  return RISK_LEVEL_ORDER.indexOf(floor) > RISK_LEVEL_ORDER.indexOf(level) ? floor : level;
}

interface CategoryAnalysis {
  category: string;
  status: CategoryResult['status'];
  confidence: CategoryResult['confidence'];
  riskLevel: CategoryResult['riskLevel'];
  findings: Finding[];
  positives: Finding[];
  gaps: string[];
  scoreContribution: number;
}

function analyzeCompany(input: OpportunityInput): CategoryAnalysis {
  const findings: Finding[] = [];
  const positives: Finding[] = [];
  const gaps: string[] = [];
  let scoreContribution = 0;

  if (!input.company.trim()) {
    gaps.push('Company name was not provided');
    return {
      category: 'Company Verification',
      status: 'unable', confidence: 'none', riskLevel: 'low',
      findings, positives, gaps, scoreContribution: 0,
    };
  }

  if (!input.companyWebsite.trim()) {
    // No website is missing information, not evidence of anything — this
    // is a verification gap, not a red flag. It doesn't score.
    gaps.push(`Whether "${input.company}" has a verifiable official website`);
    gaps.push('Whether the company exists');
    gaps.push('Whether the opportunity is consistent with the company');
  }

  if (input.companyWebsite.trim()) {
    const domain = getDomainFromUrl(input.companyWebsite);
    if (domain) {
      const companyNameSlug = input.company.toLowerCase().replace(/[^a-z0-9]/g, '');
      const domainSlug = domain.split('.')[0];
      const isConsistent = domainSlug.includes(companyNameSlug.slice(0, 4)) ||
        companyNameSlug.includes(domainSlug.slice(0, 4));
      if (isConsistent) {
        // A loose string match between the typed company name and the
        // domain is not real evidence of a verified relationship —
        // anyone can type any name next to any URL. This is honestly a
        // verification gap, not a confirmed positive, unless something
        // actually ties the two together (e.g. the website reachability
        // check below, or a future check that reads the site's own
        // stated name). Absence of a mismatch isn't presence of proof.
        gaps.push(`Whether "${input.company}" and the domain "${domain}" are actually the same entity`);
      } else {
        findings.push({
          id: nextId(),
          category: 'company',
          severity: 'caution',
          title: `Website domain "${domain}" doesn't obviously match "${input.company}"`,
          finding: `The website you gave for ${input.company} (${domain}) doesn't clearly match the company name.`,
          evidence: `${input.company} — ${input.companyWebsite}`,
          explanation: 'This can be legitimate if the company uses a different brand name for its domain, but it warrants verification.',
          action: 'Verify the website is genuinely operated by the claimed company.',
        });
        scoreContribution += 8;
      }
    }
    gaps.push('Whether the company is actively operating');
  }

  if (input.company.trim().length < 3) {
    findings.push({
      id: nextId(),
      category: 'company',
      severity: 'caution',
      title: `Company name "${input.company}" is unusually short or generic`,
      finding: `The company name provided ("${input.company}") is very short or generic.`,
      evidence: input.company,
      explanation: 'Vague or generic company names make it harder to verify the employer.',
      action: 'Ask the recruiter for the full registered company name.',
    });
    scoreContribution += 5;
  }

  const companyLower = input.company.toLowerCase();
  const brandClaimed = BRAND_NAMES.find((b) => companyLower.includes(b));
  if (brandClaimed && input.recruiterEmail.trim()) {
    const emailDomain = getDomainFromEmail(input.recruiterEmail);
    if (emailDomain && FREE_EMAIL_PROVIDERS.has(emailDomain)) {
      findings.push({
        id: nextId(),
        category: 'company',
        severity: 'high',
        title: `Claims to be "${brandClaimed}" but recruiter uses a personal email`,
        finding: `The opportunity claims affiliation with "${brandClaimed}" but the recruiter uses a free email provider.`,
        evidence: `${input.recruiterEmail}`,
        explanation: 'Recruiters from major companies typically use official company email domains, not personal email services.',
        action: 'Contact the company through its official website to verify this recruiter.',
      });
      scoreContribution += 20;
    }
  }

  return {
    category: 'Company Verification',
    status: gaps.length > 0 ? 'unable' : 'partial',
    confidence: gaps.length > 0 ? 'low' : 'medium',
    riskLevel: scoreContribution > 15 ? 'high' : scoreContribution > 5 ? 'caution' : 'low',
    findings, positives, gaps, scoreContribution,
  };
}

function analyzeRecruiterIdentity(input: OpportunityInput): CategoryAnalysis {
  const findings: Finding[] = [];
  const positives: Finding[] = [];
  const gaps: string[] = [];
  let scoreContribution = 0;

  if (!input.recruiterName.trim()) {
    gaps.push('Recruiter name was not provided');
  }

  if (input.recruiterMessage.trim()) {
    const msgLower = input.recruiterMessage.toLowerCase();
    const pressureHits = containsAny(input.recruiterMessage, PRESSURE_KEYWORDS);
    if (pressureHits.length > 0) {
      findings.push({
        id: nextId(),
        category: 'recruiter',
        severity: pressureHits.length > 2 ? 'high' : 'caution',
        title: 'Pressure tactics detected in communication',
        finding: 'The recruiter message uses urgency or pressure language.',
        evidence: pressureHits.slice(0, 3).map((k) => `"${k}"`).join(', '),
        explanation: 'Pressuring candidates to respond quickly is a common tactic in fraudulent recruitment.',
        action: 'Take your time. Legitimate employers do not pressure candidates to make immediate decisions.',
      });
      scoreContribution += pressureHits.length > 2 ? 15 : 8;
    }

    const scamHits = containsAny(input.recruiterMessage, SCAM_JOB_KEYWORDS);
    if (scamHits.length > 0) {
      findings.push({
        id: nextId(),
        category: 'recruiter',
        severity: scamHits.length > 2 ? 'high' : 'caution',
        title: 'Common scam job phrases detected',
        finding: 'The message contains phrases commonly associated with fraudulent job postings.',
        evidence: scamHits.slice(0, 3).map((k) => `"${k}"`).join(', '),
        explanation: 'Promises of easy money, no experience needed, or guaranteed income are major red flags.',
        action: 'Be very cautious. Legitimate jobs rarely guarantee income or require no experience.',
      });
      scoreContribution += scamHits.length > 2 ? 15 : 8;
    }

    const platformHits = MESSAGING_PLATFORMS.filter((p) => msgLower.includes(p));
    if (platformHits.length > 0) {
      findings.push({
        id: nextId(),
        category: 'recruiter',
        severity: 'caution',
        title: 'Messaging app as primary contact channel',
        finding: `The recruiter asks to communicate via ${platformHits.join(', ')}.`,
        evidence: platformHits.map((p) => `"${p}"`).join(', '),
        explanation: 'While some legitimate recruiters use messaging apps, making them the sole or primary communication channel is a risk indicator.',
        action: 'Verify the recruiter through official company channels before sharing information.',
      });
      scoreContribution += 8;
    }

    if (input.recruiterName.trim() && msgLower.includes(input.recruiterName.toLowerCase().split(' ')[0])) {
      positives.push({
        id: nextId(),
        category: 'recruiter',
        severity: 'positive',
        title: 'Recruiter name is present in communication',
        finding: 'The recruiter message includes the recruiter\'s name, suggesting personal communication.',
        evidence: input.recruiterName,
        explanation: 'Personalized communication is slightly more reassuring than generic mass outreach.',
        action: 'Still verify the recruiter independently.',
      });
    }

    // Brevity alone is not a red flag — removed as a scored finding.
    // A short message isn't evidence of mass outreach any more than a
    // long one is evidence of legitimacy. If this needs re-adding later,
    // it should only fire in combination with other signals, never alone.

    if (!input.recruiterName.trim() && input.recruiterMessage.trim()) {
      // Not a red flag on its own — a scraped job posting or formal
      // listing naturally has no personal "recruiter name" the way a
      // DM-style message might. Already captured as a gap above; no
      // separate finding or duplicate gap needed here.
    }
  }

  return {
    category: 'Recruiter Identity',
    status: gaps.length > 0 ? 'unable' : 'partial',
    confidence: gaps.length > 0 ? 'low' : 'medium',
    riskLevel: scoreContribution > 15 ? 'high' : scoreContribution > 5 ? 'caution' : 'low',
    findings, positives, gaps, scoreContribution,
  };
}

function analyzeEmailDomain(input: OpportunityInput): CategoryAnalysis {
  const findings: Finding[] = [];
  const positives: Finding[] = [];
  const gaps: string[] = [];
  let scoreContribution = 0;

  const emailDomain = input.recruiterEmail.trim() ? getDomainFromEmail(input.recruiterEmail) : null;
  const websiteDomain = input.companyWebsite.trim() ? getDomainFromUrl(input.companyWebsite) : null;

  if (!emailDomain) {
    gaps.push('Recruiter email was not provided');
    return {
      category: 'Email / Domain Analysis',
      status: 'unable', confidence: 'none', riskLevel: 'low',
      findings, positives, gaps, scoreContribution: 0,
    };
  }

  if (FREE_EMAIL_PROVIDERS.has(emailDomain)) {
    findings.push({
      id: nextId(),
      category: 'email',
      severity: 'caution',
      title: `Recruiter email is on ${emailDomain}, a free provider`,
      finding: `The recruiter email uses a free email provider (${emailDomain}).`,
      evidence: input.recruiterEmail,
      explanation: 'This is not proof of fraud — many legitimate third-party recruiters use Gmail. However, if the recruiter claims to represent a specific company, the email should ideally come from that company\'s domain.',
      action: 'If the recruiter claims to represent a company, verify using the company\'s official email domain.',
    });
    scoreContribution += 10;

    if (websiteDomain && websiteDomain !== emailDomain) {
      findings.push({
        id: nextId(),
        category: 'email',
        severity: 'high',
        title: `Email domain “${emailDomain}” doesn't match “${websiteDomain}”`,
        finding: `The recruiter's email (${emailDomain}) uses a different domain from ${input.company}'s website (${websiteDomain}).`,
        evidence: `Email: ${emailDomain} vs Website: ${websiteDomain}`,
        explanation: 'The recruiter uses a different domain from the company. This can be legitimate for third-party recruiters, but independently verify the relationship.',
        action: 'Contact the company directly through their official website to confirm the recruiter\'s affiliation.',
      });
      scoreContribution += 12;
    }
  } else if (websiteDomain) {
    if (emailDomain === websiteDomain) {
      positives.push({
        id: nextId(),
        category: 'email',
        severity: 'positive',
        title: `Email domain matches ${input.company}'s website`,
        finding: `The recruiter email domain (${emailDomain}) matches the company website domain.`,
        evidence: `${emailDomain} = ${websiteDomain}`,
        explanation: 'A matching domain is a strong positive signal that the recruiter is genuinely affiliated with the company.',
        action: 'Still verify the specific recruiter through the company\'s official channels.',
      });
    } else if (isSubdomain(emailDomain, websiteDomain) || isSubdomain(websiteDomain, emailDomain)) {
      positives.push({
        id: nextId(),
        category: 'email',
        severity: 'positive',
        title: `Email domain “${emailDomain}” is related to “${websiteDomain}”`,
        finding: `The recruiter email domain (${emailDomain}) is a subdomain or parent of the company website domain (${websiteDomain}).`,
        evidence: `${emailDomain} ~ ${websiteDomain}`,
        explanation: 'Related domains suggest the email is from the same organization.',
        action: 'Verify through official channels for full confidence.',
      });
    } else if (detectLookalikeDomain(emailDomain, websiteDomain)) {
      findings.push({
        id: nextId(),
        category: 'email',
        severity: 'critical',
        title: `“${emailDomain}” closely resembles “${websiteDomain}” but isn't identical`,
        finding: `The recruiter email domain (${emailDomain}) closely resembles ${input.company}'s domain (${websiteDomain}) but is not identical.`,
        evidence: `${emailDomain} vs ${websiteDomain}`,
        explanation: 'Lookalike domains (e.g., "arnazon.com" instead of "amazon.com") are a hallmark of impersonation scams.',
        action: 'Do not respond until you have independently verified the correct company domain.',
      });
      scoreContribution += 25;
    } else {
      findings.push({
        id: nextId(),
        category: 'email',
        severity: 'caution',
        title: `Email domain “${emailDomain}” differs from “${websiteDomain}”`,
        finding: `The recruiter email domain (${emailDomain}) is different from the company website domain (${websiteDomain}).`,
        evidence: `${emailDomain} vs ${websiteDomain}`,
        explanation: 'This may be legitimate for staffing agencies, but should be verified independently.',
        action: 'Verify the recruiter\'s relationship with the company.',
      });
      scoreContribution += 10;
    }
  }

  if (emailDomain && emailDomain.split('.').length > 4) {
    findings.push({
      id: nextId(),
      category: 'email',
      severity: 'caution',
      title: 'Unusual email domain pattern',
      finding: 'The email domain has an unusually long subdomain structure.',
      evidence: emailDomain,
      explanation: 'Complex subdomain patterns can be used to disguise the true origin of an email.',
      action: 'Verify the domain independently.',
    });
    scoreContribution += 5;
  }

  return {
    category: 'Email / Domain Analysis',
    status: findings.some((f) => f.severity === 'critical') ? 'suspicious' : 'partial',
    confidence: findings.length === 0 ? 'high' : 'medium',
    riskLevel: scoreContribution > 20 ? 'high' : scoreContribution > 8 ? 'caution' : 'low',
    findings, positives, gaps, scoreContribution,
  };
}

function analyzeJobPosting(input: OpportunityInput): CategoryAnalysis {
  const findings: Finding[] = [];
  const positives: Finding[] = [];
  const gaps: string[] = [];
  let scoreContribution = 0;

  const text = `${input.description} ${input.recruiterMessage} ${input.offerLetter}`;

  if (!input.description.trim() && !input.recruiterMessage.trim()) {
    gaps.push('Job description and recruiter message were not provided');
    return {
      category: 'Job Posting Analysis',
      status: 'unable', confidence: 'none', riskLevel: 'low',
      findings, positives, gaps, scoreContribution: 0,
    };
  }

  const scamHits = containsAny(text, SCAM_JOB_KEYWORDS);
  if (scamHits.length > 0) {
    findings.push({
      id: nextId(),
      category: 'job',
      severity: scamHits.length > 2 ? 'high' : 'caution',
      title: scamHits.length > 2 ? 'Multiple unrealistic job promises' : 'Unrealistic job promise detected',
      finding: 'The job posting contains language commonly associated with misleading or fraudulent postings.',
      evidence: scamHits.slice(0, 4).map((k) => `"${k}"`).join(', '),
      explanation: 'Promises like "no experience required" combined with high pay, guaranteed income, or instant selection are major warning signs.',
      action: 'Be cautious. Research the company and role independently.',
    });
    scoreContribution += scamHits.length > 2 ? 15 : 8;
  }

  const combinedWordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  if (combinedWordCount > 0) {
    if (combinedWordCount < 30) {
      // A brief submission isn't a red flag — it's insufficient
      // information to assess the role, which belongs in gaps, not
      // findings. Don't penalize the score for something the person
      // simply didn't have to paste in.
      gaps.push('Whether enough detail was provided to assess the role');
    } else {
      positives.push({
        id: nextId(),
        category: 'job',
        severity: 'positive',
        title: 'Enough detail provided to assess the role',
        finding: 'Enough information was provided to meaningfully assess the opportunity.',
        evidence: `${combinedWordCount} words`,
        explanation: 'More detail allows for a better assessment of the opportunity.',
        action: 'Verify the details against the company\'s official careers page.',
      });
    }
  }

  if (input.jobTitle.trim()) {
    const titleLower = input.jobTitle.toLowerCase();
    if (titleLower.includes('data entry') && text.toLowerCase().includes('work from home')) {
      findings.push({
        id: nextId(),
        category: 'job',
        severity: 'high',
        title: 'Data entry + work from home pattern',
        finding: 'The role involves data entry with work from home, a pattern commonly seen in fraudulent postings.',
        evidence: input.jobTitle,
        explanation: 'Data entry work-from-home jobs are frequently used in scams that ask for upfront deposits.',
        action: 'Be extremely cautious and verify the company independently.',
      });
      scoreContribution += 15;
    }
  }

  if (input.jobPostingUrl.trim()) {
    const url = input.jobPostingUrl.toLowerCase();
    const onPlatform = JOB_PLATFORMS.some((p) => url.includes(p));
    if (onPlatform) {
      positives.push({
        id: nextId(),
        category: 'job',
        severity: 'positive',
        title: 'Job posted on a recognized platform',
        finding: 'The job posting URL links to a recognized job platform.',
        evidence: input.jobPostingUrl,
        explanation: 'Jobs on established platforms have some level of platform review, though scams still appear.',
        action: 'Check the poster\'s profile on the platform for authenticity.',
      });
    }
  }

  return {
    category: 'Job Posting Analysis',
    status: findings.some((f) => f.severity === 'high') ? 'suspicious' : 'partial',
    confidence: positives.length > 0 ? 'medium' : 'low',
    riskLevel: scoreContribution > 15 ? 'high' : scoreContribution > 5 ? 'caution' : 'low',
    findings, positives, gaps, scoreContribution,
  };
}

function analyzePayment(text: string): CategoryAnalysis {
  const findings: Finding[] = [];
  const positives: Finding[] = [];
  const gaps: string[] = [];
  let scoreContribution = 0;

  if (!text.trim()) {
    gaps.push('No offer letter or additional information provided');
    return {
      category: 'Payment / Money Detection',
      status: 'unable', confidence: 'none', riskLevel: 'low',
      findings, positives, gaps, scoreContribution: 0,
    };
  }

  // Full amount token, including "k"/lakh/crore suffixes and comma
  // grouping — the previous regex truncated "$5k" down to "$5".
  const AMOUNT_REGEX = /(?:₹|\$|€|£|Rs\.?|INR)\s?\d{1,3}(?:,\d{2,3})*(?:\.\d+)?\s?(?:k|K|lakh|lakhs|crore|crores)?(?:\s?\/\s?(?:month|mo|week|wk|hour|hr|day))?/g;

  // Sentence-level analysis so a dollar amount is only ever treated as a
  // "payment requested from you" red flag when it actually appears in a
  // sentence that's demanding payment — not anywhere compensation is
  // mentioned. This is what fixes "$5k/month earned by top contributors"
  // being misread as a payment request.
  const sentences = text.split(/(?<=[.!?\n])\s+/).filter((s) => s.trim());

  const demandHitsAll = new Set<string>();
  const flaggedAmounts: string[] = [];
  let compensationAmountFound = false;

  for (const sentence of sentences) {
    const demandHits = containsAny(sentence, PAYMENT_DEMAND_KEYWORDS);
    const cryptoHits = containsAny(sentence, CRYPTO_TERMS);
    const hasDemandVerb = containsAny(sentence, PAYMENT_DEMAND_VERBS).length > 0;
    // A crypto term only counts as a demand if it's paired with an actual
    // payment verb in the same sentence — "ether" or "crypto" mentioned
    // on its own isn't evidence anyone is being asked to pay anything.
    const effectiveCryptoHits = hasDemandVerb ? cryptoHits : [];

    const allDemandHits = [...demandHits, ...effectiveCryptoHits];
    const isCompensationSentence = containsAny(sentence, COMPENSATION_CONTEXT_PATTERNS).length > 0;
    const amountsInSentence = sentence.match(AMOUNT_REGEX);

    if (allDemandHits.length > 0) {
      allDemandHits.forEach((h) => demandHitsAll.add(h));
      if (amountsInSentence) flaggedAmounts.push(...amountsInSentence);
    } else if (amountsInSentence && isCompensationSentence) {
      compensationAmountFound = true;
    }
  }

  const paymentHits = Array.from(demandHitsAll);

  if (paymentHits.length > 0) {
    findings.push({
      id: nextId(),
      category: 'payment',
      severity: 'critical',
      title: `Asked to pay: "${paymentHits[0]}"`,
      finding: `The opportunity mentions "${paymentHits[0]}"${paymentHits.length > 1 ? ` and ${paymentHits.length - 1} other payment-related phrase${paymentHits.length > 2 ? 's' : ''}` : ''} — a payment before employment or internship begins.`,
      evidence: paymentHits.slice(0, 4).map((k) => `"${k}"`).join(', '),
      explanation: 'Legitimate opportunities can have paid training or other costs in some contexts, but unexpected upfront payments are a major warning sign and should be independently verified.',
      action: 'Do not pay until you have independently verified the opportunity through official company channels.',
    });
    scoreContribution += 30;

    if (flaggedAmounts.length > 0) {
      findings.push({
        id: nextId(),
        category: 'payment',
        severity: 'high',
        title: `Specific amount requested: ${flaggedAmounts[0]}`,
        finding: `A specific amount (${flaggedAmounts.slice(0, 3).join(', ')}) is mentioned alongside payment-request language.`,
        evidence: flaggedAmounts.slice(0, 3).join(', '),
        explanation: 'Requests for specific upfront amounts are a hallmark of advance-fee fraud.',
        action: 'Do not transfer any money. Verify the opportunity independently first.',
      });
      scoreContribution += 10;
    }
  } else if (compensationAmountFound) {
    positives.push({
      id: nextId(),
      category: 'payment',
      severity: 'positive',
      title: 'Compensation details provided, no payment requested',
      finding: 'A specific compensation amount is mentioned, and no payment is requested from the applicant.',
      evidence: 'Amount appears alongside compensation language (e.g. "per month", "salary"), not payment-demand language',
      explanation: 'Money described as being paid to the applicant is the opposite of a red flag — this only becomes a concern if a separate, genuine payment request also appears elsewhere.',
      action: 'Independently verify the compensation is realistic for the role and market.',
    });
  }

  if (paymentHits.length === 0 && text.trim().length > 50) {
    positives.push({
      id: nextId(),
      category: 'payment',
      severity: 'positive',
      title: 'No payment requests detected',
      finding: 'No upfront payment, deposit, or fee requests were detected in the provided text.',
      evidence: 'Scanned offer letter and additional information',
      explanation: 'The absence of payment requests is a positive signal.',
      action: 'Remain cautious and verify all other aspects of the opportunity.',
    });
  }

  return {
    category: 'Payment / Money Detection',
    status: paymentHits.length > 0 ? 'suspicious' : 'partial',
    confidence: paymentHits.length > 0 ? 'high' : 'medium',
    riskLevel: scoreContribution > 20 ? 'high' : scoreContribution > 0 ? 'caution' : 'low',
    findings, positives, gaps, scoreContribution,
  };
}

function analyzeRecruitmentProcess(input: OpportunityInput): CategoryAnalysis {
  const findings: Finding[] = [];
  const positives: Finding[] = [];
  const gaps: string[] = [];
  let scoreContribution = 0;

  const text = `${input.description} ${input.recruiterMessage} ${input.offerLetter}`;
  const lower = text.toLowerCase();

  if (!text.trim()) {
    gaps.push('No process information provided');
    return {
      category: 'Recruitment Process',
      status: 'unable', confidence: 'none', riskLevel: 'low',
      findings, positives, gaps, scoreContribution: 0,
    };
  }

  if (lower.includes('no interview') || lower.includes('without interview') || lower.includes('no interview required')) {
    findings.push({
      id: nextId(),
      category: 'process',
      severity: 'high',
      title: 'No formal interview mentioned',
      finding: 'The opportunity appears to proceed without a formal interview.',
      evidence: '"no interview" detected in text',
      explanation: 'Legitimate employers typically conduct interviews. Selection without any interview is a major red flag.',
      action: 'Ask about the interview process. A legitimate employer will have one.',
    });
    scoreContribution += 15;
  }

  if (lower.includes('instant') || lower.includes('immediately selected') || lower.includes('selected on the spot')) {
    findings.push({
      id: nextId(),
      category: 'process',
      severity: 'high',
      title: 'Instant selection detected',
      finding: 'The opportunity suggests immediate or instant selection.',
      evidence: 'Instant/immediate selection language detected',
      explanation: 'Selection without meaningful evaluation is a common sign of fraudulent recruitment.',
      action: 'Be cautious. Legitimate hiring takes time and involves evaluation.',
    });
    scoreContribution += 12;
  }

  if (
    hasNonNegatedMention(text, 'interview') &&
    (hasNonNegatedMention(text, 'round') || hasNonNegatedMention(text, 'technical') || hasNonNegatedMention(text, 'hr round'))
  ) {
    positives.push({
      id: nextId(),
      category: 'process',
      severity: 'positive',
      title: 'Formal interview process described',
      finding: 'The opportunity mentions a formal interview process.',
      evidence: 'Interview-related language detected',
      explanation: 'A described interview process is a positive signal for legitimacy.',
      action: 'Confirm the interview details through official channels.',
    });
  }

  if (lower.includes('offer letter') && !lower.includes('interview')) {
    findings.push({
      id: nextId(),
      category: 'process',
      severity: 'caution',
      title: 'Offer letter without interview mentioned',
      finding: 'An offer letter is mentioned but no interview process is described.',
      evidence: 'Offer letter referenced without interview context',
      explanation: 'An offer without a preceding interview is unusual for legitimate hiring.',
      action: 'Verify whether an interview is part of the process.',
    });
    scoreContribution += 10;
  }

  const accountKeywords = ['create an account', 'register on', 'sign up on', 'create your profile on'];
  const accountHits = containsAny(lower, accountKeywords);
  if (accountHits.length > 0) {
    findings.push({
      id: nextId(),
      category: 'process',
      severity: 'caution',
      title: 'Asked to create account on external platform',
      finding: 'The recruiter asks candidates to create an account on a specific platform.',
      evidence: accountHits.slice(0, 2).map((k) => `"${k}"`).join(', '),
      explanation: 'Directing candidates to unfamiliar platforms can be a way to collect personal information.',
      action: 'Verify the platform is legitimate before creating an account.',
    });
    scoreContribution += 8;
  }

  if (lower.includes('download') && (lower.includes('app') || lower.includes('software'))) {
    findings.push({
      id: nextId(),
      category: 'process',
      severity: 'caution',
      title: 'Asked to download software',
      finding: 'The process requires downloading an app or software.',
      evidence: 'Download instructions detected',
      explanation: 'Requests to download unknown software can be a vector for malware or scams.',
      action: 'Verify the software is legitimate and from an official source before downloading.',
    });
    scoreContribution += 5;
  }

  return {
    category: 'Recruitment Process',
    status: findings.some((f) => f.severity === 'high') ? 'suspicious' : 'partial',
    confidence: findings.length > 0 ? 'medium' : 'low',
    riskLevel: scoreContribution > 15 ? 'high' : scoreContribution > 5 ? 'caution' : 'low',
    findings, positives, gaps, scoreContribution,
  };
}

function analyzeBrandImpersonation(input: OpportunityInput): CategoryAnalysis {
  const findings: Finding[] = [];
  const positives: Finding[] = [];
  const gaps: string[] = [];
  let scoreContribution = 0;

  const text = `${input.company} ${input.description} ${input.recruiterMessage} ${input.offerLetter}`;
  const lower = text.toLowerCase();

  const brandFound = BRAND_NAMES.find((b) => lower.includes(b));
  const govFound = GOVERNMENT_KEYWORDS.filter((k) => lower.includes(k));

  if (!brandFound && govFound.length === 0) {
    return {
      category: 'Brand / Government Affiliation',
      status: 'partial', confidence: 'medium', riskLevel: 'low',
      findings, positives, gaps, scoreContribution: 0,
    };
  }

  if (brandFound) {
    const emailDomain = input.recruiterEmail.trim() ? getDomainFromEmail(input.recruiterEmail) : null;
    if (emailDomain && FREE_EMAIL_PROVIDERS.has(emailDomain)) {
      findings.push({
        id: nextId(),
        category: 'brand',
        severity: 'high',
        title: 'Affiliation could not be independently verified',
        finding: `The opportunity claims affiliation with "${brandFound}" but the recruiter uses a personal email.`,
        evidence: `Brand: ${brandFound}, Email: ${input.recruiterEmail}`,
        explanation: 'Recruiters from major brands typically use official company email. The affiliation could not be independently verified.',
        action: 'Contact the company through its official website to verify this relationship.',
      });
      scoreContribution += 15;
    } else {
      gaps.push(`Relationship with "${brandFound}" could not be independently verified`);
    }
  }

  if (govFound.length > 0) {
    findings.push({
      id: nextId(),
      category: 'brand',
      severity: 'caution',
      title: 'Government affiliation claim detected',
      finding: 'The opportunity claims a government, MSME, or AICTE affiliation.',
      evidence: govFound.slice(0, 2).map((k) => `"${k}"`).join(', '),
      explanation: 'Government affiliation claims should be independently verified through official government portals. Do not assume the claim is accurate.',
      action: 'Verify the affiliation through the relevant official government or regulatory website.',
    });
    scoreContribution += 10;
  }

  if (brandFound && input.companyWebsite.trim()) {
    const domain = getDomainFromUrl(input.companyWebsite);
    if (domain && !domain.includes(brandFound.slice(0, 4))) {
      findings.push({
        id: nextId(),
        category: 'brand',
        severity: 'high',
        title: 'Brand name does not match website domain',
        finding: `The opportunity claims affiliation with "${brandFound}" but the website does not match.`,
        evidence: `Brand: ${brandFound}, Website: ${input.companyWebsite}`,
        explanation: 'A mismatch between a claimed brand affiliation and the website domain is a significant red flag for impersonation.',
        action: 'Verify the brand\'s official website independently and compare.',
      });
      scoreContribution += 15;
    }
  }

  return {
    category: 'Brand / Government Affiliation',
    status: findings.length > 0 ? 'suspicious' : 'partial',
    confidence: findings.length > 0 ? 'medium' : 'low',
    riskLevel: scoreContribution > 10 ? 'high' : scoreContribution > 0 ? 'caution' : 'low',
    findings, positives, gaps, scoreContribution,
  };
}

function analyzeOfferLetter(input: OpportunityInput): CategoryAnalysis {
  const findings: Finding[] = [];
  const positives: Finding[] = [];
  const gaps: string[] = [];
  let scoreContribution = 0;

  if (!input.offerLetter.trim()) {
    gaps.push('No offer letter text was provided');
    return {
      category: 'Offer Letter Analysis',
      status: 'unable', confidence: 'none', riskLevel: 'low',
      findings, positives, gaps, scoreContribution: 0,
    };
  }

  const text = input.offerLetter;
  const lower = text.toLowerCase();

  if (!lower.includes('date')) {
    findings.push({
      id: nextId(),
      category: 'offer',
      severity: 'caution',
      title: 'Missing date in offer letter',
      finding: 'The offer letter does not appear to include a date.',
      evidence: 'No date reference detected',
      explanation: 'Legitimate offer letters typically include the date of issuance.',
      action: 'Ask for a dated offer letter on company letterhead.',
    });
    scoreContribution += 5;
  }

  if (input.company.trim() && !lower.includes(input.company.toLowerCase())) {
    findings.push({
      id: nextId(),
      category: 'offer',
      severity: 'caution',
      title: 'Company name not mentioned in offer letter',
      finding: 'The claimed company name does not appear in the offer letter text.',
      evidence: `Expected "${input.company}" in offer letter`,
      explanation: 'A legitimate offer letter should reference the employer\'s name.',
      action: 'Ask for an offer letter on official company letterhead.',
    });
    scoreContribution += 8;
  }

  if (!lower.includes('salary') && !lower.includes('stipend') && !lower.includes('compensation') && !lower.includes('pay')) {
    findings.push({
      id: nextId(),
      category: 'offer',
      severity: 'caution',
      title: 'Missing compensation information',
      finding: 'The offer letter does not clearly state salary, stipend, or compensation.',
      evidence: 'No compensation keywords detected',
      explanation: 'A legitimate offer letter should clearly state compensation details.',
      action: 'Request a written offer with clear compensation details.',
    });
    scoreContribution += 5;
  }

  const genericPhrases = ['dear candidate', 'dear applicant', 'congratulations on being selected', 'we are pleased to offer'];
  const genericHits = containsAny(lower, genericPhrases);
  if (genericHits.length >= 2) {
    findings.push({
      id: nextId(),
      category: 'offer',
      severity: 'caution',
      title: 'Generic/template language detected',
      finding: 'Several responsibilities are described broadly without identifying a specific project, team, manager, or deliverable.',
      evidence: genericHits.map((k) => `"${k}"`).join(', '),
      explanation: 'Heavy use of generic boilerplate language can indicate a template-based offer rather than a genuine, role-specific letter.',
      action: 'Request a detailed offer letter with specific role and project information.',
    });
    scoreContribution += 8;
  }

  const paymentHits = containsAny(text, PAYMENT_DEMAND_KEYWORDS);
  if (paymentHits.length > 0) {
    findings.push({
      id: nextId(),
      category: 'offer',
      severity: 'critical',
      title: 'Payment requirement in offer letter',
      finding: 'The offer letter contains a payment or deposit requirement.',
      evidence: paymentHits.slice(0, 3).map((k) => `"${k}"`).join(', '),
      explanation: 'Payment requirements in an offer letter are a major red flag.',
      action: 'Do not pay any amount. Verify the company independently first.',
    });
    scoreContribution += 20;
  }

  if (hasNonNegatedMention(text, 'salary') || hasNonNegatedMention(text, 'stipend')) {
    positives.push({
      id: nextId(),
      category: 'offer',
      severity: 'positive',
      title: 'Compensation details included',
      finding: 'The offer letter mentions salary or stipend details.',
      evidence: 'Compensation keywords detected',
      explanation: 'Including compensation details is a positive signal.',
      action: 'Verify the compensation is realistic for the role and market.',
    });
  }

  if (lower.includes('date') && lower.includes('date')) {
    positives.push({
      id: nextId(),
      category: 'offer',
      severity: 'positive',
      title: 'Offer letter appears structured',
      finding: 'The offer letter includes dates and appears to follow a letter format.',
      evidence: 'Date and structured format detected',
      explanation: 'A structured offer letter is more reassuring than a casual message.',
      action: 'Still verify the letterhead and company independently.',
    });
  }

  return {
    category: 'Offer Letter Analysis',
    status: findings.some((f) => f.severity === 'critical') ? 'suspicious' : 'partial',
    confidence: findings.length > 0 ? 'medium' : 'low',
    riskLevel: scoreContribution > 15 ? 'high' : scoreContribution > 5 ? 'caution' : 'low',
    findings, positives, gaps, scoreContribution,
  };
}

function analyzeSensitiveInfo(input: OpportunityInput): CategoryAnalysis {
  const findings: Finding[] = [];
  const gaps: string[] = [];
  let scoreContribution = 0;

  const text = `${input.description} ${input.recruiterMessage} ${input.offerLetter}`;
  const hits = containsAny(text, SENSITIVE_INFO_KEYWORDS);

  if (hits.length > 0) {
    findings.push({
      id: nextId(),
      category: 'sensitive',
      severity: 'high',
      title: 'Sensitive information requested',
      finding: 'The opportunity appears to request sensitive personal or financial information.',
      evidence: hits.slice(0, 3).map((k) => `"${k}"`).join(', '),
      explanation: 'Requests for sensitive information (ID numbers, bank details) early in the process are a significant warning sign.',
      action: 'Avoid submitting identity, banking, or other sensitive information until the employer is independently verified.',
    });
    scoreContribution += 15;
  }

  return {
    category: 'Sensitive Information',
    status: hits.length > 0 ? 'suspicious' : 'partial',
    confidence: hits.length > 0 ? 'high' : 'medium',
    riskLevel: scoreContribution > 10 ? 'high' : 'low',
    findings, positives: [], gaps, scoreContribution,
  };
}

function assessOpportunityQuality(input: OpportunityInput): OpportunityQuality {
  const notes: string[] = [];
  const text = `${input.description} ${input.recruiterMessage} ${input.offerLetter}`;
  const lower = text.toLowerCase();

  let qualityScore = 0;

  if (text.trim().length < 50) {
    notes.push('Job description is very brief — unclear responsibilities.');
    qualityScore -= 1;
  } else {
    notes.push('Job description provides some detail.');
  }

  if (lower.includes('mentor') || lower.includes('mentorship')) {
    notes.push('Mentorship is mentioned.');
    qualityScore += 1;
  }
  // Absence of a mentorship mention is not penalized — most legitimate
  // postings simply don't use that specific word, and its absence isn't
  // evidence of anything. Every qualitative conclusion here should be
  // backed by something actually present in the text, not by a missing
  // buzzword.

  if (containsAny(text, COMPENSATION_CONTEXT_PATTERNS).length > 0) {
    notes.push('Compensation details are clearly described.');
    qualityScore += 1;
  }

  if (lower.includes('certificate') && !lower.includes('salary') && !lower.includes('stipend')) {
    notes.push('The opportunity appears to be certificate-focused without compensation.');
    qualityScore -= 2;
  }

  if (lower.includes('unpaid') || (lower.includes('no stipend') || lower.includes('no salary'))) {
    notes.push('The opportunity may be unpaid.');
    qualityScore -= 1;
  }

  if (lower.includes('sales target') || lower.includes('fundraising') || lower.includes('raise funds')) {
    notes.push('Sales or fundraising targets are mentioned — may indicate revenue-dependent role.');
    qualityScore -= 1;
  }

  if (lower.includes('project') && (lower.includes('team') || lower.includes('manager'))) {
    notes.push('Specific project/team context is described.');
    qualityScore += 1;
  }

  if (hasNonNegatedMention(text, 'interview') || hasNonNegatedMention(text, 'assessment')) {
    notes.push('A structured selection process is described.');
    qualityScore += 1;
  }

  const rating: OpportunityQuality['rating'] =
    qualityScore >= 2 ? 'Appears Structured' :
    qualityScore >= 0 ? 'Limited Information' :
    'Potentially Low Quality';

  return { rating, notes };
}

function buildSummary(score: number, level: RiskLevel, major: Finding[], caution: Finding[]): string {
  if (major.length > 0) {
    return `${level} — ${major.length} major warning sign${major.length > 1 ? 's' : ''} and ${caution.length} caution signal${caution.length > 1 ? 's' : ''} were detected. Review the findings below before proceeding.`;
  }
  if (caution.length > 0) {
    return `${level} — ${caution.length} caution signal${caution.length > 1 ? 's' : ''} detected. No major red flags, but verify the details before proceeding.`;
  }
  return `${level} — No significant risk indicators were detected from the information provided. Continue with normal verification.`;
}

function buildRecommendedAction(findings: Finding[]): RecommendedActionPlan {
  const hasPayment = findings.some((f) => f.category === 'payment');
  const hasRecruiterIssue = findings.some((f) => f.category === 'recruiter' && (f.severity === 'high' || f.severity === 'critical'));
  const hasSensitive = findings.some((f) => f.category === 'sensitive');
  const hasEmailIssue = findings.some((f) => f.category === 'email' && (f.severity === 'high' || f.severity === 'critical'));
  const hasBrandClaim = findings.some((f) => f.category === 'brand' && (f.severity === 'high' || f.severity === 'critical'));
  const highCount = findings.filter((f) => f.severity === 'high' || f.severity === 'critical').length;

  // One consolidated, prioritized list — not each finding repeating its
  // own "recommended action" separately. Order matters: the most urgent,
  // most concrete step comes first.
  const steps: string[] = [];

  if (hasPayment) {
    steps.push('Do not pay any requested fee, deposit, or amount.');
  }
  if (hasSensitive) {
    steps.push('Do not submit identity documents, banking details, or other sensitive information yet.');
  }
  if (hasRecruiterIssue || hasEmailIssue) {
    steps.push("Contact the company through its official website — not through this recruiter's contact details.");
  }
  if (hasBrandClaim) {
    steps.push('Ask the company directly whether this recruiter or opportunity is authorized to use their name.');
  }
  steps.push("Verify the role exists on the company's official careers page.");

  let bottomLine: string;
  if (hasPayment || highCount >= 2) {
    bottomLine = 'Do not proceed until the recruiter and opportunity are independently verified.';
  } else if (highCount === 1) {
    bottomLine = 'Proceed with caution, and verify the flagged concern before moving forward.';
  } else {
    bottomLine = 'No major red flags were detected, but independent verification is still recommended before proceeding.';
  }

  return { steps, bottomLine };
}

/**
 * "Risk" and "confidence" are deliberately separate values. A report can
 * legitimately be High Risk / Low Confidence ("we found warning signs but
 * couldn't verify much of this") — collapsing both into one score would
 * hide that distinction, which is exactly the "SCAM: 87%" framing the
 * checklist explicitly rules out.
 */
function computeVerificationConfidence(categories: CategoryAnalysis[]): VerificationConfidence {
  const unableCount = categories.filter((c) => c.status === 'unable').length;
  if (unableCount <= 1) return 'High';
  if (unableCount <= 4) return 'Medium';
  return 'Low';
}

/**
 * This is the security boundary. It takes the FULL analysis (which only
 * ever exists server-side, in /api/analyze and /api/unlock) and strips it
 * down to exactly what's safe to send to the browser before payment is
 * verified — real titles and counts for teasers, but no evidence,
 * explanation, action text, or full category/quality detail.
 *
 * /api/analyze calls this and returns ONLY its output. /api/unlock returns
 * the full AnalysisResult, but only after verifying a real Razorpay
 * signature server-side.
 */
/**
 * Builds the preview sent to the browser before a payment is verified.
 * Never includes the full report — the only difference between tiers is
 * how much of the preview itself is shown:
 *  - 'standard' (one of the 5 lifetime free screenings): one finding shown
 *    in full (title, evidence, explanation, action), up to 2 more as
 *    title-only, a positive-signal preview, the full verification-gap
 *    list. This is the existing, richer preview.
 *  - 'limited' (free-screening allowance used up): no finding is shown in
 *    full — only up to 1 title-only finding — no positive-signal preview,
 *    and the verification-gap list is trimmed. Risk level, risk score,
 *    verification confidence, the summary, and the finding/gap counts are
 *    still real and accurate in both tiers; 'limited' just shows fewer of
 *    the details behind them.
 */
export function toPublicResult(result: AnalysisResult, tier: PreviewTier = 'standard'): PublicAnalysisResult {
  const allNegativeFindings = [...result.majorWarnings, ...result.cautionSignals];

  const previewFinding = tier === 'standard' ? (allNegativeFindings[0] ?? null) : null;
  const titleOnlyPool = tier === 'standard' ? allNegativeFindings.slice(1) : allNegativeFindings;
  const maxTitleOnly = tier === 'standard' ? 2 : 1;
  const criticalLockedCount = titleOnlyPool.filter((f) => f.severity === 'critical').length;

  const positivePreview = tier === 'standard' && result.positiveSignals[0]
    ? { id: result.positiveSignals[0].id, title: result.positiveSignals[0].title, severity: result.positiveSignals[0].severity }
    : null;

  const verificationGaps = tier === 'standard' ? result.verificationGaps : result.verificationGaps.slice(0, 1);

  const actionPreview = result.recommendedAction.bottomLine.slice(0, 70).trim();

  return {
    id: result.id,
    riskScore: result.riskScore,
    riskLevel: result.riskLevel,
    verificationConfidence: result.verificationConfidence,
    summary: result.summary,
    previewTier: tier,
    previewFinding,
    lockedFindingTitles: titleOnlyPool.slice(0, maxTitleOnly).map((f) => ({ id: f.id, title: f.title, severity: f.severity })),
    totalLockedFindingsCount: titleOnlyPool.length,
    criticalLockedCount,
    majorWarningsCount: result.majorWarnings.length,
    cautionSignalsCount: result.cautionSignals.length,
    positivePreview,
    totalPositiveCount: result.positiveSignals.length,
    verificationGaps,
    categoriesTotalCount: result.categories.length,
    categoriesConcernCount: result.categories.filter((c) => c.status === 'suspicious' || c.riskLevel === 'high').length,
    qualityRating: result.opportunityQuality.rating,
    qualityNotesLockedCount: result.opportunityQuality.notes.length,
    recommendedActionPreview: actionPreview,
    recommendedActionHasMore: result.recommendedAction.bottomLine.length > actionPreview.length,
    actionStepsCount: result.recommendedAction.steps.length,
    createdAt: result.createdAt,
    inputSummary: result.inputSummary,
  };
}

/**
 * Runs the RDAP lookup for the company's website domain and folds the
 * result into the already-computed Company Verification category. Kept
 * as a separate async step (rather than making analyzeCompany itself
 * async) so the RDAP network call is the only async piece in the whole
 * analyzer — everything else stays fast, synchronous, and independently
 * testable.
 */
async function applyDomainAgeSignal(input: OpportunityInput, companyCategory: CategoryAnalysis): Promise<void> {
  if (!input.companyWebsite.trim()) return;
  const domain = getDomainFromUrl(input.companyWebsite);
  if (!domain) return;

  const result = await lookupDomainAge(domain);

  if (result.status === 'unable_to_verify') {
    companyCategory.gaps.push('Domain registration date');
    return;
  }

  const { ageDays } = result;
  if (ageDays === null) return;

  if (ageDays < 30) {
    companyCategory.findings.push({
      id: nextId(),
      category: 'company',
      severity: 'high',
      title: `Website domain "${domain}" was registered ${ageDays} day${ageDays !== 1 ? 's' : ''} ago`,
      finding: `The website domain was registered very recently (${ageDays} day${ageDays !== 1 ? 's' : ''} ago).`,
      evidence: `Domain age: ${ageDays} days (registered ${result.registeredDate})`,
      explanation: 'This increases uncertainty and should be verified alongside other signals. A new legitimate business can have a new domain — this alone is not proof of anything.',
      action: 'Independently verify the company through other channels before proceeding.',
    });
    companyCategory.scoreContribution += 18;
  } else if (ageDays < 180) {
    companyCategory.findings.push({
      id: nextId(),
      category: 'company',
      severity: 'caution',
      title: `Website domain "${domain}" is ${ageDays} days old`,
      finding: `The website domain was registered ${ageDays} days ago.`,
      evidence: `Domain age: ${ageDays} days (registered ${result.registeredDate})`,
      explanation: 'A newer domain is not evidence of fraud on its own, but it is a mild signal worth weighing alongside everything else.',
      action: 'Cross-check the company through other independent sources.',
    });
    companyCategory.scoreContribution += 8;
  } else if (ageDays > 365) {
    companyCategory.positives.push({
      id: nextId(),
      category: 'company',
      severity: 'positive',
      title: `Website domain has been registered for over a year`,
      finding: `The website domain was registered ${Math.floor(ageDays / 365)}+ year(s) ago.`,
      evidence: `Domain age: ${ageDays} days (registered ${result.registeredDate})`,
      explanation: 'An established domain age is a mild positive signal, though still not independent proof of legitimacy.',
      action: 'Continue verifying other details as normal.',
    });
  }
  // 180-365 days: neutral, no finding either way — matches the checklist's
  // explicit "180+ days -> no domain-age warning" rule without overclaiming
  // a positive for a domain that's merely not brand-new.

  companyCategory.riskLevel = companyCategory.scoreContribution > 15 ? 'high' : companyCategory.scoreContribution > 5 ? 'caution' : 'low';
}

/**
 * Actually visits the claimed website to confirm something real is
 * running there — RDAP only confirms the domain is *registered*, which
 * is a different fact from a site actually existing and responding.
 */
async function applyWebsiteReachabilitySignal(input: OpportunityInput, companyCategory: CategoryAnalysis): Promise<void> {
  if (!input.companyWebsite.trim()) return;

  const result = await checkWebsiteReachable(input.companyWebsite);

  if (result.status === 'unable_to_verify') {
    companyCategory.gaps.push('Whether the website URL is well-formed and reachable');
    return;
  }

  if (result.status === 'unreachable') {
    companyCategory.findings.push({
      id: nextId(),
      category: 'company',
      severity: 'high',
      title: `Website "${input.companyWebsite.trim()}" could not be reached`,
      finding: 'The claimed company website did not respond to a direct request — it may not exist, may be misspelled, or may not be currently online.',
      evidence: `Attempted to reach: ${input.companyWebsite.trim()}`,
      explanation: 'A company claiming an official website that does not actually respond is a meaningful red flag — this is different from, and more concrete than, the domain simply being new.',
      action: 'Independently search for the company\'s real website before proceeding. Do not trust a link sent to you without verifying it separately.',
    });
    companyCategory.scoreContribution += 22;
    companyCategory.riskLevel = companyCategory.scoreContribution > 15 ? 'high' : companyCategory.scoreContribution > 5 ? 'caution' : 'low';
    return;
  }

  // "Reachable" includes any real HTTP response, even an error status —
  // that still proves a real server answered, which is the actual fact
  // being checked here (not whether the page itself looks good).
  companyCategory.positives.push({
    id: nextId(),
    category: 'company',
    severity: 'positive',
    title: 'Company website is live and reachable',
    finding: 'The claimed company website responded to a direct request.',
    evidence: `${input.companyWebsite.trim()} responded${result.httpStatus ? ` (HTTP ${result.httpStatus})` : ''}`,
    explanation: 'This confirms a real server exists at this address — it does not by itself confirm the site or company are legitimate.',
    action: 'Continue verifying other details as normal.',
  });
}

export async function analyzeOpportunity(input: OpportunityInput): Promise<AnalysisResult> {
  findingCounter = 0;

  let effectiveInput = input;
  let inferredCompanyFinding: Finding | null = null;

  if (!input.company.trim()) {
    const combinedText = `${input.recruiterMessage} ${input.description} ${input.offerLetter}`;
    const inferred = inferCompanyName(combinedText) ?? inferCompanyNameFromWebsite(input.companyWebsite);
    if (inferred) {
      effectiveInput = { ...input, company: inferred };
      inferredCompanyFinding = {
        id: nextId(),
        category: 'company',
        severity: 'positive',
        title: `Company identified: "${inferred}"`,
        finding: `A company name was not explicitly entered, but "${inferred}" was identified from the submitted text${input.companyWebsite.trim() ? ' or website' : ''}.`,
        evidence: inferred,
        explanation: 'This is a best-effort extraction, not a manual entry — worth double-checking it matches the actual company before relying on it.',
        action: 'Confirm this is the correct company name.',
      };
    }
  }

  const companyCategory = analyzeCompany(effectiveInput);
  if (inferredCompanyFinding) companyCategory.positives.push(inferredCompanyFinding);
  await applyDomainAgeSignal(effectiveInput, companyCategory);
  await applyWebsiteReachabilitySignal(effectiveInput, companyCategory);

  const categories: CategoryAnalysis[] = [
    companyCategory,
    analyzeRecruiterIdentity(effectiveInput),
    analyzeEmailDomain(effectiveInput),
    analyzeJobPosting(effectiveInput),
    analyzePayment(`${effectiveInput.offerLetter} ${effectiveInput.recruiterMessage} ${effectiveInput.description}`),
    analyzeRecruitmentProcess(effectiveInput),
    analyzeBrandImpersonation(effectiveInput),
    analyzeOfferLetter(effectiveInput),
    analyzeSensitiveInfo(effectiveInput),
  ];

  const allFindings = categories.flatMap((c) => c.findings);
  const allPositives = categories.flatMap((c) => c.positives);
  const allGaps = categories.flatMap((c) => c.gaps);

  const totalScore = Math.min(100, categories.reduce((sum, c) => sum + c.scoreContribution, 0));
  const score = Math.round(totalScore);

  const majorWarnings = allFindings.filter((f) => f.severity === 'high' || f.severity === 'critical');
  const cautionSignals = allFindings.filter((f) => f.severity === 'caution' || f.severity === 'low');
  const positiveSignals = allPositives;
  const verificationGaps = allGaps.map((g) => ({ item: g }));

  const riskLevel = computeRiskLevel(score, majorWarnings);
  const summary = buildSummary(score, riskLevel, majorWarnings, cautionSignals);
  const recommendedAction = buildRecommendedAction(allFindings);
  const opportunityQuality = assessOpportunityQuality(effectiveInput);
  const verificationConfidence = computeVerificationConfidence(categories);

  const categoryResults: CategoryResult[] = categories.map((c) => ({
    name: c.category,
    status: c.status,
    confidence: c.confidence,
    riskLevel: c.riskLevel,
    evidence: [
      ...c.findings.map((f) => f.title),
      ...c.positives.map((f) => f.title),
    ].slice(0, 5),
  }));

  return {
    id: `check-${Date.now()}`,
    riskScore: score,
    riskLevel,
    verificationConfidence,
    summary,
    majorWarnings,
    cautionSignals,
    positiveSignals,
    verificationGaps,
    categories: categoryResults,
    opportunityQuality,
    recommendedAction,
    createdAt: new Date().toISOString(),
    inputSummary: {
      company: effectiveInput.company.trim() || undefined,
      recruiterName: effectiveInput.recruiterName.trim() || undefined,
      jobTitle: effectiveInput.jobTitle.trim() || undefined,
    },
  };
}