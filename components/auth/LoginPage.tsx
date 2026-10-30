/**
 * ScoutVision - page de connexion (accès privé, un seul compte)
 *
 * Bundle séparé (login.html) : aucune donnée ni code de l'application n'est chargé avant la
 * connexion. Le mot de passe n'existe que dans l'état du formulaire jusqu'à l'envoi ; la session
 * est ensuite un cookie HttpOnly posé par le serveur. Pas d'inscription, pas de mot de passe
 * oublié, pas de connexion tierce.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { checkSession, login, safeNext } from '../../services/authService';

/** Destination après connexion : ?next= (chemin interne) et fragment d'origine (#partage=…) */
function destination(): string {
  const next = safeNext(new URLSearchParams(window.location.search).get('next'));
  return `${next}${window.location.hash}`;
}

const Mark: React.FC = () => (
  <svg viewBox="0 0 80 96" className="w-9 h-11" aria-hidden>
    <polygon points="0,0 40,0 80,48 54,48 26,16 0,16" fill="#F8FAFC" />
    <polygon points="80,96 40,96 0,48 26,48 54,80 80,80" fill="#00E5FF" />
  </svg>
);

const LoginPage: React.FC = () => {
  const uid = useId();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Déjà connecté (retour arrière, onglet restauré) : directement vers l'application
  useEffect(() => {
    void checkSession().then(r => { if (r.status === 'authenticated' && !r.session.open) window.location.replace(destination()); });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) {
      setError('Saisissez votre identifiant et votre mot de passe.');
      (username.trim() ? passwordRef : userRef).current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const result = await login(username.trim(), password);
    if (!('message' in result)) {
      setPassword('');
      window.location.replace(destination());
      return;
    }
    setBusy(false);
    setError(result.message);
    if (result.status === 401) {
      setPassword('');
      requestAnimationFrame(() => passwordRef.current?.focus());
    }
  };

  const errorId = `${uid}-error`;
  return (
    <div className="fixed inset-0 overflow-y-auto bg-canvas">
      <main className="min-h-full flex flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-[22rem]">
          <div className="flex flex-col items-center text-center mb-8">
            <Mark />
            <h1 className="mt-4 text-ink text-[15px] font-semibold tracking-[0.32em] pl-[0.32em]">SCOUTVISION</h1>
            <p className="mt-1.5 text-[13px] text-ink-3">Football scouting, measured.</p>
          </div>

          <section className="sv-panel p-5 sm:p-6" aria-labelledby={`${uid}-title`}>
            <h2 id={`${uid}-title`} className="sv-label mb-4">Accès privé</h2>
            <form onSubmit={submit} noValidate aria-busy={busy} aria-describedby={error ? errorId : undefined} className="space-y-4">
              <div>
                <label htmlFor={`${uid}-user`} className="block text-[13px] text-ink-2 mb-1.5">Identifiant</label>
                <input ref={userRef} id={`${uid}-user`} name="username" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off"
                  spellCheck={false} autoFocus required value={username} onChange={e => setUsername(e.target.value)}
                  aria-invalid={error ? true : undefined} className="sv-input h-10 text-[15px]" />
              </div>
              <div>
                <label htmlFor={`${uid}-password`} className="block text-[13px] text-ink-2 mb-1.5">Mot de passe</label>
                <div className="relative">
                  <input ref={passwordRef} id={`${uid}-password`} name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password"
                    required value={password} onChange={e => setPassword(e.target.value)} aria-invalid={error ? true : undefined}
                    className="sv-input h-10 text-[15px] pr-11" />
                  <button type="button" onClick={() => setShowPassword(v => !v)} aria-controls={`${uid}-password`} aria-pressed={showPassword}
                    aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                    className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-8 h-8 rounded-md text-ink-3 hover:text-ink hover:bg-overlay transition-colors">
                    {showPassword ? <EyeOff className="w-4 h-4" aria-hidden /> : <Eye className="w-4 h-4" aria-hidden />}
                  </button>
                </div>
              </div>

              {error && (
                <div id={errorId} role="alert" className="flex items-start gap-2 rounded-md border border-neg/40 bg-neg/10 px-3 py-2 text-[13px] text-ink">
                  <AlertCircle className="w-4 h-4 mt-px shrink-0 text-neg" aria-hidden />
                  <span>{error}</span>
                </div>
              )}

              <button type="submit" disabled={busy} className="sv-btn sv-btn-primary w-full h-10 text-[14px]">
                {busy && <span className="w-3.5 h-3.5 border-2 border-accent-ink/30 border-t-accent-ink rounded-full animate-spin" aria-hidden />}
                {busy ? 'Connexion…' : 'Se connecter'}
              </button>
              <p role="status" className="sr-only">{busy ? 'Connexion en cours.' : ''}</p>
            </form>
          </section>

          <p className="mt-6 text-center text-2xs text-ink-4">Accès réservé.</p>
        </div>
      </main>
    </div>
  );
};

export default LoginPage;
