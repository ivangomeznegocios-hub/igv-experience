import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ATTRIBUTE_NAMES,
  GAME_CONFIG,
  addDays,
  dayCloseBonus,
  frequentMissions,
  isInRoutine,
  pickForDate,
  weekStart,
  weekday,
  type AttributeId,
  type BossData,
  type Entity,
  type MissionData,
  type MissionSize,
  type RecurringBossData,
  type TodoData,
  type ViceData,
} from '@igv/core';
import { addEvent, useGame } from '../data/store';
import { completeGenerated, completeMission, completeQuick, completeTodo, isDone, saveTodo, uncomplete, updateSettings } from '../lib/actions';
import { bossHpPercent, buildDailyBriefing, localHour, pickDailyEncounter } from '../lib/narrator';
import { fmtDate, fmtMoney, fmtWeekday } from '../lib/time';
import { BossArt, BossHpBar } from '../ui/BossArt';
import { Hero } from '../ui/Hero';
import { Icon } from '../ui/icons';
import { AttrBadge, Badge, Bar, Chips, Collapse, Empty, Field, Sheet, SizeBadge, SwipeRow, confirmAction, toast, undoToast, useAutoFocus } from '../ui/kit';
import { LessonForm } from '../ui/MissionForm';
import { startMissionQuest, startQuest, startTodoQuest } from '../ui/QuestMode';
import { openQuickAdd } from '../ui/QuickAdd';
import { SyncPill } from '../ui/SyncPill';
import { openPlanSheet, TodayPlanCard } from '../ui/DayPlan';
import { WeekPaceCard } from '../ui/WeekPace';
import { WeekShareCard } from '../ui/WeekShare';
import { DayReviewRow } from '../ui/DayReview';
import { HabitsHighlight } from '../ui/HabitBits';

export default function Hoy() {
  const { state } = useGame();
  const [lesson, setLesson] = useState(false);
  const [recurring, setRecurring] = useState<{ open: boolean; bossId?: string }>({ open: false });

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">
            {fmtWeekday(state.today)} {fmtDate(state.today, true)}
            {state.seasons.current && ` · T${state.seasons.current.data.number} sem. ${state.seasons.currentWeek}`}
          </div>
          <h1>Hoy</h1>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <SyncPill inline />
          <Link to="/buscar" className="btn icon ghost" aria-label="Buscar">
            <Icon name="compass" />
          </Link>
        </div>
      </div>

      <BirthDatePrompt />
      {!state.attributes.rated && (
        <div className="banner">
          <Icon name="user" width={20} />
          <span>Califica tus 7 atributos iniciales (una sola vez).</span>
          <Link to="/personaje" className="btn sm primary">
            Calificar
          </Link>
        </div>
      )}

      <Hero />
      <MorningRitualCard />
      <NarratorBriefing />
      <DayReviewRow />
      <TodayPlanCard />
      <WeekReportCard />
      <BountyCard />
      <RoutineCard />
      <HabitsHighlight />
      <AgendaCard />
      <ActiveBossCard />
      <DailyEncounterCard onDefeatRecurring={(bossId) => setRecurring({ open: true, bossId })} />
      <NpcMissions />
      <WeeklyCard />
      <WeekPaceCard />
      <CampfireCard />

      <Collapse title="Más en tu jornada">
        <FavoritesSection />
        <VicesMini />
        <div className="grid2" style={{ marginTop: 10 }}>
          <button className="btn block" onClick={() => setLesson(true)}>
            <Icon name="feather" /> Escribir lección
          </button>
          <button className="btn block" onClick={() => setRecurring({ open: true })}>
            <Icon name="flag" /> Superé un reto
          </button>
        </div>
      </Collapse>

      {lesson && <LessonForm open onClose={() => setLesson(false)} />}
      {recurring.open && <RecurringDefeatSheet initialBossId={recurring.bossId} onClose={() => setRecurring({ open: false })} />}
    </>
  );
}

function BirthDatePrompt() {
  const { state, store } = useGame();
  const [date, setDate] = useState('');
  const [dismissed, setDismissed] = useState(false);
  if (!store.ready || state.settings.birthDate || dismissed) return null;
  return (
    <Sheet
      open
      onClose={() => setDismissed(true)}
      title="Bienvenido a IGV EXPERIENCE"
      actions={
        <button
          className="btn primary"
          disabled={!date}
          onClick={() => {
            updateSettings(state.settings, { birthDate: date });
            toast('Fecha guardada. Ya puedes ver Mi vida en semanas.');
          }}
        >
          Guardar
        </button>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Para dibujar <b>Mi vida en semanas</b> necesito tu fecha de nacimiento. Puedes cambiarla después en Ajustes.
      </p>
      <Field label="Fecha de nacimiento">
        <input className="input" type="date" value={date} max={state.today} onChange={(e) => setDate(e.target.value)} />
      </Field>
    </Sheet>
  );
}

/** Check-in de la mañana: solo aparece si aún no registras sueño hoy. */
function MorningRitualCard() {
  const { state } = useGame();
  const [custom, setCustom] = useState('');
  if (state.energy.value !== null) return null;
  const log = (h: number) => {
    addEvent('checkin.morning', { sleepHours: h });
    toast(h >= 7 ? '⚡ Descansado: energía al 100' : h >= 6 ? 'Energía en 75 · listo para el día' : 'Energía baja (50) · hoy prioriza misiones chicas');
  };
  return (
    <div className="card ritual-card">
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <div className="ritual-orb">
          <Icon name="sun" />
        </div>
        <div className="grow">
          <div className="eyebrow" style={{ color: 'var(--gold)' }}>
            Check-in de la mañana · Energía
          </div>
          <div className="small" style={{ margin: '4px 0 10px' }}>
            ¿Cuántas horas dormiste?
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => log(5)}>
              ≤5 h (50)
            </button>
            <button className="btn sm" onClick={() => log(6)}>
              6 h (75)
            </button>
            <button className="btn sm primary" onClick={() => log(7.5)}>
              7 h+ (100 ⚡)
            </button>
            <div className="row" style={{ gap: 4 }}>
              <input
                className="input"
                style={{ width: 70, minHeight: 32, padding: '4px 8px' }}
                type="number"
                step="0.5"
                min="0"
                max="24"
                placeholder="Hrs"
                value={custom}
                onChange={(ev) => setCustom(ev.target.value)}
              />
              {custom !== '' && (
                <button className="btn sm" onClick={() => log(Number(custom))}>
                  OK
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Resumen del día local (sin API) con acceso rápido al Coach. */
function NarratorBriefing() {
  const { state, entities } = useGame();
  const brief = useMemo(() => buildDailyBriefing(state, entities), [state, entities]);
  return (
    <div className="card narrator-card">
      <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
        <div className="narrator-sigil">
          <Icon name="sparkles" />
        </div>
        <div className="grow">
          <div className="narrator-head">{brief.headline}</div>
          <div className="small muted">{brief.body}</div>
        </div>
        <Link to="/game-master" className="btn sm ghost" aria-label="Hablar con el Coach">
          Coach
        </Link>
      </div>
    </div>
  );
}

function RoutineCard() {
  const { state, list } = useGame();
  const wd = weekday(state.today);
  const dailies = list<MissionData>('missions', 'daily');
  const routine = dailies.filter((m) => isInRoutine(m.data, wd));
  const doneToday = new Set(state.missions.completedToday);
  const low = state.energy.low;
  const suitable = (m: Entity<MissionData>) => !low || m.data.size === 'chica' || !!m.data.recovery;
  const ordered = [...routine].sort((a, b) => Number(doneToday.has(a.id)) - Number(doneToday.has(b.id)) || Number(suitable(b)) - Number(suitable(a)));
  const doneCount = routine.filter((m) => doneToday.has(m.id)).length;
  const perfect = routine.length > 0 && doneCount === routine.length;
  const others = dailies.filter((m) => !routine.includes(m));
  const [showOthers, setShowOthers] = useState(false);
  const toggle = (m: Entity<MissionData>) => (doneToday.has(m.id) ? uncomplete(m.id, state.today, m.data.title) : completeMission(m));

  const row = (m: Entity<MissionData>) => {
    const done = doneToday.has(m.id);
    const isBounty = state.bounty.today?.missionId === m.id;
    return (
      <SwipeRow key={m.id} onRight={done ? undefined : () => completeMission(m)}>
        <div className={`item ${done ? 'done' : ''}`} style={{ opacity: suitable(m) || done ? 1 : 0.5 }}>
          <button className={`check ${done ? 'done' : ''}`} aria-pressed={done} aria-label={`${done ? 'Desmarcar' : 'Completar'} ${m.data.title}`} onClick={() => toggle(m)}>
            <Icon name="check" />
          </button>
          <div className="grow" onClick={() => toggle(m)} style={{ cursor: 'pointer' }}>
            <div className="item-title">{m.data.title}</div>
            <div className="row wrap" style={{ gap: 4, marginTop: 3 }}>
              <SizeBadge size={m.data.size} />
              <AttrBadge attr={m.data.attribute} />
              {isBounty && <Badge tone="flame">Sorpresa +{state.bounty.today!.bonus}</Badge>}
              {m.data.recovery && low && <Badge tone="teal">Recuperación</Badge>}
            </div>
          </div>
          {!done && (
            <button className="btn icon sm play-btn" aria-label={`Empezar ${m.data.title}`} title="Iniciar en Modo enfoque" onClick={() => startMissionQuest(m)}>
              <Icon name="play" />
            </button>
          )}
        </div>
      </SwipeRow>
    );
  };

  return (
    <div className={`card ${perfect ? 'perfect-card' : ''}`}>
      <div className="card-head">
        <div>
          <h2>Rutina de hoy</h2>
          <div className="tiny muted">
            {perfect ? `¡Día perfecto! ${doneCount}/${routine.length} hechas` : `${doneCount}/${routine.length} hechas · toca ✓, desliza → o pulsa ▶ para enfocarte`}
          </div>
        </div>
        <div className="row" style={{ gap: 2 }}>
          <Link to="/habitos" className="btn sm ghost">
            Hábitos
          </Link>
          <Link to="/misiones?tab=daily" className="btn sm ghost">
            Editar
          </Link>
        </div>
      </div>
      {routine.length > 0 && <Bar value={doneCount} max={routine.length} tone={perfect ? 'gold' : 'green'} size="sm" />}
      {low && (
        <div className="banner warn" style={{ margin: '10px 0 4px' }}>
          <Icon name="bolt" width={18} /> Energía baja: hoy prioriza misiones chicas y de recuperación.
        </div>
      )}
      <div style={{ marginTop: 6 }}>
        {routine.length === 0 && <Empty>No tienes diarias en tu rutina para hoy. Agrégalas en Misiones → Diarias.</Empty>}
        {ordered.map(row)}
      </div>
      {others.length > 0 && (
        <>
          <button className="btn sm ghost" onClick={() => setShowOthers((x) => !x)}>
            {showOthers ? 'Ocultar' : `Otras diarias (${others.length})`}
          </button>
          {showOthers && others.map(row)}
        </>
      )}
    </div>
  );
}

function FavoritesSection() {
  const { state, events, list } = useGame();
  const routineIds = new Set(list<MissionData>('missions', 'daily').filter((m) => isInRoutine(m.data, weekday(state.today))).map((m) => m.id));
  const favs = useMemo(() => frequentMissions(events, state.today, 60, 12).filter((f) => !routineIds.has(f.missionId)), [events, state.today, routineIds]);
  if (!favs.length) return null;
  const doneToday = new Set(state.missions.completedToday);
  const dailies = list<MissionData>('missions', 'daily');
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>
        Un toque · lo que más registras
      </div>
      <div className="fav-row">
        {favs.map((f) => {
          const done = doneToday.has(f.missionId);
          return (
            <button
              key={f.missionId}
              className={`fav ${done ? 'done' : ''}`}
              onClick={() => {
                if (done) return uncomplete(f.missionId, state.today, f.title);
                const d = dailies.find((x) => x.id === f.missionId);
                if (d) completeMission(d);
                else completeQuick(f.title, f.size as MissionSize, f.attribute as AttributeId);
              }}
            >
              <Icon name={done ? 'check' : 'plus'} />
              {f.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AgendaCard() {
  const { state, list } = useGame();
  const todos = list<TodoData>('planner', 'todo');
  const pending = todos.filter((t) => !isDone(state.missions.completions, t.id));
  const due = pending.filter((t) => t.data.date <= state.today).sort((a, b) => (a.data.date < b.data.date ? -1 : 1));
  const doneToday = todos.filter((t) => state.missions.completions[t.id]?.dates.includes(state.today));
  const tomorrow = addDays(state.today, 1);
  const tomorrowCount = pending.filter((t) => t.data.date === tomorrow).length;
  const postpone = (t: Entity<TodoData>) => {
    saveTodo({ ...t.data, date: tomorrow }, t.id);
    undoToast(`"${t.data.title}" pasó a mañana`, () => saveTodo(t.data, t.id));
  };
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Agenda</h2>
          <div className="tiny muted">{tomorrowCount ? `${tomorrowCount} planeada(s) para mañana` : 'Planea mañana para empezar con todo armado'}</div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn sm ghost" onClick={() => openQuickAdd({ mode: 'todo' })}>
            <Icon name="plus" /> Planear
          </button>
          <Link to="/misiones?tab=agenda" className="btn sm ghost">
            Ver
          </Link>
        </div>
      </div>
      {due.length === 0 && doneToday.length === 0 && <div className="small muted">Nada pendiente para hoy.</div>}
      {due.map((t) => (
        <SwipeRow key={t.id} onRight={() => completeTodo(t)} onLeft={() => postpone(t)} leftLabel="Mañana">
          <div className="item">
            <button className="check" aria-label={`Completar ${t.data.title}`} onClick={() => completeTodo(t)}>
              <Icon name="check" />
            </button>
            <div className="grow">
              <div className="item-title">{t.data.title}</div>
              <div className="row wrap" style={{ gap: 4, marginTop: 3 }}>
                <SizeBadge size={t.data.size} />
                <AttrBadge attr={t.data.attribute} />
                {t.data.date < state.today && <Badge tone="red">Desde {fmtDate(t.data.date)}</Badge>}
              </div>
            </div>
            <button className="btn icon sm play-btn" aria-label={`Empezar ${t.data.title}`} title="Iniciar en Modo enfoque" onClick={() => startTodoQuest(t)}>
              <Icon name="play" />
            </button>
            <button className="btn sm ghost" onClick={() => postpone(t)} aria-label="Pasar a mañana">
              Mañana
            </button>
          </div>
        </SwipeRow>
      ))}
      {doneToday.map((t) => (
        <div key={t.id} className="item done">
          <button className="check done" aria-label={`Desmarcar ${t.data.title}`} onClick={() => uncomplete(t.id, state.today, t.data.title)}>
            <Icon name="check" />
          </button>
          <div className="grow">
            <div className="item-title">{t.data.title}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function BountyCard() {
  const { state, list } = useGame();
  const b = state.bounty.today;
  const drawing = useRef(false);
  const wd = weekday(state.today);
  const candidates = useMemo(() => {
    const low = state.energy.low;
    const fits = (m: Entity<MissionData>) => !low || m.data.size === 'chica' || !!m.data.recovery;
    const daily = list<MissionData>('missions', 'daily').filter((m) => isInRoutine(m.data, wd) && fits(m));
    const side = list<MissionData>('missions', 'side').filter((m) => !isDone(state.missions.completions, m.id) && fits(m) && m.data.size !== 'epica');
    return [...daily, ...side];
  }, [list, state.energy.low, state.missions.completions, wd]);

  useEffect(() => {
    if (b || drawing.current || !candidates.length) return;
    const pick = pickForDate(candidates, state.today, 'bounty');
    if (!pick) return;
    drawing.current = true;
    addEvent('bounty.drawn', { missionId: pick.id, title: pick.data.title, size: pick.data.size, attribute: pick.data.attribute });
  }, [b, candidates, state.today]);

  if (!b) return null;
  const m = list<MissionData>('missions').find((x) => x.id === b.missionId);
  return (
    <div className={`card bounty ${b.completed ? 'won' : ''}`}>
      <div className="row">
        <div className="bounty-icon">
          <Icon name={b.completed ? 'trophy' : 'target'} />
        </div>
        <div className="grow">
          <div className="eyebrow">Misión sorpresa del día · +{b.bonus} XP bono</div>
          <div className="item-title">{b.title}</div>
          <div className="tiny muted">
            {b.completed ? `¡Cumplida! Ganaste +${b.bonus} XP extra.` : `Complétala hoy para cobrar ${GAME_CONFIG.bounty.bonusPercent}% extra de XP y oro.`}
          </div>
        </div>
        {!b.completed && m && (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn icon sm play-btn" aria-label={`Empezar ${b.title}`} onClick={() => startMissionQuest(m)}>
              <Icon name="play" />
            </button>
            <button className="btn sm primary" onClick={() => completeMission(m)}>
              Hecha
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Gran reto activo: ícono, barra de avance y acción directa. */
function ActiveBossCard() {
  const { state, list, byId } = useGame();
  const [income, setIncome] = useState(false);
  const [editGoal, setEditGoal] = useState(false);
  const allBosses = list<BossData>('bosses', 'boss').filter((b) => {
    const st = state.bosses.bosses[b.id];
    return st && !st.locked && !st.defeated;
  });
  const focusQuestId = state.seasons.current?.data.focusMainQuestId;
  const defaultIdx = Math.max(
    0,
    allBosses.findIndex((b) => b.data.mainQuestId === focusQuestId || b.id === 'boss-dragon'),
  );
  const [idx, setIdx] = useState(defaultIdx);
  const boss = allBosses[idx % Math.max(allBosses.length, 1)];
  if (!boss) return null;

  const st = state.bosses.bosses[boss.id];
  const nextIdx = st.phases.findIndex((p) => !p.done);
  const nextPhase = nextIdx >= 0 ? st.phases[nextIdx] : null;
  const nextMetric = nextIdx >= 0 ? boss.data.phases[nextIdx]?.metric : null;
  const { phaseHpPct } = bossHpPercent(boss, state);
  const isDragon = boss.id === 'boss-dragon' || nextMetric?.type === 'month_income' || nextMetric?.type === 'consecutive_months_income';
  const cur = state.settings.currency;

  const linkedMission =
    nextMetric?.type === 'weekly_streak' && nextMetric.missionIds[0]
      ? (byId.get(nextMetric.missionIds[0]) as Entity<MissionData> | undefined)
      : undefined;

  const hpRight =
    nextPhase?.progress && nextPhase.progress.target > 0
      ? nextPhase.progress.unit === 'MXN'
        ? `faltan ${fmtMoney(Math.max(0, nextPhase.progress.target - nextPhase.progress.current), cur)}`
        : `${nextPhase.progress.current}/${nextPhase.progress.target} ${nextPhase.progress.unit}`
      : `${100 - phaseHpPct}% de avance`;

  return (
    <div className="card boss-encounter">
      <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <BossArt bossId={boss.id} size={62} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row between" style={{ gap: 6 }}>
            <div className="eyebrow" style={{ color: 'var(--gold)' }}>
              Gran reto · Fase {st.phasesDone + 1}/{boss.data.phases.length}
            </div>
            {allBosses.length > 1 && (
              <button className="btn sm ghost" style={{ minHeight: 24, padding: '2px 8px', fontSize: 11 }} onClick={() => setIdx((i) => (i + 1) % allBosses.length)}>
                Otro reto →
              </button>
            )}
          </div>
          <h2 style={{ margin: '2px 0 4px' }}>{boss.data.name}</h2>
          <div className="tiny muted ellipsis">{nextPhase ? nextPhase.title : boss.data.description}</div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <BossHpBar hpPct={phaseHpPct} label={isDragon ? `Mes: ${fmtMoney(state.money.monthIncome, cur)} / ${fmtMoney(state.money.goal, cur)}` : `Avance de la fase`} right={hpRight} />
      </div>

      <div className="row between" style={{ marginTop: 10, gap: 8 }}>
        <div className="row" style={{ gap: 6 }}>
          {isDragon && (
            <>
              <button className="btn sm primary" onClick={() => setIncome(true)}>
                <Icon name="plus" /> Registrar ingreso
              </button>
              <button className="btn sm ghost" onClick={() => setEditGoal(true)}>
                Meta
              </button>
            </>
          )}
          {!isDragon && linkedMission && (
            <button className="btn sm primary" onClick={() => startMissionQuest(linkedMission)}>
              <Icon name="play" /> Avanzar ({linkedMission.data.title})
            </button>
          )}
          {!isDragon && !linkedMission && nextMetric?.type === 'manual' && (
            <button
              className="btn sm primary"
              onClick={() =>
                confirmAction(`¿Completaste "${nextPhase?.title}"? (+${GAME_CONFIG.rewards.bossPhase} XP)`) &&
                addEvent('boss.phase_completed', { bossId: boss.id, phaseIndex: nextIdx })
              }
            >
              <Icon name="check" /> Completar fase
            </button>
          )}
        </div>
        <Link to="/jefes" className="btn sm ghost">
          Ver retos
        </Link>
      </div>

      {income && <MoneySheet kind="income" onClose={() => setIncome(false)} />}
      {editGoal && <GoalSheet onClose={() => setEditGoal(false)} />}
    </div>
  );
}

/** Reto del día: un reto recurrente o una prueba relámpago de tu atributo más bajo. */
function DailyEncounterCard({ onDefeatRecurring }: { onDefeatRecurring: (bossId?: string) => void }) {
  const { state, entities } = useGame();
  const enc = useMemo(() => pickDailyEncounter(state, entities), [state, entities]);
  if (!enc) return null;
  return (
    <div className={`card encounter-card ${enc.completed ? 'won' : ''}`}>
      <div className="row" style={{ gap: 12 }}>
        {enc.bossId ? (
          <BossArt bossId={enc.bossId} size={48} defeated={enc.completed} />
        ) : (
          <div className="bounty-icon">
            <Icon name="bolt" />
          </div>
        )}
        <div className="grow">
          <div className="eyebrow" style={{ color: enc.completed ? 'var(--green)' : 'var(--gold)' }}>
            {enc.completed ? 'Reto del día superado' : 'Reto del día'}
          </div>
          <div className="item-title">{enc.title}</div>
          <div className="tiny muted">{enc.subtitle}</div>
        </div>
        {!enc.completed && (
          <div className="row" style={{ gap: 6 }}>
            {enc.kind === 'recurring_boss' ? (
              <button className="btn sm primary" onClick={() => onDefeatRecurring(enc.bossId)}>
                Lo hice
              </button>
            ) : (
              <>
                <button
                  className="btn icon sm play-btn"
                  aria-label="Empezar reto del día"
                  onClick={() =>
                    startQuest({
                      kind: 'quick',
                      title: enc.title,
                      size: enc.size,
                      attribute: enc.attribute,
                      minutes: 10,
                    })
                  }
                >
                  <Icon name="play" />
                </button>
                <button className="btn sm primary" onClick={() => completeQuick(enc.title, enc.size, enc.attribute)}>
                  Hecho
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function VicesMini() {
  const { state, list } = useGame();
  const vices = list<ViceData>('habits', 'vice');
  if (!vices.length) return null;
  return (
    <Link to="/enemigos" className="row between" style={{ textDecoration: 'none', color: 'inherit', padding: '8px 0' }}>
      <div className="grow">
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          Hábitos a dejar
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          {vices.map((v) => (
            <span key={v.id} className="badge">
              {v.data.name}: <b className="num" style={{ color: 'var(--text)' }}>{state.vices[v.id]?.current ?? 0}</b>d
            </span>
          ))}
        </div>
      </div>
      <Icon name="right" width={18} className="muted" />
    </Link>
  );
}

function WeekReportCard() {
  const { state } = useGame();
  const wd = weekday(state.today);
  if (wd !== 6 && wd !== 0) return null;
  const target = wd === 0 ? addDays(state.today, -7) : state.today;
  return (
    <>
    <Link to={`/reporte?semana=${weekStart(target)}`} className="banner" style={{ textDecoration: 'none', color: 'inherit' }}>
      <Icon name="scroll" width={20} />
      <span>
        <b>Reporte semanal</b> de {wd === 0 ? 'la semana pasada' : 'esta semana'} listo.
      </span>
      <span className="btn sm">Ver</span>
    </Link>
    <WeekShareCard monday={weekStart(target)} compact />
    </>
  );
}

/** Cierre del día: resumen de la jornada y una nota para el registro. */
function CampfireCard() {
  const { state } = useGame();
  const [open, setOpen] = useState(false);
  const closed = state.dayClosures[state.today];
  const evening = localHour() >= 18;
  if (!evening && !closed && state.xp.today === 0) return null;
  return (
    <>
      <button className={`card close-day campfire-card ${evening && !closed ? 'glow' : ''}`} onClick={() => setOpen(true)}>
        <div className="campfire-icon">
          <Icon name="campfire" width={24} height={24} />
        </div>
        <div className="grow" style={{ textAlign: 'left' }}>
          <div className="eyebrow" style={{ color: 'var(--flame)' }}>
            Cierre del día
          </div>
          <b>{closed ? 'Día cerrado' : 'Cierra tu día'}</b>
          <div className="tiny muted">{closed ? closed.note || 'Toca para ver tu resumen' : `Hoy: +${state.xp.today} XP · +${state.gold.earnedToday} oro · racha ${state.streak.current}d`}</div>
        </div>
        <Icon name="right" width={18} />
      </button>
      {open && <CloseDaySheet onClose={() => setOpen(false)} />}
    </>
  );
}

const MOODS = ['😫', '😕', '😐', '🙂', '🔥'];

function CloseDaySheet({ onClose }: { onClose: () => void }) {
  const { state } = useGame();
  const prev = state.dayClosures[state.today];
  const [note, setNote] = useState(prev?.note ?? '');
  const [mood, setMood] = useState<number | null>(prev?.mood ?? null);
  const entries = state.xp.ledger.filter((e) => e.date === state.today);
  const byAttr = new Map<string, number>();
  for (const e of entries) if (e.attribute) byAttr.set(e.attribute, (byAttr.get(e.attribute) ?? 0) + e.amount);
  const missions = entries.filter((e) => e.source === 'mission').length;
  return (
    <Sheet
      open
      onClose={onClose}
      title="Cierre del día"
      actions={
        <button
          className="btn primary"
          onClick={() => {
            addEvent('day.closed', { note: note.trim(), mood: mood ?? undefined });
            const bonus = !prev && missions > 0 ? dayCloseBonus(state.today, GAME_CONFIG.goldBonus.dayCloseOptions) : 0;
            toast(bonus ? `Día cerrado. Bono sorpresa: +${bonus} de oro.` : 'Día cerrado. Descansa, mañana seguimos.', bonus ? 'xp' : 'info');
            onClose();
            const tomorrow = addDays(state.today, 1);
            if (!state.plans[tomorrow]?.items.length) setTimeout(() => openPlanSheet(tomorrow), 350);
          }}
        >
          {prev ? 'Actualizar cierre' : 'Cerrar el día'}
        </button>
      }
    >
      <div className="campfire-hero">
        <div className="campfire-glow" aria-hidden="true">
          <Icon name="campfire" width={36} height={36} />
        </div>
        <div className="small muted">Resumen del día · {fmtDate(state.today, true)}</div>
      </div>
      <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
        <div className="stat-tile">
          <span>XP hoy</span>
          <b className="gold num">+{state.xp.today}</b>
        </div>
        <div className="stat-tile">
          <span>Misiones</span>
          <b className="num">{missions}</b>
        </div>
        <div className="stat-tile">
          <span>Racha</span>
          <b className="num flame">{state.streak.current}</b>
        </div>
      </div>
      {byAttr.size > 0 && (
        <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
          {[...byAttr.entries()].map(([a, x]) => (
            <Badge key={a} tone="gold">
              {ATTRIBUTE_NAMES[a as AttributeId]} +{x}
            </Badge>
          ))}
          {state.gold.earnedToday > 0 && <Badge tone="gold">+{state.gold.earnedToday} oro</Badge>}
        </div>
      )}
      {entries.length === 0 && <p className="small muted">Hoy no registraste XP. Si fue día de descanso, márcalo desde el botón +.</p>}
      <DayReviewRow flat onNavigate={onClose} />
      <Field label="¿Cómo cerraste el día?">
        <Chips value={mood} onChange={setMood} size="lg" options={MOODS.map((m, i) => ({ value: i + 1, label: m }))} />
      </Field>
      <Field label="Una línea sobre tu día">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Lo mejor de hoy, lo que aprendí…" />
      </Field>
      <p className="tiny muted">Tu nota aparece en el Historial y en Mi vida en semanas.</p>
    </Sheet>
  );
}

function NpcMissions() {
  const { state } = useGame();
  const gen = state.npcs.generatedMissions;
  if (!gen.length) return null;
  const doneToday = new Set(state.missions.completedToday);
  return (
    <div className="card">
      <div className="card-head">
        <h2>Tu gente te extraña</h2>
        <Link to="/npcs" className="btn sm ghost">
          Mi gente
        </Link>
      </div>
      {gen.map((m) => {
        const done = doneToday.has(m.id);
        return (
          <div key={m.id} className={`item ${done ? 'done' : ''}`}>
            <button className={`check ${done ? 'done' : ''}`} onClick={() => (done ? uncomplete(m.id, state.today, m.title) : completeGenerated(m))} aria-label={m.title}>
              <Icon name="check" />
            </button>
            <div className="grow">
              <div className="item-title">{m.title}</div>
              <div className="tiny muted">
                {state.npcs.npcs[m.npcId]?.daysSince ?? '—'} días sin contacto · {GAME_CONFIG.missionXp[m.size]} XP · Relaciones
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WeeklyCard() {
  const { state, list, byId } = useGame();
  const [pick, setPick] = useState(false);
  const m = state.missions.weeklyMissionId ? (byId.get(state.missions.weeklyMissionId) as Entity<MissionData> | undefined) : undefined;
  const done = m ? isDone(state.missions.completions, m.id) : false;
  const options = useMemo(
    () => list<MissionData>('missions').filter((x) => ['side', 'event', 'chapter'].includes(x.kind) && !isDone(state.missions.completions, x.id)),
    [list, state.missions.completions],
  );
  return (
    <div className="card">
      <div className="card-head">
        <h2>Misión grande de la semana</h2>
        <button className="btn sm ghost" onClick={() => setPick(true)}>
          {m ? 'Cambiar' : 'Elegir'}
        </button>
      </div>
      {m ? (
        <div className={`item ${done ? 'done' : ''}`}>
          <button
            className={`check ${done ? 'done' : ''}`}
            onClick={() => (done ? confirmAction(`¿Desmarcar "${m.data.title}"?`) && uncomplete(m.id, undefined, m.data.title) : confirmAction(`¿Completaste "${m.data.title}"?`) && completeMission(m))}
            aria-label="Completar misión de la semana"
          >
            <Icon name="check" />
          </button>
          <div className="grow">
            <div className="item-title">{m.data.title}</div>
            <div className="row wrap" style={{ gap: 4, marginTop: 3 }}>
              <SizeBadge size={m.data.size} />
              <AttrBadge attr={m.data.attribute} />
            </div>
          </div>
          {!done && (
            <button className="btn icon sm play-btn" aria-label={`Empezar ${m.data.title}`} onClick={() => startMissionQuest(m)}>
              <Icon name="play" />
            </button>
          )}
        </div>
      ) : (
        <div className="muted small">Elige una misión secundaria, capítulo o evento para esta semana.</div>
      )}
      <Sheet open={pick} onClose={() => setPick(false)} title="Misión de la semana">
        {options.length === 0 && <p className="muted">No hay misiones pendientes. Crea una en Misiones.</p>}
        {options.map((x) => (
          <div key={x.id} className="item">
            <div className="grow">
              <div className="item-title">{x.data.title}</div>
              <div className="row wrap" style={{ gap: 4, marginTop: 3 }}>
                <SizeBadge size={x.data.size} />
                <Badge>{x.kind === 'side' ? 'Secundaria' : x.kind === 'chapter' ? 'Capítulo' : 'Evento'}</Badge>
              </div>
            </div>
            <button
              className="btn sm"
              onClick={() => {
                addEvent('weekly.selected', { missionId: x.id });
                setPick(false);
              }}
            >
              Elegir
            </button>
          </div>
        ))}
      </Sheet>
    </div>
  );
}

function GoalSheet({ onClose }: { onClose: () => void }) {
  const { state } = useGame();
  const [v, setV] = useState(String(state.settings.monthlyGoal));
  return (
    <Sheet
      open
      onClose={onClose}
      title="Meta mensual"
      actions={
        <button
          className="btn primary"
          disabled={!(Number(v) > 0)}
          onClick={() => {
            updateSettings(state.settings, { monthlyGoal: Number(v) });
            onClose();
          }}
        >
          Guardar
        </button>
      }
    >
      <Field label={`Meta de ingreso mensual (${state.settings.currency})`}>
        <input className="input" type="number" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} />
      </Field>
    </Sheet>
  );
}

export function MoneySheet({ kind, onClose }: { kind: 'income' | 'expense'; onClose: () => void }) {
  const { state } = useGame();
  const [amount, setAmount] = useState('');
  const [concept, setConcept] = useState('');
  const [category, setCategory] = useState('');
  const [date, setDate] = useState(state.today);
  const ref = useAutoFocus<HTMLInputElement>();
  const ok = Number(amount) > 0 && date <= state.today;
  const save = () => {
    if (!ok) return;
    const payload = { amount: Number(amount), concept: concept.trim(), category: category.trim() || undefined };
    if (kind === 'income') addEvent('income.recorded', payload, { localDate: date });
    else addEvent('expense.recorded', payload, { localDate: date });
    toast(kind === 'income' ? 'Ingreso registrado' : 'Gasto registrado');
    onClose();
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={kind === 'income' ? 'Registrar ingreso' : 'Registrar gasto'}
      actions={
        <button className="btn primary" disabled={!ok} onClick={save}>
          Guardar
        </button>
      }
    >
      <p className="tiny muted" style={{ marginTop: 0 }}>
        El dinero real y la XP son sistemas separados: registrar dinero no da XP.
      </p>
      <Field label={`Monto (${state.settings.currency})`}>
        <input ref={ref} className="input" type="number" inputMode="decimal" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Concepto">
        <input className="input" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder={kind === 'income' ? 'Cliente, proyecto…' : 'Renta, herramienta…'} />
      </Field>
      <div className="grid2">
        <Field label="Categoría (opcional)">
          <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} />
        </Field>
        <Field label="Fecha">
          <input className="input" type="date" value={date} max={state.today} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}

function RecurringDefeatSheet({ initialBossId, onClose }: { initialBossId?: string; onClose: () => void }) {
  const { list } = useGame();
  const bosses = list<RecurringBossData>('bosses', 'recurring');
  const [bossId, setBossId] = useState(initialBossId ?? bosses[0]?.id ?? '');
  const [note, setNote] = useState('');
  const boss = bosses.find((b) => b.id === bossId);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Superé un reto recurrente"
      actions={
        <button
          className="btn primary"
          disabled={!bossId || note.trim().length < 1}
          onClick={() => {
            addEvent('boss.recurring_defeated', { bossId, note: note.trim() });
            onClose();
          }}
        >
          Registrar (+{GAME_CONFIG.rewards.recurringBoss} XP)
        </button>
      }
    >
      <Field label="Reto">
        <select className="input" value={bossId} onChange={(e) => setBossId(e.target.value)}>
          {bosses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.data.name}
            </option>
          ))}
        </select>
      </Field>
      {boss && <p className="small muted">Se supera con: {boss.data.defeatCondition}</p>}
      <Field label="Evidencia (la decisión, lo que entregaste…)">
        <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Sheet>
  );
}
