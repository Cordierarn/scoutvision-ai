#!/usr/bin/env node
/**
 * ScoutVision - génération locale des secrets d'authentification (rien n'est écrit sur disque)
 *
 *   npm run auth:secret                 nouveau mot de passe fort + son hash + secret de session
 *   npm run auth:secret -- --stdin      hash d'un mot de passe choisi, lu sur l'entrée standard
 *                                       (jamais en argument : il finirait dans l'historique du shell)
 *
 * Copiez les valeurs directement dans les variables d'environnement de l'hébergeur, puis
 * effacez le terminal. Ne les collez jamais dans un fichier du dépôt, un ticket ou une capture.
 * Format du hash : scrypt:<N>:<r>:<p>:<sel>:<hash> (base64url), lu par server/auth.ts.
 */

import { randomBytes, scrypt } from 'node:crypto';

// Mêmes paramètres que server/auth.ts (DEFAULT_SCRYPT) : 64 Mio par vérification
export const SCRYPT = { N: 2 ** 16, r: 8, p: 2 };

export function hashPassword(password, params = SCRYPT) {
  const salt = randomBytes(16);
  const maxmem = 256 * params.N * params.r + 16 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, 32, { ...params, maxmem }, (err, key) => {
      if (err) reject(err);
      else resolve(['scrypt', params.N, params.r, params.p, salt.toString('base64url'), key.toString('base64url')].join(':'));
    });
  });
}

/** Mot de passe aléatoire : 24 caractères parmi 56 (sans caractères ambigus), ≈ 139 bits */
export function generatePassword(length = 24) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  while (out.length < length) {
    for (const b of randomBytes(64)) {
      if (b < 56 * 4 && out.length < length) out += alphabet[b % 56];
    }
  }
  return out;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

async function main() {
  const fromStdin = process.argv.includes('--stdin');
  const password = fromStdin ? await readStdin() : generatePassword();
  if (password.length < 12) {
    console.error('Mot de passe trop court : 12 caractères au minimum (24 recommandés).');
    process.exit(1);
  }
  const hash = await hashPassword(password);
  const secret = randomBytes(32).toString('base64url');
  const lines = [
    '',
    'ScoutVision : valeurs à copier dans les variables d\'environnement de l\'hébergeur (jamais dans le dépôt).',
    '',
    ...(fromStdin ? [] : ['Mot de passe (à conserver dans votre gestionnaire de mots de passe, il n\'est stocké nulle part) :', `  ${password}`, '']),
    'SCOUTVISION_AUTH_USER', '  arnaud', '',
    'SCOUTVISION_AUTH_PASSWORD_HASH', `  ${hash}`, '',
    'SCOUTVISION_SESSION_SECRET', `  ${secret}`, '',
    'Effacez ensuite le terminal (clear).', '',
  ];
  process.stdout.write(lines.join('\n'));
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
