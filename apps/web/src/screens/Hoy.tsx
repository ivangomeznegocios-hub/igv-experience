import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DAILY_SLOTS,
  GAME_CONFIG,
  type DailySlot,
  type Entity,
  type MissionData,
  type RecurringBossData,
} from '@igv/core';
import { addEvent, useGame } from '../data/store';
import { completeGenerated, completeMission, isDone, updateSettings } from '../lib/actions';
import { fmtDate, fmtMoney, fmtWeekday } from '../lib/time';
import { Hero } from '../ui/Hero';
import { Badge, Bar, Field, Sheet, SizeBadge, AttrBadge, confirmAction, toast, useAutoFocus } from '../ui/kit';
import { Icon } from '../ui/icons';
import { LessonForm } from '../ui/MissionForm';

const SLOT_LABEL: Record<DailySlot, string> = { trabajo: 'Trabajo', cuerpo: 'Cuerpo', libre: 'Libre' };

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
      <DailyCard />
      <NpcMissions />
      <WeeklyCard />
      <DragonCard />
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
          if (confirmAction(`¿Marcar hoy como Día de descanso? No rompe la racha, no suma día ni da bono. Te quedan ${s.restDaysLeftThisWeek} esta semana.`)) {
            addEvent('rest_day.marked', {});
            toast('Día de descanso marcado. Tu racha está a salvo.');
          }
        }}
      >
        <Icon name="moon" /> {s.todayRest ? 'Descansando' : `Día de descanso (${s.restDaysLeftThisWeek})`}
      </button>
    </div>
  );
}

function DailyCard() {
  const { state, list } = useGame();
  const [picking, setPicking] = useState<DailySlot | null>(null);
  const dailies = list<MissionData>('missions', 'daily');
  const sel = state.missions.dailySelections;
  const doneToday = new Set(state.missions.completedToday);
  return (
    <div className="card">
      <div className="card-head">
        <h2>Misiones diarias</h2>
        <Link to="/misiones?tab=daily" className="btn sm ghost">
          Menú
        </Link>
      </div>
      {state.energy.low && (
        <div className="banner warn" style={{ marginBottom: 8 }}>
          <Icon name="bolt" width={18} /> Energía baja: hoy solo misiones chicas y de recuperación.
        </div>
      )}
      {DAILY_SLOTS.map((slot) => {
        const m = dailies.find((d) => d.id === sel[slot]);
        const done = m ? doneToday.has(m.id) : false;
        return (
          <div key={slot} className={`item ${done ? 'done' : ''}`}>
            {m ? (
              <button className={`check ${done ? 'done' : ''}`} disabled={done} aria-label={`Completar ${m.data.title}`} onClick={() => completeMission(m)}>
                <Icon name="check" />
              </button>
            ) : (
              <button className="check" aria-label="Elegir misión" onClick={() => setPicking(slot)}>
                <Icon name="plus" style={{ color: 'var(--muted)' }} />
              </button>
            )}
            <div className="grow">
              <div className="slot-label">{SLOT_LABEL[slot]}</div>
              {m ? (
                <>
                  <div className="item-title">{m.data.title}</div>
                  <div className="row wrap" style={{ gap: 4, marginTop: 3 }}>
                    <SizeBadge size={m.data.size} />
                    <AttrBadge attr={m.data.attribute} />
                  </div>
                </>
              ) : (
                <button className="btn sm ghost" style={{ paddingLeft: 0 }} onClick={() => setPicking(slot)}>
                  Elegir del menú…
                </button>
              )}
            </div>
            {m && !done && (
              <button className="btn sm ghost" onClick={() => setPicking(slot)}>
                Cambiar
              </button>
            )}
          </div>
        );
      })}
      {picking && <DailyPicker slot={picking} onClose={() => setPicking(null)} />}
    </div>
  );
}

function DailyPicker({ slot, onClose }: { slot: DailySlot; onClose: () => void }) {
  const { state, list } = useGame();
  const low = state.energy.low;
  const sel = state.missions.dailySelections;
  const taken = new Set(Object.entries(sel).filter(([s]) => s !== slot).map(([, id]) => id));
  const options = list<MissionData>('missions', 'daily')
    .filter((m) => slot === 'libre' || (m.data.category ?? 'libre') === slot)
    .filter((m) => !taken.has(m.id));
  const suitable = (m: Entity<MissionData>) => !low || m.data.size === 'chica' || !!m.data.recovery;
  return (
    <Sheet open onClose={onClose} title={`Elegir misión: ${SLOT_LABEL[slot]}`}>
      {low && <p className="small muted">Con energía baja se sugieren solo misiones chicas y de recuperación.</p>}
      {options.length === 0 && <p className="muted">No hay misiones en esta categoría. Agrégalas en Misiones → Diarias.</p>}
      {[...options].sort((a, b) => Number(suitable(b)) - Number(suitable(a))).map((m) => (
        <div key={m.id} className="item" style={{ opacity: suitable(m) ? 1 : 0.45 }}>
          <div className="grow">
            <div className="item-title">{m.data.title}</div>
            <div className="row wrap" style={{ gap: 4, marginTop: 3 }}>
              <SizeBadge size={m.data.size} />
              <AttrBadge attr={m.data.attribute} />
              {m.data.recovery && <Badge tone="teal">Recuperación</Badge>}
            </div>
          </div>
          <button
            className="btn sm"
            onClick={() => {
              addEvent('daily.selected', { slot, missionId: m.id });
              onClose();
            }}
          >
            Elegir
          </button>
        </div>
      ))}
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
            <button className={`check ${done ? 'done' : ''}`} disabled={done} onClick={() => completeGenerated(m)} aria-label={m.title}>
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
            disabled={done}
            onClick={() => confirmAction(`¿Completaste "${m.data.title}"?`) && completeMission(m)}
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
