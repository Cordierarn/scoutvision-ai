# Data pipeline

ScoutVision does not ship any data. The source data comes from the private repository
[`Cordierarn/PitchApi-big-5`](https://github.com/Cordierarn/PitchApi-big-5) (PitchAPI, 35
competitions, 2021-22 → current season, updated twice a week). It is prepared by CI and
published to a **private** release; this public repository never contains it.

```
PitchApi-big-5 releases ──► update-data.yml (prepare_data.py, prepare_lab.py)
                                   │
                                   ▼
          private release `scoutvision-data` (scoutvision-data.tar.gz) ──► npm run data:pull ──► public/data/
```

## Getting the data

The `gh` CLI must be logged in with read access to `Cordierarn/PitchApi-big-5` (`gh auth login`).

```bash
npm run data:pull        # download the data prepared by CI (~60 MB), no Python needed
```

`scripts/pull_data.sh` downloads `scoutvision-data.tar.gz` from the release and unpacks it into
`public/data/`. A `GH_TOKEN` that does not look like a GitHub token is ignored; in a Codespace,
the injected `GITHUB_TOKEN` only sees this repository: use `gh auth login`.

## Building the data yourself

```bash
pip install -r scripts/requirements.txt
npm run data:prepare                                     # all seasons and competitions
python3 scripts/prepare_data.py --seasons 2026-27        # current season only
python3 scripts/prepare_data.py --no-market-values       # without Transfermarkt
npm run data:lab                                         # Laboratory, after prepare_data.py
```

Archives are cached in `.cache/pitchapi/`; the output goes to `public/data/`
(both are git-ignored: the source data is private).

Models are fitted on the seasons being prepared: run `prepare_data.py` without `--seasons` for
the full fit (age curves and styles use every season). The "model vs market" evaluation
downloads odds from football-data.co.uk: without access to that site the build has no market
evaluation, so a local build should not replace the published archive.

RAPM, finishing and forecasts come from `python -m pitchapi_big5 rapm`, `finishing`
and `forecast`, which the weekly PitchAPI workflow does not run: run them (or add
them to that workflow, before `publish-data`) to keep these indicators current.

## Automatic data updates

`.github/workflows/update-data.yml` runs every Monday and Friday at 10:30 UTC
(after the PitchApi-big-5 update at 08:00) and on demand (*Actions* > *Run workflow*).
It runs `scripts/prepare_data.py` then `scripts/prepare_lab.py` and uploads `scoutvision-data.tar.gz` to the
**private** release `scoutvision-data` of PitchApi-big-5. Nothing is committed
to this public repo, and no artifact or cache holds the data.

The workflow runs on the branch it is started from: scheduled and dispatched runs use `main`, so the role
presets and scripts of `main` decide what is published.

### One-time setup

1. Create a fine-grained personal access token: repository access *only*
   `Cordierarn/PitchApi-big-5`, permission *Contents: Read and write*.
2. Add it to this repo: *Settings* > *Secrets and variables* > *Actions* >
   *New repository secret*, name `PITCHAPI_DATA_TOKEN`.
3. Market values: `market_value.parquet` (output of
   `python -m pitchapi_big5 market-values`) lives in the `scoutvision-data`
   release; `prepare_data.py` reads it automatically. To refresh it:
   `gh release upload scoutvision-data data/external/transfermarkt/market_value.parquet --clobber`
   (from PitchApi-big-5).

### Optional: trigger right after the PitchAPI update

Add this last step to the PitchApi-big-5 workflow (with a secret `SCOUTVISION_DISPATCH_TOKEN`: a
fine-grained PAT on `Cordierarn/scoutvision-ai` with *Contents: Read and write*):

```yaml
      - name: Notify ScoutVision
        run: gh api repos/Cordierarn/scoutvision-ai/dispatches -f event_type=pitchapi-data-updated
        env:
          GH_TOKEN: ${{ secrets.SCOUTVISION_DISPATCH_TOKEN }}
```

## Manual update procedure

1. *Actions* > *Mise à jour des données ScoutVision* > *Run workflow* (on `main`, or on a
   branch whose presets or scripts should be published).
2. Check that the run succeeded: the summary lists players, teams and competitions per season.
3. `npm run data:pull` to fetch the new archive locally.
