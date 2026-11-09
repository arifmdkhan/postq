# PostQ

A self-hosted social publishing studio for a single owner. Write drafts, organize media, plan a calendar, and review each account's content before scheduling delivery.

PostQ runs on Cloudflare Workers with Next.js, OpenNext, D1, and a private R2 bucket. Social connections use Composio. AI features use your own provider credentials.

## Features

- **Drafts and calendar:** Shared captions, account-specific variants, scheduled editing, and workspace timezone settings.
- **Media library:** Private image and video uploads, ordered attachments, per-account selections, upload progress, and failed-upload retries.
- **Publishing:** Per-account validation, delivery history, and manual review for uncertain sends to avoid automatic duplicate submissions.
- **AI assistant:** Caption help and campaign proposals with Google, OpenAI, Anthropic, or compatible endpoints.
- **Analytics:** Stored metric snapshots, account/date filters, and CSV exports. Availability depends on provider permissions.
- **MCP:** Scoped access for external assistants, including workspace reads, optional draft editing, and scheduling requests requiring approval in PostQ.
- **Owner access:** Email/password login, optional Google sign-in, and closed registration after the first owner is created.

The code includes publishing integrations for Threads, Instagram, Facebook Pages, LinkedIn, Pinterest, YouTube, and eligible TikTok Direct Post deployments. X is connection-only. Account eligibility, OAuth scopes, and provider approval determine available features. See the [media rules](docs/MEDIA_PUBLISHING_2026-11-06.md) for supported formats and attachment limits.

## Requirements

- Node.js `>=22.16.0 <25` and pnpm `12.5.1`.
- Linux or WSL for the Cloudflare production build. With WSL, keep the checkout and dependencies in the Linux filesystem.
- A Cloudflare account with Workers, D1, and R2 for hosting.
- Composio credentials for social connections. AI and Google sign-in credentials are optional.

## Local development

```sh
pnpm install --frozen-lockfile
pnpm setup:local
pnpm dev
```

Open [localhost:3000/login](http://localhost:3000/login). On a fresh checkout, setup creates an ignored `.env.local` with random session, encryption, and bootstrap secrets, then applies local D1 migrations. Existing `.env.local` or `.env` files are preserved. If one already exists, use [.env.example](.env.example) to supply missing settings before continuing.

Create the first owner using `POSTQ_BOOTSTRAP_TOKEN` from your local environment file and a strong password. Set `POSTQ_OWNER_EMAIL` before registration if you want to reserve a particular address. Remove the bootstrap token after account creation, then restart the app. Back up `POSTQ_ENCRYPTION_KEY` separately and keep it stable.

Open **Settings** to configure AI providers, Composio, and optional Google sign-in. Local D1/R2 state stays in `.wrangler/`; it is separate from hosted data. Provider callbacks and media-fetching services may require a reachable HTTPS deployment.

## Configuration

[.env.example](.env.example) lists the supported environment settings. Never commit environment files or credentials.

| Setting | Purpose |
| --- | --- |
| `BETTER_AUTH_URL` | App origin, such as `http://localhost:3000` locally or your public HTTPS origin when hosted. |
| `BETTER_AUTH_SECRET` | Stable random session/auth secret, at least 32 characters. |
| `POSTQ_ENCRYPTION_KEY` | Stable secret protecting saved integration credentials. Keep a separate backup. |
| `POSTQ_BOOTSTRAP_TOKEN` | Random token of at least 32 characters for first-owner registration; remove afterward. |
| `POSTQ_OWNER_EMAIL` | Optional reserved address for the first owner. |
| `POSTQ_PUBLISHING_PAUSED` | Set exactly `yes` to pause social mutations during setup or recovery. |
| `COMPOSIO_API_KEY` | Social connection and publishing integration. Can also be configured in Settings. |
| `AI_PROVIDER`, `AI_MODEL` | Optional environment-based AI defaults. Providers can also be configured in Settings. |

Local setup generates the three required secrets. On Cloudflare, store secrets as Worker secrets and configure the public origin as a Worker variable. Local Worker previews use an ignored `.dev.vars` file with the preview origin and local secrets.

## Deploy to Cloudflare

Follow the [deployment guide](docs/CLOUDFLARE_DEPLOYMENT.md) to create your resources and configure secrets. Replace the placeholder D1 database ID and resource names in `wrangler.jsonc`. Preserve the `DB` and `MEDIA` bindings and the cron trigger.

```sh
# Run from Linux or WSL after configuring your own Cloudflare resources.
pnpm check
pnpm preview:cloudflare
# Stop preview before deploying.
pnpm deploy:cloudflare
```

Preview builds the Worker, applies local migrations, and pauses publishing. Deployment builds the Worker, applies migrations to the configured **remote database**, and deploys code and assets. Back up an existing installation before upgrading.

Keep publishing paused until owner access, account authorization, private media, and scheduler health have been checked on your deployment. TikTok Direct Post additionally requires an eligible approved deployment and verified media URLs; enable `POSTQ_TIKTOK_DIRECT_POST=enabled` only after meeting those requirements.

## Development commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the Next.js development server with local Cloudflare bindings. |
| `pnpm setup:local` | Create fresh local environment settings if absent and apply local migrations. |
| `pnpm check` | Run ESLint, TypeScript, and regression tests. |
| `pnpm build` | Build Next.js. |
| `pnpm build:cloudflare` | Build the deployable OpenNext Worker. |
| `pnpm preview:cloudflare` | Build and run a local Worker with publishing paused. |
| `pnpm smoke` | Check a running app's landing/login pages, referenced assets, and security headers. |
| `pnpm deploy:cloudflare` | Build, migrate the configured remote D1 database, and deploy. |

Set `POSTQ_SMOKE_URL` to check an origin other than `http://localhost:3000`. After building on Linux/WSL, `bash scripts/smoke-worker.sh` checks local Worker pages/assets and a paused cron invocation. GitHub Actions runs checks, the Worker build, and this smoke test.

Local tests and smoke checks do not qualify live OAuth, provider acceptance, or production delivery. Verify those with your own authorized test accounts before relying on scheduled publishing.

## Project structure

```text
src/app/          Next.js pages, route handlers, and dashboard
src/components/   Shared UI components
src/features/     Feature logic, integrations, publishing, and MCP
src/server/       Server infrastructure and configuration
migrations/       Ordered D1 schema migrations
public/           App branding, landing-page assets, and offline fallback
scripts/          Setup, smoke checks, maintenance, and icon generation
tests/            Regression tests and synthetic fixtures
docs/             Deployment, operations, MCP, and media reference
worker.mjs        OpenNext entrypoint and scheduled publishing handler
wrangler.jsonc    Cloudflare resource bindings
```

## Documentation

- [Cloudflare deployment](docs/CLOUDFLARE_DEPLOYMENT.md)
- [Operations, backups, credential rotation, and recovery](docs/OPERATIONS.md)
- [MCP setup and access scopes](docs/mcp.md)
- [Media formats, account limits, and integration evidence](docs/MEDIA_PUBLISHING_2026-11-06.md)

Private environment files, local databases, backups, build output, browser reports, and design experiments are excluded through `.gitignore`. Keep production exports and secrets outside the repository.
