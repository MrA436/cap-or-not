import { Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck } from 'lucide-react';

export interface SEOContent {
  title: string;
  metaDescription: string;
  h1: string;
  intro: string;
  sections: { heading: string; body: string; list?: string[] }[];
  ctaText: string;
}

interface SEOPageProps {
  content: SEOContent;
}

export default function SEOPage({ content }: SEOPageProps) {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <article>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100 text-gray-600 text-xs mb-4">
          <ShieldCheck className="w-3.5 h-3.5 text-gray-500" />
          Cap or Not Guide
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 tracking-tight">{content.h1}</h1>
        <p className="mt-4 text-lg text-gray-600 leading-relaxed">{content.intro}</p>

        <div className="mt-6 bg-gray-50 border border-gray-200 rounded-lg p-4">
          <p className="text-sm text-gray-600">
            Cap or Not provides risk indicators and verification guidance. It does not guarantee that an opportunity is legitimate or fraudulent.
          </p>
        </div>

        <div className="mt-10 space-y-8">
          {content.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-xl font-bold text-gray-900 mb-3">{section.heading}</h2>
              <p className="text-gray-600 leading-relaxed">{section.body}</p>
              {section.list && (
                <ul className="mt-4 space-y-2">
                  {section.list.map((item, i) => (
                    <li key={i} className="text-gray-600 flex items-start gap-2.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 mt-2 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <div className="mt-12 bg-gray-900 rounded-xl p-8 text-center">
          <h2 className="text-xl font-bold text-white mb-2">{content.ctaText}</h2>
          <p className="text-gray-400 text-sm mb-6">Paste the opportunity details and get a structured risk report in seconds.</p>
          <Link
            to="/check"
            className="inline-flex items-center gap-2 bg-white text-gray-900 font-semibold px-6 py-3 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Cap Check It
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </article>
    </div>
  );
}
