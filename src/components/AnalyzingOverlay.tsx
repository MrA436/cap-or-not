import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

// The stages are paced by elapsed time, not by real progress events (the API
// answers in one response) — they only tell the person the check is alive.
const STEPS = [
  { label: 'Reading what you pasted', at: 0 },
  { label: 'Looking for fee, ID and pressure red flags', at: 2 },
  { label: 'Checking the website and domain', at: 4 },
  { label: 'Putting your report together', at: 7 },
];

export default function AnalyzingOverlay() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const active = STEPS.reduce((acc, step, i) => (elapsed >= step.at ? i : acc), 0);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white border border-gray-200 shadow-xl p-6">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
          <Loader2 className="h-7 w-7 animate-spin text-gray-800" />
        </div>
        <h2 className="text-center text-lg font-bold text-gray-900">Checking for cap…</h2>
        <p className="mt-1 text-center text-sm text-gray-600">This usually takes a few seconds.</p>

        <ul className="mt-5 space-y-2.5">
          {STEPS.map((step, i) => {
            const done = i < active;
            const current = i === active;
            return (
              <li
                key={step.label}
                className={`flex items-center gap-2.5 text-sm ${current ? 'text-gray-900 font-medium' : done ? 'text-gray-600' : 'text-gray-400'}`}
              >
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
                  {done ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : current ? (
                    <Loader2 className="h-4 w-4 animate-spin text-gray-700" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
                  )}
                </span>
                {step.label}
              </li>
            );
          })}
        </ul>

        {elapsed >= 12 && (
          <p className="mt-5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
            {elapsed >= 25
              ? 'Still going. If nothing happens soon we will let you know, and you can try again without losing your text.'
              : 'Taking a little longer than usual. Still working on it.'}
          </p>
        )}
      </div>
    </div>
  );
}