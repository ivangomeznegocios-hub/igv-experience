import type { Ctx } from '../context';
import { getDayCheck, type DayCheckContext } from '../day-review';
import type { HabitsState } from '../habits';
import { quickMissionId } from '../reports';
import { isInRoutine, type Entity, type GameEvent } from '../../types';
import { addDays, weekStart, weekday } from '../../util/dates';
import type { DayClosure } from './life-logs';
import type { MissionsState } from './missions';
import type { DayPlan } from './plans';
import type { SeasonsState } from './seasons';

/**
 * Marcador del día (sistema "marcador"): puntaje 0–100 de cómo te fue, si el día se ganó y el impulso.
 * Todo es derivado de eventos + catálogo (nada se guarda) y nunca da ni quita XP.
 *
 * Diseño (ver docs/plan-juego.md, pilar "volver siempre conviene"):
 * - Solo cuenta desde `settings.scoreStart` (lo fija el arranque): los días vacíos de antes no son derrotas.
 * - Hoy nunca cuenta como no ganado.
 * - Un día vacío suelto es "no ganado"; dos o más seguidos son una pausa: neutros, sin pendientes, y el impulso
 *   baja un solo escalón en total. Al regresar, una misión ese día recupera el escalón ("jugada de regreso").
 * - Si hiciste tu "mínimo" (o, sin mínimo definido, cualquier misión) el día queda salvado: conserva el impulso.
 */

export type DayStatus =
  /** Llegaste al puntaje para ganar. */
  | 'won'
  /** No ganado, pero hiciste tu mínimo: conserva el impulso. */
  | 'saved'
  /** Día de descanso válido (neutro). */
  | 'rest'
  /** No tocaba rutina ni había plan (neutro). */
  | 'free'
  /** Parte de una ausencia de varios días (neutro; el impulso baja un escalón por toda la pausa). */
  | 'pause'
  /** Día terminado sin ganar ni salvar. */
  | 'lost'
  /** Hoy, aún sin ganar. */
  | 'pending';

export type DayPartId = 'routine' | 'plan' | 'log' | 'close';

export interface DayPart {
  id: DayPartId;
  /** Peso configurado. */
  weight: number;
  /** 0–1. */
  value: number;
  done: number;
  due: number;
}

export interface DayResult {
  date: string;
  score: number;
  status: DayStatus;
  /** Solo las partes que aplicaron ese día. */
  parts: DayPart[];
  /** Impulso (en %) con el que empezó el día. */
  pct: number;
  /** Sin ningún registro tuyo ese día. */
  empty: boolean;
  minimumDone: boolean;
}

export interface PendingItem {
  missionId: string;
  title: string;
  /** Puntos que suma al puntaje de hoy. */
  points: number;
  inPlan: boolean;
  inRoutine: boolean;
}

export interface TodayResult extends DayResult {
  /** Lo que falta de tu rutina y de tus 3, de lo que más suma a lo que menos. */
  pending: PendingItem[];
  /** Revisiones de registro que faltan (ids de DAY_CHECKS). */
  logMissing: { id: string; points: number }[];
  closed: boolean;
  /** Puntos que suma cerrar el día. */
  closePoints: number;
  /** Puntos que faltan para ganar (0 si ya ganaste). */
  toWin: number;
}

export interface MomentumState {
  /** Impulso actual (%) para hoy. */
  pct: number;
  step: number;
  /** Días ganados que cuentan para el escalón. */
  winRun: number;
  /** Siguiente escalón: cuántos días ganados más faltan. */
  next: { wins: number; pct: number; missing: number } | null;
  /** Impulso de mañana si hoy no se gana ni se salva. */
  pctIfLost: number;
  /** Impulso de mañana si hoy se gana. */
  pctIfWon: number;
}

export interface DaysState {
  start: string | null;
  threshold: number;
  byDate: Record<string, DayResult>;
  today: TodayResult | null;
  /** Semana en curso, lunes a domingo (null = antes de empezar o futuro). */
  week: { start: string; days: { date: string; status: DayStatus | null; score: number | null }[]; won: number };
  totals: { won: number; saved: number; currentRun: number; bestRun: number };
  /** Días ganados en la temporada (capítulo) en curso. */
  season: { won: number } | null;
  momentum: MomentumState;
  /** Regresaste de una pausa: hoy una misión recupera tu impulso. */
  comeback: { pausedDays: number; done: boolean; restoresPct: number } | null;
}

/** Registros que la app crea sola (no cuentan como "registraste algo ese día"). */
const AUTO_EVENTS = new Set(['bounty.drawn', 'daily.selected', 'weekly.selected', 'profile.attributes_rated', 'coach.brief']);

type Steps = readonly { wins: number; pct: number }[];
const stepOf = (steps: Steps, winRun: number) => {
  let i = 0;
  for (let k = 0; k < steps.length; k++) if (steps[k].wins <= winRun) i = k;
  return i;
};
const pctOf = (steps: Steps, winRun: number) => steps[stepOf(steps, winRun)]?.pct ?? 100;
/** Un escalón abajo (no a cero). */
const coolDown = (steps: Steps, winRun: number) => steps[Math.max(0, stepOf(steps, winRun) - 1)]?.wins ?? 0;

const NEUTRAL: ReadonlySet<DayStatus> = new Set(['rest', 'free', 'pause', 'saved', 'pending']);

export function reduceDays(
  ctx: Ctx,
  deps: { missions: MissionsState; plans: Record<string, DayPlan>; habits: HabitsState; dayClosures: Record<string, DayClosure>; seasons: SeasonsState },
): DaysState {
  const cfg = ctx.cfg.dayScore;
  const steps = ctx.cfg.momentum.steps;
  const threshold = cfg.winThreshold;
  const today = ctx.today;
  const start = ctx.settings.scoreStart && ctx.settings.scoreStart <= today ? ctx.settings.scoreStart : null;
  const empty = emptyState(start, threshold, today, steps);
  if (!start) return empty;

  const { missions, plans, habits, dayClosures } = deps;

  // ---- Datos compartidos (una sola vez) ----
  const byDate = new Map<string, GameEvent[]>();
  for (const e of ctx.events) {
    if (e.localDate < start) continue;
    let xs = byDate.get(e.localDate);
    if (!xs) byDate.set(e.localDate, (xs = []));
    xs.push(e);
  }
  const lists = new Map<string, Entity[]>();
  const list = <D,>(module: string, kind?: string) => {
    const key = `${module}/${kind ?? ''}`;
    let out = lists.get(key);
    if (!out) lists.set(key, (out = ctx.entities.filter((e) => e.module === module && (!kind || e.kind === kind)).sort((a, b) => a.sort - b.sort)));
    return out as Entity<D>[];
  };
  const doneEver = (id: string) => (missions.completions[id]?.count ?? 0) > 0;
  const habitSince = Object.fromEntries(habits.routine.map((h) => [h.id, h.since]));
  const titleOf = new Map<string, string>(habits.routine.map((h) => [h.id, h.title]));
  for (const e of list<{ title?: string }>('missions', 'daily')) if (e.data.title) titleOf.set(e.id, e.data.title);
  const datesOf = (id: string) => missions.completions[id]?.dates ?? [];
  const doneSets = new Map<string, Set<string>>();
  /** ¿Se hizo esta misión ese día? (cuenta lo registrado como "Hice algo" con su mismo título). */
  const doneOnDay = (id: string, d: string) => {
    let s = doneSets.get(id);
    if (!s) {
      s = new Set(datesOf(id));
      const t = titleOf.get(id);
      if (t) for (const x of datesOf(quickMissionId(t))) s.add(x);
      doneSets.set(id, s);
    }
    return s.has(d);
  };
  const minimum = ctx.settings.dayMinimum;
  const minimumDone = (d: string) =>
    minimum ? datesOf(minimum.missionId).includes(d) || datesOf(quickMissionId(minimum.title)).includes(d) : missions.activeDays.has(d);
  const logChecks = cfg.logChecks.map((id) => getDayCheck(id)).filter((c): c is NonNullable<typeof c> => !!c);
  const w = cfg.weights;

  // ---- Un día ----
  const evaluate = (d: string) => {
    const events = byDate.get(d) ?? [];
    const byType = new Map<string, GameEvent[]>();
    for (const e of events) {
      let xs = byType.get(e.type);
      if (!xs) byType.set(e.type, (xs = []));
      xs.push(e);
    }
    const isEmpty = !events.some((e) => !AUTO_EVENTS.has(e.type));
    const rest = habits.restDays.has(d);
    const wd = weekday(d);

    const routineIds = rest
      ? []
      : (dayClosures[d]?.routine ??
        habits.routine.filter((h) => h.since <= d && isInRoutine({ days: h.days }, wd)).map((h) => h.id));
    const routineDone = routineIds.filter((id) => doneOnDay(id, d));
    const plan = plans[d]?.items.length ? plans[d] : null;
    const planDone = plan ? plan.items.filter((i) => i.done) : [];

    const doneOn = new Set((byType.get('mission.completed') ?? []).map((e) => String((e.payload as { missionId: string }).missionId)));
    const c: DayCheckContext = {
      date: d,
      today,
      isToday: d === today,
      weekday: wd,
      restDay: rest,
      events,
      of: <P,>(type: string) => (byType.get(type) ?? []) as GameEvent<P>[],
      entities: ctx.entities,
      list,
      doneOn,
      doneEver,
      plan: plan ? { items: plan.items } : null,
      habitSince,
      currency: ctx.settings.currency,
    };
    const skipped = new Set((byType.get('day.check_skipped') ?? []).map((e) => String((e.payload as { checkId: string }).checkId)));
    const logDue: string[] = [];
    const logDone: string[] = [];
    for (const ch of logChecks) {
      if (ch.applies && !ch.applies(c)) continue;
      logDue.push(ch.id);
      if (ch.progress(c) >= 1 || (ch.skipLabel && skipped.has(ch.id))) logDone.push(ch.id);
    }
    const closed = !!dayClosures[d];

    const parts: DayPart[] = [];
    if (routineIds.length) parts.push({ id: 'routine', weight: w.routine, done: routineDone.length, due: routineIds.length, value: routineDone.length / routineIds.length });
    if (plan) parts.push({ id: 'plan', weight: w.plan, done: planDone.length, due: plan.items.length, value: planDone.length / plan.items.length });
    if (logDue.length) parts.push({ id: 'log', weight: w.log, done: logDone.length, due: logDue.length, value: logDone.length / logDue.length });
    parts.push({ id: 'close', weight: w.close, done: closed ? 1 : 0, due: 1, value: closed ? 1 : 0 });
    const totalW = parts.reduce((s, p) => s + p.weight, 0);
    const score = Math.round((parts.reduce((s, p) => s + p.weight * p.value, 0) / totalW) * 100);

    const minDone = minimumDone(d);
    let status: DayStatus;
    if (score >= threshold) status = 'won';
    else if (d === today) status = 'pending';
    else if (rest) status = 'rest';
    else if (!routineIds.length && !plan) status = 'free';
    else if (minDone) status = 'saved';
    else status = 'lost';

    return { score, status: status as DayStatus, parts, totalW, isEmpty, minDone, routineIds, routineDone, plan, logDue, logDone, closed };
  };

  // ---- Todos los días desde el inicio ----
  const dates: string[] = [];
  for (let d = start; d <= today; d = addDays(d, 1)) dates.push(d);
  const raw = dates.map((d) => ({ d, ...evaluate(d) }));

  // Pausas: rachas de días terminados y vacíos de al menos `pauseMinDays`.
  for (let i = 0; i < raw.length; ) {
    if (!raw[i].isEmpty || raw[i].d === today) {
      i++;
      continue;
    }
    let j = i;
    while (j < raw.length && raw[j].isEmpty && raw[j].d !== today) j++;
    if (j - i >= cfg.pauseMinDays) for (let k = i; k < j; k++) if (raw[k].status === 'lost') raw[k].status = 'pause';
    i = j;
  }

  // ---- Impulso y contadores (en orden) ----
  const out: Record<string, DayResult> = {};
  let winRun = 0;
  let inPause = false;
  let beforePause = 0;
  let pausedDays = 0;
  let comeback: DaysState['comeback'] = null;
  let won = 0;
  let saved = 0;
  let run = 0;
  let bestRun = 0;
  for (const r of raw) {
    const pct = pctOf(steps, winRun);
    out[r.d] = { date: r.d, score: r.score, status: r.status, parts: r.parts, pct, empty: r.isEmpty, minimumDone: r.minDone };

    // Durante una pausa, los días vacíos (también los libres) siguen siendo parte de ella: el regreso es el
    // primer día en que registras algo. Así una pausa completa baja un solo escalón y se puede recuperar.
    if (inPause && r.isEmpty && r.status !== 'pause' && r.d !== today) {
      pausedDays++;
      continue;
    }
    const returning = inPause && !r.isEmpty;
    if (returning) {
      inPause = false;
      const active = missions.activeDays.has(r.d);
      if (r.d === today) comeback = { pausedDays, done: active, restoresPct: pctOf(steps, beforePause) };
      if (active) winRun = Math.max(winRun, beforePause);
    }

    if (r.d === today) {
      if (r.status === 'won') {
        won++;
        run++;
        bestRun = Math.max(bestRun, run);
      }
      break;
    }
    switch (r.status) {
      case 'won':
        winRun++;
        won++;
        run++;
        bestRun = Math.max(bestRun, run);
        break;
      case 'lost':
        winRun = coolDown(steps, winRun);
        run = 0;
        break;
      case 'pause':
        if (!inPause) {
          inPause = true;
          beforePause = winRun;
          pausedDays = 0;
          winRun = coolDown(steps, winRun);
        }
        pausedDays++;
        break;
      case 'saved':
        saved++;
        break;
      default:
        break;
    }
  }
  // Si hoy sigue la pausa (hoy vacío después de una pausa), al regresar se ofrece la jugada de regreso.
  if (inPause && !comeback) comeback = { pausedDays, done: false, restoresPct: pctOf(steps, beforePause) };

  // ---- Hoy ----
  const t = raw[raw.length - 1];
  const todayRes = out[today];
  const share = (weight: number, n: number) => (n > 0 ? (weight / n / t.totalW) * 100 : 0);
  const pending = new Map<string, PendingItem>();
  for (const id of t.routineIds) {
    if (t.routineDone.includes(id)) continue;
    pending.set(id, { missionId: id, title: titleOf.get(id) ?? id, points: share(w.routine, t.routineIds.length), inPlan: false, inRoutine: true });
  }
  for (const it of t.plan?.items ?? []) {
    if (it.done) continue;
    const prev = pending.get(it.missionId);
    const pts = share(w.plan, t.plan!.items.length);
    pending.set(it.missionId, prev ? { ...prev, points: prev.points + pts, inPlan: true } : { missionId: it.missionId, title: it.title, points: pts, inPlan: true, inRoutine: false });
  }
  const logShare = share(w.log, t.logDue.length);
  const today_: TodayResult = {
    ...todayRes,
    pending: [...pending.values()].map((p) => ({ ...p, points: Math.round(p.points) })).sort((a, b) => b.points - a.points || Number(b.inPlan) - Number(a.inPlan)),
    logMissing: t.logDue.filter((id) => !t.logDone.includes(id)).map((id) => ({ id, points: Math.round(logShare) })),
    closed: t.closed,
    closePoints: t.closed ? 0 : Math.round(share(w.close, 1)),
    toWin: Math.max(0, threshold - todayRes.score),
  };

  // Semana en curso.
  const ws = weekStart(today);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(ws, i);
    const r = out[date];
    return { date, status: r?.status ?? null, score: r?.score ?? null };
  });

  // Temporada en curso.
  const cur = deps.seasons.current;
  const season = cur ? { won: Object.values(out).filter((r) => r.status === 'won' && r.date >= cur.data.startDate && r.date <= cur.data.endDate).length } : null;

  // Seguidilla actual: días ganados seguidos; los neutros no la rompen, un día no ganado sí.
  let currentRun = 0;
  for (let i = raw.length - 1; i >= 0; i--) {
    const st = out[raw[i].d].status;
    if (st === 'won') currentRun++;
    else if (!NEUTRAL.has(st)) break;
  }

  const step = stepOf(steps, winRun);
  const nextStep = steps[step + 1];
  return {
    start,
    threshold,
    byDate: out,
    today: today_,
    week: { start: ws, days: weekDays, won: weekDays.filter((x) => x.status === 'won').length },
    totals: { won, saved, currentRun, bestRun },
    season,
    momentum: {
      pct: pctOf(steps, winRun),
      step,
      winRun,
      next: nextStep ? { wins: nextStep.wins, pct: nextStep.pct, missing: nextStep.wins - winRun } : null,
      pctIfLost: pctOf(steps, coolDown(steps, winRun)),
      pctIfWon: pctOf(steps, winRun + 1),
    },
    comeback,
  };
}

function emptyState(start: string | null, threshold: number, today: string, steps: Steps): DaysState {
  const ws = weekStart(today);
  return {
    start,
    threshold,
    byDate: {},
    today: null,
    week: { start: ws, days: Array.from({ length: 7 }, (_, i) => ({ date: addDays(ws, i), status: null, score: null })), won: 0 },
    totals: { won: 0, saved: 0, currentRun: 0, bestRun: 0 },
    season: null,
    momentum: { pct: pctOf(steps, 0), step: 0, winRun: 0, next: steps[1] ? { wins: steps[1].wins, pct: steps[1].pct, missing: steps[1].wins } : null, pctIfLost: pctOf(steps, 0), pctIfWon: pctOf(steps, 1) },
    comeback: null,
  };
}
