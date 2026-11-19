import type { Ctx } from '../context';
import { ofType } from '../context';
import type { SkillData } from '../../types';
import { SKILL_RANK_NAMES } from '../../types';

export interface SkillUnlock {
  rank: number;
  date: string;
  evidence: string;
  eventId: string;
}

export interface SkillState {
  rank: number;
  rankName: string | null;
  unlocks: SkillUnlock[];
}

/** Un rango solo se desbloquea con evidencia escrita y en orden (Aprendiz → Experto → Maestro). */
export function reduceSkills(ctx: Ctx): Record<string, SkillState> {
  const out: Record<string, SkillState> = {};
  for (const ev of ofType<{ skillId: string; rank: number; evidence: string }>(ctx, 'skill.rank_unlocked')) {
    const ent = ctx.entityById.get(ev.payload.skillId);
    if (!ent) continue;
    const data = ent.data as SkillData;
    const st = (out[ev.payload.skillId] ??= { rank: 0, rankName: null, unlocks: [] });
    if (ev.payload.rank !== st.rank + 1) continue;
    if (!ev.payload.evidence || ev.payload.evidence.trim().length === 0) continue;
    st.rank = ev.payload.rank;
    st.rankName = SKILL_RANK_NAMES[st.rank - 1];
    st.unlocks.push({ rank: st.rank, date: ev.localDate, evidence: ev.payload.evidence, eventId: ev.id });
    ctx.addXp({
      date: ev.localDate,
      amount: ctx.cfg.rewards.skillRank,
      source: 'skill',
      label: `${data.name}: ${st.rankName}`,
      attribute: data.attribute,
      eventId: ev.id,
      refId: ev.payload.skillId,
    });
  }
  return out;
}
