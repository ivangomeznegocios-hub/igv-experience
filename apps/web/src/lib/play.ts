import type { Entity, MissionData, TodoData } from '@igv/core';
import { getEntity } from '../data/store';
import { completeMission, completeQuick, completeTodo } from './actions';
import type { Game } from '../data/store';

/**
 * Completa algo pendiente de hoy por su id (una diaria, un pendiente de la agenda o una cosa de "tus 3" que fue
 * una misión rápida). Devuelve false si no se encontró.
 */
export function completePending(game: Game, missionId: string): boolean {
  const ent = getEntity(missionId);
  if (ent && ent.module === 'missions') {
    completeMission(ent as Entity<MissionData>);
    return true;
  }
  if (ent && ent.module === 'planner') {
    completeTodo(ent as Entity<TodoData>);
    return true;
  }
  const item = game.state.plans[game.state.today]?.items.find((i) => i.missionId === missionId);
  // Una misión rápida (o algo que ya no está en el catálogo): se registra como "Hice algo" con su título.
  if (item) {
    completeQuick(item.title, item.size, item.attribute);
    return true;
  }
  return false;
}

/** Diarias que tocaban hoy (para congelar el puntaje al cerrar). */
export function routineDueToday(game: Game): string[] {
  return game.state.habits.routine.filter((h) => h.dueToday).map((h) => h.id);
}
