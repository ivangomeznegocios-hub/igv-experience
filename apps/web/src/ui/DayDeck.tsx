import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addEvent, useGame, voidEvent } from '../data/store';
import { closeDay } from '../lib/actions';
import { fmtDate } from '../lib/time';
import { DAY_CHECK_UI } from './dayCheckActions';
import { useDayReview } from './DayReview';
import { openDayResult } from './DayResult';
import { Icon } from './icons';
import { Chips, Field, Sheet, TextInput, undoToast } from './kit';
import { getQuickEntry } from './QuickAdd';
import { openPlanSheet } from './DayPlan';
import '../styles/mesa.css';

type DeckOpts = { date: string; closeOnly?: boolean };
const bus = new Set<(o: DeckOpts) => void>();

/** Abre la baraja del día: lo que falta registrar, una tarjeta a la vez, y al final el cierre. */
export function openDayDeck(o: DeckOpts) {
  bus.forEach((f) => f(o));
}

/** Registros del "+" que se pueden llenar dentro de la baraja. */
const QUICK_FOR_CHECK: Record<string, string> = { gastos: 'expense', gente: 'npc', tiempo: 'time', actividad: 'did' };

export const MOODS = ['😫', '😕', '😐', '🙂', '🔥'];

/** Se monta una vez en App. */
export function DayDeckHost() {
  const [opts, setOpts] = useState<DeckOpts | null>(null);
  useEffect(() => {
    const f = (o: DeckOpts) => setOpts(o);
    bus.add(f);
    return () => {
      bus.delete(f);
    };
  }, []);
  if (!opts) return null;
  return <DayDeck key={`${opts.date}-${opts.closeOnly ? 'c' : 'd'}`} {...opts} onClose={() => setOpts(null)} />;
}

function DayDeck({ date, closeOnly, onClose }: DeckOpts & { onClose: () => void }) {
  const { state } = useGame();
  const navigate = useNavigate();
  const review = useDayReview(date);
  // Las tarjetas se fijan al abrir: así no saltan mientras registras.
  const [ids] = useState(() => (closeOnly ? [] : review.missing.filter((c) => c.id !== 'cierre').map((c) => c.id)));
  const [i, setI] = useState(0);
  const atClose = i >= ids.length;
  const current = atClose ? null : (review.checks.find((c) => c.id === ids[i]) ?? null);
  const stillMissing = !!current && review.missing.some((c) => c.id === current.id);
  const next = () => setI((x) => x + 1);

  // Cuando la tarjeta queda lista, pasa sola a la siguiente.
  const advanced = useRef<string | null>(null);
  const currentId = current?.id ?? null;
  useEffect(() => {
    if (!currentId || stillMissing || advanced.current === currentId) return;
    const t = window.setTimeout(() => {
      advanced.current = currentId;
      next();
    }, 650);
    return () => window.clearTimeout(t);
  }, [currentId, stillMissing]);

  const title = date === state.today ? 'Tu día' : `Tu día · ${fmtDate(date, true)}`;
  const total = ids.length + 1;

  return (
    <Sheet open onClose={onClose} title={title}>
      <div className="deck-progress" aria-label={`Paso ${Math.min(i + 1, total)} de ${total}`}>
        {Array.from({ length: total }, (_, k) => (
          <i key={k} className={k < i ? 'done' : k === i ? 'now' : ''} />
        ))}
      </div>
      {current ? (
        <DeckCard
          key={current.id}
          date={date}
          check={current}
          done={!stillMissing}
          onNext={next}
          navigate={navigate}
          today={state.today}
        />
      ) : (
        <ClosureForm
          date={date}
          onClosed={() => {
            onClose();
            // Sin marcador activo no hay puntaje que mostrar: basta el aviso del cierre.
            if (state.days.start && date >= state.days.start) openDayResult(date);
          }}
        />
      )}
    </Sheet>
  );
}

function DeckCard({
  date,
  check,
  done,
  onNext,
  navigate,
  today,
}: {
  date: string;
  check: ReturnType<typeof useDayReview>['checks'][number];
  done: boolean;
  onNext: () => void;
  navigate: ReturnType<typeof useNavigate>;
  today: string;
}) {
  const ui = DAY_CHECK_UI[check.id] ?? {};
  const quick = QUICK_FOR_CHECK[check.id] ? getQuickEntry(QUICK_FOR_CHECK[check.id]) : undefined;
  const [, setD] = useState(date);
  const args = { date, today, navigate };
  const action = !ui.Inline && !quick && ui.action && (!ui.action.when || ui.action.when(args)) ? ui.action : null;
  const skip = () => {
    const ev = addEvent('day.check_skipped', { checkId: check.id, label: check.skipLabel }, { localDate: date });
    undoToast(`${check.label}: ${check.skipLabel?.toLowerCase()}`, () => voidEvent(ev.id));
  };
  return (
    <div className={`deck-card ${done ? 'is-done' : ''}`}>
      <div className="deck-card-head">
        <span className="deck-icon">
          <Icon name={done ? 'check' : (ui.icon ?? 'list')} />
        </span>
        <div>
          <h3>{check.label}</h3>
          <p className="small muted">{done ? 'Listo.' : check.question}</p>
        </div>
      </div>
      {!done && (
        <div className="deck-body">
          {ui.Inline && <ui.Inline date={date} check={check} />}
          {/* Al guardar, el formulario avanza a la siguiente tarjeta (aunque lo registrado no complete la revisión,
              p. ej. tiempo que no es de trabajo): así no se queda lleno invitando a guardar dos veces. */}
          {!ui.Inline && quick && <quick.Form date={date} setDate={setD} today={today} onDone={onNext} />}
          {action && (
            <button className="btn primary" onClick={() => action.run(args)}>
              {action.label}
            </button>
          )}
        </div>
      )}
      <div className="deck-foot">
        {!done && check.skipLabel && (
          <button className="btn" onClick={skip}>
            {check.skipLabel}
          </button>
        )}
        <button className={`btn ${done ? 'primary' : 'ghost'}`} onClick={onNext}>
          {done ? 'Siguiente' : 'Saltar por ahora'}
        </button>
      </div>
    </div>
  );
}

/** Ánimo y una línea; al guardar se cierra el día y aparece tu resultado. */
export function ClosureForm({ date, onClosed }: { date: string; onClosed: () => void }) {
  const { state } = useGame();
  const prev = state.dayClosures[date];
  const [note, setNote] = useState(prev?.note ?? '');
  const [mood, setMood] = useState<number | null>(prev?.mood ?? null);
  const preview = useMemo(() => state.days.byDate[date], [state, date]);
  return (
    <div className="deck-card">
      <div className="deck-card-head">
        <span className="deck-icon">
          <Icon name="campfire" />
        </span>
        <div>
          <h3>{prev ? 'Tu cierre' : 'Cierra tu día'}</h3>
          <p className="small muted">
            {preview && !prev && state.days.today?.date === date
              ? `Llevas ${preview.score} puntos. Cerrar suma ${state.days.today.closePoints}.`
              : 'Cómo te fue, en una carita y una línea.'}
          </p>
        </div>
      </div>
      <Field label="¿Cómo te fue?">
        <Chips value={mood} onChange={setMood} size="lg" options={MOODS.map((m, k) => ({ value: k + 1, label: m }))} />
      </Field>
      <Field label="Una línea sobre tu día">
        <TextInput className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Lo mejor de hoy, lo que aprendí…" />
      </Field>
      <button
        className="btn primary block"
        onClick={() => {
          const scored = !!state.days.start && date >= state.days.start;
          closeDay(state, date, { note, mood }, scored ? { quiet: true } : { onPlanTomorrow: (t) => setTimeout(() => openPlanSheet(t), 350) });
          onClosed();
        }}
      >
        {prev ? 'Actualizar y ver mi resultado' : 'Cerrar el día'}
      </button>
    </div>
  );
}
