/**
 * Test personnel partagé entre l'onglet « Mon test » et le plan de l'assistant IA : lu dans le stockage du
 * navigateur et mis à jour à chaque sauvegarde (événement local) ou modification depuis un autre onglet.
 */

import { useSyncExternalStore } from 'react';
import { MY_TEST_EVENT, MY_TEST_KEY, MyTest, emptyTest, parseMyTest, readStoredRaw } from './myTestLogic';

let cachedRaw: string | null | undefined;
let cachedTest: MyTest = emptyTest();
const serverTest = emptyTest();

function snapshot(): MyTest {
  const raw = readStoredRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedTest = (raw ? parseMyTest(raw) : null) ?? emptyTest();
  }
  return cachedTest;
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === MY_TEST_KEY) onChange(); };
  window.addEventListener(MY_TEST_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => { window.removeEventListener(MY_TEST_EVENT, onChange); window.removeEventListener('storage', onStorage); };
}

export function useMyTest(): MyTest {
  return useSyncExternalStore(subscribe, snapshot, () => serverTest);
}
