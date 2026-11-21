# Code Review & Simplification Report

**Project:** MyRootDirectory (React 19 + Vite SPA on Cloudflare Pages, Pages Functions + Workers KV)
**Date:** 2026-11-20
**Scope:** every file under `src/`, `functions/`, plus `wrangler.toml`, `package.json`/lockfile, `.gitignore`, tracked `.wrangler/` state, root helper scripts and static assets.
**Nothing was committed.** All changes are uncommitted in the working tree and can be reviewed with `git diff` / `git status`.

---

## 0. Remediation update: critical findings S-1, S-2, S-3

Implemented as recommended in section 4 (Cloudflare Access instead of custom auth). **The code is done and verified, but the fixes only take effect once the owner completes the Cloudflare-side steps in [`docs/admin-access-setup.md`](docs/admin-access-setup.md)** (create the Access application, set `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`, delete old deployments, delete the old KV password). Until then the admin API fails closed: the public CV works, but nobody can edit it.

| Finding | Status | What was done |
|---|---|---|
| S-1 forgeable session | **Fixed in code** | Cookie auth removed. `functions/api/admin/_middleware.ts` verifies the signed Cloudflare Access JWT on every `/api/admin/*` request (RS256 pinned; `iss`, `aud`, `exp`, `nbf` checked; signing keys from config-derived JWKS URL; fail closed). Writes moved to `POST /api/admin/content`; `GET /api/content` is now read-only. Added same-origin + JSON CSRF guard, `Cache-Control: no-store`, and an audit log line (actor email) on every save. |
| S-2 default password | **Fixed** | Password authentication deleted entirely (`login`, `logout`, `change-password`, Login page, change-password modal, `ADMIN_PASSWORD`, KV `admin_password` reads). There is no fallback secret left to guess. |
| S-3 committed KV state | **Partly fixed** | `.wrangler/` removed from the git index (files stay on disk, deletions are staged, not committed) and git-ignored together with `.dev.vars`. **Owner actions remain:** delete the `admin_password` key from production KV, and decide about purging git history (needs a force-push; if the GitHub repo is or was public, treat the old password as exposed; the repo's visibility could not be checked from here). Because nothing accepts a password any more, the leaked value can no longer be used against this app once old deployments are gone. |
| S-4, S-5, S-6 (plaintext password, brute force, cookie flags/CSRF) | **Superseded** | They described the password/cookie mechanism, which no longer exists. Replaced by Access (rate limiting, MFA and session management are Access's job) plus the origin CSRF guard. |
| S-8 audit trail | **Partly addressed** | Content saves are logged with actor and timestamp; sign-ins are in Access's audit log. Enable Workers Logs/Logpush for retention. |

**Independent design review:** the design was reviewed by a separate Opus agent before implementation. Adopted from it: single admin middleware instead of per-route checks, single Access application / single AUD, CSRF origin and content-type guard, strict JWT handling (config-only issuer and JWKS URL, domain validation, token size cap, clock skew, fetch timeout, de-duplicated and rate-limited JWKS refresh, `common_name`/`sub` fallback for service tokens), bypass hardening (`CF-Ray` refusal, warning log), JSON catch-all for `/api/*`, `/login` redirect, and the warnings about old deployments and rollback. Not adopted: an optional email allow-list env var (the Access policy already restricts who can sign in).

**New verification (all passing):**

| Check | Result |
|---|---|
| Node unit tests of the verifier with a mock JWKS and real RSA signatures | 26/26: valid token; `aud` as string/array; another application's AUD; wrong issuer; expired (beyond 60 s skew); missing `exp`; future `nbf`; wrong key with a known `kid`; tampered payload; `alg: none`/HS256/missing `kid`; malformed, oversize and empty tokens; missing or invalid config; non-`cloudflareaccess.com` domain (no fetch made); JWKS network error / HTTP 500 / empty key set (fail closed); 8 concurrent cold requests share one fetch; bypass accepted only for localhost without `CF-Ray`; CSRF guard cases |
| Key rotation test (mocked clock) | New `kid` rejected inside the 60 s refresh window (no fetch), accepted after it with exactly one refetch; full refetch after the 1 h TTL |
| `wrangler pages dev`, Access unconfigured (fail closed) | Forged `Cookie: auth=true`, garbage `Cf-Access-Jwt-Assertion`, and no credentials all get 401 and **nothing is written** to KV; `/api/login`, `/api/change-password` and the old `POST /api/content` return JSON 404; unknown `/api/*` returns JSON 404 (not HTML); `/admin` and `/login` still serve the SPA |
| `wrangler pages dev` with `.dev.vars` bypass | Legit same-origin JSON save 200 and visible on public read; POST without `Origin`, cross-site `Origin`, and `text/plain` all 403; admin responses carry `Cache-Control: no-store`; bypass refused (401) when a `CF-Ray` header or a non-local `Host` is present; audit line `cv_content_updated` logged with actor |
| Browser | `/login` redirects to `/admin`; admin renders without the password UI; Save through the UI succeeds; with Access unconfigured `/admin` shows the "Access denied" screen |
| `npm run lint`, `npm run build`, functions type-check (throw-away tsconfig + `@cloudflare/workers-types`) | all pass |

**Not verified:** a real Cloudflare Access tenant (no account access from here): the JWT format was implemented from Cloudflare's documented behaviour and exercised only against self-signed test tokens, so do the "test before you deploy" steps in the setup guide; behaviour of `*.pages.dev` previews with the Pages Access policy; Workers Logs retention.

**Behaviour changes to be aware of:** the admin password feature (including "Change Password") no longer exists; admin writes use `/api/admin/content`; "View Mode" no longer logs out and a "Sign out" link to `/cdn-cgi/access/logout` is shown in production builds; saving after the Access session expires keeps the page and edits and asks you to sign in again in another tab.

---

## 1. Executive summary

| | Before | After |
|---|---|---|
| `npm run lint` | 10 errors | **0 errors** |
| `npm run build` (`tsc -b` + vite) | pass | **pass** |
| Production JS bundle | 278.97 kB (87.19 kB gzip) | 276.39 kB (87.68 kB gzip) |
| Production CSS | 4.30 kB | 4.11 kB |
| `Home.tsx` / `Admin.tsx` | 565 / 358 lines | 451 / 339 lines |
| Unused deps / template files | `dompurify`, `@types/dompurify`, 4 Vite-template files | removed |
| `npm audit --omit=dev` | 3 vulns (1 moderate, 2 high) | 2 (high, `react-router`) |

The simplification work was behaviour-preserving apart from the explicit bug fixes listed in section 3. The code review also found **three critical security problems** (section 4: S-1, S-2, S-3). They have since been remediated in code (see section 0), but the fix is only live once the owner completes the Cloudflare Access setup in `docs/admin-access-setup.md`. Sections 2 to 4 below describe the state at the time of the original review.

---

## 2. Method and evidence

1. Read all source files, config and tracked state; established a baseline (`npm ci`, `npm run lint`, `npm run build`, `npm audit`).
2. Reviewed for: OWASP risks, authn/authz, secret handling, data integrity/concurrency, error handling, performance/latency, accessibility, operability, dependency risk.
3. Applied safe simplifications and fixes; re-ran lint and build after every batch.
4. Type-checked `functions/` with a throw-away tsconfig using `@cloudflare/workers-types` (installed with `--no-save`; 0 errors, config deleted afterwards).
5. Ran the **built app under `wrangler pages dev` with a temporary local KV** (never remote, never the real namespace) and exercised the API with `curl`, then drove the UI in a browser.

Verified results:

| Check | Result |
|---|---|
| GET `/api/content`, empty KV | 404 `{"message":"No data found"}` (frontend falls back to `INITIAL_CV_DATA`) |
| GET `/api/verify` without cookie / with login cookie | 401 / 200 |
| POST `/api/content` without cookie / with login cookie | 401 / 200, and a following GET returns the saved JSON |
| POST `/api/content` with invalid JSON | 500 `{"error":"Failed to save data"}` (no internals leaked) |
| POST `/api/login` wrong password / correct | 401 / 200 + `Set-Cookie: auth=true; HttpOnly; SameSite=Strict; Max-Age=3600` |
| POST `/api/change-password` short / wrong current | 400 / 401 with the same messages as before |
| POST `/api/logout` | 200, cookie cleared |
| **POST `/api/content` with a hand-made `Cookie: auth=true` and no login** | **200 (confirms S-1)** |
| Home, `?theme=modern` and `?theme=custom` | render, contact links present, certifications newest-first, Share modal opens with QR code and URL |
| `/admin` after login | renders; Add / edit / Remove verified for experience; Add verified for education, skills, languages, certifications; custom proficiency value preserved in the select |

**Not verified (be aware):** saving from the Admin UI end-to-end (it uses `alert()`, so only the API path was tested), photo upload, a real print preview, dark-mode visuals, mobile layout re-check, and any deployed/production environment.

---

## 3. Changes made

### 3.1 Bug fixes (behaviour changes, intentional)

| ID | Fix | Where |
|---|---|---|
| B-1 | Admin save failure of *any* kind used to redirect to `/login`, silently discarding all unsaved edits. Now only a 401 redirects; other failures keep the page and show a retry message. `saveCVData` returns `'ok' \| 'unauthorized' \| 'error'`. | `src/utils/api.ts`, `src/pages/Admin.tsx` |
| B-2 | The print stylesheet hid every `<header>`, which in the modern layout is the profile block (name, photo, summary, contact), so printed CVs lost their top section. The app header now carries `no-print` and the blanket `header` rule is gone. (Reasoned from the CSS; not checked in a print preview.) | `src/styles/index.css`, `src/components/Header.tsx` |
| B-3 | User-editable URLs (`profile.url`, `contact.github`) were rendered straight into `href`, allowing `javascript:` links (stored XSS if the content is ever tampered with, which S-1 makes trivial). Now filtered to http(s) via `ExternalLink` / `safeHref`. | `src/utils/url.ts`, `src/components/ExternalLink.tsx`, `src/pages/Home.tsx` |
| B-4 | `POST /api/content` echoed `e.message` to the client on failure. It now logs server-side and returns a generic error. | `functions/api/content.ts` |
| B-5 | Skill bars showed a bare `%` when `level` was undefined. | `src/components/SkillChart.tsx` |
| B-6 | Theme: an arbitrary string in `localStorage` was cast to the theme type unchecked, and blocked storage threw. Both are now validated/guarded. | `src/App.tsx` |
| B-7 | `fetchCVData` now guarantees `languages`/`certifications` are arrays (older saved blobs may lack them), removing scattered `?.` guards. | `src/utils/api.ts` |

### 3.2 Simplification (no intended behaviour change)

- **Lint errors fixed:** components created during render (`ShareModal` in `Home.tsx`), unused catch bindings, `any`, `let` that is never reassigned.
- **Backend dedupe:** `Env`, `json()`, `getAdminPassword()` and `isAuthenticated()` were copy-pasted across 5 functions; now in `functions/_lib/common.ts`. All JSON error responses now carry `Content-Type: application/json`. The insecure mechanisms are intentionally preserved but isolated and commented, so S-1/S-2 become one-file fixes.
- **`Admin.tsx`:** ten near-identical add/remove/update handlers collapsed into three generic, type-checked helpers (`addItem`, `removeItem`, `updateItem`); repeated field/section/remove-button JSX extracted (`Field`, `SectionHeader`, `RemoveButton`); unused `dataToSave` parameter removed; ids now `crypto.randomUUID()` instead of `Date.now()` (collision-safe); labels associated to inputs; `aria-label`s on remove buttons and bare inputs; `autocomplete` hints on password fields.
- **`Home.tsx`:** split into `CustomLayout` / `ModernLayout` with shared `ActionBar`, `SidebarHeading`, `MainHeading`; duplicated certification sort extracted.
- **Shared UI:** `Modal` (was duplicated overlay markup in two places), `ShareModal`, `ExternalLink`.
- **`api.ts`:** single `postJson` helper; `logout()` and `verifySession()` moved out of components; one `Theme` type instead of four inline unions.
- **CSS:** removed a dead duplicate `.container` rule and redundant `.btn` declarations (verified they were overridden or identical).
- **Dead code/deps removed:** `dompurify` + `@types/dompurify` (never imported, and `dompurify` carried an advisory), `src/index.css`, `src/App.css`, `src/assets/react.svg`, `public/vite.svg` (unreferenced Vite-template leftovers; recoverable from git).
- `CLAUDE.md` updated to match.

---

## 4. Open findings (NOT fixed) - ranked

### Critical

**S-1 Forgeable admin session. (Remediated, see section 0.)** `content` POST and `verify` only test that the `Cookie` header *contains* `auth=true`. Anyone can send `Cookie: auth=true` and rewrite the CV or pass `/admin`'s guard (reproduced, section 2). The session is also stateless, so logout cannot revoke it.
*Recommended fix (safest practical):* put `/admin` and all mutating endpoints behind **Cloudflare Access** (no custom auth, no added latency, audit log included). If custom auth must stay: HMAC-signed session token (WebCrypto, sub-millisecond) containing expiry and a server-side session/version id, secret in a Wrangler secret, `Secure` flag, short TTL, server-side revocation. Replace `isAuthenticated()` in `functions/_lib/common.ts`.

**S-2 Hardcoded fallback password `admin123`. (Remediated, see section 0.)** If KV has no `admin_password` and `ADMIN_PASSWORD` is unset, the admin password is public knowledge (it is in this repository). *Fix:* delete the fallback in `getAdminPassword()`, fail closed (401/500 plus an alert-able log line) when no secret is configured, set `ADMIN_PASSWORD` (or better, a hash) as a Wrangler secret.

**S-3 Local KV database is committed to git. (Partly remediated, see section 0; owner actions remain.)** `.wrangler/` is tracked and not ignored; the tracked miniflare database (`.wrangler/state/v3/kv/miniflare-KVNamespaceObject/58d814ac...sqlite`) contains an `admin_password` entry, i.e. a password value is in the repository history (value intentionally not opened or printed). *Action:* treat that password as compromised and **rotate the production password now**; `git rm -r --cached .wrangler` and add `.wrangler/` to `.gitignore`; if the repository is or was ever shared/public, purge history (`git filter-repo`) and assume exposure. (Also remove the tracked bundler temp output.)

### High

S-4, S-5 and S-6 are **superseded** by the move to Cloudflare Access (section 0); D-1 is still open.

| ID | Finding | Recommendation |
|---|---|---|
| S-4 | Admin password stored in **plaintext** in KV and compared with `===` (not constant-time). | Store a salted hash (WebCrypto PBKDF2; note Workers cap iterations at 100,000) or drop passwords via Cloudflare Access; compare with a constant-time routine. |
| S-5 | **No brute-force protection** on `/api/login`; `/api/change-password` needs no session at all (only the current password), so it is a second guessing oracle. | Cloudflare WAF rate-limiting rules on `/api/login` and `/api/change-password`; backoff/lockout with audit entry; require an authenticated session for change-password. |
| S-6 | Cookie lacks `Secure`; no CSRF token (SameSite=Strict mitigates modern browsers only). | Add `Secure`, keep `SameSite=Strict`, add an Origin check on mutating requests. |
| D-1 | **Production dependency advisories:** `react-router` / `react-router-dom` (`^7.12.0` resolves to a vulnerable range) - 5 advisories (route-matching DoS, two open-redirect variants incl. XSS, prerender redirect XSS, RSC CSRF). Several concern RSC/prerender modes this SPA does not use, but the fix is a non-breaking bump. | `npm audit fix` (not run here: it rewrites the lockfile beyond the review scope), then rebuild and smoke-test routing/login. Gate CI on `npm audit --omit=dev --audit-level=high`. |

### Medium

| ID | Finding | Recommendation |
|---|---|---|
| S-7 | `POST /api/content` stores any JSON of any size; no schema, no body limit, no URL-scheme validation at write time (output-side http(s) filtering added, B-3). | Validate with a schema (zod/valibot), reject unknown keys, cap body size, validate URLs on write. |
| S-8 | **No audit trail:** logins (success/failure), password changes and content writes are not logged. | Structured logs (timestamp, actor, outcome, `CF-Connecting-IP`, request id; never passwords/tokens) via Workers Logs/Logpush; alert on repeated failures. |
| S-9 | No security headers (CSP, `X-Content-Type-Options`, `Referrer-Policy`, frame-ancestors, HSTS). | Add `public/_headers`. Heavy inline styles mean CSP needs `style-src 'unsafe-inline'` for now; `img-src 'self' data:` covers the uploaded photo. |
| R-1 | **Data integrity/recovery:** the whole CV is one KV key, last-write-wins, no versioning or backup; two open admin tabs silently overwrite each other; KV is eventually consistent. | Add a `version`/etag check on save (reject stale writes), keep `cv_content_prev` + timestamped snapshots, document export/import in the SOP below. |
| P-1 | **Latency:** the uploaded profile photo is stored as a base64 data URL inside the same JSON that every public visitor downloads; no size cap on upload. | Store the image as a static asset/R2 object and keep only its URL in the JSON; cap upload size (e.g. 200 KB). |
| P-2 | Public `GET /api/content` has no cache headers, so every page view is a KV read. | `Cache-Control: public, max-age=60, stale-while-revalidate=300`, or Cache API with purge on save. Trade-off: visitors (and the admin) may see up to 60 s stale content unless the admin fetch bypasses the cache. |
| P-3 | Single 276 kB chunk; admin screen and QR library load for every public visitor. | `React.lazy` the Admin and Share modal; expected to cut public initial JS noticeably. |
| O-1 | `functions/` is linted but **not type-checked** by `npm run build` (`@cloudflare/workers-types` is not installed, there is no functions tsconfig). | Add the types package and a `functions/tsconfig.json`, include it in `build`/CI. (A throw-away check of the current code passes with 0 errors.) |
| O-2 | `wrangler.toml` sets `preview_id` equal to the **production** KV id: a remote preview writes production data. Compatibility date `2024-01-01` is stale. | Create a separate preview namespace; review the compatibility date. |

### Low / hygiene

- Dark mode: `SkillChart`, `ShareModal`, and several Admin controls use hard-coded colours (`#ccc`, `#f0f0f0`, `white`, `black`), bypassing the design tokens; print under a dark colour scheme may output light text.
- Accessibility remaining: modals have no focus trap/Escape handling; the header "View Mode" control is an `<a>` acting as a button; password modal labels are not associated to inputs.
- Hundreds of inline `style` props make theming/print/CSP harder; migrate gradually to CSS classes.
- `index.html`: generic title, no meta description/Open Graph tags.
- Repo clutter: root-level Python helper scripts, `cv_content_dump.txt`, unreferenced `public/skill_chart.png` and `public/assets/images/word/media/*` (extracted .docx media that ships to production), README is the unmodified Vite template. Move scripts to `tools/`; delete or relocate unreferenced public assets.
- `.claude/` (local agent state) is untracked; add `.claude/*.local.md` to `.gitignore`.
- 21 further advisories are in **dev tooling** (e.g. `@babel/core`, `ajv`, `brace-expansion`, `browserslist`, `minimatch`, `nanoid`, `postcss`, `sharp`, `flatted`): not shipped to users, but they run on developer/CI machines; `npm audit fix` and a `wrangler` update should clear most.

---

## 5. Testing gaps and recommended test plan

There are **no automated tests and no CI**. Minimum set to add:

1. **Unit (Vitest):** `safeHref` (http, https, `javascript:`, `data:`, relative, garbage), `withDefaults`, certification sort, theme parsing.
2. **Function tests (Miniflare / `wrangler unstable_dev`):** unauthenticated writes are 401; forged cookie is rejected (this test fails today by design - it documents S-1); wrong/right password; password-change validation; malformed JSON; oversize body; verify no internals in error bodies.
3. **E2E smoke (Playwright):** home renders in both themes, share modal, login -> admin -> edit -> save -> reload shows change, expired session redirect keeps edits on non-401 failure.
4. **Load/latency:** `GET /api/content` and `/` at burst rates (k6/oha) before and after P-1/P-2; target p95 well under 100 ms from edge.
5. **Failure/recovery:** KV unavailable (frontend must still render `INITIAL_CV_DATA`), restore-from-snapshot drill.

**CI/CD (recommended):** GitHub Actions on every PR: `npm ci`, `npm run lint`, `npm run build`, functions type-check, `npm audit --omit=dev --audit-level=high`, tests; Cloudflare Pages preview deployments per PR; branch protection on `main` with required review and required checks; no direct pushes.

---

## 6. Operational SOPs (proposed)

**Deploy:** merge to `main` after green CI -> Cloudflare Pages builds `dist/` + `functions/` -> smoke test `/`, `/api/content`, login on the preview URL first.
**Rollback:** Cloudflare Pages dashboard -> Deployments -> *Rollback* to the previous successful deployment (code only). **Data** rollback is separate: restore `cv_content` from the latest snapshot key (needs R-1).
**Suspected credential compromise (do now for S-3):** rotate the admin password via a Wrangler secret / `change-password`, invalidate sessions (rotate the signing secret once S-1 is fixed), review Workers logs for unexpected `POST /api/content`, restore content from a known-good snapshot, record the timeline.
**Escalation:** owner of the repo/Cloudflare account is the single point of contact today; define a backup owner.

---

## 7. Assumptions and trade-offs

- This is a personal CV site, not a regulated or latency-critical system, so recommendations favour the **lowest-complexity safe option** (Cloudflare Access, WAF rate limits, edge caching) over bespoke infrastructure. If it ever hosts anything beyond a public CV, S-1 to S-8 become release blockers.
- Security vs. performance: signed-session verification, hashing and Origin checks add microseconds to milliseconds on the rare admin path only; the public read path (the one that matters for latency) is improved by P-1/P-2/P-3, not slowed by any recommendation here.
- I did not run `npm audit fix`, remove the committed `.wrangler/` files, rotate any credential, or change the auth mechanism: those are owner decisions or irreversible/outward-facing and were left for review.
