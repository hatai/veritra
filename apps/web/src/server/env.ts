// Cloudflare Worker bindings/vars are exposed by the Nitro cloudflare_module
// runtime as `globalThis.__env__` on every request (see Nitro's
// presets/cloudflare/runtime/_module-handler). This is the seam through which
// SSR server code and the mounted Hono app read LIBSQL_URL / AUTH_SECRET / etc.
//
// WARNING: `globalThis.__env__` is an UNDOCUMENTED Nitro `cloudflare_module`
// preset internal. It is set per-request by Nitro's module handler at
// `presets/cloudflare/runtime/_module-handler` and is NOT part of any public
// API contract. This coupling MUST be re-verified on every nitro upgrade —
// check the preset source to confirm the global is still populated before
// deploying.
export type WorkerEnv = {
  LIBSQL_URL: string;
  LIBSQL_AUTH_TOKEN?: string;
  AUTH_SECRET: string;
  BASE_URL: string;
};

export function getWorkerEnv(): WorkerEnv {
  const env = (globalThis as { __env__?: Partial<WorkerEnv> }).__env__;
  if (!env?.LIBSQL_URL) throw new Error("LIBSQL_URL is required (worker env not bound)");
  return env as WorkerEnv;
}
