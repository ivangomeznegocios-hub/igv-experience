import type { Ctx } from './context';
import { entitiesOf, ofType } from './context';
import type { MissionsState } from './modules/missions';
import type { StreakState } from './modules/streak';
import { quickMissionId } from './reports';
import { isInRoutine, type AttributeId, type DailySlot, type Entity, type MissionData, type MissionSize } from '../types';
import { dayNum, fromDayNum, toLocalDate } from '../util/dates';

/**
 * Hábitos: análisis de tu rutina (diarias con `routine !== false`) a partir de lo que registras.
 * Es solo lectura: no da ni quita XP. Todo sale de los eventos y del catálogo (nada se guarda).
 *
 * - Un día cuenta solo si le tocaba (`days`), si el hábito ya existía y si no fue día de descanso.
 * - Hoy nunca cuenta en contra (como la racha).
 * - Lo registrado como "Hice algo" con el mismo título que una diaria cuenta para esa diaria.
 */

/** Cómo quedó un día para un hábito. */
export type HabitDay =
  /** Le tocaba y lo hiciste. */
  | 'done'
  /** Le tocaba y no lo hiciste (día ya terminado). */
  | 'missed'
  /** Le tocaba, no lo hiciste, pero fue día de descanso. */
  | 'rest'
  /** No le tocaba. */
  | 'off'
  /** Lo hiciste un día que no le tocaba (o antes de que existiera). */
  | 'extra'
  /** El hábito aún no existía. */
  | 'before'
  /** Hoy, todavía pendiente. */
  | 'pending';

export type HabitVerdict = 'bien' | 'medias' | 'flojo' | 'nuevo';
export type HabitTrend = 'mejorando' | 'estable' | 'empeorando';

export const HABIT_VERDICT_LABELS: Record<HabitVerdict, string> = {
  bien: 'Vas muy bien',
  medias: 'A medias',
  flojo: 'Flojo',
  nuevo: 'Recién empezado',
};

export const HABIT_TREND_LABELS: Record<HabitTrend, string> = {
  mejorando: 'mejorando',
  estable: 'estable',
  empeorando: 'empeorando',
};

export const WEEKDAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const;
export const WEEKDAY_SHORT = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'] as const;

/** Lo hecho contra lo que tocaba en una ventana de días. `rate` = null si no tocaba ningún día. */
export interface HabitRate {
  done: number;
  due: number;
  rate: number | null;
}

export interface HabitStats {
  id: string;
  title: string;
  size: MissionSize;
  attribute: AttributeId;
  /** Días de la semana en que toca (0 = lunes); vacío = todos. */
  days: number[];
  recovery: boolean;
  /** Desde cuándo cuenta (antes de esa fecha no existía). */
  since: string;
  last7: HabitRate;
  last30: HabitRate;
  /** Los 30 días anteriores a los últimos 30 (para la tendencia). */
  prev30: HabitRate;
  /** Días que le tocaban seguidos cumplidos (los descansos y los días que no tocaba no la rompen). */
  streak: number;
  best: number;
  trend: HabitTrend | null;
  /** Diferencia en puntos porcentuales contra los 30 días anteriores. */
  trendPoints: number | null;
  verdict: HabitVerdict;
  /** Últimos 30 días, del más antiguo a hoy. */
  strip: HabitDay[];
  /** Cumplimiento por día de la semana (0 = lunes) en las últimas `weekdayWeeks` semanas. */
  byWeekday: HabitRate[];
  /** Días de la semana en que más fallas, del peor al menos malo. */
  weakDays: number[];
  dueToday: boolean;
  doneToday: boolean;
  lastDone: string | null;
}

/** Algo que ya haces seguido y no está en tu rutina: candidato a hábito. */
export interface HabitSuggestion {
  /** Clave estable (id de misión rápida del título). */
  key: string;
  title: string;
  size: MissionSize;
  attribute: AttributeId;
  /** Días distintos en que lo registraste dentro de la ventana. */
  times: number;
  windowDays: number;
  /** Días de la semana en que sueles hacerlo (0 = lunes); vacío = todos los días. */
  days: number[];
  lastDate: string;
  /** Si ya existe como diaria fuera de la rutina, basta con meterla a la rutina. */
  dailyId: string | null;
}

export interface HabitsState {
  /** Un registro por diaria de la rutina, en el orden del catálogo. */
  routine: HabitStats[];
  suggestions: HabitSuggestion[];
  summary: {
    bien: number;
    medias: number;
    flojo: number;
    nuevo: number;
    last7: HabitRate;
    last30: HabitRate;
  };
}

const wdOf = (n: number) => (((n + 3) % 7) + 7) % 7;
const rateOf = (done: number, due: number): HabitRate => ({ done, due, rate: due > 0 ? done / due : null });

/** Categoría del menú de diarias que corresponde a un atributo (para "Hazlo hábito"). */
export function dailySlotFor(attribute: AttributeId): DailySlot {
  if (attribute === 'fuerza') return 'cuerpo';
  if (attribute === 'finanzas' || attribute === 'carisma') return 'trabajo';
  return 'libre';
}

/**
 * Desde cuándo cuenta un hábito: el día en que se creó la diaria (o el primer día que usaste la app, si es
 * posterior o no se sabe), salvo que la hayas completado antes (registros de días pasados).
 */
export function habitSince(entity: Pick<Entity, 'createdAt'>, firstDone: string | null, appStart: string, today: string, timeZone: string): string {
  const created = entity.createdAt && entity.createdAt > 0 ? toLocalDate(entity.createdAt, timeZone) : null;
  let since = created && created > appStart ? created : appStart;
  if (firstDone && firstDone < since) since = firstDone;
  return since > today ? today : since;
}

/** Fechas (como número de día) en que se hizo una diaria, contando lo registrado como "Hice algo" con su mismo título. */
function doneDays(missions: MissionsState, m: Entity<MissionData>): Set<number> {
  const out = new Set<number>();
  for (const d of missions.completions[m.id]?.dates ?? []) out.add(dayNum(d));
  for (const d of missions.completions[quickMissionId(m.data.title)]?.dates ?? []) out.add(dayNum(d));
  return out;
}

export function reduceHabits(ctx: Ctx, deps: { missions: MissionsState; streak: StreakState }): HabitsState {
  const t = dayNum(ctx.today);
  const appStart = ctx.events[0]?.localDate ?? ctx.today;
  const rest = new Set([...deps.streak.restDays].map(dayNum));
  const dailies = entitiesOf<MissionData>(ctx, 'missions', 'daily').sort((a, b) => a.sort - b.sort);
  const inRoutine = dailies.filter((m) => m.data.routine !== false);

  const routine = inRoutine.map((m) => habitStats(ctx, m, deps.missions, rest, appStart, t));

  const sum = (pick: (h: HabitStats) => HabitRate) => {
    const done = routine.reduce((s, h) => s + pick(h).done, 0);
    const due = routine.reduce((s, h) => s + pick(h).due, 0);
    return rateOf(done, due);
  };
  const count = (v: HabitVerdict) => routine.filter((h) => h.verdict === v).length;

  return {
    routine,
    suggestions: habitSuggestions(ctx, inRoutine, dailies, t),
    summary: { bien: count('bien'), medias: count('medias'), flojo: count('flojo'), nuevo: count('nuevo'), last7: sum((h) => h.last7), last30: sum((h) => h.last30) },
  };
}

function habitStats(ctx: Ctx, m: Entity<MissionData>, missions: MissionsState, rest: Set<number>, appStart: string, t: number): HabitStats {
  const cfg = ctx.cfg.habits;
  const done = doneDays(missions, m);
  const since = habitSince(m, missions.completions[m.id]?.firstDate ?? null, appStart, ctx.today, ctx.cfg.timezone);
  const s = dayNum(since);

  const statusOf = (n: number): HabitDay => {
    const did = done.has(n);
    if (n < s) return did ? 'extra' : 'before';
    if (!isInRoutine(m.data, wdOf(n))) return did ? 'extra' : 'off';
    if (did) return 'done';
    if (rest.has(n)) return 'rest';
    return n === t ? 'pending' : 'missed';
  };

  // Una pasada por toda la vida del hábito: tasas, rachas y patrón por día de la semana.
  const winStart = (days: number) => t - days + 1;
  const w7 = winStart(7);
  const w30 = winStart(30);
  const p30 = t - 59;
  const wWeek = winStart(cfg.weekdayWeeks * 7);
  const first = Math.min(s, p30, wWeek, w30);
  const c7 = { done: 0, due: 0 };
  const c30 = { done: 0, due: 0 };
  const cp = { done: 0, due: 0 };
  const byWd = Array.from({ length: 7 }, () => ({ done: 0, due: 0 }));
  const strip: HabitDay[] = [];
  let run = 0;
  let best = 0;
  for (let n = first; n <= t; n++) {
    const st = statusOf(n);
    if (n >= w30) strip.push(st);
    if (st === 'done') {
      run++;
      best = Math.max(best, run);
    } else if (st === 'missed') run = 0;
    if (st !== 'done' && st !== 'missed') continue;
    const hit = st === 'done' ? 1 : 0;
    const add = (c: { done: number; due: number }) => {
      c.done += hit;
      c.due++;
    };
    if (n >= w7) add(c7);
    if (n >= w30) add(c30);
    else if (n >= p30) add(cp);
    if (n >= wWeek) add(byWd[wdOf(n)]);
  }

  const last7 = rateOf(c7.done, c7.due);
  const last30 = rateOf(c30.done, c30.due);
  const prev30 = rateOf(cp.done, cp.due);

  let trend: HabitTrend | null = null;
  let trendPoints: number | null = null;
  if (last30.rate !== null && prev30.rate !== null && last30.due >= cfg.trendMinDays && prev30.due >= cfg.trendMinDays) {
    const delta = last30.rate - prev30.rate;
    trendPoints = Math.round(delta * 100);
    trend = delta >= cfg.trendDelta - 1e-9 ? 'mejorando' : delta <= -cfg.trendDelta + 1e-9 ? 'empeorando' : 'estable';
  }

  const verdict: HabitVerdict =
    last30.rate === null || last30.due < cfg.minDaysToJudge ? 'nuevo' : last30.rate >= cfg.goodRate ? 'bien' : last30.rate >= cfg.okRate ? 'medias' : 'flojo';

  const byWeekday = byWd.map((x) => rateOf(x.done, x.due));
  const overall = rateOf(
    byWd.reduce((a, x) => a + x.done, 0),
    byWd.reduce((a, x) => a + x.due, 0),
  ).rate;
  const weakDays =
    overall === null
      ? []
      : byWeekday
          .map((r, i) => ({ r, i }))
          .filter(({ r }) => r.due >= 2 && r.rate !== null && r.rate <= overall - cfg.weakDayGap + 1e-9)
          .sort((a, b) => (a.r.rate ?? 0) - (b.r.rate ?? 0))
          .map(({ i }) => i);

  const lastDone = [...done].reduce<number | null>((a, n) => (n <= t && (a === null || n > a) ? n : a), null);
  return {
    id: m.id,
    title: m.data.title,
    size: m.data.size,
    attribute: m.data.attribute,
    days: [...(m.data.days ?? [])].sort((a, b) => a - b),
    recovery: !!m.data.recovery,
    since,
    last7,
    last30,
    prev30,
    // Racha actual: desde hoy hacia atrás; hoy pendiente, descansos y días que no tocaban no la rompen.
    streak: currentStreak(statusOf, s, t),
    best,
    trend,
    trendPoints,
    verdict,
    strip,
    byWeekday,
    weakDays,
    dueToday: s <= t && isInRoutine(m.data, wdOf(t)) && !rest.has(t),
    doneToday: done.has(t),
    lastDone: lastDone === null ? null : fromDayNum(lastDone),
  };
}

function currentStreak(statusOf: (n: number) => HabitDay, s: number, t: number): number {
  let n = 0;
  for (let d = t; d >= s; d--) {
    const st = statusOf(d);
    if (st === 'done') n++;
    else if (st === 'missed') break;
  }
  return n;
}

/**
 * "Hábitos que se arman solos": lo que registraste (misiones rápidas, pendientes repetidos o diarias fuera de la
 * rutina) al menos `suggestMinTimes` días distintos en los últimos `suggestLookbackDays` días y que no está en tu rutina.
 */
function habitSuggestions(ctx: Ctx, inRoutine: Entity<MissionData>[], dailies: Entity<MissionData>[], t: number): HabitSuggestion[] {
  const cfg = ctx.cfg.habits;
  const lookback = Math.max(1, cfg.suggestLookbackDays);
  const from = t - lookback + 1;
  // Para adivinar los días de la semana se mira una ventana más larga (al menos 4 semanas).
  const wFrom = t - Math.max(28, lookback) + 1;
  const routineKeys = new Set(inRoutine.map((m) => quickMissionId(m.data.title)));
  const offRoutine = new Set(dailies.filter((m) => m.data.routine === false).map((m) => m.id));

  type Group = { key: string; title: string; size: MissionSize; attribute: AttributeId; last: string; days: Set<number>; dailyId: string | null };
  const groups = new Map<string, Group>();
  for (const ev of ofType<{ missionId: string; title: string; size: MissionSize; attribute: AttributeId; kind: string }>(ctx, 'mission.completed')) {
    const n = dayNum(ev.localDate);
    if (n < wFrom || n > t) continue;
    const p = ev.payload;
    if (p.kind !== 'quick' && p.kind !== 'todo' && !(p.kind === 'daily' && offRoutine.has(p.missionId))) continue;
    const key = quickMissionId(p.title);
    if (routineKeys.has(key)) continue;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, title: p.title, size: p.size, attribute: p.attribute, last: ev.localDate, days: new Set(), dailyId: null }));
    g.days.add(n);
    if (ev.localDate >= g.last) Object.assign(g, { last: ev.localDate, title: p.title, size: p.size, attribute: p.attribute });
    if (p.kind === 'daily') g.dailyId = p.missionId;
  }

  const out: HabitSuggestion[] = [];
  for (const g of groups.values()) {
    const times = [...g.days].filter((n) => n >= from).length;
    if (times < cfg.suggestMinTimes) continue;
    const perWd = new Array(7).fill(0) as number[];
    for (const n of g.days) perWd[wdOf(n)]++;
    const usual = perWd.map((c, i) => (c >= 2 ? i : -1)).filter((i) => i >= 0);
    out.push({
      key: g.key,
      title: g.title,
      size: g.size,
      attribute: g.attribute,
      times,
      windowDays: lookback,
      days: usual.length >= 1 && usual.length <= 4 ? usual : [],
      lastDate: g.last,
      dailyId: g.dailyId,
    });
  }
  return out.sort((a, b) => b.times - a.times || (a.lastDate < b.lastDate ? 1 : -1)).slice(0, 6);
}

/** "lun, mié y vie" · "todos los días". */
export function fmtWeekdays(days: number[]): string {
  if (!days.length || days.length === 7) return 'todos los días';
  const names = [...days].sort((a, b) => a - b).map((d) => WEEKDAY_SHORT[d]);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`;
}

/** "lunes y viernes" (nombres completos). */
export function fmtWeekdaysLong(days: number[]): string {
  const names = days.map((d) => WEEKDAY_NAMES[d]);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`;
}

/** Porcentaje entero ("85%") o "—". */
export function fmtRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}
