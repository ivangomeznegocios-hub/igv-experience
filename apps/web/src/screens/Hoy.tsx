import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ATTRIBUTE_NAMES,
  GAME_CONFIG,
  addDays,
  goldFor,
  frequentMissions,
  isDailyDone,
  isInRoutine,
  pickForDate,
  quickMissionId,
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
import { closeDay, completeGenerated, completeMission, completeQuick, completeTodo, isDone, saveTodo, uncomplete, updateSettings } from '../lib/actions';
import { bossHpPercent, buildDailyBriefing, localHour, pickDailyEncounter } from '../lib/narrator';
import { fmtDate, fmtMoney, fmtWeekday } from '../lib/time';
import { getPrefs, setPrefs } from '../lib/prefs';
import { BossArt, BossHpBar } from '../ui/BossArt';
import { Hero } from '../ui/Hero';
import { Icon } from '../ui/icons';
import { AttrBadge, Badge, Bar, Chips, Collapse, Empty, Field, Sheet, SizeBadge, SwipeRow, Tabs, confirmAction, toast, undoToast, useAutoFocus, TextInput, TextArea } from '../ui/kit';
import { LessonForm } from '../ui/MissionForm';
import { PeopleTodayCard } from '../ui/people';
import { startMissionQuest, startQuest, startTodoQuest } from '../ui/QuestMode';
import { openQuickAdd } from '../ui/QuickAdd';
import { SyncPill } from '../ui/SyncPill';
import { openPlanSheet } from '../ui/DayPlan';
import { DayCard } from '../ui/DayRing';
import { openDayDeck } from '../ui/DayDeck';
import { openDayResult } from '../ui/DayResult';
import { NextPlayCard } from '../ui/NextPlay';
import { TodayTiles } from '../ui/TodayTiles';
import { CityCard } from '../ui/CityCard';
import { WeekPaceCard } from '../ui/WeekPace';
import { WeekShareCard } from '../ui/WeekShare';
import { DayReviewRow } from '../ui/DayReview';
import { HabitsHighlight } from '../ui/HabitBits';
import { CoachCard } from '../ui/coach/CoachCard';

type MesaTab = 'hoy' | 'ciudad' | 'semana' | 'todo';

function useWide(query = '(min-width: 1100px)') {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const f = () => setWide(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [query]);
  return wide;
}

/**
 * Hoy = la mesa: el anillo del día, la siguiente jugada y lo que te toca, a la vista. Lo demás va en pestañas
 * (celular) o en columnas (computadora), para que abrir la app sea jugar y no recorrer una lista.
 */
export default function Hoy() {
  const { state } = useGame();
  const wide = useWide();
  const [tab, setTab] = useState<MesaTab>('hoy');
  const [lesson, setLesson] = useState(false);
  const [recurring, setRecurring] = useState<{ open: boolean; bossId?: string }>({ open: false });

  const dayExtras = (
    <>
      {!state.days.start && <MorningRitualCard />}
      <HeadsUpCard />
      <BountyCard />
      <AgendaCard />
      <CampfireCard />
    </>
  );
  const week = (
    <>
      <WeekReportCard />
      <WeekPaceCard />
      <WeeklyCard />
      <HabitsHighlight />
      <ActiveBossCard />
    </>
  );
  const all = (
    <>
      <NarratorBriefing />
      <DayReviewRow />
      <DailyEncounterCard onDefeatRecurring={(bossId) => setRecurring({ open: true, bossId })} />
      <NpcMissions />
      <PeopleTodayCard />
      <FavoritesSection />
      <VicesMini />
      <Hero />
      <div className="grid2" style={{ marginTop: 10, marginBottom: 12 }}>
        <button className="btn block" onClick={() => setLesson(true)}>
          <Icon name="feather" /> Escribir lección
        </button>
        <button className="btn block" onClick={() => setRecurring({ open: true })}>
          <Icon name="flag" /> Superé un reto
        </button>
      </div>
    </>
  );

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

      {wide ? (
        <div className="mesa">
          <div className="mesa-col left">
            <DayCard />
            <NextPlayCard />
            <CoachCard compact />
            {dayExtras}
          </div>
          <div className="mesa-col">
            <CityCard />
            <TodayTiles />
            {all}
          </div>
          <div className="mesa-col">
            <div className="mesa-col-title">Tu semana</div>
            {week}
          </div>
        </div>
      ) : (
        <>
          <DayCard />
          <NextPlayCard />
          <CoachCard compact />
          <TodayTiles />
          <div className="mesa-tabs">
            <Tabs
              value={tab}
              onChange={setTab}
              options={[
                { value: 'hoy', label: 'Hoy' },
                ...(state.city.start ? [{ value: 'ciudad' as const, label: 'Ciudad' }] : []),
                { value: 'semana', label: 'Semana' },
                { value: 'todo', label: 'Todo' },
              ]}
            />
          </div>
          {tab === 'hoy' && dayExtras}
          {tab === 'ciudad' && <CityCard />}
          {tab === 'semana' && week}
          {tab === 'todo' && all}
        </>
      )}

      {lesson && <LessonForm open onClose={() => setLesson(false)} />}
      {recurring.open && <RecurringDefeatSheet initialBossId={recurring.bossId} onClose={() => setRecurring({ open: false })} />}
    </>
  );
}

function BirthDatePrompt() {
  const { state, store } = useGame();
  const [date, setDate] = useState('');
  const [dismissed, setDismissed] = useState(() => !!getPrefs().welcomeDismissed);
  if (!store.ready || state.settings.birthDate || dismissed) return null;
  return (
    <Sheet
      open
      onClose={() => {
        setPrefs({ welcomeDismissed: true });
        setDismissed(true);
      }}
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

function FavoritesSection() {
  const { state, events, list } = useGame();
  // La rutina ya está en su tarjeta: tampoco se repite como "Hice algo" con el mismo título (contaría doble).
  const routineIds = new Set(list<MissionData>('missions', 'daily').filter((m) => isInRoutine(m.data, weekday(state.today))).flatMap((m) => [m.id, quickMissionId(m.data.title)]));
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
          // Un "Hice algo" con el título de una diaria es esa diaria: se marca una sola vez (no cuenta doble).
          const d = dailies.find((x) => x.id === f.missionId || quickMissionId(x.data.title) === f.missionId);
          const doneId = [f.missionId, d?.id, d && quickMissionId(d.data.title)].find((id): id is string => !!id && doneToday.has(id));
          const done = !!doneId;
          return (
            <button
              key={f.missionId}
              className={`fav ${done ? 'done' : ''}`}
              onClick={() => {
                if (doneId) return uncomplete(doneId, state.today, f.title);
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
  if (!due.length && !doneToday.length) return null;
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
  const bonusGold = goldFor({ amount: b.bonus }, GAME_CONFIG.gold.xpPerGold);
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
            {b.completed
              ? `¡Cumplida! Ganaste +${b.bonus} XP extra${bonusGold ? ` y +${bonusGold} de oro` : ''}.`
              : `Complétala hoy para cobrar +${b.bonus} XP extra${bonusGold ? ` y +${bonusGold} de oro` : ''}.`}
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
  const closed = state.dayClosures[state.today];
  const evening = localHour() >= 18;
  if (!evening && !closed && state.xp.today === 0) return null;
  return (
    <button
      className={`card close-day campfire-card ${evening && !closed ? 'glow' : ''}`}
      onClick={() => (closed ? openDayResult(state.today) : openDayDeck({ date: state.today, closeOnly: true }))}
    >
      <div className="campfire-icon">
        <Icon name="campfire" width={24} height={24} />
      </div>
      <div className="grow" style={{ textAlign: 'left' }}>
        <div className="eyebrow" style={{ color: 'var(--flame)' }}>
          Cierre del día
        </div>
        <b>{closed ? 'Día cerrado' : 'Cierra tu día'}</b>
        <div className="tiny muted">{closed ? closed.note || 'Toca para ver tu resultado' : `Hoy: +${state.xp.today} XP · +${state.gold.earnedToday} oro · racha ${state.streak.current}d`}</div>
      </div>
      <Icon name="right" width={18} />
    </button>
  );
}

/** Avisos de hoy que vienen de otras áreas: cumpleaños y chequeos que ya te tocan (solo si hay). */
function HeadsUpCard() {
  const { state, byId } = useGame();
  const name = (id: string) => (byId.get(id)?.data as { name?: string } | undefined)?.name ?? 'Alguien';
  const items: { key: string; to: string; icon: string; text: string; sub: string }[] = [];
  for (const b of state.npcs.birthdays.filter((x) => x.inDays === 0))
    items.push({ key: `b-${b.npcId}`, to: `/npcs/${b.npcId}`, icon: 'cake', text: `Hoy cumple ${name(b.npcId)}`, sub: b.turns ? `${b.turns} años · escríbele o llámale` : 'Escríbele o llámale' });
  for (const d of state.health.due.filter((x) => x.status === 'atrasado' || x.daysLeft <= 7).slice(0, 2))
    items.push({
      key: `h-${d.checkupId}`,
      to: '/salud',
      icon: 'salud-cross',
      text: `Ya te toca: ${d.name}`,
      sub: d.status === 'atrasado' ? `Atrasado desde ${fmtDate(d.nextDue)} · agéndalo` : `Toca el ${fmtDate(d.nextDue)}`,
    });
  if (!items.length) return null;
  return (
    <div className="card">
      {items.map((it) => (
        <Link key={it.key} to={it.to} className="item" style={{ textDecoration: 'none', color: 'inherit', gap: 10 }}>
          <Icon name={it.icon} width={20} style={{ color: 'var(--gold)', flex: 'none' }} />
          <div className="grow">
            <div className="item-title">{it.text}</div>
            <div className="tiny muted">{it.sub}</div>
          </div>
          <Icon name="right" width={16} />
        </Link>
      ))}
    </div>
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
        <TextInput className="input" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder={kind === 'income' ? 'Cliente, proyecto…' : 'Renta, herramienta…'} />
      </Field>
      <div className="grid2">
        <Field label="Categoría (opcional)">
          <TextInput className="input" value={category} onChange={(e) => setCategory(e.target.value)} />
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
        <TextArea className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Sheet>
  );
}
