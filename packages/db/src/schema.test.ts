import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "./client";
import { notes } from "./schema";

const db = createDb(process.env.LIBSQL_URL ?? "http://127.0.0.1:8080");

describe("notes table", () => {
  beforeAll(async () => {
    await db.run(
      "CREATE TABLE IF NOT EXISTS notes (id text primary key, body text not null, created_at integer not null)",
    );
    await db.run("DELETE FROM notes");
  });

  it("inserts and reads back a note", async () => {
    const id = "spike-1";
    await db.insert(notes).values({ id, body: "hello", createdAt: new Date() });
    const rows = await db.select().from(notes).where(eq(notes.id, id));
    expect(rows[0]?.body).toBe("hello");
  });
});
