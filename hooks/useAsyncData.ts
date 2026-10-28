/**
 * ScoutVision - chargement asynchrone avec états explicites
 *
 *   idle     rien à charger (donnée sans objet pour ce joueur)
 *   loading  requête en cours : afficher un squelette, jamais « aucune donnée »
 *   success  donnée reçue (éventuellement vide : c'est alors un vrai « aucune donnée »)
 *   error    échec : erreur discrète et « Réessayer »
 *
 * Le dataLoader retire une requête échouée de son cache : retry() relance un vrai chargement.
 */

import { useCallback, useEffect, useMemo, useState, type DependencyList } from 'react';

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncData<T> {
  status: AsyncStatus;
  data: T | undefined;
  error: string | null;
  retry: () => void;
}

interface State<T> {
  token: object;
  status: AsyncStatus;
  data: T | undefined;
  error: string | null;
}

/**
 * load : fonction de chargement, ou null quand il n'y a rien à charger (idle).
 * deps : dépendances qui déclenchent un nouveau chargement (comme useEffect).
 */
export function useAsyncData<T>(load: (() => Promise<T>) | null, deps: DependencyList): AsyncData<T> {
  const [attempt, setAttempt] = useState(0);
  // Jeton propre à chaque requête : l'état d'une requête précédente n'est jamais montré pour la nouvelle
  const token = useMemo(() => ({}), [...deps, attempt]);
  const enabled = load !== null;
  const [state, setState] = useState<State<T>>({ token, status: enabled ? 'loading' : 'idle', data: undefined, error: null });

  useEffect(() => {
    if (!load) {
      setState({ token, status: 'idle', data: undefined, error: null });
      return;
    }
    let cancelled = false;
    setState({ token, status: 'loading', data: undefined, error: null });
    load()
      .then(data => { if (!cancelled) setState({ token, status: 'success', data, error: null }); })
      .catch(err => {
        if (!cancelled) setState({ token, status: 'error', data: undefined, error: err instanceof Error ? err.message : String(err) });
      });
    return () => { cancelled = true; };
  }, [token]);

  const retry = useCallback(() => setAttempt(a => a + 1), []);

  // Rendu qui précède l'effet d'une nouvelle requête : déjà « loading » (ou « idle »)
  if (state.token !== token) {
    return { status: enabled ? 'loading' : 'idle', data: undefined, error: null, retry };
  }
  return { status: state.status, data: state.data, error: state.error, retry };
}

export default useAsyncData;
