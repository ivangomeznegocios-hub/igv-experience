import type { Ctx } from '../context';
import { ofType } from '../context';
import type { AttributeId } from '../../types';

export interface LessonsState {
  dates: string[];
  count: number;
}

/** Una lección escrita tras un fracaso da XP fija al atributo de la misión fallida (o Inteligencia). */
export function reduceLessons(ctx: Ctx): LessonsState {
  const dates: string[] = [];
  for (const ev of ofType<{ text: string; attribute: AttributeId; missionId?: string | null }>(ctx, 'lesson.written')) {
    ctx.addXp({
      date: ev.localDate,
      amount: ctx.cfg.rewards.lesson,
      source: 'lesson',
      label: 'Lección escrita',
      attribute: ev.payload.attribute ?? (ctx.cfg.defaultAttributes.lesson as AttributeId),
      eventId: ev.id,
      refId: ev.payload.missionId ?? undefined,
    });
    dates.push(ev.localDate);
  }
  return { dates, count: dates.length };
}
