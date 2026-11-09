import { getPlatformProxy } from "wrangler";
import { inspectMedia } from "../src/features/media/metadata.ts";

if(!process.argv.includes("--local")) throw new Error("Use --local to backfill metadata/previews in the selected local workspace. Remote repairs require a staged operator procedure.");
const proxy=await getPlatformProxy({persist:process.env.POSTQ_LOCAL_STATE?{path:process.env.POSTQ_LOCAL_STATE}:true});
try {
  const db=proxy.env.DB;
  const {results}=await db.prepare("SELECT id,user_id,mime FROM media_assets WHERE metadata IS NULL OR (mime LIKE 'video/%' AND json_extract(metadata,'$.validated')=1 AND json_extract(metadata,'$.frameRate') IS NULL) ORDER BY created_at LIMIT 100").all();
  let complete=0;
  for(const asset of results) {
    try {
      const object=await proxy.env.MEDIA.get(asset.user_id+"/"+asset.id);
      if(!object || object.size>10*1024*1024) throw new Error("Missing or oversized object");
      const {metadata,thumbnail}=await inspectMedia(new Uint8Array(await object.arrayBuffer()),asset.mime);
      if(thumbnail) await proxy.env.MEDIA.put(asset.user_id+"/"+asset.id+"/thumbnail",thumbnail,{httpMetadata:{contentType:"image/png"}});
      await db.prepare("UPDATE media_assets SET metadata=?,thumbnail=max(thumbnail,?) WHERE id=? AND user_id=?")
        .bind(JSON.stringify(metadata),thumbnail?1:0,asset.id,asset.user_id).run();
      complete++;
    } catch {
      await db.prepare("UPDATE media_assets SET metadata=? WHERE id=? AND user_id=?").bind(JSON.stringify({validated:false}),asset.id,asset.user_id).run();
      console.warn("Media "+asset.id+" needs review/re-upload; original data retained.");
    }
  }
  console.log("Validated "+complete+" of "+results.length+" assets. Repeat for the next batch.");
} finally {await proxy.dispose();}
