import type { OpportunityQuality } from '@/types/analysis';
import { CheckCircle2, AlertCircle, MinusCircle } from 'lucide-react';

interface OpportunityQualityCardProps {
  quality: OpportunityQuality;
}

const ratingConfig = {
  'Appears Structured': { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  'Limited Information': { icon: MinusCircle, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
  'Potentially Low Quality': { icon: AlertCircle, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
};

export default function OpportunityQualityCard({ quality }: OpportunityQualityCardProps) {
  const config = ratingConfig[quality.rating];
  const Icon = config.icon;

  return (
    <div className={`rounded-lg border ${config.border} ${config.bg} p-5`}>
      <div className="flex items-center gap-3 mb-3">
        <Icon className={`w-5 h-5 ${config.color}`} />
        <h3 className="font-semibold text-gray-900">Opportunity Quality</h3>
      </div>
      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white ${config.color} text-sm font-semibold mb-3`}>
        {quality.rating}
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Quality is separate from legitimacy. An opportunity may be legitimate but still low quality.
      </p>
      <ul className="space-y-1.5">
        {quality.notes.map((note, i) => (
          <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-gray-400 mt-2 flex-shrink-0" />
            {note}
          </li>
        ))}
      </ul>
    </div>
  );
}
