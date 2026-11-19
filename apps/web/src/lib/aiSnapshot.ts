import { buildSnapshot, type Entity, type GameState } from '@igv/core';
import { api } from '../data/api';
import { getSyncInfo } from '../data/store';

/**
 * Sube al servidor la "foto" del estado que este dispositivo ya calculó, para que el servidor MCP y el Coach
 * la lean sin volver a proyectar todo el historial (el plan gratis de Workers da muy poca CPU).
 * Solo se sube cuando lo local coincide con el servidor (sin cambios pendientes) y si cambió algo.
 */
let timer: ReturnType<typeof setTimeout> | null = null;
let lastKey = '';

export async function uploadSnapshotNow(state: GameState, entities: Entity[]): Promise<boolean> {
  const info = getSyncInfo();
  if (info.pending > 0 || info.status !== 'idle' || !info.cursor) return false;
  const snapshot = buildSnapshot(state, entities, { version: info.cursor, computedBy: 'app' });
  // Se compara el contenido (y el cursor): así una fila que llegó por el traslape de la sincronización sí provoca
  // otra subida, pero sincronizar sin cambios no.
  const key = JSON.stringify({ ...snapshot, computedAt: '' });
  if (key === lastKey) return true;
  try {
    const res = await api.aiSnapshot(snapshot);
    if (res.ok) lastKey = key;
    return res.ok;
  } catch {
    return false;
  }
}

export function scheduleSnapshotUpload(state: GameState, entities: Entity[]) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void uploadSnapshotNow(state, entities), 4000);
}
