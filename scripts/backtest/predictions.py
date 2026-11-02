"""
Artefact immuable de prédictions : un parquet par saison dans .research/forecast/predictions/, une ligne
par (match, modèle, version, paramètres). Un bloc déjà présent n'est jamais réécrit sans `overwrite`.
Hash logique du contenu ; fichier compagnon .meta.json.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pandas as pd

from .walk_forward import PREDICTION_COLUMNS

KEY = ["model_id", "model_version", "parameters_hash"]


class ImmutableArtefactError(RuntimeError):
    pass


def logical_hash(df: pd.DataFrame) -> str:
    """Hash du contenu (ordre canonique) ; la date de création n'en fait pas partie : deux exécutions
    identiques donnent le même hash."""
    canon = df.drop(columns=["prediction_created_at"], errors="ignore").sort_values(["match_id"] + KEY, kind="stable").reset_index(drop=True)
    return hashlib.sha256(pd.util.hash_pandas_object(canon.astype(str), index=False).to_numpy().tobytes()).hexdigest()


def read(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame(columns=PREDICTION_COLUMNS)
    df = pd.read_parquet(path)
    for c in ("fitted_at",):
        df[c] = pd.to_datetime(df[c])
    return df


def write(path: Path, new: pd.DataFrame, overwrite: bool = False) -> dict:
    """Ajoute un bloc de prédictions ; refuse de remplacer un bloc (modèle, version, paramètres) déjà écrit."""
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = read(path)
    if len(existing) and len(new):
        keys_new = set(map(tuple, new[KEY].drop_duplicates().to_numpy()))
        keys_old = set(map(tuple, existing[KEY].drop_duplicates().to_numpy()))
        clash = keys_new & keys_old
        if clash and not overwrite:
            raise ImmutableArtefactError(f"bloc déjà écrit dans {path.name} : {sorted(clash)}")
        if clash:
            existing = existing[~existing[KEY].apply(tuple, axis=1).isin(clash)]
    df = pd.concat([existing, new[PREDICTION_COLUMNS]], ignore_index=True) if len(existing) else new[PREDICTION_COLUMNS].copy()
    df.to_parquet(path, index=False)
    meta = {"rows": int(len(df)), "logicalHash": logical_hash(df), "blocks": [dict(zip(KEY, k)) for k in sorted(set(map(tuple, df[KEY].drop_duplicates().to_numpy())))]}
    path.with_suffix(".meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    return meta
