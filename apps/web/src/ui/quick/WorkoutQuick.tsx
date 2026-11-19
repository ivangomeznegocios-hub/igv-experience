import { useEffect, useMemo, useState } from 'react';
import {
  EQUIPMENT_NAMES,
  EXERCISE_LIBRARY,
  EXERCISE_MEASURES,
  GAME_CONFIG,
  MISSION_SIZE_NAMES,
  ATTRIBUTE_NAMES,
  MUSCLES,
  MUSCLE_IDS,
  WORKOUT_KINDS,
  WORKOUT_KIND_NAMES,
  WORKOUT_PLACES,
  WORKOUT_PLACE_NAMES,
  searchExercises,
  trainingAnalysis,
  type ExerciseDef,
  type ExerciseMeasure,
  type MuscleId,
  type RoutineData,
  type WorkoutSet,
} from '@igv/core';
import { useGame } from '../../data/store';
import {
  RPE_OPTIONS,
  canSave,
  clearDraft,
  draftExercise,
  draftFromRoutine,
  draftFromSuggestion,
  draftFromWorkout,
  emptyDraft,
  exerciseDef,
  fmtSets,
  loadDraft,
  logWorkout,
  missionFor,
  routineFromDraft,
  saveCustomExercise,
  saveRoutine,
  storeDraft,
  type DraftExercise,
  type WorkoutDraft,
} from '../../lib/entreno';
import { fmtDate } from '../../lib/time';
import { Chips, DateChips, Field, toast, useAutoFocus } from '../kit';
import { Icon } from '../icons';
import '../../styles/entreno.css';

export interface WorkoutQuickProps {
  date: string;
  setDate: (d: string) => void;
  today: string;
  onDone: () => void;
}

/** Registro rápido de un entrenamiento (para la hoja "+"). */
export function WorkoutQuick(props: WorkoutQuickProps) {
  return <WorkoutForm {...props} />;
}

export default WorkoutQuick;

const MEASURE_NAMES: Record<ExerciseMeasure, string> = { peso: 'Peso', corporal: 'Corporal', tiempo: 'Tiempo', distancia: 'Distancia' };
const muscleList = (ms: MuscleId[]) => ms.map((m) => MUSCLES[m].name).join(', ');

// ---------------------------------------------------------------------------------------------
// Stepper: − [valor] +
// ---------------------------------------------------------------------------------------------

export function Stepper({
  value,
  onChange,
  step,
  unit,
  max = 1000,
  label,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  step: number;
  unit?: string;
  max?: number;
  label: string;
}) {
  const bump = (d: number) => {
    const n = Math.max(0, Math.min(max, Math.round(((value ?? 0) + d) * 100) / 100));
    onChange(n > 0 ? n : undefined);
  };
  return (
    <div className="stepper">
      <button type="button" onClick={() => bump(-step)} aria-label={`Menos ${label}`}>
        −
      </button>
      <label>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={max}
          step="any"
          value={value ?? ''}
          placeholder="0"
          aria-label={label}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const v = e.target.value === '' ? undefined : Number(e.target.value);
            onChange(v !== undefined && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : undefined);
          }}
        />
        {unit && <small>{unit}</small>}
      </label>
      <button type="button" onClick={() => bump(step)} aria-label={`Más ${label}`}>
        +
      </button>
    </div>
  );
}

function SetRow({ n, measure, set, onChange, onRemove }: { n: number; measure: ExerciseMeasure; set: WorkoutSet; onChange: (s: WorkoutSet) => void; onRemove: () => void }) {
  const del = (
    <button type="button" className="btn icon ghost" style={{ width: 30, minHeight: 30 }} onClick={onRemove} aria-label={`Quitar serie ${n}`}>
      <Icon name="x" width={15} />
    </button>
  );
  if (measure === 'corporal' || measure === 'tiempo')
    return (
      <div className="wk-set one">
        <span className="n">{n}</span>
        {measure === 'tiempo' ? (
          <Stepper label="segundos" unit="s" step={5} max={36000} value={set.sec} onChange={(v) => onChange({ ...set, sec: v })} />
        ) : (
          <Stepper label="repeticiones" unit="reps" step={1} value={set.reps} onChange={(v) => onChange({ ...set, reps: v })} />
        )}
        {del}
      </div>
    );
  if (measure === 'distancia')
    return (
      <div className="wk-set">
        <span className="n">{n}</span>
        <Stepper label="minutos" unit="min" step={5} max={1440} value={set.min} onChange={(v) => onChange({ ...set, min: v })} />
        <span className="x">·</span>
        <Stepper label="kilómetros" unit="km" step={0.5} value={set.km} onChange={(v) => onChange({ ...set, km: v })} />
        {del}
      </div>
    );
  return (
    <div className="wk-set">
      <span className="n">{n}</span>
      <Stepper label="repeticiones" unit="reps" step={1} value={set.reps} onChange={(v) => onChange({ ...set, reps: v })} />
      <span className="x">×</span>
      <Stepper label="kilos" unit="kg" step={2.5} value={set.kg} onChange={(v) => onChange({ ...set, kg: v })} />
      {del}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------------------------------

export function WorkoutForm({ date, setDate, today, onDone, initial }: WorkoutQuickProps & { initial?: WorkoutDraft }) {
  const { state, entities, list } = useGame();
  const tr = state.training;
  const [restored] = useState(() => (initial ? null : loadDraft()));
  const [draft, setDraft] = useState<WorkoutDraft>(() => initial ?? restored?.draft ?? emptyDraft(tr.settings, tr.summary.usualWhere));
  const [picking, setPicking] = useState(false);
  const [showRestored, setShowRestored] = useState(!!restored);
  const [routineName, setRoutineName] = useState('');
  const [asRoutine, setAsRoutine] = useState(false);

  useEffect(() => {
    storeDraft(date, draft);
  }, [date, draft]);

  const patch = (p: Partial<WorkoutDraft>) => setDraft((d) => ({ ...d, ...p }));
  const setEx = (k: string, f: (x: DraftExercise) => DraftExercise | null) =>
    setDraft((d) => ({ ...d, exercises: d.exercises.map((x) => (x.key === k ? f(x) : x)).filter(Boolean) as DraftExercise[] }));

  const routines = list<RoutineData>('training', 'routine');
  const lastWorkout = useMemo(() => [...tr.workouts].reverse().find((w) => w.source === 'entreno' && w.exercises.length > 0), [tr.workouts]);
  const suggestion = useMemo(() => trainingAnalysis(tr.summary, new Date().toISOString(), { custom: Object.values(tr.custom) }).suggestion, [tr.summary, tr.custom]);
  const { mission, done } = missionFor(state, entities, date);
  const empty = draft.exercises.length === 0;

  if (picking)
    return (
      <ExercisePicker
        taken={new Set(draft.exercises.map((x) => x.exerciseId))}
        onCancel={() => setPicking(false)}
        onPick={(def) => {
          setDraft((d) => ({ ...d, exercises: [...d.exercises, draftExercise(def, tr.records)], kind: d.exercises.length === 0 && def.measure === 'distancia' ? 'cardio' : d.kind }));
          setPicking(false);
        }}
      />
    );

  const save = () => {
    if (!canSave(draft)) return;
    let d = draft;
    if (asRoutine && routineName.trim() && draft.exercises.length) {
      const r = saveRoutine(routineFromDraft(routineName, draft));
      d = { ...draft, routineId: r.id, title: draft.title.trim() || r.data.name };
    }
    logWorkout(d, date, state, entities);
    clearDraft();
    onDone();
  };

  return (
    <>
      {showRestored && (
        <div className="banner" style={{ padding: '8px 12px' }}>
          <span className="small">Recuperé el entrenamiento que dejaste a medias.</span>
          <button
            className="btn sm"
            onClick={() => {
              clearDraft();
              setDraft(emptyDraft(tr.settings, tr.summary.usualWhere));
              setShowRestored(false);
            }}
          >
            Descartar
          </button>
        </div>
      )}

      {empty && (lastWorkout || routines.length > 0 || suggestion.exercises.length > 0) && (
        <>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Empieza con un toque
          </div>
          <div className="wk-start">
            {lastWorkout && (
              <button type="button" onClick={() => setDraft(draftFromWorkout(lastWorkout))}>
                <b>
                  <Icon name="refresh" /> Repetir el último
                </b>
                <small>
                  {lastWorkout.title} · {fmtDate(lastWorkout.date)}
                </small>
              </button>
            )}
            {suggestion.exercises.length > 0 && (
              <button type="button" onClick={() => setDraft(draftFromSuggestion(suggestion, state))}>
                <b>
                  <Icon name="sparkles" /> Sugerida: {suggestion.title}
                </b>
                <small>{suggestion.exercises.map((e) => e.name).join(', ')}</small>
              </button>
            )}
            {routines.slice(0, 6).map((r) => (
              <button type="button" key={r.id} onClick={() => setDraft(draftFromRoutine(r, state))}>
                <b>
                  <Icon name="list" /> {r.data.name}
                </b>
                <small>{r.data.exercises.map((e) => e.name).join(', ')}</small>
              </button>
            ))}
          </div>
        </>
      )}

      <Field label="Tipo">
        <Chips value={draft.kind} onChange={(kind) => patch({ kind })} options={WORKOUT_KINDS.map((k) => ({ value: k, label: WORKOUT_KIND_NAMES[k] }))} />
      </Field>

      {draft.exercises.map((x) => {
        const def = exerciseDef(x.exerciseId, tr.custom);
        const rec = tr.records[x.exerciseId];
        return (
          <div className="wk-ex" key={x.key}>
            <div className="wk-ex-head">
              <div className="grow">
                <b>{x.name}</b>
                {def && <div className="tiny muted">{muscleList(def.primary)}</div>}
              </div>
              <button type="button" className="btn icon ghost" style={{ width: 30, minHeight: 30 }} onClick={() => setEx(x.key, () => null)} aria-label={`Quitar ${x.name}`}>
                <Icon name="trash" width={15} />
              </button>
            </div>
            {x.sets.map((s, i) => (
              <SetRow
                key={i}
                n={i + 1}
                measure={x.measure}
                set={s}
                onChange={(ns) => setEx(x.key, (e) => ({ ...e, sets: e.sets.map((o, j) => (j === i ? ns : o)) }))}
                onRemove={() => setEx(x.key, (e) => ({ ...e, sets: e.sets.filter((_, j) => j !== i) }))}
              />
            ))}
            <div className="row between" style={{ marginTop: 8 }}>
              <button type="button" className="btn sm" onClick={() => setEx(x.key, (e) => ({ ...e, sets: [...e.sets, { ...(e.sets.at(-1) ?? (x.measure === 'distancia' ? { min: 30 } : x.measure === 'tiempo' ? { sec: 30 } : { reps: 10 })) }] }))}>
                <Icon name="plus" /> Serie
              </button>
              {rec && (
                <span className="wk-last">
                  Última ({fmtDate(rec.lastDate)}): {fmtSets(rec.lastSets)}
                </span>
              )}
            </div>
          </div>
        );
      })}

      <button type="button" className="btn block" style={{ marginBottom: 14 }} onClick={() => setPicking(true)}>
        <Icon name="plus" /> {empty ? 'Agregar ejercicio' : 'Otro ejercicio'}
      </button>

      <Field label="Dónde">
        <Chips value={draft.where} onChange={(where) => patch({ where: draft.where === where ? null : where })} options={WORKOUT_PLACES.map((p) => ({ value: p, label: WORKOUT_PLACE_NAMES[p] }))} />
      </Field>
      <div className="grid2" style={{ gap: 10, alignItems: 'end' }}>
        <Field label="Duración">
          <Stepper label="minutos de duración" unit="min" step={5} max={1440} value={draft.minutes ?? undefined} onChange={(v) => patch({ minutes: v ? Math.round(v) : null })} />
        </Field>
        <Field label="Nombre (opcional)">
          <input className="input" value={draft.title} maxLength={120} placeholder="Pecho y tríceps, fútbol…" onChange={(e) => patch({ title: e.target.value })} />
        </Field>
      </div>
      <Field label="¿Qué tan duro fue?">
        <Chips value={draft.rpe} onChange={(rpe) => patch({ rpe: draft.rpe === rpe ? null : rpe })} options={RPE_OPTIONS} />
      </Field>
      <Field label="Nota (opcional)">
        <input className="input" value={draft.note} maxLength={2000} placeholder="Cómo te sentiste, molestias, técnica…" onChange={(e) => patch({ note: e.target.value })} />
      </Field>
      {draft.exercises.length >= 2 && !draft.routineId && (
        <>
          <label className="checkbox">
            <input type="checkbox" checked={asRoutine} onChange={(e) => setAsRoutine(e.target.checked)} /> Guardar también como rutina
          </label>
          {asRoutine && (
            <Field label="Nombre de la rutina">
              <input className="input" value={routineName} maxLength={120} placeholder={draft.title || 'Pecho y tríceps'} onChange={(e) => setRoutineName(e.target.value)} />
            </Field>
          )}
        </>
      )}
      <Field label="¿Cuándo?">
        <DateChips value={date} onChange={setDate} today={today} />
      </Field>
      <button type="button" className="btn primary block" disabled={!canSave(draft) || (asRoutine && !routineName.trim())} onClick={save}>
        Guardar entrenamiento{!done ? ` · +${GAME_CONFIG.missionXp[mission.size]} XP` : ''}
      </button>
      <div className="wk-xp">
        {done
          ? `"${mission.title}" ya contó ese día; se guarda el detalle.`
          : `Cuenta como "${mission.title}" (${MISSION_SIZE_NAMES[mission.size]} · ${ATTRIBUTE_NAMES[mission.attribute]}). Un récord personal suma +${GAME_CONFIG.missionXp[GAME_CONFIG.training.record.size]} XP.`}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Elegir ejercicio (búsqueda, tus ejercicios primero, filtro por zona, crear uno propio)
// ---------------------------------------------------------------------------------------------

type Zone = 'todos' | 'pecho' | 'espalda' | 'hombro' | 'brazos' | 'pierna' | 'core' | 'cardio';
const ZONES: { value: Zone; label: string; muscles?: MuscleId[] }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'pecho', label: 'Pecho', muscles: ['pecho'] },
  { value: 'espalda', label: 'Espalda', muscles: ['espalda', 'trapecio', 'lumbar'] },
  { value: 'hombro', label: 'Hombro', muscles: ['hombro_frontal', 'hombro_lateral', 'hombro_posterior'] },
  { value: 'brazos', label: 'Brazos', muscles: ['biceps', 'triceps', 'antebrazo'] },
  { value: 'pierna', label: 'Pierna', muscles: ['cuadriceps', 'isquios', 'gluteos', 'aductores', 'pantorrillas'] },
  { value: 'core', label: 'Core', muscles: ['abdomen', 'oblicuos'] },
  { value: 'cardio', label: 'Cardio' },
];

function inZone(e: ExerciseDef, z: Zone) {
  if (z === 'todos') return true;
  if (z === 'cardio') return e.measure === 'distancia';
  const ms = ZONES.find((x) => x.value === z)!.muscles!;
  return e.measure !== 'distancia' && e.primary.some((m) => ms.includes(m));
}

export function ExercisePicker({ onPick, onCancel, taken }: { onPick: (def: ExerciseDef) => void; onCancel: () => void; taken: Set<string> }) {
  const { state, list } = useGame();
  const tr = state.training;
  const [q, setQ] = useState('');
  const [zone, setZone] = useState<Zone>('todos');
  const [creating, setCreating] = useState(false);
  const ref = useAutoFocus<HTMLInputElement>();
  const custom = Object.values(tr.custom);
  const favorites = tr.summary.favorites.map((id) => exerciseDef(id, tr.custom)).filter(Boolean) as ExerciseDef[];
  const query = q.trim();
  const results: { title: string; items: ExerciseDef[] }[] = query
    ? [{ title: 'Resultados', items: searchExercises(query, custom, 14).filter((r) => r.score >= 0.35).map((r) => r.exercise) }]
    : [
        { title: 'Tus ejercicios', items: favorites.filter((e) => inZone(e, zone)).slice(0, 8) },
        { title: zone === 'todos' ? 'Biblioteca' : ZONES.find((z) => z.value === zone)!.label, items: [...custom, ...EXERCISE_LIBRARY].filter((e) => inZone(e, zone) && !favorites.includes(e)) },
      ];

  if (creating)
    return (
      <CustomExerciseForm
        name={query}
        existing={new Set(list('training', 'exercise').map((e) => e.id))}
        onCancel={() => setCreating(false)}
        onSaved={(def) => onPick(def)}
      />
    );

  return (
    <>
      <div className="row" style={{ gap: 6, marginBottom: 10 }}>
        <button type="button" className="btn icon ghost" onClick={onCancel} aria-label="Volver">
          <Icon name="left" />
        </button>
        <input ref={ref} className="input grow" value={q} placeholder="Buscar: press banca, sentadilla, correr…" onChange={(e) => setQ(e.target.value)} />
      </div>
      {!query && (
        <div className="fav-row" style={{ marginBottom: 8 }}>
          {ZONES.map((z) => (
            <button type="button" key={z.value} className={`chip ${zone === z.value ? 'on' : ''}`} style={{ flex: 'none' }} onClick={() => setZone(z.value)}>
              {z.label}
            </button>
          ))}
        </div>
      )}
      <div className="wk-list">
        {results.map(
          (g) =>
            g.items.length > 0 && (
              <div key={g.title} style={{ marginBottom: 8 }}>
                <div className="eyebrow" style={{ margin: '6px 0 2px' }}>
                  {g.title}
                </div>
                {g.items.map((e) => {
                  const used = taken.has(e.id);
                  return (
                    <button type="button" key={e.id} className="wk-pick" disabled={used} style={used ? { opacity: 0.45 } : undefined} onClick={() => onPick(e)}>
                      <div className="grow">
                        <b>{e.name}</b>
                        <small>
                          {e.measure === 'distancia' ? 'Cardio' : muscleList(e.primary)} · {EQUIPMENT_NAMES[e.equipment]}
                          {tr.records[e.id] ? ` · ${tr.records[e.id].sessions} ${tr.records[e.id].sessions === 1 ? 'vez' : 'veces'}` : ''}
                        </small>
                      </div>
                      <Icon name={used ? 'check' : 'plus'} />
                    </button>
                  );
                })}
              </div>
            ),
        )}
        {query && results[0].items.length === 0 && <div className="empty">No lo encontré en la biblioteca.</div>}
      </div>
      <button type="button" className="btn block" style={{ marginTop: 8 }} onClick={() => setCreating(true)}>
        <Icon name="plus" /> {query ? `Crear "${query}"` : 'Crear un ejercicio propio'}
      </button>
    </>
  );
}

function CustomExerciseForm({ name: initialName, existing, onSaved, onCancel }: { name: string; existing: Set<string>; onSaved: (d: ExerciseDef) => void; onCancel: () => void }) {
  const [name, setName] = useState(initialName);
  const [measure, setMeasure] = useState<ExerciseMeasure>('peso');
  const [primary, setPrimary] = useState<MuscleId[]>([]);
  const [secondary, setSecondary] = useState<MuscleId[]>([]);
  const toggle = (list: MuscleId[], set: (l: MuscleId[]) => void, m: MuscleId) => set(list.includes(m) ? list.filter((x) => x !== m) : [...list, m]);
  const ok = name.trim().length >= 2 && primary.length > 0;
  return (
    <>
      <div className="row" style={{ gap: 6, marginBottom: 10 }}>
        <button type="button" className="btn icon ghost" onClick={onCancel} aria-label="Volver">
          <Icon name="left" />
        </button>
        <b>Ejercicio propio</b>
      </div>
      <Field label="Nombre">
        <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Remo con liga" />
      </Field>
      <Field label="Cómo se mide">
        <Chips value={measure} onChange={setMeasure} options={EXERCISE_MEASURES.map((m) => ({ value: m, label: MEASURE_NAMES[m] }))} />
      </Field>
      <Field label="Músculos principales">
        <div className="chips">
          {MUSCLE_IDS.map((m) => (
            <button type="button" key={m} className={`chip ${primary.includes(m) ? 'on' : ''}`} onClick={() => (setSecondary((s) => s.filter((x) => x !== m)), toggle(primary, setPrimary, m))}>
              {MUSCLES[m].name}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Secundarios (cuentan media serie) · opcional">
        <div className="chips">
          {MUSCLE_IDS.filter((m) => !primary.includes(m)).map((m) => (
            <button type="button" key={m} className={`chip ${secondary.includes(m) ? 'on' : ''}`} onClick={() => toggle(secondary, setSecondary, m)}>
              {MUSCLES[m].name}
            </button>
          ))}
        </div>
      </Field>
      <button
        type="button"
        className="btn primary block"
        disabled={!ok}
        onClick={() => {
          const e = saveCustomExercise({ name: name.trim(), primary, secondary, measure, equipment: measure === 'distancia' ? 'cardio' : 'corporal' }, existing);
          toast(`Ejercicio creado: ${e.data.name}`);
          onSaved({ id: e.id, name: e.data.name, equipment: e.data.equipment ?? 'corporal', measure, primary, secondary, compound: primary.length > 1 });
        }}
      >
        Crear y agregar
      </button>
    </>
  );
}
