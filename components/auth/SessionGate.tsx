/**
 * ScoutVision - vérification de session avant l'application
 *
 * L'application n'est montée qu'après confirmation de la session par le serveur : aucune donnée
 * n'est demandée, aucun écran privé n'est rendu pendant la vérification. Sans session : page de
 * connexion (avec retour à l'emplacement demandé).
 */

import React, { useEffect, useState } from 'react';
import { AuthContext, SessionState, checkSession, redirectToLogin } from '../../services/authService';

const SessionGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<{ status: 'checking' } | { status: 'error' } | { status: 'ready'; session: SessionState }>({ status: 'checking' });

  const check = () => {
    setState({ status: 'checking' });
    void checkSession().then(r => {
      if (r.status === 'authenticated') setState({ status: 'ready', session: r.session });
      else if (r.status === 'anonymous') redirectToLogin();
      else setState({ status: 'error' });
    });
  };
  useEffect(check, []);

  if (state.status === 'ready') return <AuthContext.Provider value={state.session}>{children}</AuthContext.Provider>;
  return (
    <div className="fixed inset-0 bg-canvas flex items-center justify-center px-4">
      {state.status === 'checking' ? (
        <div role="status" aria-label="Vérification de la session" className="w-5 h-5 border-2 border-line-strong border-t-accent rounded-full animate-spin" />
      ) : (
        <div role="alert" className="text-center space-y-3">
          <p className="text-sm text-ink-2">Impossible de vérifier la session pour le moment.</p>
          <button type="button" className="sv-btn sv-btn-secondary" onClick={check}>Réessayer</button>
        </div>
      )}
    </div>
  );
};

export default SessionGate;
