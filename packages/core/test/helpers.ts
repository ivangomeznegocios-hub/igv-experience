import { project, seedEntities, type GameEvent, type GameConfigInput, GAME_CONFIG, type Entity } from '../src';

let n = 0;
export function ev(type: string, localDate: string, payload: any = {}, extra: Partial<GameEvent> = {}): GameEvent {
  n++;
  return {
    id: `ev-${String(n).padStart(6, '0')}`,
    type,
    localDate,
    occurredAt: `${localDate}T12:00:${String(n % 60).padStart(2, '0')}.000Z`,
    payload,
    createdAt: n,
    ...extra,
  };
}

export function done(localDate: string, missionId = 'daily-leer', size: any = 'chica', attribute: any = 'inteligencia', kind: any = 'daily', extra: any = {}) {
  return ev('mission.completed', localDate, { missionId, title: missionId, size, attribute, kind, ...extra });
}

export const seed = seedEntities();

export function run(events: GameEvent[], today: string, opts: { entities?: Entity[]; config?: GameConfigInput } = {}) {
  return project({ events, entities: opts.entities ?? seed, today, config: opts.config });
}

export function cfgWith(mut: (c: GameConfigInput) => void): GameConfigInput {
  const c = JSON.parse(JSON.stringify(GAME_CONFIG)) as unknown as GameConfigInput;
  mut(c);
  return c;
}

export function bySource(state: ReturnType<typeof run>, source: string) {
  return state.xp.ledger.filter((e) => e.source === source).reduce((s, e) => s + e.amount, 0);
}
