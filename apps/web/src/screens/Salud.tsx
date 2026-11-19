import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  BLOOD_TYPES,
  CHECKUP_CATEGORIES,
  CHECKUP_CATEGORY_NAMES,
  HEALTH_DISCLAIMER,
  HEALTH_METRIC_INFO,
  addDays,
  addMonthsClamped,
  checkupEveryText,
  diffDays,
  fmtHealthMetric,
  healthSuggestionsFor,
  suggestionCheckupId,
  type CheckupData,
  type CheckupState,
  type Entity,
  type HealthMetricEntry,
  type HealthMetricKind,
  type HealthProfileData,
  type HealthSuggestionFit,
  type MissionSize,
} from '@igv/core';
import { deleteEntity, saveEntity, useGame, voidEvent } from '../data/store';
import { CATEGORY_ICON, activateMany, activateSuggestion, checkupSizeOf, checkupXpOf, saveCheckup, saveHealthCard } from '../lib/health';
import { fmtDate, fmtNum } from '../lib/time';
import { Badge, Chips, Collapse, Empty, Field, PageHeader, Sheet, SizeChips, confirmAction, undoToast } from '../ui/kit';
import { Icon } from '../ui/icons';
import { CheckupDoneForm, HealthQuick, MetricForm } from '../ui/quick/HealthQuick';
import '../styles/salud.css';

type SheetState =
  | { type: 'quick' }
  | { type: 'done'; id: string }
  | { type: 'last'; id: string }
  | { type: 'edit'; id?: string }
  | { type: 'metric'; kind?: HealthMetricKind }
  | { type: 'card' }
  | null;

/** Salud: chequeos preventivos (qué ya te toca), mediciones con su referencia y ficha médica. */
export default function Salud() {
  const { state, list } = useGame();
  const [sheet, setSheet] = useState<SheetState>(null);
  const today = state.today;
  const all = list<CheckupData>('health', 'checkup');
  const byId = new Map(all.map((c) => [c.id, c]));
  const active = all.filter((c) => c.data.active !== false);
  const paused = all.filter((c) => c.data.active === false);
  const close = () => setSheet(null);
  const target = sheet && 'id' in sheet && sheet.id ? byId.get(sheet.id) : undefined;

  return (
    <>
      <PageHeader
        title="Salud"
        eyebrow="Más"
        right={
          <button className="btn sm primary" onClick={() => setSheet({ type: 'quick' })}>
            <Icon name="plus" /> Registrar
          </button>
        }
      />
      <Hero />
      {active.length === 0 ? (
        <Suggestions onboarding />
      ) : (
        <>
          <DueCard checkups={byId} onDone={(id) => setSheet({ type: 'done', id })} onLast={(id) => setSheet({ type: 'last', id })} onOpen={(id) => setSheet({ type: 'edit', id })} />
          <Upcoming checkups={active} onOpen={(id) => setSheet({ type: 'edit', id })} onNew={() => setSheet({ type: 'edit' })} />
          <Suggestions />
        </>
      )}
      <Metrics onNew={(kind) => setSheet({ type: 'metric', kind })} />
      <MedicalCard onEdit={() => setSheet({ type: 'card' })} />
      {paused.length > 0 && (
        <Collapse title={`Pausados (${paused.length})`}>
          {paused.map((c) => (
            <div key={c.id} className="salud-row tap" onClick={() => setSheet({ type: 'edit', id: c.id })}>
              <CatIcon c={c} />
              <div className="grow">
                <div className="salud-name">{c.data.name}</div>
                <div className="salud-sub">{checkupEveryText(c.data.everyMonths)} · no cuenta en tu puntaje</div>
              </div>
              <button
                className="btn sm"
                onClick={(e) => {
                  e.stopPropagation();
                  saveEntity<CheckupData>({ ...c, data: { ...c.data, active: true } });
                }}
              >
                Reactivar
              </button>
            </div>
          ))}
        </Collapse>
      )}
      <History />
      <p className="salud-note" style={{ justifyContent: 'center', marginBottom: 24 }}>
        <Icon name="shield" /> {HEALTH_DISCLAIMER}
      </p>

      {sheet?.type === 'quick' && (
        <Sheet open onClose={close} title="Registrar salud">
          <QuickInSheet onDone={close} />
        </Sheet>
      )}
      {sheet?.type === 'done' && target && (
        <Sheet open onClose={close} title={target.data.name}>
          <CheckupDoneForm checkup={target} today={today} onDone={close} />
        </Sheet>
      )}
      {sheet?.type === 'last' && target && <LastDoneSheet checkup={target} onClose={close} />}
      {sheet?.type === 'edit' && <CheckupSheet checkup={sheet.id ? byId.get(sheet.id) : undefined} onClose={close} />}
      {sheet?.type === 'metric' && (
        <Sheet open onClose={close} title="Nueva medición">
          <MetricInSheet kind={sheet.kind} onDone={close} />
        </Sheet>
      )}
      {sheet?.type === 'card' && <CardSheet onClose={close} />}
    </>
  );
}

function QuickInSheet({ onDone }: { onDone: () => void }) {
  const { state } = useGame();
  const [date, setDate] = useState(state.today);
  return <HealthQuick date={date} setDate={setDate} today={state.today} onDone={onDone} />;
}

function MetricInSheet({ kind, onDone }: { kind?: HealthMetricKind; onDone: () => void }) {
  const { state } = useGame();
  const [date, setDate] = useState(state.today);
  return <MetricForm date={date} setDate={setDate} today={state.today} onDone={onDone} initialKind={kind} />;
}

// ---------------------------------------------------------------------------
// Encabezado: "Tu salud"
// ---------------------------------------------------------------------------

function Hero() {
  const { state } = useGame();
  const h = state.health;
  const today = state.today;
  const week = state.body.sleep.filter((s) => s.date >= addDays(today, -6) && s.date <= today);
  const sleepAvg = week.length ? week.reduce((s, x) => s + x.hours, 0) / week.length : null;
  const w = state.body.lastWeight;
  const pct = h.score;
  const color = pct === null ? 'var(--faint)' : pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--gold)' : 'var(--flame)';
  const r = 44;
  const circ = 2 * Math.PI * r;
  const late = h.counts.atrasado;
  const line =
    pct === null
      ? 'Activa tus chequeos para medir qué tan al día vas.'
      : late
        ? `${late} ${late === 1 ? 'chequeo atrasado' : 'chequeos atrasados'}. Ponte al día y sube tu puntaje.`
        : h.counts.sinRegistro
          ? `${h.counts.sinRegistro} sin registro: anota cuándo fue la última vez.`
          : h.counts.pronto
            ? `Todo en orden; ${h.counts.pronto} ${h.counts.pronto === 1 ? 'te toca' : 'te tocan'} pronto.`
            : 'Todo al día. Así se hace.';
  return (
    <div className="card">
      <div className="salud-hero">
        <div className="salud-ring" role="img" aria-label={pct === null ? 'Sin chequeos activos' : `${pct}% de tus chequeos al día`}>
          <svg viewBox="0 0 104 104">
            <circle cx="52" cy="52" r={r} fill="none" stroke="var(--card-2)" strokeWidth="9" />
            <circle cx="52" cy="52" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - (pct ?? 0) / 100)} />
          </svg>
          <div className="salud-ring-val">
            <div>
              <b>{pct === null ? '—' : `${pct}%`}</b>
              <small>al día</small>
            </div>
          </div>
        </div>
        <div className="salud-hero-text">
          <div className="eyebrow">Tu salud</div>
          <h2>{pct === null ? 'Sin chequeos activos' : `${h.counts.alDia + h.counts.pronto} de ${h.counts.active} chequeos al día`}</h2>
          <div className="small muted">{line}</div>
        </div>
      </div>
      <div className="salud-tiles">
        <div className="stat-tile">
          <span>Sueño 7 d</span>
          <b>{sleepAvg === null ? '—' : `${sleepAvg.toFixed(1)} h`}</b>
          <em>{sleepAvg === null ? 'sin check-in' : `${week.length} ${week.length === 1 ? 'noche' : 'noches'}`}</em>
        </div>
        <Link to="/cuerpo" className="stat-tile">
          <span>Peso</span>
          <b>{w ? `${w.kg} kg` : '—'}</b>
          <em>{w ? fmtDate(w.date) : 'sin registro'}</em>
        </Link>
        <div className="stat-tile">
          <span>Este año</span>
          <b>{h.doneThisYear}</b>
          <em>{h.xpThisYear ? `+${fmtNum(h.xpThisYear)} XP` : 'chequeos'}</em>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chequeos
// ---------------------------------------------------------------------------

function CatIcon({ c, status }: { c: Entity<CheckupData>; status?: string }) {
  return (
    <div className={`salud-ico ${status ?? ''}`}>
      <Icon name={CATEGORY_ICON[c.data.category] ?? 'salud-cross'} />
    </div>
  );
}

/** "en 12 días", "hace 3 meses", "hoy". */
function rel(days: number): string {
  if (days === 0) return 'hoy';
  if (days === 1) return 'mañana';
  if (days === -1) return 'ayer';
  const n = Math.abs(days);
  let t: string;
  if (n < 60) t = `${n} días`;
  else if (n < 730) t = `${Math.round(n / 30.44)} meses`;
  else t = `${Math.floor(n / 365.25)} años`;
  return days > 0 ? `en ${t}` : `hace ${t}`;
}

function DueCard({ checkups, onDone, onLast, onOpen }: { checkups: Map<string, Entity<CheckupData>>; onDone: (id: string) => void; onLast: (id: string) => void; onOpen: (id: string) => void }) {
  const { state } = useGame();
  const h = state.health;
  const rows = [...h.due.map((d) => d.checkupId), ...h.unknown].map((id) => [checkups.get(id), h.checkups[id]] as const).filter((x): x is [Entity<CheckupData>, CheckupState] => !!x[0] && !!x[1]);
  const next = Object.values(h.checkups)
    .filter((c) => c.active && c.nextDue)
    .sort((a, b) => (a.nextDue! < b.nextDue! ? -1 : 1))[0];
  return (
    <div className="card">
      <div className="card-head">
        <h2>Ya te toca</h2>
        {rows.length > 0 && <Badge tone={h.counts.atrasado ? 'red' : 'flame'}>{rows.length}</Badge>}
      </div>
      {rows.length === 0 && (
        <div className="salud-allgood">
          <Icon name="check" />
          <div>
            Todo al día.
            {next && (
              <div className="salud-sub" style={{ fontWeight: 500 }}>
                Lo siguiente: {next.name}, {fmtDate(next.nextDue, true)} ({rel(next.daysLeft!)}).
              </div>
            )}
          </div>
        </div>
      )}
      {rows.map(([c, st]) => (
        <div key={c.id} className="salud-row">
          <CatIcon c={c} status={st.status} />
          <div className="grow">
            <button className="salud-name salud-plain" onClick={() => onOpen(c.id)}>
              {c.data.name}
            </button>
            {st.status === 'sin_registro' ? (
              <div className="salud-sub">
                Sin registro ·{' '}
                <button className="salud-link" onClick={() => onLast(c.id)}>
                  ¿cuándo fue la última vez?
                </button>
              </div>
            ) : (
              <div className={`salud-sub ${st.status}`}>
                {st.status === 'atrasado' ? `Atrasado · tocaba ${rel(st.daysLeft!)}` : st.daysLeft === 0 ? 'Te toca hoy' : `Te toca ${rel(st.daysLeft!)} · ${fmtDate(st.nextDue)}`}
              </div>
            )}
          </div>
          {st.doneToday ? (
            <Badge tone="green">Hecho hoy</Badge>
          ) : (
            <button className="btn sm primary salud-do" onClick={() => onDone(c.id)}>
              Ya lo hice <small>+{st.xp}</small>
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Upcoming({ checkups, onOpen, onNew }: { checkups: Entity<CheckupData>[]; onOpen: (id: string) => void; onNew: () => void }) {
  const { state } = useGame();
  const items = checkups
    .map((c) => [c, state.health.checkups[c.id]] as const)
    .filter(([, st]) => st && st.status === 'al_dia')
    .sort(([, a], [, b]) => (a.nextDue ?? '9999') < (b.nextDue ?? '9999') ? -1 : 1);
  return (
    <div className="card">
      <div className="card-head">
        <h2>Al día</h2>
        <button className="btn sm ghost" onClick={onNew}>
          <Icon name="plus" /> Chequeo
        </button>
      </div>
      {items.length === 0 && <Empty>Cuando registres un chequeo, aquí verás cuánto falta para el siguiente.</Empty>}
      {items.map(([c, st]) => (
        <div key={c.id} className="salud-row tap" onClick={() => onOpen(c.id)}>
          <CatIcon c={c} status="al_dia" />
          <div className="grow">
            <div className="salud-name">{c.data.name}</div>
            <div className="salud-sub">
              {st.nextDue ? `Siguiente ${rel(st.daysLeft!)} · ${fmtDate(st.nextDue, true)}` : `Hecho ${fmtDate(st.lastDone, true)} · una sola vez`}
            </div>
            {st.elapsed !== null && (
              <div className="salud-cool" aria-hidden="true">
                <i style={{ width: `${Math.round(Math.min(1, st.elapsed) * 100)}%` }} />
              </div>
            )}
          </div>
          <Icon name="right" width={16} className="muted" />
        </div>
      ))}
    </div>
  );
}

function Suggestions({ onboarding = false }: { onboarding?: boolean }) {
  const { state, list } = useGame();
  const all = list<CheckupData>('health', 'checkup');
  const known = new Set(all.map((c) => c.data.suggestionId).filter(Boolean) as string[]);
  const fits = healthSuggestionsFor(state.settings.birthDate, state.today);
  const pending = fits.filter((s) => !known.has(s.id) && !all.some((c) => c.id === suggestionCheckupId(s.id)) && s.applies !== false);
  const recommended = pending.filter((s) => s.recommended);
  const hiddenByAge = fits.filter((s) => s.applies === false).length;
  if (!pending.length && !onboarding) return null;
  const body = (
    <>
      {onboarding && (
        <p className="small" style={{ marginTop: 0 }}>
          Lo que conviene revisarte cada cierto tiempo. Activa los tuyos y la app te avisa cuándo te toca. Cada chequeo que hagas suma XP a Fuerza física.
        </p>
      )}
      {recommended.length > 1 && (
        <button className="btn primary block" style={{ marginBottom: 6 }} onClick={() => activateMany(recommended)}>
          <Icon name="check" /> Activar las recomendadas ({recommended.length})
        </button>
      )}
      {pending.map((s) => (
        <SuggestionRow key={s.id} s={s} />
      ))}
      {!pending.length && <Empty>Ya activaste todas las recomendaciones.</Empty>}
      {!state.settings.birthDate && fits.some((s) => s.ageText) && (
        <div className="salud-note">
          <Icon name="calendar" />
          <span>
            Agrega tu fecha de nacimiento en <Link to="/ajustes">Ajustes</Link> para ver solo las que te tocan por edad.
          </span>
        </div>
      )}
      {hiddenByAge > 0 && <div className="tiny muted" style={{ marginTop: 6 }}>{hiddenByAge} más aparecerán cuando te toquen por edad.</div>}
      <div className="salud-note">
        <Icon name="shield" />
        <span>{HEALTH_DISCLAIMER}</span>
      </div>
    </>
  );
  if (onboarding)
    return (
      <div className="card">
        <h2>Activa tus chequeos</h2>
        {body}
      </div>
    );
  return <Collapse title={`Recomendados (${pending.length})`}>{body}</Collapse>;
}

function SuggestionRow({ s }: { s: HealthSuggestionFit }) {
  return (
    <div className="salud-row">
      <div className="salud-ico">
        <Icon name={CATEGORY_ICON[s.category]} />
      </div>
      <div className="grow">
        <div className="salud-name">{s.name}</div>
        <div className="salud-sub">{s.why}</div>
        <div className="row wrap" style={{ gap: 4, marginTop: 5 }}>
          <Badge>{checkupEveryText(s.everyMonths)}</Badge>
          <Badge tone="gold">+{checkupXpOf(s)} XP</Badge>
          {s.ageText && <Badge tone={s.applies === null ? 'flame' : undefined}>{s.ageText}</Badge>}
        </div>
      </div>
      <button
        className="btn sm salud-do"
        onClick={() => {
          const e = activateSuggestion(s);
          undoToast(`Activado: ${s.name}`, () => deleteEntity(e.id));
        }}
      >
        Activar
      </button>
    </div>
  );
}

const EVERY_OPTIONS = [3, 6, 12, 24, 36, 60, 120, 0].map((n) => ({ value: n, label: n === 0 ? 'Una vez' : n < 12 ? `${n} meses` : n === 12 ? '1 año' : `${n / 12} años` }));

function CheckupSheet({ checkup, onClose }: { checkup?: Entity<CheckupData>; onClose: () => void }) {
  const { state } = useGame();
  const today = state.today;
  const [d, setD] = useState<CheckupData>(checkup?.data ?? { name: '', category: 'consulta', everyMonths: 12, active: true });
  const st = checkup ? state.health.checkups[checkup.id] : null;
  const history = checkup ? state.health.history.filter((h) => h.checkupId === checkup.id) : [];
  const size = checkupSizeOf(d);
  const save = () => {
    const name = d.name.trim();
    if (!name) return;
    const data: CheckupData = { ...d, name, notes: d.notes?.trim() || undefined, lastDone: d.lastDone || null };
    saveCheckup(data, checkup?.id);
    onClose();
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={checkup ? 'Editar chequeo' : 'Nuevo chequeo'}
      actions={
        <>
          {checkup && (
            <button
              className="btn ghost danger"
              onClick={() => {
                if (!confirmAction('¿Borrar este chequeo? Tu historial y la XP que ganaste se conservan.')) return;
                deleteEntity(checkup.id);
                undoToast(`Borrado: ${checkup.data.name}`, () => saveEntity(checkup));
                onClose();
              }}
            >
              <Icon name="trash" /> Borrar
            </button>
          )}
          <button className="btn primary" disabled={!d.name.trim()} onClick={save}>
            Guardar
          </button>
        </>
      }
    >
      {st && (
        <div className="row wrap" style={{ gap: 4, marginBottom: 12 }}>
          <Badge tone={st.status === 'atrasado' ? 'red' : st.status === 'pronto' ? 'flame' : st.status === 'al_dia' ? 'green' : undefined}>
            {st.status === 'atrasado' ? 'Atrasado' : st.status === 'pronto' ? 'Te toca pronto' : st.status === 'al_dia' ? 'Al día' : 'Sin registro'}
          </Badge>
          {st.lastDone && <Badge>Última vez {fmtDate(st.lastDone, true)}</Badge>}
          {st.timesDone > 0 && <Badge tone="gold">{st.timesDone}× registrado</Badge>}
        </div>
      )}
      <Field label="Nombre">
        <input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Ej. Consulta con el cardiólogo" maxLength={200} />
      </Field>
      <Field label="Tipo">
        <Chips value={d.category} onChange={(category) => setD({ ...d, category })} options={CHECKUP_CATEGORIES.map((c) => ({ value: c, label: CHECKUP_CATEGORY_NAMES[c] }))} />
      </Field>
      <Field label="¿Cada cuánto toca?">
        <Chips value={EVERY_OPTIONS.some((o) => o.value === d.everyMonths) ? d.everyMonths : null} onChange={(everyMonths) => setD({ ...d, everyMonths })} options={EVERY_OPTIONS} />
        <div className="row" style={{ gap: 6, marginTop: 6 }}>
          <input
            className="input num"
            style={{ maxWidth: 90 }}
            type="number"
            inputMode="numeric"
            min={0}
            max={240}
            value={d.everyMonths}
            onChange={(e) => setD({ ...d, everyMonths: Math.max(0, Math.min(240, Math.floor(Number(e.target.value) || 0))) })}
            aria-label="Meses"
          />
          <span className="small muted">meses ({checkupEveryText(d.everyMonths)})</span>
        </div>
      </Field>
      <Field label="Premio al hacerlo">
        <SizeChips value={size} onChange={(s: MissionSize) => setD({ ...d, size: s })} />
      </Field>
      <Field label="Última vez, aproximada (sin XP)">
        <div className="row" style={{ gap: 6 }}>
          <input className="input" type="date" max={today} value={d.lastDone ?? ''} onChange={(e) => setD({ ...d, lastDone: e.target.value || null })} />
          {d.lastDone && (
            <button className="btn sm ghost" onClick={() => setD({ ...d, lastDone: null })}>
              Quitar
            </button>
          )}
        </div>
        {d.lastDone && d.everyMonths > 0 && <div className="tiny muted" style={{ marginTop: 4 }}>Con esa fecha te tocaría el {fmtDate(addMonthsClamped(d.lastDone, d.everyMonths), true)}. Un registro más reciente gana.</div>}
      </Field>
      <Field label="Notas">
        <textarea className="input" value={d.notes ?? ''} onChange={(e) => setD({ ...d, notes: e.target.value })} placeholder="Con quién, dónde, qué pedir…" maxLength={2000} />
      </Field>
      {checkup && (
        <label className="row" style={{ gap: 8, marginBottom: 12 }}>
          <input type="checkbox" checked={d.active !== false} onChange={(e) => setD({ ...d, active: e.target.checked })} />
          <span className="small">Activo (cuenta en "Ya te toca" y en tu puntaje)</span>
        </label>
      )}
      {history.length > 0 && (
        <details>
          <summary className="small muted" style={{ cursor: 'pointer' }}>
            Historial ({history.length})
          </summary>
          {history.map((h) => (
            <div key={h.eventId} className="item" style={{ padding: '6px 0' }}>
              <div className="grow small">
                {fmtDate(h.date, true)}
                {h.result && <span className="muted"> · {h.result}</span>}
                {h.note && <div className="tiny muted">{h.note}</div>}
              </div>
              <span className="tiny muted num">+{h.xp}</span>
              <button className="btn icon ghost danger" aria-label="Anular registro" onClick={() => confirmAction('¿Anular este registro? Se le quita su XP.') && voidEvent(h.eventId)}>
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </details>
      )}
    </Sheet>
  );
}

/** Anotar cuándo fue la última vez (sin XP), para que la app calcule la siguiente fecha. */
function LastDoneSheet({ checkup, onClose }: { checkup: Entity<CheckupData>; onClose: () => void }) {
  const { state } = useGame();
  const today = state.today;
  const [date, setDate] = useState<string>(addMonthsClamped(today, -6));
  const opts = [3, 6, 12, 24, 36].map((m) => ({ value: addMonthsClamped(today, -m), label: m < 12 ? `Hace ${m} meses` : m === 12 ? 'Hace 1 año' : `Hace ${m / 12} años` }));
  const next = checkup.data.everyMonths > 0 ? addMonthsClamped(date, checkup.data.everyMonths) : null;
  return (
    <Sheet
      open
      onClose={onClose}
      title={checkup.data.name}
      actions={
        <button
          className="btn primary"
          disabled={!date || date > today}
          onClick={() => {
            const prev = checkup;
            saveEntity<CheckupData>({ ...checkup, data: { ...checkup.data, lastDone: date } });
            undoToast('Fecha anotada', () => saveEntity(prev));
            onClose();
          }}
        >
          Guardar fecha
        </button>
      }
    >
      <p className="small" style={{ marginTop: 0 }}>
        ¿Cuándo fue la última vez? Es aproximado y no da XP: solo sirve para saber cuándo te vuelve a tocar.
      </p>
      <Chips value={opts.some((o) => o.value === date) ? date : null} onChange={setDate} options={opts} />
      <Field label="O una fecha">
        <input className="input" type="date" max={today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </Field>
      {next && (
        <div className={`salud-sub ${next < today ? 'atrasado' : diffDays(today, next) <= 30 ? 'pronto' : ''}`}>
          {next < today ? `Ya te tocaba desde el ${fmtDate(next, true)}.` : `Te toca el ${fmtDate(next, true)}.`}
        </div>
      )}
      <p className="tiny muted">Si no te acuerdas, probablemente ya te toca: mejor agéndalo.</p>
    </Sheet>
  );
}

function History() {
  const { state } = useGame();
  const h = state.health.history;
  if (!h.length) return null;
  return (
    <Collapse title={`Historial de chequeos (${h.length})`}>
      {h.slice(0, 60).map((x) => (
        <div key={x.eventId} className="item" style={{ padding: '7px 0' }}>
          <div className="grow small">
            <b>{x.name}</b>
            {x.result && <span className="muted"> · {x.result}</span>}
            <div className="tiny muted">{fmtDate(x.date, true)}</div>
          </div>
          <span className="tiny num" style={{ color: 'var(--gold)' }}>
            +{x.xp} XP
          </span>
          <button className="btn icon ghost danger" aria-label="Anular registro" onClick={() => confirmAction('¿Anular este registro? Se le quita su XP.') && voidEvent(x.eventId)}>
            <Icon name="trash" />
          </button>
        </div>
      ))}
    </Collapse>
  );
}

// ---------------------------------------------------------------------------
// Mediciones
// ---------------------------------------------------------------------------

const QUICK_KINDS: HealthMetricKind[] = ['presion', 'glucosa', 'colesterol', 'frecuencia_reposo'];

function Metrics({ onNew }: { onNew: (kind?: HealthMetricKind) => void }) {
  const { state } = useGame();
  const series = useMemo(() => Object.values(state.health.metrics).filter((s) => s.length > 0).sort((a, b) => (a.at(-1)!.date > b.at(-1)!.date ? -1 : 1)), [state.health.metrics]);
  const [sel, setSel] = useState<string | null>(null);
  const cur = series.find((s) => s[0].key === sel) ?? series[0];
  return (
    <div className="card">
      <div className="card-head">
        <h2>
          <Icon name="salud-pulse" width={18} style={{ verticalAlign: -3, marginRight: 6 }} />
          Mediciones
        </h2>
        <button className="btn sm ghost" onClick={() => onNew(cur?.[0].kind)}>
          <Icon name="plus" /> Medición
        </button>
      </div>
      {!cur ? (
        <>
          <Empty>Anota tu presión, glucosa o colesterol cuando te los midan y ve cómo cambian. Solo registro: no da XP.</Empty>
          <div className="chips" style={{ justifyContent: 'center' }}>
            {QUICK_KINDS.map((k) => (
              <button key={k} className="chip" onClick={() => onNew(k)}>
                {HEALTH_METRIC_INFO[k].name}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          {series.length > 1 && <Chips value={cur[0].key} onChange={setSel} options={series.map((s) => ({ value: s[0].key, label: s.at(-1)!.label }))} />}
          <MetricDetail series={cur} />
        </>
      )}
    </div>
  );
}

function MetricDetail({ series }: { series: HealthMetricEntry[] }) {
  const last = series.at(-1)!;
  const prev = series.length > 1 ? series.at(-2)! : null;
  const info = HEALTH_METRIC_INFO[last.kind];
  const val = fmtHealthMetric(last);
  const unit = last.unit;
  const main = unit ? val.slice(0, val.length - unit.length - 1) : val;
  return (
    <>
      <div className="salud-metric-head">
        <span className="salud-metric-val">
          {main}
          {unit && <small>{unit}</small>}
        </span>
        {last.levelText && <span className={`salud-level ${last.level}`}>{last.levelText}</span>}
      </div>
      <div className="tiny muted">
        {fmtDate(last.date, true)}
        {prev && ` · antes ${fmtHealthMetric(prev)} (${fmtDate(prev.date)})`}
        {last.note && ` · ${last.note}`}
      </div>
      <MetricChart series={series.slice(-30)} />
      <div className="tiny muted" style={{ marginTop: 8 }}>
        {last.kind === 'otro' ? 'Compáralo con el rango de referencia de tu estudio.' : info.reference} {HEALTH_DISCLAIMER}
      </div>
      <details style={{ marginTop: 10 }}>
        <summary className="small muted" style={{ cursor: 'pointer' }}>
          Registros ({series.length})
        </summary>
        {[...series].reverse().map((m) => (
          <div key={m.eventId} className="item" style={{ padding: '6px 0' }}>
            <div className="grow small">
              <b className="num">{fmtHealthMetric(m)}</b>
              {m.levelText && <span className={`salud-level ${m.level}`} style={{ marginLeft: 8 }}>{m.levelText}</span>}
              <div className="tiny muted">
                {fmtDate(m.date, true)}
                {m.note && ` · ${m.note}`}
              </div>
            </div>
            <button className="btn icon ghost danger" aria-label="Anular medición" onClick={() => confirmAction('¿Anular esta medición?') && voidEvent(m.eventId)}>
              <Icon name="trash" />
            </button>
          </div>
        ))}
      </details>
    </>
  );
}

/** Gráfica de una serie (dos líneas en la presión) con líneas de referencia y tooltip al pasar el dedo. */
function MetricChart({ series }: { series: HealthMetricEntry[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const kind = series[0].kind;
  const two = kind === 'presion';
  const guides = HEALTH_METRIC_INFO[kind].guides;
  const W = 320;
  const H = 150;
  const pad = { t: 12, b: 20, l: 26, r: 34 };
  const vals = series.flatMap((m) => (two && m.value2 !== undefined ? [m.value, m.value2] : [m.value]));
  let lo = Math.min(...vals, ...guides);
  let hi = Math.max(...vals, ...guides);
  const span0 = hi - lo || Math.max(1, hi * 0.1);
  lo -= span0 * 0.12;
  hi += span0 * 0.12;
  const first = series[0].date;
  const days = Math.max(0, diffDays(first, series.at(-1)!.date));
  const xs = series.map((m, i) => (series.length === 1 ? (W - pad.l - pad.r) / 2 + pad.l : days > 0 ? pad.l + (diffDays(first, m.date) / days) * (W - pad.l - pad.r) : pad.l + (i / (series.length - 1)) * (W - pad.l - pad.r)));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / (hi - lo));
  const path = (get: (m: HealthMetricEntry) => number | undefined) =>
    series
      .map((m, i) => [xs[i], get(m)] as const)
      .filter(([, v]) => v !== undefined)
      .map(([x, v], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y(v!).toFixed(1)}`)
      .join(' ');
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    xs.forEach((x, i) => {
      if (Math.abs(x - px) < Math.abs(xs[best] - px)) best = i;
    });
    setHover(best);
  };
  const last = series.at(-1)!;
  const h = hover !== null ? series[hover] : null;
  return (
    <div className="salud-chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${last.label}: ${series.length} registros`} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
        {guides.map((g) => (
          <g key={g}>
            <line className="guide" x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} />
            <text className="guide-lbl" x={pad.l - 4} y={y(g) + 3} textAnchor="end">
              {g}
            </text>
          </g>
        ))}
        {hover !== null && <line className="cross" x1={xs[hover]} x2={xs[hover]} y1={pad.t} y2={H - pad.b} />}
        {series.length > 1 && <path d={path((m) => m.value)} fill="none" stroke="var(--salud-s1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {two && series.length > 1 && <path d={path((m) => m.value2)} fill="none" stroke="var(--salud-s2)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {series.map((m, i) => (
          <g key={m.eventId}>
            <circle cx={xs[i]} cy={y(m.value)} r={hover === i ? 5 : 4} fill="var(--salud-s1)" stroke="var(--card)" strokeWidth={2} />
            {two && m.value2 !== undefined && <circle cx={xs[i]} cy={y(m.value2)} r={hover === i ? 5 : 4} fill="var(--salud-s2)" stroke="var(--card)" strokeWidth={2} />}
          </g>
        ))}
        <text className="guide-lbl" x={xs.at(-1)! + 8} y={y(last.value) + 3}>
          {fmt(last.value)}
        </text>
        {two && last.value2 !== undefined && (
          <text className="guide-lbl" x={xs.at(-1)! + 8} y={y(last.value2) + 3}>
            {fmt(last.value2)}
          </text>
        )}
        <text className="axis-lbl" x={pad.l} y={H - 5}>
          {fmtDate(first, true)}
        </text>
        {series.length > 1 && (
          <text className="axis-lbl" x={W - pad.r} y={H - 5} textAnchor="end">
            {fmtDate(last.date, true)}
          </text>
        )}
      </svg>
      {h && hover !== null && (
        <div className="salud-tip" style={{ left: `${Math.min(85, Math.max(15, (xs[hover] / W) * 100))}%` }}>
          {fmtDate(h.date, true)} · <b>{fmtHealthMetric(h)}</b>
          {h.levelText && <div className={`salud-level ${h.level}`}>{h.levelText}</div>}
        </div>
      )}
      {two ? (
        <div className="salud-legend">
          <span>
            <i style={{ background: 'var(--salud-s1)' }} />
            Sistólica
          </span>
          <span>
            <i style={{ background: 'var(--salud-s2)' }} />
            Diastólica
          </span>
          <span>
            <i style={{ background: 'none', borderTop: '1px dashed var(--faint)', height: 0 }} />
            Referencia
          </span>
        </div>
      ) : (
        series.length === 1 && <div className="tiny muted">Registra otra medición para ver la tendencia.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ficha médica
// ---------------------------------------------------------------------------

const telHref = (p?: string) => `tel:${(p ?? '').replace(/[^\d+]/g, '')}`;

function MedicalCard({ onEdit }: { onEdit: () => void }) {
  const { state } = useGame();
  const c = state.health.card ?? {};
  const has = Object.values(c).some((v) => typeof v === 'string' && v.trim());
  return (
    <div className="card">
      <div className="card-head">
        <h2>
          <Icon name="salud-card" width={18} style={{ verticalAlign: -3, marginRight: 6 }} />
          Ficha médica
        </h2>
        <button className="btn sm ghost" onClick={onEdit}>
          <Icon name="edit" /> {has ? 'Editar' : 'Llenar'}
        </button>
      </div>
      {!has ? (
        <Empty>Tipo de sangre, alergias, medicamentos y a quién llamar. Para tenerlo a la mano en una emergencia.</Empty>
      ) : (
        <dl className="salud-card-grid" style={{ margin: 0 }}>
          <div>
            <dt>Tipo de sangre</dt>
            <dd className="big">{c.bloodType || '—'}</dd>
          </div>
          <div>
            <dt>Alergias</dt>
            <dd className={c.allergies ? 'alert' : ''}>{c.allergies || 'Ninguna anotada'}</dd>
          </div>
          {c.conditions && (
            <div className="full">
              <dt>Padecimientos</dt>
              <dd>{c.conditions}</dd>
            </div>
          )}
          {c.medications && (
            <div className="full">
              <dt>Medicamentos</dt>
              <dd>{c.medications}</dd>
            </div>
          )}
          {(c.doctorName || c.doctorPhone) && (
            <div>
              <dt>Médico</dt>
              <dd>
                {c.doctorName}
                {c.doctorPhone && (
                  <div>
                    <a href={telHref(c.doctorPhone)}>{c.doctorPhone}</a>
                  </div>
                )}
              </dd>
            </div>
          )}
          {(c.emergencyName || c.emergencyPhone) && (
            <div>
              <dt>Emergencia</dt>
              <dd>
                {c.emergencyName}
                {c.emergencyPhone && (
                  <div>
                    <a href={telHref(c.emergencyPhone)}>{c.emergencyPhone}</a>
                  </div>
                )}
              </dd>
            </div>
          )}
          {(c.insurer || c.policyNumber) && (
            <div className="full">
              <dt>Seguro</dt>
              <dd>
                {c.insurer}
                {c.policyNumber && <span className="num"> · póliza {c.policyNumber}</span>}
              </dd>
            </div>
          )}
          {c.notes && (
            <div className="full">
              <dt>Notas</dt>
              <dd>{c.notes}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

function CardSheet({ onClose }: { onClose: () => void }) {
  const { state } = useGame();
  const [d, setD] = useState<HealthProfileData>(state.health.card ?? {});
  const set = (k: keyof HealthProfileData) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  return (
    <Sheet
      open
      onClose={onClose}
      title="Ficha médica"
      actions={
        <button
          className="btn primary"
          onClick={() => {
            saveHealthCard(d);
            onClose();
          }}
        >
          Guardar
        </button>
      }
    >
      <Field label="Tipo de sangre">
        <Chips value={d.bloodType ?? null} onChange={(bloodType) => setD({ ...d, bloodType: d.bloodType === bloodType ? '' : bloodType })} options={BLOOD_TYPES.map((b) => ({ value: b, label: b }))} />
      </Field>
      <Field label="Alergias">
        <input className="input" value={d.allergies ?? ''} onChange={set('allergies')} placeholder="Medicamentos, alimentos… (vacío = ninguna)" maxLength={1000} />
      </Field>
      <Field label="Padecimientos">
        <input className="input" value={d.conditions ?? ''} onChange={set('conditions')} placeholder="Asma, hipertensión…" maxLength={1000} />
      </Field>
      <Field label="Medicamentos que tomas">
        <input className="input" value={d.medications ?? ''} onChange={set('medications')} placeholder="Nombre y dosis" maxLength={1000} />
      </Field>
      <div className="grid2" style={{ gap: 10 }}>
        <Field label="Médico">
          <input className="input" value={d.doctorName ?? ''} onChange={set('doctorName')} maxLength={200} />
        </Field>
        <Field label="Teléfono">
          <input className="input" type="tel" inputMode="tel" value={d.doctorPhone ?? ''} onChange={set('doctorPhone')} maxLength={40} />
        </Field>
        <Field label="Contacto de emergencia">
          <input className="input" value={d.emergencyName ?? ''} onChange={set('emergencyName')} maxLength={200} />
        </Field>
        <Field label="Teléfono">
          <input className="input" type="tel" inputMode="tel" value={d.emergencyPhone ?? ''} onChange={set('emergencyPhone')} maxLength={40} />
        </Field>
        <Field label="Aseguradora">
          <input className="input" value={d.insurer ?? ''} onChange={set('insurer')} maxLength={200} />
        </Field>
        <Field label="Póliza">
          <input className="input" value={d.policyNumber ?? ''} onChange={set('policyNumber')} maxLength={100} />
        </Field>
      </div>
      <Field label="Notas">
        <textarea className="input" value={d.notes ?? ''} onChange={set('notes')} placeholder="Cirugías, donador de órganos, lo que deban saber…" maxLength={2000} />
      </Field>
    </Sheet>
  );
}
