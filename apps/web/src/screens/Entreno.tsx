import { useEffect, useMemo, useState } from 'react';
import {
  EQUIPMENT_NAMES,
  EXERCISE_LIBRARY,
  GAME_CONFIG,
  MUSCLES,
  MUSCLE_IDS,
  RECORD_LABELS,
  RECORD_METRIC,
  WORKOUT_KIND_NAMES,
  WORKOUT_PLACES,
  WORKOUT_PLACE_NAMES,
  addDays,
  monthKey,
  progressSeries,
  trainingAnalysis,
  trainingMission,
  weekStart,
  type Entity,
  type ExerciseData,
  type ExerciseRecord,
  type ExerciseTop,
  type MissionData,
  type MuscleId,
  type MuscleStatus,
  type RoutineData,
  type TrainingAnalysis,
  type Workout,
} from '@igv/core';
import { deleteEntity, useGame } from '../data/store';
import {
  draftExercise,
  draftFromRoutine,
  draftFromSuggestion,
  draftFromWorkout,
  emptyDraft,
  exerciseDef,
  fmtSets,
  openWorkout,
  routineFromWorkout,
  saveRoutine,
  saveTrainingSettings,
  voidWorkout,
} from '../lib/entreno';
import { fmtDate, fmtNum, fmtWeekday } from '../lib/time';
import { BarChart, LineChart } from '../ui/charts';
import { BodyMap } from '../ui/BodyMap';
import { Icon } from '../ui/icons';
import { Badge, Bar, Chips, Empty, Field, PageHeader, Sheet, Tabs, confirmAction, toast, TextInput } from '../ui/kit';
import { ExercisePicker, Stepper } from '../ui/quick/WorkoutQuick';
import '../styles/entreno.css';

type Tab = 'semana' | 'historial' | 'records' | 'rutinas';
const TAB_KEY = 'igv-entreno-tab';

function useNow() {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toISOString()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function useAnalysis(): TrainingAnalysis {
  const { state } = useGame();
  const now = useNow();
  return useMemo(() => trainingAnalysis(state.training.summary, now, { custom: Object.values(state.training.custom) }), [state.training, now]);
}

const hoursText = (h: number) => (h < 24 ? `${h} h` : `${Math.floor(h / 24)} d ${h % 24 ? `${h % 24} h` : ''}`.trim());
const ago = (d: number | null) => (d === null ? 'sin registro' : d === 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`);

export function muscleStateText(m: MuscleStatus): string {
  if (m.state === 'recuperando') return `Recuperando · ${Math.round(m.recovery * 100)}% · lista en ${hoursText(m.hoursToReady)}`;
  if (m.state === 'olvidado') return m.lastDate ? `Olvidado · ${ago(m.daysSince)}` : 'Sin registro';
  return `Listo · último ${ago(m.daysSince)}`;
}

/** Entrenamiento: qué trabajaste, qué te falta, cuándo está listo cada músculo y qué sigue. */
export default function Entreno() {
  const [tab, setTabState] = useState<Tab>(() => {
    try {
      return (localStorage.getItem(TAB_KEY) as Tab) || 'semana';
    } catch {
      return 'semana';
    }
  });
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* nada */
    }
  };
  return (
    <>
      <PageHeader
        title="Entrenamiento"
        eyebrow="Cuerpo"
        right={
          <button className="btn sm primary" onClick={() => openWorkout()}>
            <Icon name="dumbbell" /> Entrenar
          </button>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'semana', label: 'Semana' },
          { value: 'historial', label: 'Historial' },
          { value: 'records', label: 'Récords' },
          { value: 'rutinas', label: 'Rutinas' },
        ]}
      />
      {tab === 'semana' && <WeekTab />}
      {tab === 'historial' && <HistoryTab />}
      {tab === 'records' && <RecordsTab />}
      {tab === 'rutinas' && <RoutinesTab />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Semana: mapa, te falta, siguiente sesión, músculos
// ---------------------------------------------------------------------------------------------

function WeekTab() {
  const { state } = useGame();
  const a = useAnalysis();
  const [mode, setMode] = useState<'volumen' | 'recuperacion'>('volumen');
  const [muscle, setMuscle] = useState<MuscleId | null>(null);
  const tc = GAME_CONFIG.training;
  const hasAny = state.training.workouts.length > 0;

  const classes: Partial<Record<MuscleId, string>> = {};
  const titles: Partial<Record<MuscleId, string>> = {};
  for (const id of MUSCLE_IDS) {
    const m = a.muscles[id];
    if (mode === 'volumen') classes[id] = m.volumeLevel ? `v${m.volumeLevel}` : '';
    else classes[id] = m.state === 'recuperando' ? (m.fatigue > 0.66 ? 'rec3' : m.fatigue > 0.33 ? 'rec2' : 'rec1') : m.state === 'listo' ? 'ready' : m.lastDate ? 'forgot' : '';
    titles[id] = `${m.name}: ${Math.round(m.weekSets * 10) / 10} de ${m.target.target} series · ${muscleStateText(m)}`;
  }

  return (
    <>
      <div className="card">
        <h2 style={{ marginBottom: 8 }}>Tu cuerpo esta semana</h2>
        <div className="row" style={{ justifyContent: 'center', marginBottom: 10 }}>
          <Chips
            value={mode}
            onChange={setMode}
            options={[
              { value: 'volumen', label: 'Volumen' },
              { value: 'recuperacion', label: 'Recuperación' },
            ]}
          />
        </div>
        <BodyMap classes={classes} titles={titles} selected={muscle} onSelect={setMuscle} />
        {mode === 'volumen' ? (
          <div className="bm-legend">
            <span>
              <i className="sw-v0" />0
            </span>
            <span>
              <i className="sw-v1" />
              bajo {tc.weeklySets.min}
            </span>
            <span>
              <i className="sw-v2" />
              {tc.weeklySets.min}–{tc.weeklySets.target - 1}
            </span>
            <span>
              <i className="sw-v3" />
              {tc.weeklySets.target}–{tc.weeklySets.max}
            </span>
            <span>
              <i className="sw-v4" />+{tc.weeklySets.max}
            </span>
          </div>
        ) : (
          <div className="bm-legend">
            <span>
              <i className="sw-rec" />
              recuperando
            </span>
            <span>
              <i className="sw-ready" />
              listo
            </span>
            <span>
              <i className="sw-forgot" />
              olvidado {tc.forgottenDays}+ días
            </span>
          </div>
        )}
        <div className="tr-stats">
          <div className="tr-stat">
            <b>{a.sessions}</b>
            <span>Sesiones</span>
          </div>
          <div className="tr-stat">
            <b>{fmtNum(a.hardSets)}</b>
            <span>Series</span>
          </div>
          <div className="tr-stat">
            <b className={a.cardio.minutes >= a.cardio.min ? 'teal' : ''}>{a.cardio.minutes}</b>
            <span>Cardio /{a.cardio.min}</span>
          </div>
          <div className="tr-stat">
            <b className={a.weekStreak ? 'gold' : ''}>{a.weekStreak}</b>
            <span>Sem. seguidas</span>
          </div>
        </div>
      </div>

      {!hasAny ? (
        <div className="card">
          <Empty>Registra tu primer entrenamiento: aquí verás qué músculos trabajaste, cuáles te faltan esta semana y cuándo está listo cada uno.</Empty>
          <button className="btn primary block" onClick={() => openWorkout()}>
            <Icon name="dumbbell" /> Registrar entrenamiento
          </button>
        </div>
      ) : (
        <MissingCard a={a} onMuscle={setMuscle} />
      )}

      <SuggestionCard a={a} />

      <div className="card">
        <div className="card-head">
          <h2>Músculos</h2>
          <span className="tiny muted">series de la semana / meta</span>
        </div>
        {MUSCLE_IDS.map((id) => {
          const m = a.muscles[id];
          return (
            <div key={id} className="mu-row" role="button" tabIndex={0} onClick={() => setMuscle(id)} onKeyDown={(e) => e.key === 'Enter' && setMuscle(id)}>
              <div className="mu-name">
                <span className={`mu-dot ${m.state === 'recuperando' ? 'rec' : m.state === 'listo' ? 'ready' : 'forgot'}`} />
                {m.name}
                {m.accessory && <span className="tiny faint">accesorio</span>}
              </div>
              <div className="mu-bar">
                <div className={`bar ${m.volumeLevel === 4 ? 'over' : ''}`}>
                  <i style={{ width: `${Math.min(100, (m.weekSets / m.target.target) * 100)}%` }} />
                </div>
                <span>
                  {Math.round(m.weekSets * 10) / 10}/{m.target.target}
                </span>
              </div>
              <div className="mu-sub">
                {muscleStateText(m)} · {m.weekDays}× esta semana
              </div>
            </div>
          );
        })}
      </div>
      {muscle && <MuscleSheet id={muscle} a={a} onClose={() => setMuscle(null)} />}
    </>
  );
}

function MissingCard({ a, onMuscle }: { a: TrainingAnalysis; onMuscle: (m: MuscleId) => void }) {
  const tc = GAME_CONFIG.training;
  const list = a.missing.length ? a.missing : a.missingAccessory;
  return (
    <div className="card">
      <div className="card-head">
        <h2>{a.missing.length ? 'Te falta esta semana' : a.missingAccessory.length ? 'Ya cubriste lo principal' : 'Semana cubierta'}</h2>
        <span className="tiny muted">
          {a.daysLeft} {a.daysLeft === 1 ? 'día' : 'días'} para el domingo
        </span>
      </div>
      {list.length > 0 ? (
        <>
          {!a.missing.length && <p className="small muted" style={{ marginTop: 0 }}>Solo quedan accesorios bajo su mínimo:</p>}
          <div className="miss-grid">
            {list.map((m) => (
              <button key={m.id} className="miss" onClick={() => onMuscle(m.id)}>
                <b>{m.name}</b>
                <Bar value={m.weekSets} max={m.target.min} />
                <small>
                  {Math.round(m.weekSets * 10) / 10} de {m.target.min} series · {m.lastDate ? ago(m.daysSince) : 'nunca'}
                </small>
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          Todos tus músculos pasaron el mínimo efectivo. Lo que sigue suma hacia {tc.weeklySets.target}–{tc.weeklySets.max} series.
        </p>
      )}
      {a.balance.notes.map((n) => (
        <div key={n} className="tr-note">
          <Icon name="bolt" /> {n}
        </div>
      ))}
      <div className="tiny faint" style={{ marginTop: 10 }}>
        Meta por músculo: {tc.weeklySets.target}–{tc.weeklySets.max} series duras a la semana (mínimo {tc.weeklySets.min}), {tc.minFrequency}+ veces por semana. Un ejercicio cuenta
        completo para sus músculos principales y la mitad para los secundarios.
      </div>
    </div>
  );
}

function SuggestionCard({ a }: { a: TrainingAnalysis }) {
  const { state } = useGame();
  const sg = a.suggestion;
  return (
    <div className="card sg">
      <div className="eyebrow">Siguiente sesión</div>
      <h2 style={{ margin: '2px 0 4px' }}>{sg.title}</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        {sg.reason}
      </p>
      {sg.exercises.map((e) => (
        <div key={e.exerciseId} className="sg-ex">
          <span className="grow">{e.name}</span>
          <span className="num">
            {sg.split === 'cardio' ? e.reps : `${e.sets} × ${e.reps}`}
          </span>
        </div>
      ))}
      {sg.exercises.length > 0 && (
        <button className="btn primary block" style={{ marginTop: 10 }} onClick={() => openWorkout({ draft: draftFromSuggestion(sg, state) })}>
          <Icon name="play" /> Empezar {sg.title.toLowerCase()}
        </button>
      )}
    </div>
  );
}

function MuscleSheet({ id, a, onClose }: { id: MuscleId; a: TrainingAnalysis; onClose: () => void }) {
  const { state } = useGame();
  const tr = state.training;
  const m = a.muscles[id];
  const info = MUSCLES[id];
  const yours = tr.summary.favorites.map((x) => exerciseDef(x, tr.custom)).filter((e) => e && e.primary.includes(id)).slice(0, 4);
  const library = EXERCISE_LIBRARY.filter((e) => e.primary.includes(id) && e.measure !== 'distancia' && !yours.includes(e)).slice(0, 6);
  const start = (defs: typeof library) => {
    const d = emptyDraft(tr.settings, tr.summary.usualWhere);
    d.exercises = defs.map((def) => draftExercise(def, tr.records));
    onClose();
    openWorkout({ draft: d });
  };
  return (
    <Sheet open onClose={onClose} title={info.name}>
      <p className="small muted" style={{ marginTop: -6 }}>
        {info.anatomy.charAt(0).toUpperCase() + info.anatomy.slice(1)}. Recupera en {info.size === 'grande' ? GAME_CONFIG.training.recoveryHours.grande : GAME_CONFIG.training.recoveryHours.chico} h tras {GAME_CONFIG.training.recoveryMinSets}+ series
        duras.
      </p>
      <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
        <Badge tone={m.state === 'recuperando' ? 'flame' : m.state === 'listo' ? 'green' : 'red'}>{muscleStateText(m)}</Badge>
        <Badge>{m.weekDays}× esta semana</Badge>
        {m.accessory && <Badge>Accesorio</Badge>}
      </div>
      <Field label={`Series duras esta semana: ${Math.round(m.weekSets * 10) / 10} (meta ${m.target.target}–${m.target.max}, mínimo ${m.target.min})`}>
        <Bar value={m.weekSets} max={m.target.target} tone={m.volumeLevel === 4 ? 'flame' : 'teal'} />
      </Field>
      <div className="tiny muted" style={{ marginTop: -4, marginBottom: 12 }}>
        Últimos 7 días: {Math.round(m.last7Sets * 10) / 10} series.{m.need > 0 ? ` Te faltan ${m.need} para la meta.` : ' Meta cumplida.'}
      </div>
      {yours.length > 0 && (
        <>
          <div className="eyebrow">Lo que más usas</div>
          {yours.map((e) => (
            <div key={e!.id} className="sg-ex">
              <span className="grow">{e!.name}</span>
              <span className="num">{tr.records[e!.id] ? fmtSets(tr.records[e!.id].lastSets) : ''}</span>
            </div>
          ))}
        </>
      )}
      <div className="eyebrow" style={{ marginTop: 10 }}>
        Ejercicios para {info.name.toLowerCase()}
      </div>
      {library.map((e) => (
        <div key={e.id} className="sg-ex">
          <span className="grow">
            {e.name} <span className="tiny muted">· {EQUIPMENT_NAMES[e.equipment]}</span>
          </span>
          <button className="btn sm ghost" onClick={() => start([e])} aria-label={`Entrenar con ${e.name}`}>
            <Icon name="plus" />
          </button>
        </div>
      ))}
      <button className="btn primary block" style={{ marginTop: 12 }} disabled={m.state === 'recuperando'} onClick={() => start([...(yours as typeof library), ...library].slice(0, 2))}>
        <Icon name="dumbbell" /> {m.state === 'recuperando' ? `Lista en ${hoursText(m.hoursToReady)}` : `Entrenar ${info.name.toLowerCase()}`}
      </button>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------
// Historial
// ---------------------------------------------------------------------------------------------

function HistoryTab() {
  const { state } = useGame();
  const [n, setN] = useState(30);
  const [open, setOpen] = useState<Workout | null>(null);
  const ws = state.training.workouts;
  const weeks = useMemo(() => {
    const cur = weekStart(state.today);
    return Array.from({ length: 10 }, (_, i) => {
      const start = addDays(cur, -7 * (9 - i));
      const end = addDays(start, 6);
      const inWeek = ws.filter((w) => w.date >= start && w.date <= end);
      return { label: fmtDate(start), value: Math.round(inWeek.reduce((t, w) => t + w.hardSets, 0)), sessions: inWeek.length };
    });
  }, [ws, state.today]);
  const items = [...ws].reverse();
  if (!ws.length)
    return (
      <div className="card">
        <Empty>Aún no hay entrenamientos.</Empty>
        <button className="btn primary block" onClick={() => openWorkout()}>
          <Icon name="dumbbell" /> Registrar entrenamiento
        </button>
      </div>
    );
  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>Series duras por semana</h2>
          <span className="tiny muted">{weeks.at(-1)!.sessions} sesiones esta semana</span>
        </div>
        <BarChart data={weeks} color="var(--teal)" format={(v) => `${v} series`} />
      </div>
      <div className="card">
        {items.slice(0, n).map((w) => {
          const top = (Object.entries(w.muscleSets) as [MuscleId, number][])
            .sort((x, y) => y[1] - x[1])
            .slice(0, 3)
            .map(([m]) => MUSCLES[m].name);
          return (
            <div key={w.eventId} className="wk-item" role="button" tabIndex={0} onClick={() => setOpen(w)} onKeyDown={(e) => e.key === 'Enter' && setOpen(w)}>
              <div className="wk-date">
                <b>{Number(w.date.slice(8))}</b>
                <span>{fmtWeekday(w.date).slice(0, 3)}</span>
              </div>
              <div className="grow">
                <div className="item-title">
                  {w.title} {w.records.length > 0 && <Badge tone="gold">Récord</Badge>}
                </div>
                <div className="tiny muted">
                  {[WORKOUT_KIND_NAMES[w.kind], w.where ? WORKOUT_PLACE_NAMES[w.where] : '', w.minutes ? `${w.minutes} min` : '', w.hardSets ? `${w.hardSets} series` : '', w.cardioMinutes ? `${w.cardioMinutes} min de cardio` : '']
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {top.length > 0 && <div className="tiny faint">{top.join(', ')}</div>}
              </div>
              <Icon name="right" width={16} className="faint" />
            </div>
          );
        })}
        {items.length > n && (
          <button className="btn block sm" style={{ marginTop: 8 }} onClick={() => setN((x) => x + 30)}>
            Ver más
          </button>
        )}
      </div>
      {open && <WorkoutDetail w={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function WorkoutDetail({ w, onClose }: { w: Workout; onClose: () => void }) {
  const { state } = useGame();
  const [naming, setNaming] = useState<string | null>(null);
  const muscles = (Object.entries(w.muscleSets) as [MuscleId, number][]).filter(([, s]) => s >= 1).sort((x, y) => y[1] - x[1]);
  return (
    <Sheet open onClose={onClose} title={w.title}>
      <div className="row wrap" style={{ gap: 6, marginTop: -6, marginBottom: 10 }}>
        <Badge>{fmtDate(w.date, true)}</Badge>
        <Badge>{WORKOUT_KIND_NAMES[w.kind]}</Badge>
        {w.where && <Badge>{WORKOUT_PLACE_NAMES[w.where]}</Badge>}
        {w.minutes && <Badge>{w.minutes} min</Badge>}
        {w.rpe && <Badge>Esfuerzo {w.rpe}/10</Badge>}
      </div>
      {w.source === 'cuerpo' && <p className="small muted">Registrado en Cuerpo como texto, sin ejercicios: cuenta como sesión pero no suma series por músculo.</p>}
      {w.note && <p className="small">{w.note}</p>}
      {w.exercises.map((x, i) => (
        <div key={i} className="sg-ex">
          <span className="grow">
            {x.name} {w.records.includes(x.exerciseId) && <Badge tone="gold">Récord</Badge>}
            <div className="tiny muted">{fmtSets(x.sets)}</div>
          </span>
        </div>
      ))}
      {muscles.length > 0 && (
        <>
          <div className="eyebrow" style={{ marginTop: 10 }}>
            Series por músculo
          </div>
          <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
            {muscles.map(([m, s]) => (
              <Badge key={m} tone="teal">
                {MUSCLES[m].name} {Math.round(s * 10) / 10}
              </Badge>
            ))}
          </div>
        </>
      )}
      {naming !== null ? (
        <div className="row" style={{ gap: 6, marginTop: 14 }}>
          <TextInput className="input grow" value={naming} autoFocus maxLength={120} placeholder="Nombre de la rutina" onChange={(e) => setNaming(e.target.value)} />
          <button
            className="btn primary"
            disabled={!naming.trim()}
            onClick={() => {
              saveRoutine(routineFromWorkout(naming, w));
              toast('Rutina guardada');
              setNaming(null);
            }}
          >
            Guardar
          </button>
        </div>
      ) : (
        w.source === 'entreno' && (
          <div className="row wrap" style={{ gap: 6, marginTop: 14 }}>
            {w.exercises.length > 0 && (
              <button
                className="btn sm"
                onClick={() => {
                  onClose();
                  openWorkout({ draft: draftFromWorkout(w) });
                }}
              >
                <Icon name="refresh" /> Repetir
              </button>
            )}
            {w.exercises.length > 0 && (
              <button className="btn sm" onClick={() => setNaming(w.title)}>
                <Icon name="list" /> Guardar como rutina
              </button>
            )}
            <button
              className="btn sm ghost danger"
              onClick={() => {
                if (!confirmAction('¿Anular este entrenamiento? Si fue el único del día, también se anula su misión.')) return;
                voidWorkout(w, state);
                onClose();
              }}
            >
              <Icon name="trash" /> Anular
            </button>
          </div>
        )
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------
// Récords
// ---------------------------------------------------------------------------------------------

const UNITS: Record<keyof ExerciseTop, string> = { e1rm: 'kg', kg: 'kg', reps: 'reps', volume: 'kg', sec: 's', km: 'km', min: 'min', pace: 'min/km' };
const fmtVal = (k: keyof ExerciseTop, v: number) => `${Math.round(v * 10) / 10} ${UNITS[k]}`;

function mainRecord(r: ExerciseRecord): string {
  const b = r.best;
  if (r.measure === 'peso') return [b.e1rm ? `1RM ≈ ${fmtVal('e1rm', b.e1rm.value)}` : '', b.kg ? `máx. ${fmtVal('kg', b.kg.value)}` : ''].filter(Boolean).join(' · ') || 'sin peso registrado';
  if (r.measure === 'corporal') return b.reps ? `${b.reps.value} reps en una serie` : '';
  if (r.measure === 'tiempo') return b.sec ? `${b.sec.value} s` : '';
  return [b.km ? fmtVal('km', b.km.value) : '', b.pace ? `ritmo ${fmtVal('pace', b.pace.value)}` : '', !b.km && b.min ? fmtVal('min', b.min.value) : ''].filter(Boolean).join(' · ');
}

function RecordsTab() {
  const { state } = useGame();
  const [open, setOpen] = useState<ExerciseRecord | null>(null);
  const recs = Object.values(state.training.records).sort((a, b) => (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : b.sessions - a.sessions));
  const month = monthKey(state.today);
  const prMonth = state.xp.ledger.filter((e) => e.source === 'training_record' && monthKey(e.date) === month);
  if (!recs.length)
    return (
      <div className="card">
        <Empty>Tus récords aparecen al registrar ejercicios con sus series. Superar tu mejor marca de un ejercicio da +{GAME_CONFIG.missionXp[GAME_CONFIG.training.record.size]} XP.</Empty>
      </div>
    );
  return (
    <>
      <div className="card">
        <div className="row between">
          <div>
            <div className="eyebrow">Récords este mes</div>
            <div className="stat-big num gold">{prMonth.length}</div>
          </div>
          <div className="tiny muted" style={{ maxWidth: 190, textAlign: 'right' }}>
            Superar tu mejor marca (1RM estimado, reps, tiempo o distancia) da +{GAME_CONFIG.missionXp[GAME_CONFIG.training.record.size]} XP, hasta {GAME_CONFIG.training.record.maxPerDay} por día.
          </div>
        </div>
      </div>
      <div className="card">
        {recs.map((r) => {
          const k = RECORD_METRIC[r.measure];
          const fresh = r.best[k] && r.best[k]!.date >= addDays(state.today, -6) && r.sessions > 1;
          return (
            <div key={r.exerciseId} className="wk-item" role="button" tabIndex={0} onClick={() => setOpen(r)} onKeyDown={(e) => e.key === 'Enter' && setOpen(r)}>
              <div className="grow">
                <div className="item-title">
                  {r.name} {fresh && <Badge tone="gold">Nuevo</Badge>}
                </div>
                <div className="tiny muted">{mainRecord(r)}</div>
                <div className="tiny faint">
                  {r.sessions} {r.sessions === 1 ? 'sesión' : 'sesiones'} · última {fmtDate(r.lastDate)}
                </div>
              </div>
              <Icon name="right" width={16} className="faint" />
            </div>
          );
        })}
      </div>
      {open && <ExerciseSheet r={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function ExerciseSheet({ r, onClose }: { r: ExerciseRecord; onClose: () => void }) {
  const { state } = useGame();
  const series = progressSeries(r);
  const metric = r.measure === 'peso' ? '1RM estimado (kg)' : r.measure === 'corporal' ? 'repeticiones' : r.measure === 'tiempo' ? 'segundos' : 'kilómetros';
  const byEvent = new Map(state.training.workouts.map((w) => [w.eventId, w]));
  const def = exerciseDef(r.exerciseId, state.training.custom);
  return (
    <Sheet open onClose={onClose} title={r.name}>
      {def && def.measure !== 'distancia' && (
        <p className="small muted" style={{ marginTop: -6 }}>
          {def.primary.map((m) => MUSCLES[m].name).join(', ')}
          {def.secondary.length ? ` · secundarios: ${def.secondary.map((m) => MUSCLES[m].name.toLowerCase()).join(', ')}` : ''}
        </p>
      )}
      {series.length > 1 ? (
        <>
          <div className="eyebrow">Progreso · {metric}</div>
          <LineChart points={series.slice(-30).map((p) => ({ label: fmtDate(p.date), value: p.value }))} format={(n) => `${Math.round(n * 10) / 10}`} />
        </>
      ) : (
        <p className="small muted">Registra este ejercicio otra vez para ver tu progreso.</p>
      )}
      <div className="eyebrow" style={{ marginTop: 10 }}>
        Mejores marcas
      </div>
      {(Object.entries(r.best) as [keyof ExerciseTop, { value: number; date: string }][]).map(([k, v]) => (
        <div key={k} className="sg-ex">
          <span className="grow">{RECORD_LABELS[k]}</span>
          <span className="num">
            <b>{fmtVal(k, v.value)}</b> · {fmtDate(v.date)}
          </span>
        </div>
      ))}
      <div className="eyebrow" style={{ marginTop: 10 }}>
        Últimas sesiones
      </div>
      {[...r.history]
        .reverse()
        .slice(0, 6)
        .map((h) => {
          const sets = byEvent.get(h.eventId)?.exercises.filter((x) => x.exerciseId === r.exerciseId).flatMap((x) => x.sets) ?? [];
          return (
            <div key={h.eventId} className="sg-ex">
              <span className="grow tiny">{fmtDate(h.date, true)}</span>
              <span className="num tiny">{fmtSets(sets)}</span>
            </div>
          );
        })}
      <button
        className="btn primary block"
        style={{ marginTop: 12 }}
        onClick={() => {
          const d = emptyDraft(state.training.settings, state.training.summary.usualWhere);
          if (def) d.exercises = [draftExercise(def, state.training.records)];
          onClose();
          openWorkout({ draft: d });
        }}
      >
        <Icon name="dumbbell" /> Entrenar {r.name.toLowerCase()}
      </button>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------
// Rutinas y ajustes
// ---------------------------------------------------------------------------------------------

function RoutinesTab() {
  const { state, list } = useGame();
  const [editing, setEditing] = useState<Entity<RoutineData> | 'new' | null>(null);
  const routines = list<RoutineData>('training', 'routine');
  const custom = list<ExerciseData>('training', 'exercise');
  const dailies = list<MissionData>('missions', 'daily');
  const settings = state.training.settings;
  const mission = trainingMission(settings, dailies);
  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>Rutinas</h2>
          <button className="btn sm" onClick={() => setEditing('new')}>
            <Icon name="plus" /> Nueva
          </button>
        </div>
        {routines.length === 0 && <Empty>Guarda una rutina desde un entrenamiento ("Guardar como rutina") o crea una nueva: luego la empiezas con un toque.</Empty>}
        {routines.map((r) => (
          <div key={r.id} className="wk-item" style={{ alignItems: 'center' }}>
            <div className="grow" role="button" tabIndex={0} onClick={() => setEditing(r)} onKeyDown={(e) => e.key === 'Enter' && setEditing(r)}>
              <div className="item-title">{r.data.name}</div>
              <div className="tiny muted">{r.data.exercises.map((e) => `${e.name} ${e.sets}×`).join(' · ') || 'Sin ejercicios'}</div>
            </div>
            <button className="btn sm primary" onClick={() => openWorkout({ draft: draftFromRoutine(r, state) })} aria-label={`Empezar ${r.data.name}`}>
              <Icon name="play" />
            </button>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Ajustes</h2>
        <Field label="Al guardar un entrenamiento, cuenta como">
          <select className="input" value={mission.kind === 'daily' ? mission.missionId : ''} onChange={(e) => saveTrainingSettings(settings, { missionId: e.target.value || null })}>
            <option value="">Entrenar (misión rápida · media · {GAME_CONFIG.missionXp.media} XP)</option>
            {dailies.map((d) => (
              <option key={d.id} value={d.id}>
                {d.data.title} (diaria · {GAME_CONFIG.missionXp[d.data.size]} XP)
              </option>
            ))}
          </select>
        </Field>
        <p className="tiny muted" style={{ marginTop: -6 }}>
          Ahora: "{mission.title}". La XP, la racha y el oro salen de esa misión (una vez por día); un récord personal suma aparte.
        </p>
        <Field label="Dónde entrenas normalmente">
          <Chips value={settings.where ?? null} onChange={(w) => saveTrainingSettings(settings, { where: settings.where === w ? null : w })} options={WORKOUT_PLACES.map((p) => ({ value: p, label: WORKOUT_PLACE_NAMES[p] }))} />
        </Field>
        <p className="tiny muted" style={{ margin: 0 }}>
          Fuera del gym, la sesión sugerida usa peso corporal, mancuernas, bandas o kettlebell.
        </p>
      </div>

      {custom.length > 0 && (
        <div className="card">
          <h2>Ejercicios propios</h2>
          {custom.map((e) => (
            <div key={e.id} className="item">
              <div className="grow">
                <div className="item-title">{e.data.name}</div>
                <div className="tiny muted">{e.data.primary.map((m) => MUSCLES[m]?.name ?? m).join(', ')}</div>
              </div>
              <button
                className="btn icon ghost danger"
                aria-label={`Borrar ${e.data.name}`}
                onClick={() => confirmAction(`¿Borrar "${e.data.name}"? Tus registros conservan sus músculos.`) && deleteEntity(e.id)}
              >
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
      )}
      {editing && <RoutineSheet routine={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function RoutineSheet({ routine, onClose }: { routine: Entity<RoutineData> | null; onClose: () => void }) {
  const [name, setName] = useState(routine?.data.name ?? '');
  const [exercises, setExercises] = useState<RoutineData['exercises']>(routine?.data.exercises ?? []);
  const [picking, setPicking] = useState(false);
  return (
    <Sheet open onClose={onClose} title={routine ? 'Editar rutina' : 'Nueva rutina'}>
      {picking ? (
        <ExercisePicker
          taken={new Set(exercises.map((e) => e.exerciseId))}
          onCancel={() => setPicking(false)}
          onPick={(def) => {
            setExercises((xs) => [...xs, { exerciseId: def.id, name: def.name, sets: def.measure === 'distancia' ? 1 : 3, reps: def.measure === 'peso' || def.measure === 'corporal' ? 10 : undefined }]);
            setPicking(false);
          }}
        />
      ) : (
        <>
          <Field label="Nombre">
            <TextInput className="input" value={name} maxLength={120} placeholder="Pecho y tríceps" onChange={(e) => setName(e.target.value)} />
          </Field>
          {exercises.map((x, i) => (
            <div key={`${x.exerciseId}-${i}`} className="wk-ex">
              <div className="wk-ex-head">
                <b className="grow">{x.name}</b>
                <button className="btn icon ghost" style={{ width: 30, minHeight: 30 }} aria-label={`Quitar ${x.name}`} onClick={() => setExercises((xs) => xs.filter((_, j) => j !== i))}>
                  <Icon name="x" width={15} />
                </button>
              </div>
              <div className="grid2" style={{ gap: 8 }}>
                <Stepper label="series" unit="series" step={1} max={10} value={x.sets} onChange={(v) => setExercises((xs) => xs.map((o, j) => (j === i ? { ...o, sets: Math.max(1, Math.round(v ?? 1)) } : o)))} />
                <Stepper label="repeticiones" unit="reps" step={1} max={100} value={x.reps} onChange={(v) => setExercises((xs) => xs.map((o, j) => (j === i ? { ...o, reps: v ? Math.round(v) : undefined } : o)))} />
              </div>
            </div>
          ))}
          <button className="btn block" style={{ marginBottom: 12 }} onClick={() => setPicking(true)}>
            <Icon name="plus" /> Agregar ejercicio
          </button>
          <div className="row" style={{ gap: 8 }}>
            {routine && (
              <button
                className="btn ghost danger"
                onClick={() => {
                  if (!confirmAction(`¿Borrar la rutina "${routine.data.name}"? Tus entrenamientos no cambian.`)) return;
                  deleteEntity(routine.id);
                  onClose();
                }}
              >
                <Icon name="trash" />
              </button>
            )}
            <button
              className="btn primary grow"
              disabled={!name.trim() || !exercises.length}
              onClick={() => {
                saveRoutine({ ...(routine?.data ?? {}), name: name.trim(), exercises }, routine?.id);
                toast('Rutina guardada');
                onClose();
              }}
            >
              Guardar rutina
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
