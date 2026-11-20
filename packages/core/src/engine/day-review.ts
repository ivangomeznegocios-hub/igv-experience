import { GAME_CONFIG } from '../config/game';
import { describeEvent, EVENT_TEXT, fmtMoney } from '../assistant/format';
import { isInRoutine, type Entity, type GameEvent, type MissionData, type TodoData, type TrainingSettingsData, type ViceData } from '../types';
import { toLocalDate, weekday } from '../util/dates';
import type { GameState } from './project';
import { quickMissionId } from './reports';
import { linkedTrainingDailyId } from './training';

/**
 * "¿Cómo fue tu día?": qué registraste un día (agrupado por área) y qué falta, con un % de día registrado.
 * Es solo lectura (no da XP). Las revisiones (`DAY_CHECKS`) son un registro abierto: cada sistema agrega la suya
 * con una entrada (ver docs/sistemas/habitos.md). "Nada que registrar" se guarda como `day.check_skipped`.
 */

// ---------------------------------------------------------------------------------------------
// Áreas del día
// ---------------------------------------------------------------------------------------------

export interface DayArea {
  id: string;
  label: string;
  /** Nombre de ícono de la app (ui/icons.tsx). */
  icon: string;
}

/** Áreas en el orden en que se muestran. */
export const DAY_AREAS: DayArea[] = [
  { id: 'misiones', label: 'Lo que hiciste', icon: 'check' },
  { id: 'trabajo', label: 'Trabajo y tiempo', icon: 'clock' },
  { id: 'dinero', label: 'Dinero', icon: 'coin' },
  { id: 'gente', label: 'Gente', icon: 'users' },
  { id: 'cuerpo', label: 'Cuerpo y sueño', icon: 'heart' },
  { id: 'aprendizaje', label: 'Aprendizaje', icon: 'feather' },
  { id: 'agenda', label: 'Agenda y plan', icon: 'calendar' },
  { id: 'progreso', label: 'Metas y retos', icon: 'flag' },
  { id: 'habitos', label: 'Hábitos a dejar', icon: 'shield' },
  { id: 'cierre', label: 'Cierre del día', icon: 'campfire' },
  { id: 'otros', label: 'Otros registros', icon: 'list' },
];

/** Área de cada tipo de evento (lo que no esté aquí cae en "Otros registros"). */
export const EVENT_AREAS: Record<string, string> = {
  'mission.completed': 'misiones',
  'rest_day.marked': 'misiones',
  'income.recorded': 'dinero',
  'expense.recorded': 'dinero',
  'savings.moved': 'dinero',
  'npc.interaction': 'gente',
  'checkin.morning': 'cuerpo',
  'body.logged': 'cuerpo',
  'lesson.written': 'aprendizaje',
  'library.finished': 'aprendizaje',
  'skill.rank_unlocked': 'aprendizaje',
  'journal.weekly': 'aprendizaje',
  'season.review': 'aprendizaje',
  'plan.set': 'agenda',
  'goal.progress': 'progreso',
  'challenge.started': 'progreso',
  'challenge.checked': 'progreso',
  'boss.phase_completed': 'progreso',
  'boss.recurring_defeated': 'progreso',
  'achievement.unlocked': 'progreso',
  'pledge.made': 'progreso',
  'pledge.resolved': 'progreso',
  'reward.redeemed': 'progreso',
  'map.status_changed': 'otros',
  'vice.relapse': 'habitos',
  'day.closed': 'cierre',
  // Sistemas integrados después
  'time.logged': 'trabajo',
  'library.progress': 'aprendizaje',
  'library.note': 'aprendizaje',
  'learning.reviewed': 'aprendizaje',
  'learning.test_taken': 'aprendizaje',
  'health.checkup_done': 'cuerpo',
  'health.metric': 'cuerpo',
  'workout.logged': 'cuerpo',
  'place.visited': 'gente',
};

/** Registros internos que no se listan en la revisión. */
export const HIDDEN_IN_REVIEW = new Set(['bounty.drawn', 'daily.selected', 'weekly.selected', 'profile.attributes_rated', 'day.check_skipped']);

// ---------------------------------------------------------------------------------------------
// Revisiones (checks)
// ---------------------------------------------------------------------------------------------

/** Lo que una revisión puede leer de un día. Solo datos del día y del catálogo, para que funcione igual en la app y en la IA. */
export interface DayCheckContext {
  date: string;
  today: string;
  isToday: boolean;
  /** 0 = lunes … 6 = domingo. */
  weekday: number;
  /** Día de descanso marcado. */
  restDay: boolean;
  /** Registros vigentes (no anulados) del día. */
  events: GameEvent[];
  of<P = any>(type: string): GameEvent<P>[];
  /** Catálogo activo. */
  entities: Entity[];
  list<D = any>(module: string, kind?: string): Entity<D>[];
  /** Misiones completadas ese día (ids). */
  doneOn: Set<string>;
  /** Misión o pendiente completado alguna vez (cualquier día). */
  doneEver(id: string): boolean;
  /** Plan del día ("Tus 3"), si lo hubo. */
  plan: { items: { missionId: string; title: string; done?: boolean }[] } | null;
  /** Desde cuándo cuenta cada diaria de la rutina (id → fecha). */
  habitSince: Record<string, string>;
  currency: string;
  /** Estado completo: solo existe en la app (la IA no lo tiene). Úsalo únicamente para detalles opcionales. */
  state?: GameState;
}

export interface DayCheck {
  id: string;
  /** Área (DAY_AREAS) a la que pertenece. */
  area: string;
  /** Título corto ("Sueño"). */
  label: string;
  /** Para listas compactas: "Te falta: sueño, gastos y con quién estuviste". */
  short: string;
  /** La pregunta (la app la muestra y el Coach se la puede hacer). */
  question: string;
  /** Si se puede responder "nada que registrar": el texto del botón ("No gasté nada"). */
  skipLabel?: string;
  /** Herramienta de IA con la que se llena (para el Coach). */
  tool?: string;
  /** ¿Aplica ese día? (por defecto, sí). */
  applies?(c: DayCheckContext): boolean;
  /** Avance de 0 a 1 (1 = listo). */
  progress(c: DayCheckContext): number;
  /** Lo registrado, en pocas palabras ("7.5 h", "3 gastos · $450"). */
  detail?(c: DayCheckContext): string | null;
  /** Lo que falta por hacer (títulos), para revisiones de cumplir (rutina, agenda…). */
  pending?(c: DayCheckContext): string[];
}

/** Atajo para la revisión más común: "¿hay al menos un registro de estos tipos ese día?". */
export function eventCheck(def: Omit<DayCheck, 'progress'> & { types: string[]; progress?: DayCheck['progress'] }): DayCheck {
  const { types, ...rest } = def;
  const has = (c: DayCheckContext) => c.events.some((e) => types.includes(e.type));
  return {
    detail: (c) => {
      const n = c.events.filter((e) => types.includes(e.type)).length;
      return n ? `${n} ${n === 1 ? 'registro' : 'registros'}` : null;
    },
    ...rest,
    progress: def.progress ?? ((c) => (has(c) ? 1 : 0)),
  };
}

const MOODS = ['muy mal', 'mal', 'normal', 'bien', 'excelente'];
const fmtList = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`);
const nameOf = (c: DayCheckContext, id: unknown) => {
  const d = c.entities.find((e) => e.id === id)?.data as { name?: string; title?: string } | undefined;
  return d?.name ?? d?.title ?? null;
};

/** Diarias de la rutina que tocaban ese día (y ya existían). */
export function routineForDay(c: Pick<DayCheckContext, 'list' | 'weekday' | 'date' | 'habitSince' | 'doneOn'>): Entity<MissionData>[] {
  return c.list<MissionData>('missions', 'daily').filter((m) => {
    if (!isInRoutine(m.data, c.weekday)) return false;
    if (isDailyDone(c, m)) return true;
    const since = c.habitSince[m.id] ?? (m.createdAt && m.createdAt > 0 ? toLocalDate(m.createdAt, GAME_CONFIG.timezone) : null);
    return !since || since <= c.date;
  });
}

/** Una diaria cuenta como hecha si se completó ese día (o se registró como "Hice algo" con su mismo título). */
export function isDailyDone(c: Pick<DayCheckContext, 'doneOn'>, m: Entity<MissionData>): boolean {
  return c.doneOn.has(m.id) || c.doneOn.has(quickMissionId(m.data.title));
}

/** Una cosa de "tus 3" está hecha si se hizo ese día (o, si solo cuenta una vez, si ya se había hecho; lo dice el motor). */
const planItemDone = (c: Pick<DayCheckContext, 'doneOn'>, i: { missionId: string; done?: boolean }) => !!i.done || c.doneOn.has(i.missionId);

function todosForDay(c: DayCheckContext): Entity<TodoData>[] {
  return c.list<TodoData>('planner', 'todo').filter((t) => t.data.date === c.date || (c.isToday && t.data.date < c.date && !c.doneEver(t.id)));
}

/** Áreas de "Tu tiempo" que cuentan como trabajo en la revisión del día (la oficina va en "trabajo"). */
export const WORK_TIME_AREAS: readonly string[] = ['trabajo', 'proyecto'];
/** Registros de tiempo de trabajo del día (el tiempo con tu gente, de ocio, traslados… no responde "¿cuánto trabajaste?"). */
const workTime = (c: DayCheckContext) => c.of<{ minutes: number; area?: string }>('time.logged').filter((e) => WORK_TIME_AREAS.includes(String(e.payload.area)));

const touchesPeople = (e: GameEvent) => {
  const p = (e.payload ?? {}) as { npcId?: unknown; npcIds?: unknown };
  return e.type === 'npc.interaction' || (typeof p.npcId === 'string' && p.npcId !== '') || (Array.isArray(p.npcIds) && p.npcIds.length > 0);
};

/**
 * Revisiones del día, en orden de prioridad. Para agregar una: una entrada aquí (o `eventCheck({...})`)
 * y, en la app, su acción en `apps/web/src/ui/dayCheckActions.tsx`. Ver docs/sistemas/habitos.md.
 */
export const DAY_CHECKS: DayCheck[] = [
  {
    id: 'sueno',
    area: 'cuerpo',
    label: 'Sueño',
    short: 'sueño',
    question: '¿Cuántas horas dormiste?',
    tool: 'registrar_sueno',
    progress: (c) => (c.of('checkin.morning').length ? 1 : 0),
    detail: (c) => {
      const e = c.of<{ sleepHours: number }>('checkin.morning').at(-1);
      return e ? `${e.payload.sleepHours} h` : null;
    },
  },
  {
    id: 'actividad',
    area: 'misiones',
    label: 'Lo que hiciste',
    short: 'lo que hiciste',
    question: '¿Qué hiciste? Registra al menos una cosa (o marca descanso).',
    tool: 'completar_mision',
    applies: (c) => !c.restDay,
    progress: (c) => (c.of('mission.completed').length ? 1 : 0),
    detail: (c) => {
      const n = new Set(c.of<{ missionId: string }>('mission.completed').map((e) => e.payload.missionId)).size;
      return n ? `${n} ${n === 1 ? 'cosa' : 'cosas'}` : null;
    },
  },
  {
    id: 'rutina',
    area: 'misiones',
    label: 'Rutina',
    short: 'tu rutina',
    question: '¿Cumpliste tu rutina?',
    tool: 'completar_mision',
    applies: (c) => !c.restDay && routineForDay(c).length > 0,
    progress: (c) => {
      const r = routineForDay(c);
      return r.length ? r.filter((m) => isDailyDone(c, m)).length / r.length : 1;
    },
    detail: (c) => {
      const r = routineForDay(c);
      return `${r.filter((m) => isDailyDone(c, m)).length}/${r.length}`;
    },
    pending: (c) => routineForDay(c).filter((m) => !isDailyDone(c, m)).map((m) => m.data.title),
  },
  eventCheck({
    id: 'tiempo',
    area: 'trabajo',
    label: 'Tiempo',
    short: 'cuánto tiempo trabajaste',
    question: '¿Cuánto tiempo estuviste en la oficina o trabajando, y en qué?',
    types: ['time.logged'],
    applies: (c) => c.weekday < 5 && !c.restDay,
    progress: (c) => (workTime(c).length ? 1 : 0),
    detail: (c) => {
      const min = workTime(c).reduce((s, e) => s + (e.payload.minutes || 0), 0);
      if (!min) return null;
      const h = Math.floor(min / 60);
      const m = min % 60;
      return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
    },
    skipLabel: 'No trabajé',
    tool: 'registrar_tiempo',
  }),
  {
    id: 'gastos',
    area: 'dinero',
    label: 'Gastos',
    short: 'gastos',
    question: '¿Gastaste algo?',
    skipLabel: 'No gasté nada',
    tool: 'registrar_dinero',
    progress: (c) => (c.of('expense.recorded').length ? 1 : 0),
    detail: (c) => {
      const xs = c.of<{ amount: number }>('expense.recorded');
      return xs.length ? `${xs.length} · ${fmtMoney(xs.reduce((s, e) => s + Number(e.payload.amount || 0), 0), c.currency)}` : null;
    },
  },
  {
    id: 'gente',
    area: 'gente',
    label: 'Gente',
    short: 'con quién estuviste',
    question: '¿Con quién estuviste o hablaste?',
    skipLabel: 'Nada que anotar',
    tool: 'registrar_contacto',
    progress: (c) => (c.events.some(touchesPeople) ? 1 : 0),
    detail: (c) => {
      const ids = new Set<string>();
      for (const e of c.events.filter(touchesPeople)) {
        const p = e.payload as { npcId?: string; npcIds?: string[] };
        if (p.npcId) ids.add(p.npcId);
        for (const x of p.npcIds ?? []) ids.add(x);
      }
      const names = [...ids].map((id) => nameOf(c, id)).filter(Boolean) as string[];
      return names.length ? fmtList(names.slice(0, 4)) + (names.length > 4 ? ` y ${names.length - 4} más` : '') : null;
    },
  },
  {
    id: 'agenda',
    area: 'agenda',
    label: 'Agenda',
    short: 'tus pendientes',
    question: '¿Hiciste lo que tenías agendado?',
    tool: 'completar_mision',
    applies: (c) => todosForDay(c).length > 0,
    progress: (c) => {
      const ts = todosForDay(c);
      return ts.length ? ts.filter((t) => c.doneEver(t.id)).length / ts.length : 1;
    },
    detail: (c) => {
      const ts = todosForDay(c);
      return `${ts.filter((t) => c.doneEver(t.id)).length}/${ts.length}`;
    },
    pending: (c) => todosForDay(c).filter((t) => !c.doneEver(t.id)).map((t) => t.data.title),
  },
  {
    id: 'plan',
    area: 'agenda',
    label: 'Tus 3 del día',
    short: 'tu plan',
    question: '¿Cumpliste lo que planeaste?',
    tool: 'completar_mision',
    applies: (c) => !!c.plan?.items.length,
    progress: (c) => (c.plan?.items.length ? c.plan.items.filter((i) => planItemDone(c, i)).length / c.plan.items.length : 1),
    detail: (c) => `${c.plan!.items.filter((i) => planItemDone(c, i)).length}/${c.plan!.items.length}`,
    pending: (c) => (c.plan?.items ?? []).filter((i) => !planItemDone(c, i)).map((i) => i.title),
  },
  {
    id: 'habitos-dejar',
    area: 'habitos',
    label: 'Hábitos a dejar',
    short: 'tus hábitos a dejar',
    question: '¿Recaíste en algún hábito que quieres dejar?',
    skipLabel: 'Todo limpio',
    tool: 'registrar_recaida',
    applies: (c) => c.list<ViceData>('habits', 'vice').some((v) => v.data.startDate <= c.date),
    progress: (c) => (c.of('vice.relapse').length ? 1 : 0),
    detail: (c) => {
      const names = c.of<{ viceId: string }>('vice.relapse').map((e) => nameOf(c, e.payload.viceId) ?? 'hábito');
      return names.length ? `Recaída: ${fmtList([...new Set(names)])}` : null;
    },
  },
  {
    id: 'cierre',
    area: 'cierre',
    label: 'Cierre del día',
    short: 'cerrar el día',
    question: '¿Cómo te fue? Califica tu día y deja una línea.',
    tool: 'cerrar_dia',
    progress: (c) => (c.of('day.closed').length ? 1 : 0),
    detail: (c) => {
      const e = c.of<{ note?: string; mood?: number }>('day.closed').at(-1);
      if (!e) return null;
      const mood = e.payload.mood ? MOODS[e.payload.mood - 1] : '';
      return [mood, e.payload.note?.trim() ? `“${e.payload.note.trim().slice(0, 60)}”` : ''].filter(Boolean).join(' · ') || 'Cerrado';
    },
  },

  // Sistemas integrados después: una entrada cada uno (ver docs/sistemas/habitos.md).
  // Entrenamiento: solo pregunta si marcaste tu diaria de entreno (la ligada en Entrenamiento → Ajustes; por defecto
  // "Entrenar 30 min") sin anotar qué hiciste.
  eventCheck({
    id: 'entreno',
    area: 'cuerpo',
    label: 'Entrenamiento',
    short: 'qué entrenaste',
    question: 'Marcaste tu entreno: ¿qué ejercicios y músculos trabajaste?',
    types: ['workout.logged'],
    applies: (c) => {
      const linked = linkedTrainingDailyId(c.list<TrainingSettingsData>('training', 'settings')[0]?.data, c.list('missions', 'daily'));
      return !!linked && c.doneOn.has(linked);
    },
    skipLabel: 'No quiero anotar detalles',
    tool: 'registrar_entrenamiento',
  }),
];

export function getDayCheck(id: string): DayCheck | undefined {
  return DAY_CHECKS.find((c) => c.id === id);
}

// ---------------------------------------------------------------------------------------------
// Revisión de un día
// ---------------------------------------------------------------------------------------------

export interface DayReviewInput {
  date: string;
  today: string;
  /** Registros (se usan solo los vigentes de ese día). */
  events: GameEvent[];
  /** Catálogo activo. */
  entities: Entity[];
  /** Misión o pendiente completado alguna vez. Si falta, solo se ven los del día. */
  doneEver?: (id: string) => boolean;
  plan?: { items: { missionId: string; title: string; done?: boolean }[] } | null;
  /** Día de descanso válido. Si falta, basta con que esté marcado ese día. */
  restDay?: boolean;
  habitSince?: Record<string, string>;
  /** XP del día (si se conoce). */
  xp?: number | null;
  currency?: string;
  state?: GameState;
  /** Revisiones a usar (por defecto, DAY_CHECKS). */
  checks?: DayCheck[];
}

export type DayCheckStatus = 'done' | 'skipped' | 'missing';

export interface DayCheckResult {
  id: string;
  area: string;
  label: string;
  short: string;
  question: string;
  skipLabel?: string;
  tool?: string;
  status: DayCheckStatus;
  /** Avance 0–1 (lo marcado "nada que registrar" cuenta como 1). */
  progress: number;
  detail: string | null;
  pending: string[];
}

export interface LoggedItem {
  id: string;
  type: string;
  /** Tipo de registro ("Gasto"). */
  label: string;
  /** Detalle ("$450 · tacos"). */
  text: string;
  occurredAt: string;
}

export interface DayReview {
  date: string;
  isToday: boolean;
  future: boolean;
  restDay: boolean;
  /** % del día registrado (0–100); null si es un día futuro o no aplica nada. */
  score: number | null;
  /** Revisiones que aplican ese día, en orden de prioridad. */
  checks: DayCheckResult[];
  /** Las que faltan (con avance < 1 y sin "nada que registrar"). */
  missing: DayCheckResult[];
  /** Lo registrado, agrupado por área (solo áreas con algo). */
  logged: { area: DayArea; items: LoggedItem[] }[];
  numbers: { xp: number | null; missions: number; expense: number; income: number; sleepHours: number | null; records: number };
  closure: { mood: number | null; note: string } | null;
}

function contextFor(input: DayReviewInput): DayCheckContext {
  const events = input.events
    .filter((e) => !e.voidedAt && e.localDate === input.date)
    .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : (a.createdAt ?? 0) - (b.createdAt ?? 0)));
  const byType = new Map<string, GameEvent[]>();
  for (const e of events) {
    if (!byType.has(e.type)) byType.set(e.type, []);
    byType.get(e.type)!.push(e);
  }
  const entities = input.entities.filter((e) => !e.deletedAt);
  const doneOn = new Set((byType.get('mission.completed') ?? []).map((e) => String((e.payload as { missionId: string }).missionId)));
  return {
    date: input.date,
    today: input.today,
    isToday: input.date === input.today,
    weekday: weekday(input.date),
    restDay: input.restDay ?? byType.has('rest_day.marked'),
    events,
    of: <P,>(type: string) => (byType.get(type) ?? []) as GameEvent<P>[],
    entities,
    list: <D,>(module: string, kind?: string) => entities.filter((e) => e.module === module && (!kind || e.kind === kind)).sort((a, b) => a.sort - b.sort) as Entity<D>[],
    doneOn,
    doneEver: input.doneEver ?? ((id) => doneOn.has(id)),
    plan: input.plan ?? null,
    habitSince: input.habitSince ?? {},
    currency: input.currency ?? 'MXN',
    state: input.state,
  };
}

/** Revisa un día: qué se registró (por área), qué falta y el % de día registrado. Pura. */
export function reviewDay(input: DayReviewInput): DayReview {
  const c = contextFor(input);
  const future = input.date > input.today;
  const skipped = new Set(c.of<{ checkId: string }>('day.check_skipped').map((e) => e.payload.checkId));

  const checks: DayCheckResult[] = [];
  if (!future) {
    for (const ch of input.checks ?? DAY_CHECKS) {
      if (ch.applies && !ch.applies(c)) continue;
      const raw = Math.max(0, Math.min(1, ch.progress(c)));
      const isSkipped = raw < 1 && !!ch.skipLabel && skipped.has(ch.id);
      checks.push({
        id: ch.id,
        area: ch.area,
        label: ch.label,
        short: ch.short,
        question: ch.question,
        skipLabel: ch.skipLabel,
        tool: ch.tool,
        status: raw >= 1 ? 'done' : isSkipped ? 'skipped' : 'missing',
        progress: isSkipped ? 1 : raw,
        detail: raw > 0 ? (ch.detail?.(c) ?? null) : null,
        pending: raw < 1 ? (ch.pending?.(c) ?? []) : [],
      });
    }
  }
  const score = checks.length ? Math.round((checks.reduce((s, x) => s + x.progress, 0) / checks.length) * 100) : null;

  const byId = new Map(c.entities.map((e) => [e.id, e]));
  const items = new Map<string, LoggedItem[]>();
  for (const e of c.events) {
    if (HIDDEN_IN_REVIEW.has(e.type)) continue;
    const area = EVENT_AREAS[e.type] ?? 'otros';
    const label = EVENT_TEXT[e.type] ?? e.type;
    const full = describeEvent(e, byId, c.currency);
    // Las misiones van solo con su título (tamaño y atributo sobran en la revisión).
    const text =
      e.type === 'mission.completed'
        ? String((e.payload as { title?: string }).title ?? '')
        : full.startsWith(`${label}: `)
          ? full.slice(label.length + 2)
          : full === label
            ? ''
            : full;
    if (!items.has(area)) items.set(area, []);
    items.get(area)!.push({ id: e.id, type: e.type, label, text, occurredAt: e.occurredAt });
  }
  const known = new Set(DAY_AREAS.map((a) => a.id));
  const logged = [
    ...DAY_AREAS.filter((a) => items.has(a.id)).map((area) => ({ area, items: items.get(area.id)! })),
    // Un área que no esté en DAY_AREAS se muestra al final con su id.
    ...[...items.keys()].filter((k) => !known.has(k)).map((k) => ({ area: { id: k, label: k, icon: 'list' }, items: items.get(k)! })),
  ];

  const sum = (type: string) => c.of<{ amount: number }>(type).reduce((s, e) => s + Number(e.payload.amount || 0), 0);
  const sleep = c.of<{ sleepHours: number }>('checkin.morning').at(-1);
  const close = c.of<{ note?: string; mood?: number }>('day.closed').at(-1);

  return {
    date: input.date,
    isToday: c.isToday,
    future,
    restDay: c.restDay,
    score,
    checks,
    missing: checks.filter((x) => x.status === 'missing'),
    logged,
    numbers: {
      xp: input.xp ?? null,
      missions: c.doneOn.size,
      expense: sum('expense.recorded'),
      income: sum('income.recorded'),
      sleepHours: sleep ? sleep.payload.sleepHours : null,
      records: logged.reduce((s, g) => s + g.items.length, 0),
    },
    closure: close ? { mood: close.payload.mood ?? null, note: close.payload.note ?? '' } : null,
  };
}

/** Arma la entrada de `reviewDay` con el estado completo de la app. */
export function dayReviewInputFromState(state: GameState, events: GameEvent[], entities: Entity[], date: string): DayReviewInput {
  return {
    date,
    today: state.today,
    events,
    entities,
    doneEver: (id) => (state.missions.completions[id]?.count ?? 0) > 0,
    plan: state.plans[date] ?? null,
    // El mismo descanso que usan los hábitos: registrar algo más ese día no le quita lo de descanso.
    restDay: state.habits.restDays.has(date),
    habitSince: Object.fromEntries(state.habits.routine.map((h) => [h.id, h.since])),
    xp: state.xp.ledger.reduce((s, e) => (e.date === date ? s + e.amount : s), 0),
    currency: state.settings.currency,
    state,
  };
}

/** "sueño, gastos y con quién estuviste". */
export function fmtMissing(missing: Pick<DayCheckResult, 'short'>[], max = 3): string {
  const names = missing.map((m) => m.short);
  if (names.length <= max) return fmtList(names);
  return `${names.slice(0, max).join(', ')} y ${names.length - max} más`;
}
