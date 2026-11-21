import { useState } from 'react';
import { Link } from 'react-router-dom';
import { COACH_GOAL_NAMES, GAME_CONFIG, MUSCLES, SESSION_TEMPLATES, lowerFirst, type PrescribedExercise } from '@igv/core';
import { useGame } from '../../data/store';
import { draftFromCoach, openCoachSheet, restText, saveCoachSettings, targetText, useCoachPlan } from '../../lib/coach';
import { openWorkout } from '../../lib/entreno';
import { fmtDate } from '../../lib/time';
import { Icon } from '../icons';
import { Badge, Bar, Sheet, toast } from '../kit';
import { CoachCard } from './CoachCard';
import { CoachChat } from './CoachChat';
import { RestTimer } from './RestTimer';
import '../../styles/coach.css';

/** Pestaña "Coach" de Entrenamiento: tu entrenador personal completo. */
export function CoachTab() {
  const plan = useCoachPlan();
  return (
    <>
      <CoachCard />
      {plan.profile.configured ? (
        <>
          <TodaySession />
          <WeekStrip />
          <TargetsCard />
          <BodyCard />
          <PhaseCard />
        </>
      ) : (
        <div className="card">
          <h2>Así trabaja tu coach</h2>
          <ul className="coach-why">
            <li>Te armo un plan que empieza suave (adaptación) y sube cada semana que entrenas: más peso o más repeticiones, nunca de golpe.</li>
            <li>Cada día te digo qué hacer: ejercicios, series, repeticiones, peso objetivo, descanso, y cuánto caminar.</li>
            <li>Si dormiste poco, llegas cansado o te duele algo, ajusto la sesión. Si algo te molesta seguido, evito esos ejercicios.</li>
            <li>Comida por hábitos: proteína en cada comida, verdura, fruta y agua; con tu peso y estatura calculo calorías y proteína.</li>
            <li>Cada semana: "¿Cómo estuvo tu semana?" y tus medidas, para decidir si subimos, mantenemos o bajamos.</li>
          </ul>
          <button className="btn primary block" onClick={() => openCoachSheet('setup')}>
            <Icon name="whistle" /> Armar mi plan
          </button>
        </div>
      )}
      <div className="card">
        <div className="card-head">
          <h2>Habla con {plan.profile.coachName}</h2>
          <span className="tiny muted">con IA</span>
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          Cuéntale lo que entrenaste o comiste y lo registra; pregúntale por técnica, ejercicios o comida y, si hace falta, revisa la evidencia.
        </p>
        <CoachChat coachName={plan.profile.coachName} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Sesión de hoy
// ---------------------------------------------------------------------------------------------

function TodaySession() {
  const { state } = useGame();
  const plan = useCoachPlan();
  const s = plan.today.session;
  const [swap, setSwap] = useState<PrescribedExercise | null>(null);
  const [showWarm, setShowWarm] = useState(false);
  const start = () => openWorkout({ draft: draftFromCoach(s, state) });
  return (
    <div className="card coach-session">
      <div className="card-head">
        <div>
          <div className="eyebrow">{plan.today.strengthDone ? 'Hoy ya entrenaste' : 'Tu sesión de hoy'}</div>
          <h2 style={{ margin: '2px 0 0' }}>{s.title}</h2>
        </div>
        {s.estMinutes > 0 && <Badge>~{s.estMinutes} min</Badge>}
      </div>
      <p className="small muted" style={{ marginTop: 4 }}>
        {s.focus}
      </p>
      {s.adjustments.map((a) => (
        <div key={a} className="tr-note">
          <Icon name="bolt" /> {a}
        </div>
      ))}
      {plan.today.workoutsToday.length > 0 && (
        <div className="tiny muted" style={{ marginBottom: 8 }}>
          Registrado hoy: {plan.today.workoutsToday.map((w) => w.title).join(', ')}
          {plan.today.workoutsToday.some((w) => w.records.length) ? ' · con récord' : ''}
        </div>
      )}
      {s.warmup.length > 0 && (
        <button className="linkish small" onClick={() => setShowWarm((v) => !v)}>
          <Icon name={showWarm ? 'down' : 'right'} width={14} /> Calentamiento (5–8 min)
        </button>
      )}
      {showWarm && (
        <ul className="coach-why">
          {s.warmup.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {s.exercises.map((e, i) => (
        <ExerciseRow key={e.exerciseId} e={e} n={i + 1} onSwap={() => setSwap(e)} />
      ))}
      {s.cardio && (
        <div className="coach-ex">
          <div className="coach-ex-n">
            <Icon name="footsteps" width={16} />
          </div>
          <div className="grow">
            <b>
              {s.cardio.name} · {s.cardio.minutes} min
            </b>
            <div className="tiny muted">{s.cardio.intensity}</div>
          </div>
        </div>
      )}
      {s.cooldown.length > 0 && s.exercises.length > 0 && <div className="tiny faint" style={{ marginTop: 6 }}>Al final: {s.cooldown.join(' ')}</div>}
      {(s.exercises.length > 0 || s.cardio) && (
        <button className="btn primary block" style={{ marginTop: 12 }} onClick={start}>
          <Icon name="play" /> {s.exercises.length ? `Empezar ${lowerFirst(s.title)}` : `Registrar ${s.cardio!.name.toLowerCase()}`}
        </button>
      )}
      {plan.today.next && (
        <div className="tiny muted" style={{ marginTop: 10 }}>
          Siguiente de fuerza: <b>{plan.today.next.title}</b> · {fmtDate(plan.today.next.date)}
        </div>
      )}
      {swap && <SwapSheet e={swap} onClose={() => setSwap(null)} />}
    </div>
  );
}

function ExerciseRow({ e, n, onSwap }: { e: PrescribedExercise; n: number; onSwap: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="coach-ex">
      <div className="coach-ex-n">{n}</div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row between" style={{ gap: 6, alignItems: 'flex-start' }}>
          <button className="coach-ex-name" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            <b>{e.name}</b>
            <span className="tiny muted"> · {e.muscles.map((m) => MUSCLES[m].name.toLowerCase()).join(', ')}</span>
          </button>
          {e.progression === 'subir' && <Badge tone="gold">Sube</Badge>}
          {e.progression === 'nuevo' && <Badge>Nuevo</Badge>}
          {e.progression === 'retomar' && <Badge tone="flame">Retoma</Badge>}
        </div>
        <div className="coach-ex-target num">{targetText(e)}</div>
        {e.note && <div className="tiny muted">{e.note}</div>}
        {open && (
          <div className="coach-ex-more">
            <div className="small">
              <b>Técnica:</b> {e.cue}
            </div>
            <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
              <RestTimer seconds={e.restSec} label={`Descanso ${restText(e.restSec)}`} />
              {e.alternatives.length > 0 && (
                <button className="btn sm ghost" onClick={onSwap}>
                  <Icon name="repeat" /> Cambiar ejercicio
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SwapSheet({ e, onClose }: { e: PrescribedExercise; onClose: () => void }) {
  const { state } = useGame();
  const choose = (id: string, name: string) => {
    const swaps = { ...(state.training.settings.coach?.swaps ?? {}), [e.slot]: id };
    saveCoachSettings(state, { swaps });
    toast(`${e.slotLabel}: ahora ${name}`);
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={`Cambiar ${e.name.toLowerCase()}`}>
      <p className="small muted" style={{ marginTop: -6 }}>
        Opciones para el mismo movimiento ({e.slotLabel.toLowerCase()}) con tu equipo y cuidando tus molestias. El cambio se queda en tu plan.
      </p>
      {e.alternatives.map((a) => (
        <button key={a.id} className="wk-item block-btn" onClick={() => choose(a.id, a.name)}>
          <span className="grow">{a.name}</span>
          <Icon name="right" width={16} className="faint" />
        </button>
      ))}
      {state.training.settings.coach?.swaps?.[e.slot] && (
        <button
          className="btn ghost block sm"
          style={{ marginTop: 8 }}
          onClick={() => {
            const swaps = { ...(state.training.settings.coach?.swaps ?? {}) };
            delete swaps[e.slot];
            saveCoachSettings(state, { swaps });
            toast('Volví a la opción del plan');
            onClose();
          }}
        >
          Usar la opción del plan
        </button>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------
// Semana, metas, cuerpo y fase
// ---------------------------------------------------------------------------------------------

function WeekStrip() {
  const plan = useCoachPlan();
  return (
    <div className="card">
      <div className="card-head">
        <h2>Tu semana</h2>
        <span className="tiny muted">
          fuerza {plan.targets.strength.done}/{plan.targets.strength.target}
        </span>
      </div>
      <div className="coach-week">
        {plan.week.map((d) => {
          const done = d.kind === 'fuerza' ? d.didStrength : d.kind === 'cardio' ? d.didCardio || d.didStrength : d.didCardio || d.didStrength;
          const missed = d.past && d.kind === 'fuerza' && !d.didStrength;
          return (
            <div key={d.date} className={`cw-day k-${d.kind} ${d.isToday ? 'today' : ''} ${done ? 'done' : ''} ${missed ? 'missed' : ''}`} title={`${d.label}: ${d.title}${d.doneTitles.length ? ` · ${d.doneTitles.join(', ')}` : ''}`}>
              <span className="cw-short">{d.short}</span>
              <span className="cw-dot">{done ? <Icon name="check" width={14} /> : d.kind === 'fuerza' ? <Icon name="dumbbell" width={14} /> : d.kind === 'cardio' ? <Icon name="footsteps" width={14} /> : <Icon name="moon" width={13} />}</span>
              <span className="cw-title">{d.kind === 'fuerza' && d.sessionKey ? SESSION_TEMPLATES[d.sessionKey].short : d.kind === 'cardio' ? `${d.minutes} min` : 'Libre'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TargetsCard() {
  const plan = useCoachPlan();
  const t = plan.targets;
  const n = plan.nutrition;
  const row = (icon: string, label: string, value: number, max: number, text: string, action?: { label: string; on: () => void }, to?: string) => (
    <div className="coach-target">
      <Icon name={icon} width={18} className="muted" />
      <div className="grow">
        <div className="row between">
          <span className="small">
            <b>{label}</b>
          </span>
          <span className="tiny muted num">{text}</span>
        </div>
        <Bar value={value} max={max} tone={value >= max ? 'teal' : undefined} size="sm" />
      </div>
      {action && (
        <button className="btn sm ghost" onClick={action.on} aria-label={action.label}>
          <Icon name="plus" />
        </button>
      )}
      {to && (
        <Link to={to} className="btn sm ghost" aria-label={`Ver ${label}`}>
          <Icon name="right" />
        </Link>
      )}
    </div>
  );
  return (
    <div className="card">
      <div className="card-head">
        <h2>Metas de la semana</h2>
        <span className="tiny muted">{COACH_GOAL_NAMES[plan.profile.goal]}</span>
      </div>
      {row('dumbbell', 'Fuerza', t.strength.done, Math.max(1, t.strength.target), `${t.strength.done} de ${t.strength.target} sesiones`)}
      {row('footsteps', 'Cardio', t.cardio.done, t.cardio.target, `${t.cardio.done} de ${t.cardio.target} min`)}
      {row('footsteps', 'Pasos', t.steps.today ?? t.steps.avg ?? 0, t.steps.target, `${t.steps.today !== null ? `hoy ${t.steps.today.toLocaleString('es-MX')}` : t.steps.avg !== null ? `prom. ${t.steps.avg.toLocaleString('es-MX')}` : 'sin registro'} / ${t.steps.target.toLocaleString('es-MX')}`, { label: 'Registrar pasos', on: () => openCoachSheet('pasos') })}
      {row('moon', 'Sueño', t.sleep.avg ?? t.sleep.lastNight ?? 0, t.sleep.target, t.sleep.avg !== null ? `prom. ${t.sleep.avg} h · meta ${t.sleep.target}+` : t.sleep.lastNight !== null ? `anoche ${t.sleep.lastNight} h` : 'sin registro', { label: 'Registrar sueño', on: () => openCoachSheet('sueno') })}
      {row('apple', 'Comida', n.today.score ?? 0, 100, n.today.score !== null ? `hoy ${n.today.score}/100${t.nutrition.avg !== null ? ` · semana ${t.nutrition.avg}` : ''}` : 'hoy sin registro', undefined, '/nutricion')}
      {n.today.tip && (
        <div className="tr-note">
          <Icon name="apple" /> {n.today.tip}
        </div>
      )}
    </div>
  );
}

function BodyCard() {
  const plan = useCoachPlan();
  const p = plan.profile;
  const w = plan.weight;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Tu cuerpo</h2>
        <button className="btn sm" onClick={() => openCoachSheet('medidas')}>
          <Icon name="ruler" /> Medirme
        </button>
      </div>
      <div className="tr-stats">
        <div className="tr-stat">
          <b>{p.weightKg ?? '—'}</b>
          <span>kg</span>
        </div>
        <div className="tr-stat">
          <b>{p.bmi ?? '—'}</b>
          <span>IMC</span>
        </div>
        <div className="tr-stat">
          <b>{p.waistCm ?? '—'}</b>
          <span>Cintura cm</span>
        </div>
        <div className="tr-stat">
          <b className={w.change ? (w.change.kg < 0 ? 'teal' : w.change.kg > 0 ? 'gold' : '') : ''}>{w.change ? `${w.change.kg > 0 ? '+' : ''}${w.change.kg}` : '—'}</b>
          <span>kg / {w.change ? `${w.change.days} d` : 'sem.'}</span>
        </div>
      </div>
      {p.bmiLabel && (
        <p className="small muted" style={{ marginBottom: 0 }}>
          IMC {p.bmi}: {p.bmiLabel}.{p.waistToHeight ? ` Cintura/estatura ${p.waistToHeight}${p.waistToHeight >= 0.5 ? ' (arriba de 0.5: la cintura es lo que más conviene bajar)' : ' (sano: debajo de 0.5)'}.` : ''}
          {p.targetWeightKg && p.weightKg ? ` Meta: ${p.targetWeightKg} kg (faltan ${Math.abs(Math.round((p.weightKg - p.targetWeightKg) * 10) / 10)} kg).` : ''}
        </p>
      )}
      {w.verdict && (
        <div className="tr-note">
          <Icon name="bolt" /> {w.verdict}
        </div>
      )}
      {p.missing.length > 0 && (
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          Me falta tu {p.missing.join(', ')} para calcular IMC, calorías y proteína.{' '}
          <button className="linkish tiny" onClick={() => openCoachSheet('setup')}>
            Completar
          </button>
        </p>
      )}
      <div className="tiny faint" style={{ marginTop: 8 }}>
        Mídete cada {GAME_CONFIG.coach.measureEveryDays} días, en ayunas. Contornos completos y tu cuerpo 3D en <Link to="/cuerpo">Cuerpo</Link>.
      </div>
    </div>
  );
}

function PhaseCard() {
  const plan = useCoachPlan();
  const ph = plan.phase;
  const lw = plan.lastWeek;
  const P = GAME_CONFIG.coach.phases;
  const nextAt = ph.key === 'adaptacion' ? P.base.from : ph.key === 'base' ? P.progreso.from : null;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Tu plan</h2>
        <button className="btn sm" onClick={() => openCoachSheet('setup')}>
          <Icon name="settings" /> Ajustar
        </button>
      </div>
      <div className="coach-phases">
        {(['adaptacion', 'base', 'progreso'] as const).map((k) => (
          <div key={k} className={`cp-step ${ph.key === k || (ph.key === 'descarga' && k === 'progreso') ? 'on' : ''} ${ph.trainedWeeks >= P[k].from ? 'past' : ''}`}>
            <b>{P[k].name}</b>
            <small>{k === 'adaptacion' ? `sem. 1–${P.base.from}` : k === 'base' ? `sem. ${P.base.from + 1}–${P.progreso.from}` : `sem. ${P.progreso.from + 1}+`}</small>
          </div>
        ))}
      </div>
      <p className="small" style={{ marginBottom: 6 }}>
        {ph.reason}
      </p>
      {nextAt !== null && (
        <>
          <Bar value={ph.trainedWeeks} max={nextAt} size="sm" />
          <div className="tiny muted" style={{ marginTop: 4 }}>
            {ph.nextPhaseIn} {ph.nextPhaseIn === 1 ? 'semana entrenada' : 'semanas entrenadas'} (con 2+ sesiones) para pasar a {ph.key === 'adaptacion' ? 'base' : 'progreso'}.
          </div>
        </>
      )}
      <div className="eyebrow" style={{ marginTop: 12 }}>
        Semana pasada
      </div>
      <p className="small" style={{ margin: '4px 0' }}>
        Fuerza {lw.strength.done}/{lw.strength.target} · cardio {lw.cardio.done}/{lw.cardio.target} min · cumplimiento {lw.compliance}%. {lw.verdictText}
      </p>
      {plan.checkinWeek && (
        <button className="btn sm primary" onClick={() => openCoachSheet({ kind: 'checkin', week: plan.checkinWeek! })}>
          <Icon name="checklist" /> ¿Cómo estuvo tu semana?
        </button>
      )}
      <details className="coach-details">
        <summary>¿Por qué el plan es así?</summary>
        <ul className="coach-why">
          {plan.why.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        <p className="tiny faint">Basado en las guías del ACSM y la OMS y en revisiones de entrenamiento de fuerza, cardio, sueño y nutrición. Orientación general: no sustituye a tu médico.</p>
      </details>
    </div>
  );
}
