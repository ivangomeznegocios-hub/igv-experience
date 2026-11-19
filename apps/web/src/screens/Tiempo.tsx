import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  GAME_CONFIG,
  TIME_AREAS,
  TIME_AREA_GROUP,
  TIME_AREA_NAMES,
  TIME_GROUPS,
  TIME_GROUP_NAMES,
  addDays,
  dayTimeline,
  fmtHoursMinutes,
  splitTimerSpan,
  timeAverages,
  timeByGroup,
  timeInsights,
  timeWeekCompare,
  topAreas,
  weekStart,
  type SkillData,
  type TimeArea,
  type TimeEntry,
  type TimeGroup,
} from '@igv/core';
import { useGame, voidEvent, restoreEvent } from '../data/store';
import { clearTimer, fmtClock, logTimeSpan, needsReview, startTimer, updateTimer, useNow, useTimer, type RunningTimer } from '../lib/timeTimer';
import { fmtDate, fmtWeekday } from '../lib/time';
import { confirmAction, DateChips, Empty, Field, PageHeader, Sheet, Tabs, toast, undoToast } from '../ui/kit';
import { Icon } from '../ui/icons';
import { AREA_COLOR, AREA_HINT, AreaChips, AreaDot, HBar, HubNav } from '../ui/habilidades/shared';
import { TimeQuick } from '../ui/quick/TimeQuick';
import '../styles/habilidades.css';

const PRESETS: { label: string; area: TimeArea; note?: string; icon: string }[] = [
  { label: 'Llegué a la oficina', area: 'trabajo', note: 'Oficina', icon: 'backpack' },
  { label: 'A trabajar', area: 'trabajo', icon: 'bolt' },
  { label: 'Estudiar', area: 'estudio', icon: 'book' },
  { label: 'Ejercicio', area: 'ejercicio', icon: 'heart' },
  { label: 'Con mi gente', area: 'familia', icon: 'users' },
  { label: 'En camino', area: 'traslado', icon: 'compass' },
];

const GROUP_COLOR: Record<TimeGroup, string> = { construir: 'var(--gold)', cuerpo: 'var(--flame)', gente: 'var(--green)', resto: 'var(--faint)' };

/** "¿A qué te dedicas?": cronómetro, línea del día, semana contra semana y en qué se te va el tiempo. Sin XP. */
export default function Tiempo() {
  const { state } = useGame();
  const today = state.today;
  const [params, setParams] = useSearchParams();
  const fecha = params.get('fecha');
  const [logDate, setLogDate] = useState(fecha && fecha <= today ? fecha : today);
  const wantsLog = params.get('registrar') === '1' || params.has('habilidad');
  const closeLog = () => {
    params.delete('registrar');
    params.delete('habilidad');
    params.delete('area');
    params.delete('fecha');
    setParams(params, { replace: true });
    setLogDate(today);
  };
  const initialArea = (TIME_AREAS as readonly string[]).includes(params.get('area') ?? '') ? (params.get('area') as TimeArea) : undefined;

  return (
    <>
      <PageHeader
        title="Tu tiempo"
        eyebrow="¿A qué te dedicas?"
        right={
          <button className="btn sm primary" onClick={() => setParams({ registrar: '1' }, { replace: true })}>
            <Icon name="plus" /> Registrar
          </button>
        }
      />
      <HubNav />
      <TimerCard />
      <WeekCard />
      <DayCard />
      <InsightsCard />
      <AveragesCard />
      <p className="tiny muted hab-foot">
        El tiempo no da XP: la XP es por acciones y resultados, no por horas. Esto es para que veas a qué le dedicas tu vida y decidas con datos.
      </p>
      {wantsLog && (
        <Sheet open onClose={closeLog} title="Registrar tiempo">
          <TimeQuick date={logDate} setDate={setLogDate} today={today} onDone={closeLog} initialArea={initialArea} initialSkillId={params.get('habilidad')} />
        </Sheet>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Cronómetro
// ---------------------------------------------------------------------------------------------

function TimerCard() {
  const { list, byId } = useGame();
  const timer = useTimer();
  const now = useNow(!!timer, 1000);
  const [custom, setCustom] = useState(false);
  const [editing, setEditing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [area, setArea] = useState<TimeArea | null>(null);
  const [skillId, setSkillId] = useState('');
  const [note, setNote] = useState('');
  const skills = list<SkillData>('skills', 'skill');

  if (!timer) {
    return (
      <div className="card hab-timer">
        <div className="card-head">
          <div>
            <div className="eyebrow">Cronómetro</div>
            <h2>¿Qué empiezas?</h2>
          </div>
          <Icon name="clock" width={24} className="gold" />
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          Dale al llegar y detenlo al salir. Sigue contando aunque cierres la app.
        </p>
        <div className="hab-presets">
          {PRESETS.map((p) => (
            <button key={p.label} className="hab-preset" onClick={() => startTimer({ area: p.area, skillId: null, note: p.note ?? '' })}>
              <Icon name={p.icon} />
              {p.label}
            </button>
          ))}
          <button className={`hab-preset ${custom ? 'on' : ''}`} onClick={() => setCustom((x) => !x)}>
            <Icon name="plus" />
            Otra cosa…
          </button>
        </div>
        {custom && (
          <div style={{ marginTop: 12 }}>
            <Field label="¿En qué?">
              <AreaChips value={area} onChange={setArea} />
            </Field>
            {skills.length > 0 && (
              <Field label="Practicando (opcional)">
                <select className="input" value={skillId} onChange={(e) => setSkillId(e.target.value)}>
                  <option value="">— Ninguna —</option>
                  {skills.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.data.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Nota (opcional)">
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={area ? AREA_HINT[area] : ''} />
            </Field>
            <button
              className="btn primary block"
              disabled={!area}
              onClick={() => {
                startTimer({ area: area!, skillId: skillId || null, note: note.trim() });
                setCustom(false);
                setNote('');
              }}
            >
              <Icon name="play" /> Empezar
            </button>
          </div>
        )}
      </div>
    );
  }

  const skillName = timer.skillId ? (byId.get(timer.skillId)?.data as SkillData | undefined)?.name : null;
  return (
    <div className="card hab-timer live" style={{ borderColor: `color-mix(in srgb, ${AREA_COLOR[timer.area]} 55%, var(--line))` }}>
      <div className="row between">
        <div className="eyebrow">
          <i className="hab-live" style={{ background: AREA_COLOR[timer.area] }} /> En curso
        </div>
        <span className="tiny muted">desde {new Date(timer.startedAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: GAME_CONFIG.timezone })}</span>
      </div>
      <div className="hab-clock num">{fmtClock(now - timer.startedAt)}</div>
      <div className="hab-timer-what">
        <b>{TIME_AREA_NAMES[timer.area]}</b>
        {timer.note && <span> · {timer.note}</span>}
        {skillName && <span> · {skillName}</span>}
      </div>
      {editing && <TimerEdit timer={timer} onDone={() => setEditing(false)} />}
      {!editing && (
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button className="btn primary grow" onClick={() => setStopping(true)}>
            <Icon name="stop" /> Detener y guardar
          </button>
          <button className="btn" onClick={() => setEditing(true)} aria-label="Cambiar área o nota">
            <Icon name="edit" />
          </button>
          <button className="btn ghost danger" onClick={() => confirmAction('¿Descartar este cronómetro sin guardar?') && clearTimer()} aria-label="Descartar">
            <Icon name="trash" />
          </button>
        </div>
      )}
      {stopping && <StopSheet timer={timer} onClose={() => setStopping(false)} />}
    </div>
  );
}

function TimerEdit({ timer, onDone }: { timer: RunningTimer; onDone: () => void }) {
  const { list } = useGame();
  const skills = list<SkillData>('skills', 'skill');
  return (
    <div style={{ marginTop: 12 }}>
      <Field label="¿En qué?">
        <AreaChips value={timer.area} onChange={(area) => updateTimer({ area })} />
      </Field>
      {skills.length > 0 && (
        <Field label="Practicando (opcional)">
          <select className="input" value={timer.skillId ?? ''} onChange={(e) => updateTimer({ skillId: e.target.value || null })}>
            <option value="">— Ninguna —</option>
            {skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.data.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Nota">
        <input className="input" value={timer.note} onChange={(e) => updateTimer({ note: e.target.value })} placeholder={AREA_HINT[timer.area]} />
      </Field>
      <button className="btn block" onClick={onDone}>
        Listo
      </button>
    </div>
  );
}

function StopSheet({ timer, onClose }: { timer: RunningTimer; onClose: () => void }) {
  const [endAt] = useState(() => Date.now());
  const elapsed = Math.round((endAt - timer.startedAt) / 60000);
  const review = needsReview(timer.startedAt, endAt);
  const [hours, setHours] = useState(String(Math.floor(elapsed / 60)));
  const [mins, setMins] = useState(String(elapsed % 60));
  const [note, setNote] = useState(timer.note);
  const minutes = Math.round((Number(hours) || 0) * 60 + (Number(mins) || 0));
  const chunks = useMemo(() => splitTimerSpan(timer.startedAt, timer.startedAt + minutes * 60000), [timer.startedAt, minutes]);
  const tooLong = minutes > elapsed;
  return (
    <Sheet
      open
      onClose={onClose}
      title={`${TIME_AREA_NAMES[timer.area]}: ${fmtHoursMinutes(minutes)}`}
      actions={
        chunks.length ? (
          <button
            className="btn primary"
            disabled={tooLong}
            onClick={() => {
              const evs = logTimeSpan(timer.startedAt, timer.startedAt + minutes * 60000, { area: timer.area, skillId: timer.skillId, note });
              clearTimer();
              undoToast(`${fmtHoursMinutes(minutes)} de ${TIME_AREA_NAMES[timer.area].toLowerCase()} guardadas`, () => {
                evs.forEach((e) => voidEvent(e.id));
                startTimer({ area: timer.area, skillId: timer.skillId, note: timer.note }, timer.startedAt);
              });
              onClose();
            }}
          >
            Guardar
          </button>
        ) : (
          <button
            className="btn"
            onClick={() => {
              clearTimer();
              toast('Menos de un minuto: no se guardó nada.');
              onClose();
            }}
          >
            Descartar
          </button>
        )
      }
    >
      {review && (
        <div className="banner warn" style={{ fontSize: 13 }}>
          <Icon name="clock" width={18} /> Lleva {fmtHoursMinutes(elapsed)}. ¿Se te olvidó detenerlo? Ajusta la duración real.
        </div>
      )}
      <div className="grid2" style={{ gap: 10 }}>
        <Field label="Horas">
          <input className="input" type="number" inputMode="numeric" min={0} value={hours} onChange={(e) => setHours(e.target.value)} />
        </Field>
        <Field label="Minutos">
          <input className="input" type="number" inputMode="numeric" min={0} max={59} value={mins} onChange={(e) => setMins(e.target.value)} />
        </Field>
      </div>
      {tooLong && <p className="tiny red">No puede ser más de lo que lleva corriendo ({fmtHoursMinutes(elapsed)}).</p>}
      <Field label="Nota">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={AREA_HINT[timer.area]} />
      </Field>
      {chunks.length > 1 && (
        <p className="tiny muted">
          Cruzó la medianoche: se guarda por día ({chunks.map((c) => `${fmtDate(c.date)} ${fmtHoursMinutes(c.minutes)}`).join(' · ')}).
        </p>
      )}
      <p className="tiny muted" style={{ marginBottom: 0 }}>
        No da XP: es registro de a qué le dedicas tu tiempo.
      </p>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------
// Semana
// ---------------------------------------------------------------------------------------------

type WeekView = 'area' | 'skill' | 'day';

function WeekCard() {
  const { state, byId } = useGame();
  const [view, setView] = useState<WeekView>('area');
  const cmp = useMemo(() => timeWeekCompare(state.time.entries, state.today), [state.time.entries, state.today]);
  const tw = cmp.thisWeek;
  const prev = cmp.lastWeekToDate;
  const delta = tw.total - prev.total;
  if (!tw.total && !cmp.lastWeek.total) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Tu semana</h2>
        <Empty>Registra tu tiempo unos días y aquí verás en qué se te va la semana (y contra la pasada).</Empty>
      </div>
    );
  }
  const areaRows = TIME_AREAS.map((a) => ({ a, v: tw.byArea[a], p: prev.byArea[a] }))
    .filter((x) => x.v || x.p)
    .sort((x, y) => y.v - x.v || y.p - x.p);
  const skillIds = [...new Set([...Object.keys(tw.bySkill), ...Object.keys(prev.bySkill)])].sort((a, b) => (tw.bySkill[b] ?? 0) - (tw.bySkill[a] ?? 0));
  const max = Math.max(1, ...areaRows.map((x) => Math.max(x.v, x.p)));
  const smax = Math.max(1, ...skillIds.map((id) => Math.max(tw.bySkill[id] ?? 0, prev.bySkill[id] ?? 0)));
  const ws = weekStart(state.today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const dayVal = (d: string) => state.time.byDate[d] ?? 0;
  const dmax = Math.max(1, ...days.map((d) => Math.max(dayVal(d), dayVal(addDays(d, -7)))));
  return (
    <div className="card">
      <div className="card-head" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="eyebrow">Esta semana</div>
          <div className="stat-big hab-n">{fmtHoursMinutes(tw.total)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="tiny muted">Semana pasada a estas alturas</div>
          <div className="small">
            {fmtHoursMinutes(prev.total)}{' '}
            {prev.total > 0 && delta !== 0 && <span className="badge">{`${delta > 0 ? '+' : '−'}${fmtHoursMinutes(Math.abs(delta))}`}</span>}
          </div>
        </div>
      </div>
      <Tabs<WeekView>
        value={view}
        onChange={setView}
        options={[
          { value: 'area', label: 'Por área' },
          { value: 'skill', label: 'Por habilidad' },
          { value: 'day', label: 'Por día' },
        ]}
      />
      {view === 'area' &&
        areaRows.map(({ a, v, p }) => (
          <div key={a} className="hab-row">
            <div className="hab-row-head">
              <span>
                <AreaDot area={a} /> {TIME_AREA_NAMES[a]}
              </span>
              <span className="hab-n">
                {fmtHoursMinutes(v)}
                {tw.total > 0 && <small className="muted"> · {Math.round((v / tw.total) * 100)}%</small>}
              </span>
            </div>
            <HBar value={v} ghost={p} max={max} color={AREA_COLOR[a]} />
            {p > 0 && <div className="tiny faint">antes {fmtHoursMinutes(p)}</div>}
          </div>
        ))}
      {view === 'skill' &&
        (skillIds.length ? (
          skillIds.map((id) => {
            const v = tw.bySkill[id] ?? 0;
            const p = prev.bySkill[id] ?? 0;
            return (
              <div key={id} className="hab-row">
                <div className="hab-row-head">
                  <span>{(byId.get(id)?.data as SkillData | undefined)?.name ?? 'Habilidad borrada'}</span>
                  <span className="hab-n">{fmtHoursMinutes(v)}</span>
                </div>
                <HBar value={v} ghost={p} max={smax} color="var(--violet-2)" />
                {p > 0 && <div className="tiny faint">antes {fmtHoursMinutes(p)}</div>}
              </div>
            );
          })
        ) : (
          <Empty>Cuando registres tiempo practicando una habilidad, aparece aquí.</Empty>
        ))}
      {view === 'day' && (
        <div className="hab-days" role="img" aria-label="Horas por día: esta semana contra la pasada">
          {days.map((d) => {
            const v = dayVal(d);
            const p = dayVal(addDays(d, -7));
            const future = d > state.today;
            return (
              <div key={d} className={`hab-daycol ${d === state.today ? 'today' : ''}`}>
                <div className="hab-daybars">
                  <b style={{ height: `${(p / dmax) * 100}%` }} title={`Semana pasada: ${fmtHoursMinutes(p)}`} />
                  <i style={{ height: `${future ? 0 : (v / dmax) * 100}%` }} title={fmtHoursMinutes(v)} />
                </div>
                <span>{fmtWeekday(d).slice(0, 2)}</span>
                <small className="hab-n">{v ? `${Math.round(v / 6) / 10}` : '·'}</small>
              </div>
            );
          })}
        </div>
      )}
      <div className="legend">
        <span>
          <i style={{ background: 'var(--gold)' }} /> Esta semana
        </span>
        <span>
          <i style={{ background: 'var(--card-2)', border: '1px solid var(--line)' }} /> Semana pasada {view === 'day' ? '' : 'a estas alturas'}
        </span>
        {view === 'day' && <span>Números en horas</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Línea del día
// ---------------------------------------------------------------------------------------------

function DayCard() {
  const { state, byId } = useGame();
  const [day, setDay] = useState(state.today);
  const tl = useMemo(() => dayTimeline(state.time.entries, day), [state.time.entries, day]);
  const first = Math.min(6 * 60, ...tl.blocks.map((b) => Math.floor(b.startMin / 60) * 60));
  const last = Math.max(22 * 60, ...tl.blocks.map((b) => Math.ceil(b.endMin / 60) * 60));
  const span = last - first;
  const ticks: number[] = [];
  for (let m = first; m <= last; m += 180) ticks.push(m);
  const rows: TimeEntry[] = [...tl.blocks, ...tl.unscheduled];
  const skillName = (id: string | null) => (id ? ((byId.get(id)?.data as SkillData | undefined)?.name ?? null) : null);
  return (
    <div className="card">
      <div className="card-head">
        <h2>{day === state.today ? 'Hoy' : `${fmtWeekday(day)} ${fmtDate(day)}`}</h2>
        <span className="hab-n small">{fmtHoursMinutes(tl.total)}</span>
      </div>
      <DateChips value={day} onChange={setDay} today={state.today} />
      {tl.blocks.length > 0 && (
        <div className="hab-timeline" aria-label="Línea del día">
          <div className="hab-track">
            {tl.blocks.map((b) => (
              <i
                key={b.id}
                style={{ left: `${((b.startMin - first) / span) * 100}%`, width: `${Math.max(0.8, ((b.endMin - b.startMin) / span) * 100)}%`, background: AREA_COLOR[b.area] }}
                title={`${b.start} ${TIME_AREA_NAMES[b.area]} ${fmtHoursMinutes(b.minutes)}`}
              />
            ))}
          </div>
          <div className="hab-ticks">
            {ticks.map((m) => (
              <span key={m} style={{ left: `${((m - first) / span) * 100}%` }}>
                {String(Math.floor(m / 60) % 24).padStart(2, '0')}
              </span>
            ))}
          </div>
        </div>
      )}
      {!rows.length && <Empty>Sin tiempo registrado este día.</Empty>}
      {rows.map((t) => (
        <div key={t.id} className="item">
          <AreaDot area={t.area} />
          <div className="grow">
            <div className="item-title">
              {TIME_AREA_NAMES[t.area]} · <span className="hab-n">{fmtHoursMinutes(t.minutes)}</span>
            </div>
            <div className="tiny muted">{[t.start ? `desde ${t.start}` : '', skillName(t.skillId), t.note].filter(Boolean).join(' · ') || 'sin detalles'}</div>
          </div>
          <button
            className="btn icon ghost"
            aria-label="Quitar registro"
            onClick={() => {
              voidEvent(t.id);
              undoToast('Registro quitado', () => restoreEvent(t.id));
            }}
          >
            <Icon name="x" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// En qué se te va el tiempo y promedios
// ---------------------------------------------------------------------------------------------

function InsightsCard() {
  const { state } = useGame();
  const ins = useMemo(() => timeInsights(state.time.entries, state.today), [state.time.entries, state.today]);
  const groups = timeByGroup(state.time.weekByArea);
  const total = state.time.weekMinutes;
  if (!ins.length && !total) return null;
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>En qué se te va el tiempo</h2>
      {total > 0 && (
        <>
          <div className="hab-stack" aria-label="Reparto de la semana">
            {TIME_GROUPS.filter((g) => groups[g] > 0).map((g) => (
              <i key={g} style={{ width: `${(groups[g] / total) * 100}%`, background: GROUP_COLOR[g] }} title={`${TIME_GROUP_NAMES[g]}: ${fmtHoursMinutes(groups[g])}`} />
            ))}
          </div>
          <div className="legend" style={{ marginTop: 6 }}>
            {TIME_GROUPS.map((g) => (
              <span key={g}>
                <i style={{ background: GROUP_COLOR[g] }} />
                {TIME_GROUP_NAMES[g]} {fmtHoursMinutes(groups[g])}
              </span>
            ))}
          </div>
          <p className="tiny faint" style={{ margin: '6px 0 0' }}>
            Construir = {TIME_AREAS.filter((a) => TIME_AREA_GROUP[a] === 'construir').map((a) => TIME_AREA_NAMES[a].toLowerCase()).join(', ')}.
          </p>
        </>
      )}
      {ins.length > 0 && (
        <ul className="hab-insights">
          {ins.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AveragesCard() {
  const { state } = useGame();
  const avg = useMemo(() => timeAverages(state.time.entries, state.today), [state.time.entries, state.today]);
  if (!avg.loggedDays) return null;
  const top = topAreas(avg.perLoggedDay, 6);
  return (
    <div className="card">
      <div className="card-head">
        <h2>Promedios</h2>
        <span className="tiny muted">últimos {avg.days} días</span>
      </div>
      <div className="grid2" style={{ marginBottom: 10 }}>
        <div>
          <div className="tiny muted">Registras por día</div>
          <div className="small hab-n" style={{ fontWeight: 750 }}>
            {fmtHoursMinutes(avg.total / avg.loggedDays)}
          </div>
        </div>
        <div>
          <div className="tiny muted">Días con registro</div>
          <div className="small hab-n" style={{ fontWeight: 750 }}>
            {avg.loggedDays} de {avg.days}
          </div>
        </div>
        {avg.workdayAvg !== null && (
          <div>
            <div className="tiny muted">Un día de trabajo dura</div>
            <div className="small hab-n" style={{ fontWeight: 750 }}>
              {fmtHoursMinutes(avg.workdayAvg)}
            </div>
          </div>
        )}
      </div>
      <div className="tiny muted" style={{ marginBottom: 4 }}>
        En un día con registro, en promedio:
      </div>
      {top.map(({ area, minutes }) => (
        <div key={area} className="row between small" style={{ padding: '3px 0' }}>
          <span>
            <AreaDot area={area} /> {TIME_AREA_NAMES[area]}
          </span>
          <span className="hab-n">{fmtHoursMinutes(minutes)}</span>
        </div>
      ))}
    </div>
  );
}
