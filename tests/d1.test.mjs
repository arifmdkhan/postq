import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { betterAuth } from "better-auth";
import { getPlatformProxy } from "wrangler";

test("D1 supports auth sessions and preserves existing drafts during the planning migration", async () => {
  const proxy = await getPlatformProxy({ persist: false });
  try {
    const db = proxy.env.DB;
    const sql = await readFile(new URL("../migrations/0001_studio.sql", import.meta.url), "utf8");
    await db.batch(sql.split(";").map((part) => part.trim()).filter(Boolean).map((part) => db.prepare(part)));

    const origin = "http://localhost:3000";
    const auth = betterAuth({
      baseURL: origin,
      secret: randomBytes(32).toString("hex"),
      database: db,
      emailAndPassword: { enabled: true },
      rateLimit: { enabled: true, storage: "database" },
    });
    const response = await auth.handler(new Request(origin + "/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        name: "Local test",
        email: "local@example.com",
        password: randomBytes(32).toString("hex"),
      }),
    }));
    assert.equal(response.status, 200, await response.clone().text());
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    assert.equal(session?.user.email, "local@example.com");

    await db.prepare("INSERT INTO drafts (id, user_id, title, body, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind("legacy", session.user.id, "Existing draft", "", "2026-11-03").run();
    const planning = await readFile(new URL("../migrations/0002_draft_planning.sql", import.meta.url), "utf8");
    await db.batch(planning.split(";").map((part) => part.trim()).filter(Boolean).map((part) => db.prepare(part)));
    assert.deepEqual(await db.prepare("SELECT title, planned_on FROM drafts WHERE id = 'legacy'").first(),
      { title: "Existing draft", planned_on: null });
    await db.prepare("UPDATE drafts SET planned_on = ? WHERE id = ?").bind("2026-11-03", "legacy").run();
    assert.equal(await db.prepare("SELECT count(*) AS total FROM drafts WHERE user_id = ? AND planned_on = ?")
      .bind(session.user.id, "2026-11-03").first("total"), 1);
    assert.equal(await db.prepare("SELECT count(*) AS total FROM drafts WHERE user_id = ? AND planned_on = ?")
      .bind("another-user", "2026-11-03").first("total"), 0);
  } finally {
    await proxy.dispose();
  }
});
