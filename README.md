# PostQ

<div align="center">

  <img src="https://img.shields.io/badge/Next.js-16.4.5-000000?logo=nextdotjs&logoColor=white" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers" />
  <img src="https://img.shields.io/badge/AI-Provider%20Ready-8B5CF6" alt="AI provider ready" />

  <h3>Self-hosted social publishing for operators, creators, and small teams.</h3>

  <p>
    PostQ helps you draft, organize, review, and publish content across major social platforms from one controlled workspace.
  </p>

</div>

## Overview

PostQ is a self-hosted social publishing platform designed for individual operators and small teams. It brings together content drafting, media management, calendar planning, account-specific publishing workflows, and approval-based delivery in a single workspace.

Instead of juggling disconnected tools, PostQ gives you a focused command center for planning and sending content while keeping approval, ownership, and provider access in your control.

## Why this project

- Built for people who need a private, self-hosted alternative to fragmented publishing workflows.
- Keeps account-specific messaging, review steps, and publishing history organized.
- Supports modern AI-assisted content creation while preserving operator control.
- Designed around Cloudflare + Next.js for a fast, deployable infrastructure profile.

## Core capabilities

- Draft and review content by account, campaign, or publishing window
- Organize media assets with upload tracking and account-aware selection
- Manage a calendar for scheduled publishing and campaign planning
- Keep approval-based delivery flows for higher-risk or sensitive sends
- Integrate with major social networks through connected account workflows
- Use AI to generate captions and campaign variants with multiple providers
- Keep workspace access scoped and controlled with owner-first onboarding

## Platform stack

- Frontend: Next.js, React, TypeScript
- Runtime: Cloudflare Workers + OpenNext
- Data: D1 database, R2 object storage
- Auth: Better Auth
- AI: OpenAI, Google, Anthropic, and compatible endpoints
- Integrations: Composio-based social connections

## Architecture at a glance

```text
Browser UI
  -> Next.js app
      -> PostQ server logic
          -> D1 (content, schedules, metadata)
          -> R2 (media storage)
          -> Social providers (Threads, Instagram, LinkedIn, etc.)
          -> AI providers (OpenAI / Google / Anthropic / compatible)
```

## Feature highlights

### Publishing workflow

- Drafts and variants per account
- Calendar-based planning and scheduling
- Delivery history and review before send
- Manual checks for uncertain or duplicate-prone sends

### Media library

- Private image and video uploads
- Ordered attachments and per-account media selection
- Upload progress and retry support
- Media organization for campaign reuse

### AI assistant

- Caption assistance and campaign suggestions
- Support for multiple provider backends
- Flexible account-specific publishing workflows

### Access and control

- First-owner bootstrap flow
- Optional Google sign-in
- Account ownership and closed registration after setup
- Scoped MCP access for approved external assistants

## Getting started

### Requirements

- Node.js >= 22.16.0 < 25
- pnpm 12.5.1
- Cloudflare account with Workers, D1, and R2
- Optional AI provider credentials and social connection credentials

### Local development

```bash
pnpm install --frozen-lockfile
pnpm setup:local
pnpm dev
```

Then open http://localhost:3000/login.

On a fresh checkout, the app creates a local `.env.local` file and initializes local D1 state for development.

### Production deployment

Follow the deployment guide in [docs/CLOUDFLARE_DEPLOYMENT.md](docs/CLOUDFLARE_DEPLOYMENT.md) and configure the Cloudflare resources and secrets required for a hosted deployment.

## Configuration

The repository includes a sample environment file at [.env.example](.env.example). Keep local environment data private and never commit credentials or production secrets.

Key settings include:

- `BETTER_AUTH_URL`
- `BETTER_AUTH_SECRET`
- `POSTQ_ENCRYPTION_KEY`
- `POSTQ_BOOTSTRAP_TOKEN`
- `POSTQ_OWNER_EMAIL`
- `POSTQ_PUBLISHING_PAUSED`
- `COMPOSIO_API_KEY`
- `AI_PROVIDER` and `AI_MODEL`

## Documentation

- [Cloudflare deployment](docs/CLOUDFLARE_DEPLOYMENT.md)
- [Operations and recovery](docs/OPERATIONS.md)
- [MCP setup and access scopes](docs/mcp.md)
- [Media publishing notes](docs/MEDIA_PUBLISHING_2026-11-06.md)

## Project structure

```text
src/app/          Next.js app pages and route handlers
src/components/   Shared UI components
src/features/     Features, integrations, and publishing logic
src/server/       Server-side infrastructure and configuration
migrations/       D1 schema migrations
public/           Branding and static app assets
scripts/          Setup, smoke checks, and maintenance utilities
tests/            Regression tests and fixtures
docs/             Deployment and operational documentation
worker.mjs        OpenNext worker entrypoint and scheduled tasks
wrangler.jsonc    Cloudflare bindings and deployment config
```

## Project status

This project is actively shaped around a self-hosted productivity workflow for multi-channel publishing. It is intended for personal deployment, operator workflows, and small team use cases where visibility, review, and control matter.

## License

This project does not currently declare a license file in the repository root. Review repository settings and legal requirements before production deployment or redistribution.

---

Built for focused publishing workflows, operator control, and private deployment.

