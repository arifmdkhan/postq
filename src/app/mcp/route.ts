import { createMcpHandler } from "@modelcontextprotocol/server";
import { database } from "@/server/db";
import { authenticateMCP, allowMCPRequest } from "@/features/mcp/access";
import { MCPService } from "@/features/mcp/service";
import { postqMCPServer } from "@/features/mcp/server";
import { runtimeConfiguration } from "@/features/settings/configuration";
import { listFacebookPages, listPinterestDestinations } from "@/features/publishing/composio";

export async function POST(request: Request) {
  const site = process.env.BETTER_AUTH_URL;
  if (!site) return new Response("MCP endpoint is not configured.", { status: 503 });
  const origin = new URL(site).origin;
  if (new URL(request.url).origin !== origin || (request.headers.has("origin") && request.headers.get("origin") !== origin)) return new Response("Forbidden origin.", { status: 403 });
  const db = await database();
  const access = await authenticateMCP(db, request.headers.get("authorization"));
  if (!access) return new Response("Create an MCP access token in PostQ Settings → Integrations and configure it as a Bearer token.", {
    status: 401, headers: { "WWW-Authenticate": 'Bearer realm="PostQ MCP"', "Cache-Control": "no-store" },
  });
  if (!await allowMCPRequest(db, access)) return new Response("Request limit reached or access revoked.", { status: 429, headers: { "Retry-After": "60" } });
  const service = new MCPService(db, access, origin);
  const handler = createMcpHandler(() => postqMCPServer(service, async (id, board) => {
    const channel = await service.getChannel(id);
    const key = (await runtimeConfiguration()).COMPOSIO_API_KEY;
    if (!key) throw new Error("Configure Composio in PostQ Settings.");
    if (channel.platform === "facebook") return { pages: await listFacebookPages(key, channel.remote_id, access.user_id) };
    if (channel.platform === "pinterest") return { [board ? "sections" : "boards"]: await listPinterestDestinations(key, channel.remote_id, access.user_id, board) };
    return { message: "This account has no Page/board destination picker. See list_channels for media rules and use the approval composer for provider settings." };
  }), { maxRequestBodySize: 65536 });
  const response = await handler.fetch(request);
  response.headers.set("Cache-Control", "no-store, no-transform");
  return response;
}

// All tools are request/response operations; no background notification streams or stateful sessions.
export function GET() { return new Response("Use POST with Streamable HTTP and a PostQ Bearer token.", { status: 405, headers: { Allow: "POST" } }); }
export function DELETE() { return new Response(null, { status: 405, headers: { Allow: "POST" } }); }
