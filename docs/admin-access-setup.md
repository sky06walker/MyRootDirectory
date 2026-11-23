# Admin access setup (Cloudflare Access)

The admin console (`/admin`) and its API (`/api/admin/*`) are protected by **Cloudflare Access**.
There is no password in this app any more: no login page, no `auth=true` cookie, no stored password.
Access signs the user in; every admin request then carries a signed `Cf-Access-Jwt-Assertion` header,
and `functions/api/admin/_middleware.ts` re-verifies that signature on **every** request
(RS256 only, issuer, audience, expiry, signing keys from your team's JWKS). If Access is not
configured the admin API **fails closed** (401). The public CV and `GET /api/content` stay open.

> **Status for this project (2026-11-23):** done and working. Zero Trust team `c-weihon`, one Access application covering `/admin` and `/api/admin` on `myrootdirectory.pages.dev`, `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` set in `wrangler.toml`, and sign-in by one-time code confirmed by the owner on 2026-11-21. The clean-up items in section 4 are not confirmed done.

> **Do the steps in this order.** Failing closed only locks the admin out; it never exposes anything.
> Configure and test Access first, set the two values, and deploy last.

## 1. One-time Cloudflare setup (dashboard, owner only)

1. **Zero Trust -> Settings -> Authentication:** choose a login method (One-time PIN by email works with no IdP).
   Note your team domain: `<team>.cloudflareaccess.com` (shown under Settings -> Custom Pages / General).
2. **Zero Trust -> Access -> Applications -> Add -> Self-hosted.** Create **ONE** application (one application = one AUD tag; the code checks a single AUD) with these destinations:
   - `<your-custom-domain>/admin` and `<your-custom-domain>/api/admin`
   - the same two paths on `myrootdirectory.pages.dev` (the production `*.pages.dev` host bypasses a custom-domain-only app)
   - for previews: enable the Pages Access policy (Pages -> `myrootdirectory` -> Settings -> General -> Access policy) or add `*.myrootdirectory.pages.dev` with the same two paths
3. **Policy:** Action *Allow*, Include *Emails* = your own address(es) only. Pick a short-ish session duration.
4. **Application cookie settings:** SameSite `Lax` (or `Strict`) and **HttpOnly** on. (The origin also rejects any state-changing request without a same-origin `Origin` header and a JSON content type, so this is a second layer.)
5. Open the application's overview and copy the **Application Audience (AUD) Tag**.

## 2. Give the app its two values

They are public identifiers (the team domain and the application's AUD tag; both are visible in the Access sign-in redirect), not credentials. They live in `wrangler.toml` under `[vars]`:

```toml
[vars]
ACCESS_TEAM_DOMAIN = "<team>.cloudflareaccess.com"   # this project: c-weihon.cloudflareaccess.com
ACCESS_AUD = "<AUD tag from step 1.5>"
```

**Why `wrangler.toml` and why the names `ACCESS_*`:** this repo has a `wrangler.toml` with `pages_build_output_dir`, so Pages reads variables from that file and the dashboard's variable list becomes read-only. In this project the dashboard already held entries named `CF_ACCESS_AUD` / `CF_ACCESS_TEAM_DOMAIN` (added by hand before the file defined any variables). Declaring `[vars]` with those exact names failed the deployment with `Binding name 'CF_ACCESS_AUD' already in use`, and the dashboard entries could not be deleted. The settings therefore use different names, `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`, which cannot clash; the old `CF_ACCESS_*` dashboard entries are unused and can be ignored. Changing the file needs a new deployment (push to the production branch).

`ACCESS_TEAM_DOMAIN` must be `<team>.cloudflareaccess.com` (scheme and trailing slash are tolerated); anything else is rejected. The `name` at the top of `wrangler.toml` must be the real Pages project name (`myrootdirectory`).

### Custom domains (e.g. `myrootdirectory.c-weihon.dpdns.org`)

Access only protects the hostnames listed as destinations of the application, so on a custom host `/admin` is **not** behind Access: no sign-in happens, no `Cf-Access-Jwt-Assertion` header arrives, and the app (which fails closed) shows "Access denied". Nothing is exposed; the admin just does not work there. Options:

- **A. Use `https://myrootdirectory.pages.dev/admin` for administration** (works today, nothing to configure). The public CV and the twin can use any custom host.
- **B. Protect the custom host too:** add `<custom-host>/admin` and `<custom-host>/api/admin` as destinations of the **same** Access application (same AUD tag, so no code change). Access can only sit in front of hostnames whose DNS is served through your Cloudflare account (an external DNS provider such as DigitalPlat generally is not enough; delegate the domain's nameservers to Cloudflare, or use a domain you can add to Cloudflare as a zone). Verify with a private window: `/admin` must redirect to the Access sign-in.

Either way, add the host to `TWIN_ALLOWED_HOSTS` and the Turnstile hostnames (see `docs/digital-twin-ops.md`, "Using a custom domain").

## 3. Test before you deploy

- Open `https://<your-domain>/admin` in a private window: you must be redirected to the Access sign-in. If you see the admin UI, Access is not covering that path.
- Deploy, then sign in and save a change. Then, with no credentials:

```bash
curl -i https://<your-domain>/api/admin/verify                                   # expect 401
curl -i -X POST -H "Content-Type: application/json" -H "Origin: https://<your-domain>" \
     -H "Cookie: auth=true" -d '{}' https://<your-domain>/api/admin/content       # expect 401
curl -i https://myrootdirectory.pages.dev/api/admin/verify                                 # expect 401
```

## 4. Clean-up after the first successful deploy (owner actions)

1. **Old deployments are still live.** Every earlier Pages deployment stays reachable at its own `<hash>.myrootdirectory.pages.dev` URL **running the old code** (forgeable `auth=true` cookie, `admin123` fallback) against the same production KV. Delete the old deployments in the dashboard (Pages -> `myrootdirectory` -> Deployments) and confirm none predates this change. List them with `npx wrangler pages deployment list --project-name myrootdirectory`.
2. **Never use Pages "Rollback" to a deployment from before this change**: it re-opens the hole. Roll forward with a fix instead.
3. **Delete the obsolete password from production KV** (nothing reads it any more, and it is in git history):

   ```bash
   npx wrangler kv key delete admin_password --binding CV_DATA --remote
   ```

   If that password is used anywhere else, change it there. If the GitHub repository is or ever was public, assume the old password and the old local KV file were exposed; history can be purged with `git filter-repo` (requires a force-push and every clone to re-sync, so it is deliberately not done automatically).
4. **Optional belt-and-braces:** a zone WAF custom rule that blocks `POST` to `/api/content`, `/api/login`, `/api/change-password` on your custom domain.
5. **Previews write production data:** `wrangler.toml` still sets `preview_id` equal to the production KV id. Create a separate preview namespace (`npx wrangler kv namespace create CV_DATA_PREVIEW`) and put its id in `preview_id`.

## 5. Local development

`npm run dev` serves the UI only (no `/api`). To run the API locally:

```bash
cp .dev.vars.example .dev.vars          # git-ignored; contains ALLOW_INSECURE_LOCAL_AUTH=true
npm run build && npx wrangler pages dev dist
```

`ALLOW_INSECURE_LOCAL_AUTH=true` skips Access **only** when the hostname is `localhost`, `127.0.0.1` or `[::1]` **and** the request has no `CF-Ray` header (i.e. it did not come through the Cloudflare edge). It is ignored everywhere else and logs a warning whenever it is used. Never set it in Cloudflare.

## 6. Audit and troubleshooting

- Every successful content save logs one JSON line `{"event":"cv_content_updated","actor":"<email>","at":"..."}` (content is never logged). These lines only persist if Workers Logs / Logpush is enabled for the Pages project, and retention is short; Access's own audit log (Zero Trust -> Logs -> Access) is the long-term record of sign-ins.
- **"Access denied" in the admin UI** after signing in: check the function logs. `Cloudflare Access is not configured correctly` means a missing/invalid `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD`; `Access JWT verification error` means a bad/foreign token; no log line plus 401 means the request carried no `Cf-Access-Jwt-Assertion` (the path is not covered by the Access application).
- **Session expired while editing:** the Access cookie is shared across tabs, so open `/admin` in a new tab to sign in again, then press Save in the original tab; the edits there are kept.
- **Deployment fails with `Binding name '<NAME>' already in use`:** the same name exists both in `wrangler.toml` `[vars]` and in the dashboard (Settings -> Variables and Secrets). Dashboard entries are read-only while `wrangler.toml` manages variables, so rename the variable in `wrangler.toml` (and in the code that reads it) instead of trying to delete the dashboard entry. A failed deployment never replaces the live one, so the site keeps serving the last successful deployment meanwhile.
- Signing keys rotate: an unknown key id triggers one JWKS refresh (rate-limited to once a minute); keys are otherwise cached for an hour.
