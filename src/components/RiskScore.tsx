import type { RiskLevel } from '@/types/analysis';

interface RiskScoreProps {
  score: number;
  level: RiskLevel;
  size?: 'sm' | 'md' | 'lg';
}

const levelConfig: Record<RiskLevel, { color: string; bgColor: string; ringColor: string; label: string }> = {
  'LOW RISK': { color: 'text-emerald-700', bgColor: 'bg-emerald-50', ringColor: 'text-emerald-500', label: 'NO CAP · LOW RISK' },
  'GENERALLY LOW RISK': { color: 'text-emerald-700', bgColor: 'bg-emerald-50', ringColor: 'text-emerald-400', label: 'MOSTLY NO CAP · LOW RISK' },
  'CAUTION': { color: 'text-amber-700', bgColor: 'bg-amber-50', ringColor: 'text-amber-500', label: 'KINDA SUS · CAUTION' },
  'HIGH RISK': { color: 'text-red-700', bgColor: 'bg-red-50', ringColor: 'text-red-500', label: 'MAJOR CAP · HIGH RISK' },
  'VERY HIGH RISK': { color: 'text-red-800', bgColor: 'bg-red-50', ringColor: 'text-red-600', label: 'ALL CAP · VERY HIGH RISK' },
};

const sizeConfig = {
  sm: { circle: 'w-20 h-20', text: 'text-2xl', label: 'text-xs' },
  md: { circle: 'w-32 h-32', text: 'text-4xl', label: 'text-sm' },
  lg: { circle: 'w-40 h-40', text: 'text-5xl', label: 'text-base' },
};

export default function RiskScore({ score, level, size = 'lg' }: RiskScoreProps) {
  const config = levelConfig[level];
  const sizes = sizeConfig[size];
  const circumference = 2 * Math.PI * 45;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className={`relative ${sizes.circle}`}>
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50" cy="50" r="45"
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            className="text-gray-200"
          />
          <circle
            cx="50" cy="50" r="45"
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className={`${config.ringColor} transition-all duration-1000 ease-out`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`${sizes.text} font-bold ${config.color}`}>{score}</span>
          <span className="text-xs text-gray-400 font-medium">/ 100</span>
        </div>
      </div>
      <div className={`px-4 py-1.5 rounded-full ${config.bgColor} ${config.color} ${sizes.label} font-semibold tracking-wide`}>
        {config.label}
      </div>
    </div>
  );
}
