// Cloudflare binding types — these come from wrangler.toml (Hyperdrive)
// and the Pages dashboard's Environment variables (the plain strings).
// Passed to every function handler as context.env; nothing here is
// process.env — that's a Node-ism this runtime doesn't use.
export interface Env {
  HYPERDRIVE: Hyperdrive;
  RAZORPAY_KEY_ID: string;
  RAZORPAY_KEY_SECRET: string;
  TEST_UNLOCK_CODE?: string;
  // Optional — the LLM extraction layer (src/services/llmExtract.ts) is a
  // pure enhancement. When unset, analysis falls back to the deterministic
  // extractors and nothing else changes. Provider-agnostic name: whichever
  // LLM API llmExtract.ts is wired up to at the time (currently written
  // for Anthropic's request/response shape — see the note at the top of
  // that file if switching providers).
  LLM_API_KEY?: string;
}