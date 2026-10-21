/**
 * ScoutVision AI - Tirs chargés à la demande
 * Un fichier de tirs par compétition et par saison, mis en cache par le dataLoader
 */

import { useState, useEffect } from 'react';
import { ShotEvent } from '../types';
import { dataLoader } from '../services/dataLoader';

export interface UseShotsResult {
  shots: ShotEvent[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Charge les tirs d'une compétition pour une saison d'application ("2024-25")
 */
export function useShots(season: string | undefined, competition: string | undefined): UseShotsResult {
  const [shots, setShots] = useState<ShotEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!season || !competition) {
      setShots([]);
      return;
    }
    let cancelled = false;

    setIsLoading(true);
    setError(null);
    dataLoader.loadShots(season, competition)
      .then(data => {
        if (!cancelled) setShots(data);
      })
      .catch(err => {
        if (cancelled) return;
        setShots([]);
        setError(err instanceof Error ? err.message : 'Unknown error');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [season, competition]);

  return { shots, isLoading, error };
}

export default useShots;
