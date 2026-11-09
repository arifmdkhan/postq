import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function mediaBucket() {
  return (await getCloudflareContext({ async: true })).env.MEDIA;
}


