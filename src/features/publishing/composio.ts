import { createHash } from "node:crypto";

const api = "https://backend.composio.dev/api/v3";

export async function uploadYouTube(key: string, account: string, user: string,
  post: { title: string; caption: string; destination: string | null; delivery_options: string | null }, bytes: ArrayBuffer,
  saveReceipt?: (id: string) => Promise<void>) {
  const slug = "YOUTUBE_MULTIPART_UPLOAD_VIDEO";
  const filename = "postq-video.mp4";
  const mimetype = "video/mp4";
  const staged = await composio<{ key?: string; type?: string; new_presigned_url?: string }>(key, "/files/upload/request", {
    toolkit_slug: "youtube", tool_slug: slug, filename, mimetype, md5: createHash("md5").update(new Uint8Array(bytes)).digest("hex"),
  });
  if (!staged.key) throw new Error("Video staging did not return a file key");
  if (staged.new_presigned_url) {
    const url = new URL(staged.new_presigned_url);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".amazonaws.com")) throw new Error("Invalid staging URL");
    const uploaded = await fetch(url, { method: "PUT", body: bytes, headers: { "content-type": mimetype }, redirect: "error", signal: AbortSignal.timeout(60_000) });
    if (!uploaded.ok) throw new Error("Video staging failed");
  } else if (staged.type === "new") {
    throw new Error("Video staging did not return an upload URL");
  }
  const receipt = await executeSocialTool<{ video?: { id?: string; status?: { uploadStatus?: string } } }>(key, account, user, slug, {
    title: post.title, description: post.caption, categoryId: "22", tags: [], privacyStatus: "private",
    videoFile: { name: filename, mimetype, s3key: staged.key },
  });
  const id = receipt.video?.id;
  if (typeof id !== "string" || !/^[\w-]{11}$/.test(id) ||
      ["failed", "rejected", "deleted"].includes(receipt.video?.status?.uploadStatus ?? "")) throw new Error("YouTube did not confirm the upload");
  if (saveReceipt) await saveReceipt(id);
  try {
    return await reconcileYouTube(key, account, user, id, post) ? id : { pending: id };
  } catch {
    return { pending: id };
  }
}

export async function reconcileYouTube(key: string, account: string, user: string, id: string,
  post: { destination: string | null; delivery_options: string | null }, applySettings = true) {
  if (!/^[\w-]{11}$/.test(id)) throw new Error("Invalid YouTube receipt");
  const settings = JSON.parse(post.delivery_options ?? "{}");
  if (typeof settings.madeForKids !== "boolean" || !["private", "public", "unlisted"].includes(post.destination ?? "")) return false;
  const request = { connected_account_id: account, user_id: user, endpoint: "https://www.googleapis.com/youtube/v3/videos" };
  const status = { privacyStatus: post.destination, selfDeclaredMadeForKids: settings.madeForKids,
    ...(typeof settings.syntheticMedia === "boolean" ? { containsSyntheticMedia: settings.syntheticMedia } : {}) };
  if (applySettings) {
    const updated = await composio<{ status?: number; data?: { id?: string } }>(key, "/tools/execute/proxy", {
      ...request, method: "PUT", parameters: [{ in: "query", name: "part", value: "status" }], body: { id, status },
    });
    if (updated.status !== 200 || updated.data?.id !== id) return false;
  }
  const result = await composio<{ status?: number; data?: { items?: { id: string; status?: Record<string, unknown> }[] } }>(key, "/tools/execute/proxy", {
    ...request, method: "GET", parameters: [{ in: "query", name: "part", value: "status" }, { in: "query", name: "id", value: id }],
  });
  const actual = result.data?.items?.find((video) => video.id === id)?.status;
  return result.status === 200 && actual?.privacyStatus === status.privacyStatus && actual?.selfDeclaredMadeForKids === status.selfDeclaredMadeForKids &&
    (status.containsSyntheticMedia === undefined || actual?.containsSyntheticMedia === status.containsSyntheticMedia) &&
    !["failed", "rejected", "deleted"].includes(String(actual?.uploadStatus));
}

export async function executeSocialTool<T>(key: string, account: string, user: string, slug: string, args: object, timeoutMs?: number) {
  const version = slug.startsWith("FACEBOOK_") ? "20261103_00" : slug.startsWith("THREADS_") ? "20261026_00" : "20261101_00";
  const result = await composio<{ successful?: boolean; data?: T }>(key, "/tools/execute/" + slug, {
    connected_account_id: account, user_id: user, arguments: args, version,
  }, timeoutMs);
  if (!result.successful || !result.data) throw new Error("Provider did not confirm execution");
  return result.data;
}

export type DeliveryMedia={url:string;mime:string;file?:{name:string;mimetype:string;s3key:string};registeredId?:string};
function mediaTimeout(deadline:number,limit:number){const remaining=deadline-Date.now();if(remaining<=0)throw new Error("Media delivery deadline exceeded");return Math.min(remaining,limit);}
export async function publishMediaPost(key: string, account: string, user: string, platform: string,
  post: { title: string; caption: string; destination: string | null; delivery_options?: string | null }, input: DeliveryMedia | DeliveryMedia[] | null,deadline=Date.now()+180_000) {
  const items=Array.isArray(input)?input:input?[input]:[];
  const media=items[0]??null;
  const execute = <T>(slug: string, args: object, timeoutMs=20_000) => executeSocialTool<T>(key, account, user, slug, args, mediaTimeout(deadline,timeoutMs));
  type Receipt = { id?: string; post_id?: string };
  let receipt: Receipt;
  if (platform === "linkedin") {
    const author = await linkedinMember(key, account, user);
    if (post.destination !== author) throw new Error("LinkedIn author changed");
    const link = JSON.parse(post.delivery_options ?? "{}").link;
    if(media?.mime==="video/mp4"){
      if(items.length!==1 || !media.file || link)throw new Error("LinkedIn video upload unavailable");
      const uploaded=await execute<{video_urn:string;owner:string;status:string}>("LINKEDIN_UPLOAD_VIDEO",{file:media.file},120_000);
      if(uploaded.owner!==author || uploaded.status!=="AVAILABLE" || !/^urn:li:video:[\w-]+$/.test(uploaded.video_urn))throw new Error("LinkedIn video is not ready");
      const created=await execute<{post_id?:string}>("LINKEDIN_CREATE_VIDEO_POST",{video_urn:uploaded.video_urn,commentary:post.caption,title:post.title,visibility:"PUBLIC"},120_000);
      if(!created.post_id || !/^urn:li:(share|ugcPost):\d+$/.test(created.post_id))throw new Error("LinkedIn did not return a receipt");
      return created.post_id;
    }
    if(media && (link || items.some(item=>!item.file)))throw new Error("LinkedIn image upload unavailable");
    const response = link
      ? await execute<{ id?: string; x_restli_id?: string }>("LINKEDIN_CREATE_ARTICLE_OR_URL_SHARE", {
        author, lifecycleState: "PUBLISHED", visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
        specificContent: { "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: post.caption }, shareMediaCategory: "ARTICLE",
          media: [{ originalUrl: link, status: "READY", title: { text: post.title } }],
        } },
      })
      : await execute<{ id?: string; x_restli_id?: string }>("LINKEDIN_CREATE_LINKED_IN_POST", {
        author, commentary: post.caption, visibility: "PUBLIC", lifecycleState: "PUBLISHED",
        ...(media?{images:items.map(item=>item.file!)}:{}),
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      });
    const id = response.x_restli_id ?? response.id;
    if (typeof id !== "string" || !/^urn:li:(share|ugcPost):\d+$/.test(id)) throw new Error("LinkedIn did not return a post receipt");
    return id;
  }
  if (platform === "facebook") {
    const page_id = post.destination;
    const link = JSON.parse(post.delivery_options ?? "{}").link;
    receipt = items.length>1
      ? await execute<Receipt>("FACEBOOK_CREATE_MULTI_PHOTO_POST",{page_id,message:post.caption,photo_urls:items.map(item=>item.url)},120_000)
      : !media
      ? await execute<Receipt>("FACEBOOK_CREATE_POST", { page_id, message: post.caption, ...(link ? { link } : {}) })
      : media.mime === "video/mp4"
        ? await execute<Receipt>("FACEBOOK_CREATE_VIDEO_POST", { page_id, file_url: media.url, title: post.title, description: post.caption })
        : await execute<Receipt>("FACEBOOK_CREATE_PHOTO_POST", { page_id, url: media.url, message: post.caption });
  } else if (platform === "pinterest" && media) {
    if(media.mime==="video/mp4" && (items.length!==1 || !media.registeredId || !/^\d+$/.test(media.registeredId)))throw new Error("Pinterest video is not ready");
    const options = JSON.parse(post.delivery_options ?? "{}");
    receipt = await execute<Receipt>("PINTEREST_CREATE_PIN", {
      board_id: post.destination, title: post.title, description: post.caption,
      ...(options.link ? { link: options.link } : {}),
      ...(options.altText ? { alt_text: options.altText } : {}),
      ...(options.section ? { board_section_id: options.section } : {}),
      media_source: media.mime==="video/mp4" ? {source_type:"video_id",media_id:media.registeredId,cover_image_key_frame_time:0} : items.length>1 ? {source_type:"multiple_image_urls",items:items.map(item=>({url:item.url})),index:0} : { source_type: "image_url", url: media.url },
    });
  } else if (platform === "threads" && media) {
    const video = media.mime === "video/mp4";
    const settings = JSON.parse(post.delivery_options ?? "{}");
    receipt = await execute<Receipt>("THREADS_CREATE_POST", {
      user_id: "me", media_type: items.length>1?"CAROUSEL":video ? "VIDEO" : "IMAGE",
      ...(items.length>1?{carousel_items:items.map(item=>({media_type:item.mime==="video/mp4"?"VIDEO":"IMAGE",media_url:item.url,...(settings.altText?{alt_text:settings.altText}:{})}))}:video ? { video_url: media.url } : { image_url: media.url }),
      ...(post.caption ? { text: post.caption } : {}),
      ...(settings.altText && items.length===1 ? { alt_text: settings.altText } : {}),
      ...(settings.topic ? { topic_tag: settings.topic } : {}),
      ...(settings.replyControl ? { reply_control: settings.replyControl } : {}),
    }, 120_000);
  } else if (platform === "instagram" && media) {
    const profile = await execute<Receipt>("INSTAGRAM_GET_USER_INFO", {});
    if (!profile.id || !/^\d+$/.test(profile.id)) throw new Error("Instagram identity unavailable");
    const video = media.mime === "video/mp4";
    const story = post.destination === "story";
    const settings = JSON.parse(post.delivery_options ?? "{}");
    if(items.length>1){
      if(story)throw new Error("Stories accept one attachment");
      const children:string[]=[];
      for(const item of items){
        const args:Record<string,string>={is_carousel_item:"true",...(item.mime==="video/mp4"?{media_type:"VIDEO",video_url:item.url}:{image_url:item.url,...(settings.altText?{alt_text:settings.altText}:{})})};
        const child=await composio<{status:number;data?:{id?:string}}>(key,"/tools/execute/proxy",{connected_account_id:account,user_id:user,
          endpoint:`https://graph.facebook.com/v21.0/${profile.id}/media`,method:"POST",parameters:Object.entries(args).map(([name,value])=>({in:"query",name,value}))},mediaTimeout(deadline,20_000));
        if(child.status!==200 || !child.data?.id || !/^\d+$/.test(child.data.id))throw new Error("Instagram child container unavailable");
        children.push(child.data.id);
      }
      const processingDeadline=Math.min(deadline,Date.now()+90_000);
      const waiting=new Set(children);
      while(waiting.size){
        for(const id of [...waiting]){
          const status=await composio<{status:number;data?:{status_code?:string}}>(key,"/tools/execute/proxy",{connected_account_id:account,user_id:user,
            endpoint:`https://graph.facebook.com/v21.0/${id}`,method:"GET",parameters:[{in:"query",name:"fields",value:"status_code"}]},mediaTimeout(processingDeadline,20_000));
          if(status.status!==200 || ["ERROR","EXPIRED"].includes(status.data?.status_code??""))throw new Error("Instagram carousel media processing failed");
          if(status.data?.status_code==="FINISHED")waiting.delete(id);
        }
        if(waiting.size){if(Date.now()>=processingDeadline)throw new Error("Instagram carousel processing timed out");await new Promise(resolve=>setTimeout(resolve,Math.min(1500,processingDeadline-Date.now())));}
      }
      const parent=await execute<Receipt>("INSTAGRAM_POST_IG_USER_MEDIA",{ig_user_id:profile.id,media_type:"CAROUSEL",children,...(post.caption?{caption:post.caption}:{})});
      if(!parent.id || !/^\d+$/.test(parent.id))throw new Error("Instagram carousel unavailable");
      const published=await execute<Receipt>("INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH",{ig_user_id:profile.id,creation_id:parent.id,max_wait_seconds:90},110_000);
      if(!published.id || !/^\d+$/.test(published.id))throw new Error("Instagram did not return a receipt");
      return published.id;
    }
    const container = await execute<Receipt>("INSTAGRAM_POST_IG_USER_MEDIA", {
      ig_user_id: profile.id, ...(video ? { video_url: media.url } : { image_url: media.url }),
      ...(story ? { media_type: "STORIES" } : video ? { media_type: "REELS", share_to_feed: JSON.parse(post.delivery_options ?? "{}").shareToFeed !== false } : {}),
      ...(post.caption ? { caption: post.caption } : {}),
      ...(!story && !video && settings.altText ? { alt_text: settings.altText } : {}),
    });
    if (!container.id || !/^\d+$/.test(container.id)) throw new Error("Instagram container unavailable");
    receipt = await execute<Receipt>("INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH", {
      ig_user_id: profile.id, creation_id: container.id, max_wait_seconds: video ? 90 : 12,
    }, video ? 110_000 : 20_000);
  } else {
    throw new Error("Unsupported publication");
  }
  const id = receipt.post_id ?? receipt.id;
  if (typeof id !== "string" || !/^[\w-]{1,128}$/.test(id) ||
      (platform === "pinterest" && !/^\d{1,32}$/.test(id))) throw new Error("Provider did not return a post receipt");
  return id;
}

export async function stageLinkedInFile(key:string,name:string,mimetype:string,bytes:ArrayBuffer,deadline=Date.now()+120_000){
  const staged=await composio<{key?:string;type?:string;new_presigned_url?:string}>(key,"/files/upload/request",{
    toolkit_slug:"linkedin",tool_slug:mimetype==="video/mp4"?"LINKEDIN_UPLOAD_VIDEO":"LINKEDIN_CREATE_LINKED_IN_POST",filename:name,mimetype,md5:createHash("md5").update(new Uint8Array(bytes)).digest("hex")},mediaTimeout(deadline,20_000));
  if(!staged.key)throw new Error("Media staging unavailable");
  if(staged.new_presigned_url){
    const url=new URL(staged.new_presigned_url);
    if(url.protocol!=="https:" || !url.hostname.endsWith(".amazonaws.com") || url.username || url.password || url.port)throw new Error("Invalid staging URL");
    const uploaded=await fetch(url,{method:"PUT",body:bytes,headers:{"content-type":mimetype},redirect:"error",signal:AbortSignal.timeout(mediaTimeout(deadline,60_000))});
    if(!uploaded.ok)throw new Error("Media staging failed");
  } else if(staged.type==="new")throw new Error("Media staging URL missing");
  return {name,mimetype,s3key:staged.key};
}

export async function uploadPinterestVideo(key:string,account:string,user:string,bytes:ArrayBuffer,deadline=Date.now()+180_000){
  const media=await executeSocialTool<{media_id:string;upload_url:string;upload_parameters:Record<string,string>}>(key,account,user,"PINTEREST_REGISTER_MEDIA",{media_type:"video"},mediaTimeout(deadline,20_000));
  const url=new URL(media.upload_url);
  if(!/^\d+$/.test(media.media_id) || url.protocol!=="https:" || !url.hostname.endsWith(".amazonaws.com") || url.username || url.password || url.port)throw new Error("Invalid Pinterest upload destination");
  const body=new FormData();
  for(const [name,value]of Object.entries(media.upload_parameters)){if(typeof value!=="string")throw new Error("Invalid upload fields");body.append(name,value);}
  body.append("file",new Blob([bytes],{type:"video/mp4"}),"postq-video.mp4");
  const uploaded=await fetch(url,{method:"POST",body,redirect:"error",signal:AbortSignal.timeout(mediaTimeout(deadline,60_000))});
  if(!uploaded.ok)throw new Error("Pinterest upload failed");
  const processingDeadline=Math.min(deadline,Date.now()+90_000);
  while(true){
    const status=await executeSocialTool<{status:string;media_id:string}>(key,account,user,"PINTEREST_GET_MEDIA",{media_id:media.media_id},mediaTimeout(processingDeadline,20_000));
    if(status.media_id!==media.media_id || !["registered","processing","succeeded"].includes(status.status))throw new Error("Pinterest video processing failed");
    if(status.status==="succeeded")return media.media_id;
    if(Date.now()>=processingDeadline)throw new Error("Pinterest video processing timed out");
    await new Promise(resolve=>setTimeout(resolve,Math.min(2000,processingDeadline-Date.now())));
  }
}

export async function sendTikTokPhotos(key:string,account:string,user:string,title:string,caption:string,visibility:string,urls:string[],settings:string|null){
  const creator=await tiktokCreator(key,account,user);
  const options=JSON.parse(settings??"{}");
  if(!creator.options.includes(visibility) || options.allowComment && creator.disabled.comment)throw new Error("TikTok creator settings changed");
  const response=await composio<{status:number;data?:{data?:{publish_id?:string};error?:{code?:string}}}>(key,"/tools/execute/proxy",{
    connected_account_id:account,user_id:user,endpoint:"https://open.tiktokapis.com/v2/post/publish/content/init/",method:"POST",
    body:{media_type:"PHOTO",post_mode:"DIRECT_POST",is_aigc:options.aiGenerated===true,
      post_info:{title,description:caption,privacy_level:visibility,disable_comment:!options.allowComment,auto_add_music:options.autoAddMusic===true,
        brand_content_toggle:options.brandContent===true,brand_organic_toggle:options.brandOrganic===true},
      source_info:{source:"PULL_FROM_URL",photo_images:urls,photo_cover_index:0}}});
  const id=response.data?.data?.publish_id;
  if(response.status!==200 || response.data?.error?.code!=="ok" || !id)throw new Error("TikTok photo submission was not confirmed");
  return {pending:id};
}

export async function linkedinMember(key: string, account: string, user: string) {
  const profile = await executeSocialTool<{ data?: { sub?: string } }>(key, account, user, "LINKEDIN_WHO_AM_I", {}, 6_000);
  if (!profile.data?.sub || !/^[\w-]{1,128}$/.test(profile.data.sub)) throw new Error("LinkedIn member identity unavailable");
  return `urn:li:person:${profile.data.sub}`;
}

export async function listPinterestDestinations(key: string, account: string, user: string, board?: string) {
  const destinations = new Map<string, { id: string; name: string }>();
  const seen = new Set<string>();
  let bookmark: string | undefined;
  do {
    const response: { items: { id: string; name: string }[]; next_cursor?: string | null } = await executeSocialTool(
      key, account, user, board ? "PINTEREST_LIST_BOARD_SECTIONS" : "PINTEREST_LIST_BOARDS",
      { ...(board ? { board_id: board } : {}), ...(bookmark ? { bookmark } : {}), page_size: 100 }, 6_000);
    for (const { id, name } of response.items) if (/^\d{1,32}$/.test(id) && name) destinations.set(id, { id, name });
    bookmark = response.next_cursor || undefined;
    if (bookmark && seen.has(bookmark)) throw new Error("Pinterest pagination stalled");
    if (bookmark) seen.add(bookmark);
  } while (bookmark);
  return Array.from(destinations.values());
}

export async function listFacebookPages(key: string, account: string, user: string) {
  const pages = new Map<string, { id: string; name: string; photo?: string }>();
  const cursors = new Set<string>();
  let after: string | undefined;
  do {
    const result = await executeSocialTool<{
      data: { id: string; name: string; tasks?: string[]; picture?: { data?: { url?: string; is_silhouette?: boolean } } }[];
      paging?: { next?: string; cursors?: { after?: string } };
    }>(key, account, user, "FACEBOOK_LIST_MANAGED_PAGES", {
      fields: "id,name,tasks,picture", limit: 100, ...(after ? { after } : {}),
    }, 6_000);
    for (const page of result.data) {
      if (/^\d{1,32}$/.test(page.id) && page.name && page.tasks?.some((task) => task === "CREATE_CONTENT" || task === "MANAGE")) {
        const picture = page.picture?.data;
        const photo = picture?.url && !picture.is_silhouette ? URL.parse(picture.url) : null;
        pages.set(page.id, { id: page.id, name: page.name,
          ...(photo?.protocol === "https:" && !photo.username && !photo.password ? { photo: photo.href } : {}) });
      }
    }
    const next = result.paging?.next ? result.paging.cursors?.after : undefined;
    if (result.paging?.next && (!next || cursors.has(next))) throw new Error("Facebook Page pagination stalled");
    if (next) cursors.add(next);
    after = next;
  } while (after);
  return Array.from(pages.values());
}

export async function tiktokCreator(key: string, account: string, user: string) {
  const result = await executeSocialTool<{
    data?: { creator_username?: string; creator_nickname?: string; privacy_level_options?: string[]; max_video_post_duration_sec?: number;
      comment_disabled?: boolean; duet_disabled?: boolean; stitch_disabled?: boolean };
    error?: { code?: string };
  }>(key, account, user, "TIKTOK_QUERY_CREATOR_INFO", {});
  if (result.error?.code && result.error.code !== "ok") throw new Error("TikTok creator lookup failed");
  if (!result.data?.creator_username || !Array.isArray(result.data.privacy_level_options)) throw new Error("TikTok creator is unavailable");
  return { username: result.data.creator_username, nickname: result.data.creator_nickname ?? result.data.creator_username,
    options: result.data.privacy_level_options, maxDuration: result.data.max_video_post_duration_sec ?? 0,
    disabled: { comment: Boolean(result.data.comment_disabled), duet: Boolean(result.data.duet_disabled), stitch: Boolean(result.data.stitch_disabled) } };
}

export async function sendTikTok(key: string, account: string, user: string, caption: string, visibility: string, url: string, settings: string | null) {
  const creator = await tiktokCreator(key, account, user);
  if (!creator.options.includes(visibility)) throw new Error("TikTok privacy choice is no longer available");
  const options = JSON.parse(settings ?? "{}");
  if (!(Number(options.duration)>0 && Number(options.duration)<=creator.maxDuration)) throw new Error("TikTok video duration is no longer eligible");
  if ((options.allowComment && creator.disabled.comment) || (options.allowDuet && creator.disabled.duet) ||
      (options.allowStitch && creator.disabled.stitch)) throw new Error("TikTok interaction options changed");
  const response = await executeSocialTool<{ data?: { publish_id?: string }; publish_id?: string; error?: { code?: string } }>(
    key, account, user, "TIKTOK_PUBLISH_VIDEO", {
      video_url: url, caption, privacy_level: visibility, disable_duet: !options.allowDuet, disable_stitch: !options.allowStitch,
      disable_comment: !options.allowComment, brand_organic_toggle: options.brandOrganic === true,
      brand_content_toggle: options.brandContent === true, is_aigc: options.aiGenerated === true,
    });
  const id = response.data?.publish_id ?? response.publish_id;
  if (!id || (response.error?.code && response.error.code !== "ok")) throw new Error("TikTok did not return a publish receipt");
  return { pending: id };
}

export async function checkTikTokReceipt(key: string, account: string, user: string, id: string) {
  const result = await executeSocialTool<{ data?: { status?: string; publicaly_available_post_id?: (string | number)[] }; error?: { code?: string } }>(
    key, account, user, "TIKTOK_FETCH_PUBLISH_STATUS", { publish_id: id });
  if (result.error?.code && result.error.code !== "ok") throw new Error("TikTok status unavailable");
  return result.data;
}

export class ComposioRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("Composio request failed");
    this.name = "ComposioRequestError";
    this.status = status;
  }
}

export async function composio<T>(key: string, path: string, body?: object, timeoutMs = 20_000): Promise<T> {
  const response = await fetch(api + path, {
    method: body ? "POST" : "GET",
    headers: { "x-api-key": key, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new ComposioRequestError(response.status);
  return response.json();
}

export async function publishThread(key: string, account: string, user: string, text: string, options?: string | null) {
  const settings = JSON.parse(options ?? "{}");
  const result = await composio<{ status?: number; data?: { id?: string } }>(key, "/tools/execute/proxy", {
    connected_account_id: account,
    user_id: user,
    endpoint: "https://graph.threads.net/v1.0/me/threads",
    method: "POST",
    parameters: [
      { in: "query", name: "text", value: text },
      { in: "query", name: "media_type", value: "TEXT" },
      { in: "query", name: "auto_publish_text", value: "true" },
      ...(settings.topic ? [{ in: "query", name: "topic_tag", value: settings.topic }] : []),
      ...(settings.replyControl ? [{ in: "query", name: "reply_control", value: settings.replyControl }] : []),
    ],
  });
  if (typeof result.status !== "number" || result.status < 200 || result.status >= 300 ||
      typeof result.data?.id !== "string" || !result.data.id) throw new Error("Unconfirmed Threads publication");
  return result.data.id;
}
