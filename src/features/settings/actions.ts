"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { generateText } from "ai";
import { requireUser, auth } from "@/server/auth";
import { database } from "@/server/db";
import { strongPassword } from "@/server/password";
import { decryptSetting, encryptSetting } from "./encryption";
import { runtimeConfiguration, integrationNames, saveIntegrationValues, type IntegrationName } from "./configuration";
import { discoverModels, modelRecords, providerRecords } from "./providers";
import { validModelIds, providerBaseURL, type Provider } from "./provider";
import { applyWorkerBindings } from "./cloudflare";
import { providerModel } from "@/features/assistant/model";
import { validTimezone } from "@/features/publishing/timezone";
import { synchronizeLocalTimezone, writeTimezonePreference } from "./timezone-preferences";

export type SettingsResult = { message: string; error?: boolean; models?: string[] };

export async function saveTimezone(_previous: SettingsResult, form: FormData): Promise<SettingsResult> {
  await requireUser();
  const timezone = form.get("timezone");
  if (!validTimezone(timezone)) return { message: "Enter a valid IANA timezone, such as Asia/Kolkata.", error: true };
  const db = await database();
  await writeTimezonePreference(db,timezone,form.get("mode")==="auto"?"auto":"manual");
  revalidatePath("/dashboard", "layout");
  return { message: "Workspace timezone saved. Reopen any composition to use the new timezone." };
}

export async function detectLocalTimezone(timezone:string) {
  await requireUser();
  const result=await synchronizeLocalTimezone(await database(),timezone);
  if(result.changed)revalidatePath("/dashboard","layout");
  return result;
}

export async function saveIntegrations(_previous: SettingsResult, form: FormData): Promise<SettingsResult> {
  await requireUser();
  const current = await runtimeConfiguration();
  const section = form.get("section");
  const names: readonly IntegrationName[] = section === "google" ? ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] :
    section === "composio" ? ["COMPOSIO_API_KEY", "COMPOSIO_AUTH_CONFIG_THREADS", "COMPOSIO_AUTH_CONFIG_TIKTOK", "COMPOSIO_AUTH_CONFIG_TWITTER"] : [];
  if (!names.length) return { message: "Choose a configuration section.", error: true };
  const saved = Object.fromEntries(integrationNames.map((name) => [name, current[name] ?? ""]));
  for (const name of names) {
    const value = String(form.get(name) ?? "").trim();
    if (value.length > 4096 || /[\r\n]/.test(value)) return { message: "Check the credential format.", error: true };
    if (value) saved[name] = value;
  }
  if (section === "google" && form.get("disable") === "yes") {
    const owner = await requireUser();
    const db = await database();
    const password = await db.prepare("SELECT id FROM account WHERE userId = ? AND providerId = 'credential' AND password IS NOT NULL").bind(owner.id).first();
    if (!password) return { message: "Set an email/password login before disabling Google.", error: true };
    saved.GOOGLE_CLIENT_ID = ""; saved.GOOGLE_CLIENT_SECRET = "";
  } else if (section === "google") {
    if (!saved.GOOGLE_CLIENT_ID.endsWith(".apps.googleusercontent.com") || !saved.GOOGLE_CLIENT_SECRET) return { message: "Enter the Google web client ID and client secret.", error: true };
  }
  await saveIntegrationValues(Object.fromEntries(names.map((name) => [name, saved[name]])));
  revalidatePath("/dashboard", "layout"); revalidatePath("/login");
  return { message: section === "google" ? "Google sign-in settings saved. Test sign-in while keeping this session open." : "Composio settings saved." };
}

export async function testComposioSettings(): Promise<SettingsResult> {
  await requireUser();
  const { COMPOSIO_API_KEY: key } = await runtimeConfiguration();
  if (!key) return { message: "Save a Composio API key first.", error: true };
  try {
    const response = await fetch("https://backend.composio.dev/api/v3/tools?limit=1", { headers: { "x-api-key": key }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000) });
    return response.ok ? { message: "Composio accepted the project key." } : { message: "Composio rejected the key or its permissions.", error: true };
  } catch { return { message: "Couldn’t reach Composio.", error: true }; }
}

export async function saveProvider(id: string | null, _previous: SettingsResult, form: FormData): Promise<SettingsResult> {
  await requireUser();
  const db = await database();
  const existing = id ? (await providerRecords()).find((provider) => provider.id === id) : null;
  if (id && !existing) return { message: "Provider unavailable.", error: true };
  const kind = String(form.get("kind"));
  const name = String(form.get("name") ?? "").trim();
  const key = String(form.get("key") ?? "").trim();
  if (!["openai", "anthropic", "openai-compatible"].includes(kind) || !name || name.length > 80 ||
      (!key && !existing) || key.length > 4096 || /[\r\n]/.test(key)) return { message: "Enter a connection name, provider, and API key.", error: true };
  let base: string | null = null;
  try { if (kind === "openai-compatible") base = providerBaseURL(String(form.get("base") ?? "")); }
  catch { return { message: "Use an HTTPS base URL on a host approved in the server's POSTQ_AI_ALLOWED_HOSTS setting.", error: true }; }
  if (existing && (existing.kind !== kind || existing.base_url !== base) && !key) return { message: "Enter an API key again when changing the provider or endpoint.", error: true };
  const providerId = id ?? crypto.randomUUID();
  const enabled = form.get("enabled") === "yes" ? 1 : 0;
  await db.batch([
    db.prepare(`INSERT INTO ai_providers (id,name,kind,base_url,secret,enabled,updated_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,base_url=excluded.base_url,
      secret=excluded.secret,enabled=excluded.enabled,tested_at=NULL,updated_at=excluded.updated_at`)
      .bind(providerId, name, kind, base, key ? encryptSetting(key) : existing!.secret, enabled, Date.now()),
    db.prepare("UPDATE ai_models SET tested_at=NULL, is_default=CASE WHEN ?=0 THEN 0 ELSE is_default END WHERE provider_id=?")
      .bind(enabled, providerId),
  ]);
  revalidatePath("/dashboard", "layout");
  return { message: existing ? "Provider updated." : "Provider connected. Add a model to start using it." };
}

export async function discoverProvider(id: string | null, form?: FormData): Promise<SettingsResult> {
  await requireUser();
  let provider: Pick<Provider, "kind" | "secret" | "base_url"> | undefined;
  if (id) provider = (await providerRecords()).find((item) => item.id === id);
  else if (form) {
    const kind = String(form.get("kind"));
    const key = String(form.get("key") ?? "").trim();
    if (!["openai", "anthropic", "openai-compatible"].includes(kind) || !key || key.length > 4096 || /[\r\n]/.test(key)) return { message: "Enter the provider type and API key first.", error: true };
    provider = { kind: kind as Provider["kind"], secret: encryptSetting(key), base_url: String(form.get("base") ?? "") };
  }
  if (!provider) return { message: "Provider unavailable.", error: true };
  try { return { message: "Choose the models to enable, or enter their IDs manually.", models: await discoverModels(provider) }; }
  catch { return { message: "Model discovery failed. Check the credentials and endpoint, or enter model IDs manually.", error: true }; }
}

export async function providerOperation(id: string, operation: "delete" | "test"): Promise<SettingsResult> {
  await requireUser();
  const provider = (await providerRecords()).find((item) => item.id === id);
  if (!provider) return { message: "Provider unavailable.", error: true };
  const db = await database();
  if (operation === "delete") await db.prepare("DELETE FROM ai_providers WHERE id=?").bind(id).run();
  else if (operation === "test") {
    try {
      await discoverModels(provider);
      await db.prepare("UPDATE ai_providers SET tested_at=? WHERE id=?").bind(Date.now(), id).run();
    } catch { return { message: "Couldn’t verify model discovery. Check the connection or add a model manually to test chat.", error: true }; }
  } else return { message: "Choose an action.", error: true };
  revalidatePath("/dashboard", "layout");
  return { message: operation === "test" ? "Provider connection verified." : "Provider and its models removed." };
}

export async function saveModel(id: string | null, _previous: SettingsResult, form: FormData): Promise<SettingsResult> {
  await requireUser();
  const db = await database();
  const existing = id ? (await modelRecords()).find((model) => model.id === id) : null;
  if (id && !existing) return { message: "This model is no longer available.", error: true };
  const providerId = existing?.provider_id ?? String(form.get("provider") ?? "");
  const modelId = existing?.model_id ?? String(form.get("model") ?? "").trim();
  const label = String(form.get("label") ?? "").trim() || modelId;
  const enabled = form.get("enabled") === "yes" ? 1 : 0;
  if (!validModelIds([modelId]) || label.length > 200) return { message: "Enter one valid model ID and a display name of up to 200 characters.", error: true };
  const provider = (await providerRecords()).find((item) => item.id === providerId);
  if (!provider) return { message: "Choose an existing provider.", error: true };
  let result;
  if (existing) {
    result = await db.prepare("UPDATE ai_models SET label=?,enabled=?,is_default=CASE WHEN ?=0 THEN 0 ELSE is_default END WHERE id=?")
      .bind(label, enabled, enabled, id).run();
  } else {
    result = await db.prepare(`INSERT INTO ai_models(id,provider_id,model_id,label,enabled,is_default,created_at)
      SELECT ?,p.id,?,?,?,?,? FROM ai_providers p WHERE p.id=?
      ON CONFLICT(provider_id,model_id) DO NOTHING`)
      .bind(crypto.randomUUID(), modelId, label, enabled, 0, Date.now(), providerId).run();
  }
  if (!result.meta.changes) return { message: existing ? "This model changed. Reopen its settings." : "This model is already added to that provider.", error: true };
  revalidatePath("/dashboard", "layout");
  return { message: existing ? "Model updated." : "Model added." };
}

export async function modelOperation(id: string, operation: "default" | "delete" | "test" | "toggle"): Promise<SettingsResult> {
  await requireUser();
  const model = (await modelRecords()).find((item) => item.id === id);
  if (!model) return { message: "This model is no longer available.", error: true };
  const provider = (await providerRecords()).find((item) => item.id === model.provider_id);
  if (!provider) return { message: "Provider unavailable.", error: true };
  const db = await database();
  if (operation === "delete") await db.prepare("DELETE FROM ai_models WHERE id=?").bind(id).run();
  else if (operation === "default") {
    if (!model.enabled || !provider.enabled) return { message: "Enable the provider and model first.", error: true };
    await db.batch([
      db.prepare("UPDATE ai_models SET is_default=0 WHERE is_default=1"),
      db.prepare("UPDATE ai_models SET is_default=1 WHERE id=? AND enabled=1 AND EXISTS (SELECT 1 FROM ai_providers WHERE id=ai_models.provider_id AND enabled=1)").bind(id),
    ]);
  } else if (operation === "toggle") {
    await db.prepare("UPDATE ai_models SET enabled=1-enabled, is_default=CASE WHEN enabled=1 THEN 0 ELSE is_default END WHERE id=?").bind(id).run();
  } else if (operation === "test") {
    if (!model.enabled || !provider.enabled) return { message: "Enable the provider and model first.", error: true };
    try {
      await generateText({ model: providerModel(provider, model.model_id), prompt: "Reply with OK.", maxOutputTokens: 128, maxRetries: 0, abortSignal: AbortSignal.timeout(20_000) });
      await db.prepare("UPDATE ai_models SET tested_at=? WHERE id=?").bind(Date.now(), id).run();
    } catch { return { message: "Model test failed. Check its ID, provider credentials, and account access.", error: true }; }
  } else return { message: "Choose an action.", error: true };
  revalidatePath("/dashboard", "layout");
  return { message: ({ default: "Default model updated.", delete: "Model removed.", toggle: "Model availability updated.", test: "Model test passed." })[operation] };
}

export async function setOwnerPassword(_previous: SettingsResult, form: FormData): Promise<SettingsResult> {
  const user = await requireUser();
  const password = form.get("password");
  if (!strongPassword(password) || password !== form.get("confirm")) return { message: "Use a strong password and matching confirmation.", error: true };
  try {
    const db = await database();
    const existing = await db.prepare("SELECT id FROM account WHERE userId=? AND providerId='credential' AND password IS NOT NULL").bind(user.id).first();
    const server = await auth();
    if (existing) await server.api.changePassword({ headers: await headers(), body: { currentPassword: String(form.get("current") ?? ""), newPassword: password, revokeOtherSessions: true } });
    else await server.api.setPassword({ headers: await headers(), body: { newPassword: password } });
    revalidatePath("/dashboard/settings");
    return { message: "Password updated." };
  } catch { return { message: "Couldn’t update the password. Check your current password.", error: true }; }
}

export async function syncWorkerSettings(): Promise<SettingsResult> {
  await requireUser();
  const db = await database();
  const now = Date.now();
  const lock = await db.prepare(`INSERT INTO app_settings(name,value,updated_at) VALUES ('worker-sync-lock',?,?)
    ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE app_settings.updated_at < ?`)
    .bind(String(now), now, now - 120_000).run();
  if (!lock.meta.changes) return { message: "A Worker update is already running.", error: true };
  try {
    const config = await runtimeConfiguration();
    const values: Record<string, string> = Object.fromEntries(integrationNames.map((name) => [name, config[name] ?? ""]));
    const secrets = new Set(["GOOGLE_CLIENT_SECRET", "COMPOSIO_API_KEY"]);
    for (const provider of await providerRecords()) {
      const name = "POSTQ_AI_KEY_" + provider.id.replaceAll("-", "_");
      values[name] = decryptSetting(provider.secret); secrets.add(name);
    }
    await applyWorkerBindings(values, secrets);
    await db.prepare("INSERT INTO app_settings(name,value,updated_at) VALUES ('worker-sync-status','applied',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
      .bind(Date.now()).run();
    revalidatePath("/dashboard/settings");
    return { message: "Cloudflare confirmed the Worker configuration update." };
  } catch { return { message: "Worker sync wasn’t confirmed. Check the server’s Cloudflare token, account ID, Worker name, and deployment status.", error: true }; }
  finally { await db.prepare("DELETE FROM app_settings WHERE name='worker-sync-lock' AND value=?").bind(String(now)).run(); }
}
