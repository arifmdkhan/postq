import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { PNG } from "pngjs";
import { encode } from "jpeg-js";
import { encode as encodePng } from "fast-png";
import { verifyPassword } from "better-auth/crypto";
import { fixture } from "./helpers/database.mjs";
import { validBootstrapToken } from "../src/server/bootstrap.ts";
import { encryptSetting,integrationConfiguration } from "../src/features/settings/encryption.ts";
import { validPostReceipt } from "../src/features/publishing/receipts.ts";
import { zonedMinute,zonedMinuteToUtc,zonedDayStart } from "../src/features/publishing/timezone.ts";
import { inspectMedia } from "../src/features/media/metadata.ts";
import { mediaDeliveryError } from "../src/features/media/validation.ts";
import { cleanupMedia } from "../src/features/media/cleanup.ts";
import { claimPublicationComment } from "../src/features/publishing/comments.ts";
import { publishDue } from "../src/features/publishing/runner.ts";
import { resolveReviewedPublication } from "../src/features/publishing/review.ts";
import { reconcilePending } from "../src/features/publishing/reconcile.ts";
import { runScheduled } from "../src/features/publishing/scheduler.ts";
import { retainHistory } from "../src/features/publishing/retention.ts";
import { recoverOwner,prepareRestoredWorkspace } from "../scripts/recover-owner.mjs";
import { readTimezonePreferences,synchronizeLocalTimezone,writeTimezonePreference } from "../src/features/settings/timezone-preferences.ts";

const draftSource=readFileSync(new URL("../src/features/drafts/repository.ts",import.meta.url),"utf8")
  .replace('import { database } from "@/server/db";','const database=async()=>globalThis.remediationDb;');
const compiled=ts.transpileModule(draftSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {saveDraft,getDraft}=await import("data:text/javascript;base64,"+Buffer.from(compiled).toString("base64"));
function publication(sqlite,id="post",platform="threads",status="scheduled",extra={}) {
  sqlite.prepare("UPDATE channels SET platform=? WHERE id='channel'").run(platform);
  sqlite.prepare("INSERT INTO publications(id,user_id,channel_id,title,caption,due_at,status,pending_receipt,destination,delivery_options) VALUES (?,'owner','channel','Post','Caption',0,?,?,?,?)")
    .run(id,status,extra.pending??null,extra.destination??null,extra.options??null);
}

test("bootstrap proof rejects absence, wrong and short tokens independently of reserved email",()=>{
  const expected="a".repeat(64);
  assert.equal(validBootstrapToken(null,expected),false);
  assert.equal(validBootstrapToken("b".repeat(64),expected),false);
  assert.equal(validBootstrapToken("short","short"),false);
  assert.equal(validBootstrapToken(expected,expected),true);
});

test("damaged optional credentials are isolated and versioned keys survive session-secret rotation",(t)=>{
  const original={...process.env};
  t.after(()=>{for(const name of ["BETTER_AUTH_SECRET","POSTQ_ENCRYPTION_KEY"])if(original[name]===undefined)delete process.env[name];else process.env[name]=original[name];});
  process.env.BETTER_AUTH_SECRET="old-auth-".repeat(8);process.env.POSTQ_ENCRYPTION_KEY="stable-key-".repeat(8);
  const saved=encryptSetting("fake-provider-key");
  const config=integrationConfiguration([{name:"integration:COMPOSIO_API_KEY",value:saved},{name:"integration:GOOGLE_CLIENT_SECRET",value:"corrupted"}],
    {BETTER_AUTH_SECRET:"new-auth-".repeat(8),POSTQ_ENCRYPTION_KEY:process.env.POSTQ_ENCRYPTION_KEY,GOOGLE_CLIENT_SECRET:"unrelated-fallback"});
  assert.equal(config.COMPOSIO_API_KEY,"fake-provider-key");assert.equal(config.GOOGLE_CLIENT_SECRET,undefined);
  assert.equal(config.POSTQ_CONFIG_ERRORS,"GOOGLE_CLIENT_SECRET");
  assert.equal(integrationConfiguration([{name:"integration:COMPOSIO_API_KEY",value:saved}],{}).COMPOSIO_API_KEY,undefined);
});

test("all draft writers get monotonic versions and stale normal saves retain the newer text",async(t)=>{
  const {db,sqlite}=fixture(t);globalThis.remediationDb=db;t.after(()=>delete globalThis.remediationDb);
  const input={id:"draft",title:"Draft",body:"First",planned_on:null,tag:null};
  await saveDraft("owner",input,true);
  const first=await getDraft("owner","draft");
  assert.equal((await saveDraft("owner",{...input,body:"New"},false,first.updated_at)).meta.changes,1);
  assert.equal((await saveDraft("owner",{...input,body:"Stale"},false,first.updated_at)).meta.changes,0);
  const second=await getDraft("owner","draft");assert.equal(second.body,"New");assert.equal(second.revision,1);assert.ok(second.updated_at>first.updated_at);
  sqlite.prepare("UPDATE drafts SET body='MCP',updated_at=? WHERE id='draft'").run(first.updated_at);
  const third=await getDraft("owner","draft");assert.ok(third.updated_at>second.updated_at);assert.equal(third.revision,2);
  assert.equal((await saveDraft("owner",input,false)).meta.changes,0);
});

test("local day boundaries and wall minutes handle Kolkata midnight and both DST transitions",()=>{
  const utc=zonedMinuteToUtc("2026-11-06T00:30","Asia/Kolkata");
  assert.equal(new Date(utc).toISOString(),"2026-11-05T19:00:00.000Z");
  assert.equal(zonedMinute(utc,"Asia/Kolkata"),"2026-11-06T00:30");
  assert.equal(new Date(zonedDayStart("2026-11-06","Asia/Kolkata")).toISOString(),"2026-11-05T18:30:00.000Z");
  assert.equal(zonedMinuteToUtc("2026-03-08T02:30","America/New_York"),null);
  assert.equal(zonedMinuteToUtc("2026-11-01T01:30","America/New_York"),null);
  assert.equal(zonedMinuteToUtc("2026-02-30T10:00","UTC"),null);
});

test("timezone defaults detect the device while manual and legacy choices stay fixed",async(t)=>{
  const {db,sqlite}=fixture(t);
  assert.deepEqual(await readTimezonePreferences(db),{timezone:"UTC",mode:"auto",ready:false});
  assert.equal((await synchronizeLocalTimezone(db,"Asia/Calcutta")).timezone,"Asia/Calcutta");
  assert.equal((await synchronizeLocalTimezone(db,"America/Los_Angeles")).timezone,"America/Los_Angeles");
  await writeTimezonePreference(db,"Asia/Tokyo","manual");
  assert.equal((await synchronizeLocalTimezone(db,"Asia/Calcutta")).timezone,"Asia/Tokyo");
  sqlite.prepare("DELETE FROM app_settings WHERE name='display-timezone-mode'").run();
  assert.equal((await synchronizeLocalTimezone(db,"UTC")).timezone,"Asia/Tokyo");
  sqlite.prepare("UPDATE app_settings SET value='UTC' WHERE name='display-timezone'").run();
  assert.equal((await synchronizeLocalTimezone(db,"Asia/Calcutta")).timezone,"Asia/Calcutta");
  await writeTimezonePreference(db,"UTC","manual");
  assert.equal((await synchronizeLocalTimezone(db,"Asia/Calcutta")).timezone,"UTC");
  sqlite.prepare("UPDATE app_settings SET value='invalid' WHERE name='display-timezone'").run();
  sqlite.prepare("INSERT OR REPLACE INTO app_settings VALUES ('display-timezone-mode','damaged',0)").run();
  assert.equal((await synchronizeLocalTimezone(db,"Asia/Calcutta")).timezone,"Asia/Calcutta");
});

test("a manual timezone change wins a concurrent device sync and invalid zones do not change settings",async(t)=>{
  const {db}=fixture(t);
  await synchronizeLocalTimezone(db,"Asia/Calcutta");
  await Promise.all([synchronizeLocalTimezone(db,"America/New_York"),writeTimezonePreference(db,"Europe/London","manual")]);
  assert.equal((await readTimezonePreferences(db)).timezone,"Europe/London");
  await assert.rejects(synchronizeLocalTimezone(db,"Not/A_Zone"),/valid/);
  assert.equal((await readTimezonePreferences(db)).timezone,"Europe/London");
});

test("PostQ install icons and favicon contain valid images at their declared sizes",()=>{
  for(const size of [192,512]) {
    const image=PNG.sync.read(readFileSync(new URL(`../public/postq-${size}.png`,import.meta.url)));
    assert.equal(image.width,size);assert.equal(image.height,size);
  }
  const apple=PNG.sync.read(readFileSync(new URL("../src/app/apple-icon.png",import.meta.url)));assert.equal(apple.width,180);
  const icon=readFileSync(new URL("../src/app/favicon.ico",import.meta.url));assert.equal(icon.readUInt16LE(2),1);assert.equal(icon.readUInt16LE(4),4);
  for(let index=0;index<4;index++) {
    const entry=6+16*index,offset=icon.readUInt32LE(entry+12),length=icon.readUInt32LE(entry+8);
    const image=PNG.sync.read(icon.subarray(offset,offset+length));assert.equal(image.width,icon[entry]||256);
  }
});

test("receipt parsing accepts actual LinkedIn URNs and rejects cross-platform receipts",()=>{
  assert.ok(validPostReceipt("linkedin","urn:li:share:123"));assert.ok(validPostReceipt("linkedin","urn:li:ugcPost:123"));
  assert.equal(validPostReceipt("threads","urn:li:share:123"),false);assert.equal(validPostReceipt("youtube","invalid"),false);
});

test("JPEG/PNG are decoded, malformed data rejected, and full-size images get bounded previews",async()=>{
  const image=new PNG({width:1200,height:800});image.data.fill(200);
  const png=PNG.sync.write(image);const result=await inspectMedia(png,"image/png");
  assert.equal(result.metadata.width,1200);assert.ok(result.metadata.validated);assert.ok(result.thumbnail.length<1024*1024);
  const preview=PNG.sync.read(Buffer.from(result.thumbnail));assert.equal(preview.width,480);assert.equal(preview.height,320);
  const jpeg=encode({width:1200,height:800,data:image.data},70).data;
  assert.ok((await inspectMedia(jpeg,"image/jpeg")).metadata.validated);
  await assert.rejects(inspectMedia(png.subarray(0,50),"image/png"));
  await assert.rejects(inspectMedia(jpeg.subarray(0,40),"image/jpeg"));
  assert.match(mediaDeliveryError("instagram","image/jpeg",null),/Re-upload/);
});

test("video inspection obtains actual codec/duration and rejects fake container headers",async()=>{
  const bytes=readFileSync(new URL("./fixtures/valid-h264.mp4",import.meta.url));
  const {metadata}=await inspectMedia(bytes,"video/mp4");assert.equal(metadata.codec,"avc");assert.equal(metadata.width,160);assert.ok(metadata.duration>=0.9&&metadata.duration<=1.1);
  assert.ok(metadata.frameRate>0);
  assert.match(mediaDeliveryError("tiktok","video/mp4",JSON.stringify(metadata),0.5),/duration/);
  const valid={...metadata,width:1080,height:1920,duration:30,frameRate:30};
  assert.equal(mediaDeliveryError("tiktok","video/mp4",JSON.stringify(valid),60),"");
  assert.match(mediaDeliveryError("tiktok","video/mp4",JSON.stringify({...valid,width:160}),60),/dimensions/);
  assert.match(mediaDeliveryError("instagram","video/mp4",JSON.stringify({...valid,frameRate:120})),/FPS/);
  assert.match(mediaDeliveryError("instagram","video/mp4",JSON.stringify({...valid,duration:61}),undefined,"story"),/Instagram/);
  await assert.rejects(inspectMedia(bytes.subarray(0,64),"video/mp4"));
});

test("portable PNG inspection handles grayscale and rejects decompression beyond declared dimensions",async()=>{
  const gray=encodePng({width:2,height:2,channels:1,depth:16,data:new Uint16Array([0,65535,30000,40000])});
  const result=await inspectMedia(gray,"image/png");
  const preview=PNG.sync.read(Buffer.from(result.thumbnail));
  assert.deepEqual([...preview.data.subarray(0,8)],[0,0,0,255,255,255,255,255]);
  const image=new PNG({width:4096,height:4});image.data.fill(255);
  const inflated=PNG.sync.write(image);inflated.writeUInt32BE(1,16);inflated.writeUInt32BE(1,20);
  await assert.rejects(inspectMedia(inflated,"image/png"),/exceeds its dimensions/);
});

test("draft media references block deletion and failed R2 cleanup is durably retried",async(t)=>{
  const {db,sqlite}=fixture(t);globalThis.remediationDb=db;t.after(()=>delete globalThis.remediationDb);
  sqlite.prepare("INSERT INTO media_assets(id,user_id,name,mime,bytes,created_at) VALUES ('asset','owner','Image','image/jpeg',3,0)").run();
  await saveDraft("owner",{id:"draft",title:"Draft",body:"",planned_on:null,tag:null,delivery_plan:'{"variants":{"channel":{"media":"asset"}}}'},true);
  const remove="DELETE FROM media_assets WHERE id='asset' AND NOT EXISTS (SELECT 1 FROM drafts d,json_tree(d.delivery_plan) j WHERE d.user_id=media_assets.user_id AND j.type='text' AND j.value=media_assets.id)";
  assert.equal(sqlite.prepare(remove).run().changes,0);
  sqlite.prepare("DELETE FROM drafts").run();assert.equal(sqlite.prepare(remove).run().changes,1);
  await cleanupMedia(db,{async delete(){throw new Error("R2 offline");}});
  assert.equal(sqlite.prepare("SELECT attempts FROM media_deletions").get().attempts,1);
  let removed;await cleanupMedia(db,{async delete(keys){removed=keys;}});assert.deepEqual(removed,["owner/asset","owner/asset/thumbnail"]);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM media_deletions").get().n,0);
  assert.equal((await saveDraft("owner",{id:"bad",title:"Draft",body:"",planned_on:null,tag:null,delivery_plan:'{"media":"asset"}'},true)).meta.changes,0);
});

test("uncertain comments cannot replay until the owner establishes non-delivery",async(t)=>{
  const {db,sqlite}=fixture(t);publication(sqlite,"post","threads","published");sqlite.prepare("UPDATE publications SET remote_post_id='123'").run();
  assert.ok(await claimPublicationComment(db,"owner","post","123","Reply"));
  assert.equal(await claimPublicationComment(db,"owner","post","123","Reply"),false);
  sqlite.prepare("UPDATE publication_comments SET state='not-sent'").run();assert.ok(await claimPublicationComment(db,"owner","post","123","Reply"));
  sqlite.prepare("UPDATE publication_comments SET state='closed'").run();assert.equal(await claimPublicationComment(db,"owner","post","123","Reply"),false);
});

test("ten simultaneous deliveries are claimed once and failed attempts retain sanitized diagnostics",async(t)=>{
  const {db,sqlite}=fixture(t);for(let i=0;i<10;i++)publication(sqlite,"post"+i);
  const sent=new Set();const publish=async(_account,_user,_caption,_platform,job)=>{assert.ok(!sent.has(job.id));sent.add(job.id);if(job.id==="post0")throw Object.assign(new Error("private token must not persist"),{status:429});return"123";};
  await Promise.all([publishDue(db,publish,"owner"),publishDue(db,publish,"owner")]);
  assert.equal(sent.size,10);assert.equal(sqlite.prepare("SELECT count(*) AS n FROM delivery_attempts").get().n,10);
  assert.equal(sqlite.prepare("SELECT last_error FROM publications WHERE id='post0'").get().last_error,"provider_http_429");
  await publishDue(db,publish,"owner");assert.equal(sent.size,10);
});

test("closing a processing attempt preserves its receipt and late TikTok success remains discoverable",async(t)=>{
  const {db,sqlite}=fixture(t);publication(sqlite,"post","tiktok","review",{pending:"submission"});
  sqlite.prepare("UPDATE publications SET claimed_at=?").run(Date.now()-48*3600000);
  await resolveReviewedPublication(db,"owner","post",null);
  assert.equal(sqlite.prepare("SELECT pending_receipt FROM publications").get().pending_receipt,"submission");
  t.mock.method(globalThis,"fetch",async()=>Response.json({successful:true,data:{data:{status:"PUBLISH_COMPLETE",publicaly_available_post_id:["123456"]}}}));
  await reconcilePending(db,"fake","owner",Date.now()+60000);
  const row=sqlite.prepare("SELECT * FROM publications").get();assert.equal(row.status,"published");assert.equal(row.remote_post_id,"123456");assert.equal(row.pending_receipt,"submission");assert.ok(row.abandoned_at);
});

test("receipt persistence failure after a remote mutation never automatically submits the post again",async(t)=>{
  const {db,sqlite}=fixture(t);publication(sqlite);
  const unavailable={...db,prepare(sql){
    if(sql.startsWith("UPDATE publications SET status = ?, remote_post_id")) return {bind(){return {async run(){throw new Error("D1 unavailable after remote success");}};}};
    return db.prepare(sql);
  }};
  let mutations=0;
  const publish=async()=>{mutations++;return"123456";};
  await assert.rejects(publishDue(unavailable,publish,"owner"),/D1 unavailable/);
  await publishDue(db,publish,"owner");assert.equal(mutations,1);
  sqlite.prepare("UPDATE publications SET claimed_at=0").run();
  await publishDue(db,publish,"owner");assert.equal(mutations,1);
  assert.equal(sqlite.prepare("SELECT status FROM publications").get().status,"review");
});

test("TikTok terminal failures and completion without a public ID retain the submission receipt",async(t)=>{
  const {db,sqlite}=fixture(t);
  let receipt;
  t.mock.method(globalThis,"fetch",async()=>Response.json({successful:true,data:{data:receipt}}));
  for(const [id,response,remote,error] of [
    ["numeric",{status:"PUBLISH_COMPLETE",publicaly_available_post_id:[123456]},"123456",null],
    ["private",{status:"PUBLISH_COMPLETE"},null,"provider_complete_no_public_id"],
    ["unsafe-number",{status:"PUBLISH_COMPLETE",publicaly_available_post_id:[Number.MAX_SAFE_INTEGER+1]},null,"provider_complete_no_public_id"],
    ["failed",{status:"FAILED"},null,"provider_processing_failed"],
  ]) {
    publication(sqlite,id,"tiktok","review",{pending:"receipt-"+id});receipt=response;
    await reconcilePending(db,"fake","owner",Date.now()+60000);
    const row=sqlite.prepare("SELECT * FROM publications WHERE id=?").get(id);
    assert.equal(row.remote_post_id,remote);assert.equal(row.last_error,error);assert.equal(row.pending_receipt,"receipt-"+id);assert.ok(row.reconciled_at);
  }
});

test("YouTube reconciliation repairs an existing upload without invoking an upload tool",async(t)=>{
  const {db,sqlite}=fixture(t);publication(sqlite,"post","youtube","review",{pending:"abcdefghijk",destination:"public",options:'{"madeForKids":false,"syntheticMedia":true}'});
  const methods=[];t.mock.method(globalThis,"fetch",async(url,init)=>{assert.ok(String(url).endsWith("/proxy"));const input=JSON.parse(init.body);methods.push(input.method);
    return input.method==="PUT"?Response.json({status:200,data:{id:"abcdefghijk"}}):Response.json({status:200,data:{items:[{id:"abcdefghijk",status:{privacyStatus:"public",selfDeclaredMadeForKids:false,containsSyntheticMedia:true,uploadStatus:"processed"}}]}});});
  await reconcilePending(db,"fake","owner",Date.now()+60000);assert.deepEqual(methods,["PUT","GET"]);assert.equal(sqlite.prepare("SELECT status FROM publications").get().status,"published");
});

test("paused scheduler records health and never submits provider mutations",async(t)=>{
  const {db,sqlite}=fixture(t);publication(sqlite);
  t.mock.method(globalThis,"fetch",()=>{throw new Error("Publishing while paused");});
  await runScheduled({DB:db,MEDIA:{async delete(){}},POSTQ_PUBLISHING_PAUSED:"yes"});
  assert.equal(sqlite.prepare("SELECT status FROM publications").get().status,"scheduled");
  assert.equal(JSON.parse(sqlite.prepare("SELECT value FROM app_settings WHERE name='scheduler-status'").get().value).status,"paused");
});

test("metric summaries tolerate out-of-order snapshots and retention preserves latest values",async(t)=>{
  const {db,sqlite}=fixture(t);publication(sqlite);
  for(const [time,value]of[[1,2],[3,8],[2,5]])sqlite.prepare("INSERT INTO publication_metrics VALUES ('post',?,'views',?)").run(time,value);
  assert.equal(sqlite.prepare("SELECT value FROM publication_metrics_latest").get().value,8);
  await retainHistory(db,30);assert.equal(sqlite.prepare("SELECT count(*) AS n FROM publication_metrics").get().n,1);
  assert.equal(sqlite.prepare("SELECT value FROM publication_metrics_latest").get().value,8);
});

test("operator recovery preserves ownership and Google linking, revokes sessions, and restored queues do not replay",async(t)=>{
  const {db,sqlite}=fixture(t);const now=new Date().toISOString();
  sqlite.prepare("INSERT INTO account(id,userId,accountId,providerId,createdAt,updatedAt) VALUES ('google','owner','google-owner','google',?,?)").run(now,now);
  sqlite.prepare("INSERT INTO session(id,token,userId,expiresAt,createdAt,updatedAt) VALUES ('session','secret','owner',?,?,?)").run(now,now,now);
  await assert.rejects(recoverOwner(db,"wrong@example.com","NewValidPassword42!"),/not the existing/);
  await recoverOwner(db,"owner@example.com","NewValidPassword42!");
  const password=sqlite.prepare("SELECT password FROM account WHERE providerId='credential'").get().password;
  assert.ok(await verifyPassword({hash:password,password:"NewValidPassword42!"}));assert.ok(sqlite.prepare("SELECT id FROM account WHERE id='google'").get());
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM session").get().n,0);publication(sqlite);
  await prepareRestoredWorkspace(db);assert.equal(sqlite.prepare("SELECT status FROM publications").get().status,"review");
  await publishDue(db,()=>{throw new Error("Replayed restored queue");},"owner");
});
