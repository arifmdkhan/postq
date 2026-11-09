import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { modelRecords, providerRecords } from "@/features/settings/providers";
import { decryptSetting } from "@/features/settings/encryption";
import { type Provider, providerBaseURL } from "@/features/settings/provider";

export function environmentModels() {
  const { AI_MODEL, AI_MODELS } = process.env;
  return [...new Set([AI_MODEL ?? "", ...(AI_MODELS ?? "").split(",")].map((id) => id.trim()).filter(Boolean))].slice(0, 20);
}
export async function configuredModels() {
  const providers = (await providerRecords()).filter((item) => item.enabled);
  const models = (await modelRecords()).filter((model) => model.enabled);
  const saved = models.flatMap((model) => {
    const provider = providers.find((item) => item.id === model.provider_id);
    return provider ? [{ id: provider.id + "::" + model.model_id, label: provider.name + " · " + model.label }] : [];
  });
  return [...saved, ...environmentModels().map((id) => ({ id, label: "Server · " + id }))];
}
export function providerModel(provider: Provider, model: string) {
  const key = decryptSetting(provider.secret);
  if (provider.kind === "anthropic") return createAnthropic({ apiKey: key })(model);
  if (provider.kind === "openai") return createOpenAI({ apiKey: key })(model);
  return createOpenAICompatible({ name: provider.id, apiKey: key, baseURL: providerBaseURL(provider.base_url ?? ""),
    fetch: (input, init) => fetch(input, { ...init, redirect: "error" }) }).chatModel(model);
}
export async function assistantModel(selection: FormDataEntryValue | null) {
  const providers = (await providerRecords()).filter((item) => item.enabled);
  const models = (await modelRecords()).filter((model) => model.enabled && providers.some((provider) => provider.id === model.provider_id));
  if (selection === null && models.length) {
    const model = models[0];
    return providerModel(providers.find((provider) => provider.id === model.provider_id)!, model.model_id);
  }
  if (typeof selection === "string" && selection.includes("::")) {
    const separator = selection.indexOf("::");
    const id = selection.slice(0, separator);
    const model = selection.slice(separator + 2);
    const provider = providers.find((item) => item.id === id);
    return provider && models.some((item) => item.provider_id === id && item.model_id === model) ? providerModel(provider, model) : null;
  }
  const allowed = environmentModels();
  const modelId = selection === null ? allowed[0] : typeof selection === "string" && allowed.includes(selection) ? selection : null;
  if (!modelId) return null;
  const { AI_PROVIDER, ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, OPENAI_API_KEY, OPENAI_COMPATIBLE_API_KEY, OPENAI_COMPATIBLE_BASE_URL } = process.env;
  if (AI_PROVIDER === "google" && GOOGLE_GENERATIVE_AI_API_KEY) return createGoogleGenerativeAI({ apiKey: GOOGLE_GENERATIVE_AI_API_KEY })(modelId);
  if (AI_PROVIDER === "openai" && OPENAI_API_KEY) return createOpenAI({ apiKey: OPENAI_API_KEY }).chat(modelId);
  if (AI_PROVIDER === "anthropic" && ANTHROPIC_API_KEY) return createAnthropic({ apiKey: ANTHROPIC_API_KEY })(modelId);
  if (AI_PROVIDER === "openai-compatible" && OPENAI_COMPATIBLE_API_KEY && OPENAI_COMPATIBLE_BASE_URL?.startsWith("https:")) {
    return createOpenAICompatible({ name: "postq", apiKey: OPENAI_COMPATIBLE_API_KEY, baseURL: providerBaseURL(OPENAI_COMPATIBLE_BASE_URL),
      fetch: (input, init) => fetch(input, { ...init, redirect: "error" }) }).chatModel(modelId);
  }
  return null;
}
