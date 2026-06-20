import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Db } from "@veritra/db";

export function createAuth(db: Db, opts: { secret: string; baseURL: string }) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite" }),
    emailAndPassword: { enabled: true },
    secret: opts.secret,
    baseURL: opts.baseURL,
    trustedOrigins: [opts.baseURL],
    advanced: {
      useSecureCookies: opts.baseURL.startsWith("https"),
    },
  });
}
export type Auth = ReturnType<typeof createAuth>;
