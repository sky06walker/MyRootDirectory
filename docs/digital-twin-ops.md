# Digital twin: setup and operations

A floating cartoon avatar on the public CV (`/`). Clicking it opens a dialog where visitors can use
pre-written quick answers (free, instant) or ask free-text questions answered by an AI model that only
knows your live CV. Design and decisions: `planning/PLAN.md`.

**You manage the twin from the admin page** (`/admin`, "Digital twin (AI chat)" card): on/off, avatar
picture, AI provider URL, AI model(s) and the AI API key. Only the infrastructure (database, Turnstile,
three secrets, allowed host) is set up once in Cloudflare.

**Safe by default:** nothing shows to visitors until you switch it on and everything it needs exists
(otherwise the status endpoint says `disabled` and the avatar is not rendered). If anything is missing or
broken the twin fails closed (stays off); it never quietly falls back to other settings.

**Status for this project (2026-11-23):** the D1 database `cv-twin` is bound as `TWIN_DB`, the allowed host
(`myrootdirectory.pages.dev`) and the Turnstile site key are in `wrangler.toml`, the three secrets were added
by the owner, and `/api/chat/status` reports the twin enabled. Still to do by the owner: "Test saved settings"
with the real key, second model `openrouter/free`, real test questions, approve the quick answers, fix CV
typos, add the FAQ, decide on credits (see `planning/PLAN.md`, "Revision 4").

## How a question flows

`browser -> POST /api/chat -> checks (host, origin, size, Turnstile/session, per-IP and global caps, "resting" flag) -> CV from KV + your FAQ -> prompt -> AI provider (your saved URL, model and key) -> output filter -> answer`

- Quick answers (`src/components/twin/starters.ts`) never touch the server.
- Counters live in D1 (consistent across servers). Tables are created automatically on first use.
- No conversation text is stored or logged; logs hold outcome, lengths, model and a daily-rotating
  pseudonymous client hash only.

## What the admin card controls (and how it is protected)

| Field | Rules |
|---|---|
| Show to visitors | Master switch for the twin. |
| AI provider URL | The **full chat-completions endpoint**, `https` only, a public host name (no IP addresses, no `localhost`/`.local`, no port, no query), and never this site itself. Default: `https://openrouter.ai/api/v1/chat/completions`. |
| AI model(s) | 1 to 3 ids, tried in order (only the first is used outside OpenRouter). Free-only by default: ids must end in `:free` (for example `google/gemma-4-31b-it:free`) **or** be `openrouter/free`, OpenRouter's automatic free-models router (listed price 0). The other `openrouter/*` routers (`auto`, ...) can bill and need "Allow paid models". On OpenRouter an id must look like `vendor/model`; a typo such as `openrouter:free` is rejected with a hint. |
| Allow paid models | Tick to use paid models **or any provider other than OpenRouter**. The free-only protection then no longer applies and visitor questions may cost money; set a spending limit at the provider and keep `TWIN_GLOBAL_DAILY_CAP` low. |
| AI API key | Write-only: shown only as "saved, ends in ABCD", never returned. Replace it by typing a new one, or tick "Remove". Changing the provider host removes the saved key (you must enter the key for the new provider). |
| Avatar | Any picture; the browser crops it to a square and shrinks it to 192 px (PNG/WebP, 100 KB at most). "Use the built-in avatar" goes back to the default. |

Behind the scenes:
- The settings and the encrypted key are **one** record in KV (`twin_config`), so a new URL can never be
  paired with an old key. The key is encrypted (AES-GCM) with a key derived from the `TWIN_CONFIG_ENC_KEY`
  secret and bound to the provider's origin, so a copied or edited record cannot be decrypted for another host.
  Anyone who can only read KV (dashboard viewers, exports) cannot read the key; anyone who can deploy code
  or read the Cloudflare secrets still can, so protect your Cloudflare account and use a provider-side
  spending limit.
- One source of truth: kill switch (`twin_disabled`) > saved admin settings > environment variables
  (`TWIN_ENABLED`, `TWIN_MODELS`, `OPENROUTER_API_KEY`, used only until you save settings once). If a saved
  record exists but is broken or cannot be decrypted, the twin is **off** (the admin card tells you why).
- Saves are checked against what you last saw: if the settings were changed somewhere else you get a
  "reload and try again" message instead of overwriting. Every change is written to an audit trail (D1 table
  `twin_audit` and the logs) with the field **names** and who did it, never values or the key.
- The provider is never allowed to redirect the request elsewhere, and a response bigger than about 100 KB
  is cut off. "Test saved settings" sends one tiny request (at most once per 10 seconds) and reports only
  success or a failure type, never what the provider said.
- **Links in answers are checked.** After the AI answers, every link is compared with the links really in
  your CV (LinkedIn, GitHub, website): exact matches are kept, any LinkedIn profile link the model wrote is
  replaced by yours, and every other link is replaced by "[link removed]". In the dialog, your own links in an
  answer are clickable and open exactly the address stored in the CV. Fix a wrong LinkedIn address in the CV
  data (`contact.linkedin`; the page shows `profile.url`, the "Website URL" field in the admin page).
- The avatar is stored in KV as an image named by its content hash and served from `/api/twin/avatar?h=...`
  with `nosniff` and a sandboxing CSP. Only PNG and WebP are accepted (no SVG, no JPEG metadata) and the
  file is checked by its own bytes and size.

## Settings in Cloudflare (infrastructure only)

| Name | Kind | Purpose |
|---|---|---|
| `TWIN_CONFIG_ENC_KEY` | **secret** | 32+ random characters. Encrypts the AI key saved from the admin page. Do **not** reuse `TWIN_HMAC_SECRET`; do **not** set it for Preview deployments. If you change it, the saved key can no longer be read and you enter it again. |
| `TWIN_HMAC_SECRET` | **secret** | 32+ random characters (visitor sessions, client hashing). Changing it only ends current sessions. |
| `TURNSTILE_SECRET_KEY` | **secret** | Cloudflare Turnstile secret. |
| `VITE_TURNSTILE_SITE_KEY` | build-time var | Turnstile site key (public by design). Set it in the Pages **build** environment variables or under `[vars]`. |
| `TWIN_DB` | D1 binding | Counters, the resting flag and the audit trail. |
| `TWIN_ALLOWED_HOSTS` | var | The host(s) that may call the chat, e.g. `myrootdirectory.pages.dev`. Other hosts get 403. |
| `TWIN_GLOBAL_DAILY_CAP` | var, default 45 | Requests per UTC day for the whole site. Keep below your provider's daily limit (OpenRouter: about 50 free; about 1,000 with $10 credits: verify). |
| `TWIN_IP_PER_MIN` / `TWIN_IP_PER_DAY` | var, defaults 3 / 10 | Per visitor. |
| `TWIN_DATA_COLLECTION_DENY` | var | `true` asks OpenRouter to avoid providers that collect data (may leave no free model: test it). |
| `TWIN_REQUIRE_TURNSTILE` | var | `false` only for local development. |
| `TWIN_ENABLED`, `TWIN_MODELS`, `OPENROUTER_API_KEY` | optional | Only a fallback until you save settings in the admin page for the first time; you do not need them. |

Never reuse a variable name that already exists in the Pages dashboard when you add one to `wrangler.toml`
(see `docs/admin-access-setup.md`): the deployment fails with "Binding name ... already in use".

Fast kill switch (no redeploy, effective within about 1-2 minutes), also available if the admin page is unreachable:

```bash
npx wrangler kv key put twin_disabled 1 --binding CV_DATA --remote      # off
npx wrangler kv key delete twin_disabled --binding CV_DATA --remote     # on again
```

## One-time owner setup (nothing below can be done from code)

1. **AI provider account:** for the default, OpenRouter (openrouter.ai): create an account and a **dedicated key**; in Settings -> Privacy turn **off** prompt logging/training options for free models. Optional but recommended: buy $10 of credits once, which raises the free-model cap (verify the current limits). You will paste this key into the admin page, not into Cloudflare.
2. **Turnstile** (Cloudflare dashboard): create a widget for `myrootdirectory.pages.dev` (and your custom domain, if any).
3. **D1:** *(done for this project: database `cv-twin` is bound as `TWIN_DB` in `wrangler.toml`)*. For a new project: `npx wrangler d1 create cv-twin`, then add to `wrangler.toml` (only once you have the real id: a placeholder would break deployments):

   ```toml
   [[d1_databases]]
   binding = "TWIN_DB"
   database_name = "cv-twin"
   database_id = "<id from the command>"
   ```
4. **Secrets** (random values: `node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"`; make a different one for each):

   ```bash
   npx wrangler pages secret put TWIN_CONFIG_ENC_KEY --project-name myrootdirectory
   npx wrangler pages secret put TWIN_HMAC_SECRET --project-name myrootdirectory
   npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name myrootdirectory
   ```
5. **Plain settings** in `wrangler.toml` under `[vars]`: `TWIN_ALLOWED_HOSTS`, `VITE_TURNSTILE_SITE_KEY` and, if you want, the caps. Push to deploy. *(Done for this project: host `myrootdirectory.pages.dev` and the Turnstile site key are set. Do not also create same-named entries in the dashboard: the deployment would fail with "Binding name ... already in use".)*
6. **Your content:** approve or edit the quick answers in `src/components/twin/starters.ts` (they are drafts), fix the typos in the CV text (the twin repeats what the CV says), and optionally give the twin extra facts (stories, working style, roles you want, notice period if you want it answered):

   ```bash
   npx wrangler kv key put twin_faq --path faq.txt --binding CV_DATA --remote   # up to 8,000 characters, plain text
   ```
7. Add the **Cloudflare WAF rate-limit rule** for `POST /api/chat` (about 10 requests per 10 seconds per IP) and enable Workers Logs.
8. Open `/admin` -> "Digital twin (AI chat)": paste the key, check the provider URL and model, choose an avatar if you like, press **Save**, then **Test saved settings**, then tick "Show the digital twin to visitors" and Save again. The card shows what is still missing.

### Using a custom domain

The twin only appears on hostnames listed in `TWIN_ALLOWED_HOSTS` (any other host gets `enabled:false` from `/api/chat/status`, so the avatar is simply not drawn). For each extra hostname, e.g. `myrootdirectory.cweihon.dpdns.org`:

1. **Pages -> `myrootdirectory` -> Custom domains** must contain the host (a CNAME at the DNS provider alone is not enough; Pages answers 403 for unknown hosts), and its DNS record must point at `myrootdirectory.pages.dev`.
2. Add it to `TWIN_ALLOWED_HOSTS` in `wrangler.toml` (comma-separated, no scheme) and push. *(Done for `myrootdirectory.cweihon.dpdns.org` and `cweihon.dpdns.org`.)*
3. **Turnstile -> your widget -> Hostnames** must include it, otherwise the bot check fails there.
4. The admin page needs its own step, see "Custom domains" in `docs/admin-access-setup.md`.

## Day-to-day

- **"Resting" in the dialog:** the free quota (or the global cap) is used up or the provider paused us. It clears at 00:00 UTC (08:00 Malaysia time) for the daily quota, 60 s for provider throttling, 15 min for a payment problem. Quick answers and email keep working. If it happens repeatedly: lower `TWIN_IP_PER_DAY`, switch Turnstile to an interactive challenge, or buy credits.
- **Change model, provider or key:** do it in the admin card, press Save, then **Test saved settings**, then ask a few real questions (including things not in the CV) and check it says "I don't know" instead of guessing. Free models appear and disappear without notice.
- **Key leak:** revoke the key at the provider, create a new one and paste it in the admin card (or tick "Remove" and switch the twin off). Rotate `TWIN_CONFIG_ENC_KEY` too if you suspect Cloudflare access was exposed (then re-enter the key). Same for `TURNSTILE_SECRET_KEY`.
- **Who changed what:** `SELECT * FROM twin_audit ORDER BY id DESC LIMIT 20;` in the D1 console (field names and actor only).
- **Bad answer reported:** switch it off (admin card or the kill switch), add the missing fact to the FAQ or fix the CV, then re-enable.
- **Preview deployments** share the production KV namespace in this repo (`preview_id` = `id`), so do not set `TWIN_CONFIG_ENC_KEY` for Preview, and create a separate preview KV namespace when you can.
- **Rollback:** use the kill switch, then roll forward. Never roll back to a deployment from before the Cloudflare Access change; an older deployment also ignores the saved admin settings.

## Local development

```bash
cp .dev.vars.example .dev.vars          # git-ignored
node scripts/mock-openrouter.mjs        # terminal 1: fake provider on :8790, no quota used
npm run build && npx wrangler pages dev dist --d1 TWIN_DB   # terminal 2
```

On localhost the provider URL you save is replaced by `TWIN_UPSTREAM_URL` (the mock) for chat and for
"Test saved settings"; this override is ignored for any request that came through Cloudflare. In the mock,
keywords in the question trigger behaviours: `QUOTA` (daily limit -> resting), `THROTTLE`, `PAYMENT`,
`BREAK` (500), `SLOW` (5 s), `LEAK` (answer that echoes the prompt markup), `LINK` (answer with a wrong LinkedIn and a phishing link: the link guard fixes or removes them). `GET http://127.0.0.1:8790/last`
shows the last request, including the real system prompt. Tests: `npm test` (no network).

## Customising the look and the wording

- **Colours:** warm accents (`--twin-accent`, `--twin-accent-2`, `--twin-peach`, `--twin-pink`, `--twin-ink`) are defined on `.twin-launcher`, `.twin-bubble` and `.twin-dialog` in `src/styles/index.css` (the "Digital twin" block at the end); surfaces, borders and text follow the theme tokens, so light, dark and the classic theme all work. Keep white text on the accent at 4.5:1 contrast or better.
- **Motion:** the avatar floats, pulses an invite ring, twinkles, waves every few seconds and jumps on hover; in the dialog it tilts while thinking and hops when an answer arrives. It is one picture moved with CSS, so it cannot blink or move its hand. **Every animation must stay inside the single `@media (prefers-reduced-motion: no-preference)` block** (keyframes excepted) so visitors who ask for less motion get none. Real expressions (blink, wave, talk) need extra frames in the same style, supplied by the owner.
- **Wording:** title, subtitle, welcome bubble, errors, placeholder and footer text are in `src/components/twin/TwinDialog.tsx`; the greeting bubble and the avatar's label are in `TwinLauncher.tsx`; the quick answers and their emoji are in `starters.ts`; how the owner introduces themselves ("I'm Wei Hon.") is `shortName` in `src/pages/Home.tsx`. The privacy/accuracy notice is deliberately always visible.
- **Avatar picture:** upload it from the admin card; the built-in files are `public/twin/avatar-*.webp|png` (source in `assets/twin/`).

## Not built yet (deliberately deferred, see planning/PLAN.md "Revision 2" and "Revision 4")

Streaming replies, signed chat history, canary token, per-model statistics, load tests, UI/e2e tests (Playwright),
CI, CSP/security headers (REPORT S-9; ship as its own change), thumbs up/down, avatar expression frames, and a
viewer for the audit trail in the admin page.
