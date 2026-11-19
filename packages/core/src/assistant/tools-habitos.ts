import { z } from 'zod';
import { DAY_CHECKS, fmtMissing, getDayCheck, reviewDay, type DayReview } from '../engine/day-review';
import { HABIT_VERDICT_LABELS, fmtRate, fmtWeekdays, fmtWeekdaysLong, type HabitTrend, type HabitVerdict } from '../engine/habits';
import type { TodoData } from '../types';
import { diffDays } from '../util/dates';
import type { AssistantSnapshot } from './snapshot';
import { fmtDay, fmtMoney } from './format';
import { MAX_PAST_DAYS, ToolError, currencyOf, list, makeEvent, ok, pastDate, tool, zFecha, type AssistantTool } from './toolkit';

/**
 * Herramientas de IA de Hábitos y "¿Cómo fue tu día?". Leen la foto (`snapshot.habits`) y los registros del día;
 * la única que escribe es `marcar_nada_que_registrar` (evento `day.check_skipped`, sin XP).
 */

const MOODS = ['muy mal', 'mal', 'normal', 'bien', 'excelente'];

const trendText = (t: HabitTrend | null, pts: number | null) => (t ? `${t}${pts !== null && t !== 'estable' ? ` (${pts > 0 ? '+' : ''}${pts} pts)` : ''}` : 'sin con qué comparar');

/** Texto de `ver_habitos` (también útil para el Coach). */
export function renderHabits(s: AssistantSnapshot): string {
  const h = s.habits;
  const L: string[] = [`# Hábitos · ${fmtDay(s.today)}`];
  if (!h) return [...L, 'Sin datos de hábitos en la foto actual.'].join('\n');
  if (!h.routine.length) L.push('Su rutina está vacía (no tiene diarias en la rutina).');
  else {
    L.push(
      `Cumplimiento de la rutina: ${fmtRate(h.last30)} en 30 días · ${fmtRate(h.last7)} en 7 días. ${h.counts.bien} van muy bien · ${h.counts.medias} a medias · ${h.counts.flojo} flojos${h.counts.nuevo ? ` · ${h.counts.nuevo} recién empezados` : ''}.`,
    );
    const order: HabitVerdict[] = ['bien', 'medias', 'flojo', 'nuevo'];
    for (const v of order) {
      const xs = h.routine.filter((r) => r.verdict === v);
      if (!xs.length) continue;
      L.push('', `## ${HABIT_VERDICT_LABELS[v]}`);
      for (const r of xs)
        L.push(
          `- ${r.title} [${r.id}]: ${fmtRate(r.rate30)} en 30 días (7 días: ${fmtRate(r.rate7)}) · racha ${r.streak} (mejor ${r.best}) · ${trendText(r.trend, r.trendPoints)} · toca ${fmtWeekdays(r.days)}${
            r.weakDays.length ? ` · falla más en ${fmtWeekdaysLong(r.weakDays)}` : ''
          }${r.dueToday ? ` · hoy ${r.doneToday ? 'hecho' : 'pendiente'}` : ''}`,
        );
    }
  }
  if (h.suggestions.length) {
    L.push('', '## Hazlo hábito (lo hace seguido y no está en su rutina)');
    for (const x of h.suggestions)
      L.push(
        `- "${x.title}": ${x.times} días en los últimos ${x.windowDays} · sugerido: ${fmtWeekdays(x.days)}${x.dailyId ? ` · ya existe como diaria fuera de la rutina [${x.dailyId}]` : ''}`,
      );
    L.push('Para volverlo hábito: guardar_mision con tipo diaria (mismo título) y los días sugeridos, solo si él quiere.');
  }
  if (h.vices.length) {
    L.push('', '## Hábitos a dejar');
    for (const v of h.vices) {
      const base = s.vices.find((x) => x.id === v.id);
      L.push(
        `- ${base?.name ?? v.id} [${v.id}]: ${base?.current ?? 0} días sin recaer (mejor ${base?.best ?? 0}) · ${v.relapses30} recaídas en 30 días (antes ${v.relapsesPrev30}) · ${HABIT_VERDICT_LABELS[v.verdict]} · ${v.trend ?? 'sin con qué comparar'}${
          v.worstWeekday !== null ? ` · suele recaer en ${fmtWeekdaysLong([v.worstWeekday])}` : ''
        }${v.everyDays ? ` · ≈ una cada ${v.everyDays} días` : ''}`,
      );
    }
  }
  return L.join('\n');
}

/** Líneas del panorama (renderOverview). */
export function habitsOverviewLines(s: AssistantSnapshot): string[] {
  const h = s.habits;
  if (!h) return [];
  const L: string[] = [];
  if (h.routine.length) {
    L.push('', '## Hábitos (30 días)');
    L.push(`Rutina cumplida ${fmtRate(h.last30)} · ${h.counts.bien} van muy bien, ${h.counts.medias} a medias, ${h.counts.flojo} flojos.`);
    const weak = h.routine.filter((r) => r.verdict === 'flojo' || r.trend === 'empeorando');
    if (weak.length) L.push(`Atención: ${weak.map((r) => `${r.title} ${fmtRate(r.rate30)}${r.trend === 'empeorando' ? ' (empeorando)' : ''}`).join('; ')}.`);
  }
  if (h.suggestions.length) L.push(`Lo hace seguido y no está en su rutina: ${h.suggestions.map((x) => `"${x.title}" (${x.times} días en ${x.windowDays})`).join('; ')}.`);
  L.push('Para saber qué registró hoy y qué le falta (sueño, gastos, con quién estuvo, rutina…), usa revisar_dia.');
  return L;
}

export const HABITOS_GUIDE =
  'Hábitos: la rutina se mide sola (cumplimiento en 7 y 30 días respetando los días que le tocan, racha, tendencia y días de la semana flojos) y lo que hace seguido fuera de la rutina se sugiere como "Hazlo hábito". "¿Cómo fue tu día?" revisa qué registró cada día y qué falta (sueño, lo que hizo, rutina, gastos, con quién estuvo, agenda, hábitos a dejar, cierre); no da XP.';

function renderReview(r: DayReview, currency: string): string {
  const L: string[] = [`# ¿Cómo fue el día? · ${fmtDay(r.date)}${r.isToday ? ' (hoy)' : ''}`];
  if (r.restDay) L.push('Día de descanso marcado.');
  L.push(r.score === null ? 'Nada que revisar.' : `Día registrado: ${r.score}% (${r.checks.filter((c) => c.status !== 'missing').length} de ${r.checks.length} revisiones).`);
  const n = r.numbers;
  L.push(
    `En números: ${n.xp === null ? 'XP sin dato' : `+${n.xp} XP`} · ${n.missions} ${n.missions === 1 ? 'misión' : 'misiones'} · gasto ${fmtMoney(n.expense, currency)}${n.income ? ` · ingreso ${fmtMoney(n.income, currency)}` : ''}${
      n.sleepHours !== null ? ` · durmió ${n.sleepHours} h` : ''
    }.`,
  );
  L.push(r.closure ? `Cierre: ${r.closure.mood ? `ánimo ${MOODS[r.closure.mood - 1]}` : 'sin ánimo'}${r.closure.note ? ` · "${r.closure.note}"` : ''}.` : 'Día sin cerrar.');

  L.push('', 'Lo que registró:');
  if (!r.logged.length) L.push('- (nada)');
  for (const g of r.logged) L.push(`- ${g.area.label}: ${g.items.map((i) => (i.text ? `${i.label} ${i.text}` : i.label)).join('; ')}`);

  const answered = r.checks.filter((c) => c.status !== 'missing');
  if (answered.length) L.push('', `Ya respondido: ${answered.map((c) => `${c.label}${c.status === 'skipped' ? ' (nada que registrar)' : c.detail ? ` (${c.detail})` : ''}`).join(' · ')}.`);
  if (r.missing.length) {
    L.push('', `Falta (${fmtMissing(r.missing, 9)}):`);
    for (const c of r.missing)
      L.push(
        `- ${c.label} [${c.id}]: ${c.question}${c.pending.length ? ` Pendiente: ${c.pending.join('; ')}.` : ''}${c.tool ? ` → ${c.tool}` : ''}${
          c.skipLabel ? ` (si no hubo nada: marcar_nada_que_registrar revision="${c.id}")` : ''
        }`,
      );
    L.push('', 'Pregúntale por lo que falta, de a una cosa, y registra solo lo que él te diga.');
  } else if (r.checks.length) L.push('', 'No falta nada: el día está completo.');
  if (!r.isToday && r.missing.length) L.push(`(Es un día pasado: registra con fecha ${r.date}.)`);
  return L.join('\n');
}

const verHabitos = tool({
  name: 'ver_habitos',
  title: 'Ver hábitos',
  group: 'consultar',
  writes: false,
  description:
    'Cómo van sus hábitos: cada diaria de la rutina con su % de cumplimiento en 7 y 30 días (respetando los días que le tocan y los descansos), racha, tendencia contra los 30 días anteriores y días de la semana en que más falla; lo que hace seguido y podría volverse hábito; y sus hábitos a dejar (recaídas por mes y tendencia).',
  input: z.object({}),
  async run(_i, store) {
    return { text: renderHabits(await store.snapshot()) };
  },
});

const revisarDia = tool({
  name: 'revisar_dia',
  title: '¿Cómo fue tu día?',
  group: 'consultar',
  writes: false,
  description:
    'Revisa un día (por defecto hoy): qué registró agrupado por área, el % del día registrado y qué FALTA (sueño, lo que hizo, rutina pendiente, gastos, con quién estuvo, agenda, plan, hábitos a dejar, cierre), con la herramienta para llenar cada hueco. Úsala para preguntarle "¿y con quién estuviste hoy?" y completar su día.',
  input: z.object({ fecha: zFecha }),
  async run({ fecha }, store) {
    const date = fecha ?? store.today;
    if (date > store.today) throw new ToolError(`El ${date} todavía no llega. Hoy es ${store.today}.`);
    if (diffDays(date, store.today) > MAX_PAST_DAYS) throw new ToolError('Solo puedo revisar hasta un año atrás.');
    const [catalog, events, snap, plans] = await Promise.all([
      store.catalog(),
      store.events({ from: date, to: date, order: 'asc' }),
      store.snapshot(),
      store.events({ types: ['plan.set'], match: { forDate: date }, order: 'asc' }),
    ]);
    // Pendientes de la agenda de ese día (y, si es hoy, los atrasados): ¿se hicieron alguna vez?
    const agendaIds = new Set(snap.day.agenda.map((a) => a.id));
    const todos = list<TodoData>(catalog, 'planner', 'todo').filter((t) => t.data.date === date || (date === store.today && t.data.date < date && agendaIds.has(t.id)));
    const doneTodos = new Set<string>();
    await Promise.all(
      todos.map(async (t) => {
        const hit = await store.events({ types: ['mission.completed'], match: { missionId: t.id }, limit: 1 });
        if (hit.length) doneTodos.add(t.id);
      }),
    );
    const dayDone = new Set(events.filter((e) => e.type === 'mission.completed').map((e) => String(e.payload.missionId)));
    const lastPlan = plans.at(-1);
    const xp = snap.xp.byDate[date] ?? (diffDays(date, store.today) < 42 ? 0 : null);
    const review = reviewDay({
      date,
      today: store.today,
      events,
      entities: catalog,
      doneEver: (id) => doneTodos.has(id) || dayDone.has(id),
      plan: lastPlan ? { items: (lastPlan.payload.items ?? []) as { missionId: string; title: string }[] } : null,
      habitSince: Object.fromEntries((snap.habits?.routine ?? []).map((h) => [h.id, h.since])),
      xp,
      currency: currencyOf(catalog),
    });
    return { text: renderReview(review, currencyOf(catalog)) };
  },
});

const SKIPPABLE = DAY_CHECKS.filter((c) => c.skipLabel).map((c) => c.id) as [string, ...string[]];

const marcarNadaQueRegistrar = tool({
  name: 'marcar_nada_que_registrar',
  title: 'Marcar "nada que registrar"',
  group: 'registrar',
  writes: true,
  description: `Para "¿Cómo fue tu día?": marca que ese día no hubo nada que registrar en una revisión (${DAY_CHECKS.filter((c) => c.skipLabel)
    .map((c) => `${c.id} = "${c.skipLabel}"`)
    .join(', ')}). Úsala solo si él lo dice (p. ej., "hoy no gasté nada"). No da XP.`,
  input: z.object({ revision: z.enum(SKIPPABLE).describe('Qué revisión.'), fecha: zFecha }),
  async run({ revision, fecha }, store) {
    const date = pastDate(store, fecha);
    const check = getDayCheck(revision);
    if (!check?.skipLabel) throw new ToolError(`La revisión "${revision}" no acepta "nada que registrar".`);
    const events = await store.events({ from: date, to: date, order: 'asc' });
    const r = reviewDay({ date, today: store.today, events, entities: await store.catalog(), checks: [check] });
    const st = r.checks[0];
    const when = date === store.today ? 'hoy' : fmtDay(date);
    if (st?.status === 'done') return { text: `${check.label} ya tiene registros ${when} (${st.detail ?? 'listo'}); no hace falta marcarlo.` };
    if (st?.status === 'skipped') return { text: `${check.label} ya estaba marcado como "${check.skipLabel}" ${when}.` };
    const ev = makeEvent(store, 'day.check_skipped', { checkId: check.id, label: check.skipLabel }, date);
    await store.addEvents([ev]);
    return ok(`Listo: "${check.skipLabel}" ${when}. Registro [${ev.id}].`, `${check.skipLabel} (${date})`, { events: [ev.id] });
  },
});

export const HABITOS_TOOLS: AssistantTool[] = [verHabitos, revisarDia, marcarNadaQueRegistrar];
