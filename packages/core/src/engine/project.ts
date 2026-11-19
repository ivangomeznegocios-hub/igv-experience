import { GAME_CONFIG, type GameConfigInput } from '../config/game';
import type { Entity, GameEvent, SettingsData } from '../types';
import { compareDates } from '../util/dates';
import type { Ctx, XpEntry } from './context';
import { energyFromSleep, isLowEnergy } from './energy';
import { levelInfo, type LevelInfo } from './levels';
import { reduceAchievements, type AchievementState } from './modules/achievements';
import { reduceAttributes, type AttributesState } from './modules/attributes';
import { reduceBosses, type BossesState } from './modules/bosses';
import { reduceLessons, type LessonsState } from './modules/lessons';
import { reduceMissions, type MissionsState } from './modules/missions';
import { reduceMoney, type MoneyState } from './modules/money';
import { reduceSeasons, type SeasonsState } from './modules/seasons';
import { reduceSkills, type SkillState } from './modules/skills';
import { reduceStreak, type StreakState } from './modules/streak';
import { reduceMap, reduceNpcs, type MapState, type NpcsState } from './modules/world';
import { reduceBounty, type BountyState } from './modules/bounty';
import { reduceGold, type GoldState } from './modules/gold';
import { reduceGoals, type GoalState } from './modules/goals';
import { reduceVices, type ViceState } from './modules/vices';
import { reduceLibrary, type LibraryState } from './modules/library';
import { reduceChallenges, type ChallengeState } from './modules/challenges';
import { reducePlans, type DayPlan } from './modules/plans';
import { reduceBody, reduceDayClosures, reduceSavings, type BodyState, type DayClosure, type SavingsState } from './modules/life-logs';

// ---- Sistemas nuevos (imports) ----
// [[voz]]

// [[entreno]]

// [[gente]]

// [[mapa]]

// [[habilidades]]

// [[aprendizaje]]
import { reduceLearning, type LearningState } from './modules/learning';

// [[salud]]

// [[habitos]]


export interface ProjectInput {
  events: GameEvent[];
  entities: Entity[];
  /** Día local de "hoy" (YYYY-MM-DD). Para fotos históricas, pasa la fecha deseada. */
  today: string;
  config?: GameConfigInput;
}

export interface EnergyState {
  sleepHours: number | null;
  value: number | null;
  low: boolean;
}

export interface GameState {
  today: string;
  settings: SettingsData;
  xp: { total: number; today: number; ledger: XpEntry[] };
  level: LevelInfo;
  attributes: AttributesState;
  streak: StreakState;
  energy: EnergyState;
  missions: MissionsState;
  lessons: LessonsState;
  money: MoneyState;
  bosses: BossesState;
  skills: Record<string, SkillState>;
  achievements: Record<string, AchievementState>;
  seasons: SeasonsState;
  map: MapState;
  npcs: NpcsState;
  bounty: BountyState;
  gold: GoldState;
  goals: Record<string, GoalState>;
  vices: Record<string, ViceState>;
  library: LibraryState;
  body: BodyState;
  savings: Record<string, SavingsState>;
  dayClosures: Record<string, DayClosure>;
  /** Plan de cada día (forDate → plan). */
  plans: Record<string, DayPlan>;
  challenges: Record<string, ChallengeState>;

  // ---- Sistemas nuevos (estado) ----
  // [[voz]]

  // [[entreno]]

  // [[gente]]

  // [[mapa]]

  // [[habilidades]]

  // [[aprendizaje]]
  learning: LearningState;

  // [[salud]]

  // [[habitos]]

}

export const DEFAULT_SETTINGS: SettingsData = {
  name: 'Jugador',
  className: '',
  birthDate: null,
  monthlyGoal: GAME_CONFIG.defaultMonthlyGoal,
  currency: 'MXN',
  levelRewards: {},
};

/** Orden cronológico estable: día local, luego momento exacto, luego id. */
export function sortEvents(events: GameEvent[]): GameEvent[] {
  return [...events].sort(
    (a, b) => compareDates(a.localDate, b.localDate) || (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0) || (a.id < b.id ? -1 : 1),
  );
}

/**
 * Función central del juego: calcula TODO el estado a partir de eventos + catálogo + configuración.
 * Es pura (sin efectos): misma entrada → misma salida. Por eso cambiar un número de la config
 * recalcula todo el historial sin perder nada.
 */
export function project(input: ProjectInput): GameState {
  const cfg = (input.config ?? GAME_CONFIG) as GameConfigInput;
  const today = input.today;
  const entities = input.entities.filter((e) => !e.deletedAt);
  const events = sortEvents(input.events.filter((e) => !e.voidedAt && e.localDate <= today));

  const byType = new Map<string, GameEvent[]>();
  for (const ev of events) {
    if (!byType.has(ev.type)) byType.set(ev.type, []);
    byType.get(ev.type)!.push(ev);
  }
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const settings: SettingsData = { ...DEFAULT_SETTINGS, ...((entityById.get('settings')?.data as Partial<SettingsData>) ?? {}) };

  const xp: XpEntry[] = [];
  const ctx: Ctx = {
    cfg,
    today,
    events,
    byType,
    entities,
    entityById,
    settings,
    xp,
    addXp(entry) {
      // Regla de oro: la XP nunca se resta.
      if (!(entry.amount > 0)) return;
      xp.push(entry);
    },
  };

  // Orden de los módulos: los de abajo pueden leer el resultado de los de arriba.
  const missions = reduceMissions(ctx);
  const streak = reduceStreak(ctx, missions.activeDays);
  const lessons = reduceLessons(ctx);
  const money = reduceMoney(ctx);
  const bosses = reduceBosses(ctx, missions, money);
  const skills = reduceSkills(ctx);
  const map = reduceMap(ctx);
  const npcs = reduceNpcs(ctx, missions);
  const seasons = reduceSeasons(ctx);
  const bounty = reduceBounty(ctx, missions);
  const goals = reduceGoals(ctx);
  const library = reduceLibrary(ctx);
  const vices = reduceVices(ctx);
  const body = reduceBody(ctx);
  const savings = reduceSavings(ctx);
  const dayClosures = reduceDayClosures(ctx);
  const plans = reducePlans(ctx, missions);
  const challenges = reduceChallenges(ctx);

  // ---- Sistemas nuevos (reductores; corren antes de logros, atributos y oro) ----
  // [[voz]]

  // [[entreno]]

  // [[gente]]

  // [[mapa]]

  // [[habilidades]]

  // [[aprendizaje]]
  const learning = reduceLearning(ctx);

  // [[salud]]

  // [[habitos]]

  const achievements = reduceAchievements(ctx, { missions, streak, lessons, bosses, money, map, seasons });
  const attributes = reduceAttributes(ctx, xp);
  // El oro se calcula al final: depende de toda la XP ganada.
  xp.sort((a, b) => compareDates(a.date, b.date));
  const gold = reduceGold(ctx, xp, { activeDays: missions.activeDays, plans });

  const checkin = (byType.get('checkin.morning') ?? []).filter((e) => e.localDate === today).at(-1);
  const sleepHours = checkin ? (checkin.payload as { sleepHours: number }).sleepHours : null;
  const energyValue = sleepHours === null ? null : energyFromSleep(sleepHours, cfg);

  const total = xp.reduce((s, e) => s + e.amount, 0);
  const todayXp = xp.filter((e) => e.date === today).reduce((s, e) => s + e.amount, 0);

  return {
    today,
    settings,
    xp: { total, today: todayXp, ledger: xp },
    level: levelInfo(total, cfg),
    attributes,
    streak,
    energy: { sleepHours, value: energyValue, low: energyValue !== null && isLowEnergy(energyValue, cfg) },
    missions,
    lessons,
    money,
    bosses,
    skills,
    achievements,
    seasons,
    map,
    npcs,
    bounty,
    gold,
    goals,
    vices,
    library,
    body,
    savings,
    dayClosures,
    plans,
    challenges,

    // [[voz]]

    // [[entreno]]

    // [[gente]]

    // [[mapa]]

    // [[habilidades]]

    // [[aprendizaje]]
    learning,

    // [[salud]]

    // [[habitos]]

  };
}
