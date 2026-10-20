/**
 * THE ONLY WAY TO CREATE A FINDING.
 *
 * analyzer.ts never builds `{ id, category, severity, ... }` literals; it calls
 * `fx.make()` / `fx.add()`. That gives the engine exactly one place where the
 * factual-integrity boundary is enforced:
 *
 *   1. A finding must cite at least one fact, and every cited fact must be a
 *      `Verified<Fact>` registered in THIS request's CanonicalFacts (by id and
 *      by identity) — not a hand-built object, not a fact from another run.
 *   2. The finding's dynamic text (title / finding / evidence) may not name a
 *      brand or an amount that none of its cited facts contains. This is the
 *      mechanical version of "the report can't say Google unless Google is in
 *      a verified fact".
 *   3. A finding that violates 1 or 2 is DROPPED (fail closed), recorded in
 *      `violations`, and reported via `onViolation`. It is never shown.
 *
 * The finding counter lives here, per request. It used to be module-level
 * state that analyzeOpportunity reset on entry; concurrent requests awaiting
 * RDAP/website checks could reset each other's counter and produce duplicate
 * ids inside one result (the contradiction validator removes findings by id).
 */

import type { Finding, Severity } from '../types/analysis.js';
import { BRAND_NAMES, type CanonicalFacts, type Fact, type Verified } from './facts.js';

export interface FindingSpec {
  category: string;
  severity: Severity;
  tag?: string;
  title: string;
  finding: string;
  evidence: string;
  explanation: string;
  action: string;
  /** Facts this finding is about. Required, non-empty. */
  cites: Verified<Fact>[];
}

export interface IntegrityViolation {
  title: string;
  reason: string;
}

const AMOUNT_IN_TEXT = /(?:₹|\$|€|£|Rs\.?|INR)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:INR|rupees?)\b/gi;

function brandRe(brand: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9])${brand.replace(/ /g, '\\s+')}(?![A-Za-z0-9])`, 'i');
}

/** Everything a fact "says", flattened for substring support checks. */
function factText(f: Fact): string {
  const parts: string[] = [f.span.quote];
  if ('value' in f) parts.push(String(f.value));
  if (f.kind === 'payment') parts.push(...f.amounts, ...f.cues, f.purpose ?? '');
  if (f.kind === 'signal') parts.push(f.phrase);
  return parts.join(' \n ').toLowerCase().replace(/\s+/g, ' ');
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/[,]/g, '');

export class FindingFactory {
  private counter = 0;
  readonly violations: IntegrityViolation[] = [];

  constructor(
    private readonly facts: CanonicalFacts,
    private readonly onViolation?: (v: IntegrityViolation) => void,
  ) {}

  nextId(): string {
    return `finding-${++this.counter}`;
  }

  private reject(title: string, reason: string): null {
    const v = { title, reason };
    this.violations.push(v);
    this.onViolation?.(v);
    console.error(`[findingFactory] dropped "${title}": ${reason}`);
    return null;
  }

  /** Returns a reason if `dynamicText` mentions something the cited facts don't support. */
  private unsupported(dynamicText: string, cites: Verified<Fact>[]): string | null {
    const support = cites.map(factText).join(' \n ');
    const supportSquashed = squash(support);

    for (const brand of BRAND_NAMES) {
      if (brandRe(brand).test(dynamicText) && !brandRe(brand).test(support)) {
        return `names brand "${brand}" which no cited fact contains`;
      }
    }
    const amounts = dynamicText.match(AMOUNT_IN_TEXT) ?? [];
    for (const a of amounts) {
      if (!supportSquashed.includes(squash(a))) return `states amount "${a.trim()}" which no cited fact contains`;
    }
    return null;
  }

  private checkCites(title: string, cites: Verified<Fact>[]): string | null {
    if (!cites || cites.length === 0) return 'cites no facts';
    for (const c of cites) {
      if (this.facts.byId.get(c.id) !== c) return `cites fact ${c.id} that is not a verified fact of this request`;
    }
    return null;
  }

  make(spec: FindingSpec): Finding | null {
    const bad = this.checkCites(spec.title, spec.cites)
      ?? this.unsupported(`${spec.title}\n${spec.finding}\n${spec.evidence}`, spec.cites);
    if (bad) return this.reject(spec.title, bad);

    const { cites, ...rest } = spec;
    return { id: this.nextId(), ...rest, factIds: cites.map((c) => c.id) };
  }

  /** Builds a finding and pushes it onto `list`; returns whether it was accepted. */
  add(list: Finding[], spec: FindingSpec): boolean {
    const f = this.make(spec);
    if (f) list.push(f);
    return f !== null;
  }

  /**
   * Gap text ("X could not be verified") interpolates entities too, so it goes
   * through the same support check.
   */
  gap(list: string[], text: string, cites: Verified<Fact>[] = []): void {
    if (cites.length > 0) {
      const bad = this.checkCites(text, cites) ?? this.unsupported(text, cites);
      if (bad) { this.reject(text, bad); return; }
    } else {
      const bad = this.unsupported(text, []);
      if (bad) { this.reject(text, bad); return; }
    }
    list.push(text);
  }
}