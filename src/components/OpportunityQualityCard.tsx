import type { OpportunityQuality } from '@/types/analysis';
import { CheckCircle2, AlertCircle, MinusCircle } from 'lucide-react';

interface OpportunityQualityCardProps {
  quality: OpportunityQuality;
}

const ratingConfig = {
  'Appears Structured': {
    icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200',
    subtext: 'The opportunity is clearly described with real structural detail.',
  },
  'Limited Information': {
    icon: MinusCircle, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200',
    subtext: 'Not a red flag on its own — there simply wasn\'t enough structural detail to fully assess.',
  },
  'Potentially Low Quality': {
    icon: AlertCircle, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200',
    subtext: 'Specific concerning patterns were found in how the opportunity is described — see notes below.',
  },
};

export default function OpportunityQualityCard({ quality }: OpportunityQualityCardProps) {
  const config = ratingConfig[quality.rating];
  const Icon = config.icon;

  return (
    <div className={`rounded-lg border ${config.border} ${config.bg} p-5`}>
      <div className="flex items-center gap-3 mb-3">
        <Icon className={`w-5 h-5 ${config.color}`} />
        <h3 className="font-semibold text-gray-900">Verification Completeness</h3>
      </div>
      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white ${config.color} text-sm font-semibold mb-2`}>
        {quality.rating}
      </div>
      <p className="text-xs text-gray-500 mb-3">
        {config.subtext} This is separate from legitimacy — an opportunity can be genuine but still light on detail, or well-described but still a scam.
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