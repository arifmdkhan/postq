# Manage PostQ from Claude Code or Codex

PostQ exposes a protected Streamable HTTP MCP endpoint at `/mcp`. Claude/Codex supplies the assistant; PostQ supplies workspace tools. You do not need a model API key in PostQ for this connection.

## Setup

1. Apply all database migrations and start or deploy the application. The local setup and deployment commands apply migrations to their respective databases.
2. Sign in to PostQ. Open **Settings → Integrations → Claude & Codex · MCP**.
3. Create a named access token for each client. Choose **Read workspace data**, **Read and edit drafts**, or **Read, edit drafts, and request scheduling changes**. Tokens expire after 7, 30, or 90 days.
4. Copy the token when displayed. PostQ stores only its SHA-256 hash. Set its value as `POSTQ_MCP_TOKEN` in the environment used to launch your client. Restart that client after changing its environment.
5. Copy the endpoint and client configuration from the same settings card.

Codex:

```sh
codex mcp add postq --url https://YOUR_POSTQ_HOST/mcp --bearer-token-env-var POSTQ_MCP_TOKEN
codex mcp list
```

Claude Code private MCP configuration:

```json
{
  "mcpServers": {
    "postq": {
      "type": "http",
      "url": "https://YOUR_POSTQ_HOST/mcp",
      "headers": {
        "Authorization": "Bearer ${POSTQ_MCP_TOKEN}"
      }
    }
  }
}
```

Merge the entry into your existing configuration. Do not replace unrelated MCP servers. Alternatively, configure the same URL and Bearer header through your client's MCP settings. This release uses personal access tokens; it does not implement an OAuth authorization server, so `codex mcp login postq` is not the connection flow.

Use the actual endpoint shown in Settings. A local-only PostQ endpoint works for clients on the same machine; hosted clients need a reachable HTTPS deployment. Do not expose an unauthenticated development server to the internet.

## Available tools

| Permission | Tools |
| --- | --- |
| Read | `list_channels`, `get_channel_destinations`, `list_drafts`, `get_draft`, `list_posts`, `get_post`, `list_media`, `get_request_status` |
| Draft editing | `create_draft`, `update_draft` |
| Scheduling requests | `request_schedule`, `request_reschedule_post`, `request_cancel_post` |

Draft edits take effect immediately and use version checks. Creating a draft or action request requires a stable UUID request key: retry with the same key and identical content rather than creating duplicate work. Pagination uses `offset` and returns `nextOffset`. Analytics are stored metric snapshots with capture timestamps; unavailable metrics remain absent.

Draft `plan.media` and per-account variant `media` accept ordered media-ID arrays; legacy single-ID drafts remain readable. Scheduling targets accept ordered `mediaIds`, with legacy `mediaId` retained for single-file clients. Omitting a target override inherits the draft selection; an explicit empty array clears it. Review displays every attachment in order, and approval revalidates every owner reference and account limit. `get_post` includes the stored `media_ids` JSON array alongside the first-item `media_id` cover.

Scheduling tools return a review URL and **do not queue, reschedule, or cancel a post yet**. Open that URL while signed in, review the exact saved content, accounts, attachments, provider settings, and time, then approve or reject. The client can poll `get_request_status`. Only `approved` confirms execution; a natural-language model claim is not a receipt.

## Approval and delivery boundaries

- Scheduling reuses the application's composer validation and queue insertion. The owner must approve the saved request through an authenticated browser session.
- Requests expire after one hour or when their access token expires, whichever comes first. Revoking a token blocks its outstanding approvals.
- Approval rechecks draft versions, active accounts, media ownership, provider rules, and future time. Changed or incomplete requests fail instead of silently changing the approved content.
- Approval is claimed before applying changes. Multi-account insertion is atomic, uses stable delivery IDs, and guards the request attempt. Repeated approval does not create duplicate deliveries.
- Cancel/reschedule applies only to still-queued posts with the expected original due time. Live edits/deletion, ambiguous-send reconciliation, OAuth connection changes, secrets, billing, and deployment are not exposed as MCP tools.
- Use UTC ISO minute timestamps ending in `Z` and an IANA timezone for schedule requests. Convert the requested local date/time, including DST, before submitting. The review shows local time and UTC storage.
- Platform-specific settings must be explicit. For example, choose YouTube audience and visibility; Facebook requires an authorized Page; Pinterest requires a board and supported image. Missing eligibility or provider settings can cause approval to fail. Use the normal composer if the client cannot supply the required configuration.

## Access and verification

Every POST requires a valid, unexpired owner-bound Bearer token. Cookies do not grant MCP access. Nonmatching Origin/endpoint origins are rejected, request bodies are capped, and authenticated tokens are rate-limited to 120 requests per minute. Tokens are revocable in Settings. Never pass social-provider credentials as MCP arguments.

Implemented with `@modelcontextprotocol/server@2.4.0`, using its per-request Web-standard handler and stateless compatibility for 2025-era clients. Protocol-level initialization/tool-discovery/call tests exercise the actual SDK transport. Access tests cover hashing, owner isolation, expiry, revocation, scopes, rate limiting, stale versions, immutable approval payloads, and idempotent requests. Browser checks use an isolated local database; no live social delivery is part of MCP verification.

Current client setup references: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp), [Codex developer commands](https://learn.chatgpt.com/docs/developer-commands), [Claude Code MCP](https://code.claude.com/docs/en/mcp). Server transport reference: [official Web-standard SDK guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/web-standard.md).

Local verification on 5 November 2026: all 30 regression tests passed. Browser verification exercised token creation, authenticated HTTP tool discovery/calls, draft creation, scheduling approval, replay without duplicate deliveries, reschedule and cancellation approval, stale-draft rejection, token revocation, revoked approval links, cookie-only rejection, Origin rejection, and mobile layouts. Only a fake account in an isolated local database was used. Production build was checked with two build workers because unrestricted parallel builds exhausted this Windows machine's resources. No actual Claude/Codex client profile was changed, no remote deployment was performed, and no live social-provider send was attempted.
