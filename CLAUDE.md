# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A personal CV/resume site: a React 19 + TypeScript + Vite SPA served by **Cloudflare Pages**, with a small set of **Pages Functions** (`functions/api/*.ts`) as the backend and a **Workers KV** namespace (`CV_DATA`) as the only datastore. The CV content is editable at runtime through an admin page protected by **Cloudflare Access**, so content changes do not require a redeploy.

## Commands

```bash
npm run dev       # Vite dev server only (HMR). /api/* does NOT exist here.
npm run build     # tsc -b && vite build  -> dist/
npm run lint      # eslint . (flat config, ts/tsx only, ignores dist)
npm test          # vitest run: tests/**/*.test.ts (functions/twin logic, plain Node, no network)
npm run typecheck:functions   # tsc -p tsconfig.functions.json (also part of `npm run build`)
npm run preview   # vite preview of dist (also without /api/*)
```

To exercise the backend (admin save, KV reads) run the built app through Wrangler, which serves `dist/` plus `functions/` and a local KV. Admin routes need either a real Access JWT or the local-only bypass:

```bash
cp .dev.vars.example .dev.vars        # git-ignored; sets ALLOW_INSECURE_LOCAL_AUTH=true
npm run build && npx wrangler pages dev dist
```

Run one test file with `npx vitest run tests/twin/handler.test.ts` (or `-t "name"`). Only the digital twin backend has tests so far; verify other changes with `npm run build` (type-checks the app and `functions/`) and `npm run lint`. To try the twin locally see `docs/digital-twin-ops.md` (mock OpenRouter plus `wrangler pages dev dist --d1 TWIN_DB`).

## Architecture

**Frontend (`src/`)** — `main.tsx` mounts `App.tsx`, which owns routing (`/`, `/admin`; `/login` just redirects to `/admin`) and the theme. `/admin` is wrapped in `RequireAuth`, which calls `GET /api/admin/verify` and shows an "Access denied" screen when it is not OK (sign-in itself is done by Cloudflare Access in front of the page). All network calls go through `src/utils/api.ts`; the admin calls use `redirect: 'manual'` because an unauthenticated Access request is answered with a redirect.

**Data model** — a single `CVData` object (`src/utils/types.ts`) holding profile, experience, education, skills, languages, certifications and contact. It is stored as one JSON blob in KV under the key `cv_content`. `Admin.tsx` edits the whole object and POSTs it back in full (no partial updates). `INITIAL_CV_DATA` in `types.ts` is the seed/fallback: `fetchCVData()` returns it on a 404 *or any fetch error*, so the public page still renders when KV is empty or the API is down. To change the default CV content, edit `INITIAL_CV_DATA`; to change live content, use `/admin`.

**Backend (`functions/`)** — public `GET /api/content` (`functions/api/content.ts`, read-only) and the admin API under `functions/api/admin/` (`content` POST = save, `verify` GET). `functions/api/[[path]].ts` is a catch-all returning a JSON 404 so unknown `/api/*` paths never fall through to the SPA's `index.html`. Shared code lives in `functions/_lib/common.ts` (it exports no `onRequest*` handler, so it is not a route). The KV binding is declared in `wrangler.toml`. `functions/` (and `tests/`) are type-checked by `tsconfig.functions.json` with `@cloudflare/workers-types`; `functions/` may import pure modules from `src/utils/types.ts` (the built-in CV fallback) but nothing DOM-related.

**Admin auth (read before touching it)** — Cloudflare Access authenticates the user in front of `/admin*` and `/api/admin/*`; the app then **re-verifies** the signed `Cf-Access-Jwt-Assertion` itself (`authenticate()` in `functions/_lib/common.ts`: RS256 pinned, signing keys from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` built only from config, `iss`/`aud`/`exp`/`nbf` checked, keys cached with rate-limited refresh). Everything under `/api/admin/` is guarded by one `functions/api/admin/_middleware.ts` (authentication, plus a CSRF guard requiring same-origin `Origin` and `application/json` on non-GET), so a new admin route cannot forget auth: **put admin endpoints in that folder, never elsewhere**. It fails closed if `ACCESS_TEAM_DOMAIN` (`<team>.cloudflareaccess.com`) or `ACCESS_AUD` is unset; both are public identifiers set under `[vars]` in `wrangler.toml`. They are deliberately **not** named `CF_ACCESS_*`: the Pages dashboard holds locked, undeletable entries with those names, and redeclaring them in `[vars]` fails the deployment ("Binding name ... already in use"). Never reuse a variable name that exists in the dashboard. There are no passwords, cookies or login endpoints any more. `ALLOW_INSECURE_LOCAL_AUTH=true` (in git-ignored `.dev.vars`) bypasses Access for localhost requests only, and is ignored for any request carrying `CF-Ray`. Setup, clean-up and troubleshooting: `docs/admin-access-setup.md`. Pitfalls: every older Pages deployment stays live at its own `*.pages.dev` URL, so never "Rollback" to a pre-Access deployment; `wrangler.toml` still sets `preview_id` equal to the production KV `id`, so a remote preview run writes to production data.

**Digital twin (AI chat)** — a floating avatar (`src/components/twin/TwinLauncher.tsx`, mounted once in `Home.tsx`, public route only) opens a native `<dialog>` (`TwinDialog.tsx`, a lazy chunk fetched on hover/focus/click). Quick answers in `starters.ts` are client-side and cost no quota; free-text goes to the **public** `POST /api/chat` (`functions/api/chat.ts` -> `functions/_lib/twin/handler.ts`) which calls **OpenRouter `:free` models only** (non-streaming). `GET /api/chat/status` decides whether the avatar renders at all: it is invisible unless `TWIN_ENABLED=true` and every required setting exists (fails closed). The chat endpoint is public, so it carries its own abuse controls (allowed-host check, same-origin JSON, Turnstile + HMAC session, per-IP and global caps in D1, "resting" circuit when the free quota is gone) and must **never** be placed under `functions/api/admin/`. Rules to keep: only `:free` model ids (`config.ts` enforces it); CV data passes the allow-list in `cv.ts` (no phone, street address, photo, ids); CV/FAQ text is escaped inside the prompt; answers are rendered as plain text; never log message text or raw IPs. Setup, settings table, kill switch and SOPs: `docs/digital-twin-ops.md`; design and decisions: `planning/PLAN.md`. The D1 binding `TWIN_DB` is intentionally not in `wrangler.toml` until the owner creates the database (a placeholder id would break deploys); tables are created automatically.

**Theming** — two themes, `modern` (default, light/dark) and `custom` (classic, print-oriented), applied as `data-theme` on `<html>` and driven by CSS custom properties in `src/styles/index.css` (the only stylesheet). Theme resolution order: `?theme=` query param → `localStorage.theme` → `modern`. `Home.tsx` renders two entirely separate layouts (`CustomLayout`: sidebar CV layout; `ModernLayout`: stacked sections), so any change to CV content rendering must be made in **both**. User-editable URLs must be rendered through `ExternalLink` / `safeHref` (http(s) only), never straight into an `href`. The app `Header` carries `no-print`; the print stylesheet no longer hides every `<header>` because the modern layout's profile block is one. The Share modal's QR code encodes the current URL with `?theme=`. Design tokens and component class conventions (`.btn`, `.card`, `.form-input`, `@media print`) are documented in `.agent/skills/ui_ux/SKILL.md`; use the CSS variables rather than hardcoded colours.

## Repo notes

- `.wrangler/` (local KV state and bundler temp output) is git-ignored and was removed from the index; its history still contains an old local KV database (see `REPORT.md` S-3). Never commit it, and never commit `.dev.vars`.
- The Python scripts at the repo root and `assets/extract_docx.py` (`dump_docx*.py`, `extract_*.py`, `analyze_layout.py`, `inspect_docx_styles.py`) are one-off helpers used to pull content out of the original `.docx` CV (they need `python-docx`). `cv_content_dump.txt` is their output. They are not part of the app or build.
- CV text fields are rendered as plain text (`white-space: pre-line`), never as HTML; there is no sanitiser dependency, so do not introduce `dangerouslySetInnerHTML` without adding one.
- `REPORT.md` holds the latest code review: finding status, remaining security findings, dependency advisories and recommended follow-ups.
- The README is the unmodified Vite template and carries no project-specific information.
