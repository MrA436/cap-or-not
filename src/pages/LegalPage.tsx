import { Link } from 'react-router-dom';
import { Mail, ShieldCheck } from 'lucide-react';
import { LEGAL } from '@/config/legal';
import type { LegalContent } from '@/pages/legalContent';

interface LegalPageProps {
  content: LegalContent;
}

export default function LegalPage({ content }: LegalPageProps) {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <article>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100 text-gray-600 text-xs mb-4">
          <ShieldCheck className="w-3.5 h-3.5 text-gray-500" />
          Cap or Not
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 tracking-tight">{content.h1}</h1>
        <p className="mt-4 text-lg text-gray-600 leading-relaxed">{content.intro}</p>

        <div className="mt-10 space-y-8">
          {content.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-xl font-bold text-gray-900 mb-3">{section.heading}</h2>
              {section.paragraphs?.map((p, i) => (
                <p key={i} className="text-gray-600 leading-relaxed mb-3">{p}</p>
              ))}
              {section.list && (
                <ul className="mt-2 space-y-2">
                  {section.list.map((item, i) => (
                    <li key={i} className="text-gray-600 flex items-start gap-2.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 mt-2 flex-shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
              {section.links && section.links.length > 0 && (
                <p className="mt-3 text-sm text-gray-500">
                  See also:{' '}
                  {section.links.map((l, i) => (
                    <span key={l.to}>
                      {i > 0 && ' · '}
                      <Link to={l.to} className="underline hover:text-gray-900">{l.label}</Link>
                    </span>
                  ))}
                </p>
              )}
            </section>
          ))}
        </div>

        {content.showContact && (
          <div className="mt-12 bg-gray-50 border border-gray-200 rounded-xl p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-1">{LEGAL.siteName}</h2>
            {LEGAL.operatorName && <p className="text-sm text-gray-500 mb-3">Operated by {LEGAL.operatorName}</p>}
            <p className="flex items-center gap-2.5 text-sm text-gray-700">
              <Mail className="w-4 h-4 text-gray-400" />
              <a href={`mailto:${LEGAL.contactEmail}`} className="underline hover:text-gray-900">{LEGAL.contactEmail}</a>
            </p>
            <p className="mt-3 text-xs text-gray-400">We reply within {LEGAL.supportResponseTime}.</p>
          </div>
        )}
      </article>
    </div>
  );
}