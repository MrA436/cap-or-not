import { useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import Layout from '@/components/Layout';
import LandingPage from '@/pages/LandingPage';
import CheckPage from '@/pages/CheckPage';
import ResultPage from '@/pages/ResultPage';
import HowItWorksPage from '@/pages/HowItWorksPage';
import SEOPage from '@/pages/SEOPage';
import NotFoundPage from '@/pages/NotFoundPage';
import {
  isThisJobLegit,
  isThisInternshipLegit,
  isThisRecruiterLegit,
  fakeInternshipSigns,
  jobScamChecker,
} from '@/pages/seoContent';
import { SITE_URL, pageMeta, buildJsonLd, DEFAULT_TITLE, DEFAULT_DESCRIPTION } from '@/seo/meta';

function setMetaTag(selector: string, attr: string, value: string) {
  const el = document.querySelector(selector);
  if (el) el.setAttribute(attr, value);
}

function usePageMeta() {
  const { pathname } = useLocation();
  useEffect(() => {
    const meta = pageMeta[pathname];
    const title = meta?.title ?? DEFAULT_TITLE;
    const description = meta?.description ?? DEFAULT_DESCRIPTION;
    const canonicalUrl = `${SITE_URL}${pathname === '/' ? '' : pathname}`;

    document.title = title;
    setMetaTag('meta[name="description"]', 'content', description);
    setMetaTag('meta[property="og:title"]', 'content', title);
    setMetaTag('meta[property="og:description"]', 'content', description);
    setMetaTag('meta[property="og:url"]', 'content', canonicalUrl);
    setMetaTag('meta[name="twitter:title"]', 'content', title);
    setMetaTag('meta[name="twitter:description"]', 'content', description);
    setMetaTag('link[rel="canonical"]', 'href', canonicalUrl);

    // Dynamic pages (a specific /result/:id) don't have a canonical/og
    // representation worth indexing, and robots.txt already excludes
    // /result/ — this just keeps the tags from lying about those pages too.
    const isDynamic = pathname.startsWith('/result/');
    const ogUrlTag = document.querySelector('meta[property="og:url"]');
    if (isDynamic && ogUrlTag) ogUrlTag.setAttribute('content', SITE_URL);

    let jsonLdTag = document.getElementById('page-jsonld') as HTMLScriptElement | null;
    const jsonLd = buildJsonLd(pathname);
    if (jsonLd) {
      if (!jsonLdTag) {
        jsonLdTag = document.createElement('script');
        jsonLdTag.id = 'page-jsonld';
        jsonLdTag.type = 'application/ld+json';
        document.head.appendChild(jsonLdTag);
      }
      jsonLdTag.textContent = JSON.stringify(jsonLd);
    } else if (jsonLdTag) {
      jsonLdTag.remove();
    }
  }, [pathname]);
}

export default function App() {
  usePageMeta();

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/check" element={<CheckPage />} />
        <Route path="/result/:id" element={<ResultPage />} />
        <Route path="/how-it-works" element={<HowItWorksPage />} />
        <Route path="/is-this-job-legit" element={<SEOPage content={isThisJobLegit} />} />
        <Route path="/is-this-internship-legit" element={<SEOPage content={isThisInternshipLegit} />} />
        <Route path="/is-this-recruiter-legit" element={<SEOPage content={isThisRecruiterLegit} />} />
        <Route path="/fake-internship-signs" element={<SEOPage content={fakeInternshipSigns} />} />
        <Route path="/job-scam-checker" element={<SEOPage content={jobScamChecker} />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  );
}