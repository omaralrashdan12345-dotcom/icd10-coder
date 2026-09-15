/**
 * Next.js boot-time instrumentation (runs once per serverless invocation at
 * cold start, before route handlers import the Z.ai SDK). Serverless runtimes
 * can't ship a `.z-ai-config` file, so we materialize one from env vars.
 * Safe no-op locally (where the repo `.z-ai-config` already exists) and when
 * no ZAI_* env vars are configured.
 */
/**
 * Next.js boot-time instrumentation (runs once per serverless invocation at
 * cold start, before route handlers import the Z.ai SDK). Serverless runtimes
 * can't ship a `.z-ai-config` file, so we materialize one from env vars.
 * Safe no-op locally (where the repo `.z-ai-config` already exists) and when
 * no ZAI_* env vars are configured.
 *
 * The installer lives in `@/lib/zai` which uses Node builtins (fs/os/path),
 * so it is loaded ONLY for the Node.js instrumentation profile — the Edge
 * runtime never pulls it in (Next folds `NEXT_RUNTIME` per profile).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- require() keeps the Node-only module out of the Edge bundle
  require('@/lib/zai').installZaiConfigFromEnv();
}