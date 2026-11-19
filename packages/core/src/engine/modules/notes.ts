import { ofType, type Ctx } from '../context';

/** Una nota (lo que dijiste o escribiste) que todavía falta convertir en registros. */
export interface PendingNote {
  id: string;
  date: string;
  text: string;
  source: 'voz' | 'texto';
  occurredAt: string;
}

export interface NotesState {
  /** Notas por procesar, la más reciente primero. */
  pending: PendingNote[];
  /** Notas guardadas en total. */
  total: number;
  /** Cómo se resolvió cada nota (id → vía). Las que se guardaron ya procesadas cuentan con su `handled`. */
  resolved: Record<string, 'coach' | 'local' | 'descartada'>;
}

type Captured = { text: string; source?: 'voz' | 'texto'; handled?: 'coach' | 'local' | 'pendiente' };
type Processed = { noteId: string; via?: 'coach' | 'local' | 'descartada' };

/**
 * Notas de voz (`note.captured` / `note.processed`). No dan XP: son la red de seguridad para que nada de lo que
 * dices se pierda. Una nota queda pendiente si se guardó como `pendiente` y no hay un `note.processed` válido
 * que la cierre (cuenta el primero; anularlo la regresa a pendientes).
 */
export function reduceNotes(ctx: Ctx): NotesState {
  const resolved: Record<string, 'coach' | 'local' | 'descartada'> = {};
  const captured = ofType<Captured>(ctx, 'note.captured');
  for (const ev of captured) {
    const h = ev.payload.handled ?? 'pendiente';
    if (h !== 'pendiente') resolved[ev.id] = h;
  }
  for (const ev of ofType<Processed>(ctx, 'note.processed')) {
    if (!resolved[ev.payload.noteId]) resolved[ev.payload.noteId] = ev.payload.via ?? 'coach';
  }
  const pending = captured
    .filter((ev) => !resolved[ev.id])
    .map((ev) => ({ id: ev.id, date: ev.localDate, text: ev.payload.text, source: ev.payload.source ?? 'voz', occurredAt: ev.occurredAt }))
    .reverse();
  return { pending, total: captured.length, resolved };
}
