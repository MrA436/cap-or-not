import { getPool } from './db.js';
import type { OpportunityInput, AnalysisResult, PreviewTier } from '../../../src/types/analysis.js';

const FREE_CHECK_LIMIT = 5;

/** Creates the user row if it doesn't already exist. Cheap to call every request. */
export async function ensureUser(userId: string): Promise<void> {
  await getPool().query(`INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [userId]);
}

export interface FreeCheckResult {
  withinFreeTrial: boolean;
  remaining: number;
}

/**
 * Atomically consumes one of the 5 lifetime free-screening credits for
 * this user, if any remain. This is the persistent, per-user-id
 * replacement for the old in-memory, per-IP Map in freeChecks.ts — it
 * survives cold starts and is shared across every warm function
 * instance because it lives in Postgres, and it's keyed by the identity
 * cookie rather than IP, so it can't be reset by switching networks or
 * clearing localStorage (clearing cookies still resets it, same as any
 * anonymous-identity scheme — email recovery is the intended path for a
 * user who wants their purchased reports to survive that).
 */
export async function consumeFreeCheck(userId: string): Promise<FreeCheckResult> {
  const { rows } = await getPool().query<{ free_checks_used: number }>(
    `UPDATE users
       SET free_checks_used = free_checks_used + 1
       WHERE id = $1 AND free_checks_used < $2
       RETURNING free_checks_used`,
    [userId, FREE_CHECK_LIMIT],
  );
  if (rows.length === 0) {
    return { withinFreeTrial: false, remaining: 0 };
  }
  return { withinFreeTrial: true, remaining: FREE_CHECK_LIMIT - rows[0].free_checks_used };
}

/** Current remaining count without consuming a credit — used when re-opening an existing report. */
export async function getFreeChecksRemaining(userId: string): Promise<number> {
  const { rows } = await getPool().query<{ free_checks_used: number }>(
    `SELECT free_checks_used FROM users WHERE id = $1`,
    [userId],
  );
  const used = rows[0]?.free_checks_used ?? 0;
  return Math.max(0, FREE_CHECK_LIMIT - used);
}

export interface StoredReport {
  id: string;
  userId: string;
  input: OpportunityInput;
  fullResult: AnalysisResult;
  previewTier: PreviewTier;
  paid: boolean;
  createdAt: string;
}

export async function saveReport(params: {
  id: string;
  userId: string;
  input: OpportunityInput;
  fullResult: AnalysisResult;
  previewTier: PreviewTier;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO reports (id, user_id, input, full_result, preview_tier, paid)
     VALUES ($1, $2, $3, $4, $5, false)`,
    [params.id, params.userId, JSON.stringify(params.input), JSON.stringify(params.fullResult), params.previewTier],
  );
}

interface ReportRow {
  id: string;
  user_id: string;
  input: OpportunityInput;
  full_result: AnalysisResult;
  preview_tier: PreviewTier;
  paid: boolean;
  created_at: Date;
}

export async function getReport(id: string): Promise<StoredReport | null> {
  const { rows } = await getPool().query<ReportRow>(
    `SELECT id, user_id, input, full_result, preview_tier, paid, created_at FROM reports WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    userId: r.user_id,
    input: r.input,
    fullResult: r.full_result,
    previewTier: r.preview_tier,
    paid: r.paid,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

export async function markReportPaid(id: string): Promise<void> {
  await getPool().query(`UPDATE reports SET paid = true WHERE id = $1`, [id]);
}

export async function createPaymentOrder(params: {
  userId: string;
  reportId: string;
  razorpayOrderId: string;
  amountPaise: number;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO payments (user_id, report_id, razorpay_order_id, amount_paise, status)
     VALUES ($1, $2, $3, $4, 'created')`,
    [params.userId, params.reportId, params.razorpayOrderId, params.amountPaise],
  );
}

export interface PaymentRecord {
  userId: string;
  reportId: string;
  amountPaise: number;
  status: string;
}

interface PaymentRow {
  user_id: string;
  report_id: string;
  amount_paise: number;
  status: string;
}

export async function getPaymentByOrderId(orderId: string): Promise<PaymentRecord | null> {
  const { rows } = await getPool().query<PaymentRow>(
    `SELECT user_id, report_id, amount_paise, status FROM payments WHERE razorpay_order_id = $1`,
    [orderId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return { userId: r.user_id, reportId: r.report_id, amountPaise: r.amount_paise, status: r.status };
}

/** Idempotent on purpose — a retried/duplicated confirmation just re-confirms the same row. */
export async function markPaymentPaid(orderId: string, paymentId: string): Promise<void> {
  await getPool().query(
    `UPDATE payments SET status = 'paid', razorpay_payment_id = $2, verified_at = now() WHERE razorpay_order_id = $1`,
    [orderId, paymentId],
  );
}