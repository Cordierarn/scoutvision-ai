# AI scout reports

The player profile can generate an optional written summary of ScoutVision's analyses with
Gemini. Gemini **summarises**: it does not compute any ScoutVision model, index or projection,
and it may only use the structured facts that ScoutVision sends. ScoutVision works fully
without it.

## Architecture

The browser never calls Gemini. The "Générer" button of the player profile posts the player
row and the computed indicators to `POST /api/scout-report`; the server validates the input,
builds the prompt and calls Gemini with `GEMINI_API_KEY`.

```
Frontend (PlayerCard) → POST /api/scout-report (server/) → Gemini API
```

| File | Role |
|---|---|
| `server/scoutReport.ts` | input validation, model resolution, retry, handler |
| `server/reportFacts.ts` | structured facts and prompt |
| `server/reportAudit.ts` | deterministic check of the generated text |
| `server/scoutReportPlugin.ts` | Node middleware `(req, res, next)`, Vite plugin, Gemini call |
| `services/scoutReportService.ts` | client: request, cache, footer label |

## Configuration

| Variable | Use |
|---|---|
| `GEMINI_API_KEY` | Gemini key, read by the endpoint only. Without it, the endpoint answers 503 and the rest of the app works |
| `GEMINI_MODEL` | Gemini model, default `gemini-3.5-flash` |

Both live in the server environment only (`.env.local` locally, git-ignored). Never prefix them
with `VITE_`: the build stops if a `VITE_` variable looks like a secret.

```env
GEMINI_API_KEY=your_gemini_api_key_here
# GEMINI_MODEL=gemini-3.5-flash   # optional, this is the default
```

The footer of the report shows the model that actually wrote it: the model version returned by
the API (it can differ from the configured one), sent back by the server in the response
metadata (`meta.model`, `meta.requestedModel`, `meta.generatedAt`).

## Structured facts

Gemini receives named facts, not the raw player row (`buildReportFacts`):

- identity: name, team, competition, position, midfield profile, age, birth date, height, foot,
  nationality code;
- sample: matches, starts, minutes, share of team minutes, `seasonInProgress`;
- team context: possession, PPDA, field tilt, playing style;
- values, sent separately and defined in the prompt: `marketValueTransfermarkt` (current
  Transfermarkt market value) and `estimatedValueScoutVision` (statistical estimate of the
  ScoutVision model, typical error ×1.7);
- contract end;
- ScoutVision role indices (best roles of the player profile);
- metrics with their value and percentile; metrics that the official role presets count
  "less is better" are flagged `lessIsPreferable`;
- other season totals (goals, assists, xG…), without percentile;
- shot profile;
- ScoutVision indicators with their limits: RAPM and its league reliability, finishing skill and
  its sample, share of team passes, team style, statistical projection for next season.

## Grounding rules

The prompt is written in English; the report must be entirely in French (headings, labels and
conclusions), in 5 sections:

1. Contexte et profil
2. Analyse de la performance
3. Forces et limites statistiques
4. Projection et contexte
5. Priorités d'observation

Rules:

- only the data sent; no outside knowledge about the player, club, league or career;
- an absent metric is omitted, never described as weak, strong or unknown, never signalled as
  missing;
- nothing about passes under pressure, pressure applied, off-the-ball runs, top speed,
  acceleration, mentality, personality, maturity, leadership, intelligence, concentration,
  cultural adaptation, injuries, salary, transfer price, release clause or interest from clubs,
  unless a field provides it;
- every number must come from the data (rounding allowed); no ratios, sums or new indicators;
- the Transfermarkt value is never a price or a ScoutVision estimate; no transfer price;
- percentiles stay relative to their comparison group ("95e percentile de son groupe de
  comparaison"), never "elite" or "world class";
- season in progress: said once, in section 1; never when the season is finished;
- no future level or league; a ScoutVision projection is rephrased as
  "projection statistique ScoutVision", in percentiles, with its limits;
- no recruitment decision or verdict: section 5 lists 3 to 5 points to check on video, each tied
  to a data point;
- at most 5 strengths and 5 limits; "less is better" metrics with a high percentile are limits;
- "Rating" (match-rating average) never supports a conclusion.

## Post-generation check

`auditReport` (`server/reportAudit.ts`) checks the text deterministically:

- forbidden topics (allowed when a matching metric is in the data);
- numbers absent from the data, and season counts attached to the wrong field (e.g. xG written
  as goals);
- "less is better" metrics in the wrong column (high percentile listed as a strength, low
  percentile listed as a limit);
- English headings and missing French headings;
- season caveat missing, repeated, or present when the season is finished.

Any problem triggers **one correction pass**: the model receives its draft and the list of
broken rules and rewrites the report. What still breaks a rule afterwards is removed sentence by
sentence (`sanitizeReport`); a missing season caveat is added once in section 1.

## Retry, limits and errors

| | |
|---|---|
| Retry | 429, 502, 503 only (not a daily-quota 429): 3 attempts at most, exponential delay with jitter (≈ 0.6-1.2 s, then 1.2-1.8 s); never 400, 401, 403, 404 |
| Limits | JSON only, body ≤ 128 KB (413 above), 20 reports per 10 min per client (429), 60 s Gemini timeout per call, up to 2 calls per report (correction pass) |
| Errors | 400 invalid input, 503 key not configured, 502 Gemini failure; messages are generic |
| Free tier | Gemini quotas are per model and per day (e.g. 20 requests a day for the Flash models, 500 for Flash-Lite, Oct. 2026): set `GEMINI_MODEL` to another model if the default one is exhausted |

## Security

- The key is read on the server only and never returned to the browser; the client bundle
  contains neither the key nor the Gemini SDK.
- Logs hold statuses and issue counts only, never the key, the prompt or the generated text;
  the key is masked in error messages.
- The endpoint builds the prompt itself: it is not an open Gemini proxy.

## Deployment

The repository has no hosting configuration: the app is a Vite single-page app
whose server already proxies `/cdn` (images). The endpoint is mounted on the same Vite servers:

- `npm run dev` (development) and `npm run build && npm run preview` (production build) serve
  `/api/scout-report` and `/cdn` with no extra service. This is the supported way to run the app.
- On a static host (plain `dist/` on a CDN), the endpoint does not exist: the report shows
  "endpoint absent", the rest of the app works. To enable it, run `scoutReportMiddleware`
  (`server/scoutReportPlugin.ts`, signature `(req, res, next)`) on any Node server (http,
  Express, Connect) next to `dist/`, or wrap `handleScoutReport` (`server/scoutReport.ts`) in the
  serverless function of your platform, and set `GEMINI_API_KEY` in its environment. The same
  host must rewrite `/cdn/*` (see [data-format.md](data-format.md#images)).

## Limitations

- The direction of a metric (more is better or worse) can only be checked for the metrics the
  role presets flag "less is better"; for the others the prompt guides the model.
- The number check verifies that a number exists in the data, not always that it is attached to
  the right metric (except season counts).
- Removing a sentence after the correction pass can drop a valid sentence in rare cases.
- A report takes one or two Gemini calls (about 10 to 60 s).
- The report summarises ScoutVision's numbers; it adds no information and must be read as a
  draft, not as an assessment.
