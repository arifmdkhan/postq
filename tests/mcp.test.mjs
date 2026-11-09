import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { createMcpHandler } from "@modelcontextprotocol/server";

// Let Node's native type stripper exercise the same relative TS modules as Next.
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith(".") && context.parentURL?.includes("/src/") && !/\.[a-z]+$/.test(specifier)) {
    const url = new URL(specifier + ".ts", context.parentURL);
    if (existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  return next(specifier, context);
} });
const { MCPService, utcDue } = await import("../src/features/mcp/service.ts");
const { hashToken, newToken, authenticateMCP, allowMCPRequest } = await import("../src/features/mcp/access.ts");
const { postqMCPServer } = await import("../src/features/mcp/server.ts");
const owner = "owner";
const channel = "11111111-1111-4111-8111-111111111111";
const draftId = "22222222-2222-4222-8222-222222222222";
const nextId = () => crypto.randomUUID();

async function setup(t, scopes = ["read", "drafts:write", "schedule:request"]) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE "user" (id TEXT PRIMARY KEY); INSERT INTO "user" VALUES ('owner'),('other');
    CREATE TABLE workspace_owner(user_id TEXT PRIMARY KEY); INSERT INTO workspace_owner VALUES ('owner');
    CREATE TABLE drafts(id TEXT PRIMARY KEY,user_id TEXT,title TEXT,body TEXT,updated_at TEXT,planned_on TEXT,tag TEXT,delivery_plan TEXT);
    CREATE TABLE channels(id TEXT PRIMARY KEY,user_id TEXT,platform TEXT,label TEXT,profile_name TEXT,avatar_url TEXT,remote_id TEXT,active INTEGER);
    CREATE TABLE media_assets(id TEXT PRIMARY KEY,user_id TEXT,name TEXT,mime TEXT,bytes INTEGER,folder TEXT,tags TEXT,created_at INTEGER);
    CREATE TABLE publications(id TEXT PRIMARY KEY,user_id TEXT,title TEXT,caption TEXT,due_at INTEGER,status TEXT,channel_id TEXT,media_id TEXT,media_ids TEXT NOT NULL DEFAULT '[]',destination TEXT,remote_post_id TEXT,delivery_options TEXT);
    CREATE TABLE publication_metrics(publication_id TEXT,name TEXT,value INTEGER,captured_at INTEGER);`);
  sqlite.exec(readFileSync(new URL("../migrations/0018_mcp_access.sql", import.meta.url), "utf8"));
  const db = { prepare(sql) { const build = (values = []) => ({
    bind(...args) { return build(args); },
    async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
    async first(name) { const row = sqlite.prepare(sql).get(...values); return name ? row?.[name] ?? null : row ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
  }); return build(); } };
  const token = newToken();
  const access = { id: nextId(), user_id: owner, scopes, expires_at: Date.now() + 86400000 };
  sqlite.prepare("INSERT INTO mcp_tokens(id,user_id,name,token_hash,scopes,created_at,expires_at) VALUES (?,?,?,?,?,?,?)")
    .run(access.id, owner, "Test client", await hashToken(token), JSON.stringify(scopes), Date.now(), access.expires_at);
  sqlite.prepare("INSERT INTO channels VALUES (?,?,?,?,?,?,?,?)").run(channel, owner, "threads", "My channel", "Profile", null, "fake-account", 1);
  sqlite.prepare("INSERT INTO drafts(id,user_id,title,body,updated_at) VALUES (?,?,?,?,?)").run(draftId, owner, "Launch", "New collection", "2026-11-05T00:00:00.000Z");
  t.after(() => sqlite.close());
  return { db, sqlite, token, access, service: new MCPService(db, access, "https://postq.example") };
}

test("MCP tokens are unique, hashed, owner-bound, revocable and expiring", async (t) => {
  const { db, sqlite, token, access } = await setup(t);
  assert.notEqual(token, newToken());
  assert.notEqual(await hashToken(token), token);
  assert.equal((await authenticateMCP(db, "Bearer " + token)).id, access.id);
  assert.equal(await authenticateMCP(db, "Bearer " + newToken()), null);
  sqlite.prepare("UPDATE mcp_tokens SET user_id='other'").run();
  assert.equal(await authenticateMCP(db, "Bearer " + token), null);
  sqlite.prepare("UPDATE mcp_tokens SET user_id='owner',expires_at=0").run();
  assert.equal(await authenticateMCP(db, "Bearer " + token), null);
  sqlite.prepare("UPDATE mcp_tokens SET expires_at=?,revoked_at=?").run(Date.now() + 60000, Date.now());
  assert.equal(await authenticateMCP(db, "Bearer " + token), null);
});

test("MCP rate limits are atomic and scoped to the access token", async (t) => {
  const { db, access, sqlite } = await setup(t);
  for (let index = 0; index < 120; index++) assert.equal(await allowMCPRequest(db, access), true);
  assert.equal(await allowMCPRequest(db, access), false);
  sqlite.prepare("UPDATE mcp_tokens SET rate_window=0").run();
  assert.equal(await allowMCPRequest(db, access), true);
});

test("draft writes are scoped, idempotent, isolated by owner and version-checked", async (t) => {
  const { service, db, access } = await setup(t);
  const input = { requestKey: nextId(), title: "A draft", caption: "Copy" };
  const first = await service.createDraft(input);
  assert.equal((await service.createDraft(input)).draft.id, first.draft.id);
  await assert.rejects(service.createDraft({ ...input, caption: "Changed" }), /request key/);
  const updated = await service.updateDraft({ draftId: draftId, expectedUpdatedAt: "2026-11-05T00:00:00.000Z", title: "Edited", caption: "Revised" });
  assert.equal(updated.body, "Revised");
  await assert.rejects(service.updateDraft({ draftId, expectedUpdatedAt: "old", title: "Overwrite", caption: "Bad" }), /changed/);
  await assert.rejects(new MCPService(db, { ...access, user_id: "other" }, "https://postq.example").getDraft(draftId), /unavailable/);
  await assert.rejects(new MCPService(db, { ...access, scopes: ["read"] }, "https://postq.example").createDraft(input), /does not allow/);
});

test("scheduling requests require future UTC time and remain immutable, pending and unqueued", async (t) => {
  const { service, sqlite, access } = await setup(t);
  const input = { requestKey: nextId(), draftId, expectedUpdatedAt: "2026-11-05T00:00:00.000Z",
    dueAt: new Date(Date.now() + 86400000).toISOString().slice(0, 16) + ":00Z", timezone: "Asia/Kolkata", targets: [{ channelId: channel }] };
  assert.ok(utcDue(input.dueAt));
  assert.equal(utcDue("2026-02-30T10:00:00Z"), null);
  assert.equal(utcDue(input.dueAt.replace("Z", "+05:30")), null);
  const first = await service.prepareSchedule(input);
  const second = await service.prepareSchedule(input);
  assert.equal(first.requestId, second.requestId);
  assert.equal(first.state, "pending");
  assert.equal(sqlite.prepare("SELECT count(*) AS total FROM publications").get().total, 0);
  await assert.rejects(service.prepareSchedule({ ...input, dueAt: new Date(Date.now() - 60000).toISOString() }), /future UTC/);
  await assert.rejects(service.prepareSchedule({ ...input, targets: [{ channelId: channel, caption: "Different" }] }), /different content/);
  const row = sqlite.prepare("SELECT payload FROM mcp_requests").get();
  const payload = JSON.parse(row.payload);
  assert.equal(payload.targets[0].caption, "New collection");
  assert.equal(payload.fields.find(([name]) => name === "offset")[1], "0");
  assert.equal(payload.fields.some(([name]) => name === "approved"), false);
  sqlite.prepare("UPDATE mcp_tokens SET revoked_at=? WHERE id=?").run(Date.now(), access.id);
  await assert.rejects(service.prepareSchedule({ ...input, requestKey: nextId() }), /revoked/);
});

test("queued change requests do not mutate delivery state and reject stale snapshots", async (t) => {
  const { service, sqlite } = await setup(t);
  const id = nextId(); const due = Date.now() + 86400000;
  sqlite.prepare("INSERT INTO publications(id,user_id,title,caption,due_at,status,channel_id) VALUES (?,?,?,?,?,?,?)").run(id, owner, "Queued", "Caption", due, "scheduled", channel);
  const request = await service.prepareChange({ requestKey: nextId(), postId: id, expectedDueAt: due }, "cancel");
  assert.equal((await service.requestStatus(request.requestId)).state, "pending");
  assert.equal(sqlite.prepare("SELECT status FROM publications").get().status, "scheduled");
  await assert.rejects(service.prepareChange({ requestKey: nextId(), postId: id, expectedDueAt: due - 1 }, "cancel"), /changed/);
  sqlite.prepare("UPDATE publications SET status='published'").run();
  await assert.rejects(service.prepareChange({ requestKey: nextId(), postId: id, expectedDueAt: due }, "cancel"), /no longer queued/);
});

test("MCP Streamable HTTP initializes, lists scoped tools, and handles tool calls", async (t) => {
  const { db, access } = await setup(t);
  const service = new MCPService(db, { ...access, scopes: ["read"] }, "https://postq.example");
  const rpc = async (method, params = {}) => {
    const handler = createMcpHandler(() => postqMCPServer(service));
    const response = await handler.fetch(new Request("https://postq.example/mcp", { method: "POST", headers: {
      "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25",
    }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }));
    const text = await response.text();
    await handler.close();
    assert.equal(response.status, 200, text);
    return JSON.parse(text.startsWith("event:") ? text.split("\n").find((line) => line.startsWith("data: ")).slice(6) : text);
  };
  assert.ok((await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test-client", version: "1" } })).result.serverInfo);
  const tools = (await rpc("tools/list")).result.tools.map(({ name }) => name);
  assert.ok(tools.includes("list_channels"));
  assert.equal(tools.includes("create_draft"), false);
  assert.equal(tools.includes("request_schedule"), false);
  const call = await rpc("tools/call", { name: "list_drafts", arguments: {} });
  assert.equal(JSON.parse(call.result.content[0].text).drafts[0].title, "Launch");
  const denied = await rpc("tools/call", { name: "create_draft", arguments: {} });
  assert.ok(denied.error || denied.result?.isError);
});
