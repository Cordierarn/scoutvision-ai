/**
 * ScoutVision - données privées en production : téléchargement de la release scoutvision-data
 *
 * Au démarrage du serveur (puis à intervalle régulier), l'archive scoutvision-data.tar.gz de la
 * release privée est téléchargée par l'API REST GitHub avec PITCHAPI_DATA_TOKEN (variable du
 * serveur, jamais transmise au navigateur ni écrite dans les journaux), puis extraite dans un
 * dossier neuf et substituée d'un bloc au dossier de données. Les données ne passent jamais par
 * le build ni par dist/ : seul le garde d'accès (server/privateServer.ts) les sert, après connexion.
 * Une archive déjà installée (même identifiant et même date) n'est pas retéléchargée.
 */

import { execFile } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface DataSyncOptions {
  token: string;
  dataDir: string;
  repo?: string;              // dépôt privé des releases
  release?: string;           // tag de la release
  asset?: string;             // nom de l'archive
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}

export interface DataSyncResult { status: 'updated' | 'current' | 'failed'; updatedAt?: string; message?: string }

const MARKER = '.release.json';
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;

/** Les données sont-elles installées (index.json présent) ? */
export const dataInstalled = (dataDir: string) => existsSync(path.join(dataDir, 'index.json'));

export async function syncData(opts: DataSyncOptions): Promise<DataSyncResult> {
  const repo = opts.repo ?? 'Cordierarn/PitchApi-big-5';
  const release = opts.release ?? 'scoutvision-data';
  const assetName = opts.asset ?? 'scoutvision-data.tar.gz';
  const fetchImpl = opts.fetchImpl ?? fetch;
  const log = opts.log ?? (m => console.log(m));
  const headers = { Authorization: `Bearer ${opts.token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'scoutvision-server' };
  const dataDir = path.resolve(opts.dataDir);
  // Dossier de travail unique par exécution, caché, à côté du dossier de données (même volume pour
  // la substitution par renommage) ; le serveur ne sert que le dossier de données lui-même
  let work: string | null = null;

  try {
    const workRoot = path.join(path.dirname(dataDir), '.scoutvision-sync');
    mkdirSync(workRoot, { recursive: true });
    work = mkdtempSync(path.join(workRoot, 'run-'));
    const meta = await fetchImpl(`https://api.github.com/repos/${repo}/releases/tags/${release}`, { headers: { ...headers, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30_000) });
    if (!meta.ok) return { status: 'failed', message: `release ${release} inaccessible (HTTP ${meta.status})` };
    const info = await meta.json() as { assets?: { id: number; name: string; size: number; updated_at: string }[] };
    const asset = info.assets?.find(a => a.name === assetName);
    if (!asset) return { status: 'failed', message: `${assetName} absent de la release ${release}` };
    if (asset.size > MAX_ARCHIVE_BYTES) return { status: 'failed', message: 'archive trop volumineuse' };

    const markerPath = path.join(dataDir, MARKER);
    if (dataInstalled(dataDir) && existsSync(markerPath)) {
      const current = JSON.parse(readFileSync(markerPath, 'utf8')) as { id?: number; updatedAt?: string };
      if (current.id === asset.id && current.updatedAt === asset.updated_at) return { status: 'current', updatedAt: asset.updated_at };
    }

    mkdirSync(path.join(work, 'data'), { recursive: true });
    const archive = path.join(work, assetName);
    // L'en-tête Authorization n'est pas transmis à l'hôte de stockage lors de la redirection (autre origine)
    const download = await fetchImpl(`https://api.github.com/repos/${repo}/releases/assets/${asset.id}`, { headers: { ...headers, Accept: 'application/octet-stream' }, redirect: 'follow', signal: AbortSignal.timeout(10 * 60_000) });
    if (!download.ok || !download.body) return { status: 'failed', message: `téléchargement refusé (HTTP ${download.status})` };
    await pipeline(Readable.fromWeb(download.body as never), createWriteStream(archive));
    if (statSync(archive).size !== asset.size) return { status: 'failed', message: 'archive incomplète' };

    // Extraction dans un dossier neuf (GNU tar refuse les chemins absolus et les « .. »)
    await run('tar', ['-xzf', archive, '-C', path.join(work, 'data'), '--no-same-owner', '--no-same-permissions'], { maxBuffer: 1024 * 1024 });
    const fresh = path.join(work, 'data');
    if (!dataInstalled(fresh)) return { status: 'failed', message: 'archive sans index.json' };
    writeFileSync(path.join(fresh, MARKER), JSON.stringify({ id: asset.id, updatedAt: asset.updated_at }));

    // Substitution d'un bloc : les fichiers déjà ouverts restent lisibles jusqu'à la fin de leur envoi
    const old = path.join(work, 'previous');
    if (existsSync(dataDir)) renameSync(dataDir, old);
    mkdirSync(path.dirname(dataDir), { recursive: true });
    renameSync(fresh, dataDir);
    rmSync(old, { recursive: true, force: true });
    log(`Données installées : ${assetName} du ${asset.updated_at} (${Math.round(asset.size / 1e6)} Mo).`);
    return { status: 'updated', updatedAt: asset.updated_at };
  } catch (error) {
    // Message sans jeton : seules les erreurs réseau ou système sont rapportées
    const text = error instanceof Error ? `${error.name}: ${error.message}` : 'erreur inconnue';
    return { status: 'failed', message: text.split(opts.token).join('***').slice(0, 200) };
  } finally {
    if (work) rmSync(work, { recursive: true, force: true });
  }
}
