import type { Ctx } from '../context';
import { entitiesOf, ofType } from '../context';
import type { SkillCategory, SkillData } from '../../types';
import { SKILL_RANK_NAMES } from '../../types';
import { weekStart } from '../../util/dates';
import { skillCategory, timeEntries } from '../habilidades';

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
  /** Categoría ("Lo que sabes hacer"): la guardada o la deducida. */
  category: SkillCategory;
  /** Minutos registrados con esta habilidad (`time.logged` con `skillId`). Solo registro: no da XP. */
  minutes: number;
  minutesThisWeek: number;
  /** Cuántos registros de tiempo tiene. */
  sessions: number;
  /** Última práctica: el registro de tiempo o el rango más reciente. */
  lastPractice: string | null;
}

/**
 * Un rango solo se desbloquea con evidencia escrita y en orden (Aprendiz → Experto → Maestro) y da
 * `rewards.skillRank` XP. El tiempo invertido se suma aquí solo para mostrarlo: nunca da XP.
 */
export function reduceSkills(ctx: Ctx): Record<string, SkillState> {
  const out: Record<string, SkillState> = {};
  const blank = (data: SkillData): SkillState => ({ rank: 0, rankName: null, unlocks: [], category: skillCategory(data), minutes: 0, minutesThisWeek: 0, sessions: 0, lastPractice: null });
  const touch = (st: SkillState, date: string) => {
    if (!st.lastPractice || date > st.lastPractice) st.lastPractice = date;
  };
  for (const ent of entitiesOf<SkillData>(ctx, 'skills', 'skill')) out[ent.id] = blank(ent.data);

  for (const ev of ofType<{ skillId: string; rank: number; evidence: string }>(ctx, 'skill.rank_unlocked')) {
    const ent = ctx.entityById.get(ev.payload.skillId);
    if (!ent) continue;
    const data = ent.data as SkillData;
    const st = (out[ev.payload.skillId] ??= blank(data));
    if (ev.payload.rank !== st.rank + 1) continue;
    if (!ev.payload.evidence || ev.payload.evidence.trim().length === 0) continue;
    st.rank = ev.payload.rank;
    st.rankName = SKILL_RANK_NAMES[st.rank - 1];
    st.unlocks.push({ rank: st.rank, date: ev.localDate, evidence: ev.payload.evidence, eventId: ev.id });
    touch(st, ev.localDate);
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

  const ws = weekStart(ctx.today);
  for (const t of timeEntries(ofType(ctx, 'time.logged'))) {
    const st = t.skillId ? out[t.skillId] : undefined;
    if (!st) continue;
    st.minutes += t.minutes;
    st.sessions++;
    if (t.date >= ws) st.minutesThisWeek += t.minutes;
    touch(st, t.date);
  }
  return out;
}
