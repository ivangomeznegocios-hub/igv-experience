import {
  ATTRIBUTE_IDS,
  ATTRIBUTE_NAMES,
  GAME_CONFIG,
  isInRoutine,
  pickForDate,
  weekday,
  type AttributeId,
  type BossData,
  type Entity,
  type GameState,
  type MainQuestData,
  type MissionData,
  type MissionSize,
  type RecurringBossData,
  type ViceData,
} from '@igv/core';
import { TZ, fmtMoney } from './time';

export interface ActiveBuff {
  id: string;
  label: string;
  detail: string;
  tone: 'gold' | 'green' | 'flame' | 'teal' | 'red' | 'blue';
  icon: string;
}

export interface DailyEncounter {
  id: string;
  kind: 'recurring_boss' | 'attribute_trial';
  title: string;
  subtitle: string;
  bossId?: string;
  attribute: AttributeId;
  size: MissionSize;
  completed: boolean;
}

export interface LinkedBossInfo {
  boss: Entity<BossData>;
  phaseTitle: string;
  hpRemainingPct: number;
  currentText: string;
}

export function localHour(): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
}

export function dayPhase(): 'dawn' | 'day' | 'dusk' | 'night' {
  const h = localHour();
  if (h >= 5 && h < 11) return 'dawn';
  if (h >= 11 && h < 18) return 'day';
  if (h >= 18 && h < 21) return 'dusk';
  return 'night';
}

/** Infiere duración sugerida (en minutos) para el Modo Misión a partir del título o tamaño. */
export function guessQuestMinutes(title: string, size: MissionSize): number {
  const mMin = title.match(/(\d+)\s*(min|minutos?)/i);
  if (mMin) {
    const n = Number(mMin[1]);
    if (n >= 5 && n <= 180) return n;
  }
  const mHr = title.match(/(\d+)\s*(h|hr|hrs|hora|horas)\b/i);
  if (mHr) {
    const n = Number(mHr[1]) * 60;
    if (n >= 15 && n <= 180) return n;
  }
  if (size === 'chica') return 15;
  if (size === 'media') return 30;
  if (size === 'grande') return 45;
  return 60;
}

/** Calcula el porcentaje de HP restante (0..100) de un jefe en su fase actual o total. */
export function bossHpPercent(boss: Entity<BossData>, state: GameState): { phaseHpPct: number; totalHpPct: number; nextPhaseIndex: number } {
  const st = state.bosses.bosses[boss.id];
  const totalPhases = Math.max(boss.data.phases.length, 1);
  if (!st) return { phaseHpPct: 100, totalHpPct: 100, nextPhaseIndex: 0 };
  if (st.defeated) return { phaseHpPct: 0, totalHpPct: 0, nextPhaseIndex: totalPhases };
  const idx = st.phases.findIndex((p) => !p.done);
  const next = idx >= 0 ? st.phases[idx] : null;
  let phaseProgress = 0;
  if (next?.progress && next.progress.target > 0) {
    phaseProgress = Math.max(0, Math.min(1, next.progress.current / next.progress.target));
  }
  const phaseHpPct = Math.round((1 - phaseProgress) * 100);
  const totalProgress = (st.phasesDone + phaseProgress) / totalPhases;
  const totalHpPct = Math.max(1, Math.round((1 - totalProgress) * 100));
  return { phaseHpPct, totalHpPct, nextPhaseIndex: idx >= 0 ? idx : totalPhases };
}

/** Busca el jefe vinculado a una misión (por weekly_streak directo o por mainQuestId). */
export function findLinkedBoss(
  missionId: string | undefined,
  mainQuestId: string | null | undefined,
  entities: Entity[],
  state: GameState,
): LinkedBossInfo | null {
  const bosses = entities.filter((e) => !e.deletedAt && e.module === 'bosses' && e.kind === 'boss') as Entity<BossData>[];
  let found: Entity<BossData> | undefined;
  if (missionId) {
    found = bosses.find((b) =>
      b.data.phases.some((p) => p.metric.type === 'weekly_streak' && p.metric.missionIds.includes(missionId)),
    );
  }
  if (!found && mainQuestId) {
    found = bosses.find((b) => b.data.mainQuestId === mainQuestId);
  }
  if (!found) return null;
  const st = state.bosses.bosses[found.id];
  if (!st || st.defeated || st.locked) return null;
  const next = st.phases.find((p) => !p.done);
  if (!next) return null;
  const { phaseHpPct } = bossHpPercent(found, state);
  const cur = next.progress
    ? next.progress.unit === 'MXN'
      ? `${fmtMoney(next.progress.current, state.settings.currency)} / ${fmtMoney(next.progress.target, state.settings.currency)}`
      : `${next.progress.current}/${next.progress.target} ${next.progress.unit}`
    : `Fase ${st.phasesDone + 1}/${st.phases.length}`;
  return { boss: found, phaseTitle: next.title, hpRemainingPct: phaseHpPct, currentText: cur };
}

/** Deriva estados/buffs activos del jugador (solo lectura; 100% recalculable). */
export function computeBuffs(state: GameState, entities: Entity[]): ActiveBuff[] {
  const buffs: ActiveBuff[] = [];
  const wd = weekday(state.today);
  const routine = (entities.filter((e) => !e.deletedAt && e.module === 'missions' && e.kind === 'daily') as Entity<MissionData>[]).filter((m) =>
    isInRoutine(m.data, wd),
  );
  const doneToday = new Set(state.missions.completedToday);

  if (state.energy.value !== null) {
    if (state.energy.value >= 100) {
      buffs.push({ id: 'rested', label: 'Descansado', detail: `${state.energy.sleepHours} h · energía al máximo`, tone: 'teal', icon: 'bolt' });
    } else if (state.energy.low) {
      buffs.push({ id: 'survival', label: 'Supervivencia', detail: 'Energía baja · prioriza misiones chicas y recuperación', tone: 'red', icon: 'moon' });
    }
  }

  if (state.streak.current >= 30) {
    buffs.push({ id: 'streak-30', label: `Imparable ×${state.streak.current}`, detail: `+${state.streak.bonusToday} XP Disciplina al día`, tone: 'flame', icon: 'flame' });
  } else if (state.streak.current >= 7) {
    buffs.push({ id: 'streak-7', label: `Fuego Vivo ×${state.streak.current}`, detail: `Aura encendida · +${state.streak.bonusToday} XP Disciplina`, tone: 'flame', icon: 'flame' });
  } else if (state.streak.current >= 3) {
    buffs.push({ id: 'streak-3', label: `En Racha ×${state.streak.current}`, detail: `+${state.streak.bonusToday} XP Disciplina hoy`, tone: 'gold', icon: 'flame' });
  }

  if (routine.length > 0 && routine.every((m) => doneToday.has(m.id))) {
    buffs.push({ id: 'perfect-day', label: 'Día Perfecto', detail: `${routine.length}/${routine.length} rutina completada`, tone: 'green', icon: 'crown' });
  }

  const vices = entities.filter((e) => !e.deletedAt && e.module === 'habits' && e.kind === 'vice') as Entity<ViceData>[];
  const bestClean = vices.reduce((best, v) => Math.max(best, state.vices[v.id]?.current ?? 0), 0);
  if (bestClean >= 7) {
    buffs.push({ id: 'iron-mind', label: 'Mente de Hierro', detail: `${bestClean} días manteniendo enemigos a raya`, tone: 'blue', icon: 'shield' });
  }

  return buffs;
}

/** Genera un briefing breve del Narrador / Game Master local (instantáneo y sin costo de API). */
export function buildDailyBriefing(state: GameState, entities: Entity[]): { headline: string; body: string } {
  const phase = dayPhase();
  const name = (state.settings.name || 'Jugador').split(/\s+/)[0];
  const wd = weekday(state.today);
  const routine = (entities.filter((e) => !e.deletedAt && e.module === 'missions' && e.kind === 'daily') as Entity<MissionData>[]).filter((m) =>
    isInRoutine(m.data, wd),
  );
  const doneToday = new Set(state.missions.completedToday);
  const remainingRoutine = routine.filter((m) => !doneToday.has(m.id));
  const dragon = state.bosses.bosses['boss-dragon'];
  const season = state.seasons.current;
  const focusQuest = season?.data.focusMainQuestId
    ? (entities.find((e) => e.id === season.data.focusMainQuestId && !e.deletedAt) as Entity<MainQuestData> | undefined)
    : undefined;

  // Saludo contextual
  const greet =
    phase === 'dawn'
      ? `Amanece en la campaña, ${name}.`
      : phase === 'day'
        ? `Campaña en marcha, ${name}.`
        : phase === 'dusk'
          ? `Cae la tarde, ${name}.`
          : `Hora de la hoguera, ${name}.`;

  // Situación prioritaria
  if (state.streak.todayRest) {
    return {
      headline: 'Día de descanso activo',
      body: 'Tu racha está protegida. Recupera fuerzas hoy sin culpa; mañana vuelves al frente con energía llena.',
    };
  }
  if (routine.length > 0 && remainingRoutine.length === 0) {
    return {
      headline: `¡Día Perfecto! +${state.xp.today} XP hoy`,
      body: state.dayClosures[state.today]
        ? 'Rutina completa y día cerrado en la hoguera. Misión cumplida.'
        : 'Completaste toda tu rutina de hoy. Pasa por La Hoguera en la noche para sellar tu crónica.',
    };
  }
  if (state.energy.low) {
    return {
      headline: `${greet} Modo Supervivencia.`,
      body: `Energía en ${state.energy.value}. Hoy no pelees batallas gigantes: elige una misión chica o de recuperación para sostener la racha.`,
    };
  }
  if (!state.streak.todayActive && state.streak.current > 0 && (phase === 'dusk' || phase === 'night')) {
    return {
      headline: `Tu racha de ${state.streak.current} días pide una acción`,
      body: `Completa 1 misión rápida para sumar +${state.streak.bonusToday} XP en Disciplina, o usa un Día de descanso (${state.streak.restDaysLeftThisWeek} disponibles).`,
    };
  }
  if (dragon && !dragon.defeated) {
    const pct = Math.round((state.money.monthIncome / Math.max(state.money.goal, 1)) * 100);
    if (pct >= 70 && pct < 100) {
      return {
        headline: `El Dragón Financiero está herido (${100 - pct}% HP)`,
        body: `Llevas ${fmtMoney(state.money.monthIncome, state.settings.currency)} este mes. Un golpe más y cae la meta mensual.`,
      };
    }
  }
  if (state.npcs.generatedMissions.length > 0) {
    const who = state.npcs.generatedMissions[0].title.replace('Escribirle a ', '');
    return {
      headline: greet,
      body: `${remainingRoutine.length} misión(es) en tu rutina y ${who} lleva tiempo sin saber de ti. Un mensaje breve suma a tu party.`,
    };
  }
  if (focusQuest) {
    return {
      headline: greet,
      body: `Foco de temporada: ${focusQuest.data.title}. Te faltan ${state.level.nextLevelXp - state.level.totalXp} XP para nivel ${state.level.level + 1}.`,
    };
  }
  return {
    headline: greet,
    body: `Nivel ${state.level.level} (${state.level.title}) · faltan ${state.level.nextLevelXp - state.level.totalXp} XP para el siguiente nivel.`,
  };
}

/** Encuentro aleatorio determinista del día (emboscada de jefe recurrente o reto del atributo más bajo). */
export function pickDailyEncounter(state: GameState, entities: Entity[]): DailyEncounter | null {
  const recurring = entities.filter((e) => !e.deletedAt && e.module === 'bosses' && e.kind === 'recurring') as Entity<RecurringBossData>[];
  const lowestAttr = ATTRIBUTE_IDS.reduce(
    (low, a) => (state.attributes.values[a].value < state.attributes.values[low].value ? a : low),
    ATTRIBUTE_IDS[0],
  );

  const pool: Omit<DailyEncounter, 'completed'>[] = [
    ...recurring.map((b) => ({
      id: `enc-${b.id}`,
      kind: 'recurring_boss' as const,
      title: `Emboscada: ${b.data.name}`,
      subtitle: `${b.data.defeatCondition} (+${GAME_CONFIG.rewards.recurringBoss} XP)`,
      bossId: b.id,
      attribute: b.data.attribute,
      size: 'media' as const,
    })),
    {
      id: `enc-trial-${lowestAttr}`,
      kind: 'attribute_trial' as const,
      title: `Prueba relámpago de ${ATTRIBUTE_NAMES[lowestAttr]}`,
      subtitle: `Tu atributo más bajo (${state.attributes.values[lowestAttr].value}). Haz una acción concreta de 10 min hoy.`,
      attribute: lowestAttr,
      size: 'chica' as const,
    },
  ];

  const picked = pickForDate(pool, state.today, 'encounter');
  if (!picked) return null;
  const completed =
    picked.kind === 'recurring_boss' && picked.bossId
      ? (state.bosses.recurring[picked.bossId]?.dates.includes(state.today) ?? false)
      : state.missions.completedToday.some((id) => id === `quick-${picked.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  return { ...picked, completed };
}
