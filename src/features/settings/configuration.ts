import { database } from "@/server/db";
import { integrationConfiguration, encryptSetting } from "./encryption";
export const integrationNames = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "COMPOSIO_API_KEY",
  "COMPOSIO_AUTH_CONFIG_THREADS", "COMPOSIO_AUTH_CONFIG_TIKTOK", "COMPOSIO_AUTH_CONFIG_TWITTER"] as const;
export type IntegrationName = typeof integrationNames[number];

export async function runtimeConfiguration(db?: D1Database): Promise<Record<string, string | undefined>> {
  const store = db ?? await database();
  const { results } = await store.prepare("SELECT name, value FROM app_settings WHERE name LIKE 'integration:%'").all<{ name: string; value: string }>();
  return integrationConfiguration(results, process.env);
}
export async function saveIntegrationValues(values: Partial<Record<IntegrationName, string>>) {
  const db = await database();
  await db.batch(Object.entries(values).map(([name, value]) => db.prepare(
    "INSERT INTO app_settings(name,value,updated_at) VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
  ).bind("integration:" + name, encryptSetting(value ?? ""), Date.now())));
}
