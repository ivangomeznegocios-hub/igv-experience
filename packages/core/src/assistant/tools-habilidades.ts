import { z } from 'zod';
import { GAME_CONFIG } from '../config/game';
import {
  ATTRIBUTE_NAMES,
  SKILL_CATEGORIES,
  SKILL_CATEGORY_ATTRIBUTE,
  SKILL_CATEGORY_NAMES,
  SKILL_DEFAULT_RANKS,
  SKILL_RANK_NAMES,
  TIME_AREAS,
  TIME_AREA_NAMES,
  type BookData,
  type Entity,
  type GameEvent,
  type SkillCategory,
  type SkillData,
  type TimeArea,
} from '../types';
import {
  bookPercent,
  dayTimeline,
  fmtHoursMinutes,
  localClock,
  skillCategory,
  guessSkillCategory,
  sumMinutes,
  timeAverages,
  timeByArea,
  timeBySkill,
  timeInsights,
  timeWeekCompare,
  topAreas,
} from '../engine/habilidades';
import { addDays, diffDays, weekStart } from '../util/dates';
import { fmtDay } from './format';
import type { AssistantSnapshot } from './snapshot';
import { ToolError, find, list, makeEvent, newEntityId, ok, pastDate, tool, upsert, zAttr, zDate, zFecha, zId, zText, type AssistantStore } from './toolkit';

/**
 * Herramientas de IA del sistema "habilidades": lo que sabe hacer, su tiempo ("¿a qué te dedicas?") y la
 * biblioteca (avance y "lo que aprendí"). El tiempo, el avance y las notas NO dan XP.
 */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const zEditId = zId.optional().describe('Para EDITAR un elemento existente, su id. Sin id, se crea uno nuevo.');
const areaName = (a: string) => (TIME_AREA_NAMES[a as TimeArea] ?? a).toLowerCase();
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const pctOf = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

function existingOf<D>(catalog: Entity[], id: string | undefined, module: string, kinds: string[], what: string): Entity<D> | null {
  return id ? find<D>(catalog, id, module, kinds, what) : null;
}

function areaLine(byArea: Record<string, number>, total: number, n = 12) {
  return topAreas(byArea as Record<TimeArea, number>, n)
    .map((x) => `${TIME_AREA_NAMES[x.area]} ${fmtHoursMinutes(x.minutes)} (${pctOf(x.minutes, total)}%)`)
    .join(' · ');
}

// ---------------------------------------------------------------------------------------------
// Tiempo
// ---------------------------------------------------------------------------------------------

const registrarTiempo = tool({
  name: 'registrar_tiempo',
  title: 'Registrar tiempo',
  group: 'registrar',
  writes: true,
  description:
    'Registra tiempo que Iván dedicó a algo ("8 h 20 min en la oficina", "1 h con mi hija"). NO da XP (la XP es por acciones y resultados, no por horas): sirve para ver a qué le dedica su vida. Áreas: trabajo (incluye la oficina; pon el lugar en la nota), estudio, lectura, proyecto (propio), ejercicio, familia, pareja, amigos, casa, traslado, ocio, otro. Opcional: habilidad que practicó y hora de inicio.',
  input: z.object({
    area: z.enum(TIME_AREAS),
    horas: z.number().min(0).max(24).optional(),
    minutos: z.number().int().min(0).max(1440).optional(),
    habilidad_id: zId.optional().describe('Habilidad que practicó (ids con ver_habilidades).'),
    nota: z.string().trim().max(1000).optional().describe('Detalle corto: "Oficina", "Junta con proveedor"…'),
    inicio: z.string().regex(HHMM, 'Usa HH:MM (24 h)').optional().describe('Hora local de inicio (HH:MM), si la sabe.'),
    fecha: zFecha,
  }),
  async run(i, store) {
    const minutes = Math.round((i.horas ?? 0) * 60 + (i.minutos ?? 0));
    if (minutes < 1) throw new ToolError('Indica cuánto tiempo: "horas" y/o "minutos".');
    if (minutes > GAME_CONFIG.timeLog.maxMinutesPerEntry) throw new ToolError('Un registro no puede pasar de 24 horas. Divídelo por día.');
    const date = pastDate(store, i.fecha);
    if (date === store.today) {
      const [h, m] = localClock(store.now().getTime()).split(':').map(Number);
      const nowMin = h * 60 + m;
      const startMin = i.inicio ? Number(i.inicio.slice(0, 2)) * 60 + Number(i.inicio.slice(3)) : null;
      if (startMin !== null && startMin > nowMin + 5) throw new ToolError(`Las ${i.inicio} todavía no llegan (son las ${localClock(store.now().getTime())}). Para planear usa agendar_pendiente.`);
      if (minutes > nowMin + 5) throw new ToolError(`Hoy apenas van ${fmtHoursMinutes(nowMin)} (son las ${localClock(store.now().getTime())}): no caben ${fmtHoursMinutes(minutes)}. ¿Fue ayer? Manda "fecha".`);
    }
    const catalog = await store.catalog();
    const skill = i.habilidad_id ? find<SkillData>(catalog, i.habilidad_id, 'skills', ['skill'], 'la habilidad') : null;
    const sameDay = await store.events({ types: ['time.logged'], from: date, to: date });
    const dup = sameDay.find(
      (e) => e.payload.area === i.area && e.payload.minutes === minutes && (e.payload.start ?? null) === (i.inicio ?? null) && (e.payload.skillId ?? null) === (skill?.id ?? null),
    );
    if (dup) return { text: `Ya estaba registrado: ${fmtHoursMinutes(minutes)} de ${areaName(i.area)} ese día [${dup.id}]. No registré nada nuevo.` };
    const ev = makeEvent(store, 'time.logged', { minutes, area: i.area, skillId: skill?.id ?? null, note: i.nota || undefined, start: i.inicio }, date);
    await store.addEvents([ev]);
    const ws = weekStart(store.today);
    const week = date >= ws ? timeByArea(await store.events({ types: ['time.logged'], from: ws, to: store.today }))[i.area] : null;
    const when = date === store.today ? 'hoy' : `el ${fmtDay(date)}`;
    return ok(
      `Registré ${fmtHoursMinutes(minutes)} de ${areaName(i.area)} ${when}${skill ? ` (practicando ${skill.data.name})` : ''}${i.inicio ? ` desde las ${i.inicio}` : ''}.${week !== null ? ` Esta semana llevas ${fmtHoursMinutes(week)} de ${areaName(i.area)}.` : ''} El tiempo no da XP: es para ver a qué le dedicas tu vida. Registro [${ev.id}].`,
      `Tiempo: ${fmtHoursMinutes(minutes)} de ${areaName(i.area)}${date !== store.today ? ` · ${date}` : ''}`,
      { events: [ev.id] },
    );
  },
});

const verTiempo = tool({
  name: 'ver_tiempo',
  title: 'Ver su tiempo',
  group: 'consultar',
  writes: false,
  description:
    'A qué le dedica su tiempo: esta semana contra la pasada (por área y por habilidad), promedios de las últimas 4 semanas, "en qué se te va el tiempo" y los registros de hoy. Con "dia" muestra la línea de ese día; con "desde"/"hasta", los totales de ese rango (máx. 366 días).',
  input: z.object({
    dia: zDate.optional().describe('Día a detallar (YYYY-MM-DD).'),
    desde: zDate.optional(),
    hasta: zDate.optional(),
  }),
  async run({ dia, desde, hasta }, store) {
    const catalog = await store.catalog();
    const skillName = (id: string) => (catalog.find((e) => e.id === id)?.data as SkillData | undefined)?.name ?? id;
    const skillLine = (rec: Record<string, number>) =>
      Object.entries(rec)
        .sort((a, b) => b[1] - a[1])
        .map(([id, m]) => `${skillName(id)} ${fmtHoursMinutes(m)}`)
        .join(' · ');
    const L: string[] = [];
    if (dia) {
      const evs = await store.events({ types: ['time.logged'], from: dia, to: dia });
      const tl = dayTimeline(evs, dia);
      L.push(`# Tu tiempo · ${fmtDay(dia)}`, `Total: ${fmtHoursMinutes(tl.total)}${tl.total ? ` · ${areaLine(tl.byArea, tl.total)}` : ''}.`);
      for (const b of tl.blocks) L.push(`- ${b.start}–${String(Math.floor(b.endMin / 60)).padStart(2, '0')}:${String(b.endMin % 60).padStart(2, '0')} ${TIME_AREA_NAMES[b.area]} ${fmtHoursMinutes(b.minutes)}${b.skillId ? ` · ${skillName(b.skillId)}` : ''}${b.note ? ` · ${b.note}` : ''} [${b.id}]`);
      for (const u of tl.unscheduled) L.push(`- (sin hora) ${TIME_AREA_NAMES[u.area]} ${fmtHoursMinutes(u.minutes)}${u.skillId ? ` · ${skillName(u.skillId)}` : ''}${u.note ? ` · ${u.note}` : ''} [${u.id}]`);
      if (!tl.total) L.push('Sin registros de tiempo ese día.');
      return { text: L.join('\n') };
    }
    if (desde || hasta) {
      const to = hasta ?? store.today;
      const from = desde ?? addDays(to, -6);
      if (from > to) throw new ToolError('"desde" debe ser anterior a "hasta".');
      if (diffDays(from, to) > 366) throw new ToolError('Rango máximo: 366 días.');
      const evs = await store.events({ types: ['time.logged'], from, to });
      const byArea = timeByArea(evs);
      const total = sumMinutes(byArea);
      const days = diffDays(from, to) + 1;
      L.push(`# Tu tiempo del ${from} al ${to} (${days} días)`, `Total: ${fmtHoursMinutes(total)} · promedio ${fmtHoursMinutes(total / days)} por día.`);
      if (total) L.push(`Por área: ${areaLine(byArea, total)}.`);
      const bySkill = timeBySkill(evs);
      if (Object.keys(bySkill).length) L.push(`Por habilidad: ${skillLine(bySkill)}.`);
      L.push('(El tiempo es solo registro: no da XP.)');
      return { text: L.join('\n') };
    }
    const evs = await store.events({ types: ['time.logged'], from: addDays(store.today, -(GAME_CONFIG.timeLog.averageDays + 14)), to: store.today });
    const cmp = timeWeekCompare(evs, store.today);
    const avg = timeAverages(evs, store.today);
    const tw = cmp.thisWeek;
    L.push(`# Tu tiempo · semana del ${fmtDay(tw.from)} a hoy`);
    L.push(`Esta semana: ${fmtHoursMinutes(tw.total)} registradas · semana pasada a estas alturas: ${fmtHoursMinutes(cmp.lastWeekToDate.total)} · semana pasada completa: ${fmtHoursMinutes(cmp.lastWeek.total)}.`);
    if (tw.total) L.push(`Por área: ${areaLine(tw.byArea, tw.total)}.`);
    if (Object.keys(tw.bySkill).length) L.push(`Por habilidad: ${skillLine(tw.bySkill)}.`);
    if (cmp.lastWeek.total) L.push(`Semana pasada por área: ${areaLine(cmp.lastWeek.byArea, cmp.lastWeek.total, 5)}.`);
    if (avg.loggedDays) {
      L.push(
        `Últimos ${avg.days} días completos: ${fmtHoursMinutes(avg.total / avg.days)} registradas por día en promedio (${avg.loggedDays} días con registro)${avg.workdayAvg ? ` · un día de trabajo dura ${fmtHoursMinutes(avg.workdayAvg)} en promedio` : ''}.`,
      );
    }
    const ins = timeInsights(evs, store.today);
    if (ins.length) L.push('', 'En qué se te va el tiempo:', ...ins.map((x) => `- ${x}`));
    const today = dayTimeline(evs, store.today);
    L.push('', `Hoy: ${fmtHoursMinutes(today.total)}.`);
    for (const t of [...today.blocks, ...today.unscheduled]) L.push(`- ${t.start ?? '(sin hora)'} ${TIME_AREA_NAMES[t.area]} ${fmtHoursMinutes(t.minutes)}${t.note ? ` · ${t.note}` : ''} [${t.id}]`);
    if (!tw.total && !cmp.lastWeek.total) L.push('', 'Todavía no hay tiempo registrado. Usa registrar_tiempo cuando te cuente cuánto le dedicó a algo.');
    L.push('', '(El tiempo es solo registro: no da XP.)');
    return { text: L.join('\n') };
  },
});

// ---------------------------------------------------------------------------------------------
// Habilidades
// ---------------------------------------------------------------------------------------------

const verHabilidades = tool({
  name: 'ver_habilidades',
  title: 'Ver lo que sabe hacer',
  group: 'consultar',
  writes: false,
  description:
    'Lo que Iván sabe hacer, por categoría: rango (Aprendiz → Experto → Maestro) y requisito del siguiente, de qué vive, tiempo invertido, última práctica, libros ligados y sus notas de conocimiento. Úsala antes de guardar_habilidad, subir_rango_habilidad o registrar_tiempo con habilidad.',
  input: z.object({}),
  async run(_i, store) {
    const [catalog, s] = await Promise.all([store.catalog(), store.snapshot()]);
    const skills = list<SkillData>(catalog, 'skills', 'skill');
    const books = list<BookData>(catalog, 'library', 'book');
    if (!skills.length) return { text: 'Todavía no hay habilidades. Agrégalas con guardar_habilidad ("Sé hacer…").' };
    const L: string[] = ['# Lo que sabes hacer'];
    const living = skills.filter((x) => x.data.livelihood).map((x) => x.data.name);
    if (living.length) L.push(`De esto vive: ${living.join(', ')}.`);
    for (const cat of SKILL_CATEGORIES) {
      const items = skills.filter((x) => skillCategory(x.data) === cat);
      if (!items.length) continue;
      L.push('', `## ${SKILL_CATEGORY_NAMES[cat]}`);
      for (const sk of items) {
        const st = s.skills.find((x) => x.id === sk.id);
        const rank = st?.rank ?? 0;
        const linked = books.filter((b) => b.data.skillId === sk.id).map((b) => b.data.title);
        const parts = [
          `${rank ? SKILL_RANK_NAMES[rank - 1] : 'sin rango'}${rank < 3 ? ` (siguiente: ${SKILL_RANK_NAMES[rank]} — ${sk.data.ranks[rank]})` : ''}`,
          ATTRIBUTE_NAMES[sk.data.attribute],
          st?.minutes ? `${fmtHoursMinutes(st.minutes)} invertidas` : '',
          st?.lastPractice ? `última práctica ${st.lastPractice}` : '',
          sk.data.livelihood ? 'vive de esto' : '',
          linked.length ? `libros: ${linked.join(', ')}` : '',
        ].filter(Boolean);
        L.push(`- [${sk.id}] ${sk.data.name}: ${parts.join(' · ')}`);
        if (sk.data.notes?.trim()) L.push(`  Lo que sabe: ${sk.data.notes.trim().slice(0, 300)}`);
      }
    }
    return { text: L.join('\n') };
  },
});

const guardarHabilidad = tool({
  name: 'guardar_habilidad',
  title: 'Agregar o editar habilidad',
  group: 'organizar',
  writes: true,
  description: `Agrega algo que Iván sabe hacer ("Sé hacer…") o edita una habilidad. Categorías: ${SKILL_CATEGORIES.join(', ')} (si no la mandas, se deduce del nombre). "requisitos" = qué demuestra cada rango [Aprendiz, Experto, Maestro]; si no los mandas se usan unos genéricos. "vivo_de_esto" = forma parte de a qué se dedica. "notas" = lo que sabe de eso (métodos, recursos). No da XP por sí sola: los rangos se suben con evidencia (subir_rango_habilidad).`,
  input: z.object({
    id: zEditId,
    nombre: zText(120).optional(),
    categoria: z.enum(SKILL_CATEGORIES).optional(),
    atributo: zAttr.optional(),
    requisitos: z.array(zText(300)).length(3).optional().describe('[Aprendiz, Experto, Maestro]'),
    vivo_de_esto: z.boolean().optional(),
    notas: z.string().max(4000).optional(),
  }),
  async run(i, store) {
    const catalog = await store.catalog();
    const prev = existingOf<SkillData>(catalog, i.id, 'skills', ['skill'], 'la habilidad');
    const p: Partial<SkillData> = prev?.data ?? {};
    const name = i.nombre ?? p.name;
    if (!name) throw new ToolError('Falta "nombre" (por ejemplo "Vender por WhatsApp").');
    const twin = list<SkillData>(catalog, 'skills', 'skill').find((x) => x.id !== prev?.id && norm(x.data.name) === norm(name));
    if (twin) throw new ToolError(`Ya existe "${twin.data.name}" [${twin.id}]. Para editarla manda su id.`);
    const category: SkillCategory = i.categoria ?? p.category ?? guessSkillCategory(name, i.atributo ?? p.attribute);
    const data: SkillData = {
      ...p,
      name,
      category,
      attribute: i.atributo ?? p.attribute ?? SKILL_CATEGORY_ATTRIBUTE[category],
      ranks: (i.requisitos as [string, string, string] | undefined) ?? p.ranks ?? [...SKILL_DEFAULT_RANKS],
      livelihood: i.vivo_de_esto ?? p.livelihood ?? false,
      notes: i.notas ?? p.notes,
    };
    const { saved, ref } = await upsert(store, prev, { id: prev?.id ?? newEntityId(store, 'skill'), module: 'skills', kind: 'skill', data });
    return ok(
      `${prev ? 'Habilidad actualizada' : 'Agregada a lo que sabes hacer'}: "${data.name}" (${SKILL_CATEGORY_NAMES[category]} · ${ATTRIBUTE_NAMES[data.attribute]})${data.livelihood ? ' · vive de esto' : ''}. Requisitos: ${data.ranks.map((r, k) => `${SKILL_RANK_NAMES[k]}: ${r}`).join(' / ')}. Id [${saved.id}].`,
      `${prev ? 'Editó' : 'Agregó'} la habilidad "${data.name}"`,
      { entities: [ref] },
    );
  },
});

const subirRango = tool({
  name: 'subir_rango_habilidad',
  title: 'Subir rango de habilidad',
  group: 'registrar',
  writes: true,
  description: `Desbloquea el SIGUIENTE rango de una habilidad (Aprendiz → Experto → Maestro, +${GAME_CONFIG.rewards.skillRank} XP) con evidencia escrita: qué hizo que cumple el requisito, o un enlace. Úsala solo si él te da esa evidencia; revisa el requisito con ver_habilidades.`,
  input: z.object({ habilidad_id: zId, evidencia: z.string().trim().min(3).max(4000), fecha: zFecha }),
  async run({ habilidad_id, evidencia, fecha }, store) {
    const date = pastDate(store, fecha);
    const sk = find<SkillData>(await store.catalog(), habilidad_id, 'skills', ['skill'], 'la habilidad');
    const st = (await store.snapshot()).skills.find((x) => x.id === sk.id);
    const rank = st?.rank ?? 0;
    if (rank >= 3) return { text: `"${sk.data.name}" ya está en Maestro, el rango más alto.` };
    const prevUnlocks = await store.events({ types: ['skill.rank_unlocked'], match: { skillId: sk.id }, order: 'desc', limit: 1 });
    if (prevUnlocks[0] && date < prevUnlocks[0].localDate) throw new ToolError(`El rango anterior se desbloqueó el ${prevUnlocks[0].localDate}: el siguiente no puede ir antes.`);
    const ev = makeEvent(store, 'skill.rank_unlocked', { skillId: sk.id, rank: rank + 1, evidence: evidencia }, date);
    await store.addEvents([ev]);
    const rn = SKILL_RANK_NAMES[rank];
    return ok(`"${sk.data.name}": ${rn} desbloqueado (+${GAME_CONFIG.rewards.skillRank} XP, ${ATTRIBUTE_NAMES[sk.data.attribute]}). Registro [${ev.id}].`, `${sk.data.name}: ${rn}`, { events: [ev.id] });
  },
});

// ---------------------------------------------------------------------------------------------
// Biblioteca
// ---------------------------------------------------------------------------------------------

const notaDeLibro = tool({
  name: 'nota_de_libro',
  title: 'Anotar lo que aprendí de un libro',
  group: 'registrar',
  writes: true,
  description: 'Guarda una idea que Iván aprendió de un libro, curso o audiolibro de la Biblioteca ("Lo que aprendí"). En primera persona y corta. No da XP. Ids con ver_biblioteca o ver_catalogo libros.',
  input: z.object({ libro_id: zId, texto: z.string().trim().min(2).max(4000), pagina: z.number().int().min(0).max(100000).optional(), fecha: zFecha }),
  async run({ libro_id, texto, pagina, fecha }, store) {
    const date = pastDate(store, fecha);
    const b = find<BookData>(await store.catalog(), libro_id, 'library', ['book'], 'el libro');
    const prev = await store.events({ types: ['library.note'], match: { bookId: b.id } });
    if (prev.some((e) => norm(String(e.payload.text ?? '')) === norm(texto))) return { text: `Esa nota ya estaba guardada en "${b.data.title}". No registré nada nuevo.` };
    const ev = makeEvent(store, 'library.note', { bookId: b.id, title: b.data.title, text: texto, page: pagina }, date);
    await store.addEvents([ev]);
    return ok(`Guardé lo que aprendiste de "${b.data.title}" (${prev.length + 1} ${prev.length ? 'notas' : 'nota'} de este libro). Las notas no dan XP. Registro [${ev.id}].`, `Nota de "${b.data.title}"`, { events: [ev.id] });
  },
});

const avanceDeLibro = tool({
  name: 'avance_de_libro',
  title: 'Registrar avance de lectura',
  group: 'registrar',
  writes: true,
  description: 'Registra en qué página o porcentaje va un libro o curso de la Biblioteca (si estaba pendiente, pasa a "leyendo"). No da XP; al terminarlo usa terminar_libro (eso sí da XP).',
  input: z.object({
    libro_id: zId,
    pagina: z.number().int().min(0).max(100000).optional(),
    porcentaje: z.number().min(0).max(100).optional(),
    fecha: zFecha,
  }),
  async run({ libro_id, pagina, porcentaje, fecha }, store) {
    if (pagina === undefined && porcentaje === undefined) throw new ToolError('Indica "pagina" o "porcentaje".');
    const date = pastDate(store, fecha);
    const b = find<BookData>(await store.catalog(), libro_id, 'library', ['book'], 'el libro');
    const done = await store.events({ types: ['library.finished'], match: { bookId: b.id }, limit: 1 });
    if (done.length) return { text: `"${b.data.title}" ya está terminado (${done[0].localDate}). No registré avance.` };
    if (pagina !== undefined && b.data.pages && pagina > b.data.pages) throw new ToolError(`"${b.data.title}" tiene ${b.data.pages} páginas: la página ${pagina} no existe. Corrige el total con guardar_libro si cambió.`);
    const ev = makeEvent(store, 'library.progress', { bookId: b.id, page: pagina, percent: porcentaje }, date);
    await store.addEvents([ev]);
    const entities: { id: string; prev: Entity | null; savedAt?: number }[] = [];
    if (b.data.status === 'pendiente') {
      const { ref } = await upsert(store, b, { id: b.id, module: 'library', kind: 'book', data: { ...b.data, status: 'leyendo' } });
      entities.push(ref);
    }
    const pct = bookPercent({ page: pagina ?? null, percent: porcentaje ?? null }, b.data.pages);
    const where = pct !== null ? `${pct}%${pagina !== undefined ? ` (página ${pagina}${b.data.pages ? ` de ${b.data.pages}` : ''})` : ''}` : `página ${pagina}`;
    return ok(
      `"${b.data.title}": vas en ${where}.${entities.length ? ' Lo pasé a "Leyendo".' : ''}${pct === 100 ? ' Si ya lo terminaste, usa terminar_libro (da XP).' : ''} El avance no da XP. Registro [${ev.id}].`,
      `Avance de "${b.data.title}": ${where}`,
      { events: [ev.id], entities },
    );
  },
});

interface BookFacts {
  finished: Map<string, GameEvent>;
  progress: Map<string, GameEvent>;
  notes: GameEvent[];
}

async function bookFacts(store: AssistantStore): Promise<BookFacts> {
  const evs = await store.events({ types: ['library.finished', 'library.progress', 'library.note'], order: 'asc' });
  const finished = new Map<string, GameEvent>();
  const progress = new Map<string, GameEvent>();
  const notes: GameEvent[] = [];
  const firstFinished = [...evs.filter((e) => e.type === 'library.finished')].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  for (const e of firstFinished) if (!finished.has(e.payload.bookId)) finished.set(e.payload.bookId, e);
  for (const e of evs) {
    if (e.type === 'library.progress') progress.set(e.payload.bookId, e);
    if (e.type === 'library.note') notes.push(e);
  }
  return { finished, progress, notes: notes.reverse() };
}

const verBiblioteca = tool({
  name: 'ver_biblioteca',
  title: 'Ver biblioteca',
  group: 'consultar',
  writes: false,
  description:
    'La Biblioteca de Iván: qué está leyendo y en qué va, pendientes, terminados por año (con calificación y la idea que se llevó) y "lo que aprendí" (notas). Con libro_id, el detalle de un libro con todas sus notas. Con anio, los terminados de ese año.',
  input: z.object({ libro_id: zId.optional(), anio: z.string().regex(/^\d{4}$/, 'Año YYYY').optional() }),
  async run({ libro_id, anio }, store) {
    const catalog = await store.catalog();
    const books = list<BookData>(catalog, 'library', 'book');
    const skillName = (id?: string | null) => (id ? ((catalog.find((e) => e.id === id)?.data as SkillData | undefined)?.name ?? null) : null);
    const f = await bookFacts(store);
    const progressText = (b: Entity<BookData>) => {
      const pr = f.progress.get(b.id);
      if (!pr) return 'sin avance registrado';
      const pct = bookPercent(pr.payload, b.data.pages);
      return `${pct !== null ? `${pct}%` : `página ${pr.payload.page}`} (${pr.localDate})`;
    };
    const stars = (n?: number | null) => (n ? `${n}/5` : '');
    const L: string[] = [];
    if (libro_id) {
      const b = find<BookData>(catalog, libro_id, 'library', ['book'], 'el libro');
      const fin = f.finished.get(b.id);
      L.push(`# ${b.data.title}${b.data.author ? ` · ${b.data.author}` : ''}`);
      L.push(
        [b.data.bookType, fin ? `terminado ${fin.localDate}` : b.data.status, fin ? '' : progressText(b), b.data.pages ? `${b.data.pages} páginas` : '', stars(b.data.rating), skillName(b.data.skillId) ? `habilidad: ${skillName(b.data.skillId)}` : '']
          .filter(Boolean)
          .join(' · '),
      );
      if (fin?.payload.note) L.push(`La idea que se llevó: ${fin.payload.note}`);
      const notes = f.notes.filter((n) => n.payload.bookId === b.id);
      L.push('', `Lo que aprendí (${notes.length}):`);
      for (const n of notes) L.push(`- ${n.localDate}${n.payload.page !== undefined ? ` p. ${n.payload.page}` : ''}: ${n.payload.text} [${n.id}]`);
      if (!notes.length) L.push('- (sin notas; guárdalas con nota_de_libro)');
      return { text: L.join('\n') };
    }
    const year = anio ?? store.today.slice(0, 4);
    if (!anio) {
      const reading = books.filter((b) => !f.finished.has(b.id) && b.data.status === 'leyendo');
      L.push('# Biblioteca', '', `Leyendo ahora (${reading.length}):`);
      for (const b of reading) {
        const last = f.notes.find((n) => n.payload.bookId === b.id);
        L.push(`- [${b.id}] ${b.data.title}: ${progressText(b)}${last ? ` · última nota: "${String(last.payload.text).slice(0, 120)}"` : ''}`);
      }
      if (!reading.length) L.push('- (nada)');
      const pending = books.filter((b) => !f.finished.has(b.id) && b.data.status === 'pendiente');
      if (pending.length) L.push('', `Pendientes (${pending.length}): ${pending.slice(0, 12).map((b) => `${b.data.title} [${b.id}]`).join('; ')}.`);
    }
    const fin = books.filter((b) => f.finished.get(b.id)?.localDate.startsWith(year)).sort((a, b) => (f.finished.get(a.id)!.localDate < f.finished.get(b.id)!.localDate ? 1 : -1));
    L.push('', `Terminados en ${year} (${fin.length}):`);
    for (const b of fin) {
      const e = f.finished.get(b.id)!;
      L.push(`- ${e.localDate} ${b.data.title}${b.data.rating ? ` · ${stars(b.data.rating)}` : ''}${e.payload.note ? ` · se llevó: "${String(e.payload.note).slice(0, 160)}"` : ''} [${b.id}]`);
    }
    if (!fin.length) L.push('- (ninguno)');
    if (!anio && f.notes.length) {
      L.push('', `Lo que aprendí (últimas de ${f.notes.length}):`);
      for (const n of f.notes.slice(0, 10)) {
        const title = books.find((b) => b.id === n.payload.bookId)?.data.title ?? n.payload.title ?? n.payload.bookId;
        L.push(`- ${n.localDate} ${title}: ${String(n.payload.text).slice(0, 200)}`);
      }
    }
    return { text: L.join('\n') };
  },
});

/** Herramientas del sistema (se agregan a ASSISTANT_TOOLS en tools.ts). */
export const HABILIDADES_TOOLS = [registrarTiempo, verTiempo, verHabilidades, guardarHabilidad, subirRango, notaDeLibro, avanceDeLibro, verBiblioteca];

/** Línea para la guía de la app (GUIDE_SYSTEMS). */
export const HABILIDADES_GUIDE = `Habilidades, tiempo y biblioteca: "Lo que sabes hacer" por categoría (${SKILL_CATEGORIES.map((c) => SKILL_CATEGORY_NAMES[c].toLowerCase()).join(', ')}); cada rango (Aprendiz → Experto → Maestro) se sube con evidencia escrita y da ${GAME_CONFIG.rewards.skillRank} XP. "Tu tiempo" (registrar_tiempo / ver_tiempo: trabajo —incluye la oficina—, estudio, familia, traslados…) es SOLO registro y NO da XP: la XP es por resultados, no por horas. En la Biblioteca el avance (página o %) y las notas de "lo que aprendí" no dan XP; terminar un libro da la XP de su tamaño una vez.`;

/** Líneas para el panorama (renderOverview). */
export function renderHabilidadesOverview(s: AssistantSnapshot): string[] {
  const L: string[] = [];
  const t = s.time;
  if (t && (t.todayTotal || t.thisWeekTotal || t.lastWeekTotal)) {
    const rows = (r: { area: string; minutes: number }[], n: number) => r.slice(0, n).map((x) => `${areaName(x.area)} ${fmtHoursMinutes(x.minutes)}`).join(', ');
    L.push(
      `Tiempo (solo registro, sin XP): hoy ${fmtHoursMinutes(t.todayTotal)}${t.today.length ? ` (${rows(t.today, 4)})` : ''} · esta semana ${fmtHoursMinutes(t.thisWeekTotal)}${t.thisWeek.length ? ` (${rows(t.thisWeek, 4)})` : ''} · semana pasada a estas alturas ${fmtHoursMinutes(t.lastWeekToDate)}, completa ${fmtHoursMinutes(t.lastWeekTotal)}.`,
    );
    if (t.skillsThisWeek.length) L.push(`Práctica por habilidad esta semana: ${t.skillsThisWeek.slice(0, 5).map((x) => `${x.name} ${fmtHoursMinutes(x.minutes)}`).join(', ')}.`);
  }
  const living = (s.skills ?? []).filter((x) => x.livelihood);
  if (living.length) L.push(`De esto vive: ${living.map((x) => `${x.name}${x.rankName ? ` (${x.rankName})` : ''}`).join(', ')}.`);
  const reading = (s.library?.reading ?? []).filter((b) => b.percent !== null || b.page !== null);
  if (reading.length) L.push(`Avance de lectura: ${reading.map((b) => `${b.title} ${b.percent !== null ? `${b.percent}%` : `p. ${b.page}`}`).join('; ')}.`);
  if (s.library?.recentNotes?.length) L.push(`Lo último que aprendió de sus libros: ${s.library.recentNotes.map((n) => `"${n.text.slice(0, 100)}" (${n.book})`).join('; ')}.`);
  return L.length ? ['', '## Tiempo, habilidades y lectura', ...L] : [];
}
