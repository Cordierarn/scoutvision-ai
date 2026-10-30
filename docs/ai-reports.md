# AI scout reports

The player profile can generate an optional written summary of ScoutVision's analyses with
Gemini. Gemini **summarises**: it does not compute any ScoutVision model, index or projection,
and it may only use the structured facts that ScoutVision sends. ScoutVision works fully
without it.

## Architecture

The browser never calls Gemini. The "Générer" button of the player profile (and of a scouting
dossier) posts the player row and the computed indicators to `POST /api/scout-report`; the
server validates the input, builds the prompt and calls Gemini with `GEMINI_API_KEY`.

```
Frontend (PlayerCard, Rapports) → POST /api/scout-report (server/) → Gemini API
                                ← { content, meta, facts, promptVersion }
```

On success the server answers `{ content, meta, facts, promptVersion }`: the French report,
the metadata of the model that actually wrote it, the exact structured facts the model
received (stored with the report as its data snapshot) and the prompt version. `promptVersion`
is an explicit constant (`PROMPT_VERSION` in `server/reportFacts.ts`, currently
`scout-report-v2`), bumped by hand when the prompt or the facts change; it is never derived
from a date.

| File | Role |
|---|---|
| `server/scoutReport.ts` | input validation, model resolution, retry, handler |
| `server/reportFacts.ts` | structured facts and prompt |
| `server/reportAudit.ts` | deterministic check of the generated text |
| `server/scoutReportPlugin.ts` | Node middleware `(req, res, next)`, Vite plugin, Gemini call |
| `services/scoutReportService.ts` | client: request, cache, footer label |
| `services/scoutReportStore.ts` | local scouting dossiers (localStorage), JSON export/import |
| `components/reports/generateReport.ts` | generation shared by the profile and the Rapports page, stored as a new version |
| `utils/scoutReportSnapshot.ts` | data snapshot of a dossier, freshness comparison |
| `utils/scoutReportPdf.ts` | structured PDF export (native text, vector radar) |

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

The AI endpoints (`/api/scout-report`, `/api/ai/*`) are mounted by `server/privateServer.ts`
**behind the session guard**, on the production server (`npm start`), on `vite preview` and on
`vite dev`: no request reaches Gemini without a valid session and a same-origin `Origin`.
`GEMINI_API_KEY` and `GEMINI_MODEL` are runtime variables of the server; they never appear in
`dist/`, in a response or in the browser. A static host serving `dist/` alone is not supported:
it would have neither the endpoints nor the data guard. See [deployment](deployment.md).

## Scouting dossiers (local V1)

The "Rapports de scouting" page keeps one dossier per player-season row, identified by
`playerSeasonId` (`<Player ID>_<Team ID>_<Competition>_<season>`), never by name, club and
league: homonyms, league and cup rows, and a player's successive clubs are separate dossiers.
The client cache of generated reports uses the same identity.

A dossier (`ScoutReportRecord`, `types/scoutReport.ts`, `schemaVersion: 2`) holds:

- `player`: the row reference (identifiers, name, club, competition, season, position);
- `dataSnapshot`: the `ReportFacts` the model received, the official role indices, structured
  indicators (RAPM, finishing, pass share, valuation), the one-year projection and the date of
  the data; never the whole player row;
- `generatedSummaries`: every Gemini version with its real model, requested model,
  `promptVersion`, date and text; a new generation is appended, never replaces an older one;
- `observations`: human notes (video, live, general) with date, text, optional strengths,
  points to review and conclusion, and an optional observation grid; they are never prefilled by
  the model and never mixed with percentiles or role indices;
- `evaluation`: blind-evaluation state (see below);
- `status` (`draft`, `to_observe`, `finalized`, `archived`), `role`, free text `tags`.

Storage is the browser `localStorage`, single key `scoutvision_scout_reports_v1`. Reading is
tolerant: an unreadable record is ignored and counted, the others are kept. "Exporter mes
rapports" writes a JSON envelope (`kind: scoutvision-scout-reports`) containing only the
dossiers, no key, secret or API cache; "Importer des rapports" validates every record and keeps
the newer version of a dossier already present. Stored dossiers are real local data: they live
in the user's browser and in the files they export, never in the repository.

### Blind evaluation and observation grid (schema v2)

A dossier can be switched to **blind evaluation**: percentiles, role indices, values, the
generated summary and the observation priorities stay hidden (on screen and in the PDF, which
then prints an observation sheet with an empty grid) until the scout saves an observation with
an overall rating, or reveals the data manually. The reveal date is kept.

Each observation can carry an **observation grid** for the dossier's role: the preset's metrics
(labels of the app, inverted metrics flagged) and four dimensions the data does not measure
(behaviour after losing the ball, communication, orientation before receiving, defensive
recovery), each rated 1 (far below the expected level) to 5 (far above) with an optional note,
plus an overall rating. The grid is never prefilled by the data or by the model.

The **data / observation gap** (dossier section I, PDF observation card) juxtaposes the scout's
rating with the percentile band of the snapshot (1 = P0-19 … 5 = P80-100) for each rated role
metric, and counts the criteria observed above, below or within the data's band. It is a
reading aid, never a merged score: neither the data nor the observation is corrected.

Storage schema version 2 adds `evaluation { blind, revealedAt? }` on the record and
`observation.grid` ; the store reads versions 1 and 2, rewrites records in version 2 without
losing any field, and refuses any other version (tested).

When a dossier is opened, its snapshot is compared with the current data of the same row
(sample, percentiles, values, contract, data date); if they differ, a neutral note says that
the current data is more recent than the report. Nothing is replaced automatically.

The PDF export (`utils/scoutReportPdf.ts`, primitives in `utils/scoutReportPdfKit.ts`) is built
only from the stored `ScoutReportRecord` with jsPDF, as native text and vector graphics (nothing
is rasterised from the DOM, html2canvas is gone). Base document in four A4 pages:

1. player summary: identity (photo and flag when they load in the browser), six KPIs, Transfermarkt
   value and ScoutVision statistical estimate, role badges ("Indice composite 0–100, et non
   percentile"), role radar, statistical strengths and limits;
2. impact and development: model indicators (RAPM, finishing, pass share, relay role, value and
   performance) each with value, interpretation, context and limit; the ScoutVision statistical
   projection; team context;
3. shots and metrics by family (finishing, creation, progression, possession, circulation,
   defending, duels, goalkeeping, models), the most marked metrics of each family, sized to fit
   the page; the shot map and heatmap are not part of the snapshot and are not drawn;
4. scouting in three layers: the generated summary (model, prompt version, date), observation
   priorities, "Observation du scout" cards and a conclusion made only of the scout's own fields,
   then a methodology note.

"PDF" exports this summary with the latest generated summary only; "PDF complet" adds an annex
with the older summaries and every metric. Each page has a one-line footer (player, season,
status, report date, page X / Y). Long texts paginate without cutting a block, the file name is
`ScoutVision_<player>_<season>_<date>.pdf`, and the build returns an audit (smallest font used,
text outside the margins, empty sections) checked by the tests. Fonts: the standard Helvetica
set, so the text is extractable and a report weighs 20 to 50 KB; characters outside Latin-1 are
transliterated (an embedded Unicode font such as Inter or Noto Sans would add 300 to 600 KB per
style without subsetting, which is why it was not adopted).

Without `GEMINI_API_KEY`, generation answers 503 and the dossier still works: snapshot,
observations, status, tags, JSON export/import and PDF.

## Grounded AI functions (`/api/ai/*`)

Three more functions share the report's server guard (`server/groundedAi.ts`, routed by the same
middleware with the same body limit, rate limiter and 503 without `GEMINI_API_KEY`). The browser
sends only facts ScoutVision already computed; the server builds the prompt (never an open proxy),
calls Gemini with retry, audits the text (any number absent from the facts, any unmeasured topic,
any verdict, missing headings), runs one correction pass and removes the sentences still at
fault. Each answer carries the real model, the exact facts sent and an explicit prompt version
(`ai-compare-v1`, `ai-opposition-v1`, `ai-hunter-v1`). Results are not stored.

| Function | Where | Facts sent | Output |
|---|---|---|---|
| `compare` | Comparison page (players compared), Recruitment candidate dossier (candidate vs starter) | `ReportFacts` of each player, built server-side from the rows | four sections: profiles, main differences, complementarity and context, points to verify |
| `opposition` | Team analysis, Style tab | `utils/oppositionFacts.ts`: season stats with league rank, main formation and starters, squad profile, most-used players with their role; never a raw row | four sections: identity and results, style and trends, statistical strengths and vulnerabilities, points to prepare |
| `hunter` | Gem Hunter, "Décrire le profil recherché" | the scout's sentence (500 characters max) and the catalogue (positions, roles, metric keys, competitions, season capabilities) | a strict JSON configuration validated against the catalogue (unknown role, metric or competition dropped and listed as "non traduit"), shown before being applied; extra criteria become a custom role; the model computes no score |

Validation without a key: unit tests with injected generators (`server/groundedAi.test.ts`) and
browser runs with mocked responses explicitly labelled "MAQUETTE D'AUDIT".

## Limitations

- The direction of a metric (more is better or worse) can only be checked for the metrics the
  role presets flag "less is better"; for the others the prompt guides the model.
- The number check verifies that a number exists in the data, not always that it is attached to
  the right metric (except season counts).
- Removing a sentence after the correction pass can drop a valid sentence in rare cases.
- A report takes one or two Gemini calls (about 10 to 60 s).
- The report summarises ScoutVision's numbers; it adds no information and must be read as a
  draft, not as an assessment.
