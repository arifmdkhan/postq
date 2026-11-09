"use server";
import { runtimeConfiguration } from "@/features/settings/configuration";


import { requireUser } from "@/server/auth";
import { composio, ComposioRequestError } from "@/features/publishing/composio";

export async function checkComposio(): Promise<{ project: string; threads: string }> {
  await requireUser();

  const { COMPOSIO_API_KEY: key, COMPOSIO_AUTH_CONFIG_THREADS: config } = await runtimeConfiguration();
  if (!key) return { project: "Add COMPOSIO_API_KEY to enable account connections.", threads: "" };
  try {
    await composio(key, "/tools?limit=1");
  } catch (error) {
    return {
      project: error instanceof ComposioRequestError && error.status === 401
        ? "Composio rejected the key. Use an API key from your Platform project."
        : "PostQ could not verify the project key. Check the key permissions and try again.",
      threads: "",
    };
  }
  if (!config) return { project: "Platform project key accepted.", threads: "Threads setup is optional." };
  try {
    const result = await composio<{
      toolkit?: { slug?: string }; status?: string; is_composio_managed?: boolean; auth_scheme?: string;
    }>(key, "/auth_configs/" + encodeURIComponent(config));
    return {
      project: "Platform project key accepted.",
      threads: result.toolkit?.slug === "threads" && result.status === "ENABLED" &&
        result.is_composio_managed === false && result.auth_scheme === "OAUTH2"
        ? "Threads OAuth config verified."
        : "Choose an enabled custom Threads OAuth2 config.",
    };
  } catch {
    return { project: "Platform project key accepted.", threads: "Threads config could not be verified in this project." };
  }
}

