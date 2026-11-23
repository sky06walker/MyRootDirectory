# MyRootDirectory

Personal CV site of Chong Wei Hon: a public, printable CV, an admin page to edit it without redeploying, and an "Ask me" digital twin (a floating avatar that answers questions about the CV).

- **Live:** https://myrootdirectory.pages.dev
- **Stack:** React 19 + TypeScript + Vite (SPA) on **Cloudflare Pages**; Pages Functions as the backend (`functions/`); Workers KV for the CV data, D1 for the twin's rate limits and audit trail; Cloudflare Access protects the admin page; the twin calls an AI provider (OpenRouter free models by default).

## Quick start

```bash
npm ci
npm run dev                 # UI only (no /api)
npm run build               # type-checks the app and functions, then builds dist/
npm run lint
npm test                    # unit/function tests (no network)

# run the real backend locally (KV, D1, admin bypass) with a fake AI provider:
cp .dev.vars.example .dev.vars
node scripts/mock-openrouter.mjs                              # terminal 1
npm run build && npx wrangler pages dev dist --d1 TWIN_DB     # terminal 2
```

## What lives where

| Path | What |
|---|---|
| `src/` | The SPA: public CV (`pages/Home.tsx`, two themes), admin (`pages/Admin.tsx`, lazy-loaded), digital twin widget (`components/twin/`) and its admin card (`components/admin/TwinSettings.tsx`) |
| `functions/` | Pages Functions: public `GET /api/content`, public `POST /api/chat` and `GET /api/chat/status`, public avatar, and everything under `api/admin/` (guarded by one Cloudflare Access middleware) |
| `tests/` | Vitest tests for the twin backend and the Access sign-in check |
| `wrangler.toml` | Bindings (KV, D1) and the public settings; secrets are **not** here |
| `docs/` | Setup and operations guides |
| `planning/PLAN.md` | Design, decisions and implementation status of the digital twin |
| `REPORT.md` | Code/security review: finding status and open follow-ups |
| `CLAUDE.md` | Architecture and the rules to keep (read this before changing code) |

## Documentation

- **`CLAUDE.md`**: architecture, auth model, twin rules, theming, repo notes.
- **`docs/admin-access-setup.md`**: Cloudflare Access setup, clean-up, troubleshooting.
- **`docs/digital-twin-ops.md`**: twin settings, one-time setup, day-to-day operations, kill switch, local development.
- **`planning/PLAN.md`** and **`REPORT.md`**: why things are the way they are, and what is still open.

## Deploying

Pushing to `main` makes Cloudflare Pages build (`npm run build`) and deploy. Public settings and bindings live in `wrangler.toml`; secrets (`TWIN_CONFIG_ENC_KEY`, `TWIN_HMAC_SECRET`, `TURNSTILE_SECRET_KEY`) live only in the Pages dashboard as type Secret. Never reuse a variable name that already exists in the dashboard (the deployment fails with "Binding name ... already in use"), and never roll back to a deployment from before the Cloudflare Access change.
