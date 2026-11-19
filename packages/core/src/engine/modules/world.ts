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

export interface NpcState {
  lastInteraction: string | null;
  daysSince: number | null;
  overdue: boolean;
  interactions: number;
}

export interface GeneratedMission {
  id: string;
  title: string;
  size: MissionSize;
  attribute: AttributeId;
  kind: 'npc';
  npcId: string;
}

export interface NpcsState {
  npcs: Record<string, NpcState>;
  generatedMissions: GeneratedMission[];
}

/** NPCs: si alguien clave pasa N días sin contacto, se genera una misión chica para escribirle. */
export function reduceNpcs(ctx: Ctx, missions: MissionsState): NpcsState {
  const last = new Map<string, string>();
  const count = new Map<string, number>();
  const touch = (id: string, d: string) => {
    last.set(id, maxDate(last.get(id), d)!);
    count.set(id, (count.get(id) ?? 0) + 1);
  };
  for (const ev of ofType<{ npcId: string }>(ctx, 'npc.interaction')) touch(ev.payload.npcId, ev.localDate);
  for (const ev of ofType<{ npcId?: string | null }>(ctx, 'mission.completed')) if (ev.payload.npcId) touch(ev.payload.npcId, ev.localDate);

  const npcs: Record<string, NpcState> = {};
  const generatedMissions: GeneratedMission[] = [];
  for (const ent of entitiesOf<NpcData>(ctx, 'npcs', 'npc')) {
    const created = ent.createdAt ? toLocalDate(ent.createdAt, ctx.cfg.timezone) : null;
    const lastInteraction = maxDate(last.get(ent.id), ent.data.lastContact ?? null) ?? null;
    const ref = lastInteraction ?? created;
    const daysSince = ref ? Math.max(0, diffDays(ref, ctx.today)) : null;
    const overdue = !!ent.data.key && daysSince !== null && daysSince >= ctx.cfg.npc.keyContactDays;
    npcs[ent.id] = { lastInteraction, daysSince, overdue, interactions: count.get(ent.id) ?? 0 };
    const missionId = `npc-${ent.id}`;
    if (overdue || missions.completions[missionId]?.lastDate === ctx.today) {
      generatedMissions.push({
        id: missionId,
        title: `Escribirle a ${ent.data.name}`,
        size: ctx.cfg.npc.contactMissionSize as MissionSize,
        attribute: ctx.cfg.defaultAttributes.npcContact as AttributeId,
        kind: 'npc',
        npcId: ent.id,
      });
    }
  }
  return { npcs, generatedMissions };
}
