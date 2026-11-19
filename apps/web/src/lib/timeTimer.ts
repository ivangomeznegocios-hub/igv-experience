import { useEffect, useState, useSyncExternalStore } from 'react';
import { GAME_CONFIG, splitTimerSpan, type GameEvent, type TimeArea } from '@igv/core';
import { addEvent } from '../data/store';

/**
 * Cronómetro de "Tu tiempo": vive en localStorage para sobrevivir a cerrar la app ("Llegué a la oficina"
 * → … → detener). Al detenerlo se guarda como `time.logged` (uno por día si cruzó la medianoche).
 * El tiempo NO da XP. Otras partes (p. ej. Modo enfoque) pueden usar `logTimeSpan` para registrar un lapso.
 */
export interface RunningTimer {
  startedAt: number;
  area: TimeArea;
  skillId: string | null;
  note: string;
}

const KEY = 'igv-time-timer-v1';
const listeners = new Set<() => void>();
let cache: RunningTimer | null | undefined;

function read(): RunningTimer | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as RunningTimer;
    return typeof t?.startedAt === 'number' && typeof t.area === 'string' ? t : null;
  } catch {
    return null;
  }
}

function write(t: RunningTimer | null) {
  try {
    if (t) localStorage.setItem(KEY, JSON.stringify(t));
    else localStorage.removeItem(KEY);
  } catch {
    // sin almacenamiento: el cronómetro vive solo mientras la app esté abierta
  }
  cache = t;
  listeners.forEach((l) => l());
}

export function getTimer(): RunningTimer | null {
  if (cache === undefined) cache = read();
  return cache;
}

export function startTimer(t: Omit<RunningTimer, 'startedAt'>, startedAt = Date.now()) {
  write({ ...t, startedAt });
}

export function updateTimer(patch: Partial<RunningTimer>) {
  const cur = getTimer();
  if (cur) write({ ...cur, ...patch });
}

export function clearTimer() {
  write(null);
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = read();
      l();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener('storage', onStorage);
  };
}

/** Cronómetro en curso (o null), sincronizado entre pestañas. */
export function useTimer(): RunningTimer | null {
  return useSyncExternalStore(subscribe, getTimer, () => null);
}

/** Hora actual que se refresca cada `ms` mientras `active`. */
export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [active, ms]);
  return now;
}

/** "02:14:05" */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** ¿Lleva tanto que conviene revisar la duración antes de guardar? */
export function needsReview(startedAt: number, now = Date.now()): boolean {
  return now - startedAt > GAME_CONFIG.timeLog.timerReviewHours * 3_600_000;
}

/** Registra un lapso [start, end) como `time.logged` (partido por día local). Devuelve los eventos creados. */
export function logTimeSpan(startMs: number, endMs: number, data: { area: TimeArea; skillId?: string | null; note?: string }): GameEvent[] {
  return splitTimerSpan(startMs, endMs, GAME_CONFIG.timezone).map((c) =>
    addEvent('time.logged', { minutes: c.minutes, area: data.area, skillId: data.skillId ?? null, note: data.note?.trim() || undefined, start: c.start }, { localDate: c.date }),
  );
}
