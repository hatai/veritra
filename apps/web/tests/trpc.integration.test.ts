import { describe, it, expect } from "vitest";
import { appRouter } from "../src/server/router";
import { createDb } from "@veritra/db";

function caller() {
  const db = createDb(process.env.LIBSQL_URL ?? "http://127.0.0.1:8080");
  return appRouter.createCaller({ db, session: null });
}

describe("appRouter.ping", () => {
  it("echoes the name", async () => {
    const res = await caller().ping({ name: "Veritra" });
    expect(res.message).toBe("hello Veritra");
  });

  it("rejects empty name (valibot)", async () => {
    await expect(caller().ping({ name: "" })).rejects.toThrow();
  });
});
