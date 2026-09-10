export type Severity = 'positive' | 'low' | 'caution' | 'high' | 'critical';
export type RiskLevel = 'LOW RISK' | 'GENERALLY LOW RISK' | 'CAUTION' | 'HIGH RISK' | 'VERY HIGH RISK';

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
  summary: string;
  majorWarnings: Finding[];
  cautionSignals: Finding[];
  positiveSignals: Finding[];
  verificationGaps: VerificationGap[];
  categories: CategoryResult[];
  opportunityQuality: OpportunityQuality;
  recommendedAction: string;
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

// This is the ONLY shape sent to the browser before a payment is verified.
// It deliberately does not include the full Finding objects, the full
// category evidence, or the full opportunityQuality notes — those only
// exist server-side until /api/unlock confirms payment.
export interface PublicAnalysisResult {
  id: string;
  riskScore: number;
  riskLevel: RiskLevel;
  summary: string;
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
  createdAt: string;
  inputSummary: {
    company?: string;
    recruiterName?: string;
    jobTitle?: string;
  };
}