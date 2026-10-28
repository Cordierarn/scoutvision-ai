/**
 * ScoutVision AI - Tirs chargés à la demande
 * Un fichier de tirs par compétition et par saison, mis en cache par le dataLoader
 */

import { ShotEvent } from '../types';
import { dataLoader } from '../services/dataLoader';
import { useAsyncData, AsyncStatus } from './useAsyncData';

export interface UseShotsResult {
  shots: ShotEvent[];
  isLoading: boolean;
  error: string | null;
  status: AsyncStatus;       // idle (pas de compétition), loading, success, error
  retry: () => void;
}

const NO_SHOTS: ShotEvent[] = [];

/**
 * Charge les tirs d'une compétition pour une saison d'application ("2024-25")
 */
export function useShots(season: string | undefined, competition: string | undefined): UseShotsResult {
  const { status, data, error, retry } = useAsyncData(
    season && competition ? () => dataLoader.loadShots(season, competition) : null,
    [season, competition],
  );
  return { shots: data ?? NO_SHOTS, isLoading: status === 'loading', error, status, retry };
}

export default useShots;
