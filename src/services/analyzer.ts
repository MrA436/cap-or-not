import { randomUUID } from 'node:crypto';
import type {
  Finding,
  Severity,
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
import { resolveContradictions } from './contradictionValidator.js';
import {
  extractFacts,
  signalsOf,
  phrasesOf,
  paymentsOf,
  type CanonicalFacts,
  type ExtractOptions,
  type Fact,
  type Verified,
} from './facts.js';
import { FindingFactory, type IntegrityViolation } from './findingFactory.js';
import type { LlmExtractionResult } from './llmExtract.js';

/**
 * ENGINE SHAPE (see facts.ts / findingFactory.ts):
 *
 *   OpportunityInput → extractFacts() → CanonicalFacts → analyze*(facts, fx) → findings → score
 *
 * Rules for everything in this file:
 *  - Analyzers receive `CanonicalFacts`, never `OpportunityInput`. They do not
 *    scan raw text; if they need a new kind of fact, it is added to facts.ts.
 *  - Findings are built ONLY through `fx.add()` / `fx.make()`, citing the
 *    verified facts they are about.
 *  - Nothing here interpolates a brand, amount, company or recruiter name
 *    that did not come from a fact.
 *  - No I/O. Network probes (website reachability, domain age) run inside
 *    extractFacts() and arrive here as verified `observation` facts.
 */

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

type VFact = Verified<Fact>;
/** Collects the non-null facts a finding is about. */
const cite = (...xs: (VFact | null | undefined)[]): VFact[] => xs.filter((x): x is VFact => !!x);
const quoted = (xs: string[]) => xs.map((k) => `"${k}"`).join(', ');

const FREE_EMAIL_PROVIDERS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com',
  'icloud.com', 'aol.com', 'protonmail.com', 'mail.com', 'yandex.com',
  'zoho.com', 'gmx.com', 'rediff.com', 'yahoo.co.in', 'rocketmail.com',
]);

const JOB_PLATFORMS = ['linkedin', 'indeed', 'glassdoor', 'naukri', 'internshala', 'monster', 'angel.co', 'wellfound'];


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

/**
 * Overall score: driven by evidence SEVERITY, not by how many correlated
 * signals happened to fire.
 *
 * The old model summed every category's scoreContribution with arbitrary
 * per-finding weights, capped at 100. That let four weak, correlated signals
 * (Gmail, WhatsApp, urgency language, no interview mentioned) add up to
 * roughly the same score as one explicit upfront-payment demand — even
 * though those four often co-occur as symptoms of the SAME underlying
 * situation (an informal, fast-moving process) rather than being four
 * independent pieces of evidence.
 *
 * This model instead takes a base score from the single strongest finding's
 * severity, then adds a small, capped "corroboration" amount for everything
 * else. A pile of caution-level signals can nudge the score up a little; it
 * can never manufacture a 100 on its own, and it can never drown out what a
 * genuine critical-severity finding (an explicit payment demand, a
 * government ID request, a lookalike domain) should mean on its own.
 */
const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, caution: 2, low: 1, positive: 0 };
// Score attributable to the single strongest finding present.
const SEVERITY_BASE_SCORE: Record<Severity, number> = { critical: 65, high: 40, caution: 18, low: 6, positive: 0 };
// Additional score per OTHER (non-strongest) finding, by its own severity.
const SEVERITY_UPLIFT: Record<Severity, number> = { critical: 12, high: 6, caution: 2, low: 1, positive: 0 };
// However many corroborating signals pile up, they can't add more than this.
const CORROBORATION_CAP = 25;

function computeOverallScore(allFindings: Finding[]): number {
  const negative = allFindings.filter((f) => f.severity !== 'positive');
  if (negative.length === 0) return 0;

  const sorted = [...negative].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const base = SEVERITY_BASE_SCORE[sorted[0].severity];
  const uplift = Math.min(
    CORROBORATION_CAP,
    sorted.slice(1).reduce((sum, f) => sum + SEVERITY_UPLIFT[f.severity], 0),
  );
  return Math.min(100, Math.round(base + uplift));
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

function analyzeCompany(facts: CanonicalFacts, fx: FindingFactory): CategoryAnalysis {
  const findings: Finding[] = [];
  const positives: Finding[] = [];
  const gaps: string[] = [];
  let scoreContribution = 0;

  const company = facts.company;
  if (!company) {
    // UNKNOWN, not "the user didn't give one": nothing in the submission yielded a verified name.
    gaps.push('Company name was not found in the submitted text');
    return {
      category: 'Company Verification',
      status: 'unable', confidence: 'none', riskLevel: 'low',
      findings, positives, gaps, scoreContribution: 0,
    };
  }

  // A name read out of the posting rather than typed into the form. Worded by how it was obtained.
  if (company.origin === 'labelled') {
    fx.add(positives, {
      category: 'company',
      severity: 'positive',
      title: `Company name: "${company.value}"`,
      finding: `The posting explicitly states the company name as "${company.value}".`,
      evidence: company.value,
      explanation: 'This was explicitly stated in the posting text, not inferred or guessed — treated the same as if it had been typed directly into the company field.',
      action: 'Independently verify this company exists and is who they claim to be.',
      cites: cite(company),
    });
  } else if (company.origin === 'prose' || company.origin === 'llm') {
    fx.add(positives, {
      category: 'company',
      severity: 'positive',
      title: `Company identified: "${company.value}"`,
      finding: `A company name was not explicitly entered, but "${company.value}" was identified from the submitted text.`,
      evidence: company.value,
      explanation: company.origin === 'llm'
        ? 'This was extracted by an AI reading pass, not a manual entry — worth double-checking it matches the actual company before relying on it.'
        : 'This is a best-effort extraction, not a manual entry — worth double-checking it matches the actual company before relying on it.',
      action: 'Confirm this is the correct company name.',
      cites: cite(company),
    });
  }

  const website = facts.website;
  if (!website) {
    // No website is missing information, not evidence of anything — this
    // is a verification gap, not a red flag. It doesn't score.
    fx.gap(gaps, `Whether "${company.value}" has a verifiable official website`, cite(company));
    gaps.push('Whether the company exists');
    gaps.push('Whether the opportunity is consistent with the company');
  } else {
    const domain = getDomainFromUrl(website.value);
    if (domain) {
      const companyNameSlug = company.value.toLowerCase().replace(/[^a-z0-9]/g, '');
      const domainSlug = domain.split('.')[0];
      const isConsistent = domainSlug.includes(companyNameSlug.slice(0, 4)) ||
        companyNameSlug.includes(domainSlug.slice(0, 4));
      if (isConsistent) {
        // A loose string match between the company name and the domain is
        // not evidence of a verified relationship — anyone can put any name
        // next to any URL. It stays a verification gap, not a positive.
        fx.gap(gaps, `Company-domain relationship: Unable to verify — "${company.value}" and the domain "${domain}" look related, but nothing independently confirms they're the same entity`, cite(company, website));
      } else {
        if (fx.add(findings, {
          category: 'company',
          severity: 'caution',
          title: `Website domain "${domain}" doesn't obviously match "${company.value}"`,
          finding: `The website you gave for ${company.value} (${domain}) doesn't clearly match the company name.`,
          evidence: `${company.value} — ${website.value}`,
          explanation: 'This can be legitimate if the company uses a different brand name for its domain, but it warrants verification.',
          action: 'Verify the website is genuinely operated by the claimed company.',
          cites: cite(company, website),
        })) scoreContribution += 8;
      }
    }
    gaps.push('Whether the company is actively operating');
  }

  if (company.value.length < 3) {
    if (fx.add(findings, {
      category: 'company',
      severity: 'caution',
      title: `Company name "${company.value}" is unusually short or generic`,
      finding: `The company name provided ("${company.value}") is very short or generic.`,
      evidence: company.value,
      explanation: 'Vague or generic company names make it harder to verify the employer.',
      action: 'Ask the recruiter for the full registered company name.',
      cites: cite(company),
    })) scoreContribution += 5;
  }

  // Only a brand that is part of the claimed company NAME counts here (word-boundary,
  // verified in facts.ts). A brand merely mentioned in the text is handled by analyzeBrandImpersonation.
  const brandClaimed = facts.brands.find((b) => b.viaCompanyField);
  const email = facts.recruiterEmail;
  if (brandClaimed && email) {
    const emailDomain = getDomainFromEmail(email.value);
    if (emailDomain && FREE_EMAIL_PROVIDERS.has(emailDomain)) {
      if (fx.add(findings, {
        category: 'company',
        severity: 'high',
        title: `Claims to be "${brandClaimed.value}" but recruiter uses a personal email`,
        finding: `The opportunity claims affiliation with "${brandClaimed.value}" but the recruiter uses a free email provider.`,
        evidence: email.value,
        explanation: 'Recruiters from major companies typically use official company email domains, not personal email services.',
        action: 'Contact the company through its official website to verify this recruiter.',
        cites: cite(brandClaimed, email, company),
      })) scoreContribution += 20;
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

function analyzeRecruiterIdentity(facts: CanonicalFacts, fx: FindingFactory): CategoryAnalysis {
  const findings: Finding[] = [];
  const positives: Finding[] = [];
  const gaps: string[] = [];
  let scoreContribution = 0;

  if (!facts.recruiterName) {
    // "Not found", not "not provided": distinguishes an extractor miss from a genuine absence.
    gaps.push('Recruiter name was not found in the submitted text');
  }

  // Pressure tactics and messaging-platform mentions can appear anywhere in the
  // pasted text (someone forwarding a WhatsApp chat may paste it into the
  // description box), so facts.ts scans all three text fields for them.
  //
  // Deliberately NOT here: a scam-phrase check. analyzeJobPosting() already
  // reports that exact list; a second finding would be the same evidence
  // counted twice under another label.
  if (facts.documents.length > 0) {
    const pressure = signalsOf(facts, 'pressure');
    const pressureHits = phrasesOf(pressure);
    if (pressureHits.length > 0) {
      if (fx.add(findings, {
        category: 'recruiter',
        severity: pressureHits.length > 2 ? 'high' : 'caution',
        title: 'Pressure tactics detected in communication',
        finding: 'The submitted text uses urgency or pressure language.',
        evidence: quoted(pressureHits.slice(0, 3)),
        explanation: 'Pressuring candidates to respond quickly is a common tactic in fraudulent recruitment.',
        action: 'Take your time. Legitimate employers do not pressure candidates to make immediate decisions.',
        cites: pressure,
      })) scoreContribution += pressureHits.length > 2 ? 15 : 8;
    }

    const platforms = signalsOf(facts, 'messaging_platform');
    const platformHits = phrasesOf(platforms);
    if (platformHits.length > 0) {
      if (fx.add(findings, {
        category: 'recruiter',
        severity: 'caution',
        title: 'Messaging app as primary contact channel',
        finding: `The opportunity asks you to communicate via ${platformHits.join(', ')}.`,
        evidence: quoted(platformHits),
        explanation: 'While some legitimate recruiters use messaging apps, making them the sole or primary communication channel is a risk indicator.',
        action: 'Verify the recruiter through official company channels before sharing information.',
        cites: platforms,
      })) scoreContribution += 8;
    }

    // Only meaningful for a name the person TYPED: a name extracted out of this
    // same text would make "the name appears in the text" circular. facts.ts
    // only emits this signal for typed names.
    const nameInText = signalsOf(facts, 'recruiter_name_in_text')[0];
    if (facts.recruiterName && nameInText) {
      fx.add(positives, {
        category: 'recruiter',
        severity: 'positive',
        title: 'Recruiter name is present in communication',
        finding: 'The submitted text includes the recruiter\'s name, suggesting personal communication.',
        evidence: facts.recruiterName.value,
        explanation: 'Personalized communication is slightly more reassuring than generic mass outreach.',
        action: 'Still verify the recruiter independently.',
        cites: cite(facts.recruiterName, nameInText),
      });
    }
    // Brevity alone is not a red flag, so there is deliberately no finding for it.
  }

  return {
    category: 'Recruiter Identity',
    status: gaps.length > 0 ? 'unable' : 'partial',
    confidence: gaps.length > 0 ? 'low' : 'medium',
    riskLevel: scoreContribution > 15 ? 'high' : scoreContribution > 5 ? 'caution' : 'low',
    findings, positives, gaps, scoreContribution,
  };
}

function analyzeEmailDomain(facts: CanonicalFacts, fx: FindingFactory): CategoryAnalysis {
  const findings: Finding[] = [];
  const positives: Finding[] = [];
  const gaps: string[] = [];
  let scoreContribution = 0;

  const email = facts.recruiterEmail;
  const website = facts.website;
  const company = facts.company;
  const emailDomain = email ? getDomainFromEmail(email.value) : null;
  const websiteDomain = website ? getDomainFromUrl(website.value) : null;
  const companyName = company?.value ?? 'the company';

  if (!email || !emailDomain) {
    gaps.push('Recruiter email was not provided');
    return {
      category: 'Email / Domain Analysis',
      status: 'unable', confidence: 'none', riskLevel: 'low',
      findings, positives, gaps, scoreContribution: 0,
    };
  }

  if (FREE_EMAIL_PROVIDERS.has(emailDomain)) {
    // One finding either way: a free provider plus "it also isn't the company's
    // domain" are the same underlying fact (the recruiter's affiliation is
    // unverified). This is identity verification, not a fraud claim, so it
    // stays "caution" and says exactly that.
    const alsoDiffersFromWebsite = !!websiteDomain && websiteDomain !== emailDomain;
    if (fx.add(findings, {
      category: 'email',
      severity: 'caution',
      title: 'Recruiter uses a free email provider',
      finding: alsoDiffersFromWebsite
        ? `The recruiter uses ${emailDomain} rather than an address on ${companyName}'s own domain (${websiteDomain}).`
        : `The recruiter email uses a free email provider (${emailDomain}).`,
      evidence: alsoDiffersFromWebsite ? `Email: ${emailDomain} · Website: ${websiteDomain}` : email.value,
      explanation: 'This does not establish that the opportunity is fraudulent — many legitimate third-party recruiters, freelance hiring, and early-stage companies use Gmail. But it means the recruiter\'s affiliation with the company is not yet independently verified.',
      action: 'Verify the recruiter\'s affiliation through the company\'s official website or another independent channel before proceeding.',
      cites: cite(email, alsoDiffersFromWebsite ? website : null, alsoDiffersFromWebsite ? company : null),
    })) scoreContribution += 10;
  } else if (website && websiteDomain) {
    if (emailDomain === websiteDomain) {
      fx.add(positives, {
        category: 'email',
        severity: 'positive',
        title: `Email domain matches ${companyName}'s website`,
        finding: `The recruiter email domain (${emailDomain}) matches the company website domain.`,
        evidence: `${emailDomain} = ${websiteDomain}`,
        explanation: 'A matching domain is a strong positive signal that the recruiter is genuinely affiliated with the company.',
        action: 'Still verify the specific recruiter through the company\'s official channels.',
        cites: cite(email, website, company),
      });
    } else if (isSubdomain(emailDomain, websiteDomain) || isSubdomain(websiteDomain, emailDomain)) {
      fx.add(positives, {
        category: 'email',
        severity: 'positive',
        title: `Email domain “${emailDomain}” is related to “${websiteDomain}”`,
        finding: `The recruiter email domain (${emailDomain}) is a subdomain or parent of the company website domain (${websiteDomain}).`,
        evidence: `${emailDomain} ~ ${websiteDomain}`,
        explanation: 'Related domains suggest the email is from the same organization.',
        action: 'Verify through official channels for full confidence.',
        cites: cite(email, website),
      });
    } else if (detectLookalikeDomain(emailDomain, websiteDomain)) {
      if (fx.add(findings, {
        category: 'email',
        severity: 'critical',
        title: `“${emailDomain}” closely resembles “${websiteDomain}” but isn't identical`,
        finding: `The recruiter email domain (${emailDomain}) closely resembles ${companyName}'s domain (${websiteDomain}) but is not identical.`,
        evidence: `${emailDomain} vs ${websiteDomain}`,
        explanation: 'Lookalike domains (e.g., "arnazon.com" instead of "amazon.com") are a hallmark of impersonation scams.',
        action: 'Do not respond until you have independently verified the correct company domain.',
        cites: cite(email, website, company),
      })) scoreContribution += 25;
    } else {
      if (fx.add(findings, {
        category: 'email',
        severity: 'caution',
        title: `Email domain “${emailDomain}” differs from “${websiteDomain}”`,
        finding: `The recruiter email domain (${emailDomain}) is different from the company website domain (${websiteDomain}).`,
        evidence: `${emailDomain} vs ${websiteDomain}`,
        explanation: 'This may be legitimate for staffing agencies, but should be verified independently.',
        action: 'Verify the recruiter\'s relationship with the company.',
        cites: cite(email, website),
      })) scoreContribution += 10;
    }
  }

  if (emailDomain.split('.').length > 4) {
    if (fx.add(findings, {
      category: 'email',
      severity: 'caution',
      title: 'Unusual email domain pattern',
      finding: 'The email domain has an unusually long subdomain structure.',
      evidence: emailDomain,
      explanation: 'Complex subdomain patterns can be used to disguise the true origin of an email.',
      action: 'Verify the domain independently.',
      cites: cite(email),
    })) scoreContribution += 5;
  }

  return {
    category: 'Email / Domain Analysis',
    status: findings.some((f) => f.severity === 'critical') ? 'suspicious' : 'partial',
    confidence: findings.length === 0 ? 'high' : 'medium',
    riskLevel: scoreContribution > 20 ? 'high' : scoreContribution > 8 ? 'caution' : 'low',
    findings, positives, gaps, scoreContribution,
  };
}

function analyzeJobPosting(facts: CanonicalFacts, fx: FindingFactory): CategoryAnalysis {
  const findings: Finding[] = [];
  const positives: Finding[] = [];
  const gaps: string[] = [];
  let scoreContribution = 0;

  const hasDescriptionOrMessage = facts.documents.some((d) => d.value === 'description' || d.value === 'recruiterMessage');
  if (!hasDescriptionOrMessage) {
    gaps.push('Job description and recruiter message were not provided');
    return {
      category: 'Job Posting Analysis',
      status: 'unable', confidence: 'none', riskLevel: 'low',
      findings, positives, gaps, scoreContribution: 0,
    };
  }

  const scam = signalsOf(facts, 'scam_promise');
  const scamHits = phrasesOf(scam);
  if (scamHits.length > 0) {
    if (fx.add(findings, {
      category: 'job',
      severity: scamHits.length > 2 ? 'high' : 'caution',
      title: scamHits.length > 2 ? 'Multiple unrealistic job promises' : 'Unrealistic job promise detected',
      finding: 'The job posting contains language commonly associated with misleading or fraudulent postings.',
      evidence: quoted(scamHits.slice(0, 4)),
      explanation: 'Promises like "no experience required" combined with high pay, guaranteed income, or instant selection are major warning signs.',
      action: 'Be cautious. Research the company and role independently.',
      cites: scam,
    })) scoreContribution += scamHits.length > 2 ? 15 : 8;
  }

  if (facts.wordCount > 0) {
    if (facts.wordCount < 30) {
      // A brief submission isn't a red flag — it's insufficient information to
      // assess the role, which belongs in gaps, not findings.
      gaps.push('Whether enough detail was provided to assess the role');
    } else {
      fx.add(positives, {
        category: 'job',
        severity: 'positive',
        title: 'Enough detail provided to assess the role',
        finding: 'Enough information was provided to meaningfully assess the opportunity.',
        evidence: `${facts.wordCount} words`,
        explanation: 'More detail allows for a better assessment of the opportunity.',
        action: 'Verify the details against the company\'s official careers page.',
        cites: facts.documents,
      });
    }
  }

  const wfh = signalsOf(facts, 'work_from_home')[0];
  if (facts.jobTitle && wfh && facts.jobTitle.value.toLowerCase().includes('data entry')) {
    if (fx.add(findings, {
      category: 'job',
      severity: 'high',
      title: 'Data entry + work from home pattern',
      finding: 'The role involves data entry with work from home, a pattern commonly seen in fraudulent postings.',
      evidence: facts.jobTitle.value,
      explanation: 'Data entry work-from-home jobs are frequently used in scams that ask for upfront deposits.',
      action: 'Be extremely cautious and verify the company independently.',
      cites: cite(facts.jobTitle, wfh),
    })) scoreContribution += 15;
  }

  if (facts.jobUrl) {
    const url = facts.jobUrl.value.toLowerCase();
    if (JOB_PLATFORMS.some((p) => url.includes(p))) {
      fx.add(positives, {
        category: 'job',
        severity: 'positive',
        title: 'Job posted on a recognized platform',
        finding: 'The job posting URL links to a recognized job platform.',
        evidence: facts.jobUrl.value,
        explanation: 'Jobs on established platforms have some level of platform review, though scams still appear.',
        action: 'Check the poster\'s profile on the platform for authenticity.',
        cites: cite(facts.jobUrl),
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

/**
 * Payment direction is a property of each payment FACT (facts.ts decides it,
 * per clause). This analyzer never looks at text and never pairs an amount
 * with a cue itself — it only reads which way the money flows:
 *   candidate_pays     → the red flag (fee / deposit / "you pay").
 *   candidate_receives → compensation (stipend / salary / "we pay").
 *   unknown            → ignored; no direction evidence, no claim.
 */
function analyzePayment(facts: CanonicalFacts, fx: FindingFactory): CategoryAnalysis {
  const findings: Finding[] = [];
  const positives: Finding[] = [];
  const gaps: string[] = [];
  let scoreContribution = 0;

  if (facts.documents.length === 0) {
    gaps.push('No offer letter or additional information provided');
    return {
      category: 'Payment / Money Detection',
      status: 'unable', confidence: 'none', riskLevel: 'low',
      findings, positives, gaps, scoreContribution: 0,
    };
  }

  const demands = paymentsOf(facts, 'candidate_pays');
  const receives = paymentsOf(facts, 'candidate_receives');

  const purposes = Array.from(new Set(demands.flatMap((d) => (d.purpose ? [d.purpose] : d.cues))));
  const demandAmounts = Array.from(new Set(demands.flatMap((d) => d.amounts)));

  if (demands.length > 0) {
    // A demand and its amount are two attributes of ONE event (the candidate is
    // asked to pay a specific amount for a specific reason), so one finding.
    // Only amounts whose own clause is a candidate→company payment can appear
    // here; a stipend can't, because it lives in a candidate_receives fact.
    const hasAmount = demandAmounts.length > 0;
    const amountText = hasAmount ? demandAmounts[0].trim() : '';
    const lead = purposes[0] ?? 'payment';
    if (fx.add(findings, {
      category: 'payment',
      severity: 'critical',
      tag: 'payment.demand',
      title: hasAmount
        ? `Candidate payment required — ${amountText} ${lead}`
        : `Asked to pay: "${lead}"`,
      finding: hasAmount
        ? `The opportunity requires the candidate to pay ${amountText} as a "${lead}"${purposes.length > 1 ? ` (and ${purposes.length - 1} other payment-related phrase${purposes.length > 2 ? 's' : ''})` : ''} before employment or internship begins.`
        : `The opportunity mentions "${lead}"${purposes.length > 1 ? ` and ${purposes.length - 1} other payment-related phrase${purposes.length > 2 ? 's' : ''}` : ''} — a payment before employment or internship begins.`,
      evidence: hasAmount
        ? `${demandAmounts.slice(0, 3).map((a) => a.trim()).join(', ')} — ${quoted(purposes.slice(0, 4))}`
        : quoted(purposes.slice(0, 4)),
      explanation: 'Legitimate opportunities can have paid training or other costs in some contexts, but unexpected upfront payments — especially a specific demanded amount — are a major warning sign and a hallmark of advance-fee fraud. This should be independently verified.',
      action: 'Do not pay or transfer any money until you have independently verified the opportunity through official company channels.',
      cites: demands,
    })) scoreContribution += 30;
  } else if (receives.length > 0) {
    fx.add(positives, {
      category: 'payment',
      severity: 'positive',
      tag: 'payment.compensation_no_demand',
      title: 'Compensation details provided, no payment requested',
      finding: 'A specific compensation amount is mentioned, and no payment is requested from the applicant.',
      evidence: 'Amount appears alongside compensation language (e.g. "per month", "salary"), not payment-demand language',
      explanation: 'Money described as being paid to the applicant is the opposite of a red flag — this only becomes a concern if a separate, genuine payment request also appears elsewhere.',
      action: 'Independently verify the compensation is realistic for the role and market.',
      cites: receives,
    });
  }

  if (demands.length === 0 && facts.textChars > 50) {
    fx.add(positives, {
      category: 'payment',
      severity: 'positive',
      title: 'No payment requests detected',
      finding: 'No upfront payment, deposit, or fee requests were detected in the provided text.',
      evidence: 'Scanned offer letter and additional information',
      explanation: 'The absence of payment requests is a positive signal.',
      action: 'Remain cautious and verify all other aspects of the opportunity.',
      cites: facts.documents,
    });
  }

  return {
    category: 'Payment / Money Detection',
    status: demands.length > 0 ? 'suspicious' : 'partial',
    confidence: demands.length > 0 ? 'high' : 'medium',
    riskLevel: scoreContribution > 20 ? 'high' : scoreContribution > 0 ? 'caution' : 'low',
    findings, positives, gaps, scoreContribution,
  };
}

function analyzeRecruitmentProcess(facts: CanonicalFacts, fx: FindingFactory): CategoryAnalysis {
  const findings: Finding[] = [];
  const positives: Finding[] = [];
  const gaps: string[] = [];
  let scoreContribution = 0;

  if (facts.documents.length === 0) {
    gaps.push('No process information provided');
    return {
      category: 'Recruitment Process',
      status: 'unable', confidence: 'none', riskLevel: 'low',
      findings, positives, gaps, scoreContribution: 0,
    };
  }

  const noInterview = signalsOf(facts, 'no_interview');
  if (noInterview.length > 0) {
    if (fx.add(findings, {
      category: 'process',
      severity: 'high',
      tag: 'process.no_interview',
      title: 'No formal interview mentioned',
      finding: 'The opportunity appears to proceed without a formal interview.',
      evidence: '"no interview" detected in text',
      explanation: 'Legitimate employers typically conduct interviews. Selection without any interview is a major red flag.',
      action: 'Ask about the interview process. A legitimate employer will have one.',
      cites: noInterview,
    })) scoreContribution += 15;
  }

  const instant = signalsOf(facts, 'instant_selection');
  if (instant.length > 0) {
    if (fx.add(findings, {
      category: 'process',
      severity: 'high',
      title: 'Instant selection detected',
      finding: 'The opportunity suggests immediate or instant selection.',
      evidence: 'Instant/immediate selection language detected',
      explanation: 'Selection without meaningful evaluation is a common sign of fraudulent recruitment.',
      action: 'Be cautious. Legitimate hiring takes time and involves evaluation.',
      cites: instant,
    })) scoreContribution += 12;
  }

  const interview = signalsOf(facts, 'interview');
  const rounds = signalsOf(facts, 'interview_round');
  if (interview.length > 0 && rounds.length > 0) {
    fx.add(positives, {
      category: 'process',
      severity: 'positive',
      tag: 'process.formal_interview_described',
      title: 'Formal interview process described',
      finding: 'The opportunity mentions a formal interview process.',
      evidence: 'Interview-related language detected',
      explanation: 'A described interview process is a positive signal for legitimacy.',
      action: 'Confirm the interview details through official channels.',
      cites: cite(interview[0], rounds[0]),
    });
  }

  const offerMention = signalsOf(facts, 'offer_letter_mention', { includeNegated: true });
  const anyInterviewMention = signalsOf(facts, 'interview', { includeNegated: true });
  if (offerMention.length > 0 && anyInterviewMention.length === 0) {
    if (fx.add(findings, {
      category: 'process',
      severity: 'caution',
      title: 'Offer letter without interview mentioned',
      finding: 'An offer letter is mentioned but no interview process is described.',
      evidence: 'Offer letter referenced without interview context',
      explanation: 'An offer without a preceding interview is unusual for legitimate hiring.',
      action: 'Verify whether an interview is part of the process.',
      cites: cite(offerMention[0]),
    })) scoreContribution += 10;
  }

  const account = signalsOf(facts, 'account_creation');
  if (account.length > 0) {
    if (fx.add(findings, {
      category: 'process',
      severity: 'caution',
      title: 'Asked to create account on external platform',
      finding: 'The recruiter asks candidates to create an account on a specific platform.',
      evidence: quoted(phrasesOf(account).slice(0, 2)),
      explanation: 'Directing candidates to unfamiliar platforms can be a way to collect personal information.',
      action: 'Verify the platform is legitimate before creating an account.',
      cites: account,
    })) scoreContribution += 8;
  }

  const download = signalsOf(facts, 'download');
  const appOrSoftware = signalsOf(facts, 'app_or_software');
  if (download.length > 0 && appOrSoftware.length > 0) {
    if (fx.add(findings, {
      category: 'process',
      severity: 'caution',
      title: 'Asked to download software',
      finding: 'The process requires downloading an app or software.',
      evidence: 'Download instructions detected',
      explanation: 'Requests to download unknown software can be a vector for malware or scams.',
      action: 'Verify the software is legitimate and from an official source before downloading.',
      cites: cite(download[0], appOrSoftware[0]),
    })) scoreContribution += 5;
  }

  return {
    category: 'Recruitment Process',
    status: findings.some((f) => f.severity === 'high') ? 'suspicious' : 'partial',
    confidence: findings.length > 0 ? 'medium' : 'low',
    riskLevel: scoreContribution > 15 ? 'high' : scoreContribution > 5 ? 'caution' : 'low',
    findings, positives, gaps, scoreContribution,
  };
}

/**
 * A brand reaches this function only as a verified BrandFact (word-boundary,
 * proper-noun, not a tool name like "Google Meet", not inside a URL — see
 * extractBrands in facts.ts). If no BrandFact exists, no finding can name one.
 */
function analyzeBrandImpersonation(facts: CanonicalFacts, fx: FindingFactory): CategoryAnalysis {
  const findings: Finding[] = [];
  const positives: Finding[] = [];
  const gaps: string[] = [];
  let scoreContribution = 0;

  const brand = facts.brands[0];
  const gov = signalsOf(facts, 'gov_claim');
  const govFound = phrasesOf(gov);

  if (!brand && govFound.length === 0) {
    return {
      category: 'Brand / Government Affiliation',
      status: 'partial', confidence: 'medium', riskLevel: 'low',
      findings, positives, gaps, scoreContribution: 0,
    };
  }

  const email = facts.recruiterEmail;
  const website = facts.website;

  if (brand) {
    const emailDomain = email ? getDomainFromEmail(email.value) : null;
    if (email && emailDomain && FREE_EMAIL_PROVIDERS.has(emailDomain)) {
      if (fx.add(findings, {
        category: 'brand',
        severity: 'high',
        title: 'Affiliation could not be independently verified',
        finding: `The opportunity claims affiliation with "${brand.value}" but the recruiter uses a personal email.`,
        evidence: `Brand: ${brand.value}, Email: ${email.value}`,
        explanation: 'Recruiters from major brands typically use official company email. The affiliation could not be independently verified.',
        action: 'Contact the company through its official website to verify this relationship.',
        cites: cite(brand, email),
      })) scoreContribution += 15;
    } else {
      fx.gap(gaps, `Relationship with "${brand.value}" could not be independently verified`, cite(brand));
    }
  }

  if (govFound.length > 0) {
    if (fx.add(findings, {
      category: 'brand',
      severity: 'caution',
      title: 'Government affiliation claim detected',
      finding: 'The opportunity claims a government, MSME, or AICTE affiliation.',
      evidence: quoted(govFound.slice(0, 2)),
      explanation: 'Government affiliation claims should be independently verified through official government portals. Do not assume the claim is accurate.',
      action: 'Verify the affiliation through the relevant official government or regulatory website.',
      cites: gov,
    })) scoreContribution += 10;
  }

  if (brand && website) {
    const domain = getDomainFromUrl(website.value);
    if (domain && !domain.includes(brand.value.slice(0, 4))) {
      if (fx.add(findings, {
        category: 'brand',
        severity: 'high',
        title: 'Brand name does not match website domain',
        finding: `The opportunity claims affiliation with "${brand.value}" but the website does not match.`,
        evidence: `Brand: ${brand.value}, Website: ${website.value}`,
        explanation: 'A mismatch between a claimed brand affiliation and the website domain is a significant red flag for impersonation.',
        action: 'Verify the brand\'s official website independently and compare.',
        cites: cite(brand, website),
      })) scoreContribution += 15;
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

function analyzeOfferLetter(facts: CanonicalFacts, fx: FindingFactory): CategoryAnalysis {
  const findings: Finding[] = [];
  const positives: Finding[] = [];
  const gaps: string[] = [];
  let scoreContribution = 0;

  const offerDoc = facts.documents.find((d) => d.value === 'offerLetter');
  if (!offerDoc) {
    gaps.push('No offer letter text was provided');
    return {
      category: 'Offer Letter Analysis',
      status: 'unable', confidence: 'none', riskLevel: 'low',
      findings, positives, gaps, scoreContribution: 0,
    };
  }

  const inOffer = (k: Parameters<typeof signalsOf>[1], includeNegated = false) =>
    signalsOf(facts, k, { field: 'offerLetter', includeNegated });

  // "candidate" and "update" contain the letters d-a-t-e; facts.ts only emits
  // offer_date for the word "date"/"dated" or a real calendar date.
  const dates = inOffer('offer_date');
  if (dates.length === 0) {
    if (fx.add(findings, {
      category: 'offer',
      severity: 'caution',
      title: 'Missing date in offer letter',
      finding: 'The offer letter does not appear to include a date.',
      evidence: 'No date reference detected',
      explanation: 'Legitimate offer letters typically include the date of issuance.',
      action: 'Ask for a dated offer letter on company letterhead.',
      cites: cite(offerDoc),
    })) scoreContribution += 5;
  }

  if (facts.company && signalsOf(facts, 'offer_names_company').length === 0) {
    if (fx.add(findings, {
      category: 'offer',
      severity: 'caution',
      title: 'Company name not mentioned in offer letter',
      finding: 'The claimed company name does not appear in the offer letter text.',
      evidence: `Expected "${facts.company.value}" in offer letter`,
      explanation: 'A legitimate offer letter should reference the employer\'s name.',
      action: 'Ask for an offer letter on official company letterhead.',
      cites: cite(facts.company, offerDoc),
    })) scoreContribution += 8;
  }

  if (inOffer('offer_compensation_term').length === 0) {
    if (fx.add(findings, {
      category: 'offer',
      severity: 'caution',
      title: 'Missing compensation information',
      finding: 'The offer letter does not clearly state salary, stipend, or compensation.',
      evidence: 'No compensation keywords detected',
      explanation: 'A legitimate offer letter should clearly state compensation details.',
      action: 'Request a written offer with clear compensation details.',
      cites: cite(offerDoc),
    })) scoreContribution += 5;
  }

  const template = inOffer('template_phrase');
  const genericHits = phrasesOf(template);
  if (genericHits.length >= 2) {
    if (fx.add(findings, {
      category: 'offer',
      severity: 'caution',
      title: 'Generic/template language detected',
      finding: 'Several responsibilities are described broadly without identifying a specific project, team, manager, or deliverable.',
      evidence: quoted(genericHits),
      explanation: 'Heavy use of generic boilerplate language can indicate a template-based offer rather than a genuine, role-specific letter.',
      action: 'Request a detailed offer letter with specific role and project information.',
      cites: template,
    })) scoreContribution += 8;
  }

  // Direction-aware: only a candidate→company payment inside the offer letter itself.
  const offerDemands = paymentsOf(facts, 'candidate_pays').filter((p) => p.span.field === 'offerLetter');
  if (offerDemands.length > 0) {
    const cues = Array.from(new Set(offerDemands.flatMap((d) => (d.purpose ? [d.purpose] : d.cues))));
    if (fx.add(findings, {
      category: 'offer',
      severity: 'critical',
      title: 'Payment requirement in offer letter',
      finding: 'The offer letter contains a payment or deposit requirement.',
      evidence: quoted(cues.slice(0, 3)),
      explanation: 'Payment requirements in an offer letter are a major red flag.',
      action: 'Do not pay any amount. Verify the company independently first.',
      cites: offerDemands,
    })) scoreContribution += 20;
  }

  const comp = inOffer('salary_or_stipend');
  if (comp.length > 0) {
    fx.add(positives, {
      category: 'offer',
      severity: 'positive',
      title: 'Compensation details included',
      finding: 'The offer letter mentions salary or stipend details.',
      evidence: 'Compensation keywords detected',
      explanation: 'Including compensation details is a positive signal.',
      action: 'Verify the compensation is realistic for the role and market.',
      cites: cite(comp[0]),
    });
  }

  if (dates.length > 0) {
    fx.add(positives, {
      category: 'offer',
      severity: 'positive',
      title: 'Offer letter appears structured',
      finding: 'The offer letter includes dates and appears to follow a letter format.',
      evidence: 'Date and structured format detected',
      explanation: 'A structured offer letter is more reassuring than a casual message.',
      action: 'Still verify the letterhead and company independently.',
      cites: cite(dates[0]),
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

function analyzeSensitiveInfo(facts: CanonicalFacts, fx: FindingFactory): CategoryAnalysis {
  const findings: Finding[] = [];
  const gaps: string[] = [];
  let scoreContribution = 0;

  // Negation ("we never ask for your Aadhaar") is resolved per mention in
  // facts.ts with a 60-char window; negated mentions are excluded here.
  const govId = signalsOf(facts, 'sens_gov_id');
  const financial = signalsOf(facts, 'sens_financial');
  // Generic "ID proof" only counts when nothing more specific matched, so one
  // request is never counted under two labels.
  const genericId = govId.length === 0 ? signalsOf(facts, 'sens_gov_id_generic') : [];
  // "Photo ID" names the identity document itself (reported under Government ID
  // above), not a separate photograph - one request, one label. A genuinely
  // separate photograph request ("ID and a passport-size photograph") is kept.
  const photo = signalsOf(facts, 'sens_photo')
    .filter((s) => !((govId.length > 0 || genericId.length > 0) && s.phrase.toLowerCase() === 'photo id'));

  if (govId.length > 0 || genericId.length > 0) {
    const hits = govId.length > 0 ? govId : genericId;

    // Severity follows timing and context, never a document's name alone.
    // Routine = EVERY mention is explicit post-selection onboarding AND the text
    // has none of the suspicious signals already extracted by the facts layer
    // (coercive pressure, messaging-app channel, candidate payment, financial
    // details, offer without interview, unrealistic promises). Application-stage,
    // unspecified timing, or any suspicious context keeps it critical.
    const suspiciousContext =
      signalsOf(facts, 'pressure').length > 0 ||
      signalsOf(facts, 'messaging_platform').length > 0 ||
      signalsOf(facts, 'sens_financial').length > 0 ||
      signalsOf(facts, 'no_interview').length > 0 ||
      signalsOf(facts, 'instant_selection').length > 0 ||
      signalsOf(facts, 'scam_promise').length > 0 ||
      paymentsOf(facts, 'candidate_pays').length > 0;
    const routine = !suspiciousContext && hits.every((h) => h.idContext?.stage === 'post_selection');

    // Say only what was actually requested - never "ID number" for a document.
    const forms = new Set(hits.map((h) => h.idContext?.form ?? 'unspecified'));
    const askedFor = forms.has('number') && forms.has('document') ? 'a government-issued identity document and an ID number'
      : forms.has('number') ? 'a government-issued ID number'
      : forms.has('document') ? 'a government-issued identity document'
      : 'a government-issued identity credential (the posting does not say whether a number or a copy of the document is wanted)';

    if (fx.add(findings, {
      category: 'sensitive',
      severity: routine ? 'caution' : 'critical',
      title: 'Government ID requested',
      finding: `The opportunity asks for ${askedFor}.`,
      evidence: quoted(phrasesOf(hits).slice(0, 3)),
      explanation: routine
        ? 'Collecting identity documents from selected candidates before they start is common practice, so on its own this is not a sign of fraud. These documents do enable identity theft if they reach the wrong party, so confirm the employer first and send them only through a channel you have verified.'
        : 'Requests for a government ID (Aadhaar, PAN, passport, driving license, voter ID) before the employer is verified are a significant warning sign — these documents enable identity theft.',
      action: routine
        ? 'Confirm the employer is genuine, and that the request really comes from them, before sending any ID document or number.'
        : 'Do not share government ID documents or numbers until the employer is independently verified.',
      cites: hits,
    })) scoreContribution += routine ? 8 : 20;
  }

  if (financial.length > 0) {
    if (fx.add(findings, {
      category: 'sensitive',
      severity: 'critical',
      title: 'Bank or financial account details requested',
      finding: 'The opportunity asks for bank account, card, or other financial access details.',
      evidence: quoted(phrasesOf(financial).slice(0, 3)),
      explanation: 'No legitimate employer needs your bank account number, card details, or PINs before or during hiring.',
      action: 'Never share bank details, card numbers, CVV, or PINs with a recruiter.',
      cites: financial,
    })) scoreContribution += 20;
  }

  if (photo.length > 0) {
    if (fx.add(findings, {
      category: 'sensitive',
      severity: 'caution',
      title: 'Photograph requested',
      finding: 'The opportunity asks for a passport-size photograph.',
      evidence: quoted(phrasesOf(photo).slice(0, 3)),
      explanation: 'A photo alone is commonly requested by legitimate employers for ID badges or profile records, and is not on its own a sign of fraud. Treat it as routine unless paired with a government ID or payment request.',
      action: 'A photo request alone is not a red flag — but avoid sending one alongside government ID or payment.',
      cites: photo,
    })) scoreContribution += 3;
  }

  const anyHit = govId.length > 0 || genericId.length > 0 || financial.length > 0 || photo.length > 0;

  return {
    category: 'Sensitive Information',
    status: anyHit ? 'suspicious' : 'partial',
    confidence: anyHit ? 'high' : 'medium',
    riskLevel: scoreContribution > 15 ? 'high' : scoreContribution > 5 ? 'caution' : 'low',
    findings, positives: [], gaps, scoreContribution,
  };
}

/** Qualitative notes — every conclusion is backed by a fact actually present, never by a missing buzzword. */
function assessOpportunityQuality(facts: CanonicalFacts): OpportunityQuality {
  const notes: string[] = [];
  let qualityScore = 0;
  const has = (k: Parameters<typeof signalsOf>[1], includeNegated = false) =>
    signalsOf(facts, k, { includeNegated }).length > 0;

  if (facts.textChars < 50) {
    notes.push('Job description is very brief — unclear responsibilities.');
    qualityScore -= 1;
  } else {
    notes.push('Job description provides some detail.');
  }

  if (has('mentorship')) {
    notes.push('Mentorship is mentioned.');
    qualityScore += 1;
  }

  if (has('comp_context')) {
    notes.push('Compensation details are clearly described.');
    qualityScore += 1;
  }

  if (has('certificate') && !has('salary_or_stipend', true)) {
    notes.push('The opportunity appears to be certificate-focused without compensation.');
    qualityScore -= 2;
  }

  if (has('unpaid')) {
    notes.push('The opportunity may be unpaid.');
    qualityScore -= 1;
  }

  if (has('sales_target')) {
    notes.push('Sales or fundraising targets are mentioned — may indicate revenue-dependent role.');
    qualityScore -= 1;
  }

  if (has('project') && has('team_or_manager')) {
    notes.push('Specific project/team context is described.');
    qualityScore += 1;
  }

  if (has('interview') || has('assessment')) {
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
function applyDomainAgeSignal(facts: CanonicalFacts, fx: FindingFactory, companyCategory: CategoryAnalysis): void {
  const website = facts.website;
  if (!website || !getDomainFromUrl(website.value)) return;
  const domain = getDomainFromUrl(website.value)!;

  const obs = facts.observations.find((o) => o.probe === 'domain_age');
  if (!obs || obs.outcome !== 'known' || obs.ageDays == null) {
    companyCategory.gaps.push('Domain registration date');
    return;
  }

  const ageDays = obs.ageDays;
  const registeredDate = obs.registeredDate;

  if (ageDays < 30) {
    if (fx.add(companyCategory.findings, {
      category: 'company',
      severity: 'high',
      title: `Website domain "${domain}" was registered ${ageDays} day${ageDays !== 1 ? 's' : ''} ago`,
      finding: `The website domain was registered very recently (${ageDays} day${ageDays !== 1 ? 's' : ''} ago).`,
      evidence: `Domain age: ${ageDays} days (registered ${registeredDate})`,
      explanation: 'This increases uncertainty and should be verified alongside other signals. A new legitimate business can have a new domain — this alone is not proof of anything.',
      action: 'Independently verify the company through other channels before proceeding.',
      cites: cite(website, obs),
    })) companyCategory.scoreContribution += 18;
  } else if (ageDays < 180) {
    if (fx.add(companyCategory.findings, {
      category: 'company',
      severity: 'caution',
      title: `Website domain "${domain}" is ${ageDays} days old`,
      finding: `The website domain was registered ${ageDays} days ago.`,
      evidence: `Domain age: ${ageDays} days (registered ${registeredDate})`,
      explanation: 'A newer domain is not evidence of fraud on its own, but it is a mild signal worth weighing alongside everything else.',
      action: 'Cross-check the company through other independent sources.',
      cites: cite(website, obs),
    })) companyCategory.scoreContribution += 8;
  } else if (ageDays > 365) {
    fx.add(companyCategory.positives, {
      category: 'company',
      severity: 'positive',
      title: `Website domain has been registered for over a year`,
      finding: `The website domain was registered ${Math.floor(ageDays / 365)}+ year(s) ago.`,
      evidence: `Domain age: ${ageDays} days (registered ${registeredDate})`,
      explanation: 'An established domain age is a mild positive signal, though still not independent proof of legitimacy.',
      action: 'Continue verifying other details as normal.',
      cites: cite(website, obs),
    });
  }
  // 180-365 days: neutral, no finding either way.

  companyCategory.riskLevel = companyCategory.scoreContribution > 15 ? 'high' : companyCategory.scoreContribution > 5 ? 'caution' : 'low';
}

/**
 * Reads the website-reachability OBSERVATION (made in extractFacts, where a
 * negative result is only reported as evidence if the probe could observe at
 * all). One failed GET is weak evidence about a company, so:
 *   reachable      → positive.
 *   dns_not_found  → the name does not resolve (and a control probe proved the
 *                    observer's DNS works): a CAUTION, not a major warning.
 *   inconclusive   → timeouts / TLS / blocks / offline observer: a verification
 *                    gap only. It says nothing about the company.
 */
function applyWebsiteReachabilitySignal(facts: CanonicalFacts, fx: FindingFactory, companyCategory: CategoryAnalysis): void {
  const website = facts.website;
  if (!website) return;

  const obs = facts.observations.find((o) => o.probe === 'website_reachability');
  if (!obs || obs.outcome === 'inconclusive') {
    companyCategory.gaps.push('Whether the website URL is well-formed and reachable');
    return;
  }

  if (obs.outcome === 'dns_not_found') {
    if (fx.add(companyCategory.findings, {
      category: 'company',
      severity: 'caution',
      tag: 'company.website_unreachable',
      title: `Website "${website.value}" did not resolve`,
      finding: 'The domain name of the claimed company website could not be found, so no server could be reached.',
      evidence: `DNS lookup for ${website.value} returned "not found"`,
      explanation: 'A web address that does not resolve is worth checking — it is often a typo in a link — but a single automated check is not proof of a fake company, so this is a caution rather than a major warning.',
      action: 'Check the spelling of the website and search for the company\'s real site independently.',
      cites: cite(website, obs),
    })) companyCategory.scoreContribution += 8;
    companyCategory.riskLevel = companyCategory.scoreContribution > 15 ? 'high' : companyCategory.scoreContribution > 5 ? 'caution' : 'low';
    return;
  }

  // "Reachable" includes any real HTTP response, even an error status — that
  // still proves a real server answered, which is the fact being checked.
  fx.add(companyCategory.positives, {
    category: 'company',
    severity: 'positive',
    tag: 'company.website_reachable',
    title: 'Company website is live and reachable',
    finding: 'The claimed company website responded to a direct request.',
    evidence: `${website.value} responded${obs.httpStatus ? ` (HTTP ${obs.httpStatus})` : ''}`,
    explanation: 'This confirms a real server exists at this address — it does not by itself confirm the site or company are legitimate.',
    action: 'Continue verifying other details as normal.',
    cites: cite(website, obs),
  });
}

export interface AnalyzeOptions {
  /**
   * Enables the LLM extractor as a fallback for a company/recruiter name the
   * deterministic extractors couldn't find. The LLM only proposes CANDIDATES
   * (value + verbatim quote); facts.ts accepts one only if the quote is found
   * in the real text and contains the value. If omitted or failing, the field
   * simply stays UNKNOWN.
   */
  llmApiKey?: string;
  /** Test seam: replaces the network LLM call. */
  llmExtractor?: (text: string) => Promise<LlmExtractionResult>;
  /** Test seam: replaces the website / domain-age probes (which run inside extractFacts). */
  probes?: ExtractOptions['probes'];
  /** Called whenever the finding factory drops a finding for citing unsupported facts. */
  onIntegrityViolation?: (v: IntegrityViolation) => void;
}

export async function analyzeOpportunity(input: OpportunityInput, options: AnalyzeOptions = {}): Promise<AnalysisResult> {
  // The ONE read of the raw input. Everything below sees only verified facts.
  const facts = await extractFacts(input, { llmApiKey: options.llmApiKey, llmExtractor: options.llmExtractor, probes: options.probes });
  const fx = new FindingFactory(facts, options.onIntegrityViolation);

  const companyCategory = analyzeCompany(facts, fx);
  applyDomainAgeSignal(facts, fx, companyCategory);
  applyWebsiteReachabilitySignal(facts, fx, companyCategory);

  const categories: CategoryAnalysis[] = [
    companyCategory,
    analyzeRecruiterIdentity(facts, fx),
    analyzeEmailDomain(facts, fx),
    analyzeJobPosting(facts, fx),
    analyzePayment(facts, fx),
    analyzeRecruitmentProcess(facts, fx),
    analyzeBrandImpersonation(facts, fx),
    analyzeOfferLetter(facts, fx),
    analyzeSensitiveInfo(facts, fx),
  ];

  // Contradiction pass: runs on the fully assembled set, across every
  // category, before anything (score, UI, summary) derives from the
  // result. See contradictionValidator.ts for the resolution policy.
  const { positives: resolvedPositives, notes: contradictionNotes } = resolveContradictions(
    categories.flatMap((c) => c.findings),
    categories.flatMap((c) => c.positives),
  );
  if (contradictionNotes.length > 0) {
    const droppedIds = new Set(
      categories.flatMap((c) => c.positives).filter((p) => !resolvedPositives.includes(p)).map((p) => p.id),
    );
    // Keep each category's own .positives array consistent with the resolved set.
    for (const c of categories) {
      c.positives = c.positives.filter((p) => !droppedIds.has(p.id));
    }
  }

  const allFindings = categories.flatMap((c) => c.findings);
  const allPositives = categories.flatMap((c) => c.positives);
  const allGaps = categories.flatMap((c) => c.gaps);

  const score = computeOverallScore(allFindings);

  const majorWarnings = allFindings.filter((f) => f.severity === 'high' || f.severity === 'critical');
  const cautionSignals = allFindings.filter((f) => f.severity === 'caution' || f.severity === 'low');
  const positiveSignals = allPositives;
  const verificationGaps = allGaps.map((g) => ({ item: g }));

  const riskLevel = computeRiskLevel(score, majorWarnings);
  const summary = buildSummary(score, riskLevel, majorWarnings, cautionSignals);
  const recommendedAction = buildRecommendedAction(allFindings);
  const opportunityQuality = assessOpportunityQuality(facts);
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
    id: randomUUID(),
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
    // From verified facts only — never from the raw input object.
    inputSummary: {
      company: facts.company?.value,
      recruiterName: facts.recruiterName?.value,
      jobTitle: facts.jobTitle?.value,
    },
  };
}