import { GAME_CONFIG } from '../config/game';
import {
  SKILL_CATEGORIES,
  TIME_AREAS,
  TIME_AREA_GROUP,
  TIME_AREA_NAMES,
  TIME_GROUPS,
  type AttributeId,
  type GameEvent,
  type SkillCategory,
  type SkillData,
  type TimeArea,
  type TimeGroup,
} from '../types';
import { addDays, diffDays, toLocalDate, weekStart, zonedTimeToUtc } from '../util/dates';

/**
 * Funciones puras del sistema "habilidades": lo que sabes hacer (categorías), tu tiempo ("¿a qué te
 * dedicas?") y el avance de la biblioteca. Nada de esto da XP: el tiempo es solo registro (regla de oro 3).
 */

// =============================================================================================
// Lo que sabes hacer
// =============================================================================================

const strip = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Pistas por palabra (sin acentos) para deducir la categoría de una habilidad. El orden importa. */
const CATEGORY_HINTS: [SkillCategory, RegExp][] = [
  ['idioma', /\b(ingles|frances|aleman|italiano|portugues|japones|chino|mandarin|coreano|ruso|arabe|idiomas?|lenguas?|english)\b/],
  ['tecnologia', /(programa|codigo|software|\bia\b|inteligencia artificial|automatiza|\bweb\b|\bapps?\b|datos|excel|tecnolog|computa|python|javascript|typescript|\bsql\b|ciberseg|no.?code|desarrollo de)/],
  ['deporte', /(deporte|\bgym\b|gimnasio|correr|running|\bbox|futbol|basquet|nadar|natacion|ciclismo|\bbici|pesas|yoga|crossfit|marcial|jiu|karate|tenis|padel|escalar|maraton)/],
  ['arte', /(music|guitarra|piano|bateria|cantar|canto|dibuj|pintu|pintar|fotograf|video|edicion|disen|\barte\b|escrib|escritura|baile|bailar|actua)/],
  ['hogar', /(cocin|\bcasa\b|hogar|limpi|jardin|plomer|electricidad|reparar|carpinter|lavar|planchar|mantenimiento)/],
  ['negocio', /(venta|vender|negoci|lideraz|finanz|marketing|mercadotecnia|empresa|emprend|contab|inversi|invertir|administra|cobranza|prospec|estrategia|gerencia|e-?commerce)/],
  ['social', /(comunica|oratoria|hablar en publico|\bhablar\b|social|amist|relacion|escuchar|carisma|networking|presentacion|persuas)/],
  ['oficio', /(oficio|mecanic|soldad|albanil|estilis|barber|\bchef\b|enfermer|medic|abogad|contador|docen|profesor|ingenier|arquitect|manejar|conducir|traduc|costur)/],
];

const ATTRIBUTE_CATEGORY: Partial<Record<AttributeId, SkillCategory>> = {
  fuerza: 'deporte',
  finanzas: 'negocio',
  carisma: 'social',
  relaciones: 'social',
  creatividad: 'arte',
};

/** Deduce la categoría de una habilidad por su nombre (y, si no hay pista, por su atributo). */
export function guessSkillCategory(name: string, attribute?: AttributeId | null): SkillCategory {
  const n = strip(name);
  for (const [cat, re] of CATEGORY_HINTS) if (re.test(n)) return cat;
  return (attribute && ATTRIBUTE_CATEGORY[attribute]) || 'otro';
}

/** Categoría de una habilidad: la guardada gana; las habilidades viejas (sin categoría) se deducen. */
export function skillCategory(d: Pick<SkillData, 'name' | 'attribute' | 'category'>): SkillCategory {
  return d.category && (SKILL_CATEGORIES as readonly string[]).includes(d.category) ? d.category : guessSkillCategory(d.name, d.attribute);
}

/** Agrupa habilidades por categoría (en el orden de SKILL_CATEGORIES; solo las que tienen algo). */
export function groupSkillsByCategory<T extends { data: SkillData }>(skills: readonly T[]): { category: SkillCategory; items: T[] }[] {
  const by = new Map<SkillCategory, T[]>();
  for (const s of skills) {
    const c = skillCategory(s.data);
    if (!by.has(c)) by.set(c, []);
    by.get(c)!.push(s);
  }
  return SKILL_CATEGORIES.filter((c) => by.has(c)).map((c) => ({ category: c, items: by.get(c)! }));
}

// =============================================================================================
// Tu tiempo
// =============================================================================================

/** Un registro de tiempo (`time.logged`) ya validado. */
export interface TimeEntry {
  id: string;
  date: string;
  minutes: number;
  area: TimeArea;
  skillId: string | null;
  note: string;
  /** Hora local de inicio (HH:MM), si se conoce. */
  start: string | null;
  createdAt: number;
}

/** Acepta eventos crudos o registros ya convertidos. */
export type TimeSource = readonly (GameEvent | TimeEntry)[];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function toEntry(e: GameEvent): TimeEntry | null {
  if (e.type !== 'time.logged' || e.voidedAt) return null;
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const minutes = Math.round(Number(p.minutes));
  if (!(minutes > 0)) return null;
  const area = (TIME_AREAS as readonly string[]).includes(String(p.area)) ? (p.area as TimeArea) : 'otro';
  return {
    id: e.id,
    date: e.localDate,
    minutes: Math.min(minutes, GAME_CONFIG.timeLog.maxMinutesPerEntry),
    area,
    skillId: typeof p.skillId === 'string' && p.skillId ? p.skillId : null,
    note: typeof p.note === 'string' ? p.note : '',
    start: typeof p.start === 'string' && HHMM.test(p.start) ? p.start : null,
    createdAt: e.createdAt ?? 0,
  };
}

const cmpEntries = (a: TimeEntry, b: TimeEntry) =>
  (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
  (a.start === b.start ? 0 : a.start === null ? 1 : b.start === null ? -1 : a.start < b.start ? -1 : 1) ||
  a.createdAt - b.createdAt ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Registros de tiempo válidos (sin anulados) entre dos fechas (incluidas), en orden del día y la hora. */
export function timeEntries(src: TimeSource, from?: string, to?: string): TimeEntry[] {
  const out: TimeEntry[] = [];
  for (const x of src) {
    const t = 'type' in x ? toEntry(x) : x;
    if (!t || (from && t.date < from) || (to && t.date > to)) continue;
    out.push(t);
  }
  return out.sort(cmpEntries);
}

export function emptyByArea(): Record<TimeArea, number> {
  return Object.fromEntries(TIME_AREAS.map((a) => [a, 0])) as Record<TimeArea, number>;
}

/** Minutos por área entre dos fechas (todas las áreas aparecen, con 0 si no hay nada). */
export function timeByArea(src: TimeSource, from?: string, to?: string): Record<TimeArea, number> {
  const out = emptyByArea();
  for (const t of timeEntries(src, from, to)) out[t.area] += t.minutes;
  return out;
}

/** Minutos por habilidad (solo registros ligados a una). */
export function timeBySkill(src: TimeSource, from?: string, to?: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of timeEntries(src, from, to)) if (t.skillId) out[t.skillId] = (out[t.skillId] ?? 0) + t.minutes;
  return out;
}

/** Minutos por día. */
export function timeByDay(src: TimeSource, from?: string, to?: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of timeEntries(src, from, to)) out[t.date] = (out[t.date] ?? 0) + t.minutes;
  return out;
}

/** Minutos por grupo (Construir, Cuerpo, Tu gente, Lo demás). */
export function timeByGroup(byArea: Record<TimeArea, number>): Record<TimeGroup, number> {
  const out = Object.fromEntries(TIME_GROUPS.map((g) => [g, 0])) as Record<TimeGroup, number>;
  for (const a of TIME_AREAS) out[TIME_AREA_GROUP[a]] += byArea[a] ?? 0;
  return out;
}

export function sumMinutes(rec: Record<string, number>): number {
  return Object.values(rec).reduce((s, n) => s + n, 0);
}

/** Áreas con tiempo, de mayor a menor. */
export function topAreas(byArea: Record<TimeArea, number>, n: number = TIME_AREAS.length): { area: TimeArea; minutes: number }[] {
  return TIME_AREAS.map((area) => ({ area, minutes: byArea[area] ?? 0 }))
    .filter((x) => x.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, n);
}

export interface TimelineBlock extends TimeEntry {
  /** Minuto del día en que empieza y termina (0–1440). */
  startMin: number;
  endMin: number;
}

/** Línea de un día: bloques con hora de inicio y los registros sin hora. */
export function dayTimeline(src: TimeSource, date: string): { blocks: TimelineBlock[]; unscheduled: TimeEntry[]; total: number; byArea: Record<TimeArea, number> } {
  const entries = timeEntries(src, date, date);
  const blocks: TimelineBlock[] = [];
  const unscheduled: TimeEntry[] = [];
  const byArea = emptyByArea();
  for (const t of entries) {
    byArea[t.area] += t.minutes;
    if (!t.start) {
      unscheduled.push(t);
      continue;
    }
    const [h, m] = t.start.split(':').map(Number);
    const startMin = h * 60 + m;
    blocks.push({ ...t, startMin, endMin: Math.min(1440, startMin + t.minutes) });
  }
  return { blocks, unscheduled, total: sumMinutes(byArea), byArea };
}

export interface TimeWindow {
  from: string;
  to: string;
  byArea: Record<TimeArea, number>;
  bySkill: Record<string, number>;
  total: number;
}

function windowOf(entries: TimeEntry[], from: string, to: string): TimeWindow {
  const byArea = timeByArea(entries, from, to);
  return { from, to, byArea, bySkill: timeBySkill(entries, from, to), total: sumMinutes(byArea) };
}

/** Esta semana (lunes a hoy) contra la semana pasada completa y contra la pasada "a estas alturas". */
export function timeWeekCompare(src: TimeSource, today: string): { thisWeek: TimeWindow; lastWeek: TimeWindow; lastWeekToDate: TimeWindow; daysElapsed: number } {
  const entries = timeEntries(src, addDays(weekStart(today), -7), today);
  const ws = weekStart(today);
  const lws = addDays(ws, -7);
  const daysElapsed = diffDays(ws, today) + 1;
  return {
    thisWeek: windowOf(entries, ws, today),
    lastWeek: windowOf(entries, lws, addDays(ws, -1)),
    lastWeekToDate: windowOf(entries, lws, addDays(lws, daysElapsed - 1)),
    daysElapsed,
  };
}

/**
 * Promedios de los últimos `days` días COMPLETOS (hasta ayer, para que el día en curso no los baje):
 * por día de calendario, por día con registro y la duración media de un día de trabajo.
 */
export function timeAverages(
  src: TimeSource,
  today: string,
  days: number = GAME_CONFIG.timeLog.averageDays,
): { from: string; to: string; days: number; loggedDays: number; total: number; perDay: Record<TimeArea, number>; perLoggedDay: Record<TimeArea, number>; workdayAvg: number | null } {
  const to = addDays(today, -1);
  const from = addDays(today, -days);
  const entries = timeEntries(src, from, to);
  const byArea = timeByArea(entries);
  const byDay = timeByDay(entries);
  const loggedDays = Object.keys(byDay).length;
  const work: Record<string, number> = {};
  for (const t of entries) if (t.area === 'trabajo') work[t.date] = (work[t.date] ?? 0) + t.minutes;
  const workDays = Object.values(work);
  const div = (n: number, d: number) => (d > 0 ? Math.round(n / d) : 0);
  return {
    from,
    to,
    days,
    loggedDays,
    total: sumMinutes(byArea),
    perDay: Object.fromEntries(TIME_AREAS.map((a) => [a, div(byArea[a], days)])) as Record<TimeArea, number>,
    perLoggedDay: Object.fromEntries(TIME_AREAS.map((a) => [a, div(byArea[a], loggedDays)])) as Record<TimeArea, number>,
    workdayAvg: workDays.length ? div(sumMinutes(work), workDays.length) : null,
  };
}

/** "8 h 20 min", "45 min", "3 h". */
export function fmtHoursMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** "En qué se te va el tiempo": hasta 5 observaciones cortas sobre la semana (sin XP, sin juicios). */
export function timeInsights(src: TimeSource, today: string, cfg: { commuteWarnPercent: number } = GAME_CONFIG.timeLog): string[] {
  const all = timeEntries(src, addDays(today, -GAME_CONFIG.timeLog.averageDays - 7), today);
  const { thisWeek, lastWeek, lastWeekToDate, daysElapsed } = timeWeekCompare(all, today);
  const out: string[] = [];
  const total = thisWeek.total;
  if (total === 0) {
    if (lastWeek.total > 0) out.push(`Esta semana aún no registras tiempo. La pasada fueron ${fmtHoursMinutes(lastWeek.total)}.`);
    return out;
  }
  const pct = (n: number) => Math.round((n / total) * 100);
  const [top] = topAreas(thisWeek.byArea, 1);
  out.push(`Esta semana tu tiempo se va sobre todo en ${TIME_AREA_NAMES[top.area].toLowerCase()}: ${fmtHoursMinutes(top.minutes)} (${pct(top.minutes)}% de lo registrado).`);

  // El mayor cambio contra la semana pasada a estas alturas.
  if (lastWeekToDate.total > 0) {
    const deltas = TIME_AREAS.map((a) => ({ a, d: thisWeek.byArea[a] - lastWeekToDate.byArea[a] })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
    const big = deltas[0];
    if (big && Math.abs(big.d) >= 60) {
      out.push(`${big.d > 0 ? 'Llevas' : 'Vas'} ${fmtHoursMinutes(Math.abs(big.d))} ${big.d > 0 ? 'más' : 'menos'} de ${TIME_AREA_NAMES[big.a].toLowerCase()} que la semana pasada a estas alturas.`);
    }
  }
  const commute = thisWeek.byArea.traslado;
  if (commute > 0 && pct(commute) >= cfg.commuteWarnPercent) {
    out.push(`Los traslados se llevan ${pct(commute)}% de tu tiempo registrado (${fmtHoursMinutes(commute)}). ¿Puedes juntarlos o aprovecharlos con un audiolibro o llamadas?`);
  }
  const groups = timeByGroup(thisWeek.byArea);
  if (groups.gente === 0 && total >= 600 && daysElapsed >= 3) out.push(`Llevas ${fmtHoursMinutes(total)} registradas y nada con familia, pareja ni amigos esta semana.`);
  else if (groups.cuerpo === 0 && total >= 600 && daysElapsed >= 3) out.push('Esta semana no hay tiempo registrado de ejercicio.');
  const avg = timeAverages(all, today);
  if (avg.workdayAvg) out.push(`Tus días de trabajo duran ${fmtHoursMinutes(avg.workdayAvg)} en promedio (últimas ${Math.round(avg.days / 7)} semanas).`);
  return out.slice(0, 5);
}

// ---------- Cronómetro ----------

/** Hora local "HH:MM" de un instante. */
export function localClock(ms: number, timeZone: string = GAME_CONFIG.timezone): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const get = (t: string) => (parts.find((p) => p.type === t)?.value ?? '00').padStart(2, '0');
  const h = get('hour') === '24' ? '00' : get('hour');
  return `${h}:${get('minute')}`;
}

export interface TimerChunk {
  date: string;
  start: string;
  minutes: number;
}

/**
 * Parte un lapso del cronómetro en registros por día local (si cruzó la medianoche, cada día recibe lo
 * suyo). Los pedazos de menos de un minuto se descartan.
 */
export function splitTimerSpan(startMs: number, endMs: number, timeZone: string = GAME_CONFIG.timezone): TimerChunk[] {
  const out: TimerChunk[] = [];
  if (!(endMs > startMs)) return out;
  let cur = startMs;
  for (let guard = 0; cur < endMs && guard < 400; guard++) {
    const date = toLocalDate(cur, timeZone);
    const midnight = Date.parse(zonedTimeToUtc(addDays(date, 1), '00:00', timeZone));
    const end = midnight > cur ? Math.min(endMs, midnight) : endMs;
    const minutes = Math.round((end - cur) / 60000);
    if (minutes >= 1) out.push({ date, start: localClock(cur, timeZone), minutes: Math.min(GAME_CONFIG.timeLog.maxMinutesPerEntry, minutes) });
    cur = end;
  }
  return out;
}

// =============================================================================================
// Biblioteca
// =============================================================================================

/** Avance de un libro en %: el porcentaje registrado gana; si no, página ÷ páginas totales. */
export function bookPercent(p: { page?: number | null; percent?: number | null } | null | undefined, pages?: number | null): number | null {
  if (!p) return null;
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  if (typeof p.percent === 'number') return clamp(p.percent);
  if (typeof p.page === 'number' && pages && pages > 0) return clamp((p.page / pages) * 100);
  return null;
}
