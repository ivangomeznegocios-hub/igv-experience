import type { Ctx } from '../context';
import { ofType } from '../context';
import type { AttributeId, MissionSize } from '../../types';

export interface LibraryState {
  /** bookId → fecha en que se terminó. */
  finished: Record<string, { date: string; note?: string; eventId: string }>;
  /** Terminados por año (YYYY → n). */
  byYear: Record<string, number>;
}

/** Biblioteca: terminar un libro o curso da la XP de una misión de su tamaño (una vez por libro). */
export function reduceLibrary(ctx: Ctx): LibraryState {
  const finished: LibraryState['finished'] = {};
  const byYear: Record<string, number> = {};
  const evs = [...ofType<{ bookId: string; title: string; size: MissionSize; attribute: AttributeId; note?: string }>(ctx, 'library.finished')].sort(
    (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.id < b.id ? -1 : 1),
  );
  for (const ev of evs) {
    const p = ev.payload;
    if (finished[p.bookId]) continue;
    finished[p.bookId] = { date: ev.localDate, note: p.note, eventId: ev.id };
    byYear[ev.localDate.slice(0, 4)] = (byYear[ev.localDate.slice(0, 4)] ?? 0) + 1;
    ctx.addXp({ date: ev.localDate, amount: ctx.cfg.missionXp[p.size] ?? 0, source: 'library', label: `Terminé: ${p.title}`, attribute: p.attribute, eventId: ev.id, refId: p.bookId });
  }
  return { finished, byYear };
}
