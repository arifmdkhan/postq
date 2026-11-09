import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function database() {
  const { env } = await getCloudflareContext({ async: true });
  return env.DB;
}
