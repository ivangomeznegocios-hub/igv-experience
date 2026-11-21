import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  DOCTOR_CADENCES,
  DOCTOR_CADENCE_NAMES,
  DOCTOR_DEFAULT_CADENCE,
  DOCTOR_DISCLAIMER,
  HEALTH_METRIC_INFO,
  buildHealthDossier,
  healthDataGaps,
  healthFileScore,
  type CheckupData,
  type DoctorAction,
  type Entity,
  type HealthConsultEntry,
  type HealthDoctorData,
  type HealthMetricKind,
} from '@igv/core';
import { useGame } from '../../data/store';
import { medicoApi, type MedicoStatus } from '../../data/medicoApi';
import { activateActionCheckup, checkupForAction, markConsultSeen, requestConsult, saveDoctor, setActionState } from '../../lib/medico';
import { fmtDate } from '../../lib/time';
import { Badge, Chips, Field, Sheet, TextArea, TextInput, toast } from '../../ui/kit';
import { Icon } from '../../ui/icons';

/** Tu médico IA: revisiones con todo tu expediente, lo que te pide hacer, preguntas y lo que debe saber de ti. */

// ---------------------------------------------------------------------------------------------
// Estado del servicio (una vez por sesión)
// ---------------------------------------------------------------------------------------------

let statusCache: Promise<MedicoStatus | null> | null = null;
export function useMedicoStatus(): MedicoStatus | null | undefined {
  const [st, setSt] = useState<MedicoStatus | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    statusCache ??= medicoApi.status().catch(() => {
      statusCache = null;
      return null;
    });
    statusCache.then((s) => alive && setSt(s));
    return () => {
      alive = false;
    };
  }, []);
  return st;
}

const STATUS_NAME = { bien: 'Todo en orden', atencion: 'Hay que vigilar algo', importante: 'Atiéndelo pronto' } as const;
const TONE_ICON = { bien: 'check', atencion: 'bolt', pendiente: 'clock' } as const;
const TYPE_NAME: Record<DoctorAction['type'], string> = { chequeo: 'Chequeo', medicion: 'Medición', estudio: 'Estudio', consulta: 'Consulta', habito: 'Hábito', dato: 'Dato' };

// ---------------------------------------------------------------------------------------------
// Tarjeta corta (Resumen de Salud)
// ---------------------------------------------------------------------------------------------

export function DoctorTeaser({ onOpen }: { onOpen: () => void }) {
  const { state } = useGame();
  const c = state.health.consults[0];
  const pending = state.health.pendingActions;
  if (!c)
    return (
      <button className="card salud-doctor-teaser" onClick={onOpen}>
        <div className="salud-doctor-ico">
          <Icon name="salud-stethoscope" />
        </div>
        <div className="grow" style={{ textAlign: 'left' }}>
          <div className="eyebrow">Tu médico IA</div>
          <b>Revisa toda tu salud con IA</b>
          <div className="tiny muted">Lee tus estudios, mediciones, peso, sueño y entrenamiento, y te dice qué hacer. Empieza aquí.</div>
        </div>
        <Icon name="right" width={18} />
      </button>
    );
  return (
    <button className={`card salud-doctor-teaser ${c.status} ${state.health.unseenConsultId ? 'unseen' : ''}`} onClick={onOpen}>
      <div className="salud-doctor-ico">
        <Icon name="salud-stethoscope" />
      </div>
      <div className="grow" style={{ textAlign: 'left' }}>
        <div className="eyebrow">{state.health.unseenConsultId ? 'Tu médico te quiere decir algo' : `Tu médico · ${fmtDate(c.date, true)}`}</div>
        <b>{c.title}</b>
        <div className="tiny muted">{pending.length ? `${pending.length} ${pending.length === 1 ? 'cosa pendiente' : 'cosas pendientes'}: ${pending[0].text}` : 'Sin pendientes. Vas bien.'}</div>
      </div>
      <Icon name="right" width={18} />
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Expediente: datos que faltan
// ---------------------------------------------------------------------------------------------

export function ExpedienteCard({ compact = false }: { compact?: boolean }) {
  const { state } = useGame();
  const gaps = healthDataGaps(state);
  const score = healthFileScore(gaps);
  const missing = gaps.filter((g) => !g.done);
  if (compact && !missing.length) return null;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Tu expediente</h2>
        <Badge tone={score >= 80 ? 'green' : score >= 50 ? 'gold' : 'flame'}>{score}% completo</Badge>
      </div>
      <div className="salud-cool" style={{ marginBottom: 10 }} aria-hidden="true">
        <i style={{ width: `${score}%` }} />
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        {missing.length ? 'Tu médico IA te orienta mejor entre más datos reales tenga. Lo que falta:' : 'Tu médico tiene lo básico para orientarte. Mantenlo al día.'}
      </p>
      {(compact ? missing.slice(0, 4) : gaps).map((g) => (
        <Link key={g.id} to={g.to} className={`salud-gap ${g.done ? 'done' : ''}`}>
          <span className="salud-gap-check">{g.done ? <Icon name="check" width={14} /> : null}</span>
          <div className="grow">
            <div className="small" style={{ fontWeight: 600 }}>
              {g.label}
            </div>
            {!g.done && <div className="tiny muted">{g.why}</div>}
          </div>
          {!g.done && <Icon name="right" width={16} className="muted" />}
        </Link>
      ))}
      {compact && missing.length > 4 && <div className="tiny muted" style={{ marginTop: 6 }}>Y {missing.length - 4} más en Tu médico.</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Pestaña "Tu médico"
// ---------------------------------------------------------------------------------------------

export function Medico({ onMetric, onCard, goTab }: { onMetric: (k: HealthMetricKind) => void; onCard: () => void; goTab: (t: 'estudios' | 'mediciones' | 'chequeos') => void }) {
  const { state, entities } = useGame();
  const [params, setParams] = useSearchParams();
  const status = useMedicoStatus();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [focus, setFocus] = useState('');
  const [askFocus, setAskFocus] = useState(false);
  const [profile, setProfile] = useState(params.get('perfil') === '1');
  const h = state.health;
  const latest = h.consults[0] ?? null;
  const cadence = h.doctor.cadence ?? DOCTOR_DEFAULT_CADENCE;

  useEffect(() => {
    if (params.get('perfil') === '1') {
      const next = new URLSearchParams(params);
      next.delete('perfil');
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Abrir la revisión cuenta como "vista" (quita el aviso de Hoy).
  useEffect(() => {
    if (latest && !latest.seenAt) markConsultSeen(latest.id);
  }, [latest?.id, latest?.seenAt]);

  const ask = async (kind: 'inicial' | 'pedida') => {
    setBusy(true);
    setErr(null);
    try {
      await requestConsult(state, entities, kind, focus);
      setFocus('');
      setAskFocus(false);
      toast('Revisión lista');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo hacer la revisión. Intenta de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  const off = status === null ? 'Sin conexión con el servidor: tu médico IA necesita internet.' : status && !status.enabled ? 'Tu médico IA usa la misma clave de la API de Claude que el Coach (secreto ANTHROPIC_API_KEY del Worker en Cloudflare). Agrégala para activarlo.' : null;

  return (
    <>
      <div className="card salud-doctor-head">
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div className="salud-doctor-ico big">
            <Icon name="salud-stethoscope" />
          </div>
          <div className="grow">
            <div className="eyebrow">Tu médico IA</div>
            <h2 style={{ margin: '2px 0 4px' }}>{latest ? `Última revisión: ${fmtDate(latest.date, true)}` : 'Tu médico de cabecera, con tus datos'}</h2>
            <div className="small muted">
              {latest
                ? `${DOCTOR_CADENCE_NAMES[cadence]}${h.nextReview ? ` · la siguiente el ${fmtDate(h.nextReview, true)}` : ''}. Lee tu expediente completo: estudios, mediciones, peso, sueño, entrenamiento y hábitos.`
                : 'Lee todo tu expediente (estudios, mediciones, chequeos, peso, sueño, entrenamiento y hábitos), te dice qué va bien, qué vigilar y qué hacer, y te vuelve a revisar cada semana o mes.'}
            </div>
          </div>
        </div>
        {off && <div className="salud-note">{off}</div>}
        {err && <div className="salud-note" style={{ color: 'var(--red)' }}>{err}</div>}
        {askFocus && (
          <Field label="¿Algo en particular que quieras que revise? (opcional)">
            <TextInput className="input" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Me duele la espalda baja, quiero bajar grasa, mi colesterol…" maxLength={1000} />
          </Field>
        )}
        <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
          {latest ? (
            askFocus ? (
              <button className="btn primary" disabled={busy || !!off} onClick={() => ask('pedida')}>
                <Icon name="sparkles" /> {busy ? 'Revisando tu expediente…' : 'Pedir revisión'}
              </button>
            ) : (
              <button className="btn" disabled={busy || !!off} onClick={() => setAskFocus(true)}>
                <Icon name="refresh" /> Pedir una revisión ahora
              </button>
            )
          ) : (
            <button className="btn primary" disabled={busy || !!off} onClick={() => ask('inicial')}>
              <Icon name="sparkles" /> {busy ? 'Revisando tu expediente…' : 'Empezar mi primera revisión'}
            </button>
          )}
          <button className="btn ghost" onClick={() => setProfile(true)}>
            <Icon name="edit" /> Lo que debe saber de ti
          </button>
        </div>
        {busy && <div className="tiny muted" style={{ marginTop: 8 }}>Puede tardar hasta un minuto: está leyendo todo tu historial.</div>}
      </div>

      {latest ? <ConsultCard c={latest} onMetric={onMetric} goTab={goTab} /> : <ExpedienteCard />}
      {latest && <ExpedienteCard compact />}
      <DoctorChat disabled={!!off} />
      {h.consults.length > 1 && <ConsultHistory consults={h.consults.slice(1)} />}

      <div className="salud-note" style={{ justifyContent: 'center' }}>
        <Icon name="shield" />
        <span>{DOCTOR_DISCLAIMER}</span>
      </div>
      {profile && <DoctorProfileSheet onClose={() => setProfile(false)} onCard={onCard} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Una revisión
// ---------------------------------------------------------------------------------------------

function ConsultCard({ c, onMetric, goTab }: { c: HealthConsultEntry; onMetric: (k: HealthMetricKind) => void; goTab: (t: 'estudios' | 'mediciones' | 'chequeos') => void }) {
  const { list } = useGame();
  const checkups = list<CheckupData>('health', 'checkup');
  const pending = c.actions.filter((a) => !a.doneAt && !a.dismissedAt);
  const closed = c.actions.filter((a) => a.doneAt || a.dismissedAt);
  return (
    <div className={`card salud-consult ${c.status}`}>
      <div className="row between" style={{ gap: 8, alignItems: 'flex-start' }}>
        <span className={`salud-consult-status ${c.status}`}>{STATUS_NAME[c.status]}</span>
        <span className="tiny muted">
          {fmtDate(c.date, true)}
          {c.kind === 'inicial' ? ' · primera revisión' : c.kind === 'pedida' ? ' · la pediste tú' : ''}
        </span>
      </div>
      <h2 className="salud-consult-title">{c.title}</h2>
      {c.focus && <div className="tiny muted" style={{ marginBottom: 6 }}>Le pediste revisar: {c.focus}</div>}
      <div className="salud-consult-msg">
        {c.message.split(/\n{2,}/).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {c.highlights.length > 0 && (
        <ul className="salud-highlights">
          {c.highlights.map((x, i) => (
            <li key={i} className={x.tone}>
              <Icon name={TONE_ICON[x.tone]} width={15} />
              <span>{x.text}</span>
            </li>
          ))}
        </ul>
      )}
      {c.actions.length > 0 && (
        <>
          <div className="eyebrow" style={{ margin: '14px 0 6px' }}>
            Lo que te pide {pending.length ? `(${pending.length} pendiente${pending.length === 1 ? '' : 's'})` : '· todo hecho'}
          </div>
          {pending.map((a) => (
            <ActionRow key={a.id} consultId={c.id} a={a} checkups={checkups} onMetric={onMetric} goTab={goTab} />
          ))}
          {closed.map((a) => (
            <ActionRow key={a.id} consultId={c.id} a={a} checkups={checkups} onMetric={onMetric} goTab={goTab} />
          ))}
        </>
      )}
      {c.missing.length > 0 && (
        <div className="salud-missing">
          <div className="eyebrow">Datos que le faltan</div>
          <ul>
            {c.missing.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ActionRow({ consultId, a, checkups, onMetric, goTab }: { consultId: string; a: DoctorAction; checkups: Entity<CheckupData>[]; onMetric: (k: HealthMetricKind) => void; goTab: (t: 'estudios' | 'mediciones' | 'chequeos') => void }) {
  const done = !!a.doneAt;
  const dismissed = !!a.dismissedAt;
  const linked = a.checkup ? checkupForAction(a, checkups) : undefined;
  const isOn = !!linked && linked.data.active !== false;
  return (
    <div className={`salud-action ${done ? 'done' : ''} ${dismissed ? 'dismissed' : ''}`}>
      <button
        className={`check ${done ? 'done' : ''}`}
        aria-label={done ? 'Marcar como pendiente' : 'Marcar como hecho'}
        onClick={() => setActionState(consultId, a.id, done || dismissed ? { doneAt: null, dismissedAt: null } : { doneAt: new Date().toISOString() })}
      >
        <Icon name="check" />
      </button>
      <div className="grow">
        <div className="salud-name">{a.text}</div>
        {a.why && !done && !dismissed && <div className="salud-sub">{a.why}</div>}
        {!done && !dismissed && (
          <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
            <Badge tone={a.priority === 'alta' ? 'red' : a.priority === 'media' ? 'flame' : undefined}>{a.priority === 'alta' ? 'Prioridad alta' : a.priority === 'media' ? 'Media' : 'Baja'}</Badge>
            <Badge>{TYPE_NAME[a.type]}</Badge>
            {a.checkup &&
              (isOn ? (
                <button className="btn sm ghost" onClick={() => goTab('chequeos')}>
                  <Icon name="check" /> En tus chequeos
                </button>
              ) : (
                <button className="btn sm" onClick={() => activateActionCheckup(a, checkups)}>
                  <Icon name="plus" /> Activar chequeo
                </button>
              ))}
            {a.metric && HEALTH_METRIC_INFO[a.metric] && !HEALTH_METRIC_INFO[a.metric].lab && (
              <button className="btn sm" onClick={() => onMetric(a.metric!)}>
                <Icon name="salud-pulse" /> Registrar {HEALTH_METRIC_INFO[a.metric].name.toLowerCase()}
              </button>
            )}
            {(a.type === 'estudio' || (a.metric && HEALTH_METRIC_INFO[a.metric]?.lab)) && (
              <button className="btn sm" onClick={() => goTab('estudios')}>
                <Icon name="upload" /> Subir resultado
              </button>
            )}
          </div>
        )}
        {dismissed && <div className="tiny muted">Descartado</div>}
      </div>
      {!done && !dismissed && (
        <button className="btn icon ghost" aria-label="Descartar" title="No aplica / descartar" onClick={() => setActionState(consultId, a.id, { dismissedAt: new Date().toISOString() })}>
          <Icon name="x" />
        </button>
      )}
    </div>
  );
}

function ConsultHistory({ consults }: { consults: HealthConsultEntry[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="card">
      <h2>Revisiones anteriores</h2>
      {consults.map((c) => (
        <div key={c.id} className="salud-past">
          <button className="salud-plain row between" style={{ width: '100%', gap: 8 }} onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
            <span className="grow" style={{ textAlign: 'left' }}>
              <span className={`salud-dot ${c.status}`} /> <b className="small">{c.title}</b>
              <div className="tiny muted">
                {fmtDate(c.date, true)} · {c.actions.filter((a) => a.doneAt).length} de {c.actions.length} hechas
              </div>
            </span>
            <Icon name={open === c.id ? 'down' : 'right'} width={16} />
          </button>
          {open === c.id && (
            <div className="salud-consult-msg small" style={{ marginTop: 8 }}>
              {c.message.split(/\n{2,}/).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
              {c.actions.map((a) => (
                <div key={a.id} className="tiny" style={{ marginTop: 4 }}>
                  {a.doneAt ? '✓' : a.dismissedAt ? '—' : '○'} {a.text}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Preguntarle
// ---------------------------------------------------------------------------------------------

type Msg = { role: 'user' | 'assistant'; content: string };
const CHAT_KEY = 'igv.medico.chat';
const loadChat = (): Msg[] => {
  try {
    const x = JSON.parse(localStorage.getItem(CHAT_KEY) ?? '[]');
    return Array.isArray(x) ? x.slice(-30) : [];
  } catch {
    return [];
  }
};
const saveChat = (m: Msg[]) => {
  try {
    localStorage.setItem(CHAT_KEY, JSON.stringify(m.slice(-30)));
  } catch {
    /* sin almacenamiento */
  }
};

const QUICK_QUESTIONS = ['¿Cómo voy en general?', '¿Qué estudios me faltan?', '¿Qué cambio me ayudaría más ahora?'];

function DoctorChat({ disabled }: { disabled: boolean }) {
  const { state, entities } = useGame();
  const [params, setParams] = useSearchParams();
  const [msgs, setMsgs] = useState<Msg[]>(loadChat);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [recordId, setRecordId] = useState<string>(params.get('estudio') ?? '');
  const end = useRef<HTMLDivElement>(null);
  const withFiles = state.health.records.filter((r) => r.files.length);
  const record = withFiles.find((r) => r.id === recordId);

  useEffect(() => {
    if (params.get('estudio')) {
      const next = new URLSearchParams(params);
      next.delete('estudio');
      setParams(next, { replace: true });
      setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const history = msgs.slice(-12);
    const next: Msg[] = [...msgs, { role: 'user', content: record ? `${question}\n(Sobre: ${record.title}, ${fmtDate(record.date, true)})` : question }];
    setMsgs(next);
    setQ('');
    setBusy(true);
    setErr(null);
    try {
      const r = await medicoApi.ask({ dossier: buildHealthDossier(state, entities), today: state.today, question, history, fileIds: record?.files.map((f) => f.id) });
      const done = [...next, { role: 'assistant' as const, content: r.answer }];
      setMsgs(done);
      saveChat(done);
      setRecordId('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo preguntar.');
      saveChat(next);
    } finally {
      setBusy(false);
      setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>Pregúntale</h2>
        {msgs.length > 0 && (
          <button
            className="btn sm ghost"
            onClick={() => {
              setMsgs([]);
              saveChat([]);
            }}
          >
            Borrar plática
          </button>
        )}
      </div>
      {msgs.length === 0 && (
        <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
          {QUICK_QUESTIONS.map((x) => (
            <button key={x} className="btn sm" disabled={disabled || busy} onClick={() => send(x)}>
              {x}
            </button>
          ))}
        </div>
      )}
      <div className="chat">
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.role === 'user' ? 'me' : 'gm'}`}>
            {m.content}
          </div>
        ))}
        {busy && <div className="bubble gm muted">Revisando tu expediente…</div>}
        {err && <div className="bubble gm red">{err}</div>}
        <div ref={end} />
      </div>
      {withFiles.length > 0 && (
        <Field label="Sobre un estudio (lee sus archivos)">
          <select className="input" value={recordId} onChange={(e) => setRecordId(e.target.value)}>
            <option value="">Ninguno: con todo tu expediente</option>
            {withFiles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title} · {fmtDate(r.date, true)}
              </option>
            ))}
          </select>
        </Field>
      )}
      <form
        className="row"
        style={{ marginTop: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          send(q);
        }}
      >
        <TextInput placeholder={record ? `¿Qué quieres saber de "${record.title}"?` : 'Pregúntale a tu médico…'} value={q} onChange={(e) => setQ(e.target.value)} voiceLabel="Dictar pregunta" maxLength={4000} />
        <button className="btn primary" disabled={disabled || busy || !q.trim()} aria-label="Enviar">
          <Icon name="sparkles" />
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Lo que debe saber de ti
// ---------------------------------------------------------------------------------------------

function DoctorProfileSheet({ onClose, onCard }: { onClose: () => void; onCard: () => void }) {
  const { state } = useGame();
  const [d, setD] = useState<HealthDoctorData>(state.health.doctor ?? {});
  const set = (k: keyof HealthDoctorData) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  return (
    <Sheet
      open
      onClose={onClose}
      title="Lo que tu médico debe saber"
      actions={
        <button
          className="btn primary"
          onClick={() => {
            saveDoctor(d);
            toast('Guardado');
            onClose();
          }}
        >
          Guardar
        </button>
      }
    >
      <p className="small muted" style={{ marginTop: 0 }}>
        Con esto te orienta como un médico que te conoce. Escribe con tus palabras; puedes dictarlo.
      </p>
      <Field label="¿Qué quieres lograr con tu salud?">
        <TextArea className="input" value={d.goals ?? ''} onChange={set('goals')} placeholder="Bajar grasa, tener más energía, dormir mejor, controlar el colesterol…" maxLength={1500} />
      </Field>
      <Field label="Antecedentes de tu familia">
        <TextArea className="input" value={d.familyHistory ?? ''} onChange={set('familyHistory')} placeholder="Papá con diabetes desde los 50, abuelo con infarto, mamá con hipertensión…" maxLength={1500} />
      </Field>
      <Field label="Tus antecedentes">
        <TextArea className="input" value={d.pastHistory ?? ''} onChange={set('pastHistory')} placeholder="Cirugías, lesiones, enfermedades que has tenido…" maxLength={1500} />
      </Field>
      <Field label="Tu estilo de vida">
        <TextArea className="input" value={d.lifestyle ?? ''} onChange={set('lifestyle')} placeholder="Cómo comes, alcohol, tabaco, café, estrés, horas sentado…" maxLength={1500} />
      </Field>
      <Field label="¿Cada cuándo quieres tu revisión?">
        <Chips value={d.cadence ?? DOCTOR_DEFAULT_CADENCE} onChange={(cadence) => setD({ ...d, cadence })} options={DOCTOR_CADENCES.map((c) => ({ value: c, label: DOCTOR_CADENCE_NAMES[c] }))} />
      </Field>
      <div className="salud-note">
        <Icon name="salud-card" />
        <span>
          Alergias, medicamentos y tipo de sangre van en tu{' '}
          <button
            className="salud-link"
            onClick={() => {
              onClose();
              onCard();
            }}
          >
            ficha médica
          </button>
          .
        </span>
      </div>
    </Sheet>
  );
}
