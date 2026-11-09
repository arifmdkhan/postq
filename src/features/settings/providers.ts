import { database } from "@/server/db";
import { decryptSetting } from "./encryption";
import { type AIModel, type Provider, providerBaseURL } from "./provider";

export async function providerRecords() {
  const db = await database();
  return (await db.prepare("SELECT * FROM ai_providers ORDER BY is_default DESC, updated_at DESC").all<Provider>()).results;
}

export async function modelRecords() {
  const db = await database();
  return (await db.prepare("SELECT * FROM ai_models ORDER BY is_default DESC, created_at, id").all<AIModel>()).results;
}

export async function discoverModels(provider: Pick<Provider, "kind" | "base_url" | "secret">) {
  const key = decryptSetting(provider.secret);
  const base = provider.kind === "anthropic" ? "https://api.anthropic.com/v1" : provider.kind === "openai"
    ? "https://api.openai.com/v1" : providerBaseURL(provider.base_url ?? "");
  const headers: Record<string, string> = provider.kind === "anthropic"
    ? { "x-api-key": key, "anthropic-version": "2023-06-01" } : { Authorization: "Bearer " + key };
  const ids = new Set<string>();
  let after: string | undefined;
  do {
    const path = new URL(base + "/models");
    if (after) path.searchParams.set("after_id", after);
    const response = await fetch(path, { headers, redirect: "error", signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "The provider rejected these credentials." : "Couldn’t discover models. You can enter model IDs manually.");
    const result = await response.json() as { data?: { id?: string }[]; has_more?: boolean; last_id?: string };
    if (!Array.isArray(result.data)) throw new Error("The provider didn’t return a model list. Enter model IDs manually.");
    for (const item of result.data) if (typeof item.id === "string" && item.id.length <= 200) ids.add(item.id);
    if (provider.kind !== "anthropic" || !result.has_more) break;
    if (!result.last_id || after === result.last_id || ids.size > 5000) throw new Error("Model pagination could not finish.");
    after = result.last_id;
  } while (after);
  return Array.from(ids).sort();
}
