import type { AttributeId, GameEvent, GoalData } from '../types';
import { ATTRIBUTE_IDS, ATTRIBUTE_NAMES } from '../types';
import type { XpEntry } from './context';
import type { GameState } from './project';
import type { GoalState } from './modules/goals';
import { addDays, diffDays, monthKey, weekStart, weekday } from '../util/dates';

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

// ---------------------------------------------------------------------------
// Tú vs. tú de la semana pasada
// ---------------------------------------------------------------------------

export interface WeekPace {
  /** XP de esta semana (lunes → ahora). */
  xp: number;
  /** XP de la semana pasada hasta este mismo momento (mismo día y hora). */
  xpLastWeek: number;
  missions: number;
  missionsLastWeek: number;
  /** XP total de la semana pasada completa (la meta a superar). */
  xpLastWeekTotal: number;
  /** Diferencia de XP (positivo = vas arriba). */
  diff: number;
}

/**
 * Compara la semana en curso contra la anterior **hasta este mismo momento**: mismos días y, el día de
 * hoy, solo lo registrado antes de esta hora hace 7 días. `nowIso` = instante actual.
 */
export function weekPace(state: GameState, events: GameEvent[], nowIso: string): WeekPace {
  const today = state.today;
  const ws = weekStart(today);
  const lws = addDays(ws, -7);
  const lwSameDay = addDays(today, -7);
  const cutoff = new Date(new Date(nowIso).getTime() - 7 * 86400000).toISOString();
  const occurred = new Map(events.map((e) => [e.id, e.occurredAt]));
  const beforeCutoff = (e: XpEntry) => {
    if (e.date < lwSameDay) return true;
    const at = e.eventId ? occurred.get(e.eventId) : undefined;
    return !at || at <= cutoff;
  };
  const led = state.xp.ledger;
  const thisWeek = led.filter((e) => e.date >= ws && e.date <= today);
  const lastWeekSoFar = led.filter((e) => e.date >= lws && e.date <= lwSameDay && beforeCutoff(e));
  const lastWeekAll = led.filter((e) => e.date >= lws && e.date < ws);
  const xp = sum(thisWeek.map((e) => e.amount));
  const xpLastWeek = sum(lastWeekSoFar.map((e) => e.amount));
  return {
    xp,
    xpLastWeek,
    missions: thisWeek.filter((e) => e.source === 'mission').length,
    missionsLastWeek: lastWeekSoFar.filter((e) => e.source === 'mission').length,
    xpLastWeekTotal: sum(lastWeekAll.map((e) => e.amount)),
    diff: xp - xpLastWeek,
  };
}

// ---------------------------------------------------------------------------
// Récords personales
// ---------------------------------------------------------------------------

export interface PersonalRecord {
  id: 'best_day' | 'best_week' | 'best_month' | 'most_missions_day' | 'longest_streak' | 'best_income_month';
  label: string;
  value: number;
  unit: 'xp' | 'misiones' | 'días' | 'dinero';
  /** Cuándo se logró (día, lunes de la semana o YYYY-MM). */
  when: string | null;
  /** Mejor marca antes del periodo en curso (null si no se puede saber). */
  previous: number | null;
  /** El periodo en curso (hoy, esta semana, este mes) superó la marca anterior. */
  brokenNow: boolean;
}

function best<K extends string>(m: Map<K, number>, exclude?: K): { key: K | null; value: number } {
  let key: K | null = null;
  let value = 0;
  for (const [k, v] of m) {
    if (k === exclude) continue;
    if (v > value || (v === value && key !== null && k < key)) {
      key = k;
      value = v;
    }
  }
  return { key, value };
}

function record(id: PersonalRecord['id'], label: string, unit: PersonalRecord['unit'], m: Map<string, number>, current: string): PersonalRecord {
  const prev = best(m, current);
  const cur = m.get(current) ?? 0;
  // Sin marca anterior no hay récord que romper (el primer día no cuenta).
  const brokenNow = prev.value > 0 && cur > prev.value;
  return { id, label, unit, value: brokenNow ? cur : prev.value, when: brokenNow ? current : prev.key, previous: prev.value, brokenNow };
}

/** Tus mejores marcas: día, semana y mes con más XP, más misiones en un día, racha más larga y mejor mes de ingresos. */
export function personalRecords(state: GameState): PersonalRecord[] {
  const today = state.today;
  const byDay = new Map<string, number>();
  const byWeek = new Map<string, number>();
  const byMonth = new Map<string, number>();
  const missionsByDay = new Map<string, number>();
  for (const e of state.xp.ledger) {
    byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.amount);
    const w = weekStart(e.date);
    byWeek.set(w, (byWeek.get(w) ?? 0) + e.amount);
    const mo = monthKey(e.date);
    byMonth.set(mo, (byMonth.get(mo) ?? 0) + e.amount);
    if (e.source === 'mission') missionsByDay.set(e.date, (missionsByDay.get(e.date) ?? 0) + 1);
  }
  const income = new Map<string, number>(Object.entries(state.money.months).map(([k, m]) => [k, m.income]));

  // Racha: "nuevo récord" si la mejor racha se alcanzó hoy o ayer (es la racha en curso).
  const streakSetOn = state.streak.reachedOn[state.streak.best] ?? null;
  const streakBroken = state.streak.best > 1 && state.streak.current === state.streak.best && !!streakSetOn && streakSetOn >= addDays(today, -1);

  return [
    record('best_day', 'Mejor día', 'xp', byDay, today),
    record('best_week', 'Mejor semana', 'xp', byWeek, weekStart(today)),
    record('best_month', 'Mejor mes', 'xp', byMonth, monthKey(today)),
    record('most_missions_day', 'Más misiones en un día', 'misiones', missionsByDay, today),
    {
      id: 'longest_streak',
      label: 'Racha más larga',
      unit: 'días',
      value: state.streak.best,
      when: streakSetOn,
      previous: null,
      brokenNow: streakBroken,
    },
    record('best_income_month', 'Mejor mes de ingresos', 'dinero', income, monthKey(today)),
  ];
}

// ---------------------------------------------------------------------------
// Datos sobre ti (patrones calculados de tus registros)
// ---------------------------------------------------------------------------

export interface Insight {
  id: string;
  title: string;
  detail: string;
  tone: 'good' | 'warn' | 'info';
}

const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

function avg(xs: number[]): number {
  return xs.length ? sum(xs) / xs.length : 0;
}

/** Hora local (0–23) de un instante en una zona horaria. */
export function localHour(iso: string, timeZone: string): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(iso));
  return Number(h) % 24;
}

/**
 * Patrones de los últimos `days` días: cómo te va según cuánto duermes, tu mejor día de la semana,
 * tu hora más productiva, ánimo vs. XP y el atributo que tienes abandonado. Solo días ya terminados.
 */
export function insights(state: GameState, events: GameEvent[], timeZone = 'America/Mexico_City', days = 90): Insight[] {
  const out: Insight[] = [];
  const today = state.today;
  const from = addDays(today, -days);
  const xpDay = new Map<string, number>();
  for (const e of state.xp.ledger) if (e.date >= from && e.date < today) xpDay.set(e.date, (xpDay.get(e.date) ?? 0) + e.amount);
  const missionDays = new Map<string, number>();
  for (const e of state.xp.ledger) if (e.source === 'mission' && e.date >= from && e.date < today) missionDays.set(e.date, (missionDays.get(e.date) ?? 0) + 1);

  // 1) Sueño → XP del día
  const sleep = state.body.sleep.filter((s) => s.date >= from && s.date < today);
  const good = sleep.filter((s) => s.hours >= 7).map((s) => xpDay.get(s.date) ?? 0);
  const bad = sleep.filter((s) => s.hours < 7).map((s) => xpDay.get(s.date) ?? 0);
  if (good.length >= 3 && bad.length >= 3) {
    const g = avg(good);
    const b = avg(bad);
    if (g > 0 && b > 0 && g / b >= 1.15) out.push({ id: 'sleep', title: `Durmiendo 7 h o más haces ${(g / b).toFixed(1)}× más XP`, detail: `Promedio ${Math.round(g)} XP vs ${Math.round(b)} XP cuando duermes menos.`, tone: 'good' });
    else if (g > 0 && b > 0 && b / g >= 1.15) out.push({ id: 'sleep', title: 'Dormir poco no te ha frenado (todavía)', detail: `Promedio ${Math.round(b)} XP durmiendo menos de 7 h vs ${Math.round(g)} XP durmiendo bien.`, tone: 'info' });
    else if (b === 0 && g > 0) out.push({ id: 'sleep', title: 'Los días que duermes poco casi no avanzas', detail: `Promedio ${Math.round(g)} XP durmiendo 7 h o más.`, tone: 'warn' });
  }

  // 2) Mejor y peor día de la semana (con al menos 4 semanas de datos)
  const totalDays = Math.max(0, Math.min(days, diffDays(state.xp.ledger[0]?.date ?? today, today)));
  if (totalDays >= 28) {
    const per: number[][] = Array.from({ length: 7 }, () => []);
    for (let i = 1; i <= totalDays; i++) {
      const d = addDays(today, -i);
      per[weekday(d)].push(xpDay.get(d) ?? 0);
    }
    const avgs = per.map(avg);
    const bestI = avgs.indexOf(Math.max(...avgs));
    const worstI = avgs.indexOf(Math.min(...avgs));
    if (avgs[bestI] > 0) out.push({ id: 'weekday', title: `Tus mejores días son los ${WEEKDAYS[bestI]}`, detail: `Promedio ${Math.round(avgs[bestI])} XP. Los ${WEEKDAYS[worstI]} son los más flojos (${Math.round(avgs[worstI])} XP).`, tone: 'info' });
  }

  // 3) Hora más productiva (misiones registradas)
  const hours = Array<number>(24).fill(0);
  let nMissions = 0;
  for (const e of events) {
    if (e.voidedAt || e.type !== 'mission.completed' || e.localDate < from || e.localDate >= today) continue;
    hours[localHour(e.occurredAt, timeZone)]++;
    nMissions++;
  }
  if (nMissions >= 15) {
    let bi = 0;
    let bv = 0;
    for (let h = 0; h < 24; h++) {
      const v = hours[h] + hours[(h + 1) % 24] + hours[(h + 2) % 24];
      if (v > bv) {
        bv = v;
        bi = h;
      }
    }
    const fmt = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 ? 'am' : 'pm'}`;
    out.push({ id: 'hour', title: `Tu horario fuerte: ${fmt(bi)} – ${fmt((bi + 3) % 24)}`, detail: `Ahí registras el ${Math.round((bv / nMissions) * 100)} % de tus misiones. Protege ese bloque.`, tone: 'info' });
  }

  // 4) Ánimo del cierre del día vs XP
  const moods = Object.entries(state.dayClosures).filter(([d, c]) => d >= from && d < today && c.mood);
  const hi = moods.filter(([, c]) => c.mood! >= 4).map(([d]) => xpDay.get(d) ?? 0);
  const lo = moods.filter(([, c]) => c.mood! <= 2).map(([d]) => xpDay.get(d) ?? 0);
  if (hi.length >= 3 && lo.length >= 2 && avg(hi) > avg(lo) * 1.2) {
    out.push({ id: 'mood', title: 'Los días que avanzas terminas de mejor humor', detail: `Días buenos: ${Math.round(avg(hi))} XP en promedio. Días malos: ${Math.round(avg(lo))} XP.`, tone: 'good' });
  }

  // 5) Constancia: días activos en los últimos 30
  const last30 = Array.from({ length: 30 }, (_, i) => addDays(today, -1 - i)).filter((d) => d >= (state.xp.ledger[0]?.date ?? today));
  if (last30.length >= 14) {
    const active = last30.filter((d) => (missionDays.get(d) ?? 0) > 0).length;
    const pct = Math.round((active / last30.length) * 100);
    out.push({ id: 'consistency', title: `Avanzaste ${pct} % de los días del último mes`, detail: `${active} de ${last30.length} días con al menos una misión.`, tone: pct >= 70 ? 'good' : pct >= 40 ? 'info' : 'warn' });
  }

  // 6) Atributo abandonado (sin XP en 30 días) y el más trabajado
  const since = addDays(today, -30);
  const attrXp = Object.fromEntries(ATTRIBUTE_IDS.map((a) => [a, 0])) as Record<AttributeId, number>;
  for (const e of state.xp.ledger) if (e.attribute && e.date >= since) attrXp[e.attribute] += e.amount;
  if (sum(Object.values(attrXp)) > 0 && (state.xp.ledger[0]?.date ?? today) <= since) {
    const sorted = [...ATTRIBUTE_IDS].sort((a, b) => attrXp[b] - attrXp[a]);
    const top = sorted[0];
    const forgotten = sorted.filter((a) => attrXp[a] === 0);
    out.push({ id: 'attr_top', title: `Este mes tu fuerte fue ${ATTRIBUTE_NAMES[top]}`, detail: `${attrXp[top]} XP en los últimos 30 días.`, tone: 'good' });
    if (forgotten.length) out.push({ id: 'attr_forgotten', title: `Llevas 30 días sin sumar a ${forgotten.map((a) => ATTRIBUTE_NAMES[a]).join(', ')}`, detail: 'Una misión chica esta semana lo reactiva.', tone: 'warn' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ritmo para llegar a tus metas
// ---------------------------------------------------------------------------

export interface Pace {
  remaining: number;
  daysLeft: number;
  /** Lo que necesitas por semana desde hoy para llegar a tiempo. */
  neededPerWeek: number;
  /** Tu ritmo real por semana desde que empezaste. */
  actualPerWeek: number;
  /** Proyección al llegar la fecha límite con tu ritmo actual. */
  projected: number;
  status: 'done' | 'ahead' | 'on_track' | 'behind' | 'overdue';
  /** % de avance esperado a esta fecha (lineal) vs real. */
  expectedProgress: number;
}

function paceStatus(current: number, target: number, expected: number, daysLeft: number): Pace['status'] {
  if (current >= target) return 'done';
  if (daysLeft < 0) return 'overdue';
  const ratio = target > 0 ? current / target : 0;
  if (ratio >= expected + 0.05) return 'ahead';
  if (ratio >= expected - 0.05) return 'on_track';
  return 'behind';
}

/** Ritmo de una meta con fecha límite. `startDate` = cuándo la empezaste (fecha de creación o primer avance). */
export function goalPace(goal: GoalData, gs: GoalState, startDate: string, today: string): Pace | null {
  if (!goal.deadline || !(gs.target > 0)) return null;
  const total = Math.max(1, diffDays(startDate, goal.deadline) + 1);
  const elapsed = Math.max(1, Math.min(total, diffDays(startDate, today) + 1));
  const daysLeft = diffDays(today, goal.deadline);
  const remaining = Math.max(0, gs.target - gs.current);
  const actualPerDay = gs.current / elapsed;
  const expected = Math.min(1, elapsed / total);
  return {
    remaining,
    daysLeft,
    neededPerWeek: daysLeft >= 0 ? (remaining / Math.max(1, daysLeft + 1)) * 7 : remaining,
    actualPerWeek: actualPerDay * 7,
    projected: gs.current + actualPerDay * Math.max(0, daysLeft),
    status: paceStatus(gs.current, gs.target, expected, daysLeft),
    expectedProgress: expected,
  };
}

/** Ritmo de ingresos del mes contra tu meta mensual. */
export function monthPace(state: GameState): (Pace & { perDayNeeded: number }) | null {
  const goal = state.money.goal;
  if (!(goal > 0)) return null;
  const today = state.today;
  const [y, m] = today.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Number(today.slice(8, 10));
  const current = state.money.monthIncome;
  const remaining = Math.max(0, goal - current);
  const daysLeft = daysInMonth - day; // días después de hoy
  const expected = day / daysInMonth;
  const actualPerDay = current / day;
  return {
    remaining,
    daysLeft,
    neededPerWeek: (remaining / Math.max(1, daysLeft + 1)) * 7,
    actualPerWeek: actualPerDay * 7,
    projected: current + actualPerDay * daysLeft,
    status: paceStatus(current, goal, expected, daysLeft),
    expectedProgress: expected,
    perDayNeeded: remaining / Math.max(1, daysLeft + 1),
  };
}
