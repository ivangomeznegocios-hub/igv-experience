import { z } from 'zod';
import type { GameEvent } from '../types';
import { fmtDay } from './format';
import { ToolError, makeEvent, ok, pastDate, tool, zFecha, zId, zText, type AssistantStore, type AssistantTool } from './toolkit';

/**
 * Herramientas del sistema `voz`: notas que Iván dictó (o escribió) y que todavía no se convierten en registros.
 * La app guarda TODO lo que dice como `note.captured`; las que quedan `pendiente` (sin conexión, sin Coach)
 * aparecen en "Notas por procesar". Una IA puede leerlas, registrar lo que digan y marcarlas.
 */

type Captured = { text: string; source?: string; handled?: string };

async function pendingNotes(store: AssistantStore, limit = 30): Promise<GameEvent<Captured>[]> {
  const [caps, procs] = await Promise.all([
    store.events({ types: ['note.captured'], order: 'desc', limit: 200 }),
    store.events({ types: ['note.processed'], order: 'desc', limit: 1000 }),
  ]);
  const done = new Set(procs.map((e) => String(e.payload?.noteId)));
  return (caps as GameEvent<Captured>[]).filter((e) => (e.payload.handled ?? 'pendiente') === 'pendiente' && !done.has(e.id)).slice(0, limit);
}

const verNotas = tool({
  name: 'ver_notas',
  title: 'Ver notas por procesar',
  group: 'consultar',
  writes: false,
  description:
    'Notas que Iván dictó o escribió y que todavía no se convierten en registros (p. ej. las que guardó sin conexión). Para procesar una: registra lo que diga con las herramientas que correspondan (misiones, dinero, personas, sueño…) y luego márcala con marcar_nota.',
  input: z.object({}),
  async run(_i, store) {
    const notes = await pendingNotes(store);
    if (!notes.length) return { text: 'No hay notas por procesar.' };
    const lines = notes.map((n) => `- [${n.id}] ${fmtDay(n.localDate)}${n.payload.source === 'texto' ? ' (escrita)' : ''}: "${n.payload.text}"`);
    return { text: `Notas por procesar (${notes.length}), la más reciente primero. La fecha es el día en que la dijo: "ayer" en la nota es el día anterior a esa fecha.\n${lines.join('\n')}` };
  },
});

const guardarNota = tool({
  name: 'guardar_nota',
  title: 'Guardar nota para después',
  group: 'registrar',
  writes: true,
  description: 'Guarda tal cual algo que Iván quiere apuntar para procesarlo después (queda en "Notas por procesar" de la app). No da XP. Úsala solo si te pide apuntarlo o si no puedes registrarlo ahora.',
  input: z.object({ texto: zText(4000), fecha: zFecha }),
  async run({ texto, fecha }, store) {
    const date = pastDate(store, fecha);
    const ev = makeEvent(store, 'note.captured', { text: texto, source: 'texto', handled: 'pendiente' }, date);
    await store.addEvents([ev]);
    return ok(`Guardé la nota en "Notas por procesar". Registro [${ev.id}].`, `Guardó una nota: "${texto.slice(0, 60)}${texto.length > 60 ? '…' : ''}"`, { events: [ev.id] });
  },
});

const marcarNota = tool({
  name: 'marcar_nota',
  title: 'Marcar nota',
  group: 'registrar',
  writes: true,
  description: 'Marca una nota de ver_notas como procesada (ya registraste lo que decía) o descartada (no había nada que registrar). Hazlo solo después de registrar lo que decía.',
  input: z.object({ nota_id: zId, como: z.enum(['procesada', 'descartada']).default('procesada') }),
  async run({ nota_id, como }, store) {
    const note = await store.getEvent(nota_id);
    if (!note || note.type !== 'note.captured' || note.voidedAt) throw new ToolError(`No encontré la nota "${nota_id}". Consulta los ids con ver_notas.`);
    const prev = await store.events({ types: ['note.processed'], match: { noteId: nota_id }, limit: 1 });
    if (prev.length || ((note.payload as Captured).handled ?? 'pendiente') !== 'pendiente') return { text: 'Esa nota ya estaba procesada. No cambié nada.' };
    const ev = makeEvent(store, 'note.processed', { noteId: nota_id, via: como === 'descartada' ? 'descartada' : 'coach' }, store.today);
    await store.addEvents([ev]);
    const text = String((note.payload as Captured).text ?? '');
    return ok(
      `Listo: nota ${como === 'descartada' ? 'descartada' : 'marcada como procesada'}. Registro [${ev.id}].`,
      `${como === 'descartada' ? 'Descartó' : 'Procesó'} la nota "${text.slice(0, 50)}${text.length > 50 ? '…' : ''}"`,
      { events: [ev.id] },
    );
  },
});

export const VOZ_TOOLS: AssistantTool[] = [verNotas, guardarNota, marcarNota];
