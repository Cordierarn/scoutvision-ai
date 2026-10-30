# Private deployment

ScoutVision runs online as a **private, single-user** instance. The repository is public; the
PitchAPI data, the Gemini key and the credentials are not. One Node server sits in front of
everything and refuses every private resource without a valid session.

## Host: Render (one Node web service)

Why Render, briefly:

- the app needs a **Node server** in front of `dist/`, `/data/`, `/cdn/` and `/api/` (Gemini key,
  private data, image proxy): Render runs `npm start` as a plain web service, no rewrite to
  serverless functions, no move to Next.js;
- HTTPS on `<service>.onrender.com`, secret environment variables, deploy on push to `main`,
  custom domain possible later;
- a purely static host (Vercel static, Netlify, GitHub Pages) would publish whatever the build
  contains. Vercel middleware could gate static files, but Gemini would have to move into
  serverless functions and the 300 MB of data into the deployment: more moving parts for one user.
  Railway and Fly.io fit the architecture too; Render has the simplest free tier and a
  Blueprint file (`render.yaml`) that keeps the configuration in the repository without secrets.

Cost: the **free** plan works (512 MB RAM, the instance sleeps after 15 minutes without traffic
and takes about 30 to 60 s to wake up, then about 6 s to download the data). The **Starter**
plan (7 USD per month at the time of writing) removes the sleep. Nothing else is billed: no disk,
no database.

## Architecture

```
Browser ──HTTPS──► Render edge ──► node dist-server/production.js
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
  release with `PITCHAPI_DATA_TOKEN`, extracts it into a fresh folder and swaps it in. It checks
  the release again every 6 hours (`SCOUTVISION_DATA_REFRESH_HOURS`) and only downloads a new
  archive. The token is a runtime variable: it never reaches the build, the browser or the logs.
- Without a session: a page navigation gets `302 /login?next=…`; any other private request gets
  `401` and never the content. The login page is a separate bundle (`login.html`); its files are
  read from the build manifest and are the only public assets.
- `vite dev` and `vite preview` mount the same guard. Without the three auth variables they run
  in an explicit **open local mode** (warning in the terminal, no logout button). The production
  server refuses to start without them.

## Authentication

| Part | Choice |
|---|---|
| Account | one user, `SCOUTVISION_AUTH_USER` (`arnaud`); no sign-up, no reset, no third-party login |
| Password | stored only as a scrypt hash (`node:crypto`, N = 2^17, r = 8, p = 1, 16-byte salt) in `SCOUTVISION_AUTH_PASSWORD_HASH` |
| Check | constant-time comparison; the hash is always computed, even for a wrong username: same message (« Identifiants incorrects. ») and similar time |
| Session | HMAC-SHA256 signed token (user, expiry, id, fingerprint of the password hash) in cookie `__Host-sv_session`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, 7 days |
| Logout | `POST /api/auth/logout`: cookie cleared, token id revoked immediately on the server |
| Rate limit | 5 failed logins per IP per 15 minutes, then `429` with `Retry-After`; 50 failures across all IPs per 15 minutes; never a permanent lock |
| Browser | no token in `localStorage` or `sessionStorage`, no secret in the bundle; the password only lives in the form state until the POST |

Endpoints: `POST /api/auth/login` (`{ username, password }` → `{ authenticated, user }` + cookie),
`GET /api/auth/session` (`{ authenticated: true, user }` or `{ authenticated: false }`),
`POST /api/auth/logout`.

### CSRF and origin

The session cookie is `SameSite=Lax`: browsers do not send it on cross-site POST, fetch or
iframe requests. On top of that, every mutation (`login`, `logout`, `/api/*` POST) must carry an
`Origin` (or `Referer`) equal to the site origin (request host, `RENDER_EXTERNAL_URL`,
`SCOUTVISION_PUBLIC_ORIGIN`) and must not be `Sec-Fetch-Site: cross-site`; the API endpoints
also require `Content-Type: application/json`, which a cross-site form cannot send without a
CORS preflight that the server never grants. No CSRF token is needed for this same-origin,
single-user app. All GET endpoints are read-only.

### Security headers

`Content-Security-Policy` (`default-src 'self'`, scripts from the site only, Google Fonts,
flag images from `flagcdn.com`, `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`,
`Referrer-Policy: same-origin`, `Permissions-Policy` (camera, microphone, geolocation, payment,
USB off), `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy` and
`Cross-Origin-Resource-Policy: same-origin`, `X-Robots-Tag: noindex, nofollow`, and
`Strict-Transport-Security` only when the request arrived over HTTPS (Render sets
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
| `NODE_ENV` | no | `production` |
| `NODE_VERSION` | no | Node version used by Render (22.x) |

Optional: `SCOUTVISION_PUBLIC_ORIGIN` (extra accepted origin, e.g. a custom domain),
`SCOUTVISION_DATA_REFRESH_HOURS` (default 6), `SCOUTVISION_DATA_DIR`, `SCOUTVISION_TRUST_PROXY`
(automatic on Render), `SCOUTVISION_COOKIE_SECURE` (default on), `SCOUTVISION_HSTS`.
Render sets `PORT`, `RENDER` and `RENDER_EXTERNAL_URL` itself.

`PITCHAPI_DATA_TOKEN` here is a **separate**, read-only token: the GitHub Actions secret of the
same name has write access to publish the data and should not be reused on the server.

## First deployment

1. **Generate the credentials locally** (nothing is written to disk):
   ```bash
   npm run auth:secret
   ```
   It prints a strong password (store it in your password manager), its hash and a session
   secret. To hash a password you chose instead, pipe it in:
   `npm run auth:secret -- --stdin` (never as an argument: it would stay in the shell history).
   Clear the terminal afterwards.
2. **Create a read-only GitHub token** (Settings → Developer settings → Fine-grained tokens):
   repository `Cordierarn/PitchApi-big-5` only, permission *Contents: Read-only*.
3. **Render**: New → Blueprint → this repository (`render.yaml`). Render asks for the values
   marked `sync: false`: paste the hash, the session secret, the GitHub token, the Gemini key
   and the model. Nothing is stored in the repository.
4. Wait for the first deploy, then check from your own machine that nothing private answers
   without a session:
   ```bash
   npm run verify:private -- https://<service>.onrender.com
   ```
5. Open the URL, sign in as `arnaud`.

## Operations

- **Change the password**: run `npm run auth:secret` (or `-- --stdin`), replace
  `SCOUTVISION_AUTH_PASSWORD_HASH` in the Render dashboard, save (Render restarts the service).
  Every existing session becomes invalid, because the token carries a fingerprint of the hash.
- **Revoke every session** without changing the password: replace `SCOUTVISION_SESSION_SECRET`
  with a new value (`npm run auth:secret` prints one) and save.
- **Log out**: « Se déconnecter » at the bottom of the sidebar. The cookie is cleared and the
  session id revoked on the server.
- **Redeploy**: push to `main` (auto-deploy), or *Manual Deploy* in the dashboard.
- **Data update**: the weekly workflow publishes a new `scoutvision-data` release; the server
  picks it up within 6 hours, or at the next restart (*Restart service* in the dashboard).
- **Local development with authentication**: put the three `SCOUTVISION_*` variables in the
  git-ignored `.env.local`; `npm run dev` then shows the login page on `http://localhost:3000`.
  Without them, the local server stays open.

## Limits

- Revoked session ids are kept in memory: a token stolen **and** used after a logout followed by a
  server restart stays valid until its expiry (7 days). Rotating `SCOUTVISION_SESSION_SECRET`
  invalidates everything at once.
- The login rate limit is per instance and in memory (one instance here). Behind Render, the IP
  comes from `X-Forwarded-For`; the global cap (50 failures / 15 min) bounds attempts even if
  that header is spoofed, and can delay the legitimate login during an attack.
- On the free plan, the first request after 15 minutes of inactivity waits for the instance to
  wake up and for the data download.
- Data kept in the browser by the app (scouting dossiers, watchlist, saved filters) stays in that
  browser's `localStorage` after logout; it is the user's own data on the user's own device.
- Flags are loaded from `flagcdn.com` (public images keyed by country code).
