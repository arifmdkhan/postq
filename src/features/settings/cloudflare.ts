type Binding = { name: string; type: string; text?: string };
export function mergeWorkerBindings(existing: Binding[], values: Record<string, string>, secrets: Set<string>) {
  const updated = new Set(Object.keys(values));
  return [
    ...existing.filter(({ name }) => !updated.has(name) && !/^POSTQ_AI_KEY_[a-f0-9_]{36}$/i.test(name))
      .map(({ name }) => ({ name, type: "inherit" })),
    ...Object.entries(values).map(([name, text]) => ({ name, text, type: secrets.has(name) ? "secret_text" : "plain_text" })),
  ];
}
export async function applyWorkerBindings(values: Record<string, string>, secrets: Set<string>) {
  const { POSTQ_CLOUDFLARE_API_TOKEN: token, POSTQ_CLOUDFLARE_ACCOUNT_ID: account, POSTQ_CLOUDFLARE_WORKER: worker } = process.env;
  if (!token || !account || !worker || !/^[a-f0-9]{32}$/i.test(account) || !/^[a-z0-9_-]+$/i.test(worker)) {
    throw new Error("Configure the Cloudflare deployment connection on the server first.");
  }
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}/settings`;
  const headers = { Authorization: "Bearer " + token };
  const current = await fetch(endpoint, { headers, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const configuration = await current.json() as { success?: boolean; result?: { bindings?: Binding[] } };
  if (!current.ok || !configuration.success || !Array.isArray(configuration.result?.bindings)) throw new Error("Couldn’t read the target Worker. Check the Cloudflare connection.");
  const settings = new FormData();
  settings.set("settings", new Blob([JSON.stringify({
    bindings: mergeWorkerBindings(configuration.result.bindings, values, secrets),
  })], { type: "application/json" }));
  const response = await fetch(endpoint, { method: "PATCH", headers, body: settings, redirect: "error", signal: AbortSignal.timeout(30_000) });
  const result = await response.json() as { success?: boolean };
  if (!response.ok || !result.success) throw new Error("Cloudflare didn’t confirm the configuration update. Check the target Worker before retrying.");
}
