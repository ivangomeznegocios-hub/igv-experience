import { useEffect, useState, type ReactNode } from 'react';
import {
  BODY_AREAS,
  BODY_AREA_NAMES,
  COACH_GOALS,
  COACH_GOAL_NAMES,
  COACH_LEVELS,
  COACH_LEVEL_NAMES,
  MEAL_KINDS,
  MEAL_KIND_NAMES,
  MEAL_LIMIT_TAGS,
  MEAL_TAGS,
  MEAL_TAG_NAMES,
  WORKOUT_PLACES,
  WORKOUT_PLACE_NAMES,
  addDays,
  weekReview,
  weekStart,
  weekday,
  type BodyArea,
  type CoachGoal,
  type CoachLevel,
  type MealKind,
  type MealTag,
  type WorkoutPlace,
} from '@igv/core';
import { useGame } from '../../data/store';
import { updateSettings } from '../../lib/actions';
import { logCheckin, logMeal, logMeasures, logReadiness, logSleep, logSteps, onOpenCoachSheet, saveCoachSettings, useCoachPlan, type CoachSheetOptions } from '../../lib/coach';
import { fmtDate } from '../../lib/time';
import { Icon } from '../icons';
import { Chips, DateChips, Field, Sheet, TextArea, TextInput, toast } from '../kit';
import { Stepper } from '../quick/WorkoutQuick';
import { CoachChat } from './CoachChat';
import { CoachFace } from './CoachFace';
import '../../styles/coach.css';

/** Hoja global del entrenador: se abre con `openCoachSheet()` (lib/coach.ts) desde cualquier pantalla. */
export default function CoachSheetHost() {
  const [open, setOpen] = useState<(CoachSheetOptions & { n: number }) | null>(null);
  useEffect(() => onOpenCoachSheet((o) => setOpen((prev) => ({ ...o, n: (prev?.n ?? 0) + 1 }))), []);
  if (!open) return null;
  const close = () => setOpen(null);
  switch (open.kind) {
    case 'setup':
      return <SetupSheet key={open.n} onClose={close} />;
    case 'sentir':
      return <ReadinessSheet key={open.n} onClose={close} />;
    case 'checkin':
      return <CheckinSheet key={open.n} week={open.week} onClose={close} />;
    case 'comida':
      return <MealSheet key={open.n} onClose={close} />;
    case 'pasos':
      return <StepsSheet key={open.n} onClose={close} />;
    case 'sueno':
      return <SleepSheet key={open.n} onClose={close} />;
    case 'medidas':
      return <MeasureSheet key={open.n} onClose={close} />;
    case 'chat':
      return <ChatSheet key={open.n} ask={open.ask} onClose={close} />;
  }
}

// ---------------------------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------------------------

/** Chips de selección múltiple. */
export function MultiChips<T extends string | number>({ value, onChange, options }: { value: T[]; onChange: (v: T[]) => void; options: { value: T; label: ReactNode; tone?: string }[] }) {
  return (
    <div className="chips" role="group">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button key={String(o.value)} type="button" aria-pressed={on} className={`chip ${on ? 'on' : ''} ${o.tone ?? ''}`} onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Escala de 1 a 5 con etiquetas en los extremos. */
function Scale({ value, onChange, low, high, label }: { value: number | null; onChange: (v: number) => void; low: string; high: string; label: string }) {
  return (
    <Field label={label}>
      <div className="scale5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" className={`chip ${value === n ? 'on' : ''}`} aria-pressed={value === n} onClick={() => onChange(n)}>
            {n}
          </button>
        ))}
      </div>
      <div className="row between tiny faint" style={{ marginTop: 4 }}>
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </Field>
  );
}

const DAY_CHIPS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((l, i) => ({ value: i, label: l }));
const LEVEL_SHORT: Record<CoachLevel, string> = { sedentario: 'Sedentario', principiante: 'Principiante', intermedio: 'Intermedio', avanzado: 'Avanzado' };

// ---------------------------------------------------------------------------------------------
// Arma tu plan
// ---------------------------------------------------------------------------------------------

function SetupSheet({ onClose }: { onClose: () => void }) {
  const { state } = useGame();
  const cs = state.training.settings.coach ?? {};
  const editing = !!cs.on;
  const [goal, setGoal] = useState<CoachGoal>(cs.goal ?? 'salud');
  const [level, setLevel] = useState<CoachLevel>(cs.level ?? 'sedentario');
  const [days, setDays] = useState<number[]>(cs.days?.length ? cs.days : [0, 2, 4]);
  const [minutes, setMinutes] = useState<number>(cs.sessionMinutes ?? 45);
  const [where, setWhere] = useState<WorkoutPlace | null>(state.training.settings.where ?? state.training.summary.usualWhere ?? 'gym');
  const [limits, setLimits] = useState<BodyArea[]>(cs.limitations ?? []);
  const [name, setName] = useState(cs.name ?? '');
  const [height, setHeight] = useState<number | undefined>(state.settings.heightCm);
  const [birth, setBirth] = useState(state.settings.birthDate ?? '');
  const [weight, setWeight] = useState<number | undefined>(state.body.lastWeight?.kg);
  const [target, setTarget] = useState<number | undefined>(cs.targetWeightKg ?? undefined);
  const [steps, setSteps] = useState<number | undefined>(cs.stepsGoal ?? undefined);

  const save = (restart = false) => {
    if (!days.length) return toast('Elige al menos un día para entrenar', 'error');
    if (days.length > 6) return toast('Deja al menos un día de descanso', 'error');
    const patch: Partial<typeof state.settings> = {};
    if (height && height !== state.settings.heightCm) patch.heightCm = Math.round(height);
    if (birth && birth !== state.settings.birthDate) patch.birthDate = birth;
    if (Object.keys(patch).length) updateSettings(state.settings, patch);
    if (weight && weight !== state.body.lastWeight?.kg) logMeasures({ weightKg: weight });
    saveCoachSettings(
      state,
      {
        on: true,
        goal,
        level,
        days: [...days].sort((a, b) => a - b),
        sessionMinutes: minutes,
        limitations: limits,
        name: name.trim() || undefined,
        targetWeightKg: target || null,
        stepsGoal: steps || null,
        ...(restart || !cs.startDate ? { startDate: state.today } : {}),
      },
      { where },
    );
    toast(editing ? 'Plan actualizado' : 'Listo: tu plan está armado');
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title={editing ? 'Ajustar tu plan' : 'Arma tu plan'}>
      {!editing && (
        <div className="coach-intro">
          <CoachFace mood="animo" size={44} />
          <p className="small" style={{ margin: 0 }}>
            Con esto te armo un plan que empieza suave y sube poco a poco. Lo puedes cambiar cuando quieras; tu historial no se toca.
          </p>
        </div>
      )}
      <Field label="¿Qué quieres lograr?">
        <Chips value={goal} onChange={setGoal} options={COACH_GOALS.map((g) => ({ value: g, label: COACH_GOAL_NAMES[g] }))} />
      </Field>
      <Field label="¿De dónde arrancas?">
        <Chips value={level} onChange={setLevel} options={COACH_LEVELS.map((l) => ({ value: l, label: LEVEL_SHORT[l] }))} />
        <div className="tiny muted" style={{ marginTop: 4 }}>
          {COACH_LEVEL_NAMES[level]}. {level === 'sedentario' ? 'Empezamos con 2 semanas de adaptación: pocas series y lejos del fallo.' : ''}
        </div>
      </Field>
      <Field label="¿Qué días puedes hacer pesas?">
        <MultiChips value={days} onChange={setDays} options={DAY_CHIPS} />
        <div className="tiny muted" style={{ marginTop: 4 }}>
          {days.length} {days.length === 1 ? 'día' : 'días'}. Al empezar uso máximo 3 de fuerza; los demás son de caminar o cardio. Así subes sin lastimarte.
        </div>
      </Field>
      <Field label="Minutos por sesión">
        <Chips value={minutes} onChange={setMinutes} options={[30, 45, 60, 75, 90].map((m) => ({ value: m, label: `${m}` }))} />
      </Field>
      <Field label="¿Dónde entrenas?">
        <Chips value={where} onChange={setWhere} options={WORKOUT_PLACES.filter((p) => p !== 'alberca' && p !== 'cancha').map((p) => ({ value: p, label: WORKOUT_PLACE_NAMES[p] }))} />
      </Field>
      <Field label="¿Algo te duele o tienes alguna lesión?">
        <MultiChips value={limits} onChange={setLimits} options={BODY_AREAS.map((a) => ({ value: a, label: BODY_AREA_NAMES[a] }))} />
        <div className="tiny muted" style={{ marginTop: 4 }}>Evito los ejercicios que cargan esa zona. Si el dolor es fuerte o no se va, primero médico o fisio.</div>
      </Field>
      <div className="eyebrow" style={{ marginTop: 6 }}>
        Tus datos (para calorías, proteína e IMC)
      </div>
      <div className="grid2" style={{ gap: 10 }}>
        <Field label="Estatura">
          <Stepper label="estatura" unit="cm" step={1} max={250} value={height} onChange={setHeight} />
        </Field>
        <Field label="Peso actual">
          <Stepper label="peso" unit="kg" step={0.5} max={400} value={weight} onChange={setWeight} />
        </Field>
        <Field label="Fecha de nacimiento">
          <input className="input" type="date" max={state.today} value={birth} onChange={(e) => setBirth(e.target.value)} />
        </Field>
        <Field label="Peso meta (opcional)">
          <Stepper label="peso meta" unit="kg" step={0.5} max={400} value={target} onChange={setTarget} />
        </Field>
      </div>
      <div className="grid2" style={{ gap: 10 }}>
        <Field label="Meta de pasos (vacío = automática)">
          <Stepper label="meta de pasos" unit="pasos" step={500} max={30000} value={steps} onChange={setSteps} />
        </Field>
        <Field label="Nombre de tu coach">
          <TextInput className="input" value={name} maxLength={30} placeholder="Coach" onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <button className="btn primary block" style={{ marginTop: 6 }} onClick={() => save(false)}>
        <Icon name="check" /> {editing ? 'Guardar cambios' : 'Armar mi plan'}
      </button>
      {editing && (
        <button className="btn ghost block sm" style={{ marginTop: 8 }} onClick={() => save(true)}>
          <Icon name="refresh" /> Guardar y empezar desde la semana 1
        </button>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------
// ¿Cómo te sientes hoy?
// ---------------------------------------------------------------------------------------------

function ReadinessSheet({ onClose }: { onClose: () => void }) {
  const { state } = useGame();
  const prev = state.coach.readiness[state.today];
  const [energy, setEnergy] = useState<number | null>(prev?.energy ?? null);
  const [soreness, setSoreness] = useState<number>(prev?.soreness ?? 0);
  const [pain, setPain] = useState<BodyArea[]>(prev?.pain ?? []);
  const [note, setNote] = useState(prev?.note ?? '');
  return (
    <Sheet open onClose={onClose} title="¿Cómo te sientes hoy?">
      <p className="small muted" style={{ marginTop: -6 }}>
        Con esto ajusto tu sesión: si llegas cansado, la hago más ligera; si algo te duele, quito lo que lo carga.
      </p>
      <Scale label="Energía" value={energy} onChange={setEnergy} low="Sin pila" high="A tope" />
      <Field label="¿Qué tan adolorido?">
        <Chips value={soreness} onChange={setSoreness} options={['Nada', 'Poco', 'Bastante', 'Mucho'].map((l, i) => ({ value: i, label: l }))} />
      </Field>
      <Field label="¿Te molesta algo?">
        <MultiChips value={pain} onChange={setPain} options={BODY_AREAS.map((a) => ({ value: a, label: BODY_AREA_NAMES[a] }))} />
      </Field>
      <Field label="Nota (opcional)">
        <TextInput className="input" value={note} maxLength={500} placeholder="Dormí mal, mucho trabajo…" onChange={(e) => setNote(e.target.value)} />
      </Field>
      <button
        className="btn primary block"
        disabled={!energy}
        onClick={() => {
          logReadiness({ energy: energy!, soreness, pain, note });
          onClose();
        }}
      >
        Listo
      </button>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------
// Check-in semanal
// ---------------------------------------------------------------------------------------------

function CheckinSheet({ week, onClose }: { week?: string; onClose: () => void }) {
  const { state } = useGame();
  const plan = useCoachPlan();
  const ws = week ?? plan.checkinWeek ?? (weekday(state.today) <= 1 ? addDays(weekStart(state.today), -7) : weekStart(state.today));
  const review = weekReview(state, ws);
  const prev = state.coach.checkins[ws];
  const [effort, setEffort] = useState<number | null>(prev?.effort ?? null);
  const [energy, setEnergy] = useState<number | null>(prev?.energy ?? null);
  const [mood, setMood] = useState<number | null>(prev?.mood ?? null);
  const [pain, setPain] = useState<BodyArea[]>(prev?.pain ?? []);
  const [wins, setWins] = useState(prev?.wins ?? '');
  const [struggles, setStruggles] = useState(prev?.struggles ?? '');
  return (
    <Sheet open onClose={onClose} title="¿Cómo estuvo tu semana?">
      <div className="coach-intro">
        <CoachFace mood={review.compliance >= 70 ? 'feliz' : review.compliance >= 40 ? 'calma' : 'atento'} size={44} />
        <div className="small">
          Semana del {fmtDate(ws)}: fuerza <b>{review.strength.done}</b> de {review.strength.target}, cardio <b>{review.cardio.done}</b> de {review.cardio.target} min
          {review.steps.avg !== null ? `, ${review.steps.avg.toLocaleString('es-MX')} pasos al día` : ''}
          {review.sleep.avg !== null ? `, ${review.sleep.avg} h de sueño` : ''}. Cumpliste el <b>{review.compliance}%</b> del plan.
        </div>
      </div>
      <Scale label="¿Qué tan pesado se sintió el plan?" value={effort} onChange={setEffort} low="Muy ligero" high="Demasiado" />
      <Scale label="Energía en la semana" value={energy} onChange={setEnergy} low="Sin pila" high="A tope" />
      <Scale label="Ánimo" value={mood} onChange={setMood} low="Bajo" high="Excelente" />
      <Field label="¿Alguna molestia?">
        <MultiChips value={pain} onChange={setPain} options={BODY_AREAS.map((a) => ({ value: a, label: BODY_AREA_NAMES[a] }))} />
      </Field>
      <Field label="¿Qué salió bien?">
        <TextArea rows={2} value={wins} maxLength={1000} placeholder="Fui 3 veces, comí mejor…" onChange={(e) => setWins(e.target.value)} />
      </Field>
      <Field label="¿Qué te costó?">
        <TextArea rows={2} value={struggles} maxLength={1000} placeholder="El miércoles no me dio tiempo…" onChange={(e) => setStruggles(e.target.value)} />
      </Field>
      <p className="tiny muted">
        {effort === 5 || (energy !== null && energy <= 2) || pain.length
          ? 'La próxima semana va más ligera: una serie menos y más reserva.'
          : review.verdict === 'subir'
            ? 'Vas bien: la próxima semana subes peso o repeticiones donde llegaste al tope.'
            : 'La próxima semana repetimos con los mismos pesos y buscas completar las sesiones.'}
      </p>
      <button
        className="btn primary block"
        disabled={!effort || !energy || !mood}
        onClick={() => {
          logCheckin({ weekStart: ws, effort: effort!, energy: energy!, mood: mood!, pain, wins, struggles });
          onClose();
        }}
      >
        Guardar check-in
      </button>
      {!plan.weight.last || plan.weight.measureDue ? (
        <p className="tiny muted" style={{ marginTop: 10 }}>
          Aprovecha para medirte: peso y cintura en ayunas.
        </p>
      ) : null}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------
// Comida
// ---------------------------------------------------------------------------------------------

function mealByHour(): MealKind {
  const h = new Date().getHours();
  return h < 11 ? 'desayuno' : h < 17 ? 'comida' : h < 22 ? 'cena' : 'colacion';
}

export function MealForm({ onDone, date: initialDate }: { onDone: () => void; date?: string }) {
  const { state } = useGame();
  const [date, setDate] = useState(initialDate ?? state.today);
  const [meal, setMeal] = useState<MealKind>(mealByHour());
  const [text, setText] = useState('');
  const [tags, setTags] = useState<MealTag[]>([]);
  const [protein, setProtein] = useState<number | undefined>();
  const [kcal, setKcal] = useState<number | undefined>();
  const good = MEAL_TAGS.filter((t) => !MEAL_LIMIT_TAGS.includes(t));
  const ok = tags.length > 0 || text.trim().length > 0;
  return (
    <>
      <Field label="¿Cuál?">
        <Chips value={meal} onChange={setMeal} options={MEAL_KINDS.map((m) => ({ value: m, label: MEAL_KIND_NAMES[m] }))} />
      </Field>
      <Field label="¿Qué comiste?">
        <TextInput className="input" value={text} maxLength={500} placeholder="Huevos con nopales y 2 tortillas" onChange={(e) => setText(e.target.value)} />
      </Field>
      <Field label="¿Qué llevaba?">
        <MultiChips value={tags} onChange={setTags} options={good.map((t) => ({ value: t, label: MEAL_TAG_NAMES[t], tone: 'good' }))} />
        <div style={{ height: 6 }} />
        <MultiChips value={tags} onChange={setTags} options={MEAL_LIMIT_TAGS.map((t) => ({ value: t, label: MEAL_TAG_NAMES[t], tone: 'limit' }))} />
      </Field>
      <div className="grid2" style={{ gap: 10 }}>
        <Field label="Proteína (opcional)">
          <Stepper label="gramos de proteína" unit="g" step={5} max={400} value={protein} onChange={setProtein} />
        </Field>
        <Field label="Calorías (opcional)">
          <Stepper label="calorías" unit="kcal" step={50} max={6000} value={kcal} onChange={setKcal} />
        </Field>
      </div>
      <Field label="Día">
        <DateChips value={date} onChange={setDate} today={state.today} />
      </Field>
      <button
        className="btn primary block"
        disabled={!ok}
        onClick={() => {
          logMeal({ meal, text, tags, proteinG: protein, kcal }, date);
          onDone();
        }}
      >
        <Icon name="check" /> Guardar comida
      </button>
    </>
  );
}

function MealSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} title="¿Qué comiste?">
      <MealForm onDone={onClose} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------
// Pasos, sueño y medidas
// ---------------------------------------------------------------------------------------------

function StepsSheet({ onClose }: { onClose: () => void }) {
  const { state } = useGame();
  const plan = useCoachPlan();
  const [date, setDate] = useState(state.today);
  const [steps, setSteps] = useState<number | undefined>(state.coach.steps[state.today]);
  return (
    <Sheet open onClose={onClose} title="Pasos">
      <p className="small muted" style={{ marginTop: -6 }}>
        Copia lo que dice tu teléfono o reloj. Tu meta: <b>{plan.targets.steps.target.toLocaleString('es-MX')}</b> al día (sube sola conforme te mueves más).
      </p>
      <Field label="Pasos">
        <Stepper label="pasos" unit="pasos" step={500} max={150000} value={steps} onChange={setSteps} />
      </Field>
      <Field label="Día">
        <DateChips value={date} onChange={setDate} today={state.today} />
      </Field>
      <button
        className="btn primary block"
        disabled={steps === undefined}
        onClick={() => {
          logSteps(steps ?? 0, date);
          onClose();
        }}
      >
        Guardar
      </button>
    </Sheet>
  );
}

function SleepSheet({ onClose }: { onClose: () => void }) {
  const { state } = useGame();
  const [h, setH] = useState<number | undefined>(state.energy.sleepHours ?? 7);
  return (
    <Sheet open onClose={onClose} title="¿Cuántas horas dormiste?">
      <p className="small muted" style={{ marginTop: -6 }}>
        Con menos de 6 horas te bajo la intensidad; con menos de 5, hoy toca recuperar.
      </p>
      <Chips value={h ?? null} onChange={setH} options={[5, 6, 6.5, 7, 7.5, 8, 9].map((n) => ({ value: n, label: `${n} h` }))} />
      <div style={{ height: 8 }} />
      <Stepper label="horas" unit="h" step={0.5} max={24} value={h} onChange={setH} />
      <button
        className="btn primary block"
        style={{ marginTop: 12 }}
        disabled={h === undefined}
        onClick={() => {
          logSleep(h ?? 0);
          onClose();
        }}
      >
        Guardar
      </button>
    </Sheet>
  );
}

function MeasureSheet({ onClose }: { onClose: () => void }) {
  const { state } = useGame();
  const latest = state.body.latest as { weightKg?: number; waistCm?: number; bodyFatPct?: number };
  const [weight, setWeight] = useState<number | undefined>(latest.weightKg);
  const [waist, setWaist] = useState<number | undefined>(latest.waistCm);
  const [fat, setFat] = useState<number | undefined>();
  return (
    <Sheet open onClose={onClose} title="Tus medidas de la semana">
      <p className="small muted" style={{ marginTop: -6 }}>
        Mídete el mismo día y a la misma hora: en ayunas, después del baño. La cintura, a la altura del ombligo sin apretar. Con eso veo si vas al ritmo correcto. Más contornos en Cuerpo.
      </p>
      <div className="grid2" style={{ gap: 10 }}>
        <Field label="Peso">
          <Stepper label="peso" unit="kg" step={0.1} max={400} value={weight} onChange={setWeight} />
        </Field>
        <Field label="Cintura">
          <Stepper label="cintura" unit="cm" step={0.5} max={300} value={waist} onChange={setWaist} />
        </Field>
      </div>
      <Field label="% de grasa (si tu báscula lo da)">
        <Stepper label="porcentaje de grasa" unit="%" step={0.5} max={70} value={fat} onChange={setFat} />
      </Field>
      <button
        className="btn primary block"
        disabled={!weight && !waist && !fat}
        onClick={() => {
          logMeasures({ weightKg: weight, waistCm: waist, bodyFatPct: fat && fat >= 2 ? fat : undefined });
          onClose();
        }}
      >
        Guardar medidas
      </button>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------
// Chat con tu coach
// ---------------------------------------------------------------------------------------------

function ChatSheet({ ask, onClose }: { ask?: string; onClose: () => void }) {
  const plan = useCoachPlan();
  return (
    <Sheet open onClose={onClose} title={`Habla con ${plan.profile.coachName}`}>
      <CoachChat coachName={plan.profile.coachName} initial={ask} />
    </Sheet>
  );
}
