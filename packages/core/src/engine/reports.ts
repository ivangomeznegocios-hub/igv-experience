import type { GameEvent } from '../types';
import type { XpEntry } from './context';
import type { GameState } from './project';
import { addDays, weekStart } from '../util/dates';

/** XP ganada por día. */
export function xpByDate(ledger: XpEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of ledger) m.set(e.date, (m.get(e.date) ?? 0) + e.amount);
  return m;
}

/** Nivel de intensidad (0–4) de un día o semana según su XP, para pintar mapas de calor. */
export function heatLevel(xp: number, steps: [number, number, number, number]): 0 | 1 | 2 | 3 | 4 {
  if (xp <= 0) return 0;
  if (xp < steps[1]) return 1;
  if (xp < steps[2]) return 2;
  if (xp < steps[3]) return 3;
  return 4;
}
export const DAY_HEAT_STEPS: [number, number, number, number] = [1, 30, 80, 160];
export const WEEK_HEAT_STEPS: [number, number, number, number] = [1, 150, 400, 800];

export interface WeekReport {
  weekStart: string;
  weekEnd: string;
  xp: number;
  xpPrev: number;
  /** XP de cada día (lunes a domingo). */
  byDay: number[];
  bestDay: { date: string; xp: number } | null;
  missions: number;
  missionsPrev: number;
  activeDays: number;
  restDays: number;
  lessons: number;
  gold: number;
  /** Entradas de XP grandes de la semana (fases de jefe, logros, rangos, metas…). */
  highlights: XpEntry[];
  /** XP por atributo en la semana. */
  byAttribute: Record<string, number>;
}

const isLive = (e: GameEvent) => !e.voidedAt;

/** Reporte de batalla de una semana (lunes a domingo) comparado con la anterior. */
export function weekReport(state: GameState, events: GameEvent[], monday: string, xpPerGold = 10): WeekReport {
  const ws = weekStart(monday);
  const we = addDays(ws, 6);
  const ps = addDays(ws, -7);
  const pe = addDays(ws, -1);
  const inW = (d: string) => d >= ws && d <= we;
  const inP = (d: string) => d >= ps && d <= pe;
  const ledger = state.xp.ledger;
  const byDay = Array.from({ length: 7 }, (_, i) => ledger.filter((e) => e.date === addDays(ws, i)).reduce((s, e) => s + e.amount, 0));
  const xp = byDay.reduce((s, x) => s + x, 0);
  const xpPrev = ledger.filter((e) => inP(e.date)).reduce((s, e) => s + e.amount, 0);
  const best = byDay.reduce<{ date: string; xp: number } | null>((b, x, i) => (x > 0 && (!b || x > b.xp) ? { date: addDays(ws, i), xp: x } : b), null);
  const missionEntries = ledger.filter((e) => e.source === 'mission');
  const live = events.filter(isLive);
  const byAttribute: Record<string, number> = {};
  for (const e of ledger) if (inW(e.date) && e.attribute) byAttribute[e.attribute] = (byAttribute[e.attribute] ?? 0) + e.amount;
  return {
    weekStart: ws,
    weekEnd: we,
    xp,
    xpPrev,
    byDay,
    bestDay: best,
    missions: missionEntries.filter((e) => inW(e.date)).length,
    missionsPrev: missionEntries.filter((e) => inP(e.date)).length,
    activeDays: new Set(missionEntries.filter((e) => inW(e.date)).map((e) => e.date)).size,
    restDays: new Set(live.filter((e) => e.type === 'rest_day.marked' && inW(e.localDate)).map((e) => e.localDate)).size,
    lessons: ledger.filter((e) => e.source === 'lesson' && inW(e.date)).length,
    gold: ledger.filter((e) => inW(e.date)).reduce((s, e) => s + (xpPerGold > 0 ? Math.floor(e.amount / xpPerGold) : 0), 0),
    highlights: ledger.filter((e) => inW(e.date) && e.source !== 'mission' && e.source !== 'streak' && e.amount >= 50),
    byAttribute,
  };
}

export interface YearReview {
  year: number;
  xp: number;
  missions: number;
  activeDays: number;
  bestStreakInYear: number;
  lessons: number;
  achievements: XpEntry[];
  bossPhases: XpEntry[];
  booksFinished: number;
  goalsCompleted: number;
  income: number;
  expense: number;
  topMissions: { title: string; count: number }[];
  byMonth: number[];
  byAttribute: Record<string, number>;
  levelStart: number;
  levelEnd: number;
}

/** "Mi año en review": resumen de un año calendario. */
export function yearReview(state: GameState, start: GameState, year: number): YearReview {
  const y = String(year);
  const inY = (d: string) => d.startsWith(y);
  const led = state.xp.ledger.filter((e) => inY(e.date));
  const missions = led.filter((e) => e.source === 'mission');
  const counts = new Map<string, number>();
  for (const m of missions) counts.set(m.label, (counts.get(m.label) ?? 0) + 1);
  const days = [...new Set(missions.map((m) => m.date))].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  const byMonth = Array.from({ length: 12 }, (_, i) => led.filter((e) => Number(e.date.slice(5, 7)) === i + 1).reduce((s, e) => s + e.amount, 0));
  const byAttribute: Record<string, number> = {};
  for (const e of led) if (e.attribute) byAttribute[e.attribute] = (byAttribute[e.attribute] ?? 0) + e.amount;
  const months = Object.entries(state.money.months).filter(([k]) => k.startsWith(y));
  return {
    year,
    xp: led.reduce((s, e) => s + e.amount, 0),
    missions: missions.length,
    activeDays: days.length,
    bestStreakInYear: best,
    lessons: led.filter((e) => e.source === 'lesson').length,
    achievements: led.filter((e) => e.source === 'achievement'),
    bossPhases: led.filter((e) => e.source === 'boss_phase'),
    booksFinished: state.library.byYear[y] ?? 0,
    goalsCompleted: Object.values(state.goals).filter((g) => g.completedOn && inY(g.completedOn)).length,
    income: months.reduce((s, [, m]) => s + m.income, 0),
    expense: months.reduce((s, [, m]) => s + m.expense, 0),
    topMissions: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([title, count]) => ({ title, count })),
    byMonth,
    byAttribute,
    levelStart: start.level.level,
    levelEnd: state.level.level,
  };
}

/** Misiones que más registras (por título) en los últimos `days` días. */
export function frequentMissions(events: GameEvent[], today: string, days = 60, limit = 8) {
  const from = addDays(today, -days);
  const m = new Map<string, { title: string; missionId: string; kind: string; size: string; attribute: string; count: number; last: string }>();
  for (const e of events) {
    if (e.voidedAt || e.type !== 'mission.completed' || e.localDate < from) continue;
    const p = e.payload as { missionId: string; title: string; kind: string; size: string; attribute: string };
    if (p.kind !== 'daily' && p.kind !== 'quick') continue;
    const cur = m.get(p.missionId) ?? { title: p.title, missionId: p.missionId, kind: p.kind, size: p.size, attribute: p.attribute, count: 0, last: e.localDate };
    cur.count++;
    if (e.localDate >= cur.last) {
      cur.last = e.localDate;
      cur.title = p.title;
      cur.size = p.size;
      cur.attribute = p.attribute;
    }
    m.set(p.missionId, cur);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || (a.last < b.last ? 1 : -1)).slice(0, limit);
}

/** Id estable para una misión rápida a partir de su título ("Fui al gym" → "quick-fui-al-gym"). */
export function quickMissionId(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `quick-${slug || 'mision'}`;
}

/** Elección determinista (por fecha) de un elemento de una lista: misma fecha → mismo resultado. */
export function pickForDate<T>(items: T[], date: string, salt = ''): T | null {
  if (!items.length) return null;
  let h = 2166136261;
  for (const ch of date + salt) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return items[(h >>> 0) % items.length];
}
