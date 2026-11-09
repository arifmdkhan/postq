import { maxBytes, mediaTypes } from "./formats";
import { clientThumbnail } from "./client-thumbnail";

export async function uploadMediaFile(file: File, folder = "", allowed = mediaTypes) {
  if (!file.size || file.size > maxBytes) throw new Error("Choose a file up to 10 MiB.");
  if (!allowed.includes(file.type)) throw new Error("Choose a file in one of the listed formats.");
  const body = new FormData();
  body.set("file", file);
  body.set("folder", folder);
  const thumbnail = await clientThumbnail(file);
  if (thumbnail && thumbnail.size<=256*1024) body.set("thumbnail",thumbnail,"thumbnail.jpg");
  const response = await fetch("/api/media", { method: "POST", body, headers: { accept: "application/json" }, redirect: "error" });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok || !result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string") {
    const message = result && typeof result === "object" && "error" in result && typeof result.error === "string"
      ? result.error : "Upload failed.";
    throw new Error(message);
  }
  return { id: result.id, name: file.name.trim().slice(0, 160) || "Media", mime: file.type };
}
