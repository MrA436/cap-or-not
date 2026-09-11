import type { VercelRequest, VercelResponse } from '@vercel/node';
import { analyzeOpportunity, toPublicResult } from '../src/services/analyzer.js';
import type { OpportunityInput } from '../src/types/analysis.js';

// This is the ONLY place the full analysis is computed for a fresh check.
// The full result never leaves this function — only toPublicResult()'s
// output is sent back. The full result is recomputed again, from scratch,
// inside /api/unlock only after a real payment signature is verified.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const input = req.body as Partial<OpportunityInput>;

    if (!input || typeof input !== 'object') {
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }

    // Basic shape safety — every field is treated as untrusted text, never
    // as instructions (relevant if AI analysis is added later; the current
    // rule-based analyzer just pattern-matches strings, so there's no
    // prompt-injection surface today, but this keeps the input normalized).
    const safeInput: OpportunityInput = {
      company: String(input.company ?? '').slice(0, 500),
      recruiterName: String(input.recruiterName ?? '').slice(0, 200),
      recruiterEmail: String(input.recruiterEmail ?? '').slice(0, 320),
      companyWebsite: String(input.companyWebsite ?? '').slice(0, 500),
      jobTitle: String(input.jobTitle ?? '').slice(0, 300),
      jobPostingUrl: String(input.jobPostingUrl ?? '').slice(0, 1000),
      description: String(input.description ?? '').slice(0, 8000),
      recruiterMessage: String(input.recruiterMessage ?? '').slice(0, 8000),
      offerLetter: String(input.offerLetter ?? '').slice(0, 8000),
      agreeToTerms: Boolean(input.agreeToTerms),
    };

    const hasContent = [
      safeInput.company, safeInput.recruiterName, safeInput.recruiterEmail,
      safeInput.companyWebsite, safeInput.jobTitle, safeInput.jobPostingUrl,
      safeInput.description, safeInput.recruiterMessage, safeInput.offerLetter,
    ].some((v) => v.trim().length > 0);

    if (!hasContent) {
      res.status(400).json({ error: 'At least one field is required' });
      return;
    }

    const fullResult = await analyzeOpportunity(safeInput);
    const publicResult = toPublicResult(fullResult);

    res.status(200).json({ publicResult });
  } catch (err) {
    console.error('analyze error', err);
    res.status(500).json({ error: 'Analysis failed' });
  }
}