import { useEffect, useRef } from 'react';
import { personalRecords } from '@igv/core';
import { useGame } from '../data/store';
import { sfx } from '../lib/sound';
import { toast } from './kit';

/** Avisa cuando rompes un récord personal durante la sesión (no al abrir la app). */
export function RecordWatcher() {
  const { state, store } = useGame();
  const prev = useRef<Map<string, boolean> | null>(null);
  useEffect(() => {
    if (!store.ready) return;
    const recs = personalRecords(state);
    const now = new Map(recs.map((r) => [r.id, r.brokenNow] as const));
    if (prev.current) {
      for (const r of recs) {
        if (r.brokenNow && prev.current.get(r.id) === false) {
          toast(`Nuevo récord: ${r.label.toLowerCase()}`, 'xp');
          sfx.achievement();
          break;
        }
      }
    }
    prev.current = now;
  }, [state, store.ready]);
  return null;
}
