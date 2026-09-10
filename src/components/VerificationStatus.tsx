import type { CategoryResult } from '@/types/analysis';
import { CheckCircle2, AlertCircle, HelpCircle, ShieldAlert } from 'lucide-react';

interface VerificationStatusProps {
  category: CategoryResult;
}

const statusConfig = {
  verified: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50', label: 'Verified' },
  partial: { icon: AlertCircle, color: 'text-amber-500', bg: 'bg-amber-50', label: 'Partial' },
  unable: { icon: HelpCircle, color: 'text-gray-400', bg: 'bg-gray-50', label: 'Unable to verify' },
  suspicious: { icon: ShieldAlert, color: 'text-red-500', bg: 'bg-red-50', label: 'Suspicious' },
};

const riskColor = {
  low: 'text-emerald-600',
  caution: 'text-amber-600',
  high: 'text-red-600',
};

export default function VerificationStatus({ category }: VerificationStatusProps) {
  const config = statusConfig[category.status];
  const Icon = config.icon;

  return (
    <div className="flex items-center justify-between gap-3 py-2.5 px-4 rounded-lg hover:bg-gray-50 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${config.bg}`}>
          <Icon className={`w-4 h-4 ${config.color}`} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{category.name}</p>
          <p className="text-xs text-gray-500">{config.label}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {category.evidence.length > 0 && (
          <span className="text-xs text-gray-400">{category.evidence.length} signal{category.evidence.length !== 1 ? 's' : ''}</span>
        )}
        <span className={`text-xs font-semibold ${riskColor[category.riskLevel]}`}>
          {category.riskLevel === 'low' ? 'Low' : category.riskLevel === 'caution' ? 'Caution' : 'High'}
        </span>
      </div>
    </div>
  );
}
