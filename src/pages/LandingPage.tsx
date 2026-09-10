import { Link } from 'react-router-dom';
import {
  ShieldCheck, ArrowRight, UserSearch, Building2, Mail, FileText,
  MessageSquare, DollarSign, Link2, Globe, FileCheck, Copy, Award,
  HandCoins, Rocket,
} from 'lucide-react';

const checkCards = [
  { icon: UserSearch, title: 'Recruiter identity', desc: 'Verify the recruiter name, role, and company affiliation.' },
  { icon: Building2, title: 'Company information', desc: 'Check whether the company appears consistent and verifiable.' },
  { icon: Mail, title: 'Email / domain', desc: 'Compare recruiter email domain against the company website.' },
  { icon: FileText, title: 'Job posting', desc: 'Detect vague descriptions, unrealistic pay, and pressure tactics.' },
  { icon: MessageSquare, title: 'Recruitment process', desc: 'Flag missing interviews, instant selection, or unusual channels.' },
  { icon: DollarSign, title: 'Payment requests', desc: 'Identify upfront fees, deposits, or transfer requests.' },
  { icon: FileCheck, title: 'Offer letters', desc: 'Analyze for generic language, missing details, or payment terms.' },
  { icon: Link2, title: 'Suspicious links', desc: 'Detect unusual URLs and third-party platform redirects.' },
  { icon: Globe, title: 'Third-party platforms', desc: 'Flag requests to register on unfamiliar websites.' },
  { icon: Copy, title: 'Generic / template language', desc: 'Spot boilerplate descriptions that lack specificity.' },
  { icon: Award, title: 'Government / brand affiliation', desc: 'Verify claims of official partnerships or approvals.' },
  { icon: Rocket, title: 'Unrealistic promises', desc: 'Catch guaranteed income, no-experience-required, and more.' },
];

const steps = [
  { num: '1', title: 'Paste the opportunity', desc: 'Share the job posting, recruiter message, or offer letter text.' },
  { num: '2', title: 'We run the cap check', desc: 'Cap or Not checks for risk indicators across multiple categories.' },
  { num: '3', title: 'Understand the risks', desc: 'Review a structured report with evidence-based findings.' },
  { num: '4', title: 'Decide what to do next', desc: 'Follow recommended actions before sharing information or paying.' },
];

export default function LandingPage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100 text-gray-600 text-sm mb-6">
            <ShieldCheck className="w-4 h-4 text-gray-500" />
            No cap, just a vibe check on your offer
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold text-gray-900 tracking-tight leading-tight">
            Is this internship legit, or is it cap?
          </h1>
          <p className="mt-5 text-lg text-gray-600 max-w-2xl mx-auto leading-relaxed">
            Paste a job posting, recruiter message, or offer letter. Cap or Not checks for common risk signals and tells you straight up what's sus and what's not.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/check"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 text-white font-semibold px-6 py-3 rounded-lg transition-colors"
            >
              Cap Check It
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/how-it-works"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-gray-300 hover:border-gray-400 text-gray-700 font-semibold px-6 py-3 rounded-lg transition-colors"
            >
              How It Works
            </Link>
          </div>
          <p className="mt-6 text-xs text-gray-400 max-w-md mx-auto">
            Cap or Not provides risk indicators and verification guidance. It does not guarantee that an opportunity is legitimate or fraudulent.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="py-16 sm:py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 text-center mb-12">How the cap check works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((step) => (
              <div key={step.num} className="text-center">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-gray-900 text-white font-bold text-sm mb-4">
                  {step.num}
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{step.title}</h3>
                <p className="text-sm text-gray-600">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What we check */}
      <section className="bg-white border-y border-gray-200 py-16 sm:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 text-center mb-4">What gets checked for cap</h2>
          <p className="text-gray-600 text-center mb-12 max-w-xl mx-auto">
            Cap or Not evaluates each opportunity across multiple independent categories to give you the full picture — no cap.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {checkCards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.title}
                  className="bg-gray-50 rounded-lg border border-gray-200 p-5 hover:border-gray-300 hover:shadow-sm transition-all"
                >
                  <div className="w-10 h-10 rounded-lg bg-white border border-gray-200 flex items-center justify-center mb-3">
                    <Icon className="w-5 h-5 text-gray-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900 text-sm mb-1">{card.title}</h3>
                  <p className="text-sm text-gray-600">{card.desc}</p>
                </div>
              );
            })}
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
      </section>

      {/* Privacy */}
      <section className="py-16 sm:py-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <HandCoins className="w-10 h-10 text-gray-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-3">No cap on privacy either</h2>
          <p className="text-gray-600">
            We only analyze information you choose to submit. We do not store uploaded offer letters or recruiter messages permanently unless you explicitly choose to save a report. We never ask for passwords, OTPs, bank credentials, or government ID numbers.
          </p>
        </div>
      </section>
    </div>
  );
}
