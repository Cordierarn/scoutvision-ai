# Private deployment

ScoutVision runs online as a **private, single-user** instance. The repository is public; the
PitchAPI data, the Gemini key and the credentials are not. One Node server sits in front of
everything and refuses every private resource without a valid session.

## Host: Heroku, one Basic dyno

- The app needs a **Node server** in front of `dist/`, `/data/`, `/cdn/` and `/api/` (Gemini key,
  private data, image proxy). Heroku runs it as a plain `web` process: no Docker, no serverless
  rewrite, no move to Next.js. ScoutVision stays React + Vite + Node.
- HTTPS on `<app>.herokuapp.com`, Config Vars for the secrets, deploys from GitHub, custom domain
  possible later.
- **Basic dyno**: 512 MB of RAM, never sleeps. A purely static host is excluded: it would publish
  whatever the build contains.

### Cost

| Item | Amount |
|---|---|
| Heroku Basic dyno | 7 USD per month |
| GitHub Student Developer Pack | up to 13 USD of Heroku credit per month, for 24 months |
| Expected net cost for one Basic dyno | 0 USD per month, while the student offer applies |

Heroku asks for a credit card. Usage above the monthly credit can be billed, and unused credit
does not roll over to the next month. Nothing else is needed: no add-on, no database, no disk.

### How Heroku builds and runs it

- **Build** (Heroku Node.js buildpack, on every deploy): Node from `engines.node` in
  `package.json` (`22.x`), `npm ci` with the dev dependencies, `npm run build` (client into
  `dist/`, server into `dist-server/production.js`), then the dev dependencies are pruned. The
  checkout has no `public/data` (git-ignored): the slug never contains private data. Measured on
  a clean copy: slug about 25 MB compressed, `dist/` 2.2 MB, no source maps.
- **Start**: `Procfile` → `web: node dist-server/production.js` (the same command as `npm start`,
  without an npm process in between: less memory, `SIGTERM` reaches the server directly). The
  server listens on `0.0.0.0:$PORT` immediately (Heroku allows 60 s to bind) and refuses to start
  without valid authentication variables.
- **Data at runtime**: right after start, the server downloads the private release with
  `PITCHAPI_DATA_TOKEN` (about 6 s). Heroku's filesystem is ephemeral and every dyno restarts at
  least once a day, on each deploy and on each Config Var change: the download simply runs again.
  Until it finishes, `/data/*` answers `503` (after login) and the app shows its loading error,
  never stale or partial data.
- **Router**: Heroku's router is the only way in. It appends the client address to the right of
  `X-Forwarded-For` and sets `X-Forwarded-Proto`; the server trusts these headers only on a dyno
  (`DYNO` is set). It closes a request after **30 s** without a first byte (error H12): the AI
  endpoints therefore stop at 25 s and answer themselves; if the correction pass of a report has
  no time left, the first text is kept and its faulty sentences are removed.
- **HTTPS**: `*.herokuapp.com` also accepts plain HTTP. The server redirects any HTTP `GET`/`HEAD`
  to HTTPS (`301`) and refuses other HTTP methods, so the `Secure` cookie is always set over HTTPS.
- **Health**: `GET /healthz` answers `ok` (no secret, no path, no release name, no stack).
  Heroku's common runtime has no configurable HTTP health check; the route serves
  `npm run verify:private` and any external monitor.

### Measured on a local copy built and started like a dyno

| Moment | RSS | heapUsed | external |
|---|---|---|---|
| Server started | 87 MB | 9 MB | 17 MB |
| Data installed | 95 MB | 9 MB | 14 MB |
| After login, player database, profile, PDF, comparison, team analysis, recruitment, season change | 86 to 97 MB | ≤ 13 MB | ≤ 6 MB |
| Peak (10 simultaneous failed logins, scrypt) | **215 MB** | 10 MB | 6 MB |

The data files are streamed from disk, never loaded into memory. Disk: archive 66 MB, deleted
right after extraction; data 296 MB once installed; during a refresh the old and new copies
coexist briefly (about 660 MB with the archive).

## Architecture

```
Browser ──HTTPS──► Heroku router ──► node dist-server/production.js (web dyno)
                                     │
                                     ├─ /healthz, /login, login bundle, /logo.svg   public
                                     ├─ /api/auth/login|session|logout              public endpoints
                                     └─ session guard (server/privateServer.ts)
                                          ├─ /, /assets/* (application)            dist/
                                          ├─ /data/*.json                          public/data (downloaded at boot, outside dist/)
                                          ├─ /cdn/images/(players|teams)/<id>.webp cdn.pitchapi.dev (fetched server side)
                                          └─ /api/scout-report, /api/ai/*          Gemini (key server side)
```

- `npm run build` produces `dist/` (application + login page, **no data**: `copyPublicDir` is
  off) and `dist-server/production.js` (the server, bundled by Vite, no extra dependency).
- At boot the server downloads `scoutvision-data.tar.gz` from the private `scoutvision-data`
  release with `PITCHAPI_DATA_TOKEN` (first download retried after 30 s, 1, 2, 4… up to 15 minutes
  while no data is installed), extracts it into a fresh, unique work folder
  (`.scoutvision-sync/`, next to the data folder, never served) and swaps it in; two runs never
  overlap. It checks
  the release again every 6 hours (`SCOUTVISION_DATA_REFRESH_HOURS`) and only downloads a new
  archive. The token is a runtime variable: it never reaches the build, the browser or the logs.
- Without a session: a page navigation gets `302 /login?next=…`; any other private request gets
  `401` and never the content. The login page is a separate bundle (`login.html`); its files are
  read from the build manifest and are the only public assets.
- `vite dev` and `vite preview` mount the same guard and always listen on `127.0.0.1` only: a
  development server exposes sources and a module channel by nature, so another device reaches
  ScoutVision through the production server (`npm run build && npm start`), never through Vite.
  Without the three auth variables they run in an explicit **open local mode** (warning in the
  terminal, no logout button). Any `Host` header other than a loopback name gets `403` (DNS
  rebinding: a web page rebound to 127.0.0.1 cannot read the local data or call the API). With the
  auth variables, Vite's hot-reload WebSocket is closed to any connection without a valid,
  non-revoked session (the login page itself has no hot reload in development), and module
  requests over that channel are disabled. The production server refuses to start without them. In development, a Vite
  plugin also refuses to load any file of `public/data`, `dist`, `.cache` or `.env*` as a
  module, whatever the URL (`/@id/`, `@/` alias, absolute path, `?import`, `?raw`), and a request
  without a session only reaches Vite for an allow list: the Vite client and the source files
  of the login page. Any other file of the checkout (data, screenshots, exported reports,
  untracked files) answers `401`.

## Authentication

| Part | Choice |
|---|---|
| Account | one user, `SCOUTVISION_AUTH_USER` (`arnaud`); no sign-up, no reset, no third-party login |
| Password | stored only as a scrypt hash (`node:crypto`, N = 2^16, r = 8, p = 2, 16-byte salt, one of the OWASP parameter sets: 64 MiB per check) in `SCOUTVISION_AUTH_PASSWORD_HASH` |
| Check | constant-time comparison; the hash is always computed, even for a wrong username: same message (« Identifiants incorrects. ») and similar time |
| Session | HMAC-SHA256 signed token (user, expiry, id, fingerprint of the password hash) in cookie `__Host-sv_session`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, 7 days |
| Logout | `POST /api/auth/logout`: cookie cleared, token id revoked immediately on the server |
| Rate limit | 5 failed logins per IP per 15 minutes, then `429` with `Retry-After`; the attempt is counted **before** the hash is computed, so a burst of parallel requests cannot exceed it; at most 2 password checks at once (memory bounded), extra requests get `429`; above 50 failures across all IPs per 15 minutes, checks run one at a time with a 1 s delay |
| Known device | after a successful login the browser also keeps `__Host-sv_device` (`HttpOnly`, `Secure`, `SameSite=Strict`, 180 days, signed, kept after logout). It grants no access by itself; it only gives that browser its own password-check slot, outside the slowdown, so strangers flooding the login cannot keep the owner out (OWASP "device cookies"). It is tied to the current password: changing the password or the session secret voids it. After 3 failed checks with the same device cookie it loses its slot for the window, and when the slot is busy the request uses the normal queue. The per-IP limit still applies |
| Browser | no token in `localStorage` or `sessionStorage`, no secret in the bundle; the password only lives in the form state until the POST |

Endpoints: `POST /api/auth/login` (`{ username, password }` → `{ authenticated, user }` + cookie),
`GET /api/auth/session` (`{ authenticated: true, user }` or `{ authenticated: false }`),
`POST /api/auth/logout`.

### CSRF and origin

The session cookie is `SameSite=Lax`: browsers do not send it on cross-site POST, fetch or
iframe requests. On top of that, every mutation (`login`, `logout`, `/api/*` POST) must carry an
`Origin` (or `Referer`) equal to the site origin (`https://` + request host behind the Heroku
router, or `SCOUTVISION_PUBLIC_ORIGIN`) and must not be `Sec-Fetch-Site: cross-site`; the API endpoints
also require `Content-Type: application/json`, which a cross-site form cannot send without a
CORS preflight that the server never grants. No CSRF token is needed for this same-origin,
single-user app. All GET endpoints are read-only.

### Security headers

`Content-Security-Policy` (`default-src 'self'`, scripts from the site only, Google Fonts,
flag images from `flagcdn.com`, `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`,
`Referrer-Policy: same-origin`, `Permissions-Policy` (camera, microphone, geolocation, payment,
USB off), `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy` and
`Cross-Origin-Resource-Policy: same-origin`, `X-Robots-Tag: noindex, nofollow`, and
`Strict-Transport-Security` only when the request arrived over HTTPS (the Heroku router sets
`X-Forwarded-Proto`). HTML is `no-store`; private files are `private`. No source maps are
published.

## Variables

Never prefix any of these with `VITE_`: the build refuses it. All are read by the server at
**runtime**; none is needed at build time.

| Variable | Secret | Purpose |
|---|---|---|
| `SCOUTVISION_AUTH_USER` | no | the only account (`arnaud`) |
| `SCOUTVISION_AUTH_PASSWORD_HASH` | yes | scrypt hash from `npm run auth:secret` |
| `SCOUTVISION_SESSION_SECRET` | yes | 32 random bytes (base64url) signing the sessions |
| `PITCHAPI_DATA_TOKEN` | yes | fine-grained GitHub token, read-only access to the releases of `Cordierarn/PitchApi-big-5` |
| `GEMINI_API_KEY` | yes | AI reports; absent: the AI functions answer "not configured" |
| `GEMINI_MODEL` | no | optional, model of the AI reports |

`NODE_ENV=production` and `PORT` are set by Heroku; the Node version comes from `engines.node`.

Optional: `SCOUTVISION_PUBLIC_ORIGIN` (extra accepted origin, e.g. a custom domain),
`SCOUTVISION_DATA_REFRESH_HOURS` (default 6), `SCOUTVISION_DATA_DIR`, `SCOUTVISION_TRUST_PROXY`
(automatic on a dyno), `SCOUTVISION_HTTPS_REDIRECT` (automatic behind the proxy),
`SCOUTVISION_AI_DEADLINE_MS` (25 000 on a dyno), `SCOUTVISION_COOKIE_SECURE` (default on),
`SCOUTVISION_HSTS`. `SCOUTVISION_DATA_REFRESH_HOURS` is clamped between 1 and 168.

`PITCHAPI_DATA_TOKEN` here is a **separate**, read-only token: the GitHub Actions secret of the
same name has write access to publish the data and should not be reused on the server.

## First deployment (Heroku dashboard)

1. **Student credit**: claim the Heroku offer of the GitHub Student Developer Pack, then add the
   card Heroku asks for (Account settings → Billing).
2. **Generate the credentials locally** (nothing is written to disk):
   ```bash
   npm run auth:secret
   ```
   It prints a strong password (store it in your password manager), its hash and a session
   secret. To hash a password you chose instead, pipe it in:
   `npm run auth:secret -- --stdin` (never as an argument: it would stay in the shell history).
   Clear the terminal afterwards.
3. **Create a read-only GitHub token** (GitHub → Settings → Developer settings → Fine-grained
   tokens): repository `Cordierarn/PitchApi-big-5` only, permission *Contents: Read-only*.
4. **Create the app**: New → Create new app, region Europe. *Resources*: dyno type **Basic**.
5. **Config Vars** (*Settings* → *Reveal Config Vars*): `SCOUTVISION_AUTH_USER` (`arnaud`),
   `SCOUTVISION_AUTH_PASSWORD_HASH`, `SCOUTVISION_SESSION_SECRET`, `PITCHAPI_DATA_TOKEN`,
   `GEMINI_API_KEY`, `GEMINI_MODEL`. Nothing goes into the repository.
6. **GitHub**: *Deploy* → Deployment method **GitHub** → connect `Cordierarn/scoutvision-ai` →
   *Enable Automatic Deploys* from `main` (every push to `main` deploys), or *Deploy Branch* for a
   manual deploy. No Heroku secret is needed in the repository or in GitHub Actions.
7. After the build, *More* → *View logs* shows `ScoutVision en écoute…` then
   `Données installées…`. Check from your own machine that nothing private answers without a
   session:
   ```bash
   npm run verify:private -- https://<app>.herokuapp.com
   ```
8. Open the URL, sign in as `arnaud`.

The same steps work with the Heroku CLI (`heroku create`, `heroku ps:type web=basic`,
`heroku config:set NAME=value`, `git push heroku main`); typing a secret on the command line keeps
it in the shell history, so prefer the dashboard for the secret values.

## Operations

- **Change the password**: run `npm run auth:secret` (or `-- --stdin`), replace
  `SCOUTVISION_AUTH_PASSWORD_HASH` in the Config Vars, save (Heroku restarts the dyno).
  Every existing session and every known-device cookie becomes invalid, because both carry a
  fingerprint of the hash.
- **Revoke every session** without changing the password: replace `SCOUTVISION_SESSION_SECRET`
  with a new value (`npm run auth:secret` prints one) in the Config Vars and save.
- **Log out**: « Se déconnecter » at the bottom of the sidebar. The cookie is cleared and the
  session id revoked on the server.
- **Redeploy**: push to `main` (automatic deploys), or *Deploy* → *Manual deploy* → *Deploy
  Branch*. *More* → *Restart all dynos* restarts without a build (the data is downloaded again).
- **Data update**: the weekly workflow publishes a new `scoutvision-data` release; the server
  picks it up within 6 hours, at the next daily dyno restart, or right away with *Restart all
  dynos*.
- **Local development with authentication**: put the three `SCOUTVISION_*` variables in the
  git-ignored `.env.local`; `npm run dev` then shows the login page on `http://localhost:3000`.
  Without them, the local server stays open.

## Limits

- Revoked session ids are kept in memory: a token stolen **and** used after a logout followed by a
  server restart stays valid until its expiry (7 days). Rotating `SCOUTVISION_SESSION_SECRET`
  invalidates everything at once.
- The login rate limit and the revocation list are per dyno and in memory: one dyno here, and
  both reset at each daily restart. The client IP is the right-most `X-Forwarded-For` entry, the
  one appended by the Heroku router; left-most entries come from the client and are ignored.
- After each dyno restart (at least daily, on deploys and Config Var changes), private data is
  unavailable for the few seconds of the download; a failing GitHub release keeps it unavailable
  until a retry succeeds (30 s, 1, 2, 4… up to 15 minutes between attempts).
- An AI request is cut at 25 s by the server (30 s by the Heroku router): a very slow Gemini
  answer is reported as unavailable instead of timing out silently.
- Data kept in the browser by the app (scouting dossiers, watchlist, saved filters) stays in that
  browser's `localStorage` after logout; it is the user's own data on the user's own device.
- Flags are loaded from `flagcdn.com` (public images keyed by country code).
