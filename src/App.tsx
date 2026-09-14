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

const pageMeta: Record<string, { title: string; description: string }> = {
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
  '/is-this-job-legit': { title: isThisJobLegit.title, description: isThisJobLegit.metaDescription },
  '/is-this-internship-legit': { title: isThisInternshipLegit.title, description: isThisInternshipLegit.metaDescription },
  '/is-this-recruiter-legit': { title: isThisRecruiterLegit.title, description: isThisRecruiterLegit.metaDescription },
  '/fake-internship-signs': { title: fakeInternshipSigns.title, description: fakeInternshipSigns.metaDescription },
  '/job-scam-checker': { title: jobScamChecker.title, description: jobScamChecker.metaDescription },
};

function usePageMeta() {
  const { pathname } = useLocation();
  useEffect(() => {
    const meta = pageMeta[pathname];
    document.title = meta?.title ?? 'Cap or Not — Job & Internship Cap Checker';
    const descTag = document.querySelector('meta[name="description"]');
    if (descTag) {
      descTag.setAttribute('content', meta?.description ?? 'Find out if that job or internship offer is cap before you trust it.');
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