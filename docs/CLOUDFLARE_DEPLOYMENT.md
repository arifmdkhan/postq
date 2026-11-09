# Deploy PostQ to Cloudflare Workers

PostQ uses OpenNext, a D1 database (`DB`), a private R2 bucket (`MEDIA`), static assets and a minute cron. Use Node 22.23.4 and pnpm 12.5.1. Build on Linux, Cloudflare Builds, or inside the WSL Linux filesystem; the qualified production build uses Linux rather than native Windows.

## 1. Create the hosted resources

From the project directory:

```sh
pnpm install --frozen-lockfile
pnpm exec wrangler login
pnpm exec wrangler d1 create postq
pnpm exec wrangler r2 bucket create postq-media
```

For an existing installation, use its existing resources instead. Back up D1, R2 and stable secrets before upgrading. Local development data is not uploaded by deployment.

In `wrangler.jsonc`, replace the all-zero `database_id` with the ID printed by D1 creation. Match `database_name` and `bucket_name` to your resources. Preserve `DB`, `MEDIA`, the custom `worker.mjs` entrypoint, assets, Node compatibility and cron settings.

Add a `vars` object with your actual public HTTPS origin:

```json
"vars": {
  "BETTER_AUTH_URL": "https://postq.YOUR-SUBDOMAIN.workers.dev",
  "POSTQ_PUBLISHING_PAUSED": "yes"
}
```

Replace the example with your real workers.dev address or configured custom domain. This origin also supplies the MCP endpoint and Google callback address. Keep publishing paused during setup and recovery checks.

## 2. Store secrets

```sh
pnpm exec wrangler secret put BETTER_AUTH_SECRET
pnpm exec wrangler secret put POSTQ_ENCRYPTION_KEY
pnpm exec wrangler secret put POSTQ_BOOTSTRAP_TOKEN
```

Enter a different random value of at least 32 characters for each prompt. Generate values locally, for example with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep stable session/encryption keys backed up; never commit them. If Wrangler offers to create the named Worker before its first deployment, confirm that it is your intended Worker.

## 3. Verify and deploy

```sh
pnpm check
pnpm preview:cloudflare
```

Preview builds the actual Worker, applies local migrations and runs local bindings with publishing paused. Configure local preview auth variables separately in an ignored `.dev.vars` file; use its local origin, not the hosted URL. Stop preview before rebuilding the same artifact.

```sh
pnpm deploy:cloudflare
```

Deployment builds OpenNext, applies all pending migrations to the configured remote D1, then deploys the Worker and assets. The checked-in all-zero database ID must be replaced first. This command performs remote writes; a successful local preview alone does not establish hosted qualification.

For Cloudflare's Git-connected Workers Builds, use build command `pnpm build:cloudflare` and deploy command `pnpm exec wrangler d1 migrations apply DB --remote && pnpm exec wrangler deploy`. Configure Node/pnpm versions and runtime variables/secrets for that Worker, and grant the build token access to the intended D1/R2/Worker resources. CI already runs the same Worker build and local runtime smoke check.

## 4. Finish first-owner setup

Open the hosted `/login`, create the owner with the bootstrap token, then remove `POSTQ_BOOTSTRAP_TOKEN`. Add providers and accounts through Settings. Register the displayed Google callback if enabling Google login. Confirm the MCP address uses your public origin. Check media, headers, authentication and scheduler health before changing `POSTQ_PUBLISHING_PAUSED` to `no` and redeploying. Qualify real provider sends with approved test accounts.

See [operations and recovery](OPERATIONS.md) for upgrades and restore procedures. Sources: [OpenNext setup](https://opennext.js.org/cloudflare/get-started), [Wrangler D1 commands](https://developers.cloudflare.com/workers/wrangler/commands/d1/), [Wrangler R2 commands](https://developers.cloudflare.com/workers/wrangler/commands/r2/).
