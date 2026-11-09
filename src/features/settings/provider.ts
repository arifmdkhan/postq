import { isIP } from "node:net";

const defaultHosts = "api.openai.com,api.anthropic.com,generativelanguage.googleapis.com,api.groq.com,openrouter.ai,api.together.xyz,integrate.api.nvidia.com,api.deepseek.com,api.mistral.ai";

export function providerBaseURL(value: string, allowedHosts = process.env.POSTQ_AI_ALLOWED_HOSTS || defaultHosts) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".") || url.port ||
      !allowedHosts.split(",").map((item) => item.trim().toLowerCase()).includes(host) ||
      ["localhost", ".localhost", ".local", ".internal", ".test"].some((suffix) => host === suffix || host.endsWith(suffix))) {
    throw new Error("Use an HTTPS endpoint on a server-approved host (POSTQ_AI_ALLOWED_HOSTS), without credentials, ports, or query parameters.");
  }
  return url.href.replace(/\/$/, "");
}

export type Provider = {
  id: string; name: string; kind: "openai" | "anthropic" | "openai-compatible"; base_url: string | null;
  secret: string; models: string; enabled: number; is_default: number; tested_at: number | null;
};

export type AIModel = {
  id: string; provider_id: string; model_id: string; label: string;
  enabled: number; is_default: number; tested_at: number | null; created_at: number;
};

export function modelIds(value: unknown) {
  return [...new Set(String(value ?? "").split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
}
export function validModelIds(ids: string[]) {
  return ids.length > 0 && ids.length <= 100 && ids.every((id) => id.length <= 200 && /^[A-Za-z0-9][A-Za-z0-9_.:/@+-]*$/.test(id));
}
