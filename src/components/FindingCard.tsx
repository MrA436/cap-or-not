import type { Finding } from '@/types/analysis';
import RiskBadge from './RiskBadge';
import { AlertTriangle, AlertCircle, Info, CheckCircle2, ChevronDown } from 'lucide-react';
import { useState } from 'react';

interface FindingCardProps {
  finding: Finding;
  defaultExpanded?: boolean;
}

const severityIcon = {
  critical: AlertTriangle,
  high: AlertTriangle,
  caution: AlertCircle,
  low: Info,
  positive: CheckCircle2,
};

const severityBorder = {
  critical: 'border-l-red-600',
  high: 'border-l-red-500',
  caution: 'border-l-orange-400',
  low: 'border-l-amber-300',
  positive: 'border-l-emerald-500',
};

const severityIconColor = {
  critical: 'text-red-600',
  high: 'text-red-500',
  caution: 'text-orange-500',
  low: 'text-amber-400',
  positive: 'text-emerald-500',
};

export default function FindingCard({ finding, defaultExpanded = false }: FindingCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const Icon = severityIcon[finding.severity];
  const iconColor = severityIconColor[finding.severity];
  const borderClass = severityBorder[finding.severity];

  return (
    <div className={`bg-white rounded-lg border border-gray-200 border-l-4 ${borderClass} overflow-hidden transition-shadow hover:shadow-sm`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-3 p-4 text-left"
      >
        <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${iconColor}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-semibold text-gray-900 text-sm">{finding.title}</h4>
            <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </div>
          <p className="text-sm text-gray-600 mt-1 line-clamp-2">{finding.finding}</p>
          <div className="mt-2">
            <RiskBadge severity={finding.severity} size="sm" label={finding.category} />
          </div>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 pl-12 space-y-3">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Evidence</p>
            <p className="text-sm text-gray-700 bg-gray-50 rounded px-3 py-2 font-mono break-all">{finding.evidence}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Why it matters</p>
            <p className="text-sm text-gray-700">{finding.explanation}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Recommended action</p>
            <p className="text-sm text-gray-700 bg-blue-50 rounded px-3 py-2">{finding.action}</p>
          </div>
        </div>
      )}
    </div>
  );
}
