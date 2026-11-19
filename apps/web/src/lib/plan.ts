import { type DayPlan, type PlanItem } from '@igv/core';
import { addEvent, voidEvent } from '../data/store';
import { complete, uncomplete } from './actions';
import { undoToast } from '../ui/kit';

/** Guarda el plan (máx. 3 cosas) de un día. La última versión gana. */
export function savePlan(forDate: string, items: PlanItem[], today: string) {
  const ev = addEvent('plan.set', { forDate, items: items.slice(0, 3) }, { localDate: forDate < today ? forDate : today });
  undoToast(items.length ? `Plan listo: ${items.length} ${items.length === 1 ? 'cosa' : 'cosas'}` : 'Plan borrado', () => voidEvent(ev.id));
}

/** Marca o desmarca una cosa del plan (registra la misión ese día). */
export function togglePlanItem(plan: DayPlan, item: DayPlan['items'][number]) {
  if (item.done) uncomplete(item.missionId, plan.forDate, item.title);
  else complete({ missionId: item.missionId, title: item.title, size: item.size, attribute: item.attribute, kind: item.kind }, plan.forDate);
}
