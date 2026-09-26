import { useState } from 'react';
import { Lock, ShieldCheck, Loader2 } from 'lucide-react';
import type { AnalysisResult } from '@/types/analysis';

interface UnlockGateProps {
  reportId: string;
  onUnlocked: (fullResult: AnalysisResult) => void;
}

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open: () => void };
  }
}

let razorpayScriptPromise: Promise<void> | null = null;
function loadRazorpayScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (razorpayScriptPromise) return razorpayScriptPromise;
  razorpayScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load payment provider'));
    document.body.appendChild(script);
  });
  return razorpayScriptPromise;
}

/**
 * Real payment flow, not a blur-and-hope paywall:
 *  1. Ask our own server for a Razorpay order (amount is fixed server-side).
 *  2. Open Razorpay Checkout with that order.
 *  3. On success, Checkout hands back a payment id + signature.
 *  4. Send those to our server, which verifies the signature against the
 *     key secret (never exposed to the browser) and only THEN computes and
 *     returns the full report.
 * The full report never exists in the browser before step 4 succeeds.
 */
export default function UnlockGate({ reportId, onUnlocked }: UnlockGateProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [code, setCode] = useState('');
  const [codeStatus, setCodeStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [codeError, setCodeError] = useState('');

  const handlePay = async () => {
    setStatus('loading');
    setErrorMsg('');
    try {
      await loadRazorpayScript();

      const orderRes = await fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId }),
      });
      if (!orderRes.ok) throw new Error('Could not start payment');
      const { orderId, amount, currency, keyId } = await orderRes.json();

      const razorpay = new window.Razorpay({
        key: keyId,
        order_id: orderId,
        amount,
        currency,
        name: 'Cap or Not',
        description: 'Full risk report',
        theme: { color: '#111827' },
        handler: async (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          try {
            const unlockRes = await fetch('/api/unlock', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...response, reportId }),
            });
            if (!unlockRes.ok) throw new Error('Payment could not be verified');
            const { fullResult } = await unlockRes.json();
            onUnlocked(fullResult);
            setStatus('idle');
          } catch {
            setStatus('error');
            setErrorMsg("Payment went through but we couldn't verify it. Contact support with your payment ID.");
          }
        },
        modal: {
          ondismiss: () => setStatus('idle'),
        },
      });
      razorpay.open();
    } catch {
      setStatus('error');
      setErrorMsg('Could not start payment. Please try again.');
    }
  };

  const handleCodeSubmit = async () => {
    if (!code.trim()) return;
    setCodeStatus('loading');
    setCodeError('');
    try {
      const res = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testCode: code.trim(), reportId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Invalid code');
      }
      const { fullResult } = await res.json();
      onUnlocked(fullResult);
      setCodeStatus('idle');
    } catch (err) {
      setCodeStatus('error');
      setCodeError(err instanceof Error ? err.message : 'Invalid code');
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-lg p-6 text-center">
      <div className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-gray-900 mb-3">
        <Lock className="w-5 h-5 text-white" />
      </div>
      <h3 className="font-bold text-gray-900 mb-1">See the full receipts</h3>
      <p className="text-sm text-gray-500 mb-4">
        Unlock every finding, the full category breakdown, and the recommended action — no cap.
      </p>
      <button
        onClick={handlePay}
        disabled={status === 'loading'}
        className="w-full inline-flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-400 text-white font-semibold py-2.5 rounded-lg transition-colors"
      >
        {status === 'loading' ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Opening secure checkout...
          </>
        ) : (
          <>
            <ShieldCheck className="w-4 h-4" />
            Unlock full report
          </>
        )}
      </button>
      {errorMsg && <p className="mt-3 text-xs text-red-600">{errorMsg}</p>}
      <p className="mt-3 text-xs text-gray-400">Secure payment via Razorpay</p>

      {!showCodeInput ? (
        <button
          onClick={() => setShowCodeInput(true)}
          className="mt-2 text-xs text-gray-300 hover:text-gray-500 underline"
        >
          Have an access code?
        </button>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <input
            type="text"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setCodeStatus('idle');
              setCodeError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleCodeSubmit()}
            placeholder="Enter code"
            className="flex-1 text-sm border border-gray-300 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          <button
            onClick={handleCodeSubmit}
            disabled={codeStatus === 'loading'}
            className="text-sm font-medium bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 text-gray-800 px-3 py-1.5 rounded-md transition-colors flex-shrink-0"
          >
            {codeStatus === 'loading' ? '...' : 'Apply'}
          </button>
        </div>
      )}
      {codeError && <p className="mt-2 text-xs text-red-600">{codeError}</p>}
    </div>
  );
}