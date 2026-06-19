// Cloudflare Worker bindings/vars are exposed by the Nitro cloudflare_module
// runtime as `globalThis.__env__` on every request (see Nitro's
// presets/cloudflare/runtime/_module-handler). This is the seam through which
// SSR server code and the mounted Hono app read LIBSQL_URL / AUTH_SECRET / etc.
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
