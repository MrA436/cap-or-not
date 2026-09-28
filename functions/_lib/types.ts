// Cloudflare binding types — these come from wrangler.toml (Hyperdrive)
// and the Pages dashboard's Environment variables (the plain strings).
// Passed to every function handler as context.env; nothing here is
// process.env — that's a Node-ism this runtime doesn't use.
export interface Env {
  HYPERDRIVE: Hyperdrive;
  RAZORPAY_KEY_ID: string;
  RAZORPAY_KEY_SECRET: string;
  TEST_UNLOCK_CODE?: string;
}