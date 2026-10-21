#!/usr/bin/env bash
# ScoutVision AI - Récupère les données préparées par la CI
# (asset scoutvision-data.tar.gz de la release privée scoutvision-data de PitchApi-big-5)
# et les installe dans public/data/. Il faut `gh` connecté avec un accès en lecture au dépôt.
set -euo pipefail

DATA_REPO="Cordierarn/PitchApi-big-5"
DATA_RELEASE="scoutvision-data"
ASSET="scoutvision-data.tar.gz"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Dans un Codespace, le GITHUB_TOKEN injecté ne voit que ce dépôt : utiliser `gh auth login`
# Un GH_TOKEN qui n'a pas la forme d'un jeton GitHub (secret mal collé) est ignoré
if [ -n "${GH_TOKEN:-}" ] && ! printf '%s' "$GH_TOKEN" | grep -Eq '^(github_pat_|gh[pousr]_)[A-Za-z0-9_]+$'; then
  echo "Avertissement : GH_TOKEN n'est pas un jeton GitHub valide, il est ignoré." >&2
  unset GH_TOKEN
fi

gh_() {
  if [ -n "${CODESPACES:-}" ] && [ -z "${GH_TOKEN:-}" ]; then
    env -u GITHUB_TOKEN gh "$@"
  else
    gh "$@"
  fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Téléchargement de $DATA_RELEASE/$ASSET..."
gh_ release download "$DATA_RELEASE" -R "$DATA_REPO" -p "$ASSET" -D "$tmp"

mkdir -p "$ROOT/public/data"
rm -rf "$ROOT/public/data/players" "$ROOT/public/data/teams" "$ROOT/public/data/shots" "$ROOT/public/data/index.json"
tar -xzf "$tmp/$ASSET" -C "$ROOT/public/data"

python3 - "$ROOT/public/data/index.json" <<'PY'
import json, sys
index = json.load(open(sys.argv[1]))
print(f"Données du {index['generatedAt']} : " + ", ".join(f"{s['id']} ({s['players']} joueurs)" for s in index["seasons"]))
PY
