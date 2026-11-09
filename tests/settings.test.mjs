import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { strongPassword } from "../src/server/password.ts";
import { encryptSetting, decryptSetting } from "../src/features/settings/encryption.ts";
import { providerBaseURL } from "../src/features/settings/provider.ts";
import { mergeWorkerBindings, applyWorkerBindings } from "../src/features/settings/cloudflare.ts";

function mockEnvironment(t, name, value) {
  const original = process.env[name];
  process.env[name] = value;
  t.after(() => {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  });
}

test("owner passwords enforce every requirement", () => {
  assert.equal(strongPassword("ValidPassword42!"), true);
  for (const password of ["Short1!", "alllowercase123!", "ALLUPPERCASE123!", "NoNumbersHere!", "NoSpecialChars42", "a".repeat(129)]) {
    assert.equal(strongPassword(password), false);
  }
});

test("saved credentials are encrypted with integrity protection", (t) => {
  mockEnvironment(t, "BETTER_AUTH_SECRET", "settings-test-master-secret-with-at-least-32-characters");
  const value = "sensitive-provider-key";
  const encrypted = encryptSetting(value);
  assert.notEqual(encrypted, value);
  assert.equal(decryptSetting(encrypted), value);
  assert.notEqual(encryptSetting(value), encrypted);
  const bytes = Buffer.from(encrypted.slice(3), "base64");
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => decryptSetting("v1:" + bytes.toString("base64")));
});

test("compatible providers require a public HTTPS endpoint", () => {
  assert.equal(providerBaseURL("https://api.example.com/v1/", "api.example.com"), "https://api.example.com/v1");
  for (const url of ["http://api.example.com", "https://localhost/v1", "https://127.0.0.1/v1", "https://[::1]", "https://internal.local/v1", "https://user:password@api.example.com/v1", "https://api.example.com/v1?key=secret"]) {
    assert.throws(() => providerBaseURL(url));
  }
});

test("Worker configuration updates inherit unrelated resource and secret bindings", () => {
  assert.deepEqual(mergeWorkerBindings([
    { name: "DB", type: "d1" }, { name: "BETTER_AUTH_SECRET", type: "secret_text" },
    { name: "POSTQ_AI_KEY_" + "a".repeat(36), type: "secret_text" },
    { name: "GOOGLE_CLIENT_ID", type: "plain_text", text: "old" },
  ], { GOOGLE_CLIENT_ID: "new", GOOGLE_CLIENT_SECRET: "private" }, new Set(["GOOGLE_CLIENT_SECRET"])), [
    { name: "DB", type: "inherit" }, { name: "BETTER_AUTH_SECRET", type: "inherit" },
    { name: "GOOGLE_CLIENT_ID", type: "plain_text", text: "new" },
    { name: "GOOGLE_CLIENT_SECRET", type: "secret_text", text: "private" },
  ]);
});

test("Worker sync writes a single configuration patch with inherited bindings", async (t) => {
  mockEnvironment(t, "POSTQ_CLOUDFLARE_API_TOKEN", "test-token");
  mockEnvironment(t, "POSTQ_CLOUDFLARE_ACCOUNT_ID", "a".repeat(32));
  mockEnvironment(t, "POSTQ_CLOUDFLARE_WORKER", "postq-test");
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push(options.method ?? "GET");
    assert.match(url, /postq-test\/settings$/);
    if (!options.method) return Response.json({ success: true, result: { bindings: [{ name: "MEDIA", type: "r2_bucket" }] } });
    assert.equal(options.method, "PATCH");
    const body = JSON.parse(await options.body.get("settings").text());
    assert.deepEqual(body.bindings, [{ name: "MEDIA", type: "inherit" }, { name: "COMPOSIO_API_KEY", type: "secret_text", text: "new-key" }]);
    return Response.json({ success: true });
  });
  await applyWorkerBindings({ COMPOSIO_API_KEY: "new-key" }, new Set(["COMPOSIO_API_KEY"]));
  assert.deepEqual(calls, ["GET", "PATCH"]);
});

test("first account atomically claims ownership and further accounts are rejected", () => {
  const db = new DatabaseSync(":memory:");
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE "user" (id TEXT PRIMARY KEY);');
  db.exec(readFileSync(new URL("../migrations/0015_settings_and_owner.sql", import.meta.url), "utf8"));
  db.prepare('INSERT INTO "user" VALUES (?)').run("first");
  assert.throws(() => db.prepare('INSERT INTO "user" VALUES (?)').run("second"), /registration is closed/);
  assert.equal(db.prepare("SELECT user_id FROM workspace_owner").get().user_id, "first");
  assert.equal(db.prepare('SELECT count(*) AS count FROM "user"').get().count, 1);
  db.close();
});

test("individual models migrate legacy selections and cascade with their provider", () => {
  const db = new DatabaseSync(":memory:");
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE "user" (id TEXT PRIMARY KEY);');
  db.exec(readFileSync(new URL("../migrations/0015_settings_and_owner.sql", import.meta.url), "utf8"));
  db.prepare("INSERT INTO ai_providers(id,name,kind,secret,models,is_default,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run("provider", "Existing account", "openai", "encrypted", '["first","second"]', 1, 100);
  db.exec(readFileSync(new URL("../migrations/0016_individual_ai_models.sql", import.meta.url), "utf8"));
  assert.deepEqual(db.prepare("SELECT model_id FROM ai_models ORDER BY created_at").all().map((row) => row.model_id), ["first", "second"]);
  assert.equal(db.prepare("SELECT model_id FROM ai_models WHERE is_default=1").get().model_id, "first");
  assert.throws(() => db.prepare("UPDATE ai_models SET is_default=1 WHERE model_id='second'").run(), /UNIQUE/);
  assert.throws(() => db.prepare("INSERT INTO ai_models(id,provider_id,model_id,label,created_at) VALUES ('duplicate','provider','first','First',101)").run(), /UNIQUE/);
  db.prepare("DELETE FROM ai_providers WHERE id='provider'").run();
  assert.equal(db.prepare("SELECT count(*) AS count FROM ai_models").get().count, 0);
  db.close();
});
