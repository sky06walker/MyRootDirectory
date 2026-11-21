# Digital twin: setup and operations

A floating cartoon avatar on the public CV (`/`). Clicking it opens a dialog where visitors can use
pre-written quick answers (free, instant) or ask free-text questions answered by an **OpenRouter free
(`:free`) model** that only knows your live CV. Design and decisions: `planning/PLAN.md`.

**Safe by default:** with `TWIN_ENABLED` unset the status endpoint says `disabled` and the avatar is not
rendered, so deploying the code changes nothing visible. The twin also fails closed (stays off) if any
required setting below is missing.

## How a question flows

`browser -> POST /api/chat -> checks (host, origin, size, Turnstile/session, per-IP and global caps, "resting" flag) -> CV from KV + your FAQ -> prompt -> OpenRouter (:free models only) -> output filter -> answer`

- Quick answers (`src/components/twin/starters.ts`) never touch the server.
- Counters live in D1 (consistent across servers). Tables are created automatically on first use.
- No conversation text is stored or logged; logs hold outcome, lengths, model and a daily-rotating
  pseudonymous client hash only.

## Settings

| Name | Kind | Purpose |
|---|---|---|
| `TWIN_ENABLED` | var | `true` turns the twin on. Anything else keeps it off. |
| `TWIN_MODELS` | var | 1-3 OpenRouter ids, each ending in `:free`, comma separated, first = preferred. |
| `TWIN_ALLOWED_HOSTS` | var | Your custom domain(s), comma separated. Other hosts (`*.pages.dev`, previews) get 403. |
| `OPENROUTER_API_KEY` | **secret** | Server-side only. |
| `TWIN_HMAC_SECRET` | **secret** | 32+ random characters (session tokens, client hashing). |
| `TURNSTILE_SECRET_KEY` | **secret** | Cloudflare Turnstile secret. |
| `VITE_TURNSTILE_SITE_KEY` | build-time var | Turnstile site key (public by design). Set it in the Pages **build** environment variables. |
| `TWIN_DB` | D1 binding | Counters and the resting flag. |
| `TWIN_GLOBAL_DAILY_CAP` | var, default 45 | Requests per UTC day for the whole site. Keep below your OpenRouter daily limit (about 50 free; about 1,000 with $10 credits: verify). |
| `TWIN_IP_PER_MIN` / `TWIN_IP_PER_DAY` | var, defaults 3 / 10 | Per visitor. |
| `TWIN_DATA_COLLECTION_DENY` | var | `true` asks OpenRouter to avoid providers that collect data (may leave no free model: test it). |
| `TWIN_REQUIRE_TURNSTILE` | var | `false` only for local development. |

Fast kill switch (no redeploy, effective within about 1-2 minutes):

```bash
npx wrangler kv key put twin_disabled 1 --binding CV_DATA --remote      # off
npx wrangler kv key delete twin_disabled --binding CV_DATA --remote     # on again
```

## One-time owner setup (nothing below can be done from code)

1. **OpenRouter** (openrouter.ai): create an account and a **dedicated key**. In Settings -> Privacy turn **off** prompt logging/training options for free models. Pick 2-3 `:free` models (>= 16k context, good instruction following), then try `TWIN_DATA_COLLECTION_DENY=true` and check that answers still work. Optional but recommended: buy $10 of credits once, which raises the free-model cap (verify the current limits and that a minimal/$0 key credit limit still allows `:free` calls).
2. **Turnstile** (Cloudflare dashboard): create a widget for your custom domain and `myrootdirectory.pages.dev`.
3. **D1:** `npx wrangler d1 create cv-twin`, then add to `wrangler.toml` (do this only once you have the real id: a placeholder would break deployments):

   ```toml
   [[d1_databases]]
   binding = "TWIN_DB"
   database_name = "cv-twin"
   database_id = "<id from the command>"
   ```
4. **Secrets:**

   ```bash
   npx wrangler pages secret put OPENROUTER_API_KEY --project-name myrootdirectory
   npx wrangler pages secret put TWIN_HMAC_SECRET --project-name myrootdirectory     # node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"
   npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name myrootdirectory
   ```
5. **Plain settings** (`TWIN_MODELS`, `TWIN_ALLOWED_HOSTS`, caps) go in `wrangler.toml` under `[vars]` or in the Pages dashboard; use one place consistently. Leave `TWIN_ENABLED` unset for now.
6. **Your content:** approve or edit the quick answers in `src/components/twin/starters.ts` (they are drafts), fix the typos in the CV text (the twin repeats what the CV says), and optionally give the twin extra facts (stories, working style, roles you want, notice period if you want it answered):

   ```bash
   npx wrangler kv key put twin_faq --path faq.txt --binding CV_DATA --remote   # up to 8,000 characters, plain text
   ```
7. Add the **Cloudflare WAF rate-limit rule** for `POST /api/chat` (about 10 requests per 10 seconds per IP) and enable Workers Logs.
8. **Deploy with `TWIN_ENABLED` still off**, check `/api/chat/status` returns `{"enabled":false}`, then set `TWIN_ENABLED=true` (a new deployment, because plain variables are read at deploy time) and ask a few questions. Never test with a pre-Access deployment.

## Day-to-day

- **"Resting" in the dialog:** the free quota (or the global cap) is used up or the provider paused us. It clears at 00:00 UTC (08:00 Malaysia time) for the daily quota, 60 s for provider throttling, 15 min for a payment problem. Quick answers and email keep working. If it happens repeatedly: lower `TWIN_IP_PER_DAY`, switch Turnstile to an interactive challenge, or buy credits.
- **Change a model:** edit `TWIN_MODELS`, redeploy, ask 10 real questions (including things not in the CV) and check it says "I don't know" instead of guessing. Free models appear and disappear without notice.
- **Key leak:** revoke the key in OpenRouter, create a new dedicated key, `wrangler pages secret put OPENROUTER_API_KEY`, redeploy. Same for `TURNSTILE_SECRET_KEY`. Changing `TWIN_HMAC_SECRET` only ends current visitor sessions.
- **Bad answer reported:** switch it off with the kill switch if serious, add the missing fact to the FAQ or fix the CV, then re-enable.
- **Rollback:** use the kill switch, then roll forward. Never roll back to a deployment from before the Cloudflare Access change.

## Local development

```bash
cp .dev.vars.example .dev.vars          # git-ignored
node scripts/mock-openrouter.mjs        # terminal 1: fake OpenRouter on :8790, no quota used
npm run build && npx wrangler pages dev dist --d1 TWIN_DB   # terminal 2
```

In the mock, keywords in the question trigger behaviours: `QUOTA` (daily limit -> resting), `THROTTLE`,
`PAYMENT`, `BREAK` (500), `SLOW` (5 s), `LEAK` (answer that echoes the prompt markup). `GET http://127.0.0.1:8790/last`
shows the last request, including the real system prompt. Tests: `npm test` (63 tests, no network).

## Not built yet (deliberately deferred, see planning/PLAN.md "Revision 2")

Streaming replies, signed chat history, canary token, admin screen for the twin, per-model statistics,
load tests, Playwright suite, CSP/security headers (REPORT S-9; ship as its own change), thumbs up/down.
