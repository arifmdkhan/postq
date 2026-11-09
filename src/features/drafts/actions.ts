"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { isPlanningDate } from "./planning";
import { deleteDraft, getDraft, saveDraft } from "./repository";

const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;

export async function save(id: string, creating: boolean, _previous: string | null, form: FormData) {
  const user = await requireUser();
  const title = form.get("title");
  const body = form.get("body");
  const planned = form.get("plannedOn");
  const tag = form.get("tag");
  if (tag !== null && (typeof tag !== "string" || tag.trim().length > 48)) return "Enter a tag up to 48 characters.";
  if (planned !== "" && planned !== null && !isPlanningDate(planned)) return "Choose a valid planning date.";
  if (typeof creating !== "boolean" || typeof id !== "string" || !uuid.test(id) || typeof title !== "string" ||
      !title.trim() || title.trim().length > 160 || typeof body !== "string" || body.length > 10000) {
    return "Enter a title up to 160 characters and a caption up to 10,000 characters.";
  }

  const copyFrom = creating && typeof form.get("copyFrom") === "string" ? await getDraft(user.id, String(form.get("copyFrom"))) : null;
  if (creating && form.get("copyFrom") && (!copyFrom || copyFrom.updated_at !== form.get("expectedUpdatedAt"))) return "The source draft changed or was removed. Your edits are still here. Reopen Duplicate from the latest draft.";
  const result = await saveDraft(user.id, { id, title: title.trim(), body, planned_on: planned || null, tag: tag?.trim() || null,
    ...(copyFrom ? { delivery_plan: copyFrom.delivery_plan } : {}) }, creating, String(form.get("expectedUpdatedAt") ?? ""));
  if (!result.meta.changes) return "This draft changed or was removed. Your edits are still here. Copy them before reloading the latest draft.";
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/calendar");
  redirect("/dashboard?saved=1");
}

export async function remove(id: string) {
  const user = await requireUser();
  if (typeof id !== "string" || !uuid.test(id)) return;
  await deleteDraft(user.id, id);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/calendar");
  redirect("/dashboard");
}
