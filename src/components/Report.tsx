import type { AnalysisResult, PublicAnalysisResult, PublicFinding, OpportunityInput, CategoryResult } from '@/types/analysis';
import RiskScore from './RiskScore';
import FindingCard from './FindingCard';
import OpportunityQualityCard from './OpportunityQualityCard';
import UnlockGate from './UnlockGate';
import {
  AlertTriangle, AlertCircle, CheckCircle2, Search, Copy, Share2, Clock, Lock, ShieldCheck,
  DollarSign, RefreshCw, FileCheck, FileText, Building2, UserCheck, Mail, HelpCircle,
  type LucideIcon,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { generateShareSummary, generateFullReport, copyToClipboard } from '@/services/share';

interface ReportProps {
  publicResult: PublicAnalysisResult;
  fullResult: AnalysisResult | null;
  input: OpportunityInput;
  onUnlocked: (fullResult: AnalysisResult) => void;
  // From AnalyzeResponse via storage.ts. Undefined for checks saved before
  // this existed, or if this report was unlocked via payment/code rather
  // than a free credit — in all those cases we just don't show the banner.
  freeChecksRemaining?: number;
}

const qualityRatingStyle: Record<string, { color: string; bg: string; border: string }> = {
  'Appears Structured': { color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  'Limited Information': { color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
  'Potentially Low Quality': { color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
};

const confidenceStyle: Record<string, string> = {
  High: 'text-emerald-600',
  Medium: 'text-amber-600',
  Low: 'text-gray-500',
};

// --- Opportunity Analysis: WHAT was checked, grouped by topic ---
// Each of the 9 CategoryResult entries the analyzer produces (one per
// CategoryAnalysis.category, e.g. "Company Verification") is folded into
// one of 7 topic groups here. This is a display-only regrouping — it
// doesn't change what the analyzer computes, just how the unlocked report
// presents it: a scannable "here's what we looked at" overview, separate
// from the "here's what we found" severity list below it (Risk Signals).
const TOPIC_GROUPS: { label: string; icon: LucideIcon; categoryNames: string[] }[] = [
  { label: 'Payment', icon: DollarSign, categoryNames: ['Payment / Money Detection'] },
  { label: 'Process', icon: RefreshCw, categoryNames: ['Recruitment Process'] },
  { label: 'Claims', icon: FileCheck, categoryNames: ['Job Posting Analysis', 'Brand / Government Affiliation'] },
  { label: 'Documents', icon: FileText, categoryNames: ['Offer Letter Analysis', 'Sensitive Information'] },
  { label: 'Company', icon: Building2, categoryNames: ['Company Verification'] },
  { label: 'Recruiter', icon: UserCheck, categoryNames: ['Recruiter Identity'] },
  { label: 'Email / Domain', icon: Mail, categoryNames: ['Email / Domain Analysis'] },
];

// Worse-first priority so combining multiple CategoryResults into one
// topic group (e.g. Claims = Job Posting + Brand Affiliation) surfaces
// the more concerning of the two rather than averaging them away.
const STATUS_PRIORITY: CategoryResult['status'][] = ['suspicious', 'unable', 'partial', 'verified'];

const STATUS_STYLE: Record<CategoryResult['status'], { icon: LucideIcon; color: string; bg: string; border: string; label: string }> = {
  suspicious: { icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', label: 'Concerns found' },
  unable: { icon: HelpCircle, color: 'text-gray-500', bg: 'bg-gray-50', border: 'border-gray-200', label: 'Not enough info' },
  partial: { icon: AlertCircle, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', label: 'Partially checked' },
  verified: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', label: 'Checks out' },
};

interface TopicSummary {
  label: string;
  icon: LucideIcon;
  status: CategoryResult['status'];
  evidence: string[];
}

function buildOpportunityAnalysis(fullResult: AnalysisResult): TopicSummary[] {
  return TOPIC_GROUPS.map((group) => {
    const members = fullResult.categories.filter((c) => group.categoryNames.includes(c.name));
    const status = STATUS_PRIORITY.find((s) => members.some((m) => m.status === s)) ?? 'unable';
    const evidence = Array.from(new Set(members.flatMap((m) => m.evidence))).slice(0, 6);
    return { label: group.label, icon: group.icon, status, evidence };
  }).filter((t) => t.evidence.length > 0 || t.status !== 'unable');
}

// --- Risk Signals: WHAT was found, grouped by severity ---
const RISK_SIGNAL_GROUPS: { key: 'majorWarnings' | 'cautionSignals' | 'positiveSignals'; label: string; dot: string }[] = [
  { key: 'majorWarnings', label: 'Major warnings', dot: 'bg-red-500' },
  { key: 'cautionSignals', label: 'Caution signals', dot: 'bg-orange-400' },
  { key: 'positiveSignals', label: 'Positive signals', dot: 'bg-emerald-500' },
];

function LockedFindingRow({ finding }: { finding: PublicFinding }) {
  const dot = finding.severity === 'critical' || finding.severity === 'high' ? 'bg-red-500' : 'bg-orange-400';
  return (
    <div className="flex items-center gap-3 py-2.5 px-4 rounded-lg bg-gray-50 border border-gray-100">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
      <p className="text-sm text-gray-700 flex-1 min-w-0 truncate">{finding.title}</p>
      <Lock className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
    </div>
  );
}

export default function Report({ publicResult, fullResult, input, onUnlocked, freeChecksRemaining }: ReportProps) {
  const [copied, setCopied] = useState<'share' | 'full' | null>(null);
  const [animateScore, setAnimateScore] = useState(false);
  const unlocked = fullResult !== null;

  useEffect(() => {
    const timer = setTimeout(() => setAnimateScore(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const handleCopyShare = async () => {
    if (!fullResult) return;
    const success = await copyToClipboard(generateShareSummary(fullResult));
    if (success) {
      setCopied('share');
      setTimeout(() => setCopied(null), 2000);
    }
  };

  const handleCopyFull = async () => {
    if (!fullResult) return;
    const success = await copyToClipboard(generateFullReport(fullResult));
    if (success) {
      setCopied('full');
      setTimeout(() => setCopied(null), 2000);
    }
  };

  const hasMajor = publicResult.majorWarningsCount > 0;
  const HeaderIcon = hasMajor ? AlertTriangle : publicResult.cautionSignalsCount > 0 ? AlertCircle : CheckCircle2;
  const headerColor = hasMajor ? 'text-red-600' : publicResult.cautionSignalsCount > 0 ? 'text-amber-600' : 'text-emerald-600';
  const qualityStyle = qualityRatingStyle[publicResult.qualityRating];
  const extraLockedCount = publicResult.totalLockedFindingsCount - publicResult.lockedFindingTitles.length;
  const extraPositiveCount = publicResult.totalPositiveCount - (publicResult.positivePreview ? 1 : 0);

  const opportunityAnalysis = fullResult ? buildOpportunityAnalysis(fullResult) : [];

  const gatedContent = fullResult && (
    <div className="space-y-6">
      <section>
        <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900 mb-1">
          <Search className="w-4 h-4 text-gray-400" />
          Opportunity Analysis
        </h3>
        <p className="text-sm text-gray-500 mb-3">What was checked, by topic.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {opportunityAnalysis.map((topic) => {
            const style = STATUS_STYLE[topic.status];
            const TopicIcon = topic.icon;
            const StatusIcon = style.icon;
            return (
              <div key={topic.label} className={`rounded-lg border ${style.border} ${style.bg} p-4`}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="flex items-center gap-2 font-semibold text-gray-900 text-sm">
                    <TopicIcon className="w-4 h-4 text-gray-500" />
                    {topic.label}
                  </span>
                  <span className={`flex items-center gap-1 text-xs font-medium ${style.color}`}>
                    <StatusIcon className="w-3.5 h-3.5" />
                    {style.label}
                  </span>
                </div>
                {topic.evidence.length > 0 && (
                  <ul className="space-y-1">
                    {topic.evidence.map((item, i) => (
                      <li key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-gray-400 mt-1.5 flex-shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900 mb-1">
          <ShieldCheck className="w-4 h-4 text-gray-400" />
          Risk Signals
        </h3>
        <p className="text-sm text-gray-500 mb-3">What was found, by severity, with the evidence behind it.</p>
        <div className="space-y-5">
          {RISK_SIGNAL_GROUPS.map((group) => {
            const items = fullResult[group.key];
            if (items.length === 0) return null;
            return (
              <div key={group.key}>
                <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${group.dot}`} />
                  {group.label} ({items.length})
                </h4>
                <div className="space-y-3">
                  {items.map((f) => (
                    <FindingCard key={f.id} finding={f} defaultExpanded={f.severity === 'critical' || f.severity === 'high'} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <OpportunityQualityCard quality={fullResult.opportunityQuality} />

      <section className="bg-gray-900 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4 text-center flex items-center justify-center gap-2">
          <ShieldCheck className="w-4 h-4" />
          What you should do
        </h3>
        <ol className="space-y-3 max-w-xl mx-auto">
          {fullResult.recommendedAction.steps.map((step, i) => (
            <li key={i} className="flex items-start gap-3 text-white text-sm">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/15 text-xs font-semibold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
        <div className="mt-5 pt-5 border-t border-white/10 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1.5">Bottom line</p>
          <p className="text-white font-medium leading-relaxed max-w-xl mx-auto">{fullResult.recommendedAction.bottomLine}</p>
        </div>
      </section>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={handleCopyShare}
          className="flex-1 flex items-center justify-center gap-2 bg-white border border-gray-300 hover:border-gray-400 text-gray-700 font-medium py-3 rounded-lg transition-colors"
        >
          {copied === 'share' ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Share2 className="w-4 h-4" />}
          {copied === 'share' ? 'Copied!' : 'Share Result'}
        </button>
        <button
          onClick={handleCopyFull}
          className="flex-1 flex items-center justify-center gap-2 bg-white border border-gray-300 hover:border-gray-400 text-gray-700 font-medium py-3 rounded-lg transition-colors"
        >
          {copied === 'full' ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
          {copied === 'full' ? 'Copied!' : 'Copy Report'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-6 sm:p-8 text-center">
          <div className={`inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-50 mb-4 ${headerColor}`}>
            <HeaderIcon className="w-6 h-6" />
          </div>
          <RiskScore score={animateScore ? publicResult.riskScore : 0} level={publicResult.riskLevel} size="lg" />
          <p className={`mt-2 text-xs font-semibold ${confidenceStyle[publicResult.verificationConfidence]}`}>
            Verification confidence: {publicResult.verificationConfidence}
          </p>
          <p className="mt-3 text-gray-600 max-w-lg mx-auto text-sm">{publicResult.summary}</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 border-t border-gray-100">
          <div className="p-4 text-center border-r border-gray-100">
            <p className="text-2xl font-bold text-red-600">{publicResult.majorWarningsCount}</p>
            <p className="text-xs text-gray-500 mt-0.5">Major warning{publicResult.majorWarningsCount !== 1 ? 's' : ''}</p>
          </div>
          <div className="p-4 text-center sm:border-r border-gray-100">
            <p className="text-2xl font-bold text-orange-500">{publicResult.cautionSignalsCount}</p>
            <p className="text-xs text-gray-500 mt-0.5">Caution signal{publicResult.cautionSignalsCount !== 1 ? 's' : ''}</p>
          </div>
          <div className="p-4 text-center border-t sm:border-t-0 border-r border-gray-100">
            <p className="text-2xl font-bold text-emerald-600">{publicResult.totalPositiveCount}</p>
            <p className="text-xs text-gray-500 mt-0.5">Positive signal{publicResult.totalPositiveCount !== 1 ? 's' : ''}</p>
          </div>
          <div className="p-4 text-center border-t sm:border-t-0">
            <p className="text-2xl font-bold text-gray-400">{publicResult.verificationGaps.length}</p>
            <p className="text-xs text-gray-500 mt-0.5">Verification gap{publicResult.verificationGaps.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>

      {publicResult.previewFinding && (
        <section>
          <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900 mb-3">
            <span className={`w-3 h-3 rounded-full ${publicResult.previewFinding.severity === 'critical' || publicResult.previewFinding.severity === 'high' ? 'bg-red-500' : 'bg-orange-400'}`} />
            What we found — the receipts
          </h3>
          <FindingCard finding={publicResult.previewFinding} defaultExpanded />
        </section>
      )}

      {publicResult.totalLockedFindingsCount > 0 && (
        <section>
          <h3 className="text-lg font-bold text-gray-900 mb-1">
            {publicResult.totalLockedFindingsCount} more finding{publicResult.totalLockedFindingsCount !== 1 ? 's' : ''}
            {publicResult.criticalLockedCount > 0 ? `, including ${publicResult.criticalLockedCount} critical` : ''}
          </h3>
          <p className="text-sm text-gray-500 mb-3">A couple of headlines, free. The rest — plus the evidence and what to do — are in the full report.</p>
          <div className="space-y-2">
            {publicResult.lockedFindingTitles.map((f) => (
              <LockedFindingRow key={f.id} finding={f} />
            ))}
            {extraLockedCount > 0 && (
              <div className="flex items-center gap-3 py-2.5 px-4 rounded-lg bg-gray-50 border border-gray-100 border-dashed">
                <Lock className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                <p className="text-sm text-gray-400 flex-1">+ {extraLockedCount} more finding{extraLockedCount !== 1 ? 's' : ''} in the full report</p>
              </div>
            )}
          </div>
        </section>
      )}

      {publicResult.positivePreview && (
        <section>
          <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900 mb-1">
            <span className="w-3 h-3 rounded-full bg-emerald-500" />
            {publicResult.totalPositiveCount} thing{publicResult.totalPositiveCount !== 1 ? 's' : ''} that check{publicResult.totalPositiveCount === 1 ? 's' : ''} out
          </h3>
          <div className="space-y-2 mt-3">
            <div className="flex items-center gap-3 py-2.5 px-4 rounded-lg bg-emerald-50 border border-emerald-100">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              <p className="text-sm text-gray-700 flex-1 min-w-0 truncate">{publicResult.positivePreview.title}</p>
            </div>
            {extraPositiveCount > 0 && (
              <div className="flex items-center gap-3 py-2.5 px-4 rounded-lg bg-gray-50 border border-gray-100 border-dashed">
                <Lock className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                <p className="text-sm text-gray-400 flex-1">+ {extraPositiveCount} more positive signal{extraPositiveCount !== 1 ? 's' : ''} in the full report</p>
              </div>
            )}
          </div>
        </section>
      )}

      {publicResult.verificationGaps.length > 0 && (
        <section className="bg-amber-50 rounded-xl border border-amber-200 p-5">
          <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900 mb-1">
            <Search className="w-5 h-5 text-amber-500" />
            {publicResult.verificationGaps.length} verification check{publicResult.verificationGaps.length !== 1 ? 's' : ''} could not be completed with the information provided
          </h3>
          <ul className="space-y-2 mt-3">
            {publicResult.verificationGaps.map((gap, i) => (
              <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 flex-shrink-0" />
                {gap.item}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* These two rows are pre-unlock teasers ("...locked"). Once unlocked,
          the real Opportunity Analysis and Verification Completeness cards
          render below inside gatedContent, so showing the locked teaser
          alongside the unlocked content would be redundant and, worse,
          would keep claiming something is locked that no longer is. */}
      {!unlocked && (
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900 mb-1">Category breakdown</p>
            <p className="text-xs text-gray-500">
              {publicResult.categoriesConcernCount} of {publicResult.categoriesTotalCount} categories raised real concerns
            </p>
          </div>
          <div className="text-xs text-gray-400 flex items-center gap-1 flex-shrink-0">
            <Lock className="w-3 h-3" />
            Full breakdown locked
          </div>
        </section>
      )}

      {!unlocked && (
        <section className={`rounded-lg border ${qualityStyle.border} ${qualityStyle.bg} p-5 flex items-center justify-between gap-3`}>
          <div>
            <p className="text-sm font-semibold text-gray-900 mb-1">Verification Completeness</p>
            <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white ${qualityStyle.color} text-sm font-semibold`}>
              {publicResult.qualityRating}
            </span>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 flex items-center gap-1 justify-end">
              <Lock className="w-3 h-3" />
              {publicResult.qualityNotesLockedCount} note{publicResult.qualityNotesLockedCount !== 1 ? 's' : ''} locked
            </p>
          </div>
        </section>
      )}

      <section className="bg-gray-900 rounded-xl p-6 text-center">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Bottom line</h3>
        <p className="text-lg text-white font-medium leading-relaxed max-w-xl mx-auto">
          {publicResult.recommendedActionPreview}
          {publicResult.recommendedActionHasMore && <span className="text-gray-500">…</span>}
        </p>
        {publicResult.actionStepsCount > 0 && (
          <p className="text-xs text-gray-500 mt-3">Unlock the full verification: evidence, category checks, and your recommended next step.</p>
        )}
      </section>

      {unlocked && typeof freeChecksRemaining === 'number' && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-800">
          <ShieldCheck className="w-4 h-4 flex-shrink-0" />
          <span>
            This was a free check.{' '}
            {freeChecksRemaining > 0
              ? `${freeChecksRemaining} free check${freeChecksRemaining === 1 ? '' : 's'} left.`
              : "That was your last free check — checks from here on unlock for ₹149 each."}
          </span>
        </div>
      )}

      {!unlocked && freeChecksRemaining === 0 && (
        <p className="text-xs text-gray-500 -mb-2">You've used all 5 free checks. Need another verification?</p>
      )}

      {unlocked ? gatedContent : <UnlockGate input={input} onUnlocked={onUnlocked} />}

      <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
        <Clock className="w-3 h-3" />
        Generated on {new Date(publicResult.createdAt).toLocaleString()}
      </div>

      <div className="text-center">
        <p className="text-xs text-gray-400 max-w-md mx-auto">
          Cap or Not provides risk indicators and verification guidance. It does not guarantee that an opportunity is legitimate or fraudulent. It does not independently verify websites or companies in real time.
        </p>
      </div>
    </div>
  );
}