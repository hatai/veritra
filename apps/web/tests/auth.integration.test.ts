import { describe, it, expect, beforeAll } from "vitest";
import app from "../src/worker";
import { createClient } from "@libsql/client/web";

const _base = "http://localhost";

describe("auth + protected procedure", () => {
  beforeAll(async () => {
    // Clean up test user so the test is idempotent across runs
    const client = createClient({ url: process.env.LIBSQL_URL ?? "http://127.0.0.1:8080" });
    await client.execute("DELETE FROM user WHERE email = 'a@b.co'");
  });

  it("rejects me when anonymous", async () => {
    const res = await app.request("/api/trpc/me", {}, testEnv());
    expect(res.status).toBe(401);
  });

  it("signs up, then me returns the user id", async () => {
    const signup = await app.request(
      "/api/auth/sign-up/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.co", password: "pw-12345678", name: "A" }),
      },
      testEnv(),
    );
    expect(signup.ok).toBe(true);
    const cookie = signup.headers.get("set-cookie")!;
    const me = await app.request("/api/trpc/me", { headers: { cookie } }, testEnv());
    expect(me.ok).toBe(true);
  });
});

function testEnv() {
  return {
    LIBSQL_URL: process.env.LIBSQL_URL ?? "http://127.0.0.1:8080",
    AUTH_SECRET: "test-secret-please-change",
    BASE_URL: "http://localhost",
  };
}
