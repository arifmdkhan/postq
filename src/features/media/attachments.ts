export const maxAttachments = 35;
const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;

// Read old single-attachment drafts and requests without discarding their media.
export function attachmentIds(value: unknown): string[] {
  if (value === undefined || value === null || value === "") return [];
  const parsed = typeof value === "string" && value.startsWith("[") ? JSON.parse(value) : value;
  const ids = typeof parsed === "string" ? [parsed] : parsed;
  if (!Array.isArray(ids) || ids.length > maxAttachments || ids.some(id => typeof id !== "string" || !uuid.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("Choose up to 35 distinct media files.");
  }
  return ids;
}

export function publicationMediaIds(post: {media_ids?: string | null; media_id?: string | null}) {
  const ids = attachmentIds(post.media_ids);
  return ids.length ? ids : attachmentIds(post.media_id);
}

export type Attachment = {id:string; name:string; mime:string; metadata?:string|null; bytes?:number};
