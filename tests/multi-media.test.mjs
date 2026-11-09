import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {fixture} from './helpers/database.mjs';
import {attachmentIds,publicationMediaIds} from '../src/features/media/attachments.ts';
import {attachmentError,mediaLimit} from '../src/features/publishing/media-policy.ts';
import {deliveryMediaUrl,verifyDeliveryMedia} from '../src/features/publishing/media-link.ts';
import {publishMediaPost,sendTikTokPhotos,stageLinkedInFile,uploadPinterestVideo} from '../src/features/publishing/composio.ts';
import {MCPService} from '../src/features/mcp/service.ts';
const id=n=>'90000000-0000-4000-8000-'+String(n).padStart(12,'0');
const image=(n,mime='image/jpeg')=>({id:id(n),name:'Image '+n,mime,bytes:1000,metadata:JSON.stringify({width:1080,height:1080,validated:true})});
const video=n=>({...image(n,'video/mp4'),metadata:JSON.stringify({width:1080,height:1080,validated:true,codec:'avc',duration:10,frameRate:30})});
function mock(t,handler){const original=globalThis.fetch;globalThis.fetch=async(url,init)=>Response.json(await handler(String(url),init?.body?JSON.parse(init.body):null,init));t.after(()=>globalThis.fetch=original);}
const media=[{mime:'image/jpeg',url:'https://postq.example/a'},{mime:'image/jpeg',url:'https://postq.example/b'}];
const post={title:'Title',caption:'Caption',destination:'123',delivery_options:null};

test('ordered media parses legacy singles, rejects duplicate/malformed/oversized selections',()=>{
 assert.deepEqual(attachmentIds(id(1)),[id(1)]);assert.deepEqual(attachmentIds(JSON.stringify([id(2),id(1)])),[id(2),id(1)]);
 assert.deepEqual(publicationMediaIds({media_ids:'[]',media_id:id(1)}),[id(1)]);
 for(const invalid of [[id(1),id(1)],['bad'],Array.from({length:36},(_,i)=>id(i)),{},'[broken'])assert.throws(()=>attachmentIds(invalid));
});
test('placement counts and mixed-media rules cover every publishing channel',()=>{
 for(const platform of ['threads','instagram','facebook','linkedin','pinterest','tiktok','youtube']){
  const count=mediaLimit(platform),base=platform==='youtube'?video(1):image(1);
  assert.equal(attachmentError(platform,Array.from({length:count},(_,i)=>({...base,id:id(i)}))), '');
  assert.match(attachmentError(platform,Array.from({length:count+1},(_,i)=>({...base,id:id(i)}))),/allows/);
 }
 assert.equal(attachmentError('threads',[image(1,'image/png'),video(2)]),'');
 assert.equal(attachmentError('instagram',[image(1),video(2)]),'');
 for(const platform of ['facebook','linkedin','pinterest','tiktok'])assert.ok(attachmentError(platform,[image(1),video(2)]));
 assert.ok(attachmentError('instagram',[image(1),image(2)],'story'));
 assert.ok(attachmentError('instagram',[image(1,'image/png')]));
 assert.ok(attachmentError('tiktok',[image(1,'image/png')]));
 assert.ok(attachmentError('threads',[{...image(1),bytes:9*1024*1024}]));
});
test('migration preserves legacy cover and backfills ordered media without touching null rows',()=>{
 const db=new DatabaseSync(':memory:');try{db.exec("CREATE TABLE publications(id TEXT,media_id TEXT,user_id TEXT,status TEXT,pending_receipt TEXT,reconciled_at INTEGER);INSERT INTO publications(id,media_id) VALUES ('old','asset'),('text',NULL)");db.exec(readFileSync(new URL('../migrations/0021_multi_media.sql',import.meta.url),'utf8'));assert.equal(db.prepare("SELECT media_ids FROM publications WHERE id='old'").get().media_ids,'["asset"]');assert.equal(db.prepare("SELECT media_ids FROM publications WHERE id='text'").get().media_ids,'[]');}finally{db.close();}
});
test('signed delivery URLs bind each publication and exact asset, preserving old URLs',async()=>{
 const secret='secret'.repeat(8),url=new URL(await deliveryMediaUrl('https://postq.example',secret,'post',id(1)));
 const valid=asset=>verifyDeliveryMedia(secret,'post',Number(url.searchParams.get('expires')),url.searchParams.get('signature'),asset);
 assert.equal(await valid(id(1)),true);assert.equal(await valid(id(2)),false);assert.equal(await valid(undefined),false);
 const old=new URL(await deliveryMediaUrl('https://postq.example',secret,'post'));assert.equal(await verifyDeliveryMedia(secret,'post',Number(old.searchParams.get('expires')),old.searchParams.get('signature')),true);
});
test('draft save checks ownership of every shared and variant attachment atomically',async t=>{
 const {sqlite,db}=fixture(t);globalThis.multiMediaDb=db;t.after(()=>delete globalThis.multiMediaDb);
 for(let n=1;n<=2;n++)sqlite.prepare("INSERT INTO media_assets(id,user_id,name,mime,bytes,created_at) VALUES (?,'owner','Image','image/jpeg',10,0)").run(id(n));
 const source=readFileSync(new URL('../src/features/drafts/repository.ts',import.meta.url),'utf8').replace('import { database } from "@/server/db";','const database=async()=>globalThis.multiMediaDb;');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
 const {saveDraft}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
 const draft={id:id(100),title:'Multi',body:'Caption',planned_on:null,tag:null,delivery_plan:JSON.stringify({media:[id(1),id(2)]})};
 assert.equal((await saveDraft('owner',draft,true)).meta.changes,1);
 assert.equal((await saveDraft('owner',{...draft,id:id(101),delivery_plan:JSON.stringify({media:[id(1)],variants:{channel:{media:[id(999)]}}})},true)).meta.changes,0);
 const saved=sqlite.prepare('SELECT delivery_plan FROM drafts WHERE id=?').get(id(100));assert.deepEqual(JSON.parse(saved.delivery_plan).media,[id(1),id(2)]);
});
test('media deletion protects a non-cover attachment in a queued publication',async t=>{
 const {sqlite,db}=fixture(t);globalThis.multiMediaDb=db;t.after(()=>delete globalThis.multiMediaDb);
 for(let n=1;n<=2;n++)sqlite.prepare("INSERT INTO media_assets(id,user_id,name,mime,bytes,created_at) VALUES (?,'owner','Image','image/jpeg',10,0)").run(id(n));
 sqlite.prepare("INSERT INTO publications(id,user_id,channel_id,title,caption,due_at,status,media_id,media_ids) VALUES ('post','owner','channel','Title','Caption',0,'scheduled',?,?)").run(id(1),JSON.stringify([id(1),id(2)]));
 let source=readFileSync(new URL('../src/features/media/actions.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 source='const requireUser=async()=>({id:"owner"});const database=async()=>globalThis.multiMediaDb;const redirect=url=>{throw new Error(url)};const revalidatePath=()=>{};const cleanupMedia=async()=>{};const mediaBucket=async()=>({});\n'+source;
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
 const {deleteAsset}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
 await assert.rejects(deleteAsset(id(2)),/in-use/);assert.ok(sqlite.prepare('SELECT id FROM media_assets WHERE id=?').get(id(2)));
 sqlite.exec("UPDATE publications SET status='cancelled'");await deleteAsset(id(2));assert.equal(sqlite.prepare('SELECT id FROM media_assets WHERE id=?').get(id(2)),undefined);
});
test('Threads sends mixed carousel children in selected order',async t=>{
 const calls=[];mock(t,(url,body)=>{calls.push(body);return {successful:true,data:{post_id:'123'}};});
 assert.equal(await publishMediaPost('key','account','owner','threads',post,[media[1],{...media[0],mime:'video/mp4'}]),'123');
 assert.deepEqual(calls[0].arguments.carousel_items.map(item=>[item.media_url,item.media_type]),[[media[1].url,'IMAGE'],[media[0].url,'VIDEO']]);
});
test('Facebook multi-photo makes one ordered post, Pinterest creates a carousel source',async t=>{
 const calls=[];mock(t,(url,body)=>{calls.push({url,body});return {successful:true,data:{post_id:'123',id:'123'}};});
 await publishMediaPost('key','account','owner','facebook',post,media);
 assert.match(calls[0].url,/FACEBOOK_CREATE_MULTI_PHOTO_POST/);assert.deepEqual(calls[0].body.arguments.photo_urls,media.map(item=>item.url));
 await publishMediaPost('key','account','owner','pinterest',post,media);
 assert.deepEqual(calls[1].body.arguments.media_source,{source_type:'multiple_image_urls',items:media.map(item=>({url:item.url})),index:0});
});
test('Instagram mixed carousel waits for child processing and publishes the ordered parent once',async t=>{
 const calls=[];let child=0;
 mock(t,(url,body)=>{calls.push({url,body});if(url.endsWith('/tools/execute/proxy')){if(body.method==='POST')return {status:200,data:{id:String(++child)}};return {status:200,data:{status_code:'FINISHED'}};}if(url.includes('INSTAGRAM_GET_USER_INFO'))return {successful:true,data:{id:'123'}};if(url.endsWith('INSTAGRAM_POST_IG_USER_MEDIA'))return {successful:true,data:{id:'20'}};return {successful:true,data:{id:'30'}};});
 assert.equal(await publishMediaPost('key','account','owner','instagram',post,[media[1],{...media[0],mime:'video/mp4'}]),'30');
 const creates=calls.filter(call=>call.body.endpoint?.endsWith('/media'));
 assert.equal(creates[0].body.parameters.find(p=>p.name==='image_url').value,media[1].url);
 assert.equal(creates[1].body.parameters.find(p=>p.name==='media_type').value,'VIDEO');
 const parent=calls.find(call=>call.url.endsWith('INSTAGRAM_POST_IG_USER_MEDIA'));
 assert.deepEqual(parent.body.arguments.children,['1','2']);assert.equal(calls.filter(call=>call.url.endsWith('INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH')).length,1);
});
test('Instagram failed child prevents any public post submission',async t=>{
 const calls=[];mock(t,(url,body)=>{calls.push(url);if(url.endsWith('/tools/execute/proxy'))return body.method==='POST'?{status:200,data:{id:'1'}}:{status:200,data:{status_code:'ERROR'}};return {successful:true,data:{id:'123'}};});
 await assert.rejects(publishMediaPost('key','account','owner','instagram',post,media),/processing failed/);
 assert.equal(calls.some(url=>url.endsWith('INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH')),false);
});
test('LinkedIn image files preserve order and never fall through to text-only publication',async t=>{
 let args;mock(t,(url,body)=>{if(url.includes('LINKEDIN_WHO_AM_I'))return {successful:true,data:{data:{sub:'member'}}};args=body.arguments;return {successful:true,data:{id:'urn:li:share:123'}};});
 const images=media.map((item,index)=>({...item,file:{name:'image'+index+'.jpg',mimetype:'image/jpeg',s3key:'staged'+index}}));
 assert.equal(await publishMediaPost('key','account','owner','linkedin',{...post,destination:'urn:li:person:member'},images),'urn:li:share:123');assert.deepEqual(args.images,images.map(item=>item.file));
 await assert.rejects(publishMediaPost('key','account','owner','linkedin',{...post,destination:'urn:li:person:member'},media),/upload unavailable/);
});
test('TikTok photos send explicit direct-post settings, cover and AI disclosure, retain pending receipt',async t=>{
 let payload;mock(t,(url,body)=>{if(url.includes('TIKTOK_QUERY_CREATOR_INFO'))return {successful:true,data:{data:{creator_username:'fixture',privacy_level_options:['SELF_ONLY'],comment_disabled:false}}};payload=body.body;return {status:200,data:{data:{publish_id:'photo-pending'},error:{code:'ok'}}};});
 assert.deepEqual(await sendTikTokPhotos('key','account','owner','Title','Photos','SELF_ONLY',media.map(item=>item.url),JSON.stringify({aiGenerated:true,autoAddMusic:true,allowComment:true})),{pending:'photo-pending'});
 assert.equal(payload.is_aigc,true);assert.equal(payload.post_mode,'DIRECT_POST');assert.equal(payload.source_info.photo_cover_index,0);assert.deepEqual(payload.source_info.photo_images,media.map(item=>item.url));assert.equal(payload.post_info.auto_add_music,true);assert.equal('disable_duet' in payload.post_info,false);
});

test('LinkedIn staging uses a file reference and refuses an unsafe upload destination',async t=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(url,init)=>{
  if(String(url).endsWith('/files/upload/request')){const body=JSON.parse(init.body);assert.equal(body.tool_slug,'LINKEDIN_CREATE_LINKED_IN_POST');return Response.json({key:'staged-key',type:'new',new_presigned_url:'https://bucket.s3.amazonaws.com/image'});}
  assert.equal(String(url),'https://bucket.s3.amazonaws.com/image');assert.equal(init.method,'PUT');return new Response(null,{status:200});
 };t.after(()=>globalThis.fetch=original);
 assert.deepEqual(await stageLinkedInFile('key','image.jpg','image/jpeg',new Uint8Array([1,2]).buffer),{name:'image.jpg',mimetype:'image/jpeg',s3key:'staged-key'});
 globalThis.fetch=async()=>Response.json({key:'bad',type:'new',new_presigned_url:'http://localhost/upload'});
 await assert.rejects(stageLinkedInFile('key','image.jpg','image/jpeg',new Uint8Array([1]).buffer),/Invalid staging URL/);
});
test('MCP inherits ordered draft attachments, preserves explicit overrides and rejects duplicate IDs',async t=>{
 const {sqlite,db}=fixture(t),token='token',draft=id(300),channel=id(400),now=Date.now();
 sqlite.prepare('UPDATE channels SET id=?').run(channel);
 for(let n=1;n<=2;n++)sqlite.prepare("INSERT INTO media_assets(id,user_id,name,mime,bytes,created_at) VALUES (?,'owner',?,'image/jpeg',10,0)").run(id(n),'Image '+n);
 sqlite.prepare("INSERT INTO mcp_tokens(id,user_id,name,token_hash,scopes,created_at,expires_at) VALUES (?,'owner','test','hash','[\"read\",\"schedule:request\"]',?,?)").run(token,now,now+86400000);
 sqlite.prepare("INSERT INTO drafts(id,user_id,title,body,updated_at,delivery_plan) VALUES (?,'owner','Draft','Caption',?,?)").run(draft,new Date(now).toISOString(),JSON.stringify({media:[id(2),id(1)],variants:{[channel]:{caption:'Variant caption',topic:'Media'}}}));
 const access={id:token,user_id:'owner',scopes:['read','schedule:request'],expires_at:now+86400000};
 const service=new MCPService(db,access,'https://postq.example');
 const input={requestKey:id(500),draftId:draft,expectedUpdatedAt:new Date(now).toISOString(),dueAt:new Date(now+3600000).toISOString().slice(0,16)+':00Z',timezone:'UTC',targets:[{channelId:channel}]};
 await service.prepareSchedule(input);
 const payload=JSON.parse(sqlite.prepare('SELECT payload FROM mcp_requests WHERE request_key=?').get(id(500)).payload);
 assert.deepEqual(payload.targets[0].mediaIds,[id(2),id(1)]);assert.equal(payload.targets[0].caption,'Variant caption');assert.equal(payload.targets[0].options.topic,'Media');
 assert.deepEqual(JSON.parse(payload.fields.find(([name])=>name==='media-'+channel)[1]),[id(2),id(1)]);
 await assert.rejects(service.prepareSchedule({...input,requestKey:id(501),targets:[{channelId:channel,mediaIds:[id(1),id(1)]}]}),/distinct/);
 await service.prepareSchedule({...input,requestKey:id(502),targets:[{channelId:channel,mediaIds:[]}]});
 assert.deepEqual(JSON.parse(sqlite.prepare('SELECT payload FROM mcp_requests WHERE request_key=?').get(id(502)).payload).targets[0].mediaIds,[]);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM publications').get().n,0);
});

test('composer queues all ordered attachments atomically and prevents a deletion race from partially queuing',async t=>{
 const {sqlite,db}=fixture(t);
 const channels=[id(601),id(602)];sqlite.prepare('UPDATE channels SET id=?').run(channels[0]);
 sqlite.prepare("INSERT INTO channels(id,user_id,remote_id,active,platform) VALUES (?,'owner','fake-two',1,'threads')").run(channels[1]);
 for(let n=1;n<=2;n++){const asset=image(n);sqlite.prepare("INSERT INTO media_assets(id,user_id,name,mime,bytes,created_at,metadata) VALUES (?,'owner',?,'image/jpeg',10,0,?)").run(asset.id,asset.name,asset.metadata);}
 const caps=await import('../src/features/publishing/capabilities.ts'),planning=await import('../src/features/drafts/planning.ts'),time=await import('../src/features/publishing/time.ts'),zone=await import('../src/features/publishing/timezone.ts'),validation=await import('../src/features/media/validation.ts');
 let race=false;
 const wrapped={...db,prepare(sql){if(race&&sql.includes('WITH requested AS')){race=false;sqlite.prepare('DELETE FROM media_assets WHERE id=?').run(id(2));}return db.prepare(sql);}};
 const originalOrigin=process.env.BETTER_AUTH_URL,originalSecret=process.env.BETTER_AUTH_SECRET;
 process.env.BETTER_AUTH_URL='https://postq.example';process.env.BETTER_AUTH_SECRET='fixture-secret'.repeat(4);
 t.after(()=>{if(originalOrigin===undefined)delete process.env.BETTER_AUTH_URL;else process.env.BETTER_AUTH_URL=originalOrigin;if(originalSecret===undefined)delete process.env.BETTER_AUTH_SECRET;else process.env.BETTER_AUTH_SECRET=originalSecret;delete globalThis.multiComposeDeps;});
 globalThis.multiComposeDeps={runtimeConfiguration:async()=>({COMPOSIO_API_KEY:'fixture-key'}),requireUser:async()=>({id:'owner'}),database:async()=>wrapped,isPlanningDate:planning.isPlanningDate,getDraft:async()=>null,saveDraft:async()=>{throw new Error('Not a draft test')},futureUtcMinute:time.futureUtcMinute,...caps,getFacebookPages:async()=>[],getPinterestDestinations:async()=>[],getTikTokCreator:async()=>null,linkedinMember:async()=>'',zonedMinuteToUtc:zone.zonedMinuteToUtc,workspaceTimezone:async()=>'UTC',mediaDeliveryError:validation.mediaDeliveryError,attachmentIds,attachmentError,revalidatePath:()=>{}};
 let source=readFileSync(new URL('../src/features/composer/actions.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 source='const {runtimeConfiguration,requireUser,database,isPlanningDate,getDraft,saveDraft,futureUtcMinute,deliveryError,firstCommentLimits,threadsReplyControls,getFacebookPages,getPinterestDestinations,getTikTokCreator,linkedinMember,zonedMinuteToUtc,workspaceTimezone,mediaDeliveryError,attachmentIds,attachmentError,revalidatePath}=globalThis.multiComposeDeps;\n'+source;
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
 const {composePost}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
 function form(offset){const form=new FormData();for(const[k,v]of Object.entries({title:'Media post',caption:'Caption',intent:'now',approved:'yes',approvedIntent:'now',timezone:'UTC',sharedMedia:JSON.stringify([id(2),id(1)])}))form.set(k,v);for(const[index,channel]of channels.entries()){form.append('channel',channel);form.set('id-'+channel,id(offset+index));form.set('caption-'+channel,'Caption');form.set('media-'+channel,JSON.stringify([id(2),id(1)]));}return form;}
 const result=await composePost(id(700),null,{message:'',done:false},form(710));assert.equal(result.done,true);
 for(const row of sqlite.prepare('SELECT media_id,media_ids FROM publications').all()){assert.equal(row.media_id,id(2));assert.deepEqual(JSON.parse(row.media_ids),[id(2),id(1)]);}
 sqlite.exec("DELETE FROM publications");race=true;
 const rejected=await composePost(id(720),null,{message:'',done:false},form(730));assert.equal(rejected.done,false);assert.equal(sqlite.prepare('SELECT count(*) AS n FROM publications').get().n,0);
});

test('LinkedIn video uploads before its single final post and verifies readiness',async t=>{
 const calls=[];mock(t,(url,body)=>{calls.push({url,body});if(url.includes('WHO_AM_I'))return {successful:true,data:{data:{sub:'member'}}};if(url.includes('UPLOAD_VIDEO'))return {successful:true,data:{video_urn:'urn:li:video:fixture',owner:'urn:li:person:member',status:'AVAILABLE'}};return {successful:true,data:{post_id:'urn:li:share:987'}};});
 const file={name:'video.mp4',mimetype:'video/mp4',s3key:'staged'};
 assert.equal(await publishMediaPost('key','account','owner','linkedin',{...post,destination:'urn:li:person:member'},[{mime:'video/mp4',url:'',file}]),'urn:li:share:987');
 assert.match(calls[1].url,/UPLOAD_VIDEO/);assert.equal(calls[2].body.arguments.video_urn,'urn:li:video:fixture');
});
test('Pinterest uploads provider-issued multipart fields and only publishes a processed video ID',async t=>{
 const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,init)=>{
  calls.push(String(url));
  if(String(url).includes('.amazonaws.com')){assert.ok(init.body instanceof FormData);assert.equal(init.body.get('policy'),'provider-policy');assert.ok(init.body.get('file') instanceof Blob);return new Response(null,{status:204});}
  const body=JSON.parse(init.body);
  if(String(url).includes('REGISTER_MEDIA'))return Response.json({successful:true,data:{media_id:'123',upload_url:'https://bucket.s3.amazonaws.com/video',upload_parameters:{policy:'provider-policy'}}});
  if(String(url).includes('GET_MEDIA'))return Response.json({successful:true,data:{media_id:'123',status:'succeeded'}});
  assert.equal(body.arguments.media_source.source_type,'video_id');assert.equal(body.arguments.media_source.media_id,'123');return Response.json({successful:true,data:{id:'456'}});
 };t.after(()=>globalThis.fetch=original);
 const registeredId=await uploadPinterestVideo('key','account','owner',new Uint8Array([1,2]).buffer);
 assert.equal(await publishMediaPost('key','account','owner','pinterest',post,[{mime:'video/mp4',url:'',registeredId}]),'456');
 assert.ok(calls[2].includes('GET_MEDIA'));assert.ok(calls[3].includes('CREATE_PIN'));
 await assert.rejects(publishMediaPost('key','account','owner','pinterest',post,[{mime:'video/mp4',url:''}]),/not ready/);
});
test('expired media preparation budget prevents any publication request',async t=>{
 let calls=0;mock(t,()=>{calls++;return {};});
 await assert.rejects(publishMediaPost('key','account','owner','threads',post,media,Date.now()-1),/deadline/);assert.equal(calls,0);
});
test('channel filters prefer custom labels or cached names and never use mutable row numbering',async()=>{
 const {channelName,channelOptions}=await import('../src/features/publishing/channel-name.ts');
 const account={id:id(1),platform:'facebook',label:null,profile_name:'Zia Shah',active:1};
 assert.equal(channelName(account),'Zia Shah · Facebook');assert.equal(channelName({...account,label:' My page '}),'My page · Facebook');
 assert.equal(channelName({...account,label:' ',profile_name:' Zia Shah '}),'Zia Shah · Facebook');
 assert.equal(channelName({...account,profile_name:null}),'Facebook account · 000001');
 assert.match(channelName({...account,active:0}),/Removed/);
 const options=channelOptions([account,{...account,id:id(2)}]);assert.notEqual(options[0].label,options[1].label);assert.deepEqual(channelOptions([{...account,id:id(2)},account]),[options[1],options[0]]);
});
