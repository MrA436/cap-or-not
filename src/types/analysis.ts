export type Severity = 'positive' | 'low' | 'caution' | 'high' | 'critical';
export type RiskLevel = 'LOW RISK' | 'GENERALLY LOW RISK' | 'CAUTION' | 'HIGH RISK' | 'VERY HIGH RISK';

export type VerificationConfidence = 'Low' | 'Medium' | 'High';

// Risk and confidence are tracked separately on purpose — "High risk, low
// confidence" is a real, meaningful state ("we found warning signs but
// couldn't verify much"), and collapsing them into one number would hide
// that distinction.
export interface RecommendedActionPlan {
  steps: string[];
  bottomLine: string;
}

export interface Finding {
  id: string;
  category: string;
  severity: Severity;
  title: string;
  finding: string;
  evidence: string;
  explanation: string;
  action: string;
}

export interface CategoryResult {
  name: string;
  status: 'verified' | 'partial' | 'unable' | 'suspicious';
  confidence: 'high' | 'medium' | 'low' | 'none';
  riskLevel: 'low' | 'caution' | 'high';
  evidence: string[];
}

export interface OpportunityQuality {
  rating: 'Appears Structured' | 'Limited Information' | 'Potentially Low Quality';
  notes: string[];
}

export interface VerificationGap {
  item: string;
}

export interface AnalysisResult {
  id: string;
  riskScore: number;
  riskLevel: RiskLevel;
  verificationConfidence: VerificationConfidence;
  summary: string;
  majorWarnings: Finding[];
  cautionSignals: Finding[];
  positiveSignals: Finding[];
  verificationGaps: VerificationGap[];
  categories: CategoryResult[];
  opportunityQuality: OpportunityQuality;
  recommendedAction: RecommendedActionPlan;
  createdAt: string;
  inputSummary: {
    company?: string;
    recruiterName?: string;
    jobTitle?: string;
  };
}

export interface OpportunityInput {
  company: string;
  recruiterName: string;
  recruiterEmail: string;
  companyWebsite: string;
  jobTitle: string;
  jobPostingUrl: string;
  description: string;
  recruiterMessage: string;
  offerLetter: string;
  agreeToTerms: boolean;
}

// A stripped title-only version of a Finding — used for the free/public
// teaser list so the browser never receives the evidence/explanation/action
// for locked findings before payment is verified.
export interface PublicFinding {
  id: string;
  title: string;
  severity: Severity;
}

// 'standard' = one of the 5 lifetime free screenings — the richer preview
// (one fully expanded finding, up to 2 more title-only findings, a
// positive-signal preview, full verification-gap list). 'limited' = the
// free-screening allowance is used up — a smaller preview (no expanded
// finding, fewer title-only findings, no positive-signal preview, a
// trimmed gap list), still genuinely informative, never the full report.
// Neither tier ever includes the full report — that only ever comes from
// /api/unlock after a verified payment. See toPublicResult() in
// analyzer.ts for exactly what each tier includes.
export type PreviewTier = 'standard' | 'limited';

// This is the ONLY shape sent to the browser before a payment is verified.
// It deliberately does not include the full Finding objects, the full
// category evidence, or the full opportunityQuality notes — those only
// exist server-side until /api/unlock confirms payment. Response shape
// for POST /api/analyze — always just the preview (see PreviewTier); the
// full report is never returned here, free screening or not.
export interface AnalyzeResponse {
  publicResult: PublicAnalysisResult;
  freeChecksRemaining: number;
}

export interface PublicAnalysisResult {
  id: string;
  riskScore: number;
  riskLevel: RiskLevel;
  verificationConfidence: VerificationConfidence;
  summary: string;
  previewTier: PreviewTier;
  previewFinding: Finding | null;
  lockedFindingTitles: PublicFinding[];
  totalLockedFindingsCount: number;
  criticalLockedCount: number;
  majorWarningsCount: number;
  cautionSignalsCount: number;
  positivePreview: PublicFinding | null;
  totalPositiveCount: number;
  verificationGaps: VerificationGap[];
  categoriesTotalCount: number;
  categoriesConcernCount: number;
  qualityRating: OpportunityQuality['rating'];
  qualityNotesLockedCount: number;
  recommendedActionPreview: string;
  recommendedActionHasMore: boolean;
  actionStepsCount: number;
  createdAt: string;
  inputSummary: {
    company?: string;
    recruiterName?: string;
    jobTitle?: string;
  };
}