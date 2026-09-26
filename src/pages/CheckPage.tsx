import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import OpportunityForm from '@/components/OpportunityForm';
import type { OpportunityInput, AnalyzeResponse } from '@/types/analysis';
import { saveCheck } from '@/services/storage';
import { ShieldCheck } from 'lucide-react';

export default function CheckPage() {
  const navigate = useNavigate();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (input: OpportunityInput) => {
    setIsAnalyzing(true);
    setError(null);

    try {
      // The full analysis is computed server-side but never sent here —
      // /api/analyze always returns just a preview (see api/analyze.ts +
      // _lib/store.ts for which tier). The full report only arrives via
      // the pay-to-unlock flow (or a later GET /api/report, once paid)
      // on the result page.
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Analysis failed');
      }

      const { publicResult, freeChecksRemaining }: AnalyzeResponse = await res.json();
      saveCheck(publicResult, input, freeChecksRemaining);
      navigate(`/result/${publicResult.id}`);
    } catch {
      setError('Something went wrong during analysis. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-4">
          <ShieldCheck className="w-6 h-6 text-gray-600" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Cap or not? Let's find out</h1>
        <p className="mt-2 text-gray-600 max-w-lg mx-auto">
          Give us whatever you've got. You don't need to fill every field.
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 sm:p-8">
        <OpportunityForm onSubmit={handleSubmit} isAnalyzing={isAnalyzing} />
      </div>
    </div>
  );
}