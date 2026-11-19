import type { Ctx } from '../context';
import { ofType } from '../context';
import type { AttributeId, BookData, MissionSize } from '../../types';
import { bookPercent } from '../habilidades';

export interface LibraryProgress {
  /** Fecha del último avance. */
  date: string;
  page: number | null;
  /** % del libro (registrado o calculado con sus páginas); null si solo hay página y no se sabe el total. */
  percent: number | null;
  eventId: string;
  /** Primer avance registrado (cuándo empezó a leerlo según la app). */
  startedOn: string;
  updates: number;
}

export interface LibraryNote {
  eventId: string;
  bookId: string;
  /** Título actual del libro (o el guardado en la nota si el libro ya no existe). */
  title: string;
  date: string;
  text: string;
  page: number | null;
}

export interface LibraryState {
  /** bookId → fecha en que se terminó (+ la idea que se lleva y su calificación actual). */
  finished: Record<string, { date: string; note?: string; eventId: string; rating?: number | null }>;
  /** Terminados por año (YYYY → n). */
  byYear: Record<string, number>;
  /** Último avance de cada libro (página o %). Solo registro: no da XP. */
  progress: Record<string, LibraryProgress>;
  /** "Lo que aprendí": notas de todos los libros, de la más reciente a la más vieja. No dan XP. */
  notes: LibraryNote[];
  /** Notas por libro. */
  notesByBook: Record<string, number>;
}

/**
 * Biblioteca: terminar un libro o curso da la XP de una misión de su tamaño (una vez por libro).
 * El avance (`library.progress`) y las notas (`library.note`) son solo registro: no dan XP.
 */
export function reduceLibrary(ctx: Ctx): LibraryState {
  const finished: LibraryState['finished'] = {};
  const byYear: Record<string, number> = {};
  const bookOf = (id: string) => {
    const e = ctx.entityById.get(id);
    return e && e.module === 'library' ? (e.data as BookData) : undefined;
  };
  const evs = [...ofType<{ bookId: string; title: string; size: MissionSize; attribute: AttributeId; note?: string }>(ctx, 'library.finished')].sort(
    (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.id < b.id ? -1 : 1),
  );
  for (const ev of evs) {
    const p = ev.payload;
    if (finished[p.bookId]) continue;
    finished[p.bookId] = { date: ev.localDate, note: p.note, eventId: ev.id, rating: bookOf(p.bookId)?.rating ?? null };
    byYear[ev.localDate.slice(0, 4)] = (byYear[ev.localDate.slice(0, 4)] ?? 0) + 1;
    ctx.addXp({ date: ev.localDate, amount: ctx.cfg.missionXp[p.size] ?? 0, source: 'library', label: `Terminé: ${p.title}`, attribute: p.attribute, eventId: ev.id, refId: p.bookId });
  }

  // Avance: los eventos ya vienen en orden cronológico; el último gana.
  const progress: LibraryState['progress'] = {};
  for (const ev of ofType<{ bookId: string; page?: number; percent?: number }>(ctx, 'library.progress')) {
    const p = ev.payload;
    const prev = progress[p.bookId];
    progress[p.bookId] = {
      date: ev.localDate,
      page: typeof p.page === 'number' ? p.page : null,
      percent: bookPercent(p, bookOf(p.bookId)?.pages),
      eventId: ev.id,
      startedOn: prev?.startedOn ?? ev.localDate,
      updates: (prev?.updates ?? 0) + 1,
    };
  }

  const notes: LibraryNote[] = [];
  const notesByBook: Record<string, number> = {};
  for (const ev of ofType<{ bookId: string; title?: string; text: string; page?: number }>(ctx, 'library.note')) {
    const p = ev.payload;
    if (!p.text?.trim()) continue;
    notes.push({ eventId: ev.id, bookId: p.bookId, title: bookOf(p.bookId)?.title ?? p.title ?? 'Libro', date: ev.localDate, text: p.text, page: typeof p.page === 'number' ? p.page : null });
    notesByBook[p.bookId] = (notesByBook[p.bookId] ?? 0) + 1;
  }
  notes.reverse();
  return { finished, byYear, progress, notes, notesByBook };
}
