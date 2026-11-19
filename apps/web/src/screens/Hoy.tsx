import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ATTRIBUTE_NAMES,
  GAME_CONFIG,
  addDays,
  frequentMissions,
  isInRoutine,
  pickForDate,
  weekStart,
  weekday,
  type AttributeId,
  type Entity,
  type MissionData,
  type MissionSize,
  type RecurringBossData,
  type TodoData,
  type ViceData,
} from '@igv/core';
import { addEvent, useGame, voidEvent } from '../data/store';
import { completeGenerated, completeMission, completeQuick, completeTodo, isDone, saveTodo, uncomplete, updateSettings } from '../lib/actions';
import { TZ, fmtDate, fmtMoney, fmtWeekday } from '../lib/time';
import { Hero } from '../ui/Hero';
import { Badge, Bar, Chips, Empty, Field, Sheet, SizeBadge, AttrBadge, SwipeRow, confirmAction, toast, undoToast, useAutoFocus } from '../ui/kit';
import { Icon } from '../ui/icons';
import { LessonForm } from '../ui/MissionForm';
import { openQuickAdd } from '../ui/QuickAdd';
import { SyncPill } from '../ui/SyncPill';

export default function Hoy() {
  const { state } = useGame();
  const [lesson, setLesson] = useState(false);
  const [recurring, setRecurring] = useState(false);
  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">
            {fmtWeekday(state.today)} {fmtDate(state.today, true)}
            {state.seasons.current && ` · T${state.seasons.current.data.number} semana ${state.seasons.currentWeek}`}
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
          <Link to="/personaje" className="btn sm violet">
            Calificar
          </Link>
        </div>
      )}
      <Hero />
      <div className="grid2" style={{ marginBottom: 12 }}>
        <EnergyCard />
        <StreakCard />
      </div>
      <WeekReportCard />
      <BountyCard />
      <RoutineCard />
      <AgendaCard />
      <FavoritesCard />
      <NpcMissions />
      <WeeklyCard />
      <DragonCard />
      <VicesMini />
      <CloseDayCard />
      <div className="grid2">
        <button className="btn block" onClick={() => setLesson(true)}>
          <Icon name="feather" /> Escribir lección
        </button>
        <button className="btn block" onClick={() => setRecurring(true)}>
          <Icon name="skull" /> Vencí a un jefe
        </button>
      </div>
      {lesson && <LessonForm open onClose={() => setLesson(false)} />}
      {recurring && <RecurringDefeatSheet onClose={() => setRecurring(false)} />}
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

function EnergyCard() {
  const { state } = useGame();
  const [custom, setCustom] = useState('');
  const e = state.energy;
  if (e.value === null) {
    const log = (h: number) => addEvent('checkin.morning', { sleepHours: h });
    return (
      <div className="card" style={{ marginBottom: 0 }}>
        <div className="eyebrow">Energía · check-in</div>
        <div className="small" style={{ margin: '6px 0 8px' }}>
          ¿Cuánto dormiste?
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          <button className="btn sm" onClick={() => log(5)}>
            ≤5 h
          </button>
          <button className="btn sm" onClick={() => log(6)}>
            6 h
          </button>
          <button className="btn sm" onClick={() => log(7)}>
            7 h+
          </button>
        </div>
        <div className="row" style={{ marginTop: 6, gap: 6 }}>
          <input className="input" style={{ minHeight: 32, padding: '4px 8px' }} type="number" step="0.5" min="0" max="24" placeholder="Horas" value={custom} onChange={(ev) => setCustom(ev.target.value)} />
          <button className="btn sm" disabled={custom === ''} onClick={() => log(Number(custom))}>
            OK
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="eyebrow">Energía</div>
      <div className="stat-big num teal" style={{ margin: '4px 0 6px' }}>
        {e.value}
      </div>
      <Bar value={e.value} max={100} tone={e.low ? 'red' : 'teal'} size="sm" />
      <div className="tiny muted" style={{ marginTop: 6 }}>
        Dormiste {e.sleepHours} h{e.low ? ' · solo misiones chicas y de recuperación' : ''}
      </div>
    </div>
  );
}

function StreakCard() {
  const { state } = useGame();
  const s = state.streak;
  const canRest = !s.todayActive && !s.todayRest && s.restDaysLeftThisWeek > 0;
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="eyebrow">Racha</div>
      <div className="row" style={{ gap: 6, margin: '4px 0 2px' }}>
        <Icon name="flame" className="flame" width={26} height={26} />
        <span className="stat-big num">{s.current}</span>
        <span className="muted small">días</span>
      </div>
      <div className="tiny muted">
        Mejor: {s.best} · {s.todayActive ? `hoy +${s.bonusToday} XP` : s.todayRest ? 'hoy: descanso' : `completa una misión: +${s.bonusToday} XP`}
      </div>
      <button
        className="btn sm block"
        style={{ marginTop: 8 }}
        disabled={!canRest}
        onClick={() => {
          const ev = addEvent('rest_day.marked', {});
          undoToast('Día de descanso marcado. Tu racha está a salvo.', () => voidEvent(ev.id));
        }}
      >
        <Icon name="moon" /> {s.todayRest ? 'Descansando' : `Día de descanso (${s.restDaysLeftThisWeek})`}
      </button>
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
        </div>
      </SwipeRow>
    );
  };
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Rutina de hoy</h2>
          <div className="tiny muted">
            {doneCount}/{routine.length} hechas · toca o desliza → para marcar
          </div>
        </div>
        <Link to="/misiones?tab=daily" className="btn sm ghost">
          Editar
        </Link>
      </div>
      {routine.length > 0 && <Bar value={doneCount} max={routine.length} tone="green" size="sm" />}
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

function FavoritesCard() {
  const { state, events, list } = useGame();
  const routineIds = new Set(list<MissionData>('missions', 'daily').filter((m) => isInRoutine(m.data, weekday(state.today))).map((m) => m.id));
  const favs = useMemo(() => frequentMissions(events, state.today, 60, 12).filter((f) => !routineIds.has(f.missionId)), [events, state.today, routineIds]);
  if (!favs.length) return null;
  const doneToday = new Set(state.missions.completedToday);
  const dailies = list<MissionData>('missions', 'daily');
  return (
    <div className="card">
      <div className="card-head">
        <h2>Un toque</h2>
        <span className="tiny muted">Lo que más registras</span>
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
  // Se sortea una vez al día (y se guarda como evento para que el historial no cambie).
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
          <div className="eyebrow">Misión sorpresa del día</div>
          <div className="item-title">{b.title}</div>
          <div className="tiny muted">
            {b.completed ? `¡Cumplida! Ganaste +${b.bonus} XP de bono.` : `Hazla hoy: XP normal + ${b.bonus} XP de bono (${GAME_CONFIG.bounty.bonusPercent}%).`}
          </div>
        </div>
        {!b.completed && m && (
          <button className="btn sm primary" onClick={() => completeMission(m)}>
            Hecha
          </button>
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
    <Link to="/enemigos" className="card vices-mini" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
      <div className="card-head" style={{ marginBottom: 6 }}>
        <h2>Enemigos a raya</h2>
        <Icon name="right" width={18} className="muted" />
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        {vices.map((v) => (
          <span key={v.id} className="badge">
            {v.data.name}: <b className="num" style={{ color: 'var(--text)' }}>{state.vices[v.id]?.current ?? 0}</b> días
          </span>
        ))}
      </div>
    </Link>
  );
}

function WeekReportCard() {
  const { state } = useGame();
  const wd = weekday(state.today);
  // Domingo y lunes: invitar a ver el reporte de la semana (el lunes, el de la semana pasada).
  if (wd !== 6 && wd !== 0) return null;
  const target = wd === 0 ? addDays(state.today, -7) : state.today;
  return (
    <Link to={`/reporte?semana=${weekStart(target)}`} className="banner" style={{ textDecoration: 'none', color: 'inherit' }}>
      <Icon name="scroll" width={20} />
      <span>
        <b>Reporte de batalla</b> de {wd === 0 ? 'la semana pasada' : 'esta semana'} listo.
      </span>
      <span className="btn sm">Ver</span>
    </Link>
  );
}

function localHour(): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
}

function CloseDayCard() {
  const { state } = useGame();
  const [open, setOpen] = useState(false);
  const closed = state.dayClosures[state.today];
  const evening = localHour() >= 18;
  if (!evening && !closed && state.xp.today === 0) return null;
  return (
    <>
      <button className={`card close-day ${evening && !closed ? 'glow' : ''}`} onClick={() => setOpen(true)}>
        <Icon name={closed ? 'moon' : 'sun'} width={22} />
        <div className="grow" style={{ textAlign: 'left' }}>
          <b>{closed ? 'Día cerrado' : 'Cerrar el día'}</b>
          <div className="tiny muted">{closed ? closed.note || 'Ver resumen' : `Hoy: +${state.xp.today} XP · racha ${state.streak.current}`}</div>
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
            toast('Día cerrado. Descansa, mañana seguimos.');
            onClose();
          }}
        >
          {prev ? 'Actualizar' : 'Cerrar el día'}
        </button>
      }
    >
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
            <Badge key={a} tone="violet">
              {ATTRIBUTE_NAMES[a as AttributeId]} +{x}
            </Badge>
          ))}
          {state.gold.earnedToday > 0 && <Badge tone="gold">+{state.gold.earnedToday} oro</Badge>}
        </div>
      )}
      {entries.length === 0 && <p className="small muted">Hoy no registraste XP. Si fue día de descanso, márcalo desde el botón +.</p>}
      <Field label="¿Cómo te sentiste?">
        <Chips value={mood} onChange={setMood} size="lg" options={MOODS.map((m, i) => ({ value: i + 1, label: m }))} />
      </Field>
      <Field label="Una línea sobre hoy">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Lo mejor del día, lo que aprendí…" />
      </Field>
      <p className="tiny muted">El cierre del día no da XP: es para ti. Aparece en tu historial y en Mi vida en semanas.</p>
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
        <h2>Tu party te extraña</h2>
        <Link to="/npcs" className="btn sm ghost">
          NPCs
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

function DragonCard() {
  const { state } = useGame();
  const [income, setIncome] = useState(false);
  const [editGoal, setEditGoal] = useState(false);
  const { monthIncome, goal } = state.money;
  const cur = state.settings.currency;
  const dragon = state.bosses.bosses['boss-dragon'];
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="eyebrow">Jefe · ingreso del mes</div>
          <h2>El Dragón Financiero</h2>
        </div>
        <button className="btn sm primary" onClick={() => setIncome(true)}>
          <Icon name="plus" /> Ingreso
        </button>
      </div>
      <Bar
        value={monthIncome}
        max={goal}
        tone="flame"
        size="lg"
        label={
          <>
            <span className="num">
              {fmtMoney(monthIncome, cur)} / {fmtMoney(goal, cur)}
            </span>
            <button className="btn sm ghost" style={{ minHeight: 0, padding: 0, fontSize: 12 }} onClick={() => setEditGoal(true)}>
              {Math.round((monthIncome / Math.max(goal, 1)) * 100)}% · editar meta
            </button>
          </>
        }
      />
      {dragon && (
        <div className="tiny muted" style={{ marginTop: 6 }}>
          Fases vencidas: {dragon.phasesDone}/{dragon.phases.length}
          {dragon.phases.find((p) => !p.done) && ` · siguiente: ${dragon.phases.find((p) => !p.done)!.title}`}
        </div>
      )}
      {income && <MoneySheet kind="income" onClose={() => setIncome(false)} />}
      {editGoal && <GoalSheet onClose={() => setEditGoal(false)} />}
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

function RecurringDefeatSheet({ onClose }: { onClose: () => void }) {
  const { list } = useGame();
  const bosses = list<RecurringBossData>('bosses', 'recurring');
  const [bossId, setBossId] = useState(bosses[0]?.id ?? '');
  const [note, setNote] = useState('');
  const boss = bosses.find((b) => b.id === bossId);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Vencí a un jefe recurrente"
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
      <Field label="Jefe">
        <select className="input" value={bossId} onChange={(e) => setBossId(e.target.value)}>
          {bosses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.data.name}
            </option>
          ))}
        </select>
      </Field>
      {boss && <p className="small muted">Se vence con: {boss.data.defeatCondition}</p>}
      <Field label="Evidencia (la decisión, lo que entregaste…)">
        <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Sheet>
  );
}
