import type { Ctx } from '../context';
import { entitiesOf, ofType } from '../context';
import type { AttributeId, MissionSize, NpcData, PlaceStatus } from '../../types';
import { diffDays, maxDate, toLocalDate } from '../../util/dates';
import type { MissionsState } from './missions';

// Mapa (vida y empresa): vive en ./map.ts. Se re-exporta aquí para que project.ts no cambie.
export { reduceMap, foldMapEvents } from './map';
export type { MapState, PlaceState, PlaceVisit, MapFirst, MapCollectionState, MapSummary } from './map';

// ---- Mi gente: la lógica vive en ./gente.ts (niveles de cercanía, temperatura, estadísticas). ----
import { reducePeople, type NpcsState } from './gente';
export type { NpcState, NpcsState, GeneratedMission } from './gente';

/** Mi gente: niveles, temperatura, cumpleaños y la misión "Escribirle a X" para personas clave olvidadas. */
export function reduceNpcs(ctx: Ctx, missions: MissionsState): NpcsState {
  return reducePeople(ctx, missions);
}
