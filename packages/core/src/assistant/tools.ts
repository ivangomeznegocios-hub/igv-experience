import { z } from 'zod';
import { GAME_CONFIG } from '../config/game';
import { energyFromSleep } from '../engine/energy';
import { quickMissionId } from '../engine/reports';
import { REPEATABLE_KINDS } from '../engine/modules/missions';
import { challengeAttempts } from '../engine/modules/challenges';
import {
  ATTRIBUTE_IDS,
  ATTRIBUTE_NAMES,
  BOOK_STATUSES,
  BOOK_TYPES,
  MISSION_SIZES,
  NPC_TYPES,
  type AttributeId,
  type BookData,
  type BossData,
  type ChallengeData,
  type CompletionKind,
  type Entity,
  type GameEvent,
  type GoalData,
  type MainQuestData,
  type MissionData,
  type MissionSize,
  type NpcData,
  type PlaceData,
  type RecurringBossData,
  type SavingsData,
  type SettingsData,
  type ShopRewardData,
  type SkillData,
  type AchievementData,
  type TodoData,
  type ViceData,
} from '../types';
import { addDays, diffDays, monthKey, weekStart } from '../util/dates';
import type { AssistantSnapshot } from './snapshot';
import { describeEvent, fmtDay, fmtMoney, fmtMonthName, fmtNum, sizeAttr } from './format';

import {
  MAX_PAST_DAYS,
  SIZE_HELP,
  ToolError,
  addEvents,
  currencyOf,
  find,
  list,
  makeEvent,
  newEntityId,
  ok,
  pastDate,
  settingsOf,
  tool,
  upsert,
  zAttr,
  zDate,
  zFecha,
  zId,
  zSize,
  zText,
  type AssistantStore,
  type AssistantTool,
  type ToolResult,
} from './toolkit';

export { ToolError } from './toolkit';
export type { EventQuery, AssistantStore, ActivityRefs, ToolResult, ToolGroup, AssistantTool } from './toolkit';

// ---- Sistemas nuevos: cada uno importa aquí sus herramientas (assistant/tools-<sistema>.ts) ----
// [[voz]]

// [[entreno]]
import { ENTRENO_GUIDE, ENTRENO_TOOLS, renderTrainingOverview } from './tools-entreno';

// [[gente]]

// [[mapa]]

// [[habilidades]]

// [[aprendizaje]]

// [[salud]]

// [[habitos]]


const DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

// ---------------------------------------------------------------------------------------------
// Texto de panorama (lo usa ver_resumen y el Coach)
// ---------------------------------------------------------------------------------------------

export function renderOverview(s: AssistantSnapshot): string {
  const cur = s.profile.currency;
  const L: string[] = [];
  L.push(`# Panorama de ${s.profile.name} · ${fmtDay(s.today)}`);
  L.push(`Nivel ${s.level.level} (${s.level.title}) · ${fmtNum(s.level.totalXp)} XP · faltan ${fmtNum(s.level.toNext)} XP para el nivel ${s.level.level + 1}.`);
  L.push(`XP hoy: ${s.xp.today} · esta semana: ${s.xp.thisWeek} (semana pasada completa: ${s.xp.lastWeek}).`);
  L.push(
    `Racha: ${s.streak.current} ${s.streak.current === 1 ? 'día' : 'días'} (mejor ${s.streak.best}) · hoy ${s.streak.todayRest ? 'es día de descanso' : s.streak.todayActive ? 'ya cuenta' : 'todavía sin misiones'} · descansos disponibles esta semana: ${s.streak.restLeftThisWeek}.`,
  );
  L.push(s.energy.value === null ? 'Energía: sin registro de sueño hoy.' : `Energía: ${s.energy.value}${s.energy.low ? ' (BAJA: solo misiones chicas o de recuperación)' : ''} · durmió ${s.energy.sleepHours} h.`);
  L.push(`Oro: ${s.gold.balance}${s.gold.locked ? ` (+${s.gold.locked} apartado en compromisos)` : ''}.`);
  const pct = s.money.goal > 0 ? Math.round((s.money.income / s.money.goal) * 100) : 0;
  L.push(`Dinero de ${fmtMonthName(s.money.month)}: ingresos ${fmtMoney(s.money.income, cur)} de ${fmtMoney(s.money.goal, cur)} (${pct}%) · gastos ${fmtMoney(s.money.expense, cur)}.`);
  L.push(`Atributos: ${s.attributes.map((a) => `${a.name} ${a.value}`).join(', ')}.`);
  if (s.season) L.push(`Temporada ${s.season.number} "${s.season.name}", semana ${s.season.week ?? '?'} de ${s.season.weeks}. Foco: ${s.season.focus ?? 'ninguno'}.`);

  L.push('', '## Hoy');
  const pend = s.day.routine.filter((r) => !r.done);
  L.push(`Rutina: ${s.day.routine.length - pend.length}/${s.day.routine.length} hechas.${pend.length ? ` Pendientes: ${pend.map((r) => `${r.title} [${r.id}]`).join('; ')}.` : ''}`);
  const extra = s.day.done.filter((d) => !s.day.routine.some((r) => r.id === d.id));
  if (extra.length) L.push(`También hizo: ${extra.map((d) => d.title).join('; ')}.`);
  if (s.day.plan) L.push(`Sus 3 de hoy: ${s.day.plan.items.map((i) => `${i.done ? '✓' : '○'} ${i.title}`).join(' · ')}${s.day.plan.completed ? ' (¡cumplido!)' : ''}.`);
  else L.push('Sin plan del día ("Tus 3 de hoy").');
  if (s.day.bounty) L.push(`Misión sorpresa: ${s.day.bounty.title} [${s.day.bounty.missionId}] · ${s.day.bounty.completed ? 'cumplida' : `pendiente (+${GAME_CONFIG.bounty.bonusPercent}% de XP)`}.`);
  if (s.day.agenda.length) L.push(`Agenda (pendientes): ${s.day.agenda.map((t) => `${t.date < s.today ? 'ATRASADO ' : ''}${t.date} ${t.title} [${t.id}]`).join('; ')}.`);
  L.push(`Día ${s.day.closed ? 'cerrado' : 'sin cerrar'}.`);

  const bosses = s.bosses.filter((b) => !b.defeated);
  if (bosses.length) {
    L.push('', '## Grandes retos');
    for (const b of bosses) {
      const n = b.next;
      L.push(
        `- ${b.name} [${b.id}]: ${b.phasesDone}/${b.phases} fases${b.locked ? ' (bloqueado)' : ''}${
          n ? ` · siguiente: ${n.title}${n.progress ? ` (${fmtNum(n.progress.current)}/${fmtNum(n.progress.target)} ${n.progress.unit})` : ''}${n.manual ? ' · se marca a mano' : ' · automática'}` : ''
        }`,
      );
    }
  }
  const goals = s.goals.filter((g) => !g.completedOn && !g.archived);
  if (goals.length) {
    L.push('', '## Metas');
    for (const g of goals) L.push(`- ${g.title} [${g.id}]: ${fmtNum(g.current)}/${fmtNum(g.target)} ${g.unit}${g.deadline ? ` · vence ${g.deadline}` : ''}`);
  }
  const chs = s.challenges.filter((c) => !c.archived);
  if (chs.length) {
    L.push('', '## Retos de N días');
    for (const c of chs)
      L.push(`- ${c.title} [${c.id}]: ${c.status}${c.status === 'en curso' ? ` · día ${c.dayNumber} de ${c.days} · ${c.checked} marcados · hoy ${c.checkedToday ? 'marcado' : 'SIN marcar'}` : ''}`);
  }
  if (s.vices.length) {
    L.push('', '## Hábitos a dejar');
    for (const v of s.vices) L.push(`- ${v.name} [${v.id}]: ${v.current} ${v.current === 1 ? 'día' : 'días'} sin recaer (mejor ${v.best})`);
  }
  if (s.people.overdue.length)
    L.push('', `Personas clave sin contacto (30+ días; para registrar que le escribió usa completar_mision con el id de la misión): ${s.people.overdue.map((p) => `${p.name} ${p.daysSince ?? '?'} días [misión ${p.id}]`).join('; ')}.`);
  if (s.pledges.length) L.push(`Compromisos abiertos: ${s.pledges.map((p) => `${p.title} (${p.stake} de oro, vence ${p.deadline}) [${p.id}]`).join('; ')}.`);
  if (s.library.reading.length) L.push(`Leyendo: ${s.library.reading.map((b) => `${b.title} [${b.id}]`).join('; ')}.`);
  if (s.lastJournal) L.push(`Último diario semanal (${s.lastJournal.weekStart}): pasó "${s.lastJournal.happened}"; aprendió "${s.lastJournal.learned}"; sigue "${s.lastJournal.next}".`);
  // ---- Sistemas nuevos (panorama) ----
  // [[voz]]

  // [[entreno]]
  L.push(...renderTrainingOverview(s));

  // [[gente]]

  // [[mapa]]

  // [[habilidades]]

  // [[aprendizaje]]

  // [[salud]]

  // [[habitos]]

  if (s.xp.recent.length) L.push('', `XP reciente: ${s.xp.recent.slice(0, 10).map((e) => `${e.date} ${e.label} +${e.amount}`).join('; ')}.`);
  L.push('', `(Calculado por ${s.computedBy === 'app' ? 'la app' : 'el servidor'} · ${s.computedAt.slice(0, 16).replace('T', ' ')} UTC)`);
  return L.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Herramientas para CONSULTAR
// ---------------------------------------------------------------------------------------------

const verResumen = tool({
  name: 'ver_resumen',
  title: 'Ver panorama',
  group: 'consultar',
  writes: false,
  description:
    'Panorama completo de hoy: nivel, XP, racha, energía, oro, dinero del mes, atributos, temporada, rutina y plan del día, misión sorpresa, agenda, grandes retos, metas, retos de N días, hábitos a dejar y personas olvidadas. Úsala primero para entender cómo va.',
  input: z.object({}),
  async run(_i, store) {
    return { text: renderOverview(await store.snapshot()) };
  },
});

const verDia = tool({
  name: 'ver_dia',
  title: 'Ver un día',
  group: 'consultar',
  writes: false,
  description: 'Lo de un día: rutina (hecho/pendiente), plan, misión sorpresa, agenda y todos los registros de ese día con su id (para anular_registro). Sin fecha, hoy.',
  input: z.object({ fecha: zFecha }),
  async run({ fecha }, store) {
    const date = fecha ?? store.today;
    const [catalog, events] = await Promise.all([store.catalog(), store.events({ from: date, to: date, includeVoided: true, order: 'asc' })]);
    const byId = new Map(catalog.map((e) => [e.id, e]));
    const cur = currencyOf(catalog);
    const L: string[] = [`# ${fmtDay(date)}`];
    if (date > store.today) {
      L.push('Es un día futuro.');
      const todos = list<TodoData>(catalog, 'planner', 'todo').filter((t) => t.data.date === date);
      if (todos.length) L.push(`Agenda: ${todos.map((t) => `${t.data.title} [${t.id}]`).join('; ')}.`);
      const plans = await store.events({ types: ['plan.set'], match: { forDate: date }, order: 'asc' });
      const last = plans.at(-1);
      if (last) L.push(`Plan: ${(last.payload.items as { title: string }[]).map((i) => i.title).join(' · ') || '(vacío)'}.`);
      return { text: L.join('\n') };
    }
    const s = await store.snapshot();
    if (date === store.today) {
      L.push(`XP del día: ${s.xp.today}.`);
      L.push('Rutina:');
      for (const r of s.day.routine) L.push(`- ${r.done ? '✓' : '○'} ${r.title} (${sizeAttr(r.size, r.attribute)}) [${r.id}]${r.recovery ? ' · recuperación' : ''}`);
      if (s.day.plan) L.push(`Plan: ${s.day.plan.items.map((i) => `${i.done ? '✓' : '○'} ${i.title}`).join(' · ')}`);
      if (s.day.bounty) L.push(`Misión sorpresa: ${s.day.bounty.title} [${s.day.bounty.missionId}] (${s.day.bounty.completed ? 'cumplida' : 'pendiente'})`);
      const due = s.day.agenda.filter((t) => t.date <= date);
      if (due.length) L.push(`Agenda para hoy o atrasada: ${due.map((t) => `${t.title} (${t.date}) [${t.id}]`).join('; ')}`);
    } else if (s.xp.byDate[date] !== undefined || diffDays(date, store.today) < 42) {
      L.push(`XP del día: ${s.xp.byDate[date] ?? 0}.`);
    }
    const shown = events.filter((e) => e.type !== 'bounty.drawn' && e.type !== 'daily.selected' && e.type !== 'weekly.selected');
    L.push('', `Registros (${shown.length}):`);
    if (!shown.length) L.push('- (ninguno)');
    for (const e of shown) L.push(`- [${e.id}] ${describeEvent(e, byId, cur)}${e.voidedAt ? ' (ANULADO)' : ''}`);
    return { text: L.join('\n') };
  },
});

const CATALOG_TYPES = [
  'misiones',
  'diarias',
  'agenda',
  'personas',
  'metas',
  'retos',
  'grandes_retos',
  'premios',
  'habitos',
  'libros',
  'ahorro',
  'habilidades',
  'logros',
  'lugares',
] as const;

const verCatalogo = tool({
  name: 'ver_catalogo',
  title: 'Ver catálogo',
  group: 'consultar',
  writes: false,
  description:
    'Lista elementos del catálogo con sus ids: misiones (principales, capítulos, secundarias, eventos), diarias (rutina), agenda (pendientes), personas, metas, retos (de N días), grandes_retos, premios de la tienda, habitos (a dejar), libros, ahorro, habilidades, logros, lugares.',
  input: z.object({
    tipo: z.enum(CATALOG_TYPES).describe('Qué lista ver.'),
    incluir_archivados: z.boolean().optional().describe('Incluir metas/retos archivados o misiones ya completadas.'),
  }),
  async run({ tipo, incluir_archivados }, store) {
    const catalog = await store.catalog();
    const all = !!incluir_archivados;
    const s = await store.snapshot();
    const cur = currencyOf(catalog);
    const L: string[] = [];
    switch (tipo) {
      case 'misiones': {
        const pending = new Set(s.sideMissions.map((m) => m.id));
        L.push('Misiones principales:');
        for (const q of list<MainQuestData>(catalog, 'missions', 'main')) L.push(`- [${q.id}] ${q.data.code} ${q.data.title}: ${q.data.goal}${s.mainQuests.find((m) => m.id === q.id)?.inFocus ? ' (EN FOCO)' : ''}`);
        L.push('', 'Capítulos, secundarias y eventos (se completan una sola vez):');
        for (const m of list<MissionData>(catalog, 'missions').filter((m) => ['chapter', 'side', 'event'].includes(m.kind))) {
          const done = !pending.has(m.id);
          if (done && !all) continue;
          const kind = m.kind === 'chapter' ? `capítulo ${m.data.number ?? ''}` : m.kind === 'side' ? 'secundaria' : `evento${m.data.date ? ` ${m.data.date}` : ''}`;
          L.push(`- [${m.id}] ${m.data.title} (${kind} · ${sizeAttr(m.data.size, m.data.attribute)})${done ? ' · YA COMPLETADA' : ''}${m.data.mainQuestId ? ` · de ${m.data.mainQuestId}` : ''}`);
        }
        break;
      }
      case 'diarias': {
        L.push('Diarias (se pueden completar una vez por día):');
        for (const m of list<MissionData>(catalog, 'missions', 'daily')) {
          const days = m.data.routine === false ? 'fuera de la rutina' : !m.data.days?.length ? 'todos los días' : m.data.days.map((d) => DAY_NAMES[d]).join(', ');
          L.push(`- [${m.id}] ${m.data.title} (${sizeAttr(m.data.size, m.data.attribute)}) · ${days}${m.data.recovery ? ' · recuperación' : ''}`);
        }
        break;
      }
      case 'agenda': {
        const todos = list<TodoData>(catalog, 'planner', 'todo').sort((a, b) => (a.data.date < b.data.date ? -1 : 1));
        const doneIds = new Set((await store.events({ types: ['mission.completed'], from: addDays(store.today, -MAX_PAST_DAYS) })).map((e) => e.payload.missionId));
        L.push('Agenda (pendientes; se completan una vez):');
        for (const t of todos) {
          const done = doneIds.has(t.id);
          if (done && !all) continue;
          L.push(`- [${t.id}] ${t.data.date} ${t.data.title} (${sizeAttr(t.data.size, t.data.attribute)})${done ? ' · HECHO' : t.data.date < store.today ? ' · ATRASADO' : ''}`);
        }
        break;
      }
      case 'personas': {
        const types: Record<string, string> = { party: 'cercano', aliado: 'aliado', mentor: 'mentor', cliente: 'cliente', rival: 'rival' };
        L.push('Personas ("Mi gente"):');
        for (const n of list<NpcData>(catalog, 'npcs', 'npc')) {
          const lc = s.people.lastContact[n.id] ?? n.data.lastContact ?? null;
          L.push(`- [${n.id}] ${n.data.name} (${types[n.data.npcType] ?? n.data.npcType}${n.data.key ? ', persona clave' : ''}) · último contacto: ${lc ?? 'sin registro'}${n.data.notes ? ` · ${n.data.notes.slice(0, 80)}` : ''}`);
        }
        break;
      }
      case 'metas': {
        L.push('Metas:');
        for (const g of s.goals) {
          if ((g.archived || g.completedOn) && !all) continue;
          const ent = catalog.find((e) => e.id === g.id) as Entity<GoalData> | undefined;
          L.push(`- [${g.id}] ${g.title}: ${fmtNum(g.current)}/${fmtNum(g.target)} ${g.unit}${g.completedOn ? ` · CUMPLIDA ${g.completedOn}` : ''}${g.deadline ? ` · vence ${g.deadline}` : ''}${ent ? ` · ${sizeAttr(ent.data.size, ent.data.attribute)}` : ''}${g.archived ? ' · archivada' : ''}`);
        }
        break;
      }
      case 'retos': {
        L.push('Retos de N días seguidos:');
        for (const c of s.challenges) {
          if (c.archived && !all) continue;
          L.push(`- [${c.id}] ${c.title} (${c.days} días): ${c.status}${c.status === 'en curso' ? ` · día ${c.dayNumber} · ${c.checked} marcados · hoy ${c.checkedToday ? 'marcado' : 'sin marcar'}` : ''} · completado ${c.completions} veces`);
        }
        break;
      }
      case 'grandes_retos': {
        L.push('Grandes retos (por fases, en orden):');
        for (const b of list<BossData>(catalog, 'bosses', 'boss')) {
          const st = s.bosses.find((x) => x.id === b.id);
          L.push(`- [${b.id}] ${b.data.name}: ${st?.phasesDone ?? 0}/${b.data.phases.length} fases${st?.defeated ? ' · SUPERADO' : ''}${st?.locked ? ' · bloqueado' : ''}`);
          b.data.phases.forEach((p, i) => {
            const auto = p.metric.type === 'manual' ? 'manual' : p.metric.type === 'weekly_streak' ? 'automática (semanas)' : 'automática (ingresos)';
            L.push(`    ${i + 1}. ${p.title} (${auto})${st && i < st.phasesDone ? ' ✓' : ''}`);
          });
        }
        L.push('', 'Retos recurrentes (se superan muchas veces):');
        for (const r of s.recurring) L.push(`- [${r.id}] ${r.name}: superado ${r.defeats} veces${r.lastDate ? ` (último ${r.lastDate})` : ''} · condición: ${r.condition}`);
        break;
      }
      case 'premios': {
        L.push(`Tienda de premios reales (se pagan con oro). Saldo: ${s.gold.balance} de oro.`);
        for (const r of list<ShopRewardData>(catalog, 'shop', 'reward')) L.push(`- [${r.id}] ${r.data.name}: ${r.data.cost} de oro${r.data.cost > s.gold.balance ? ' (no alcanza)' : ''}`);
        break;
      }
      case 'habitos': {
        L.push('Hábitos a dejar:');
        for (const v of s.vices) L.push(`- [${v.id}] ${v.name}: ${v.current} días sin recaer (mejor ${v.best})${v.lastRelapse ? ` · última recaída ${v.lastRelapse}` : ''}`);
        break;
      }
      case 'libros': {
        const finished = await store.events({ types: ['library.finished'] });
        const done = new Map(finished.map((e) => [e.payload.bookId as string, e.localDate]));
        L.push('Biblioteca:');
        for (const b of list<BookData>(catalog, 'library', 'book')) {
          const d = done.get(b.id);
          if (d && !all) continue;
          L.push(`- [${b.id}] ${b.data.title}${b.data.author ? ` de ${b.data.author}` : ''} (${b.data.bookType}, ${d ? `terminado ${d}` : b.data.status} · ${sizeAttr(b.data.size, b.data.attribute)})`);
        }
        break;
      }
      case 'ahorro': {
        L.push('Metas de ahorro (dinero real, no da XP):');
        for (const sv of s.savings) L.push(`- [${sv.id}] ${sv.name}: ${fmtMoney(sv.current, cur)} de ${fmtMoney(sv.target, cur)}`);
        break;
      }
      case 'habilidades': {
        L.push('Habilidades (rangos Aprendiz → Experto → Maestro, con evidencia escrita):');
        for (const sk of list<SkillData>(catalog, 'skills', 'skill')) {
          const st = s.skills.find((x) => x.id === sk.id);
          L.push(`- [${sk.id}] ${sk.data.name} (${ATTRIBUTE_NAMES[sk.data.attribute]}): ${st?.rankName ?? 'sin rango'} · requisitos: ${sk.data.ranks.join(' / ')}`);
        }
        break;
      }
      case 'logros': {
        L.push(`Logros: ${s.achievements.unlocked} de ${s.achievements.total} desbloqueados. Recientes: ${s.achievements.recent.map((a) => `${a.name} (${a.date})`).join('; ') || 'ninguno'}.`);
        for (const a of list<AchievementData>(catalog, 'achievements', 'achievement')) L.push(`- [${a.id}] ${a.data.name}: ${a.data.description}`);
        break;
      }
      case 'lugares': {
        const changes = await store.events({ types: ['map.status_changed'], order: 'asc' });
        const status = new Map<string, string>();
        for (const e of changes) status.set(e.payload.placeId, e.payload.status);
        const names: Record<string, string> = { inexplorado: 'por conocer', descubierto: 'conocido', dominado: 'habitual' };
        L.push('Mapa:');
        for (const p of list<PlaceData>(catalog, 'map', 'place')) L.push(`- [${p.id}] ${p.data.name} (${p.data.placeType}): ${names[status.get(p.id) ?? 'inexplorado']}`);
        break;
      }
    }
    if (L.length <= 1) L.push('(vacío)');
    return { text: L.join('\n') };
  },
});

const HISTORY_CATEGORIES: Record<string, string[]> = {
  misiones: ['mission.completed'],
  dinero: ['income.recorded', 'expense.recorded', 'savings.moved'],
  lecciones: ['lesson.written'],
  personas: ['npc.interaction'],
  metas: ['goal.progress'],
  cuerpo: ['body.logged', 'checkin.morning'],
  descansos: ['rest_day.marked'],
  retos: ['challenge.started', 'challenge.checked', 'boss.phase_completed', 'boss.recurring_defeated', 'pledge.made', 'pledge.resolved'],
  cierres: ['day.closed', 'journal.weekly', 'plan.set'],
  habitos: ['vice.relapse'],
  premios: ['reward.redeemed'],
};

const verHistorial = tool({
  name: 'ver_historial',
  title: 'Ver historial',
  group: 'consultar',
  writes: false,
  description: 'Registros entre dos fechas (máx. 92 días; por defecto los últimos 7), más recientes primero, con su id. Filtra por categoría o por texto.',
  input: z.object({
    desde: zDate.optional().describe('YYYY-MM-DD. Por defecto, hace 6 días.'),
    hasta: zDate.optional().describe('YYYY-MM-DD. Por defecto, hoy.'),
    categoria: z.enum(Object.keys(HISTORY_CATEGORIES) as [string, ...string[]]).optional(),
    buscar: z.string().max(100).optional().describe('Texto a buscar en la descripción.'),
    incluir_anulados: z.boolean().optional(),
  }),
  async run({ desde, hasta, categoria, buscar, incluir_anulados }, store) {
    const to = hasta ?? store.today;
    const from = desde ?? addDays(to, -6);
    if (from > to) throw new ToolError('"desde" debe ser anterior a "hasta".');
    if (diffDays(from, to) > 92) throw new ToolError('Rango máximo: 92 días.');
    const [catalog, events] = await Promise.all([
      store.catalog(),
      store.events({ from, to, types: categoria ? HISTORY_CATEGORIES[categoria] : undefined, includeVoided: !!incluir_anulados, order: 'desc' }),
    ]);
    const byId = new Map(catalog.map((e) => [e.id, e]));
    const cur = currencyOf(catalog);
    const q = buscar?.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const lines = events
      .filter((e) => e.type !== 'bounty.drawn' && e.type !== 'daily.selected' && e.type !== 'weekly.selected')
      .map((e) => ({ e, d: describeEvent(e, byId, cur) }))
      .filter(({ d }) => !q || d.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q));
    const L = [`Registros del ${from} al ${to}: ${lines.length}${lines.length > 150 ? ' (muestro 150)' : ''}`];
    for (const { e, d } of lines.slice(0, 150)) L.push(`- ${e.localDate} [${e.id}] ${d}${e.voidedAt ? ' (ANULADO)' : ''}`);
    return { text: L.join('\n') };
  },
});

const verDinero = tool({
  name: 'ver_dinero',
  title: 'Ver dinero del mes',
  group: 'consultar',
  writes: false,
  description: 'Ingresos y gastos de un mes (por defecto el actual): totales, por categoría, gastos más grandes, presupuesto y meta mensual de ingresos. El dinero real no da XP.',
  input: z.object({ mes: z.string().regex(/^\d{4}-\d{2}$/, 'Formato YYYY-MM').optional() }),
  async run({ mes }, store) {
    const month = mes ?? monthKey(store.today);
    const from = `${month}-01`;
    const to = `${month}-31`;
    const [catalog, events] = await Promise.all([store.catalog(), store.events({ from, to, types: ['income.recorded', 'expense.recorded'], order: 'asc' })]);
    const settings = settingsOf(catalog);
    const cur = settings.currency ?? 'MXN';
    const inc = events.filter((e) => e.type === 'income.recorded');
    const exp = events.filter((e) => e.type === 'expense.recorded');
    const sum = (l: GameEvent[]) => l.reduce((s, e) => s + Number(e.payload.amount || 0), 0);
    const income = sum(inc);
    const expense = sum(exp);
    const byCat = new Map<string, number>();
    for (const e of exp) {
      const c = String(e.payload.category || 'sin categoría');
      byCat.set(c, (byCat.get(c) ?? 0) + Number(e.payload.amount || 0));
    }
    const goal = settings.monthlyGoal ?? GAME_CONFIG.defaultMonthlyGoal;
    const L = [`# Dinero de ${fmtMonthName(month)}`];
    L.push(`Ingresos: ${fmtMoney(income, cur)} (${inc.length}) · meta ${fmtMoney(goal, cur)} (${goal > 0 ? Math.round((income / goal) * 100) : 0}%).`);
    L.push(`Gastos: ${fmtMoney(expense, cur)} (${exp.length}) · balance ${fmtMoney(income - expense, cur)}.`);
    const budgets = settings.budgets ?? {};
    const cats = [...new Set([...Object.keys(budgets), ...byCat.keys()])].sort((a, b) => (byCat.get(b) ?? 0) - (byCat.get(a) ?? 0));
    if (cats.length) {
      L.push('', 'Gasto por categoría:');
      for (const c of cats) L.push(`- ${c}: ${fmtMoney(byCat.get(c) ?? 0, cur)}${budgets[c] ? ` de ${fmtMoney(budgets[c], cur)} presupuestado` : ''}`);
    }
    const top = [...exp].sort((a, b) => b.payload.amount - a.payload.amount).slice(0, 5);
    if (top.length) L.push('', `Gastos más grandes: ${top.map((e) => `${e.localDate} ${fmtMoney(e.payload.amount, cur)} ${e.payload.concept ?? ''}`.trim()).join('; ')}.`);
    if (inc.length) L.push(`Ingresos: ${inc.map((e) => `${e.localDate} ${fmtMoney(e.payload.amount, cur)} ${e.payload.concept ?? ''}`.trim()).join('; ')}.`);
    return { text: L.join('\n') };
  },
});

/** Una línea de guía por cada sistema nuevo (se agregan a APP_GUIDE). */
const GUIDE_SYSTEMS: string[] = [
  // [[voz]]

  // [[entreno]]
  ENTRENO_GUIDE,

  // [[gente]]

  // [[mapa]]

  // [[habilidades]]

  // [[aprendizaje]]

  // [[salud]]

  // [[habitos]]

];

export const APP_GUIDE = `IGV EXPERIENCE es el tablero personal de Iván Gómez Vera para medir y mejorar su vida real con mecánicas de juego. Todo es en español de México, con tono de app sobria de rendimiento personal (nada de fantasía ni RPG: di "grandes retos", "personas", "Mi gente", "hábitos a dejar").

Cómo funciona:
- Cada cosa que hace es un REGISTRO con fecha (hora de CDMX). Nada se borra: los errores se ANULAN (anular_registro) y la app lo recalcula todo.
- Misiones: chica 10 XP, media 30, grande 100, épica 300. Diarias, misiones rápidas ("hice algo") y de personas cuentan una vez por día; secundarias, capítulos, eventos y pendientes de la agenda, una sola vez.
- Rutina: las diarias aparecen solas cada día que les toca. Plan del día: máximo 3 cosas ("Tus 3 de hoy"); cumplirlas da oro.
- Racha: un día con al menos una misión suma +1 y da bono a Disciplina. Un día de descanso marcado (máx. 2 por semana) no la rompe. Un día pasado vacío la reinicia.
- Niveles: pasar de n a n+1 cuesta 250·n XP. Atributos (Fuerza física, Inteligencia, Carisma, Finanzas, Disciplina, Relaciones, Creatividad) suben 1 punto por cada 100 XP.
- Lección escrita tras un fracaso: +30 XP. Energía según el sueño: ≥7 h = 100, ≥6 h = 75, menos = 50 (con 50 o menos, solo misiones chicas o de recuperación).
- Oro: 1 por cada 10 XP; se gasta en premios reales de la tienda. El dinero real (ingresos, gastos, ahorro) NO da XP.
- Grandes retos: fases en orden; algunas se cumplen solas (ingresos, semanas seguidas) y otras se marcan a mano.
- Metas con contador, retos de N días seguidos, hábitos a dejar (días sin recaer), biblioteca, cuerpo, personas clave (aviso a los 30 días sin contacto).
- Reglas de oro: la XP nunca se resta; descansar no quita XP; XP por acciones y resultados, no por horas.${GUIDE_SYSTEMS.map((l) => `\n- ${l}`).join('')}

Cómo usar las herramientas:
- Empieza con ver_resumen para saber cómo va. Usa ver_catalogo para obtener ids antes de registrar algo del catálogo.
- Si algo que hizo no está en el catálogo, usa completar_mision con "titulo" (misión rápida) y elige tamaño y atributo con criterio conservador (casi todo es chica o media).
- No inventes registros: registra solo lo que él te dijo. Si hay duda (monto, fecha, a quién), pregunta.
- Tras registrar, confirma en una línea qué quedó y cuánta XP dio. Si te equivocas, usa anular_registro.`;

const guia = tool({
  name: 'guia_de_la_app',
  title: 'Guía de la app',
  group: 'consultar',
  writes: false,
  description: 'Explica cómo funciona IGV EXPERIENCE (reglas, XP, racha, oro, sistemas) y cómo usar estas herramientas. Léela si no conoces la app.',
  input: z.object({}),
  async run() {
    return { text: APP_GUIDE };
  },
});

// ---------------------------------------------------------------------------------------------
// Herramientas para REGISTRAR
// ---------------------------------------------------------------------------------------------

interface ResolvedMission {
  missionId: string;
  title: string;
  size: MissionSize;
  attribute: AttributeId;
  kind: CompletionKind;
  mainQuestId?: string | null;
  npcId?: string | null;
}

async function resolveMission(
  store: AssistantStore,
  catalog: Entity[],
  input: { mision_id?: string; titulo?: string; tamano?: MissionSize; atributo?: AttributeId },
): Promise<ResolvedMission> {
  const id = input.mision_id?.trim();
  if (id) {
    const ent = catalog.find((e) => e.id === id);
    if (ent && ent.module === 'missions' && ['chapter', 'side', 'daily', 'event'].includes(ent.kind)) {
      const d = ent.data as MissionData;
      return { missionId: ent.id, title: d.title, size: d.size, attribute: d.attribute, kind: ent.kind as CompletionKind, mainQuestId: d.mainQuestId ?? null };
    }
    if (ent && ent.module === 'planner' && ent.kind === 'todo') {
      const d = ent.data as TodoData;
      return { missionId: ent.id, title: d.title, size: d.size, attribute: d.attribute, kind: 'todo' };
    }
    if (ent && ent.module === 'missions' && ent.kind === 'main') throw new ToolError('Una misión principal no se completa directamente: completa sus capítulos o misiones.');
    // Una persona (o su misión "npc-<id>") → la misión "Escribirle a X", que cuenta como contacto.
    const npcId = ent && ent.module === 'npcs' && ent.kind === 'npc' ? ent.id : id.startsWith('npc-') ? id.slice(4) : null;
    if (npcId) {
      const npc = catalog.find((e) => e.id === npcId && e.module === 'npcs' && e.kind === 'npc');
      if (npc) {
        return {
          missionId: `npc-${npc.id}`,
          title: `Escribirle a ${(npc.data as NpcData).name}`,
          size: GAME_CONFIG.npc.contactMissionSize as MissionSize,
          attribute: GAME_CONFIG.defaultAttributes.npcContact as AttributeId,
          kind: 'npc',
          npcId: npc.id,
        };
      }
    }
    if (id.startsWith('quick-')) {
      const prev = (await store.events({ types: ['mission.completed'], match: { missionId: id }, order: 'desc', limit: 1 }))[0];
      const title = input.titulo?.trim() || prev?.payload.title;
      if (title) {
        return { missionId: id, title, size: input.tamano ?? prev?.payload.size ?? 'chica', attribute: input.atributo ?? prev?.payload.attribute ?? 'disciplina', kind: 'quick' };
      }
    }
    if (!input.titulo) throw new ToolError(`No encontré la misión "${id}". Consulta ver_catalogo (diarias, misiones o agenda) o manda "titulo" para registrarla como misión rápida.`);
  }
  const title = input.titulo?.trim();
  if (!title) throw new ToolError('Indica "mision_id" (del catálogo) o "titulo" (misión rápida).');
  // ¿Coincide con una diaria por título exacto? Así no se duplica la rutina.
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const daily = list<MissionData>(catalog, 'missions', 'daily').find((m) => norm(m.data.title) === norm(title));
  if (daily) return { missionId: daily.id, title: daily.data.title, size: daily.data.size, attribute: daily.data.attribute, kind: 'daily', mainQuestId: daily.data.mainQuestId ?? null };
  return { missionId: quickMissionId(title), title, size: input.tamano ?? 'chica', attribute: input.atributo ?? 'disciplina', kind: 'quick' };
}

const completarMision = tool({
  name: 'completar_mision',
  title: 'Completar misión',
  group: 'registrar',
  writes: true,
  description: `Registra algo que Iván HIZO. Con "mision_id" (diaria, secundaria, capítulo, evento, pendiente de agenda o "npc-<id>") usa los datos del catálogo. Si no está en el catálogo, manda "titulo" (y tamaño y atributo) y queda como misión rápida. ${SIZE_HELP}`,
  input: z.object({
    mision_id: zId.optional().describe('Id del catálogo (ver_catalogo / ver_resumen).'),
    titulo: zText(300).optional().describe('Para algo fuera del catálogo: título corto ("Fui al gym").'),
    tamano: zSize.optional(),
    atributo: zAttr.optional(),
    fecha: zFecha,
  }),
  async run(input, store) {
    const date = pastDate(store, input.fecha);
    const catalog = await store.catalog();
    const m = await resolveMission(store, catalog, input);
    const prev = await store.events({ types: ['mission.completed'], match: { missionId: m.missionId }, order: 'asc' });
    const repeatable = REPEATABLE_KINDS.has(m.kind);
    const dup = repeatable ? prev.find((e) => e.localDate === date) : prev[0];
    if (dup) return { text: `"${m.title}" ya estaba registrada ${repeatable ? 'ese día' : `(el ${dup.localDate}; se completa una sola vez)`}. No registré nada nuevo. Registro existente: [${dup.id}].` };
    const ev = makeEvent(store, 'mission.completed', { missionId: m.missionId, title: m.title, size: m.size, attribute: m.attribute, kind: m.kind, mainQuestId: m.mainQuestId ?? null, npcId: m.npcId ?? null }, date);
    await store.addEvents([ev]);
    const xp = GAME_CONFIG.missionXp[m.size];
    let extra = '';
    if (date === store.today) {
      const bounty = (await store.events({ types: ['bounty.drawn'], from: date, to: date, order: 'asc', limit: 1 }))[0];
      if (bounty?.payload.missionId === m.missionId) extra = ` + bono de misión sorpresa (${GAME_CONFIG.bounty.bonusPercent}%)`;
    }
    const when = date === store.today ? 'hoy' : fmtDay(date);
    return ok(
      `Listo: "${m.title}" ${when} · ${sizeAttr(m.size, m.attribute)} · +${xp} XP${extra}. Registro [${ev.id}].`,
      `Completó "${m.title}" (+${xp} XP)${date !== store.today ? ` · ${date}` : ''}`,
      { events: [ev.id] },
    );
  },
});

const registrarDinero = tool({
  name: 'registrar_dinero',
  title: 'Registrar ingreso o gasto',
  group: 'registrar',
  writes: true,
  description: 'Registra dinero real que entró (ingreso) o salió (gasto). No da XP (el dinero y la XP son sistemas separados), pero los ingresos cuentan para la meta mensual y los grandes retos de ingresos.',
  input: z.object({
    tipo: z.enum(['ingreso', 'gasto']),
    monto: z.number().positive().max(1e10).describe('Monto en la moneda de la app (por defecto MXN).'),
    concepto: zText(300).describe('De qué fue ("Venta Grupo Norte", "Súper").'),
    categoria: z.string().trim().max(100).optional().describe('Categoría opcional (en gastos se usa para el presupuesto).'),
    fecha: zFecha,
  }),
  async run({ tipo, monto, concepto, categoria, fecha }, store) {
    const date = pastDate(store, fecha);
    const type = tipo === 'ingreso' ? 'income.recorded' : 'expense.recorded';
    const ev = makeEvent(store, type, { amount: monto, concept: concepto, category: categoria || undefined }, date);
    await store.addEvents([ev]);
    const catalog = await store.catalog();
    const cur = currencyOf(catalog);
    const m = monthKey(date);
    const monthEvents = await store.events({ from: `${m}-01`, to: `${m}-31`, types: [type] });
    const total = monthEvents.reduce((s, e) => s + Number(e.payload.amount || 0), 0);
    const goal = settingsOf(catalog).monthlyGoal ?? GAME_CONFIG.defaultMonthlyGoal;
    const tail = tipo === 'ingreso' ? `Ingresos de ${fmtMonthName(m)}: ${fmtMoney(total, cur)} de ${fmtMoney(goal, cur)}.` : `Gastos de ${fmtMonthName(m)}: ${fmtMoney(total, cur)}.`;
    return ok(
      `Registré ${tipo === 'ingreso' ? 'el ingreso' : 'el gasto'} de ${fmtMoney(monto, cur)} (${concepto}) ${date === store.today ? 'hoy' : `el ${fmtDay(date)}`}. ${tail} Registro [${ev.id}].`,
      `${tipo === 'ingreso' ? 'Ingreso' : 'Gasto'} ${fmtMoney(monto, cur)} · ${concepto}`,
      { events: [ev.id] },
    );
  },
});

const registrarLeccion = tool({
  name: 'registrar_leccion',
  title: 'Escribir lección',
  group: 'registrar',
  writes: true,
  description: 'Registra una lección aprendida tras algo que salió mal (+30 XP). El texto va en primera persona. Si viene de una misión fallida, manda su id para sumar a su atributo.',
  input: z.object({ texto: z.string().trim().min(3).max(4000), mision_id: zId.optional(), fecha: zFecha }),
  async run({ texto, mision_id, fecha }, store) {
    const date = pastDate(store, fecha);
    let attribute: AttributeId = GAME_CONFIG.defaultAttributes.lesson as AttributeId;
    if (mision_id) {
      const catalog = await store.catalog();
      const m = catalog.find((e) => e.id === mision_id);
      if (!m) throw new ToolError(`No encontré la misión "${mision_id}".`);
      attribute = (m.data as MissionData).attribute ?? attribute;
    }
    const ev = makeEvent(store, 'lesson.written', { text: texto, missionId: mision_id ?? null, attribute }, date);
    await store.addEvents([ev]);
    return ok(`Lección guardada (+${GAME_CONFIG.rewards.lesson} XP, ${ATTRIBUTE_NAMES[attribute]}). Registro [${ev.id}].`, `Lección: ${texto.slice(0, 80)}`, { events: [ev.id] });
  },
});

const registrarContacto = tool({
  name: 'registrar_contacto',
  title: 'Registrar contacto con una persona',
  group: 'registrar',
  writes: true,
  description: 'Registra que habló o convivió con una persona de "Mi gente" (reinicia su contador de días sin contacto). No da XP por sí solo; si era persona clave olvidada, mejor usa completar_mision con "npc-<id>".',
  input: z.object({ persona_id: zId, nota: z.string().trim().max(2000).optional(), fecha: zFecha }),
  async run({ persona_id, nota, fecha }, store) {
    const date = pastDate(store, fecha);
    const npc = find<NpcData>(await store.catalog(), persona_id, 'npcs', ['npc'], 'la persona');
    const ev = makeEvent(store, 'npc.interaction', { npcId: npc.id, note: nota || undefined }, date);
    await store.addEvents([ev]);
    return ok(`Registré el contacto con ${npc.data.name} (${date === store.today ? 'hoy' : fmtDay(date)}). Registro [${ev.id}].`, `Contacto con ${npc.data.name}`, { events: [ev.id] });
  },
});

const avanzarMeta = tool({
  name: 'avanzar_meta',
  title: 'Avanzar una meta',
  group: 'registrar',
  writes: true,
  description: 'Suma avance a una meta con contador (en su unidad). Al llegar al objetivo da la XP de una misión de su tamaño (una vez).',
  input: z.object({ meta_id: zId, cantidad: z.number().positive().max(1e9), nota: z.string().trim().max(2000).optional(), fecha: zFecha }),
  async run({ meta_id, cantidad, nota, fecha }, store) {
    const date = pastDate(store, fecha);
    const goal = find<GoalData>(await store.catalog(), meta_id, 'goals', ['goal'], 'la meta');
    const before = (await store.events({ types: ['goal.progress'], match: { goalId: goal.id } })).reduce((s, e) => s + Number(e.payload.amount || 0), 0);
    const ev = makeEvent(store, 'goal.progress', { goalId: goal.id, amount: cantidad, note: nota || undefined }, date);
    await store.addEvents([ev]);
    const now = before + cantidad;
    const reached = before < goal.data.target && now >= goal.data.target;
    return ok(
      `${goal.data.title}: +${fmtNum(cantidad)} → ${fmtNum(now)}/${fmtNum(goal.data.target)} ${goal.data.unit}.${reached ? ` ¡Meta cumplida! +${GAME_CONFIG.missionXp[goal.data.size]} XP.` : ''} Registro [${ev.id}].`,
      `Meta "${goal.data.title}" +${fmtNum(cantidad)} ${goal.data.unit}`,
      { events: [ev.id] },
    );
  },
});

/** Contornos en cm (nombre de la herramienta → campo del evento). Dan forma al personaje 3D del Perfil. */
const GIRTHS = {
  cuello_cm: 'neckCm',
  hombros_cm: 'shouldersCm',
  pecho_cm: 'chestCm',
  cintura_cm: 'waistCm',
  cadera_cm: 'hipsCm',
  brazo_cm: 'armCm',
  antebrazo_cm: 'forearmCm',
  muslo_cm: 'thighCm',
  pantorrilla_cm: 'calfCm',
} as const;
const zGirth = z.number().positive().max(300).optional();

const registrarCuerpo = tool({
  name: 'registrar_cuerpo',
  title: 'Registrar medidas o entrenamiento',
  group: 'registrar',
  writes: true,
  description:
    'Registra medidas del cuerpo (peso en kg, % de grasa y contornos en cm, que dan forma al personaje 3D del Perfil), un entrenamiento o una nota. Solo registro: no da XP (para la XP de entrenar, completa la misión correspondiente).',
  input: z.object({
    peso_kg: z.number().positive().max(500).optional(),
    grasa_pct: z.number().min(2).max(70).optional().describe('Porcentaje de grasa corporal.'),
    cuello_cm: zGirth,
    hombros_cm: zGirth,
    pecho_cm: zGirth,
    cintura_cm: zGirth,
    cadera_cm: zGirth,
    brazo_cm: zGirth,
    antebrazo_cm: zGirth,
    muslo_cm: zGirth,
    pantorrilla_cm: zGirth,
    entrenamiento: z.string().trim().max(300).optional().describe('Qué entrenó ("Pierna 45 min").'),
    nota: z.string().trim().max(2000).optional(),
    fecha: zFecha,
  }),
  async run(i, store) {
    const date = pastDate(store, i.fecha);
    const girths: Record<string, number> = {};
    for (const [k, field] of Object.entries(GIRTHS)) {
      const v = i[k as keyof typeof GIRTHS];
      if (v !== undefined) girths[field] = v;
    }
    const parts = [
      i.peso_kg !== undefined ? `${i.peso_kg} kg` : '',
      i.grasa_pct !== undefined ? `${i.grasa_pct}% de grasa` : '',
      ...Object.entries(GIRTHS)
        .filter(([k]) => i[k as keyof typeof GIRTHS] !== undefined)
        .map(([k]) => `${k.replace('_cm', '')} ${i[k as keyof typeof GIRTHS]} cm`),
      i.entrenamiento ?? '',
      i.nota ?? '',
    ].filter(Boolean);
    if (!parts.length) throw new ToolError('Manda al menos una medida (peso, % de grasa o un contorno), un entrenamiento o una nota.');
    const ev = makeEvent(
      store,
      'body.logged',
      { weightKg: i.peso_kg, bodyFatPct: i.grasa_pct, ...girths, workout: i.entrenamiento || undefined, note: i.nota || undefined },
      date,
    );
    await store.addEvents([ev]);
    const what = parts.join(' · ');
    return ok(`Registrado en Cuerpo: ${what}. Registro [${ev.id}].`, `Cuerpo: ${what}`, { events: [ev.id] });
  },
});

const registrarSueno = tool({
  name: 'registrar_sueno',
  title: 'Registrar horas de sueño',
  group: 'registrar',
  writes: true,
  description: 'Check-in de sueño: horas dormidas anoche. Define la energía del día (≥7 h = 100, ≥6 h = 75, menos = 50).',
  input: z.object({ horas: z.number().min(0).max(24), fecha: zFecha }),
  async run({ horas, fecha }, store) {
    const date = pastDate(store, fecha);
    const ev = makeEvent(store, 'checkin.morning', { sleepHours: horas }, date);
    await store.addEvents([ev]);
    const energy = energyFromSleep(horas, GAME_CONFIG);
    return ok(
      `Sueño: ${horas} h → energía ${energy}${energy <= GAME_CONFIG.energy.lowThreshold ? ' (baja: conviene ir con misiones chicas o de recuperación)' : ''}. Registro [${ev.id}].`,
      `Sueño ${horas} h (energía ${energy})`,
      { events: [ev.id] },
    );
  },
});

const marcarDescanso = tool({
  name: 'marcar_descanso',
  title: 'Marcar día de descanso',
  group: 'registrar',
  writes: true,
  description: 'Marca un día de descanso: no rompe la racha (máximo 2 por semana, lunes a domingo). No suma ni quita XP.',
  input: z.object({ fecha: zFecha }),
  async run({ fecha }, store) {
    const date = pastDate(store, fecha);
    const ws = weekStart(date);
    const rests = await store.events({ types: ['rest_day.marked'], from: ws, to: addDays(ws, 6) });
    if (rests.some((e) => e.localDate === date)) return { text: `${fmtDay(date)} ya estaba marcado como descanso.` };
    const days = new Set(rests.map((e) => e.localDate));
    const ev = makeEvent(store, 'rest_day.marked', {}, date);
    await store.addEvents([ev]);
    const warn = days.size >= GAME_CONFIG.streak.restDaysPerWeek ? ` Ojo: esa semana ya tenía ${days.size} descansos; solo cuentan ${GAME_CONFIG.streak.restDaysPerWeek} (los días con misiones no gastan cupo).` : '';
    return ok(`Día de descanso marcado (${date === store.today ? 'hoy' : fmtDay(date)}). La racha no se rompe.${warn} Registro [${ev.id}].`, `Día de descanso ${date}`, { events: [ev.id] });
  },
});

const cerrarDia = tool({
  name: 'cerrar_dia',
  title: 'Cerrar el día',
  group: 'registrar',
  writes: true,
  description: 'Cierre del día: una nota de reflexión y el ánimo (1 muy mal … 5 excelente). Si hubo al menos una misión ese día, da un bono sorpresa de oro.',
  input: z.object({ nota: z.string().trim().max(2000), animo: z.number().int().min(1).max(5).optional(), fecha: zFecha }),
  async run({ nota, animo, fecha }, store) {
    const date = pastDate(store, fecha);
    const ev = makeEvent(store, 'day.closed', { note: nota, mood: animo }, date);
    await store.addEvents([ev]);
    return ok(`Día cerrado (${date === store.today ? 'hoy' : fmtDay(date)}). Registro [${ev.id}].`, `Cerró el día${nota ? `: ${nota.slice(0, 60)}` : ''}`, { events: [ev.id] });
  },
});

const planearDia = tool({
  name: 'planear_dia',
  title: 'Planear el día (tus 3)',
  group: 'registrar',
  writes: true,
  description: 'Define las (máx. 3) cosas más importantes de un día ("Tus 3 de hoy"). Reemplaza el plan anterior de ese día. Cumplirlas todas da oro. Cada cosa: mision_id del catálogo o un titulo libre.',
  input: z.object({
    fecha: zDate.optional().describe('Día a planear (YYYY-MM-DD). Por defecto, hoy.'),
    cosas: z
      .array(z.object({ mision_id: zId.optional(), titulo: zText(300).optional(), tamano: zSize.optional(), atributo: zAttr.optional() }))
      .max(3)
      .describe('Hasta 3 cosas. Lista vacía = borrar el plan.'),
  }),
  async run({ fecha, cosas }, store) {
    const forDate = fecha ?? store.today;
    if (forDate < addDays(store.today, -1) || forDate > addDays(store.today, 30)) throw new ToolError('Solo se puede planear de ayer a 30 días adelante.');
    const catalog = await store.catalog();
    const items = [];
    for (const c of cosas) {
      const m = await resolveMission(store, catalog, c);
      items.push({ missionId: m.missionId, title: m.title, size: m.size, attribute: m.attribute, kind: m.kind });
    }
    const ev = makeEvent(store, 'plan.set', { forDate, items }, store.today);
    await store.addEvents([ev]);
    const when = forDate === store.today ? 'hoy' : forDate === addDays(store.today, 1) ? 'mañana' : fmtDay(forDate);
    return ok(
      items.length ? `Plan de ${when}: ${items.map((i, n) => `${n + 1}. ${i.title}`).join(' · ')}. Registro [${ev.id}].` : `Plan de ${when} vaciado. Registro [${ev.id}].`,
      `Plan de ${when}: ${items.map((i) => i.title).join(', ') || '(vacío)'}`,
      { events: [ev.id] },
    );
  },
});

const marcarReto = tool({
  name: 'marcar_reto',
  title: 'Marcar día de un reto',
  group: 'registrar',
  writes: true,
  description: 'Retos de N días seguidos ("no rompas la cadena"). accion "marcar" (por defecto) marca el día como cumplido; si el reto no está en curso, lo inicia ese mismo día. "iniciar" solo lo empieza.',
  input: z.object({ reto_id: zId, accion: z.enum(['marcar', 'iniciar']).optional(), fecha: zFecha }),
  async run({ reto_id, accion, fecha }, store) {
    const date = pastDate(store, fecha);
    const ch = find<ChallengeData>(await store.catalog(), reto_id, 'challenges', ['challenge'], 'el reto');
    const st = (await store.snapshot()).challenges.find((c) => c.id === ch.id);
    const days = Math.max(1, Math.min(365, Math.round(ch.data.days || GAME_CONFIG.challenge.defaultDays)));
    const evs: GameEvent[] = [];
    let n = 0;
    let started = false;
    if (st?.status === 'en curso' && st.startDate) {
      // Intento en curso: todos los días desde su inicio hasta ayer ya están marcados (si no, habría fallado).
      if (accion === 'iniciar') return { text: `"${ch.data.title}" ya está en curso (día ${st.dayNumber} de ${days}).` };
      if (date < st.startDate) throw new ToolError(`El intento actual de "${ch.data.title}" empezó el ${st.startDate}; no se puede marcar un día anterior.`);
      if (st.checkedDates.includes(date)) return { text: `"${ch.data.title}" ya estaba marcado el ${date === store.today ? 'día de hoy' : date}.` };
      evs.push(makeEvent(store, 'challenge.checked', { challengeId: ch.id }, date));
      n = st.checkedDates.length + 1;
    } else if (accion !== 'iniciar' && st?.lastStatus === 'completado' && st.lastClosedOn === date) {
      return { text: `"${ch.data.title}" ya estaba marcado: se completó el ${date === store.today ? 'día de hoy' : date}.` };
    } else if (accion !== 'iniciar' && st?.lastStatus === 'fallido' && st.lastClosedOn === date && st.lastStartDate && date >= st.lastStartDate) {
      // Rescate: el intento falló justo por este día sin marcar. Marcarlo lo revive (si los días siguientes ya
      // estaban marcados o son hoy). Se informa el estado real que calcula el motor.
      const ids = await addEvents(store, [makeEvent(store, 'challenge.checked', { challengeId: ch.id }, date)]);
      // Estado real del intento con la misma regla del motor (una sola consulta; sin recalcular toda la foto).
      const evs2 = await store.events({ types: ['challenge.checked'], match: { challengeId: ch.id }, from: st.lastStartDate });
      const attempt = challengeAttempts([st.lastStartDate], new Set(evs2.map((e) => e.localDate)), days, store.today)[0];
      const msg =
        attempt?.status === 'active'
          ? `Rescaté "${ch.data.title}": marqué el ${date} y el intento sigue vivo (día ${attempt.checked.length} de ${days}).${attempt.checked.includes(store.today) ? '' : ' Hoy también toca marcarlo.'}`
          : attempt?.status === 'completed'
            ? `¡Reto "${ch.data.title}" completado! +${GAME_CONFIG.missionXp[ch.data.size]} XP.`
            : `Marqué el ${date}, pero el intento de "${ch.data.title}" sigue fallido: faltan otros días sin marcar${attempt?.closedOn ? ` (el ${attempt.closedOn})` : ''}.`;
      return ok(`${msg} Registro [${ids[0]}].`, msg, { events: ids });
    } else {
      // Empieza un intento nuevo en `date`: después del último intento y sin dejar días pasados sin marcar.
      if (accion === 'iniciar' && date !== store.today) throw new ToolError('Para empezar un reto en una fecha pasada usa accion "marcar" con esa fecha (un día sin marcar lo haría fallar).');
      if (st?.lastClosedOn && date <= st.lastClosedOn) {
        throw new ToolError(`El intento anterior de "${ch.data.title}" terminó el ${st.lastClosedOn}. El nuevo debe empezar ${st.lastClosedOn >= store.today ? 'mañana' : 'hoy'}.`);
      }
      if (date < addDays(store.today, -1)) throw new ToolError('Un reto solo puede empezar hoy o ayer: si empieza antes, los días sin marcar lo harían fallar.');
      evs.push(makeEvent(store, 'challenge.started', { challengeId: ch.id }, date));
      started = true;
      if (accion !== 'iniciar') {
        evs.push(makeEvent(store, 'challenge.checked', { challengeId: ch.id }, date));
        n = 1;
      }
    }
    const ids = await addEvents(store, evs);
    const left = days - n;
    const msg =
      accion === 'iniciar'
        ? `Empieza "${ch.data.title}" (${days} días)${date === store.today ? '' : ` desde el ${date}`}.`
        : left <= 0
          ? `¡Reto "${ch.data.title}" completado! +${GAME_CONFIG.missionXp[ch.data.size]} XP.`
          : `"${ch.data.title}": día ${n} de ${days}${started ? ' (lo inicié)' : ''}. Faltan ${left}.${date < store.today ? ' Hoy también toca marcarlo.' : ''}`;
    return ok(`${msg} Registros [${ids.join(', ')}].`, msg, { events: ids });
  },
});

const registrarRecaida = tool({
  name: 'registrar_recaida',
  title: 'Registrar recaída',
  group: 'registrar',
  writes: true,
  description: 'Registra una recaída en un hábito a dejar (reinicia su contador de días). No quita XP. Úsala solo si él lo dice.',
  input: z.object({ habito_id: zId, nota: z.string().trim().max(2000).optional(), fecha: zFecha }),
  async run({ habito_id, nota, fecha }, store) {
    const date = pastDate(store, fecha);
    const v = find<ViceData>(await store.catalog(), habito_id, 'habits', ['vice'], 'el hábito');
    const ev = makeEvent(store, 'vice.relapse', { viceId: v.id, note: nota || undefined }, date);
    await store.addEvents([ev]);
    return ok(`Registré la recaída en "${v.data.name}". El contador vuelve a empezar; no se pierde XP. Registro [${ev.id}].`, `Recaída: ${v.data.name}`, { events: [ev.id] });
  },
});

const terminarLibro = tool({
  name: 'terminar_libro',
  title: 'Terminar libro o curso',
  group: 'registrar',
  writes: true,
  description: 'Marca un libro, curso o audiolibro de la biblioteca como terminado (XP de misión de su tamaño, una vez por libro).',
  input: z.object({ libro_id: zId, nota: z.string().trim().max(4000).optional(), fecha: zFecha }),
  async run({ libro_id, nota, fecha }, store) {
    const date = pastDate(store, fecha);
    const b = find<BookData>(await store.catalog(), libro_id, 'library', ['book'], 'el libro');
    const prev = await store.events({ types: ['library.finished'], match: { bookId: b.id }, limit: 1 });
    if (prev.length) return { text: `"${b.data.title}" ya estaba terminado (${prev[0].localDate}).` };
    const ev = makeEvent(store, 'library.finished', { bookId: b.id, title: b.data.title, size: b.data.size, attribute: b.data.attribute, note: nota || undefined }, date);
    await store.addEvents([ev]);
    return ok(`Terminado: "${b.data.title}" (+${GAME_CONFIG.missionXp[b.data.size]} XP). Registro [${ev.id}].`, `Terminó "${b.data.title}"`, { events: [ev.id] });
  },
});

const avanzarGranReto = tool({
  name: 'avanzar_gran_reto',
  title: 'Avanzar un gran reto',
  group: 'registrar',
  writes: true,
  description:
    'Para un gran reto: marca como cumplida su SIGUIENTE fase manual (+300 XP). Para un reto recurrente: registra que lo superó otra vez (+30 XP). Las fases automáticas (ingresos, semanas seguidas) se cumplen solas y no se marcan aquí.',
  input: z.object({ reto_id: zId.describe('Id de un gran reto o de un reto recurrente (ver_catalogo grandes_retos).'), nota: z.string().trim().max(2000).optional(), fecha: zFecha }),
  async run({ reto_id, nota, fecha }, store) {
    const date = pastDate(store, fecha);
    const catalog = await store.catalog();
    const ent = catalog.find((e) => e.id === reto_id && e.module === 'bosses');
    if (!ent) throw new ToolError(`No encontré el gran reto "${reto_id}".`);
    if (ent.kind === 'recurring') {
      const r = ent.data as RecurringBossData;
      const ev = makeEvent(store, 'boss.recurring_defeated', { bossId: ent.id, note: nota || 'Superado' }, date);
      await store.addEvents([ev]);
      return ok(`Superaste otra vez "${r.name}" (+${GAME_CONFIG.rewards.recurringBoss} XP). Registro [${ev.id}].`, `Superó "${r.name}"`, { events: [ev.id] });
    }
    const b = ent.data as BossData;
    const st = (await store.snapshot()).bosses.find((x) => x.id === ent.id);
    if (!st || st.defeated) return { text: `"${b.name}" ya está superado.` };
    if (st.locked) throw new ToolError(`"${b.name}" sigue bloqueado: primero hay que superar el reto previo.`);
    const next = st.next!;
    if (!next.manual) throw new ToolError(`La siguiente fase de "${b.name}" ("${next.title}") es automática: se cumple sola con los registros (ingresos o semanas). No se marca a mano.`);
    const ev = makeEvent(store, 'boss.phase_completed', { bossId: ent.id, phaseIndex: next.index, note: nota || undefined }, date);
    await store.addEvents([ev]);
    const last = next.index === b.phases.length - 1;
    return ok(
      `Fase ${next.index + 1} de "${b.name}" cumplida: ${next.title} (+${GAME_CONFIG.rewards.bossPhase} XP).${last ? ' ¡Reto superado!' : ''} Registro [${ev.id}].`,
      `${b.name}: fase ${next.index + 1} cumplida`,
      { events: [ev.id] },
    );
  },
});

const canjearPremio = tool({
  name: 'canjear_premio',
  title: 'Canjear premio',
  group: 'registrar',
  writes: true,
  description: 'Canjea un premio real de la tienda pagando con oro (nunca toca la XP). Solo si el oro alcanza. Confirma con él antes de canjear.',
  input: z.object({ premio_id: zId }),
  async run({ premio_id }, store) {
    const r = find<ShopRewardData>(await store.catalog(), premio_id, 'shop', ['reward'], 'el premio');
    const s = await store.snapshot();
    if (s.gold.balance < r.data.cost) throw new ToolError(`No alcanza: "${r.data.name}" cuesta ${r.data.cost} y tiene ${s.gold.balance} de oro.`);
    const ev = makeEvent(store, 'reward.redeemed', { rewardId: r.id, name: r.data.name, cost: r.data.cost }, store.today);
    await store.addEvents([ev]);
    return ok(`Canjeado: "${r.data.name}" por ${r.data.cost} de oro. Quedan ${s.gold.balance - r.data.cost}. ¡A disfrutarlo! Registro [${ev.id}].`, `Canjeó "${r.data.name}" (${r.data.cost} de oro)`, { events: [ev.id] });
  },
});

const diarioSemanal = tool({
  name: 'escribir_diario_semanal',
  title: 'Escribir diario semanal',
  group: 'registrar',
  writes: true,
  description: 'Diario semanal de 3 líneas: qué pasó, qué aprendió y qué sigue. La última versión de cada semana gana.',
  input: z.object({
    paso: zText(2000).describe('Qué pasó esta semana.'),
    aprendi: zText(2000).describe('Qué aprendió.'),
    sigue: zText(2000).describe('Qué sigue la próxima semana.'),
    fecha: zDate.optional().describe('Cualquier día de la semana a la que corresponde. Por defecto, esta semana.'),
  }),
  async run({ paso, aprendi, sigue, fecha }, store) {
    const date = pastDate(store, fecha);
    const ws = weekStart(date);
    const ev = makeEvent(store, 'journal.weekly', { weekStart: ws, happened: paso, learned: aprendi, next: sigue }, store.today);
    await store.addEvents([ev]);
    return ok(`Diario de la semana del ${fmtDay(ws)} guardado. Registro [${ev.id}].`, `Diario semanal (${ws})`, { events: [ev.id] });
  },
});

const anularRegistro = tool({
  name: 'anular_registro',
  title: 'Anular un registro',
  group: 'registrar',
  writes: true,
  destructive: true,
  description: 'Anula un registro hecho por error (deja de contar; queda en la bitácora y se puede restaurar desde la app). Usa el id que aparece entre corchetes en ver_dia o ver_historial.',
  input: z.object({ registro_id: zId }),
  async run({ registro_id }, store) {
    const ev = await store.getEvent(registro_id);
    if (!ev) throw new ToolError(`No encontré el registro "${registro_id}".`);
    if (ev.voidedAt) return { text: `Ese registro ya estaba anulado.` };
    const catalog = await store.catalog();
    const desc = describeEvent(ev, new Map(catalog.map((e) => [e.id, e])), currencyOf(catalog));
    await store.voidEvent(ev.id);
    return ok(`Anulado: ${desc} (${ev.localDate}). Deja de contar; se recalcula todo.`, `Anuló: ${desc} (${ev.localDate})`, { voided: [ev.id] });
  },
});

// ---------------------------------------------------------------------------------------------
// Herramientas para ORGANIZAR (catálogo)
// ---------------------------------------------------------------------------------------------

const zEditId = zId.optional().describe('Para EDITAR un elemento existente, su id. Sin id, se crea uno nuevo.');

function existingOf(catalog: Entity[], id: string | undefined, module: string, kinds: string[], what: string): Entity | null {
  if (!id) return null;
  return find(catalog, id, module, kinds, what);
}

const guardarMision = tool({
  name: 'guardar_mision',
  title: 'Crear o editar misión',
  group: 'organizar',
  writes: true,
  description: `Crea o edita una misión del catálogo: "diaria" (repetible; puede ser parte de la rutina en ciertos días), "secundaria" (una sola vez) o "evento" (una vez, con fecha opcional). ${SIZE_HELP}`,
  input: z.object({
    id: zEditId,
    tipo: z.enum(['diaria', 'secundaria', 'evento']).optional().describe('Obligatorio al crear.'),
    titulo: zText(300).optional().describe('Obligatorio al crear.'),
    tamano: zSize.optional(),
    atributo: zAttr.optional(),
    mision_principal_id: zId.nullable().optional().describe('Misión principal a la que aporta (mq-…).'),
    notas: z.string().max(2000).optional(),
    en_rutina: z.boolean().optional().describe('Diarias: si aparece sola en Hoy (por defecto sí).'),
    dias: z.array(z.number().int().min(0).max(6)).max(7).optional().describe('Diarias: días de la semana (0 = lunes … 6 = domingo). Vacío = todos.'),
    recuperacion: z.boolean().optional().describe('Diarias: misión de recuperación (para días de energía baja).'),
    fecha: zDate.nullable().optional().describe('Eventos: fecha opcional.'),
  }),
  async run(i, store) {
    const catalog = await store.catalog();
    const prev = existingOf(catalog, i.id, 'missions', ['daily', 'side', 'event', 'chapter'], 'la misión') as Entity<MissionData> | null;
    const kindMap = { diaria: 'daily', secundaria: 'side', evento: 'event' } as const;
    const kind = i.tipo ? kindMap[i.tipo] : prev?.kind;
    if (!kind) throw new ToolError('Indica "tipo" (diaria, secundaria o evento).');
    if (prev && i.tipo && prev.kind !== kind) throw new ToolError('No se puede cambiar el tipo de una misión existente; crea una nueva.');
    const base: Partial<MissionData> = prev?.data ?? {};
    const title = i.titulo ?? base.title;
    if (!title) throw new ToolError('Falta "titulo".');
    if (i.mision_principal_id) find(catalog, i.mision_principal_id, 'missions', ['main'], 'la misión principal');
    const data: MissionData = {
      ...base,
      title,
      size: i.tamano ?? base.size ?? 'chica',
      attribute: i.atributo ?? base.attribute ?? 'disciplina',
      mainQuestId: i.mision_principal_id !== undefined ? i.mision_principal_id : (base.mainQuestId ?? null),
      notes: i.notas ?? base.notes,
    };
    if (kind === 'daily') {
      data.category = base.category ?? 'libre';
      if (i.en_rutina !== undefined) data.routine = i.en_rutina;
      if (i.dias !== undefined) data.days = [...new Set(i.dias)].sort();
      if (i.recuperacion !== undefined) data.recovery = i.recuperacion;
    }
    if (kind === 'event' && i.fecha !== undefined) data.date = i.fecha;
    const { saved, ref } = await upsert(store, prev, { id: prev?.id ?? newEntityId(store, kind), module: 'missions', kind, data });
    const label = kind === 'daily' ? 'Diaria' : kind === 'side' ? 'Secundaria' : kind === 'event' ? 'Evento' : 'Capítulo';
    let routine = '';
    if (kind === 'daily') routine = data.routine === false ? ' · fuera de la rutina' : !data.days?.length ? ' · en la rutina todos los días' : ` · en la rutina: ${data.days.map((d) => DAY_NAMES[d]).join(', ')}`;
    return ok(
      `${prev ? 'Actualizada' : 'Creada'}: ${label} "${data.title}" (${sizeAttr(data.size, data.attribute)})${routine}. Id [${saved.id}].`,
      `${prev ? 'Editó' : 'Creó'} ${label.toLowerCase()} "${data.title}"`,
      { entities: [ref] },
    );
  },
});

const agendarPendiente = tool({
  name: 'agendar_pendiente',
  title: 'Agendar pendiente',
  group: 'organizar',
  writes: true,
  description: 'Crea o mueve un pendiente de la Agenda para un día (se completa una vez con completar_mision). Para posponer, manda su id y la nueva fecha.',
  input: z.object({
    id: zEditId,
    titulo: zText(300).optional().describe('Obligatorio al crear.'),
    fecha: zDate.optional().describe('Día planeado (YYYY-MM-DD). Al crear, por defecto hoy.'),
    tamano: zSize.optional(),
    atributo: zAttr.optional(),
    notas: z.string().max(2000).optional(),
  }),
  async run(i, store) {
    const catalog = await store.catalog();
    const prev = existingOf(catalog, i.id, 'planner', ['todo'], 'el pendiente') as Entity<TodoData> | null;
    const title = i.titulo ?? prev?.data.title;
    if (!title) throw new ToolError('Falta "titulo".');
    const data: TodoData = {
      ...(prev?.data ?? {}),
      title,
      date: i.fecha ?? prev?.data.date ?? store.today,
      size: i.tamano ?? prev?.data.size ?? 'chica',
      attribute: i.atributo ?? prev?.data.attribute ?? 'disciplina',
      missionId: prev?.data.missionId ?? null,
      notes: i.notas ?? prev?.data.notes,
    };
    const { saved, ref } = await upsert(store, prev, { id: prev?.id ?? newEntityId(store, 'todo'), module: 'planner', kind: 'todo', data });
    return ok(
      `${prev ? 'Pendiente actualizado' : 'Agendado'}: "${data.title}" para el ${fmtDay(data.date)} (${sizeAttr(data.size, data.attribute)}). Id [${saved.id}].`,
      `${prev ? 'Movió' : 'Agendó'} "${data.title}" (${data.date})`,
      { entities: [ref] },
    );
  },
});

const guardarMeta = tool({
  name: 'guardar_meta',
  title: 'Crear o editar meta',
  group: 'organizar',
  writes: true,
  description: 'Crea o edita una meta con contador ("Leer 12 libros", objetivo 12, unidad "libros"). Al cumplirla da la XP de una misión de su tamaño. Para ocultar una meta cumplida usa archivar.',
  input: z.object({
    id: zEditId,
    titulo: zText(300).optional(),
    objetivo: z.number().positive().max(1e9).optional(),
    unidad: z.string().trim().min(1).max(40).optional(),
    atributo: zAttr.optional(),
    tamano: zSize.optional(),
    fecha_limite: zDate.nullable().optional(),
    notas: z.string().max(2000).optional(),
    archivar: z.boolean().optional(),
  }),
  async run(i, store) {
    const catalog = await store.catalog();
    const prev = existingOf(catalog, i.id, 'goals', ['goal'], 'la meta') as Entity<GoalData> | null;
    const p: Partial<GoalData> = prev?.data ?? {};
    const st = prev ? (await store.snapshot()).goals.find((g) => g.id === prev.id) : null;
    // La XP de una meta cumplida se recalcula con su objetivo y su tamaño actuales: no se permite quitarla.
    if (st?.completedOn) {
      if (i.tamano !== undefined && i.tamano !== p.size) throw new ToolError(`"${p.title}" ya se cumplió: cambiar su tamaño cambiaría la XP ganada. Crea una meta nueva si quieres otra recompensa.`);
      if (i.objetivo !== undefined && i.objetivo > st.current) throw new ToolError(`"${p.title}" ya se cumplió (${fmtNum(st.current)} ${p.unit}): subir el objetivo a ${fmtNum(i.objetivo)} la descumpliría y quitaría su XP. Crea una meta nueva para el siguiente nivel.`);
    }
    const title = i.titulo ?? p.title;
    const target = i.objetivo ?? p.target;
    if (!title || !target) throw new ToolError('Al crear una meta, manda "titulo" y "objetivo".');
    const data: GoalData = {
      ...p,
      title,
      target,
      unit: i.unidad ?? p.unit ?? 'veces',
      attribute: i.atributo ?? p.attribute ?? 'disciplina',
      size: i.tamano ?? p.size ?? 'grande',
      deadline: i.fecha_limite !== undefined ? i.fecha_limite : (p.deadline ?? null),
      notes: i.notas ?? p.notes,
      archived: i.archivar ?? p.archived ?? false,
    };
    const { saved, ref } = await upsert(store, prev, { id: prev?.id ?? newEntityId(store, 'goal'), module: 'goals', kind: 'goal', data });
    return ok(
      `${prev ? 'Meta actualizada' : 'Meta creada'}: "${data.title}" · objetivo ${fmtNum(data.target)} ${data.unit}${data.deadline ? ` · vence ${data.deadline}` : ''}${data.archived ? ' · archivada' : ''}. Id [${saved.id}].`,
      `${prev ? 'Editó' : 'Creó'} la meta "${data.title}"`,
      { entities: [ref] },
    );
  },
});

const guardarReto = tool({
  name: 'guardar_reto',
  title: 'Crear o editar reto de N días',
  group: 'organizar',
  writes: true,
  description: 'Crea o edita un reto de N días seguidos ("30 días sin azúcar"). Con iniciar=true también lo empieza hoy. Completarlo da la XP de una misión de su tamaño.',
  input: z.object({
    id: zEditId,
    titulo: zText(300).optional(),
    dias: z.number().int().min(2).max(365).optional(),
    atributo: zAttr.optional(),
    tamano: zSize.optional(),
    archivar: z.boolean().optional(),
    iniciar: z.boolean().optional(),
  }),
  async run(i, store) {
    const catalog = await store.catalog();
    const prev = existingOf(catalog, i.id, 'challenges', ['challenge'], 'el reto') as Entity<ChallengeData> | null;
    const p: Partial<ChallengeData> = prev?.data ?? {};
    const st = prev ? (await store.snapshot()).challenges.find((c) => c.id === prev.id) : null;
    // La XP de un reto completado se recalcula con sus días y su tamaño actuales: cambiarlos la quitaría.
    if (st && st.completions > 0 && ((i.dias !== undefined && i.dias !== p.days) || (i.tamano !== undefined && i.tamano !== p.size))) {
      throw new ToolError(`"${p.title}" ya se completó ${st.completions} vez(ces): cambiar sus días o su tamaño cambiaría la XP ya ganada. Crea un reto nuevo (y archiva este si quieres).`);
    }
    const title = i.titulo ?? p.title;
    if (!title) throw new ToolError('Falta "titulo".');
    const data: ChallengeData = {
      ...p,
      title,
      days: i.dias ?? p.days ?? GAME_CONFIG.challenge.defaultDays,
      attribute: i.atributo ?? p.attribute ?? 'disciplina',
      size: i.tamano ?? p.size ?? (GAME_CONFIG.challenge.defaultSize as MissionSize),
      archived: i.archivar ?? p.archived ?? false,
    };
    const { saved, ref } = await upsert(store, prev, { id: prev?.id ?? newEntityId(store, 'ch'), module: 'challenges', kind: 'challenge', data });
    const events: string[] = [];
    let note = '';
    if (i.iniciar) {
      if (st?.status === 'en curso') note = ' · ya estaba en curso';
      else if (st?.lastClosedOn && st.lastClosedOn >= store.today) note = ' · el intento anterior terminó hoy: empiézalo mañana';
      else {
        const ev = makeEvent(store, 'challenge.started', { challengeId: saved.id }, store.today);
        await store.addEvents([ev]);
        events.push(ev.id);
        note = ' · empieza hoy';
      }
    }
    return ok(
      `${prev ? 'Reto actualizado' : 'Reto creado'}: "${data.title}" (${data.days} días, ${sizeAttr(data.size, data.attribute)})${note}. Id [${saved.id}].`,
      `${prev ? 'Editó' : 'Creó'} el reto "${data.title}"${events.length ? ' y lo inició' : ''}`,
      { entities: [ref], events },
    );
  },
});

const guardarPersona = tool({
  name: 'guardar_persona',
  title: 'Agregar o editar persona',
  group: 'organizar',
  writes: true,
  description: 'Agrega o edita una persona de "Mi gente". tipo: party (cercano: familia, pareja, amigos íntimos), aliado, mentor, cliente, rival. Persona clave = aviso si pasan 30 días sin contacto.',
  input: z.object({
    id: zEditId,
    nombre: zText(120).optional(),
    tipo: z.enum(NPC_TYPES).optional(),
    clave: z.boolean().optional(),
    relacion: z.number().int().min(1).max(5).optional().describe('Qué tan buena es la relación, 1 a 5.'),
    notas: z.string().max(2000).optional(),
  }),
  async run(i, store) {
    const catalog = await store.catalog();
    const prev = existingOf(catalog, i.id, 'npcs', ['npc'], 'la persona') as Entity<NpcData> | null;
    const p: Partial<NpcData> = prev?.data ?? {};
    const name = i.nombre ?? p.name;
    if (!name) throw new ToolError('Falta "nombre".');
    const data: NpcData = {
      ...p,
      name,
      npcType: i.tipo ?? p.npcType ?? 'aliado',
      key: i.clave ?? p.key ?? false,
      relation: i.relacion ?? p.relation ?? 3,
      guildId: p.guildId ?? null,
      notes: i.notas ?? p.notes ?? '',
      lastContact: p.lastContact ?? (prev ? null : store.today),
    };
    const { saved, ref } = await upsert(store, prev, { id: prev?.id ?? newEntityId(store, 'npc'), module: 'npcs', kind: 'npc', data });
    return ok(`${prev ? 'Actualizada' : 'Agregada'}: ${data.name}${data.key ? ' (persona clave)' : ''}. Id [${saved.id}].`, `${prev ? 'Editó' : 'Agregó'} a ${data.name}`, { entities: [ref] });
  },
});

const guardarPremio = tool({
  name: 'guardar_premio',
  title: 'Crear o editar premio',
  group: 'organizar',
  writes: true,
  description: 'Crea o edita un premio real de la tienda (se compra con oro; 1 de oro ≈ 10 XP).',
  input: z.object({ id: zEditId, nombre: zText(300).optional(), costo: z.number().int().positive().max(1e6).optional(), notas: z.string().max(2000).optional() }),
  async run(i, store) {
    const catalog = await store.catalog();
    const prev = existingOf(catalog, i.id, 'shop', ['reward'], 'el premio') as Entity<ShopRewardData> | null;
    const name = i.nombre ?? prev?.data.name;
    const cost = i.costo ?? prev?.data.cost;
    if (!name || !cost) throw new ToolError('Al crear un premio, manda "nombre" y "costo".');
    const data: ShopRewardData = { ...(prev?.data ?? {}), name, cost, notes: i.notas ?? prev?.data.notes };
    const { saved, ref } = await upsert(store, prev, { id: prev?.id ?? newEntityId(store, 'rw'), module: 'shop', kind: 'reward', data });
    return ok(`${prev ? 'Premio actualizado' : 'Premio creado'}: "${data.name}" por ${data.cost} de oro. Id [${saved.id}].`, `${prev ? 'Editó' : 'Creó'} el premio "${data.name}"`, { entities: [ref] });
  },
});

const guardarHabito = tool({
  name: 'guardar_habito',
  title: 'Agregar hábito a dejar',
  group: 'organizar',
  writes: true,
  description: 'Agrega o edita un hábito que quiere dejar (se cuentan los días sin recaer; no da ni quita XP).',
  input: z.object({ id: zEditId, nombre: zText(200).optional(), desde: zDate.optional().describe('Desde cuándo se cuenta. Por defecto, hoy.'), notas: z.string().max(2000).optional() }),
  async run(i, store) {
    const catalog = await store.catalog();
    const prev = existingOf(catalog, i.id, 'habits', ['vice'], 'el hábito') as Entity<ViceData> | null;
    const name = i.nombre ?? prev?.data.name;
    if (!name) throw new ToolError('Falta "nombre".');
    const data: ViceData = { ...(prev?.data ?? {}), name, startDate: i.desde ?? prev?.data.startDate ?? store.today, notes: i.notas ?? prev?.data.notes };
    const { saved, ref } = await upsert(store, prev, { id: prev?.id ?? newEntityId(store, 'vice'), module: 'habits', kind: 'vice', data });
    return ok(`${prev ? 'Actualizado' : 'Agregado'}: "${data.name}" (desde ${data.startDate}). Id [${saved.id}].`, `${prev ? 'Editó' : 'Agregó'} el hábito "${data.name}"`, { entities: [ref] });
  },
});

const guardarLibro = tool({
  name: 'guardar_libro',
  title: 'Agregar libro o curso',
  group: 'organizar',
  writes: true,
  description: 'Agrega o edita un libro, curso o audiolibro en la Biblioteca (estado pendiente o leyendo; al terminarlo usa terminar_libro).',
  input: z.object({
    id: zEditId,
    titulo: zText(300).optional(),
    autor: z.string().max(200).optional(),
    tipo: z.enum(BOOK_TYPES).optional(),
    estado: z.enum(BOOK_STATUSES).optional(),
    atributo: zAttr.optional(),
    tamano: zSize.optional(),
    notas: z.string().max(2000).optional(),
  }),
  async run(i, store) {
    const catalog = await store.catalog();
    const prev = existingOf(catalog, i.id, 'library', ['book'], 'el libro') as Entity<BookData> | null;
    const p: Partial<BookData> = prev?.data ?? {};
    const title = i.titulo ?? p.title;
    if (!title) throw new ToolError('Falta "titulo".');
    const data: BookData = {
      ...p,
      title,
      author: i.autor ?? p.author,
      bookType: i.tipo ?? p.bookType ?? 'libro',
      status: i.estado ?? p.status ?? 'pendiente',
      attribute: i.atributo ?? p.attribute ?? 'inteligencia',
      size: i.tamano ?? p.size ?? 'media',
      notes: i.notas ?? p.notes,
    };
    const { saved, ref } = await upsert(store, prev, { id: prev?.id ?? newEntityId(store, 'book'), module: 'library', kind: 'book', data });
    return ok(`${prev ? 'Actualizado' : 'Agregado'}: "${data.title}" (${data.bookType}, ${data.status}). Id [${saved.id}].`, `${prev ? 'Editó' : 'Agregó'} "${data.title}" a la biblioteca`, { entities: [ref] });
  },
});

/** Qué se puede borrar y qué registros lo protegen (borrarlo cambiaría XP ya ganada). */
const DELETABLE: Record<string, { kinds: string[]; guard?: { type: string; key: string; hint: string } }> = {
  missions: { kinds: ['daily', 'side', 'event'] },
  planner: { kinds: ['todo'] },
  goals: { kinds: ['goal'], guard: { type: 'goal.progress', key: 'goalId', hint: 'Tiene avances registrados: mejor archívala con guardar_meta (archivar=true) para conservar su XP.' } },
  challenges: { kinds: ['challenge'], guard: { type: 'challenge.started', key: 'challengeId', hint: 'Ya tiene intentos: mejor archívalo con guardar_reto (archivar=true) para conservar su XP.' } },
  npcs: { kinds: ['npc'] },
  shop: { kinds: ['reward'] },
  habits: { kinds: ['vice'] },
  library: { kinds: ['book'] },
};

const borrarElemento = tool({
  name: 'borrar_elemento',
  title: 'Borrar del catálogo',
  group: 'organizar',
  writes: true,
  destructive: true,
  description: 'Borra un elemento del catálogo (misión diaria/secundaria/evento, pendiente, meta o reto sin avances, persona, premio, hábito, libro). La XP ya ganada se conserva. Confirma con él antes de borrar.',
  input: z.object({ id: zId }),
  async run({ id }, store) {
    const catalog = await store.catalog();
    const ent = catalog.find((e) => e.id === id);
    if (!ent) throw new ToolError(`No encontré "${id}".`);
    const rule = DELETABLE[ent.module];
    if (!rule || !rule.kinds.includes(ent.kind)) throw new ToolError('Ese tipo de elemento no se puede borrar desde aquí; hazlo en la app.');
    if (rule.guard) {
      const used = await store.events({ types: [rule.guard.type], match: { [rule.guard.key]: ent.id }, limit: 1 });
      if (used.length) throw new ToolError(rule.guard.hint);
    }
    await store.deleteEntity(ent.id);
    const d = ent.data as { title?: string; name?: string };
    const name = d.title ?? d.name ?? ent.id;
    return ok(`Borrado: "${name}". Se puede recuperar deshaciendo la acción desde la app (Más → Conectar IA → Actividad).`, `Borró "${name}"`, { entities: [{ id: ent.id, prev: ent }] });
  },
});

// ---------------------------------------------------------------------------------------------
// Registro y ejecución
// ---------------------------------------------------------------------------------------------

export const ASSISTANT_TOOLS: AssistantTool[] = [
  verResumen,
  verDia,
  verCatalogo,
  verHistorial,
  verDinero,
  guia,
  completarMision,
  registrarDinero,
  registrarLeccion,
  registrarContacto,
  avanzarMeta,
  registrarCuerpo,
  registrarSueno,
  marcarDescanso,
  cerrarDia,
  planearDia,
  marcarReto,
  registrarRecaida,
  terminarLibro,
  avanzarGranReto,
  canjearPremio,
  diarioSemanal,
  anularRegistro,
  guardarMision,
  agendarPendiente,
  guardarMeta,
  guardarReto,
  guardarPersona,
  guardarPremio,
  guardarHabito,
  guardarLibro,
  borrarElemento,

  // [[voz]]

  // [[entreno]]
  ...ENTRENO_TOOLS,

  // [[gente]]

  // [[mapa]]

  // [[habilidades]]

  // [[aprendizaje]]

  // [[salud]]

  // [[habitos]]

];

const BY_NAME = new Map(ASSISTANT_TOOLS.map((t) => [t.name, t]));

export function getAssistantTool(name: string): AssistantTool | undefined {
  return BY_NAME.get(name);
}

const schemaCache = new WeakMap<AssistantTool, Record<string, unknown>>();

/** JSON Schema de la entrada de una herramienta (para MCP y para la API de Claude). Se calcula una vez. */
export function toolInputSchema(t: AssistantTool): Record<string, unknown> {
  const cached = schemaCache.get(t);
  if (cached) return cached;
  let schema = z.toJSONSchema(t.input, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete schema.$schema;
  if (schema.type !== 'object') schema = { type: 'object', properties: {} };
  if (!schema.properties) schema.properties = {};
  schemaCache.set(t, schema);
  return schema;
}

/** Descripción pública de las herramientas (la pantalla "Conectar IA" la muestra). */
export function describeAssistantTools() {
  return ASSISTANT_TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, group: t.group, writes: t.writes, destructive: !!t.destructive }));
}

export interface RunOptions {
  /** Si es false, las herramientas que escriben se niegan (modo solo lectura). */
  allowWrites: boolean;
}

/** Ejecuta una herramienta validando su entrada. Nunca lanza: los errores vuelven como `isError`. */
export async function runAssistantTool(name: string, rawInput: unknown, store: AssistantStore, opts: RunOptions): Promise<ToolResult> {
  const t = BY_NAME.get(name);
  if (!t) return { text: `Herramienta desconocida: ${name}`, isError: true };
  if (t.writes && !opts.allowWrites) {
    return { text: 'La IA está en modo solo lectura: Iván desactivó los cambios en IGV (Más → Conectar IA → Permisos). Puedes consultar, pero no registrar ni editar.', isError: true };
  }
  const parsed = t.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return { text: `Datos inválidos para ${name}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ')}`, isError: true };
  }
  try {
    return await t.run(parsed.data, store);
  } catch (err) {
    if (err instanceof ToolError) return { text: err.message, isError: true };
    throw err;
  }
}
