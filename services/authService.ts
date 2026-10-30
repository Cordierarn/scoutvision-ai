/**
 * ScoutVision - session côté navigateur
 *
 * Le navigateur ne détient jamais de jeton lisible : la session est un cookie HttpOnly posé par
 * le serveur (POST /api/auth/login). Ce module se contente de demander l'état de la session,
 * de se déconnecter, et de renvoyer vers la page de connexion quand le serveur répond 401.
 * Rien n'est écrit dans localStorage ni sessionStorage.
 */

import { createContext, useContext } from 'react';

export interface SessionState { user: string | null; open: boolean }
export type SessionCheck = { status: 'authenticated'; session: SessionState } | { status: 'anonymous' } | { status: 'error' };

export const LOGIN_PATH = '/login';

/**
 * Destination de retour : chemin interne uniquement (même règle que le serveur). Caractères de
 * contrôle, espaces et barres obliques inverses refusés : le navigateur retire tabulations et
 * retours à la ligne d'une URL (« /\t/site » deviendrait « //site »).
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || value.length > 512 || /[\x00-\x20\x7f\\]/.test(value) || !value.startsWith('/') || value.startsWith('//')) return '/';
  let url: URL;
  try { url = new URL(value, 'http://scoutvision.invalid'); } catch { return '/'; }
  if (url.origin !== 'http://scoutvision.invalid') return '/';
  const p = url.pathname;
  if (p === LOGIN_PATH || p.startsWith('/api/') || p.startsWith('/data/') || p.startsWith('/cdn/')) return '/';
  return `${p}${url.search}`;
}

/** Page de connexion avec retour à l'emplacement courant (le fragment, ex. #partage=…, est conservé) */
export function loginUrl(): string {
  const here = `${window.location.pathname}${window.location.search}`;
  const next = safeNext(here);
  return `${LOGIN_PATH}${next === '/' ? '' : `?next=${encodeURIComponent(next)}`}${window.location.hash}`;
}

export function redirectToLogin(): void {
  window.location.replace(loginUrl());
}

export async function checkSession(): Promise<SessionCheck> {
  try {
    const res = await fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return { status: 'error' };
    const body = await res.json() as { authenticated?: boolean; user?: string | null; open?: boolean };
    return body.authenticated ? { status: 'authenticated', session: { user: body.user ?? null, open: body.open === true } } : { status: 'anonymous' };
  } catch {
    return { status: 'error' };
  }
}

export type LoginResult = { ok: true } | { ok: false; status: number; message: string };

export async function login(username: string, password: string): Promise<LoginResult> {
  let res: Response;
  try {
    res = await fetch('/api/auth/login', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
    });
  } catch {
    return { ok: false, status: 0, message: 'Connexion au serveur impossible. Vérifiez votre réseau et réessayez.' };
  }
  if (res.ok) return { ok: true };
  if (res.status === 401) return { ok: false, status: 401, message: 'Identifiants incorrects.' };
  if (res.status === 429) {
    const wait = Number(res.headers.get('Retry-After')) || 900;
    const minutes = Math.max(1, Math.ceil(wait / 60));
    return { ok: false, status: 429, message: `Trop de tentatives. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.` };
  }
  return { ok: false, status: res.status, message: 'Le serveur n\'a pas pu traiter la connexion. Réessayez dans un instant.' };
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
  } finally {
    window.location.replace(LOGIN_PATH);
  }
}

/**
 * Session expirée pendant l'utilisation : toute réponse 401 d'une requête de l'application renvoie
 * vers la page de connexion. Retour arrière depuis le cache du navigateur (bfcache) : la session
 * est revérifiée avant de laisser la page affichée.
 */
export function installSessionGuard(): void {
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await original(input, init);
    if (res.status === 401) {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url, window.location.href);
      if (url.origin === window.location.origin && !url.pathname.startsWith('/api/auth/')) redirectToLogin();
    }
    return res;
  };
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    document.documentElement.style.visibility = 'hidden';
    void checkSession().then(r => {
      if (r.status === 'authenticated') document.documentElement.style.visibility = '';
      else redirectToLogin();
    });
  });
}

export const AuthContext = createContext<SessionState>({ user: null, open: true });
export const useAuth = () => useContext(AuthContext);

/** Nom affiché : identifiant avec une majuscule (« arnaud » → « Arnaud ») */
export const displayName = (user: string | null) => (user ? user.charAt(0).toUpperCase() + user.slice(1) : '');
