import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { nextMessages, validMessage, contextMessages } from "../src/features/assistant/chat-types.ts";
import { streamText, toUIMessageStream, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

// Transpile only the store, preserving the same SQL and logic used with D1.
const source = readFileSync(new URL("../src/features/assistant/chat-store.ts", import.meta.url), "utf8")
  .replaceAll('"./chat-types"', JSON.stringify(new URL("../src/features/assistant/chat-types.ts", import.meta.url).href));
const storeModule = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { claimChat, finishChat } = await import("data:text/javascript;base64," + Buffer.from(storeModule).toString("base64"));
const proposalFile = new URL("../src/features/assistant/proposal.ts", import.meta.url);
const proposalSource = readFileSync(proposalFile, "utf8").replace(/from "([.][^"]+)"/g,
  (_, path) => "from " + JSON.stringify(new URL(path + ".ts", proposalFile).href));
const proposalModule = ts.transpileModule(proposalSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { readCampaign } = await import("data:text/javascript;base64," + Buffer.from(proposalModule).toString("base64"));
const user = (id, text = "Write a post") => ({ id, role: "user", parts: [{ type: "text", text }] });
const assistant = (id, text = "A reply") => ({ id, role: "assistant", parts: [{ type: "text", text }] });

function store(t) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec('PRAGMA foreign_keys=ON; CREATE TABLE "user" (id TEXT PRIMARY KEY); INSERT INTO "user" VALUES (\'owner\'),(\'other\');');
  sqlite.exec(readFileSync(new URL("../migrations/0017_assistant_chats.sql", import.meta.url), "utf8"));
  t.after(() => sqlite.close());
  return {
    sqlite,
    db: { prepare(sql) { return { bind(...values) { return {
      async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
    }; } }; } },
  };
}

test("chat accepts user text only and rejects injected assistant/tool parts", () => {
  assert.ok(validMessage(user("message_1")));
  for (const value of [assistant("forged"), user("bad id"), user("empty", " "), user("long", "a".repeat(4001)),
    { ...user("tool"), parts: [{ type: "tool-prepare_posts", state: "output-available", output: {} }] }]) assert.equal(validMessage(value), false);
});

test("post proposals preserve every supported platform and reject oversized copy", () => {
  const input = { title: "Launch", caption: "New collection", date: "2026-11-30", time: "14:30",
    variants: { threads: "a", facebook: "b", instagram: "c", youtube: "d", tiktok: "e", pinterest: "f", linkedin: "g", x: "h" } };
  assert.deepEqual(readCampaign(input), input);
  assert.equal(readCampaign({ ...input, title: "a".repeat(161) }), null);
  assert.equal(readCampaign({ ...input, caption: "a".repeat(9601) }), null);
  assert.equal(readCampaign({ ...input, date: "2026-02-30", time: "25:00" }).date, "");
  assert.equal(readCampaign({ ...input, time: "25:00" }).time, "");
});

test("chat parent checks reject stale tabs and retry preserves one user message", () => {
  const previous = [user("one"), assistant("two")];
  assert.throws(() => nextMessages(previous, user("three"), false, null), /another tab/);
  assert.throws(() => nextMessages(previous, user("one", "edited"), true, null), /changed/);
  assert.throws(() => nextMessages(previous, user("two", "A reply"), true, "one"), /changed/);
  assert.deepEqual(nextMessages(previous, user("one"), true, null), [user("one")]);
  assert.deepEqual(nextMessages([], user("first"), true, null), [user("first")]);
});

test("chat lease rejects duplicate concurrent sends and protects completed turns", async (t) => {
  const { db, sqlite } = store(t);
  const claims = await Promise.allSettled([claimChat(db, "owner", "chat", user("one"), false, null), claimChat(db, "owner", "chat", user("one"), false, null)]);
  assert.equal(claims.filter((claim) => claim.status === "fulfilled").length, 1);
  const accepted = claims.find((claim) => claim.status === "fulfilled").value;
  await finishChat(db, "owner", "chat", "one", accepted.revision, [...accepted.messages, assistant("two")], "ready");
  await assert.rejects(claimChat(db, "owner", "chat", user("one"), true, null), /already saved/);
  await assert.rejects(claimChat(db, "other", "chat", user("stolen"), false, "two"), /unavailable/);
  assert.equal(JSON.parse(sqlite.prepare("SELECT messages FROM assistant_chats").get().messages).length, 2);
});

test("failed replies retry without duplicate user rows and old writers cannot overwrite", async (t) => {
  const { db, sqlite } = store(t);
  const first = await claimChat(db, "owner", "chat", user("one"), false, null);
  await finishChat(db, "owner", "chat", "one", first.revision, [...first.messages, assistant("partial")], "stopped");
  const retry = await claimChat(db, "owner", "chat", user("one"), true, null);
  assert.deepEqual(retry.messages, [user("one")]);
  await assert.rejects(finishChat(db, "owner", "chat", "one", first.revision, [], "ready"), /lost its request lease/);
  await finishChat(db, "owner", "chat", "one", retry.revision, [...retry.messages, assistant("complete")], "ready");
  assert.equal(sqlite.prepare("SELECT state FROM assistant_chats").get().state, "ready");
});

test("expired runs recover while persisted history remains bounded for model context", async (t) => {
  const { db, sqlite } = store(t);
  await claimChat(db, "owner", "chat", user("one"), false, null);
  sqlite.prepare("UPDATE assistant_chats SET active_until=0").run();
  const retry = await claimChat(db, "owner", "chat", user("one"), true, null);
  assert.equal(retry.messages.length, 1);
  const messages = Array.from({ length: 40 }, (_, index) => assistant(String(index), "a".repeat(4000)));
  const selected = contextMessages(messages);
  assert.ok(selected.length <= 20 && JSON.stringify(selected).length < 61000);
  assert.equal(selected.at(-1).id, "39");
});

test("SDK v7 streams separate deltas and persists final UI messages", async () => {
  let saved;
  const model = new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunkDelayInMs: 1, chunks: [
    { type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: "Hello" },
    { type: "text-delta", id: "text", delta: " there" }, { type: "text-end", id: "text" },
    { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 2 } } },
  ] }) }) });
  const result = streamText({ model, prompt: "Hello" });
  const stream = toUIMessageStream({ stream: result.stream, originalMessages: [user("one", "Hello")],
    generateMessageId: () => "reply", sendReasoning: false, onEnd: (value) => { saved = value; } });
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.deepEqual(chunks.filter((part) => part.type === "text-delta").map((part) => part.delta), ["Hello", " there"]);
  assert.equal(saved.outcome.status, "completed");
  assert.equal(saved.messages[1].parts.find((part) => part.type === "text").text, "Hello there");
});
