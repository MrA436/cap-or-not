-- Cap or Not — persistent identity, reports, and payments.
--
-- Run this once, by hand, against your Postgres database before deploying
-- this build (e.g. `psql "$DATABASE_URL" -f netlify/functions/_lib/schema.sql`,
-- or paste it into your provider's SQL console — Neon/Supabase both have
-- one). Safe to re-run: every statement is idempotent.
--
-- users.id doubles as the value stored in the anonymous co_uid cookie
-- (see _lib/identity.ts) — it's how a returning visitor's browser is
-- recognized as "the same user" without an account or password.

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT,
  email_verified_at TIMESTAMPTZ,
  -- How many of the 5 lifetime free screenings this user has used.
  -- Incremented atomically in _lib/store.ts's consumeFreeCheck — this is
  -- the server-side enforcement; nothing about it is ever trusted from
  -- the browser.
  free_checks_used INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
  -- Matches AnalysisResult.id / PublicAnalysisResult.id — a random id
  -- (crypto.randomUUID(), see analyzer.ts), not a guessable one.
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  input JSONB NOT NULL,
  -- The complete analysis, computed once at screening time. Stored here
  -- (not recomputed at unlock time) so the report a user eventually pays
  -- to unlock is guaranteed to be exactly the one they previewed, and so
  -- unlock.ts doesn't need to trust a client-resent copy of the input.
  -- It sits here server-side regardless of payment status — it is never
  -- sent to the browser until reports.paid is true (see report.ts /
  -- unlock.ts), same trust boundary the in-memory version already had.
  full_result JSONB NOT NULL,
  preview_tier TEXT NOT NULL,
  paid BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reports_user_id ON reports (user_id);

CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  report_id TEXT NOT NULL REFERENCES reports(id),
  razorpay_order_id TEXT NOT NULL UNIQUE,
  razorpay_payment_id TEXT,
  amount_paise INTEGER NOT NULL,
  -- created -> paid, or created -> failed. 'created' rows for orders the
  -- shopper opened Checkout for but never completed are expected and
  -- harmless — they just never transition.
  status TEXT NOT NULL DEFAULT 'created',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_payments_report_id ON payments (report_id);