export * from './config/game';
export * from './types';
export * from './events';
export * from './util/dates';
export * from './engine/levels';
export * from './engine/energy';
export * from './engine/life';
export * from './engine/context';
export * from './engine/project';
export * from './engine/reports';
export type { MissionsState, CompletionInfo } from './engine/modules/missions';
export type { StreakState } from './engine/modules/streak';
export { streakBonus } from './engine/modules/streak';
export type { BossState, BossesState, PhaseState, RecurringState } from './engine/modules/bosses';
export type { AchievementState } from './engine/modules/achievements';
export type { AttributesState, AttributeState } from './engine/modules/attributes';
export type { SkillState, SkillUnlock } from './engine/modules/skills';
export type { SeasonsState, JournalEntry, SeasonReview } from './engine/modules/seasons';
export type { MapState, PlaceState, NpcsState, NpcState, GeneratedMission } from './engine/modules/world';
export type { MoneyState, MonthMoney } from './engine/modules/money';
export type { BountyState, BountyInfo } from './engine/modules/bounty';
export type { GoldState, Redemption, GoldBonus, Pledge } from './engine/modules/gold';
export { goldFor, dayCloseBonus } from './engine/modules/gold';
export type { ChallengeState, ChallengeAttempt } from './engine/modules/challenges';
export { challengeAttempts, challengeDayNumber } from './engine/modules/challenges';
export type { DayPlan, PlanItem } from './engine/modules/plans';
export * from './engine/insights';
export * from './engine/physique';
export type { GoalState } from './engine/modules/goals';
export type { ViceState } from './engine/modules/vices';
export type { LibraryState } from './engine/modules/library';
export type { BodyState, BodyEntry, SavingsState, DayClosure } from './engine/modules/life-logs';
export { REPEATABLE_KINDS } from './engine/modules/missions';
export * from './seed/index';
export * from './backup';
export * from './assistant/snapshot';
export * from './assistant/tools';
export * from './assistant/format';
export * from './assistant/memory';
export * from './assistant/toolkit';

// ---- Sistemas nuevos (exports) ----
// [[voz]]

// [[entreno]]

// [[gente]]

// [[mapa]]
export * from './engine/map-catalog';
export { foldMapEvents, mapCatalogLinks, mapCollectionProgress } from './engine/modules/map';
export type { PlaceVisit, MapFirst, MapCollectionState, MapSummary, MapFold } from './engine/modules/map';
export { renderMapaOverview, MAPA_TOOLS } from './assistant/tools-mapa';

// [[habilidades]]

// [[aprendizaje]]

// [[salud]]

// [[habitos]]

