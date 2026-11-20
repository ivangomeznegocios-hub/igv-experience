import type { CityDistrictState, GameState } from '@igv/core';
import { addEvent, voidEvent } from '../data/store';
import { haptic, sfx } from './sound';
import { toast, undoToast } from '../ui/kit';

/** Empezar la obra del siguiente nivel de un distrito. */
export function startBuild(d: CityDistrictState) {
  if (!d.next || !d.canBuild) return;
  const ev = addEvent('city.build_started', { districtId: d.id, level: d.next.level });
  sfx.questStart();
  haptic(20);
  const what = d.level === 0 ? `Fundaste ${d.name}` : `Obra iniciada: ${d.building} nivel ${d.next.level}`;
  undoToast(`${what} · lista en ${d.next.days} ${d.next.days === 1 ? 'día' : 'días'}`, () => voidEvent(ev.id));
}

/** Inaugurar una obra terminada. */
export function inaugurate(d: CityDistrictState) {
  if (!d.work?.ready) return;
  addEvent('city.inaugurated', { districtId: d.id, level: d.work.level });
  sfx.achievement();
  haptic([30, 50, 30]);
  toast(d.work.level === 1 ? `Inauguraste ${d.name}: ${d.building}` : `Inauguraste ${d.building} nivel ${d.work.level}`, 'xp');
}

/** Recoger lo que produjo la ciudad. */
export function collect(state: GameState) {
  const n = state.city.stored;
  if (!n) return;
  const ev = addEvent('city.collected', {});
  sfx.coin();
  haptic(15);
  undoToast(`Recogiste ${n} materiales`, () => voidEvent(ev.id));
}

export const BLOCKED_TEXT: Record<NonNullable<CityDistrictState['blocked']>, string> = {
  max: 'Nivel máximo',
  busy: 'En obra',
  no_crew: 'Sin equipo libre',
  materials: 'Faltan materiales',
};
