import type { Ctx } from '../context';
import { entitiesOf, ofType } from '../context';
import type { AttributeId, MissionSize, NpcData, PlaceStatus } from '../../types';
import { diffDays, maxDate, toLocalDate } from '../../util/dates';
import type { MissionsState } from './missions';

export interface PlaceState {
  status: PlaceStatus;
  discoveredOn: string | null;
  masteredOn: string | null;
}

export interface MapState {
  places: Record<string, PlaceState>;
  discoveryDates: string[];
}

/** Mapa: el primer descubrimiento de cada lugar da XP (una sola vez, aunque luego cambie de estado). */
export function reduceMap(ctx: Ctx): MapState {
  const places: Record<string, PlaceState> = {};
  const discoveryDates: string[] = [];
  for (const ev of ofType<{ placeId: string; status: PlaceStatus }>(ctx, 'map.status_changed')) {
    const st = (places[ev.payload.placeId] ??= { status: 'inexplorado', discoveredOn: null, masteredOn: null });
    st.status = ev.payload.status;
    if (ev.payload.status !== 'inexplorado' && !st.discoveredOn) {
      st.discoveredOn = ev.localDate;
      discoveryDates.push(ev.localDate);
      const name = (ctx.entityById.get(ev.payload.placeId)?.data as { name?: string } | undefined)?.name ?? 'Lugar';
      ctx.addXp({
        date: ev.localDate,
        amount: ctx.cfg.rewards.discovery,
        source: 'discovery',
        label: `Descubrimiento: ${name}`,
        attribute: ctx.cfg.defaultAttributes.discovery as AttributeId,
        eventId: ev.id,
        refId: ev.payload.placeId,
      });
    }
    if (ev.payload.status === 'dominado' && !st.masteredOn) st.masteredOn = ev.localDate;
  }
  return { places, discoveryDates };
}

// ---- Mi gente: la lógica vive en ./gente.ts (niveles de cercanía, temperatura, estadísticas). ----
import { reducePeople, type NpcsState } from './gente';
export type { NpcState, NpcsState, GeneratedMission } from './gente';

/** Mi gente: niveles, temperatura, cumpleaños y la misión "Escribirle a X" para personas clave olvidadas. */
export function reduceNpcs(ctx: Ctx, missions: MissionsState): NpcsState {
  return reducePeople(ctx, missions);
}
