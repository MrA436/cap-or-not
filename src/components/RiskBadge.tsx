import type { Severity, RiskLevel } from '@/types/analysis';

interface RiskBadgeProps {
  severity?: Severity;
  level?: RiskLevel;
  label?: string;
  size?: 'sm' | 'md';
}

const severityConfig: Record<Severity, { bg: string; text: string; dot: string; defaultLabel: string }> = {
  positive: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', defaultLabel: 'Positive' },
  low: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400', defaultLabel: 'Low' },
  caution: { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500', defaultLabel: 'Caution' },
  high: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500', defaultLabel: 'High Risk' },
  critical: { bg: 'bg-red-100', text: 'text-red-800', dot: 'bg-red-600', defaultLabel: 'Critical' },
};

const levelConfig: Record<RiskLevel, { bg: string; text: string; dot: string }> = {
  'LOW RISK': { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  'GENERALLY LOW RISK': { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  'CAUTION': { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  'HIGH RISK': { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  'VERY HIGH RISK': { bg: 'bg-red-100', text: 'text-red-800', dot: 'bg-red-600' },
};

export default function RiskBadge({ severity, level, label, size = 'md' }: RiskBadgeProps) {
  let config: { bg: string; text: string; dot: string };
  let displayLabel: string;

  if (level) {
    config = levelConfig[level];
    displayLabel = label ?? level;
  } else {
    const sev = severity ?? 'caution';
    const sevConfig = severityConfig[sev];
    config = { bg: sevConfig.bg, text: sevConfig.text, dot: sevConfig.dot };
    displayLabel = label ?? sevConfig.defaultLabel;
  }

  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${config.bg} ${config.text} ${sizeClasses}`}>
      <span className={`w-2 h-2 rounded-full ${config.dot}`} />
      {displayLabel}
    </span>
  );
}
