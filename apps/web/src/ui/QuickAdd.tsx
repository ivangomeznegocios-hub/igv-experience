import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ATTRIBUTE_NAMES,
  GAME_CONFIG,
  addDays,
  frequentMissions,
  quickMissionId,
  type AttributeId,
  type Entity,
  type GoalData,
  type MissionData,
  type MissionSize,
  type NpcData,
} from '@igv/core';
import { addEvent, saveEntity, useGame } from '../data/store';
import { completeMission, completeQuick, saveTodo, writeLesson } from '../lib/actions';
import { fmtDate, fmtMoney, newId } from '../lib/time';
import { useVoiceInput } from '../lib/voice';
import { AttrChips, Chips, DateChips, Field, Sheet, SizeChips, toast, useAutoFocus } from './kit';
import { Icon } from './icons';
import { startMissionQuest, startQuest } from './QuestMode';

export type QuickMode = 'menu' | 'did' | 'income' | 'expense' | 'lesson' | 'npc' | 'todo' | 'goal' | 'body' | 'rest';
type Opts = { mode?: QuickMode; date?: string };

const bus = new Set<(o: Opts) => void>();
/** Abre el registro rápido desde cualquier pantalla (opcionalmente en un modo y en un día). */
export function openQuickAdd(o: Opts = {}) {
  bus.forEach((f) => f(o));
}

const ACTION_MODES: Record<string, QuickMode> = { mision: 'did', ingreso: 'income', gasto: 'expense', leccion: 'lesson', npc: 'npc', plan: 'todo', menu: 'menu' };

/** Botón flotante "+" y hoja de registro rápido. */
export function QuickAdd() {
  const { state } = useGame();
  const [open, setOpen] = useState<Opts | null>(null);
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();

  useEffect(() => {
    const f = (o: Opts) => setOpen({ mode: o.mode ?? 'menu', date: o.date });
    bus.add(f);
    return () => {
      bus.delete(f);
    };
  }, []);

  // Accesos directos de la app instalada (manifest → /?accion=gasto)
  useEffect(() => {
    const a = params.get('accion');
    if (a && ACTION_MODES[a]) {
      setOpen({ mode: ACTION_MODES[a] });
      params.delete('accion');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const hideFab = pathname.startsWith('/game-master');
  return (
    <>
      {!hideFab && (
        <button className="fab" aria-label="Registrar algo" onClick={() => setOpen({ mode: 'menu' })}>
          <Icon name="plus" />
        </button>
      )}
      {open && <QuickSheet key={`${open.mode}-${open.date}`} initial={open} today={state.today} onClose={() => setOpen(null)} />}
    </>
  );
}

const TITLES: Record<QuickMode, string> = {
  menu: 'Registrar',
  did: 'Hice algo',
  income: 'Ingreso',
  expense: 'Gasto',
  lesson: 'Lección',
  npc: 'Hablé con…',
  todo: 'Por hacer',
  goal: 'Avance de meta',
  body: 'Cuerpo',
  rest: 'Día de descanso',
};

function QuickSheet({ initial, today, onClose }: { initial: Opts; today: string; onClose: () => void }) {
  const [mode, setMode] = useState<QuickMode>(initial.mode ?? 'menu');
  const [date, setDate] = useState(initial.date ?? today);
  const pastDay = date !== today;
  return (
    <Sheet open onClose={onClose} title={`${TITLES[mode]}${pastDay && mode !== 'todo' ? ` · ${fmtDate(date, true)}` : ''}`}>
      {mode === 'menu' && <Menu date={date} setDate={setDate} today={today} onPick={setMode} onClose={onClose} />}
      {mode === 'did' && <DidForm date={date} setDate={setDate} today={today} onDone={onClose} />}
      {(mode === 'income' || mode === 'expense') && <MoneyForm kind={mode} date={date} setDate={setDate} today={today} onDone={onClose} />}
      {mode === 'lesson' && <LessonQuick date={date} setDate={setDate} today={today} onDone={onClose} />}
      {mode === 'npc' && <NpcForm date={date} setDate={setDate} today={today} onDone={onClose} />}
      {mode === 'todo' && <TodoForm today={today} onDone={onClose} />}
      {mode === 'goal' && <GoalForm date={date} setDate={setDate} today={today} onDone={onClose} />}
      {mode === 'body' && <BodyForm date={date} setDate={setDate} today={today} onDone={onClose} />}
      {mode === 'rest' && <RestForm date={date} setDate={setDate} today={today} onDone={onClose} />}
      {mode !== 'menu' && (
        <button className="btn sm ghost" style={{ marginTop: 10 }} onClick={() => setMode('menu')}>
          <Icon name="left" /> Otras opciones
        </button>
      )}
    </Sheet>
  );
}

type DateProps = { date: string; setDate: (d: string) => void; today: string };

function Menu({ date, setDate, today, onPick, onClose }: DateProps & { onPick: (m: QuickMode) => void; onClose: () => void }) {
  const { events, list, state } = useGame();
  const navigate = useNavigate();
  const favs = useMemo(() => frequentMissions(events, today, 60, 10), [events, today]);
  const doneOn = (id: string) => !!state.missions.completions[id]?.dates.includes(date);
  const dailies = list<MissionData>('missions', 'daily');
  const tiles: { mode: QuickMode | 'gm'; icon: string; label: string }[] = [
    { mode: 'did', icon: 'check', label: 'Hice algo' },
    { mode: 'income', icon: 'coin', label: 'Ingreso' },
    { mode: 'expense', icon: 'backpack', label: 'Gasto' },
    { mode: 'npc', icon: 'chat', label: 'Hablé con…' },
    { mode: 'todo', icon: 'calendar', label: 'Por hacer' },
    { mode: 'lesson', icon: 'feather', label: 'Lección' },
    { mode: 'goal', icon: 'target', label: 'Meta' },
    { mode: 'body', icon: 'heart', label: 'Cuerpo' },
    { mode: 'gm', icon: 'sparkles', label: 'Contarle al Coach' },
  ];
  return (
    <>
      <Field label="¿Cuándo?">
        <DateChips value={date} onChange={setDate} today={today} />
      </Field>
      {favs.length > 0 && (
        <>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Un toque · lo que más haces
          </div>
          <div className="fav-row" style={{ marginBottom: 14 }}>
            {favs.map((f) => {
              const done = doneOn(f.missionId);
              return (
                <button
                  key={f.missionId}
                  className={`fav ${done ? 'done' : ''}`}
                  disabled={done}
                  onClick={() => {
                    const d = dailies.find((x) => x.id === f.missionId);
                    if (d) completeMission(d, date);
                    else completeQuick(f.title, f.size as MissionSize, f.attribute as AttributeId, date);
                  }}
                >
                  <Icon name={done ? 'check' : 'plus'} />
                  {f.title}
                </button>
              );
            })}
          </div>
        </>
      )}
      <div className="qa-grid">
        {tiles.map((t) => (
          <button
            key={t.mode}
            className="qa-btn"
            onClick={() => {
              if (t.mode === 'gm') {
                onClose();
                navigate('/game-master?modo=registrar');
              } else onPick(t.mode);
            }}
          >
            <Icon name={t.icon} />
            {t.label}
          </button>
        ))}
      </div>
      <button className="btn block" style={{ marginTop: 10 }} onClick={() => onPick('rest')}>
        <Icon name="moon" /> Día de descanso
      </button>
    </>
  );
}

function DidForm({ date, setDate, today, onDone }: DateProps & { onDone: () => void }) {
  const { list, events, state } = useGame();
  const [title, setTitle] = useState('');
  const [size, setSize] = useState<MissionSize>('chica');
  const [attr, setAttr] = useState<AttributeId>('disciplina');
  const [saveDaily, setSaveDaily] = useState(false);
  const ref = useAutoFocus<HTMLInputElement>();
  const voice = useVoiceInput((text) => setTitle((prev) => (prev ? `${prev} ${text}` : text)));
  const catalog = list<MissionData>('missions').filter((m) => ['daily', 'side', 'event'].includes(m.kind));
  const t = title.trim();
  const match = catalog.find((m) => m.data.title.toLowerCase() === t.toLowerCase());
  const quickId = quickMissionId(t);
  const timesBefore = useMemo(() => events.filter((e) => !e.voidedAt && e.type === 'mission.completed' && e.payload.missionId === quickId).length, [events, quickId]);
  const suggestions = useMemo(() => {
    if (t.length < 2) return [];
    const q = t.toLowerCase();
    const recent = frequentMissions(events, today, 365, 40).filter((f) => f.kind === 'quick');
    const items = [
      ...catalog.filter((m) => m.kind === 'daily' || !state.missions.completions[m.id]).map((m) => ({ title: m.data.title, size: m.data.size, attribute: m.data.attribute })),
      ...recent.map((r) => ({ title: r.title, size: r.size as MissionSize, attribute: r.attribute as AttributeId })),
    ];
    return items.filter((x) => x.title.toLowerCase().includes(q) && x.title.toLowerCase() !== q).slice(0, 5);
  }, [t, events, today, catalog, state.missions.completions]);

  const effSize = match ? match.data.size : size;
  const save = () => {
    if (!t) return;
    if (match) completeMission(match, date);
    else {
      completeQuick(t, size, attr, date);
      if (saveDaily) {
        saveEntity({ id: `daily-${newId().slice(0, 8)}`, module: 'missions', kind: 'daily', data: { title: t, size, attribute: attr, category: 'libre' } satisfies MissionData });
        toast('Guardada como diaria: aparecerá en tu rutina');
      }
    }
    onDone();
  };
  const playNow = () => {
    if (!t) return;
    if (match) startMissionQuest(match);
    else startQuest({ kind: 'quick', title: t, size, attribute: attr });
    onDone();
  };
  return (
    <>
      <Field label="¿Qué hiciste o vas a hacer?">
        <div className="row" style={{ gap: 6 }}>
          <input ref={ref} className="input grow" value={title} placeholder="Fui al gym, cerré una venta…" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
          {voice.supported && (
            <button type="button" className={`btn icon ${voice.listening ? 'danger' : ''}`} onClick={voice.toggle} aria-label="Dictar por voz" title="Dictar por voz">
              <Icon name="mic" />
            </button>
          )}
        </div>
      </Field>
      {suggestions.length > 0 && (
        <div className="fav-row" style={{ marginTop: -6, marginBottom: 10 }}>
          {suggestions.map((s) => (
            <button
              key={s.title}
              className="fav"
              onClick={() => {
                setTitle(s.title);
                setSize(s.size);
                setAttr(s.attribute);
              }}
            >
              {s.title}
            </button>
          ))}
        </div>
      )}
      {match ? (
        <p className="small muted">
          Es tu misión <b>{match.data.title}</b> ({match.data.size} · {ATTRIBUTE_NAMES[match.data.attribute]}).
        </p>
      ) : (
        <>
          <Field label="Tamaño">
            <SizeChips value={size} onChange={setSize} />
          </Field>
          <Field label="Atributo">
            <AttrChips value={attr} onChange={setAttr} />
          </Field>
          {t && (
            <label className="checkbox">
              <input type="checkbox" checked={saveDaily} onChange={(e) => setSaveDaily(e.target.checked)} />
              {timesBefore >= 2 ? `Ya lo registraste ${timesBefore} veces: guárdala como diaria` : 'Guardar también como diaria (rutina)'}
            </label>
          )}
        </>
      )}
      <Field label="¿Cuándo?">
        <DateChips value={date} onChange={setDate} today={today} />
      </Field>
      <div className="row" style={{ gap: 8 }}>
        {date === today && (
          <button className="btn" disabled={!t} onClick={playNow} title="Iniciar en Modo enfoque con temporizador">
            <Icon name="play" /> Enfoque
          </button>
        )}
        <button className="btn primary grow" disabled={!t} onClick={save}>
          Registrar · +{GAME_CONFIG.missionXp[effSize]} XP
        </button>
      </div>
    </>
  );
}

function MoneyForm({ kind, date, setDate, today, onDone }: DateProps & { kind: 'income' | 'expense'; onDone: () => void }) {
  const { events, state } = useGame();
  const [amount, setAmount] = useState('');
  const [concept, setConcept] = useState('');
  const [category, setCategory] = useState('');
  const ref = useAutoFocus<HTMLInputElement>();
  const type = kind === 'income' ? 'income.recorded' : 'expense.recorded';
  const history = useMemo(
    () =>
      events
        .filter((e) => !e.voidedAt && e.type === type)
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
        .reverse(),
    [events, type],
  );
  const uniq = <T,>(xs: T[], n: number) => [...new Set(xs)].filter(Boolean).slice(0, n);
  const lastAmounts = uniq(history.map((e) => e.payload.amount as number), 3);
  const presets = uniq([...lastAmounts, ...(kind === 'income' ? [1000, 5000, 10000] : [100, 300, 500, 1000])], 6);
  const concepts = uniq(history.map((e) => String(e.payload.concept ?? '')), 6);
  const categories = uniq([...history.map((e) => String(e.payload.category ?? '')), ...Object.keys(state.settings.budgets ?? {})], 8);
  const ok = Number(amount) > 0;
  const save = () => {
    if (!ok) return;
    const payload = { amount: Number(amount), concept: concept.trim(), category: category.trim() || undefined };
    if (kind === 'income') addEvent('income.recorded', payload, { localDate: date });
    else addEvent('expense.recorded', payload, { localDate: date });
    toast(`${kind === 'income' ? 'Ingreso' : 'Gasto'}: ${fmtMoney(Number(amount), state.settings.currency)}`);
    onDone();
  };
  return (
    <>
      <p className="tiny muted" style={{ marginTop: 0 }}>
        El dinero real y la XP son sistemas separados.
      </p>
      <Field label={`Monto (${state.settings.currency})`}>
        <input ref={ref} className="input" type="number" inputMode="decimal" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <div style={{ marginTop: -4, marginBottom: 12 }}>
        <Chips value={Number(amount) || null} onChange={(v) => setAmount(String(v))} options={presets.map((p) => ({ value: p, label: fmtMoney(p, state.settings.currency) }))} />
      </div>
      <Field label="Concepto">
        <input className="input" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder={kind === 'income' ? 'Cliente, proyecto…' : 'Comida, gasolina…'} />
      </Field>
      {concepts.length > 0 && (
        <div style={{ marginTop: -4, marginBottom: 12 }}>
          <Chips value={concept} onChange={setConcept} options={concepts.map((c) => ({ value: c, label: c }))} />
        </div>
      )}
      {(kind === 'expense' || categories.length > 0) && (
        <Field label="Categoría">
          <div className="stack">
            {categories.length > 0 && <Chips value={category} onChange={(v) => setCategory(v === category ? '' : v)} options={categories.map((c) => ({ value: c, label: c }))} />}
            <input className="input" value={category} placeholder="Otra categoría" onChange={(e) => setCategory(e.target.value)} />
          </div>
        </Field>
      )}
      <Field label="¿Cuándo?">
        <DateChips value={date} onChange={setDate} today={today} />
      </Field>
      <button className="btn primary block" disabled={!ok} onClick={save}>
        Guardar
      </button>
    </>
  );
}

function LessonQuick({ date, setDate, today, onDone }: DateProps & { onDone: () => void }) {
  const { list } = useGame();
  const [text, setText] = useState('');
  const [missionId, setMissionId] = useState('');
  const ref = useAutoFocus<HTMLTextAreaElement>();
  const all = list<MissionData>('missions').filter((m) => m.kind !== 'main');
  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>
        Un fracaso con lección escrita vale {GAME_CONFIG.rewards.lesson} XP.
      </p>
      <Field label="¿Qué aprendí?">
        <textarea ref={ref} className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Qué pasó, por qué, y qué haré distinto." />
      </Field>
      <Field label="¿En qué misión? (opcional)">
        <select className="input" value={missionId} onChange={(e) => setMissionId(e.target.value)}>
          <option value="">— Ninguna (Inteligencia) —</option>
          {all.map((m) => (
            <option key={m.id} value={m.id}>
              {m.data.title}
            </option>
          ))}
        </select>
      </Field>
      <Field label="¿Cuándo?">
        <DateChips value={date} onChange={setDate} today={today} />
      </Field>
      <button
        className="btn primary block"
        disabled={text.trim().length < 3}
        onClick={() => {
          writeLesson(text.trim(), all.find((m) => m.id === missionId) ?? null, date);
          onDone();
        }}
      >
        Guardar · +{GAME_CONFIG.rewards.lesson} XP
      </button>
    </>
  );
}

function NpcForm({ date, setDate, today, onDone }: DateProps & { onDone: () => void }) {
  const { list, state } = useGame();
  const npcs = list<NpcData>('npcs', 'npc').sort((a, b) => (state.npcs.npcs[b.id]?.daysSince ?? 9999) - (state.npcs.npcs[a.id]?.daysSince ?? 9999));
  const [npcId, setNpcId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  if (!npcs.length) return <p className="muted">Aún no tienes personas registradas. Agrégalas en Más → Mi gente.</p>;
  return (
    <>
      <Field label="¿Con quién?">
        <Chips
          value={npcId}
          onChange={setNpcId}
          options={npcs.map((n) => {
            const d = state.npcs.npcs[n.id]?.daysSince;
            return { value: n.id, label: `${n.data.name}${d !== null && d !== undefined && d >= 14 ? ` · ${d} d` : ''}`, tone: state.npcs.npcs[n.id]?.overdue ? 'warn' : undefined };
          })}
        />
      </Field>
      <Field label="Nota (opcional)">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="De qué hablaron" />
      </Field>
      <Field label="¿Cuándo?">
        <DateChips value={date} onChange={setDate} today={today} />
      </Field>
      <button
        className="btn primary block"
        disabled={!npcId}
        onClick={() => {
          addEvent('npc.interaction', { npcId: npcId!, note: note.trim() || undefined }, { localDate: date });
          toast(`Interacción registrada con ${npcs.find((n) => n.id === npcId)?.data.name}`);
          onDone();
        }}
      >
        Registrar
      </button>
    </>
  );
}

function TodoForm({ today, onDone }: { today: string; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [size, setSize] = useState<MissionSize>('media');
  const [attr, setAttr] = useState<AttributeId>('disciplina');
  const tomorrow = addDays(today, 1);
  const [date, setDate] = useState(tomorrow);
  const ref = useAutoFocus<HTMLInputElement>();
  const save = () => {
    if (!title.trim()) return;
    saveTodo({ title: title.trim(), size, attribute: attr, date });
    toast(`Planeado para ${date === today ? 'hoy' : date === tomorrow ? 'mañana' : fmtDate(date, true)}`);
    onDone();
  };
  return (
    <>
      <Field label="¿Qué vas a hacer?">
        <input ref={ref} className="input" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      </Field>
      <Field label="¿Cuándo?">
        <div className="row wrap" style={{ gap: 6 }}>
          <Chips
            value={[today, tomorrow, addDays(today, 2)].includes(date) ? date : null}
            onChange={setDate}
            options={[
              { value: today, label: 'Hoy' },
              { value: tomorrow, label: 'Mañana' },
              { value: addDays(today, 2), label: 'Pasado' },
            ]}
          />
          <input className="input date-mini" type="date" min={today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Otro día" />
        </div>
      </Field>
      <Field label="Tamaño">
        <SizeChips value={size} onChange={setSize} />
      </Field>
      <Field label="Atributo">
        <AttrChips value={attr} onChange={setAttr} />
      </Field>
      <button className="btn primary block" disabled={!title.trim()} onClick={save}>
        Agregar a la agenda
      </button>
    </>
  );
}

function GoalForm({ date, setDate, today, onDone }: DateProps & { onDone: () => void }) {
  const { list, state } = useGame();
  const goals = list<GoalData>('goals', 'goal').filter((g) => !state.goals[g.id]?.completedOn && !(g.data as GoalData & { archived?: boolean }).archived);
  const [goalId, setGoalId] = useState<string | null>(goals[0]?.id ?? null);
  const [amount, setAmount] = useState('1');
  const g = goals.find((x) => x.id === goalId) as Entity<GoalData> | undefined;
  if (!goals.length) return <p className="muted">No tienes metas activas. Créalas en Progreso → Metas.</p>;
  const st = g ? state.goals[g.id] : null;
  return (
    <>
      <Field label="Meta">
        <Chips value={goalId} onChange={setGoalId} options={goals.map((x) => ({ value: x.id, label: x.data.title }))} />
      </Field>
      {g && st && (
        <p className="small muted">
          Llevas {st.current} de {st.target} {g.data.unit}.
        </p>
      )}
      <Field label={`¿Cuánto avanzaste?${g ? ` (${g.data.unit})` : ''}`}>
        <div className="row" style={{ gap: 6 }}>
          <input className="input" type="number" inputMode="decimal" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {[1, 5, 10].map((n) => (
            <button key={n} className="btn sm" onClick={() => setAmount(String(n))}>
              {n}
            </button>
          ))}
        </div>
      </Field>
      <Field label="¿Cuándo?">
        <DateChips value={date} onChange={setDate} today={today} />
      </Field>
      <button
        className="btn primary block"
        disabled={!goalId || !(Number(amount) > 0)}
        onClick={() => {
          addEvent('goal.progress', { goalId: goalId!, amount: Number(amount) }, { localDate: date });
          toast('Avance registrado');
          onDone();
        }}
      >
        Registrar avance
      </button>
    </>
  );
}

function BodyForm({ date, setDate, today, onDone }: DateProps & { onDone: () => void }) {
  const { state } = useGame();
  const [weight, setWeight] = useState(state.body.lastWeight ? String(state.body.lastWeight.kg) : '');
  const [workout, setWorkout] = useState('');
  const recent = [...new Set(state.body.entries.map((e) => e.workout?.trim()).filter(Boolean) as string[])].reverse().slice(0, 6);
  const ok = Number(weight) > 0 || !!workout.trim();
  return (
    <>
      <p className="tiny muted" style={{ marginTop: 0 }}>
        Registro de cuerpo (no da XP; la XP viene de tus misiones de Fuerza).
      </p>
      <Field label="Peso (kg)">
        <input className="input" type="number" inputMode="decimal" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} />
      </Field>
      <Field label="Entrenamiento">
        <input className="input" value={workout} onChange={(e) => setWorkout(e.target.value)} placeholder="Pierna, correr 5 km…" />
      </Field>
      {recent.length > 0 && (
        <div style={{ marginTop: -4, marginBottom: 12 }}>
          <Chips value={workout} onChange={setWorkout} options={recent.map((w) => ({ value: w, label: w }))} />
        </div>
      )}
      <Field label="¿Cuándo?">
        <DateChips value={date} onChange={setDate} today={today} />
      </Field>
      <button
        className="btn primary block"
        disabled={!ok}
        onClick={() => {
          addEvent('body.logged', { weightKg: Number(weight) > 0 ? Number(weight) : undefined, workout: workout.trim() || undefined }, { localDate: date });
          toast('Registro guardado');
          onDone();
        }}
      >
        Guardar
      </button>
    </>
  );
}

function RestForm({ date, setDate, today, onDone }: DateProps & { onDone: () => void }) {
  const { state, events } = useGame();
  const already = events.some((e) => !e.voidedAt && e.type === 'rest_day.marked' && e.localDate === date);
  return (
    <>
      <p className="small muted" style={{ marginTop: 0 }}>
        Un día de descanso no rompe la racha, no suma día ni da bono. Máximo {GAME_CONFIG.streak.restDaysPerWeek} por semana.
        {date === today && ` Te quedan ${state.streak.restDaysLeftThisWeek} esta semana.`}
      </p>
      <Field label="¿Qué día?">
        <DateChips value={date} onChange={setDate} today={today} />
      </Field>
      <button
        className="btn primary block"
        disabled={already}
        onClick={() => {
          addEvent('rest_day.marked', {}, { localDate: date });
          toast('Día de descanso marcado. Tu racha está a salvo.');
          onDone();
        }}
      >
        <Icon name="moon" /> {already ? 'Ya está marcado' : 'Marcar descanso'}
      </button>
    </>
  );
}
