import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { migrationStatements } from "./helpers/migrations.mjs";
import { getPlatformProxy } from "wrangler";
import { publishDue } from "../src/features/publishing/runner.ts";
import { futureUtcMinute } from "../src/features/publishing/time.ts";
import { resolveReviewedPublication } from "../src/features/publishing/review.ts";
import { deliveryMediaUrl, verifyDeliveryMedia } from "../src/features/publishing/media-link.ts";
import { deliveryError } from "../src/features/publishing/capabilities.ts";
import { matchesMediaFormat } from "../src/features/media/formats.ts";
import { serveMedia } from "../src/features/media/serve.ts";
import { listFacebookPages, listPinterestDestinations, publishMediaPost } from "../src/features/publishing/composio.ts";

test("LinkedIn text delivery verifies the member before writing and retains the post URN", async (t) => {
  const requests = t.mock.method(globalThis, "fetch", async (url, options) => {
    const { arguments: args } = JSON.parse(options.body);
    if (url.endsWith("/LINKEDIN_WHO_AM_I")) return Response.json({ successful: true, data: { data: { sub: "member" } } });
    assert.match(url, /LINKEDIN_CREATE_LINKED_IN_POST$/);
    assert.equal(args.author, "urn:li:person:member");
    assert.equal(args.commentary, "Hello LinkedIn");
    return Response.json({ successful: true, data: { x_restli_id: "urn:li:share:123" } });
  });
  const post = { title: "Hello", caption: "Hello LinkedIn", destination: "urn:li:person:other" };
  await assert.rejects(publishMediaPost("key", "ca_test", "user", "linkedin", post, null), /author changed/);
  assert.equal(requests.mock.callCount(), 1);
  assert.equal(await publishMediaPost("key", "ca_test", "user", "linkedin", { ...post, destination: "urn:li:person:member" }, null), "urn:li:share:123");
});

test("Pinterest board pagination and image delivery use the verified tool schemas", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const { arguments: args } = JSON.parse(options.body);
    if (url.endsWith("/PINTEREST_LIST_BOARDS")) {
      const data = args.bookmark
        ? { items: [{ id: "2", name: "Travel" }] }
        : { items: [{ id: "1", name: "Design" }], next_cursor: "next" };
      return Response.json({ successful: true, data });
    }
    assert.match(url, /PINTEREST_CREATE_PIN$/);
    assert.deepEqual(args, {
      board_id: "1", board_section_id: "3", title: "Pin", description: "Details",
      link: "https://example.com", alt_text: "Example image",
      media_source: { source_type: "image_url", url: "https://postq.example/image" },
    });
    return Response.json({ successful: true, data: { id: "12345" } });
  });
  assert.deepEqual(await listPinterestDestinations("key", "ca_test", "user"), [
    { id: "1", name: "Design" }, { id: "2", name: "Travel" },
  ]);
  assert.equal(await publishMediaPost("key", "ca_test", "user", "pinterest", {
    title: "Pin", caption: "Details", destination: "1",
    delivery_options: '{"section":"3","link":"https://example.com","altText":"Example image"}',
  }, { url: "https://postq.example/image", mime: "image/jpeg" }), "12345");
});

test("Facebook link posts send the URL to the Page feed endpoint", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.match(url, /FACEBOOK_CREATE_POST$/);
    assert.deepEqual(JSON.parse(options.body).arguments, {
      page_id: "123", message: "", link: "https://example.com/story",
    });
    return Response.json({ successful: true, data: { id: "123_456" } });
  });
  assert.equal(await publishMediaPost("key", "ca_test", "user", "facebook", {
    title: "Link", caption: "", destination: "123", delivery_options: '{"link":"https://example.com/story"}',
  }, null), "123_456");
  assert.equal(request.mock.callCount(), 1);
});

test("Facebook Page discovery follows cursors and exposes only publishable destinations", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.connected_account_id, "ca_test");
    const data = request.arguments.after
      ? { data: [{ id: "3", name: "Second Page", tasks: ["MANAGE"] }] }
      : { data: [
        { id: "1", name: "First Page", tasks: ["CREATE_CONTENT"], access_token: "secret" },
        { id: "2", name: "Read Only", tasks: ["ANALYZE"] },
      ], paging: { next: "unused", cursors: { after: "page-2" } } };
    return Response.json({ successful: true, data });
  });
  assert.deepEqual(await listFacebookPages("key", "ca_test", "user"), [
    { id: "1", name: "First Page" }, { id: "3", name: "Second Page" },
  ]);
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("delivery validation applies provider media and destination rules", () => {
  assert.equal(deliveryError("facebook", "", "video/mp4", "123"), "");
  assert.notEqual(deliveryError("facebook", "Caption", null, ""), "");
  assert.equal(deliveryError("instagram", "", "image/jpeg", ""), "");
  assert.notEqual(deliveryError("instagram", "", "image/png", ""), "");
  assert.equal(deliveryError("youtube", "", "video/mp4", "unlisted"), "");
  assert.notEqual(deliveryError("youtube", "", "video/mp4", ""), "");
  assert.equal(deliveryError("tiktok", "", "video/mp4", "SELF_ONLY"), "");
  assert.notEqual(deliveryError("tiktok", "", "video/mp4", "private"), "");
  assert.equal(deliveryError("threads", "", "image/jpeg", ""), "");
  assert.notEqual(deliveryError("threads", "Caption", "image/gif", ""), "");
});

test("media upload rejects mismatched file contents", () => {
  const jpeg = Uint8Array.of(0xff, 0xd8, 0xff).buffer;
  const webp = new TextEncoder().encode("RIFF0000WEBP").buffer;
  assert.equal(matchesMediaFormat(jpeg, "image/jpeg"), true);
  assert.equal(matchesMediaFormat(jpeg, "image/png"), false);
  assert.equal(matchesMediaFormat(webp, "image/webp"), true);
  assert.equal(matchesMediaFormat(new TextEncoder().encode("<html>hello").buffer, "image/jpeg"), false);
});

test("delivery media links bind expiry, publication, and secret", async () => {
  const url = new URL(await deliveryMediaUrl("https://postq.example", "test-secret", "post"));
  const expiry = Number(url.searchParams.get("expires"));
  const signature = url.searchParams.get("signature");
  assert.equal(await verifyDeliveryMedia("test-secret", "post", expiry, signature), true);
  assert.equal(await verifyDeliveryMedia("test-secret", "other-post", expiry, signature), false);
  assert.equal(await verifyDeliveryMedia("test-secret", "post", expiry + 1, signature), false);
  assert.equal(await verifyDeliveryMedia("test-secret", "post", Date.now() - 1, signature), false);
});

test("scheduling accepts only real future UTC minutes", () => {
  const now = Date.parse("2028-02-29T12:00Z");
  assert.equal(futureUtcMinute("2028-02-29T12:01", now), now + 60_000);
  assert.equal(futureUtcMinute("2028-02-29T12:00", now), null);
  assert.equal(futureUtcMinute("2028-02-30T12:00", now), null);
  assert.equal(futureUtcMinute("2028-03-01T12:00+05:30", now), null);
  assert.equal(futureUtcMinute(null, now), null);
});

test("overlapping publishing runs send once and ambiguous attempts stay out of the queue", async () => {
  const proxy = await getPlatformProxy({ persist: false });
  try {
    const db = proxy.env.DB;
    const migrations = new URL("../migrations/", import.meta.url);
    for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql") && name < "0008").sort()) {
      const sql = await readFile(new URL(file, migrations), "utf8");
      await db.batch(sql.split(";").map((part) => part.trim()).filter(Boolean).map((part) => db.prepare(part)));
    }
    await db.prepare(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES ('user', 'User', 'user@example.com', 1, 'now', 'now')`).run();
    await db.prepare("INSERT INTO channels (id, user_id, remote_id, active) VALUES ('channel', 'user', 'ca_remote', 1)").run();
    await db.prepare(`INSERT INTO publications (id, user_id, channel_id, title, caption, due_at, status)
      VALUES ('post-a', 'user', 'channel', 'A', 'Confirm', 0, 'scheduled'),
             ('post-b', 'user', 'channel', 'B', 'Uncertain', 0, 'scheduled')`).run();

    const upgrade = await readFile(new URL("0008_managed_channels.sql", migrations), "utf8");
    await db.batch(upgrade.split(";").map((part) => part.trim()).filter(Boolean).map((part) => db.prepare(part)));
    const delivery = await readFile(new URL("0009_delivery_media_metrics.sql", migrations), "utf8");
    await db.batch(delivery.split(";").map((part) => part.trim()).filter(Boolean).map((part) => db.prepare(part)));
    const tiktok = await readFile(new URL("0010_tiktok_channels.sql", migrations), "utf8");
    await db.prepare("INSERT INTO publication_metrics VALUES ('post-a', 1, 'views', 10)").run();
    await db.batch(tiktok.split(";").map((part) => part.trim()).filter(Boolean).map((part) => db.prepare(part)));
    for (const file of (await readdir(migrations)).filter((name)=>name.endsWith(".sql") && name>"0010_tiktok_channels.sql").sort()) {
      await db.batch(migrationStatements(await readFile(new URL(file,migrations),"utf8")).map((sql)=>db.prepare(sql)));
    }
    assert.equal(await db.prepare("SELECT value FROM publication_metrics WHERE publication_id = 'post-a'").first("value"), 10);
    
    assert.equal(await db.prepare("SELECT platform FROM channels WHERE id = 'channel'").first("platform"), "threads");
    assert.equal(await db.prepare("SELECT count(*) AS total FROM publications WHERE channel_id = 'channel'").first("total"), 2);
    await db.prepare("INSERT INTO channels (id, user_id, remote_id, active, platform) VALUES ('managed', 'user', 'ca_managed', 1, 'x')").run();
    await db.prepare(`INSERT INTO publications (id, user_id, channel_id, title, caption, due_at, status)
      VALUES ('post-c', 'user', 'managed', 'C', 'Unsupported', 0, 'scheduled')`).run();

    await publishDue(db, async () => { throw new Error("Unexpected publish"); }, "other-owner");
    assert.equal(await db.prepare("SELECT count(*) AS total FROM publications WHERE status = 'scheduled'").first("total"), 3);
    const calls = [];
    async function publish(account, user, caption) {
      assert.equal(account, "ca_remote");
      assert.equal(user, "user");
      calls.push(caption);
      if (caption === "Uncertain") throw new Error("Timed out");
      return "remote-post-id";
    }
    await Promise.all([publishDue(db, publish, "user"), publishDue(db, publish, "user")]);
    await publishDue(db, publish, "user");
    assert.deepEqual(calls.sort(), ["Confirm", "Uncertain"]);

    await db.prepare("INSERT INTO channels (id, user_id, remote_id, active, platform) VALUES ('tiktok', 'user', 'ca_tiktok', 1, 'tiktok')").run();
    await db.prepare(`INSERT INTO publications (id, user_id, channel_id, title, caption, due_at, status)
      VALUES ('video', 'user', 'tiktok', 'Video', 'Caption', 0, 'scheduled')`).run();
    let attempts = 0;
    const sendVideo = async (_account, _user, _caption, platform) => {
      assert.equal(platform, "tiktok");
      attempts++;
      return { pending: "receipt" };
    };
    await Promise.all([publishDue(db, sendVideo, "user"), publishDue(db, sendVideo, "user")]);
    assert.equal(attempts, 1);
    assert.deepEqual(await db.prepare("SELECT status, pending_receipt, remote_post_id FROM publications WHERE id = 'video'").first(),
      { status: "review", pending_receipt: "receipt", remote_post_id: null });
    const { results } = await db.prepare("SELECT id, status, remote_post_id FROM publications ORDER BY id").all();
    assert.deepEqual(results, [
      { id: "post-a", status: "published", remote_post_id: "remote-post-id" },
      { id: "post-b", status: "review", remote_post_id: null },
      { id: "post-c", status: "cancelled", remote_post_id: null },
      { id: "video", status: "review", remote_post_id: null },
    ]);

    assert.equal(await resolveReviewedPublication(db, "other-owner", "post-b", "123"), false);
    assert.equal(await resolveReviewedPublication(db, "user", "post-a", null), false);
    assert.equal(await resolveReviewedPublication(db, "user", "post-b", "123"), true);
    assert.equal(await resolveReviewedPublication(db, "user", "post-b", null), false);
    assert.deepEqual(await db.prepare("SELECT status, remote_post_id FROM publications WHERE id = 'post-b'").first(),
      { status: "published", remote_post_id: "123" });
    await publishDue(db, publish, "user");
    assert.deepEqual(calls.sort(), ["Confirm", "Uncertain"]);

    await proxy.env.MEDIA.put("user/sample", "private media");
    assert.equal(await (await proxy.env.MEDIA.get("user/sample")).text(), "private media");
    const ranged = await serveMedia(proxy.env.MEDIA, "user/sample", new Request("https://postq.example/media", { headers: { range: "bytes=8-12" } }), new Headers(), 13);
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get("content-range"), "bytes 8-12/13");
    assert.equal(await ranged.text(), "media");
    await proxy.env.MEDIA.delete("user/sample");
    assert.equal(await proxy.env.MEDIA.get("user/sample"), null);
  } finally {
    await proxy.dispose();
  }
});
