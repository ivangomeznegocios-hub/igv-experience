import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DAY_AREAS, GAME_CONFIG, addDays, dayCloseBonus, isDateString, type DayCheckResult } from '@igv/core';
import { addEvent, restoreEvent, useGame, voidEvent } from '../data/store';
import { fmtDate, fmtMoney, fmtWeekday } from '../lib/time';
import { Badge, Chips, Empty, Field, PageHeader, toast, undoToast, TextInput } from '../ui/kit';
import { Icon } from '../ui/icons';
import { ScoreRing } from '../ui/HabitBits';
import { missingLine, useDayReview } from '../ui/DayReview';
import { DAY_CHECK_UI, type DayCheckActionArgs } from '../ui/dayCheckActions';
import { openPlanSheet } from '../ui/DayPlan';
import { openQuickAdd } from '../ui/QuickAdd';
import '../styles/habitos.css';

const MOODS = ['😫', '😕', '😐', '🙂', '🔥'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const areaIcon = (id: string) => DAY_AREAS.find((a) => a.id === id)?.icon ?? 'list';

/** "¿Cómo fue tu día?": lo registrado por área, lo que falta (con su acción de un toque), tus números y tu cierre. */
export default function Dia() {
  const { state, events } = useGame();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const raw = params.get('fecha');
  const date = raw && isDateString(raw) && raw < state.today ? raw : state.today;
  const r = useDayReview(date);
  const isToday = date === state.today;
  const go = (d: string) => setParams(d >= state.today ? {} : { fecha: d }, { replace: true });
  const title = isToday ? 'Hoy' : date === addDays(state.today, -1) ? 'Ayer' : `${cap(fmtWeekday(date))} ${fmtDate(date)}`;
  const answered = r.checks.filter((c) => c.status !== 'missing');
  const cur = state.settings.currency;
  const args: DayCheckActionArgs = { date, today: state.today, navigate };

  const unskip = (c: DayCheckResult) => {
    const evs = events.filter((e) => !e.voidedAt && e.type === 'day.check_skipped' && e.localDate === date && e.payload?.checkId === c.id);
    evs.forEach((e) => voidEvent(e.id));
    undoToast(`${c.label}: otra vez pendiente`, () => evs.forEach((e) => restoreEvent(e.id)));
  };

  return (
    <>
      <PageHeader
        title={title}
        eyebrow={`¿Cómo fue tu día? · ${fmtDate(date, date.slice(0, 4) !== state.today.slice(0, 4))}`}
        right={
          <div className="day-nav">
            <button className="btn icon ghost" aria-label="Día anterior" onClick={() => go(addDays(date, -1))}>
              <Icon name="left" />
            </button>
            {!isToday && (
              <button className="btn sm ghost" onClick={() => go(state.today)}>
                Hoy
              </button>
            )}
            <button className="btn icon ghost" aria-label="Día siguiente" disabled={isToday} onClick={() => go(addDays(date, 1))}>
              <Icon name="right" />
            </button>
          </div>
        }
      />

      <div className="card">
        <div className="day-head">
          <ScoreRing value={r.score} size={72} stroke={7} />
          <div className="grow" style={{ minWidth: 0 }}>
            <b style={{ fontSize: 17 }}>{r.score === null ? 'Sin revisiones' : r.score >= 100 ? 'Día completo' : `${r.score}% registrado`}</b>
            <div className="small muted">{r.score === null ? '' : missingLine(r, 4)}</div>
            {r.restDay && (
              <div style={{ marginTop: 6 }}>
                <Badge tone="blue">Día de descanso</Badge>
              </div>
            )}
          </div>
        </div>
        <div className="day-nums">
          <div>
            <span>XP</span>
            <b className="gold">+{r.numbers.xp ?? 0}</b>
          </div>
          <div>
            <span>Misiones</span>
            <b>{r.numbers.missions}</b>
          </div>
          <div>
            <span>Gasto</span>
            <b>{fmtMoney(r.numbers.expense, cur)}</b>
          </div>
          <div>
            <span>Sueño</span>
            <b>{r.numbers.sleepHours === null ? '—' : `${r.numbers.sleepHours} h`}</b>
          </div>
        </div>
        {answered.length > 0 && (
          <div className="day-answers">
            {answered.map((c) =>
              c.status === 'skipped' ? (
                <button key={c.id} className="day-answer skipped" onClick={() => unskip(c)} title="Tocar para deshacer">
                  <Icon name="x" /> {c.label}: <em>{c.skipLabel?.toLowerCase()}</em>
                </button>
              ) : (
                <span key={c.id} className="day-answer">
                  <Icon name="check" /> {c.label}
                  {c.detail ? <em> · {c.detail}</em> : null}
                </span>
              ),
            )}
          </div>
        )}
      </div>

      {r.missing.length > 0 && (
        <>
          <div className="section-title">Lo que falta</div>
          <div className="card">
            {r.missing.map((c) => (
              <Gap key={c.id} c={c} args={args} />
            ))}
          </div>
        </>
      )}

      <div className="section-title">Lo que registraste</div>
      <div className="card">
        {r.logged.length === 0 && <Empty>Nada registrado {isToday ? 'hoy' : 'este día'} todavía.</Empty>}
        {r.logged.map((g) => (
          <div key={g.area.id} className="day-area">
            <div className="day-area-head">
              <Icon name={g.area.icon} /> {g.area.label}
            </div>
            {g.items.map((i) => (
              <div key={i.id} className="day-item">
                <span>{i.label}</span>
                <span>{i.text}</span>
              </div>
            ))}
          </div>
        ))}
        <button className="btn block" style={{ marginTop: 10 }} onClick={() => openQuickAdd({ mode: 'menu', date })}>
          <Icon name="plus" /> Registrar algo más
        </button>
      </div>

      <ClosureCard key={date} date={date} />
    </>
  );
}

/** Un hueco del día: la pregunta, su llenado en línea o su acción, y "nada que registrar" si aplica. */
function Gap({ c, args }: { c: DayCheckResult; args: DayCheckActionArgs }) {
  const ui = DAY_CHECK_UI[c.id] ?? {};
  const action = ui.action && (!ui.action.when || ui.action.when(args)) ? ui.action : null;
  const skip = () => {
    const ev = addEvent('day.check_skipped', { checkId: c.id, label: c.skipLabel }, { localDate: args.date });
    undoToast(`${c.label}: ${c.skipLabel?.toLowerCase()}`, () => voidEvent(ev.id));
  };
  return (
    <div className="day-gap">
      <div className="day-gap-head">
        <div className="day-gap-icon">
          <Icon name={ui.icon ?? areaIcon(c.area)} />
        </div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="item-title">
            {c.label}
            {c.detail && <span className="tiny muted"> · {c.detail}</span>}
          </div>
          <div className="tiny muted">{c.question}</div>
          {!ui.Inline && c.pending.length > 0 && <div className="tiny" style={{ marginTop: 2 }}>Pendiente: {c.pending.join(', ')}</div>}
        </div>
      </div>
      {ui.Inline && (
        <div className="day-inline">
          <ui.Inline date={args.date} check={c} />
        </div>
      )}
      {(action || ui.secondary || c.skipLabel) && (
        <div className="day-gap-actions">
          {action && (
            <button className="btn sm primary" onClick={() => action.run(args)}>
              {action.label}
            </button>
          )}
          {ui.secondary && (
            <button className="btn sm" onClick={() => ui.secondary!.run(args)}>
              {ui.secondary.label}
            </button>
          )}
          {c.skipLabel && (
            <button className="btn sm ghost" onClick={skip}>
              {c.skipLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Ánimo y una línea (evento `day.closed`, también para días pasados). */
function ClosureCard({ date }: { date: string }) {
  const { state } = useGame();
  const prev = state.dayClosures[date];
  const [note, setNote] = useState(prev?.note ?? '');
  const [mood, setMood] = useState<number | null>(prev?.mood ?? null);
  const isToday = date === state.today;
  const save = () => {
    addEvent('day.closed', { note: note.trim(), mood: mood ?? undefined }, { localDate: date });
    const bonus = !prev && state.missions.activeDays.has(date) ? dayCloseBonus(date, GAME_CONFIG.goldBonus.dayCloseOptions) : 0;
    toast(bonus ? `Día cerrado. Bono sorpresa: +${bonus} de oro.` : isToday ? 'Día cerrado. Descansa, mañana seguimos.' : 'Cierre guardado.', bonus ? 'xp' : 'info');
    const tomorrow = addDays(state.today, 1);
    if (isToday && !prev && !state.plans[tomorrow]?.items.length) setTimeout(() => openPlanSheet(tomorrow), 350);
  };
  return (
    <>
      <div className="section-title" id="cierre">
        ¿Cómo te sentiste?
      </div>
      <div className="card">
        <Field label="Tu día en una carita">
          <Chips value={mood} onChange={setMood} size="lg" options={MOODS.map((m, i) => ({ value: i + 1, label: m }))} />
        </Field>
        <Field label="Una línea sobre tu día">
          <TextInput className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Lo mejor, lo que aprendí, lo que faltó…" />
        </Field>
        <button className="btn primary block" disabled={!prev && mood === null && !note.trim()} onClick={save}>
          {prev ? 'Actualizar cierre' : 'Cerrar el día'}
        </button>
      </div>
    </>
  );
}
