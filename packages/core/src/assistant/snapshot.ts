import { GAME_CONFIG } from '../config/game';
import type { GameState } from '../engine/project';
import { challengeDayNumber } from '../engine/modules/challenges';
import {
  ATTRIBUTE_IDS,
  ATTRIBUTE_NAMES,
  SKILL_RANK_NAMES,
  isInRoutine,
  type AchievementData,
  type AttributeId,
  type BookData,
  type BossData,
  type ChallengeData,
  type CompletionKind,
  type Entity,
  type GoalData,
  type MainQuestData,
  type MissionData,
  type MissionSize,
  type NpcData,
  type RecurringBossData,
  type SavingsData,
  type SkillData,
  type TodoData,
  type ViceData,
} from '../types';
import { addDays, weekStart, weekday } from '../util/dates';

/**
 * "Foto" compacta del estado del juego para asistentes de IA (servidor MCP y Coach).
 * Es SOLO una caché derivada de `project()`: nunca es fuente de verdad. La arma el dispositivo (que ya
 * calcula el estado) o el servidor cuando la que tiene quedó vieja.
 * Si cambias su forma, sube SNAPSHOT_SCHEMA para que se descarten las fotos guardadas.
 */
export const SNAPSHOT_SCHEMA = 2;

/**
 * Huella de los números del juego (config/game.ts). Si se despliega otra configuración, las fotos viejas
 * (o las que suba una PWA con el código anterior) dejan de valer y se recalculan.
 */
export const CONFIG_FINGERPRINT: string = (() => {
  let h = 2166136261;
  for (const ch of JSON.stringify(GAME_CONFIG)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
})();

export interface SnapshotMission {
  id: string;
  title: string;
  size: MissionSize;
  attribute: AttributeId;
  kind: CompletionKind;
}

export interface AssistantSnapshot {
  schema: number;
  /** CONFIG_FINGERPRINT con el que se calculó. */
  config: string;
  /** Mayor `updated_at` (ms) de eventos y catálogo incluidos en el cálculo. */
  version: number;
  today: string;
  computedAt: string;
  computedBy: 'app' | 'servidor';
  profile: { name: string; className: string; currency: string; monthlyGoal: number; birthDate: string | null };
  level: { level: number; title: string; totalXp: number; nextLevelXp: number; toNext: number };
  xp: {
    today: number;
    thisWeek: number;
    lastWeek: number;
    /** XP por día de los últimos 42 días. */
    byDate: Record<string, number>;
    recent: { date: string; amount: number; label: string; source: string }[];
  };
  streak: { current: number; best: number; todayActive: boolean; todayRest: boolean; restLeftThisWeek: number };
  energy: { sleepHours: number | null; value: number | null; low: boolean };
  attributes: { id: AttributeId; name: string; value: number }[];
  gold: { balance: number; earnedToday: number; locked: number };
  money: { month: string; income: number; expense: number; goal: number; goalReachedOn: string | null };
  season: { number: number; name: string; week: number | null; weeks: number; focus: string | null } | null;
  day: {
    /** Diarias de la rutina que tocan hoy. */
    routine: (SnapshotMission & { done: boolean; recovery: boolean })[];
    /** Lo que ya contó hoy (misiones). */
    done: SnapshotMission[];
    plan: { items: { title: string; done: boolean }[]; completed: boolean } | null;
    planTomorrow: { title: string }[] | null;
    bounty: { missionId: string; title: string; bonus: number; completed: boolean } | null;
    /** Pendientes de la agenda sin hacer hasta dentro de 7 días (incluye atrasados). */
    agenda: { id: string; title: string; date: string; size: MissionSize; attribute: AttributeId }[];
    closed: boolean;
  };
  mainQuests: { id: string; code: string; title: string; goal: string; inFocus: boolean }[];
  sideMissions: { id: string; title: string; size: MissionSize; attribute: AttributeId; kind: string }[];
  bosses: {
    id: string;
    name: string;
    phasesDone: number;
    phases: number;
    locked: boolean;
    defeated: boolean;
    next: { index: number; title: string; manual: boolean; progress: { current: number; target: number; unit: string } | null } | null;
  }[];
  recurring: { id: string; name: string; defeats: number; lastDate: string | null; condition: string }[];
  goals: { id: string; title: string; current: number; target: number; unit: string; deadline: string | null; completedOn: string | null; archived: boolean }[];
  challenges: {
    id: string;
    title: string;
    days: number;
    status: 'en curso' | 'sin iniciar' | 'completado' | 'fallido';
    dayNumber: number | null;
    checked: number;
    /** Intento en curso: día de inicio y días marcados. */
    startDate: string | null;
    checkedDates: string[];
    /** Último intento cerrado: cuándo empezó, cuándo se cerró y cómo (si falló, closedOn es el día sin marcar). */
    lastClosedOn: string | null;
    lastStartDate: string | null;
    lastStatus: 'completado' | 'fallido' | null;
    checkedToday: boolean;
    completions: number;
    archived: boolean;
  }[];
  vices: { id: string; name: string; current: number; best: number; lastRelapse: string | null }[];
  people: {
    overdue: { id: string; npcId: string; name: string; daysSince: number | null }[];
    keyPeople: number;
    total: number;
    /** Último contacto de cada persona (interacciones y misiones "Escribirle a X"). */
    lastContact: Record<string, string | null>;
  };
  achievements: { unlocked: number; total: number; recent: { name: string; date: string }[] };
  skills: { id: string; name: string; rank: number; rankName: string | null }[];
  pledges: { id: string; title: string; stake: number; deadline: string }[];
  library: { reading: { id: string; title: string }[]; finishedThisYear: number };
  savings: { id: string; name: string; current: number; target: number }[];
  lessons: number;
  lastJournal: { weekStart: string; happened: string; learned: string; next: string } | null;
}

type Lister = <D>(module: string, kind?: string) => Entity<D>[];

function lister(entities: Entity[]): Lister {
  const active = entities.filter((e) => !e.deletedAt).sort((a, b) => a.sort - b.sort);
  return <D,>(module: string, kind?: string) => active.filter((e) => e.module === module && (!kind || e.kind === kind)) as Entity<D>[];
}

/** Arma la foto a partir del estado ya proyectado (mismo código en el dispositivo y en el servidor). */
export function buildSnapshot(
  state: GameState,
  entities: Entity[],
  meta: { version: number; computedBy: 'app' | 'servidor'; now?: Date },
): AssistantSnapshot {
  const list = lister(entities);
  const today = state.today;
  const ledger = state.xp.ledger;
  const ws = weekStart(today);
  const sumRange = (from: string, to: string) => ledger.reduce((s, e) => (e.date >= from && e.date <= to ? s + e.amount : s), 0);
  const byDate: Record<string, number> = {};
  const from42 = addDays(today, -41);
  for (const e of ledger) if (e.date >= from42 && e.date <= today) byDate[e.date] = (byDate[e.date] ?? 0) + e.amount;

  const season = state.seasons.current;
  const mains = list<MainQuestData>('missions', 'main');
  const focusId = season?.data.focusMainQuestId ?? null;
  const focus = mains.find((q) => q.id === focusId);

  const completedOn = (id: string, date: string) => !!state.missions.completions[id]?.dates.includes(date);
  const wd = weekday(today);
  const dailies = list<MissionData>('missions', 'daily');
  const routine = dailies
    .filter((m) => isInRoutine(m.data, wd))
    .map((m) => ({
      id: m.id,
      title: m.data.title,
      size: m.data.size,
      attribute: m.data.attribute,
      kind: 'daily' as const,
      done: completedOn(m.id, today),
      recovery: !!m.data.recovery,
    }));

  const done: SnapshotMission[] = [];
  for (const e of ledger) {
    if (e.date !== today || e.source !== 'mission' || !e.refId) continue;
    const ent = entities.find((x) => x.id === e.refId);
    done.push({
      id: e.refId,
      title: e.label,
      size: ((ent?.data as MissionData | undefined)?.size ?? sizeFromXp(e.amount)) as MissionSize,
      attribute: (e.attribute ?? 'disciplina') as AttributeId,
      kind: (ent ? ent.kind : e.refId.startsWith('quick-') ? 'quick' : e.refId.startsWith('npc-') ? 'npc' : 'daily') as CompletionKind,
    });
  }

  const plan = state.plans[today];
  const planTomorrow = state.plans[addDays(today, 1)];
  const todos = list<TodoData>('planner', 'todo');
  const limit = addDays(today, 7);
  const agenda = todos
    .filter((t) => !state.missions.completions[t.id] && t.data.date <= limit)
    .sort((a, b) => (a.data.date < b.data.date ? -1 : a.data.date > b.data.date ? 1 : 0))
    .map((t) => ({ id: t.id, title: t.data.title, date: t.data.date, size: t.data.size, attribute: t.data.attribute }));

  const sideMissions = list<MissionData>('missions')
    .filter((m) => ['side', 'chapter', 'event'].includes(m.kind) && !state.missions.completions[m.id])
    .map((m) => ({ id: m.id, title: m.data.title, size: m.data.size, attribute: m.data.attribute, kind: m.kind }));

  const bosses = list<BossData>('bosses', 'boss').map((b) => {
    const st = state.bosses.bosses[b.id];
    const idx = st ? st.phases.findIndex((p) => !p.done) : 0;
    const next = st && idx >= 0 ? st.phases[idx] : null;
    return {
      id: b.id,
      name: b.data.name,
      phasesDone: st?.phasesDone ?? 0,
      phases: b.data.phases.length,
      locked: !!st?.locked,
      defeated: !!st?.defeated,
      next: next ? { index: idx, title: next.title, manual: !next.auto, progress: next.progress } : null,
    };
  });

  const recurring = list<RecurringBossData>('bosses', 'recurring').map((r) => ({
    id: r.id,
    name: r.data.name,
    defeats: state.bosses.recurring[r.id]?.defeats ?? 0,
    lastDate: state.bosses.recurring[r.id]?.lastDate ?? null,
    condition: r.data.defeatCondition,
  }));

  const goals = list<GoalData>('goals', 'goal').map((g) => {
    const st = state.goals[g.id];
    return {
      id: g.id,
      title: g.data.title,
      current: st?.current ?? 0,
      target: g.data.target,
      unit: g.data.unit,
      deadline: g.data.deadline ?? null,
      completedOn: st?.completedOn ?? null,
      archived: !!g.data.archived,
    };
  });

  const challenges = list<ChallengeData>('challenges', 'challenge').map((c) => {
    const st = state.challenges[c.id];
    const cur = st?.current ?? null;
    const last = st?.last ?? null;
    const status = cur ? 'en curso' : !last ? 'sin iniciar' : last.status === 'completed' ? 'completado' : 'fallido';
    return {
      id: c.id,
      title: c.data.title,
      days: c.data.days,
      status: status as AssistantSnapshot['challenges'][number]['status'],
      dayNumber: cur ? challengeDayNumber(cur, today) : null,
      checked: cur?.checked.length ?? 0,
      startDate: cur?.startDate ?? null,
      checkedDates: cur ? [...cur.checked] : [],
      ...(() => {
        const closed = [...(st?.attempts ?? [])].reverse().find((a) => a.closedOn);
        return {
          lastClosedOn: closed?.closedOn ?? null,
          lastStartDate: closed?.startDate ?? null,
          lastStatus: closed ? (closed.status === 'completed' ? ('completado' as const) : ('fallido' as const)) : null,
        };
      })(),
      checkedToday: !!st?.checkedToday,
      completions: st?.completions ?? 0,
      archived: !!c.data.archived,
    };
  });

  const vices = list<ViceData>('habits', 'vice').map((v) => ({
    id: v.id,
    name: v.data.name,
    current: state.vices[v.id]?.current ?? 0,
    best: state.vices[v.id]?.best ?? 0,
    lastRelapse: state.vices[v.id]?.lastRelapse ?? null,
  }));

  const npcs = list<NpcData>('npcs', 'npc');
  const overdue = state.npcs.generatedMissions
    .filter((m) => state.npcs.npcs[m.npcId]?.overdue)
    .map((m) => ({ id: m.id, npcId: m.npcId, name: npcs.find((n) => n.id === m.npcId)?.data.name ?? m.title, daysSince: state.npcs.npcs[m.npcId]?.daysSince ?? null }));

  const achs = list<AchievementData>('achievements', 'achievement');
  const unlocked = achs
    .filter((a) => state.achievements[a.id]?.unlocked)
    .map((a) => ({ name: a.data.name, date: state.achievements[a.id]?.date ?? '' }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const year = today.slice(0, 4);
  const journal = Object.values(state.seasons.journal).sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))[0] ?? null;

  return {
    schema: SNAPSHOT_SCHEMA,
    config: CONFIG_FINGERPRINT,
    version: meta.version,
    today,
    computedAt: (meta.now ?? new Date()).toISOString(),
    computedBy: meta.computedBy,
    profile: {
      name: state.settings.name,
      className: state.settings.className,
      currency: state.settings.currency,
      monthlyGoal: state.settings.monthlyGoal,
      birthDate: state.settings.birthDate,
    },
    level: {
      level: state.level.level,
      title: state.level.title,
      totalXp: state.level.totalXp,
      nextLevelXp: state.level.nextLevelXp,
      toNext: Math.max(0, state.level.nextLevelXp - state.level.totalXp),
    },
    xp: {
      today: state.xp.today,
      thisWeek: sumRange(ws, addDays(ws, 6)),
      lastWeek: sumRange(addDays(ws, -7), addDays(ws, -1)),
      byDate,
      recent: [...ledger]
        .reverse()
        .slice(0, 15)
        .map((e) => ({ date: e.date, amount: e.amount, label: e.label, source: e.source })),
    },
    streak: {
      current: state.streak.current,
      best: state.streak.best,
      todayActive: state.streak.todayActive,
      todayRest: state.streak.todayRest,
      restLeftThisWeek: state.streak.restDaysLeftThisWeek,
    },
    energy: { ...state.energy },
    attributes: ATTRIBUTE_IDS.map((id) => ({ id, name: ATTRIBUTE_NAMES[id], value: state.attributes.values[id].value })),
    gold: { balance: state.gold.balance, earnedToday: state.gold.earnedToday, locked: state.gold.locked },
    money: {
      month: state.money.currentMonth,
      income: state.money.monthIncome,
      expense: state.money.monthExpense,
      goal: state.money.goal,
      goalReachedOn: state.money.months[state.money.currentMonth]?.goalReachedOn ?? null,
    },
    season: season
      ? { number: season.data.number, name: season.data.name, week: state.seasons.currentWeek, weeks: GAME_CONFIG.season.weeks, focus: focus ? `${focus.data.code} ${focus.data.title}` : null }
      : null,
    day: {
      routine,
      done,
      plan: plan ? { items: plan.items.map((i) => ({ title: i.title, done: i.done })), completed: plan.completed } : null,
      planTomorrow: planTomorrow ? planTomorrow.items.map((i) => ({ title: i.title })) : null,
      bounty: state.bounty.today
        ? { missionId: state.bounty.today.missionId, title: state.bounty.today.title, bonus: state.bounty.today.bonus, completed: state.bounty.today.completed }
        : null,
      agenda,
      closed: !!state.dayClosures[today],
    },
    mainQuests: mains.map((q) => ({ id: q.id, code: q.data.code, title: q.data.title, goal: q.data.goal, inFocus: q.id === focusId })),
    sideMissions,
    bosses,
    recurring,
    goals,
    challenges,
    vices,
    people: {
      overdue,
      keyPeople: npcs.filter((n) => n.data.key).length,
      total: npcs.length,
      lastContact: Object.fromEntries(npcs.map((n) => [n.id, state.npcs.npcs[n.id]?.lastInteraction ?? null])),
    },
    achievements: { unlocked: unlocked.length, total: achs.length, recent: unlocked.slice(0, 5) },
    skills: list<SkillData>('skills', 'skill').map((s) => {
      const rank = state.skills[s.id]?.rank ?? 0;
      return { id: s.id, name: s.data.name, rank, rankName: rank > 0 ? SKILL_RANK_NAMES[rank - 1] : null };
    }),
    pledges: state.gold.pledges.filter((p) => p.valid && p.status === 'open').map((p) => ({ id: p.pledgeId, title: p.title, stake: p.stake, deadline: p.deadline })),
    library: {
      reading: list<BookData>('library', 'book')
        .filter((b) => !state.library.finished[b.id] && b.data.status === 'leyendo')
        .map((b) => ({ id: b.id, title: b.data.title })),
      finishedThisYear: state.library.byYear[year] ?? 0,
    },
    savings: list<SavingsData>('finance', 'savings').map((s) => ({ id: s.id, name: s.data.name, current: state.savings[s.id]?.current ?? 0, target: s.data.target })),
    lessons: state.lessons.count,
    lastJournal: journal ? { weekStart: journal.weekStart, happened: journal.happened, learned: journal.learned, next: journal.next } : null,
  };
}

function sizeFromXp(xp: number): MissionSize {
  const entries = Object.entries(GAME_CONFIG.missionXp) as [MissionSize, number][];
  // Con bono de misión sorpresa la XP sube: se toma el tamaño más grande que no la exceda.
  let best: MissionSize = 'chica';
  for (const [size, amount] of entries) if (amount <= xp) best = size;
  return best;
}
