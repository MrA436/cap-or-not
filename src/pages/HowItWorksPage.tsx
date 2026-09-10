import { Link } from 'react-router-dom';
import { ClipboardCheck, Search, FileWarning, ArrowRight, ShieldCheck } from 'lucide-react';

const steps = [
  {
    icon: ClipboardCheck,
    title: '1. Paste the opportunity',
    desc: 'Share whatever information you have — a job posting, recruiter message, offer letter, or company details. You don\'t need to fill every field. The more you provide, the stronger the analysis.',
  },
  {
    icon: Search,
    title: '2. We run the cap check',
    desc: 'Cap or Not evaluates the opportunity across multiple independent categories: company verification, recruiter identity, email/domain analysis, job posting analysis, payment detection, recruitment process, brand impersonation, and offer letter analysis.',
  },
  {
    icon: FileWarning,
    title: '3. Understand the risks',
    desc: 'You receive a structured report with a risk score (0–100), categorized findings, evidence from your input, verification gaps, and an assessment of opportunity quality separate from legitimacy.',
  },
  {
    icon: ShieldCheck,
    title: '4. Decide what to do next',
    desc: 'Every report includes practical recommended actions — what to verify, what to avoid, and how to independently confirm the opportunity through official channels.',
  },
];

export default function HowItWorksPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <div className="text-center mb-12">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 tracking-tight">How Cap or Not works</h1>
        <p className="mt-4 text-gray-600 max-w-xl mx-auto">
          Cap or Not is a verification assistant, not a magic scam detector. It helps you spot what's sus, what checks out, and what to do next.
        </p>
      </div>

      <div className="space-y-8">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <div key={step.title} className="flex gap-5">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center">
                  <Icon className="w-6 h-6 text-gray-600" />
                </div>
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 text-lg mb-2">{step.title}</h2>
                <p className="text-gray-600 leading-relaxed">{step.desc}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-12 bg-gray-50 rounded-xl border border-gray-200 p-6 text-center">
        <h2 className="font-semibold text-gray-900 mb-2">Risk score categories</h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4">
          {[
            { range: '0–20', label: 'LOW RISK', color: 'text-emerald-600 bg-emerald-50' },
            { range: '21–40', label: 'GENERALLY LOW', color: 'text-emerald-600 bg-emerald-50' },
            { range: '41–60', label: 'CAUTION', color: 'text-amber-600 bg-amber-50' },
            { range: '61–80', label: 'HIGH RISK', color: 'text-red-600 bg-red-50' },
            { range: '81–100', label: 'VERY HIGH', color: 'text-red-700 bg-red-100' },
          ].map((cat) => (
            <div key={cat.label} className={`rounded-lg p-3 ${cat.color}`}>
              <p className="text-xs font-medium">{cat.range}</p>
              <p className="text-sm font-bold mt-0.5">{cat.label}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-4 max-w-md mx-auto">
          The score represents risk indicators, not the probability that the opportunity is actually fraudulent.
        </p>
      </div>

      <div className="text-center mt-10">
        <Link
          to="/check"
          className="inline-flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white font-semibold px-6 py-3 rounded-lg transition-colors"
        >
          Cap Check It
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
