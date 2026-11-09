import { runtimeConfiguration } from "@/features/settings/configuration";
import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { database } from "@/server/db";
import { composio } from "@/features/publishing/composio";
import { fetchChannelProfile } from "@/features/publishing/channel-avatar";

export async function GET(request: Request) {
  const user = await requireUser();
  const state = new URL(request.url).searchParams.get("state");
  const { COMPOSIO_API_KEY, BETTER_AUTH_URL } = await runtimeConfiguration();
  if (!BETTER_AUTH_URL) return new Response("Missing application URL", { status: 503 });
  const destination = new URL("/dashboard/publishing", BETTER_AUTH_URL);

  try {
    if (!state || state.length !== 36 || !COMPOSIO_API_KEY) throw new Error("Invalid connection");
    const db = await database();
    const attempt = await db.prepare(
      "SELECT remote_id, platform FROM channels WHERE user_id = ? AND state = ? AND active = 0 AND expires_at > ?",
    ).bind(user.id, state, Date.now()).first<{ remote_id: string; platform: string }>();
    if (!attempt) throw new Error("Unknown connection");
    const remoteId = attempt.remote_id;
    const account = await composio<{ id?: string; user_id?: string; status?: string; is_disabled?: boolean; toolkit?: { slug?: string } }>(
      COMPOSIO_API_KEY, "/connected_accounts/" + encodeURIComponent(remoteId),
    );
    if (account.id !== remoteId || account.user_id !== user.id || account.status !== "ACTIVE" || account.is_disabled === true ||
        account.toolkit?.slug?.toLowerCase() !== (attempt.platform === "x" ? "twitter" : attempt.platform)) throw new Error("Connection is not active");
    const profile = await fetchChannelProfile(COMPOSIO_API_KEY, remoteId, user.id, attempt.platform);
    await db.prepare("UPDATE channels SET active = 1, state = NULL, expires_at = NULL, avatar_url = ?, profile_name = ?, profile_checked_at = ? WHERE user_id = ? AND state = ? AND expires_at > ?")
      .bind(profile.avatar, profile.name, Date.now(), user.id, state, Date.now()).run();
  } catch {
    destination.searchParams.set("error", "connect");
  }
  return NextResponse.redirect(destination);
}
