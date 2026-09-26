import { Pool } from 'pg';

// This is what replaces the in-memory Maps in rateLimit.ts / the old
// freeChecks.ts for anything that needs to survive across requests,
// cold starts, and different warm function instances: identity
// (users), reports, and payments. See schema.sql for the tables.
//
// Netlify Functions can reuse a warm container across invocations, so a
// module-level singleton pool (rather than opening a new connection per
// request) is kept here. Deliberately small (max 3) — each function
// instance gets its own pool, and with several functions and many
// concurrent cold starts that adds up fast against a typical managed
// Postgres connection cap (Neon/Supabase free tiers are usually capped
// in the low dozens). If you outgrow this, point DATABASE_URL at a
// connection pooler in front of Postgres (Supabase's built-in pgbouncer
// endpoint, or Neon's own pooled connection string) instead of raising
// this number — no code change needed here, just the connection string.
/**
 * Masks the password in a Postgres connection string for safe logging —
 * everything except the password stays visible (host/port/user/database
 * are not secret and are exactly what's useful for diagnosing a
 * misconfigured DATABASE_URL, e.g. wrong host, wrong user, or a value
 * that didn't save the way you expect in Netlify's env var UI).
 */
function redactConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return '(could not parse as a URL — check for stray quotes/whitespace, or that it starts with postgres:// or postgresql://)';
  }
}

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is not configured. Set it to a Postgres connection string (see netlify/functions/_lib/schema.sql for the tables it needs).',
      );
    }
    // Logged once per cold start — deliberately redacted (see above) so
    // this is safe to leave in and actually useful when a connection
    // fails: it shows exactly what this running function is using,
    // which is the only way to rule out "the value saved in Netlify
    // isn't what I think it is" or "this deploy doesn't have the env var
    // I just set" as the cause of an auth failure.
    console.log('[db] connecting with', redactConnectionString(connectionString));
    // Deliberately not overriding SSL here — a managed Postgres
    // connection string (Neon, Supabase, Railway, etc.) already carries
    // whatever sslmode it needs as a query param, and `pg` respects
    // that. If you're pointed at a provider whose connection string
    // omits it and you hit a self-signed-certificate error, add
    // `?sslmode=require` to the connection string rather than disabling
    // TLS verification here.
    pool = new Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 10_000,
    });
  }
  return pool;
}