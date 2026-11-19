import { z } from 'zod';
import { GAME_CONFIG } from '../config/game';
import {
  BLOOD_TYPES,
  CHECKUP_CATEGORIES,
  CHECKUP_CATEGORY_NAMES,
  HEALTH_METRIC_KINDS,
  HEALTH_PROFILE_ID,
  type CheckupData,
  type Entity,
  type HealthProfileData,
  type MissionSize,
} from '../types';
import {
  CHECKUP_STATUS_NAMES,
  HEALTH_DISCLAIMER,
  HEALTH_METRIC_INFO,
  HEALTH_SUGGESTIONS,
  addMonthsClamped,
  checkupEveryText,
  classifyHealthMetric,
  fmtHealthMetric,
  healthSuggestionsFor,
  suggestionCheckupId,
  type HealthSuggestion,
} from '../engine/health';
import type { AssistantSnapshot } from './snapshot';
import { fmtDay } from './format';
import { ToolError, addEvents, list, makeEvent, ok, pastDate, settingsOf, tool, upsert, zDate, zFecha, zId, zSize, zText, type AssistantStore } from './toolkit';

/**
 * Herramientas de IA del sistema de Salud: chequeos preventivos, mediciones y ficha médica.
 * Se registran en tools.ts (ASSISTANT_TOOLS, GUIDE_SYSTEMS y renderOverview, debajo de [[salud]]).
 */

const SUGGESTION_IDS = HEALTH_SUGGESTIONS.map((s) => s.id) as [string, ...string[]];
const zSuggestion = z.enum(SUGGESTION_IDS).describe(`Id de una recomendación: ${HEALTH_SUGGESTIONS.map((s) => `${s.id} (${s.name})`).join(', ')}.`);
const zCategory = z.enum(CHECKUP_CATEGORIES);
const zMonths = z.number().int().min(0).max(240).describe('Cada cuántos meses toca (0 = una sola vez).');
const zLong = (max: number) => z.string().trim().max(max);

const checkupSize = (d: Partial<CheckupData>): MissionSize => d.size ?? (GAME_CONFIG.health.checkupSize as MissionSize);
const xpOf = (size: MissionSize) => GAME_CONFIG.missionXp[size];
const normName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function suggestionById(id: string): HealthSuggestion | undefined {
  return HEALTH_SUGGESTIONS.find((s) => s.id === id || suggestionCheckupId(s.id) === id);
}

function checkupFromSuggestion(s: HealthSuggestion, lastDone?: string | null): CheckupData {
  return { name: s.name, category: s.category, everyMonths: s.everyMonths, size: s.size, active: true, notes: s.why, suggestionId: s.id, lastDone: lastDone ?? null };
}

const healthOf = (catalog: Entity[]) => list<CheckupData>(catalog, 'health', 'checkup');

/** Busca un chequeo por id, por recomendación o por nombre; con `crear`, lo crea (o activa la recomendación). */
async function resolveCheckup(
  store: AssistantStore,
  catalog: Entity[],
  i: { chequeo_id?: string; recomendacion?: string; nombre?: string; categoria?: (typeof CHECKUP_CATEGORIES)[number]; cada_meses?: number },
): Promise<{ entity: Entity<CheckupData>; created: { id: string; prev: Entity | null; savedAt?: number } | null }> {
  const all = healthOf(catalog);
  const id = i.chequeo_id?.trim();
  if (id) {
    const e = all.find((c) => c.id === id);
    if (e) return { entity: e, created: null };
    if (!suggestionById(id)) throw new ToolError(`No encontré el chequeo "${id}". Consulta los ids con ver_salud.`);
  }
  const sug = suggestionById(i.recomendacion ?? id ?? '');
  if (sug) {
    const sid = suggestionCheckupId(sug.id);
    const existing = catalog.find((c) => c.id === sid) as Entity<CheckupData> | undefined;
    if (existing && existing.module === 'health') {
      if (existing.data.active !== false) return { entity: existing, created: null };
      const { saved, ref } = await upsert(store, existing, { id: sid, module: 'health', kind: 'checkup', data: { ...existing.data, active: true } });
      return { entity: saved as Entity<CheckupData>, created: ref };
    }
    const { saved, ref } = await upsert(store, null, { id: sid, module: 'health', kind: 'checkup', data: checkupFromSuggestion(sug) });
    return { entity: saved as Entity<CheckupData>, created: ref };
  }
  const name = i.nombre?.trim();
  if (!name) throw new ToolError('Manda "chequeo_id", "recomendacion" o "nombre". Consulta la lista con ver_salud.');
  const byName = all.find((c) => normName(c.data.name) === normName(name));
  if (byName) return { entity: byName, created: null };
  const data: CheckupData = { name, category: i.categoria ?? 'otro', everyMonths: i.cada_meses ?? 12, active: true };
  const { saved, ref } = await upsert(store, null, { id: `chk-${store.newId().replace(/-/g, '').slice(0, 8)}`, module: 'health', kind: 'checkup', data });
  return { entity: saved as Entity<CheckupData>, created: ref };
}

// ---------------------------------------------------------------------------------------------
// Panorama (renderOverview) y guía
// ---------------------------------------------------------------------------------------------

export const SALUD_GUIDE =
  'Salud: chequeos preventivos (limpieza dental, laboratorios, presión, vista, piel, vacunas…) con su frecuencia; la app calcula cuándo vuelve a tocar (al día / te toca pronto / atrasado / sin registro). Hacer uno da la XP de una misión de su tamaño (normalmente media, 30 XP) a Fuerza física, una vez por chequeo por día. Mediciones (presión, glucosa, colesterol, pulso en reposo) y ficha médica: solo registro, sin XP. Las recomendaciones son orientación general, no sustituyen al médico; nunca diagnostiques. Herramientas: ver_salud, registrar_chequeo, guardar_chequeo, registrar_medicion, guardar_ficha_medica.';

function dueText(c: { status: string; daysLeft: number | null; nextDue: string | null }): string {
  if (c.status === 'atrasado' && c.daysLeft !== null) return `ATRASADO ${-c.daysLeft} ${c.daysLeft === -1 ? 'día' : 'días'} (tocaba ${c.nextDue})`;
  if (c.status === 'pronto' && c.daysLeft !== null) return c.daysLeft === 0 ? 'le toca HOY' : `le toca en ${c.daysLeft} ${c.daysLeft === 1 ? 'día' : 'días'} (${c.nextDue})`;
  if (c.status === 'sin_registro') return 'sin registro (no se sabe cuándo fue la última vez)';
  return c.nextDue ? `al día · siguiente ${c.nextDue}` : 'al día';
}

/** Líneas de salud para el panorama (ver_resumen y el Coach). */
export function renderSaludOverview(s: AssistantSnapshot): string[] {
  const h = s.health;
  if (!h) return [];
  const active = h.checkups.filter((c) => c.active);
  const metrics = h.metrics.filter((m) => m.last);
  if (!active.length && !metrics.length) return [];
  const L = ['', '## Salud'];
  if (active.length) {
    L.push(`Chequeos al día: ${h.score ?? 0}% (${h.counts.alDia + h.counts.pronto} de ${h.counts.active})${h.doneThisYear ? ` · ${h.doneThisYear} hechos este año` : ''}.`);
    const due = active.filter((c) => c.status === 'atrasado' || c.status === 'pronto').sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
    if (due.length) L.push(`Ya le toca: ${due.map((c) => `${c.name} [${c.id}] ${dueText(c)}`).join('; ')}.`);
    const unknown = active.filter((c) => c.status === 'sin_registro');
    if (unknown.length) L.push(`Sin registro: ${unknown.map((c) => `${c.name} [${c.id}]`).join('; ')}.`);
  }
  if (metrics.length) L.push(`Últimas mediciones: ${metrics.map((m) => `${m.label} ${m.last.text} (${m.last.date}${m.last.levelText ? `, ${m.last.levelText.toLowerCase()}` : ''})`).join('; ')}.`);
  return L;
}

// ---------------------------------------------------------------------------------------------
// Consultar
// ---------------------------------------------------------------------------------------------

const verSalud = tool({
  name: 'ver_salud',
  title: 'Ver salud',
  group: 'consultar',
  writes: false,
  description:
    'Salud: qué chequeos preventivos ya le tocan (atrasados, pronto, sin registro), los que están al día con su siguiente fecha, recomendaciones sin activar según su edad, últimas mediciones (presión, glucosa, colesterol, pulso) con su rango de referencia y la ficha médica (tipo de sangre, alergias, medicamentos, médico). Úsala antes de registrar_chequeo.',
  input: z.object({}),
  async run(_i, store) {
    const [s, catalog] = await Promise.all([store.snapshot(), store.catalog()]);
    const h = s.health;
    const L = [`# Salud · ${fmtDay(s.today)}`];
    const active = h.checkups.filter((c) => c.active);
    if (active.length) L.push(`Chequeos al día: ${h.score ?? 0}% (${h.counts.alDia + h.counts.pronto} de ${h.counts.active} activos) · este año: ${h.doneThisYear} hechos (+${h.xpThisYear} XP).`);
    else L.push('Sin chequeos activos todavía. Puede activar las recomendaciones con guardar_chequeo (recomendacion).');
    const line = (c: (typeof h.checkups)[number]) =>
      `- ${c.name} [${c.id}] · ${CHECKUP_CATEGORY_NAMES[c.category] ?? c.category} · ${checkupEveryText(c.everyMonths)} · ${dueText(c)}${c.lastDone ? ` · última vez ${c.lastDone}` : ''}${c.doneToday ? ' · hecho hoy' : ` · +${c.xp} XP`}`;
    const groups: [string, typeof active][] = [
      ['Ya le toca', active.filter((c) => c.status === 'atrasado' || c.status === 'pronto').sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))],
      ['Sin registro', active.filter((c) => c.status === 'sin_registro')],
      ['Al día', active.filter((c) => c.status === 'al_dia').sort((a, b) => (a.nextDue ?? '9999') < (b.nextDue ?? '9999') ? -1 : 1)],
      ['Pausados', h.checkups.filter((c) => !c.active)],
    ];
    for (const [title, items] of groups) if (items.length) L.push('', `## ${title}`, ...items.map(line));
    const activated = new Set(h.checkups.map((c) => c.suggestionId).filter(Boolean));
    const pending = healthSuggestionsFor(settingsOf(catalog).birthDate ?? null, s.today).filter((x) => !activated.has(x.id) && x.applies !== false);
    if (pending.length) {
      L.push('', '## Recomendaciones sin activar (guardar_chequeo con "recomendacion")');
      for (const x of pending) L.push(`- ${x.id}: ${x.name} (${checkupEveryText(x.everyMonths)}${x.ageText ? ` · ${x.ageText}${x.applies === null ? ', sin fecha de nacimiento para saber si ya aplica' : ''}` : ''}) · ${x.why}`);
    }
    const metrics = h.metrics.filter((m) => m.last);
    if (metrics.length) {
      L.push('', '## Mediciones (última de cada una)');
      for (const m of metrics)
        L.push(`- ${m.label}: ${m.last.text} (${m.last.date})${m.last.levelText ? ` · ${m.last.levelText}` : ''}${m.prev ? ` · antes ${m.prev.text} (${m.prev.date})` : ''} · ${m.count} ${m.count === 1 ? 'registro' : 'registros'}`);
    }
    const c = h.card;
    L.push('', '## Ficha médica');
    if (c && Object.values(c).some((v) => typeof v === 'string' && v.trim())) {
      const f = (label: string, v?: string) => (v?.trim() ? `${label}: ${v.trim()}` : '');
      L.push(
        [
          f('Tipo de sangre', c.bloodType),
          f('Alergias', c.allergies),
          f('Padecimientos', c.conditions),
          f('Medicamentos', c.medications),
          f('Médico', [c.doctorName, c.doctorPhone].filter(Boolean).join(' · ')),
          f('Seguro', [c.insurer, c.policyNumber && `póliza ${c.policyNumber}`].filter(Boolean).join(' · ')),
          f('Contacto de emergencia', [c.emergencyName, c.emergencyPhone].filter(Boolean).join(' · ')),
          f('Notas', c.notes),
        ]
          .filter(Boolean)
          .join('\n'),
      );
    } else L.push('Vacía (se llena con guardar_ficha_medica).');
    L.push('', HEALTH_DISCLAIMER);
    return { text: L.join('\n') };
  },
});

// ---------------------------------------------------------------------------------------------
// Registrar
// ---------------------------------------------------------------------------------------------

const registrarChequeo = tool({
  name: 'registrar_chequeo',
  title: 'Registrar chequeo de salud',
  group: 'registrar',
  writes: true,
  description:
    'Registra que hizo un chequeo preventivo (fue al dentista, se sacó laboratorios, se vacunó…). Da la XP de una misión de su tamaño (normalmente media, 30 XP) a Fuerza física, una vez por chequeo por día, y reinicia su cuenta para la siguiente fecha. Usa "chequeo_id" (de ver_salud), "recomendacion" (la activa si no estaba) o "nombre" (si no existe, lo crea con categoria y cada_meses). Para anotar solo la fecha de una vez anterior SIN XP, usa guardar_chequeo con ultima_vez.',
  input: z.object({
    chequeo_id: zId.optional(),
    recomendacion: zSuggestion.optional(),
    nombre: zText(200).optional().describe('Nombre si no está en la lista ("Ultrasonido de abdomen").'),
    categoria: zCategory.optional().describe('Solo al crear uno nuevo por nombre.'),
    cada_meses: zMonths.optional().describe('Solo al crear uno nuevo por nombre (por defecto 12).'),
    resultado: zLong(2000).optional().describe('Resultado en pocas palabras ("Todo bien", "Una caries").'),
    nota: zLong(2000).optional(),
    fecha: zFecha,
  }),
  async run(i, store) {
    const date = pastDate(store, i.fecha);
    const catalog = await store.catalog();
    const { entity, created } = await resolveCheckup(store, catalog, i);
    const entities = created ? [created] : [];
    const already = await store.events({ types: ['health.checkup_done'], match: { checkupId: entity.id }, from: date, to: date, limit: 1 });
    if (already.length) {
      return ok(
        `"${entity.data.name}" ya estaba registrado el ${fmtDay(date)} (cuenta una vez por día). No registré nada nuevo.`,
        entities.length ? `Activó "${entity.data.name}"` : undefined,
        { entities },
      );
    }
    const size = checkupSize(entity.data);
    const ev = makeEvent(store, 'health.checkup_done', { checkupId: entity.id, name: entity.data.name, size, result: i.resultado || undefined, note: i.nota || undefined }, date);
    const ids = await addEvents(store, [ev]);
    const later = await store.events({ types: ['health.checkup_done'], match: { checkupId: entity.id }, order: 'desc', limit: 1 });
    const manual = entity.data.lastDone && entity.data.lastDone <= store.today ? entity.data.lastDone : null;
    const last = [date, later[0]?.localDate, manual].filter((d): d is string => !!d).sort().at(-1)!;
    const next = entity.data.everyMonths > 0 ? addMonthsClamped(last, entity.data.everyMonths) : null;
    return ok(
      `Registrado: ${entity.data.name} (${fmtDay(date)})${i.resultado ? ` · ${i.resultado}` : ''} · +${xpOf(size)} XP (Fuerza física). ${next ? `Vuelve a tocar el ${fmtDay(next)}.` : 'Es de una sola vez: queda al día.'}${created ? ` Se agregó a sus chequeos [${entity.id}].` : ''}`,
      `Registró el chequeo "${entity.data.name}"`,
      { events: ids, entities },
    );
  },
});

const registrarMedicion = tool({
  name: 'registrar_medicion',
  title: 'Registrar medición de salud',
  group: 'registrar',
  writes: true,
  description:
    'Registra una medición de salud: presión (valor = sistólica, valor2 = diastólica, mmHg), glucosa en ayunas (mg/dL), colesterol total (mg/dL), frecuencia_reposo (pulso en reposo, lpm) u otro (con "nombre" y "unidad", p. ej. triglicéridos). Responde con el rango de referencia general como contexto (no es diagnóstico). Solo registro: no da XP.',
  input: z.object({
    tipo: z.enum(HEALTH_METRIC_KINDS),
    valor: z.number().positive().max(100000),
    valor2: z.number().positive().max(100000).optional().describe('Solo presión: la diastólica.'),
    unidad: z.string().trim().max(20).optional().describe('Solo "otro" (las demás usan su unidad estándar).'),
    nombre: z.string().trim().min(1).max(80).optional().describe('Solo "otro": qué se midió ("Triglicéridos").'),
    nota: zLong(2000).optional(),
    fecha: zFecha,
  }),
  async run(i, store) {
    const date = pastDate(store, i.fecha);
    if (i.tipo === 'presion' && (i.valor2 === undefined || i.valor2 >= i.valor)) throw new ToolError('Para la presión manda valor (sistólica) y valor2 (diastólica, menor), p. ej. 120 y 80.');
    if (i.tipo === 'otro' && !i.nombre) throw new ToolError('Para "otro" manda "nombre" (qué se midió) y de preferencia "unidad".');
    const payload = {
      kind: i.tipo,
      value: i.valor,
      value2: i.tipo === 'presion' ? i.valor2 : undefined,
      unit: i.tipo === 'otro' ? i.unidad || undefined : undefined,
      label: i.tipo === 'otro' ? i.nombre : undefined,
      note: i.nota || undefined,
    };
    const ev = makeEvent(store, 'health.metric', payload, date);
    const ids = await addEvents(store, [ev]);
    const info = HEALTH_METRIC_INFO[i.tipo];
    const label = i.tipo === 'otro' ? i.nombre! : info.name;
    const text = fmtHealthMetric(payload);
    const reading = classifyHealthMetric(i.tipo, i.valor, payload.value2);
    return ok(
      `Registrado: ${label} ${text} (${fmtDay(date)})${reading ? ` · ${reading.text}` : ''}. ${info.reference} ${HEALTH_DISCLAIMER}`,
      `Registró ${label.toLowerCase()} ${text}`,
      { events: ids },
    );
  },
});

// ---------------------------------------------------------------------------------------------
// Organizar
// ---------------------------------------------------------------------------------------------

const guardarChequeo = tool({
  name: 'guardar_chequeo',
  title: 'Crear o editar chequeo de salud',
  group: 'organizar',
  writes: true,
  description:
    'Activa una recomendación ("recomendacion"), crea un chequeo propio (nombre, categoria, cada_meses) o edita uno (id). "ultima_vez" anota cuándo fue la última vez SIN dar XP (para que la app calcule la siguiente fecha); "activo": false lo pausa (sale de "Ya te toca" y del puntaje; su historial y XP se conservan).',
  input: z.object({
    id: zId.optional().describe('Para EDITAR un chequeo existente, su id.'),
    recomendacion: zSuggestion.optional(),
    nombre: zText(200).optional(),
    categoria: zCategory.optional(),
    cada_meses: zMonths.optional(),
    tamano: zSize.optional().describe('Tamaño de la XP al hacerlo (por defecto media).'),
    notas: zLong(2000).optional(),
    activo: z.boolean().optional(),
    ultima_vez: zDate.nullable().optional().describe('Fecha aproximada de la última vez (YYYY-MM-DD), sin XP. null la borra.'),
  }),
  async run(i, store) {
    if (i.ultima_vez && i.ultima_vez > store.today) throw new ToolError(`"ultima_vez" no puede ser futura (hoy es ${store.today}).`);
    const catalog = await store.catalog();
    let prev: Entity<CheckupData> | null = null;
    let base: CheckupData | null = null;
    let id: string;
    if (i.id) {
      const e = catalog.find((c) => c.id === i.id);
      if (!e || e.module !== 'health' || e.kind !== 'checkup') {
        const sug = suggestionById(i.id);
        if (!sug) throw new ToolError(`No encontré el chequeo "${i.id}". Consulta los ids con ver_salud.`);
        id = suggestionCheckupId(sug.id);
        base = checkupFromSuggestion(sug);
      } else {
        prev = e as Entity<CheckupData>;
        id = e.id;
      }
    } else if (i.recomendacion) {
      const sug = suggestionById(i.recomendacion)!;
      id = suggestionCheckupId(sug.id);
      const e = catalog.find((c) => c.id === id);
      if (e && e.module === 'health') prev = e as Entity<CheckupData>;
      else base = checkupFromSuggestion(sug);
    } else {
      if (!i.nombre) throw new ToolError('Para crear un chequeo manda "nombre" (y de preferencia categoria y cada_meses), o "recomendacion" para activar una recomendada.');
      const dup = healthOf(catalog).find((c) => normName(c.data.name) === normName(i.nombre!));
      if (dup) throw new ToolError(`Ya existe "${dup.data.name}" [${dup.id}]. Para editarlo manda su id.`);
      id = `chk-${store.newId().replace(/-/g, '').slice(0, 8)}`;
    }
    const p: Partial<CheckupData> = prev?.data ?? base ?? {};
    const name = i.nombre ?? p.name;
    if (!name) throw new ToolError('Falta "nombre".');
    const data: CheckupData = {
      ...p,
      name,
      category: i.categoria ?? p.category ?? 'otro',
      everyMonths: i.cada_meses ?? p.everyMonths ?? 12,
      size: i.tamano ?? p.size,
      notes: i.notas ?? p.notes,
      active: i.activo ?? (prev ? (p.active ?? true) : true),
      lastDone: i.ultima_vez !== undefined ? i.ultima_vez : (p.lastDone ?? null),
      suggestionId: p.suggestionId ?? null,
    };
    if (!data.size) delete data.size;
    const { saved, ref } = await upsert(store, prev, { id, module: 'health', kind: 'checkup', data });
    const next = data.lastDone && data.everyMonths > 0 ? addMonthsClamped(data.lastDone, data.everyMonths) : null;
    return ok(
      `${prev ? 'Chequeo actualizado' : 'Chequeo agregado'}: "${data.name}" · ${checkupEveryText(data.everyMonths)} · ${data.active ? 'activo' : 'pausado'}${data.lastDone ? ` · última vez ${data.lastDone}${next ? `, siguiente ≈ ${next}` : ''}` : ''}. Id [${saved.id}].`,
      `${prev ? 'Editó' : 'Agregó'} el chequeo "${data.name}"`,
      { entities: [ref] },
    );
  },
});

const guardarFichaMedica = tool({
  name: 'guardar_ficha_medica',
  title: 'Editar ficha médica',
  group: 'organizar',
  writes: true,
  description:
    'Actualiza su ficha médica para emergencias: tipo de sangre, alergias, padecimientos, medicamentos, médico y teléfono, seguro y póliza, contacto de emergencia. Solo cambia los campos que mandes (cadena vacía = borrar ese dato). Registra solo lo que él te dijo.',
  input: z.object({
    tipo_sangre: z.enum([...BLOOD_TYPES, '']).optional(),
    alergias: zLong(1000).optional(),
    padecimientos: zLong(1000).optional(),
    medicamentos: zLong(1000).optional(),
    medico: zLong(200).optional(),
    telefono_medico: zLong(40).optional(),
    aseguradora: zLong(200).optional(),
    poliza: zLong(100).optional(),
    contacto_emergencia: zLong(200).optional(),
    telefono_emergencia: zLong(40).optional(),
    notas: zLong(2000).optional(),
  }),
  async run(i, store) {
    const map: [keyof typeof i, keyof HealthProfileData][] = [
      ['tipo_sangre', 'bloodType'],
      ['alergias', 'allergies'],
      ['padecimientos', 'conditions'],
      ['medicamentos', 'medications'],
      ['medico', 'doctorName'],
      ['telefono_medico', 'doctorPhone'],
      ['aseguradora', 'insurer'],
      ['poliza', 'policyNumber'],
      ['contacto_emergencia', 'emergencyName'],
      ['telefono_emergencia', 'emergencyPhone'],
      ['notas', 'notes'],
    ];
    const changed = map.filter(([k]) => i[k] !== undefined);
    if (!changed.length) throw new ToolError('Manda al menos un dato de la ficha.');
    const catalog = await store.catalog();
    const prev = catalog.find((e) => e.id === HEALTH_PROFILE_ID) ?? null;
    const data: HealthProfileData = { ...((prev?.data as HealthProfileData) ?? {}) };
    for (const [k, field] of changed) {
      const v = String(i[k] ?? '').trim();
      if (v) data[field] = v;
      else delete data[field];
    }
    const { ref } = await upsert(store, prev, { id: HEALTH_PROFILE_ID, module: 'health', kind: 'profile', data, sort: 0 });
    const labels: Record<string, string> = { tipo_sangre: 'tipo de sangre', telefono_medico: 'teléfono del médico', contacto_emergencia: 'contacto de emergencia', telefono_emergencia: 'teléfono de emergencia', poliza: 'póliza' };
    const names = changed.map(([k]) => labels[k] ?? k);
    return ok(`Ficha médica actualizada: ${names.join(', ')}.`, `Actualizó la ficha médica (${names.join(', ')})`, { entities: [ref] });
  },
});

export const SALUD_TOOLS = [verSalud, registrarChequeo, registrarMedicion, guardarChequeo, guardarFichaMedica];
