import {
  isThisJobLegit,
  isThisInternshipLegit,
  isThisRecruiterLegit,
  fakeInternshipSigns,
  jobScamChecker,
} from '@/pages/seoContent';
import type { SEOContent } from '@/pages/SEOPage';

export const SITE_URL = 'https://capornot.com';

// Every route that gets a real, unique HTML page at build time — see
// scripts/prerender.mjs. Anything not in here (/check, /result/:id, 404)
// stays client-rendered only, which is fine: they're either dynamic/
// per-visitor or have no unique content worth a crawler indexing.
export const PRERENDERED_ROUTES = [
  '/',
  '/how-it-works',
  '/is-this-job-legit',
  '/is-this-internship-legit',
  '/is-this-recruiter-legit',
  '/fake-internship-signs',
  '/job-scam-checker',
] as const;

// SEOContent (from seoContent.ts) doubles as the source for each guide's
// Article JSON-LD below, so the structured data can't drift out of sync
// with the visible h1/intro the way a hand-maintained duplicate would.
export const pageMeta: Record<string, { title: string; description: string; article?: SEOContent }> = {
  '/': {
    title: 'Cap or Not — Is This Job or Internship Legit?',
    description: 'Paste a job posting, recruiter message, or offer letter. Cap or Not checks for common risk signals and tells you what\'s sus and what\'s not.',
  },
  '/check': {
    title: 'Cap Check It — Cap or Not',
    description: 'Submit a job or internship offer and get a straight-up risk assessment with the evidence to back it up.',
  },
  '/how-it-works': {
    title: 'How Cap or Not Works — Risk Signals & Verification',
    description: 'Learn how Cap or Not evaluates job and internship opportunities across multiple risk categories.',
  },
  '/is-this-job-legit': { title: isThisJobLegit.title, description: isThisJobLegit.metaDescription, article: isThisJobLegit },
  '/is-this-internship-legit': { title: isThisInternshipLegit.title, description: isThisInternshipLegit.metaDescription, article: isThisInternshipLegit },
  '/is-this-recruiter-legit': { title: isThisRecruiterLegit.title, description: isThisRecruiterLegit.metaDescription, article: isThisRecruiterLegit },
  '/fake-internship-signs': { title: fakeInternshipSigns.title, description: fakeInternshipSigns.metaDescription, article: fakeInternshipSigns },
  '/job-scam-checker': { title: jobScamChecker.title, description: jobScamChecker.metaDescription, article: jobScamChecker },
};

export const DEFAULT_TITLE = 'Cap or Not — Job & Internship Cap Checker';
export const DEFAULT_DESCRIPTION = 'Find out if that job or internship offer is cap before you trust it.';

// One <script type="application/ld+json"> per route: Article schema for
// the guide pages (built straight from their own SEOContent), a
// WebApplication + Organization pair on the homepage, nothing on
// transactional/dynamic pages (/check, /result/:id) where structured
// data wouldn't have anything meaningful to describe.
export function buildJsonLd(pathname: string): object | null {
  const meta = pageMeta[pathname];
  if (meta?.article) {
    return {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: meta.article.h1,
      description: meta.article.metaDescription,
      author: { '@type': 'Organization', name: 'Cap or Not', url: SITE_URL },
      publisher: { '@type': 'Organization', name: 'Cap or Not', url: SITE_URL },
      mainEntityOfPage: `${SITE_URL}${pathname}`,
    };
  }
  if (pathname === '/') {
    return [
      {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: 'Cap or Not',
        url: SITE_URL,
        applicationCategory: 'Utility',
        description: meta?.description,
        offers: { '@type': 'Offer', price: '199', priceCurrency: 'INR' },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'Cap or Not',
        url: SITE_URL,
      },
    ];
  }
  return null;
}