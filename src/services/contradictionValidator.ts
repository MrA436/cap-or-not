/**
 * Contradiction validator — a dedicated pass that runs on the fully
 * assembled set of findings/positives across every category, AFTER all
 * category-analysis functions have run and BEFORE the score, UI badges,
 * or anything else derives from the result.
 *
 * Why this is a separate module rather than fixing each contradiction
 * inline in analyzer.ts's category functions: a contradiction can span
 * categories (nothing stops a future category from independently
 * claiming something another category already contradicted), and having
 * one auditable list of known-contradictory pairs is easier to extend
 * and review than hunting through nine separate analyze* functions for
 * implicit mutual-exclusion logic. Several of the pairs below ARE
 * already prevented structurally within their own category function
 * (e.g. payment.demand / payment.compensation_no_demand can't both fire
 * from the same analyzePayment() call today) — they're still listed
 * here as a second, independent safety net: if that in-function
 * exclusivity is ever accidentally broken by a future edit, this still
 * catches it, rather than silently shipping a contradictory report.
 *
 * Resolution policy: when a negative-tagged finding and a positive-
 * tagged finding in the same rule both fire, the POSITIVE is dropped
 * and the negative finding is kept. Rationale: in every rule below, the
 * negative finding is triggered by more specific, more direct language
 * (e.g. the literal phrase "no interview required") than the positive
 * (triggered by loose keyword co-occurrence, e.g. "interview" + "round"
 * appearing anywhere in the same text). When one signal is specific and
 * the other is inferred, keeping the specific one and discarding the
 * inferred one is the safer default for a risk-screening tool — a false
 * reassurance is worse than a missing one.
 */

import type { Finding } from '../types/analysis.js';

interface ContradictionRule {
  /** Tag of the finding (non-positive severity) to keep when both fire. */
  negativeTag: string;
  /** Tag of the positive finding to drop when both fire. */
  positiveTag: string;
  /** Human-readable reason, surfaced only in resolution notes (not shown to the end user). */
  reason: string;
}

export const CONTRADICTION_RULES: ContradictionRule[] = [
  {
    negativeTag: 'process.no_interview',
    positiveTag: 'process.formal_interview_described',
    reason: 'Text explicitly states no interview occurs; a separate loose keyword match ("interview" + "round"/"technical") also fired a formal-interview positive for the same posting. The explicit statement is kept.',
  },
  {
    negativeTag: 'payment.demand',
    positiveTag: 'payment.compensation_no_demand',
    reason: 'A payment demand was detected; the compensation-only positive should never fire in the same analysis (already prevented at the source via early-exit branching in analyzePayment — this rule is a defense-in-depth backstop).',
  },
  {
    negativeTag: 'company.website_unreachable',
    positiveTag: 'company.website_reachable',
    reason: 'The website reachability check returns exactly one of unreachable/reachable/unable_to_verify per analysis, so these can\'t both fire today (defense-in-depth backstop, same reasoning as above).',
  },
];

export interface ContradictionResolution {
  /** findings/positives with every resolved rule's dropped item removed. */
  findings: Finding[];
  positives: Finding[];
  /** One entry per rule that actually fired, for logging/testing — never shown to the end user. */
  notes: string[];
}

/**
 * Scans the fully assembled findings/positives lists for any known
 * contradictory pair and resolves each one found. Safe to call with
 * nothing to resolve — returns the inputs unchanged (new arrays, same
 * contents) in that case.
 */
export function resolveContradictions(findings: Finding[], positives: Finding[]): ContradictionResolution {
  const notes: string[] = [];
  const droppedPositiveIds = new Set<string>();

  for (const rule of CONTRADICTION_RULES) {
    const hasNegative = findings.some((f) => f.tag === rule.negativeTag);
    const positiveMatch = positives.find((f) => f.tag === rule.positiveTag);
    if (hasNegative && positiveMatch) {
      droppedPositiveIds.add(positiveMatch.id);
      notes.push(`Dropped "${positiveMatch.title}" (${rule.positiveTag}): ${rule.reason}`);
    }
  }

  if (droppedPositiveIds.size === 0) {
    return { findings: [...findings], positives: [...positives], notes };
  }

  return {
    findings: [...findings],
    positives: positives.filter((f) => !droppedPositiveIds.has(f.id)),
    notes,
  };
}