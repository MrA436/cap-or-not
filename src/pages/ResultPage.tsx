import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Report from '@/components/Report';
import type { AnalysisResult } from '@/types/analysis';
import { getCheck, cacheFullResult } from '@/services/storage';
import { ArrowLeft, FileX } from 'lucide-react';

export default function ResultPage() {
  const { id } = useParams<{ id: string }>();
  const [check, setCheck] = useState<ReturnType<typeof getCheck>>(null);
  const [fullResult, setFullResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      const item = getCheck(id);
      setCheck(item);
      setFullResult(item?.fullResult ?? null);
    }
    setLoading(false);
  }, [id]);

  // Called by UnlockGate once /api/unlock has verified a real payment and
  // returned the full analysis. Nothing about "unlocked" is ever decided
  // in the browser before this point.
  const handleUnlocked = (result: AnalysisResult) => {
    setFullResult(result);
    if (id) cacheFullResult(id, result);
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-500">Loading report...</p>
      </div>
    );
  }

  if (!check) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
          <FileX className="w-8 h-8 text-gray-400" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Report not found</h1>
        <p className="text-gray-500 mb-6">This report may have been deleted or is no longer available.</p>
        <Link
          to="/check"
          className="inline-flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white font-semibold px-5 py-2.5 rounded-lg transition-colors"
        >
          Check a new opportunity
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <Link
        to="/check"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        New check
      </Link>
      <Report
        publicResult={check.publicResult}
        fullResult={fullResult}
        input={check.input}
        onUnlocked={handleUnlocked}
        freeChecksRemaining={check.freeChecksRemaining}
      />
    </div>
  );
}