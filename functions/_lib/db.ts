import { Client } from 'pg';

// Hyperdrive is a global ambient type provided by @cloudflare/workers-types
// (see tsconfig.functions.json's "types") — no import needed for it.

// This replaces the Netlify version's module-level singleton Pool. On
// Cloudflare, Hyperdrive itself IS the connection pool sitting in front
// of Postgres — Cloudflare's own guidance is to create a fresh, cheap
// Client per request rather than maintain your own pool on top of
// theirs: https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/
//
// Usage in a function handler:
//   const client = openDbClient(context.env.HYPERDRIVE);
//   await client.connect();
//   try {
//     ... await store.ensureUser(client, userId) etc ...
//   } finally {
//     // waitUntil lets the connection close in the background instead
//     // of making the caller wait for it before the response is sent.
//     context.waitUntil(client.end());
//   }
export function openDbClient(hyperdrive: Hyperdrive): Client {
  return new Client({ connectionString: hyperdrive.connectionString });
}