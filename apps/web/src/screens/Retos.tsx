import { useState } from 'react';
import { addDays, challengeDayNumber, GAME_CONFIG, type ChallengeData, type Entity, type Pledge } from '@igv/core';
import { addEvent, saveEntity, useGame, voidEvent } from '../data/store';
import { sfx } from '../lib/sound';
import { fmtDate, fmtNum, newId } from '../lib/time';
import { AttrChips, Badge, Chips, Empty, Field, PageHeader, Sheet, SizeChips, Tabs, confirmAction, undoToast, TextInput } from '../ui/kit';
import { Icon } from '../ui/icons';
import '../life.css';

const IDEAS = ['30 días leyendo 20 minutos', '30 días sin redes antes de las 10 am', '30 días de ejercicio', '30 días sin azúcar', '21 días despertando a las 6'];

/** Retos de N días seguidos (no rompas la cadena) y compromisos con oro en juego. */
export default function Retos() {
  const [tab, setTab] = useState<'challenges' | 'pledges'>('challenges');
  const [creating, setCreating] = useState<null | 'challenge' | 'pledge'>(null);
  return (
    <>
      <PageHeader
        title="Retos"
        eyebrow="Progreso"
        right={
          <button className="btn sm primary" onClick={() => setCreating(tab === 'challenges' ? 'challenge' : 'pledge')}>
            <Icon name="plus" /> {tab === 'challenges' ? 'Reto' : 'Compromiso'}
          </button>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'challenges', label: 'Días seguidos' },
          { value: 'pledges', label: 'Compromisos' },
        ]}
      />
      {tab === 'challenges' ? <Challenges onNew={() => setCreating('challenge')} /> : <Pledges onNew={() => setCreating('pledge')} />}
      {creating === 'challenge' && <ChallengeSheet onClose={() => setCreating(null)} />}
      {creating === 'pledge' && <PledgeSheet onClose={() => setCreating(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Retos de N días
// ---------------------------------------------------------------------------

function Challenges({ onNew }: { onNew: () => void }) {
  const { state, list } = useGame();
  const all = list<ChallengeData>('challenges', 'challenge').filter((c) => !c.data.archived);
  if (!all.length)
    return (
      <div className="card">
        <Empty>
          Elige algo que quieras hacer todos los días y no rompas la cadena. Si llegas al final ganas {GAME_CONFIG.missionXp.grande} XP. Si fallas un día, empiezas de nuevo cuando quieras.
        </Empty>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn primary" onClick={onNew}>
            <Icon name="plus" /> Empezar un reto
          </button>
        </div>
      </div>
    );
  const sorted = [...all].sort((a, b) => Number(!!state.challenges[b.id]?.current) - Number(!!state.challenges[a.id]?.current));
  return (
    <>
      {sorted.map((c) => (
        <ChallengeCard key={c.id} c={c} />
      ))}
    </>
  );
}

function ChallengeCard({ c }: { c: Entity<ChallengeData> }) {
  const { state } = useGame();
  const st = state.challenges[c.id];
  const today = state.today;
  const cur = st?.current;
  const last = st?.last;
  const days = c.data.days;

  const check = () => {
    const ev = addEvent('challenge.checked', { challengeId: c.id });
    sfx.coin();
    const left = days - ((cur?.checked.length ?? 0) + 1);
    undoToast(left <= 0 ? `¡Reto completado! +${GAME_CONFIG.missionXp[c.data.size]} XP` : `Día ${(cur?.checked.length ?? 0) + 1} de ${days}. Faltan ${left}.`, () => voidEvent(ev.id));
  };
  const start = () => {
    const ev = addEvent('challenge.started', { challengeId: c.id });
    undoToast(`Empieza: ${c.data.title}`, () => voidEvent(ev.id));
  };
  const archive = () => confirmAction('¿Ocultar este reto? Su XP ganada se conserva.') && saveEntity({ ...c, data: { ...c.data, archived: true } });

  const shown = cur ?? last;
  const checked = new Set(shown?.checked ?? []);
  const cells = shown
    ? Array.from({ length: days }, (_, i) => {
        const d = addDays(shown.startDate, i);
        const cls = checked.has(d) ? 'ok' : d === today && cur ? 'today' : shown.status === 'failed' && d === shown.closedOn ? 'miss' : '';
        return { d, cls, n: i + 1 };
      })
    : [];

  return (
    <div className="card">
      <div className="card-head" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <h2 style={{ marginBottom: 4 }}>{c.data.title}</h2>
          <div className="row wrap" style={{ gap: 4 }}>
            {cur && <Badge tone="flame">Día {Math.min(days, challengeDayNumber(cur, today))} de {days}</Badge>}
            {!cur && last?.status === 'completed' && <Badge tone="green">Completado {fmtDate(last.closedOn, true)}</Badge>}
            {!cur && last?.status === 'failed' && <Badge tone="red">Se rompió el {fmtDate(last.closedOn, true)}</Badge>}
            {(st?.completions ?? 0) > 0 && <Badge tone="gold">{st!.completions}× completado</Badge>}
            <Badge>+{GAME_CONFIG.missionXp[c.data.size]} XP al terminar</Badge>
          </div>
        </div>
        <button className="btn icon ghost" aria-label="Ocultar reto" onClick={archive}>
          <Icon name="x" />
        </button>
      </div>
      {cells.length > 0 && (
        <div className="chain" style={{ gridTemplateColumns: `repeat(${Math.min(10, days)}, 1fr)` }}>
          {cells.map((x) => (
            <span key={x.d} className={x.cls} title={fmtDate(x.d)}>
              {x.cls === 'ok' ? '✓' : x.cls === 'miss' ? '×' : x.n}
            </span>
          ))}
        </div>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        {cur ? (
          st?.checkedToday ? (
            <span className="small" style={{ color: 'var(--green)' }}>
              Hoy ya cumpliste. Racha: {st.streak} {st.streak === 1 ? 'día' : 'días'}.
            </span>
          ) : (
            <button className="btn primary grow" onClick={check}>
              <Icon name="check" /> Hoy sí lo hice
            </button>
          )
        ) : (
          <button className="btn grow" onClick={start}>
            <Icon name="refresh" /> {last ? 'Volver a empezar hoy' : 'Empezar hoy'}
          </button>
        )}
      </div>
    </div>
  );
}

function ChallengeSheet({ onClose }: { onClose: () => void }) {
  const [d, setD] = useState<ChallengeData>({ title: '', days: GAME_CONFIG.challenge.defaultDays, attribute: 'disciplina', size: GAME_CONFIG.challenge.defaultSize });
  const save = () => {
    const id = `ch-${newId().slice(0, 8)}`;
    saveEntity({ id, module: 'challenges', kind: 'challenge', data: { ...d, title: d.title.trim() } });
    addEvent('challenge.started', { challengeId: id });
    sfx.questStart();
    onClose();
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title="Nuevo reto"
      actions={
        <button className="btn primary" disabled={!d.title.trim()} onClick={save}>
          Empezar hoy
        </button>
      }
    >
      <Field label="¿Qué vas a hacer todos los días?">
        <TextInput className="input" value={d.title} placeholder="Ej. Leer 20 minutos" onChange={(e) => setD({ ...d, title: e.target.value })} />
      </Field>
      <div className="chips" style={{ marginTop: -4, marginBottom: 12 }}>
        {IDEAS.map((i) => (
          <button key={i} className="chip" onClick={() => setD({ ...d, title: i.replace(/^\d+ días (de )?/, '').replace(/^./, (x) => x.toUpperCase()), days: Number(i.match(/^\d+/)?.[0] ?? 30) })}>
            {i}
          </button>
        ))}
      </div>
      <Field label="Días seguidos">
        <Chips value={d.days} onChange={(days) => setD({ ...d, days })} options={[7, 14, 21, 30, 66, 100].map((n) => ({ value: n, label: String(n) }))} />
      </Field>
      <Field label="Premio al terminar">
        <SizeChips value={d.size} onChange={(size) => setD({ ...d, size })} />
      </Field>
      <Field label="Atributo">
        <AttrChips value={d.attribute} onChange={(attribute) => setD({ ...d, attribute })} />
      </Field>
      <p className="tiny muted">Hoy nunca rompe la cadena: tienes hasta las 11:59 pm para marcarlo.</p>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Compromisos con oro en juego
// ---------------------------------------------------------------------------

function Pledges({ onNew }: { onNew: () => void }) {
  const { state } = useGame();
  const g = state.gold;
  const open = g.pledges.filter((p) => p.valid && p.status === 'open');
  const done = g.pledges.filter((p) => !(p.valid && p.status === 'open'));
  const mult = GAME_CONFIG.pledge.payoutMultiplier;
  return (
    <>
      <div className="card">
        <div className="small">
          Apuesta oro a que cumples algo antes de una fecha. Si cumples, recibes <b>{mult}×</b> lo apostado. Si no, lo pierdes. Tu XP nunca se toca.
        </div>
        <div className="tiny muted" style={{ marginTop: 6 }}>
          Tienes {fmtNum(g.balance)} de oro disponible{g.locked ? ` · ${fmtNum(g.locked)} apostado` : ''}.
        </div>
      </div>
      {open.length === 0 && done.length === 0 && (
        <div className="card">
          <Empty>Aún no tienes compromisos. Ejemplo: "Ir 4 veces al gym esta semana" por 20 de oro.</Empty>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn primary" onClick={onNew}>
              <Icon name="plus" /> Hacer un compromiso
            </button>
          </div>
        </div>
      )}
      {open.map((p) => (
        <PledgeCard key={p.pledgeId} p={p} />
      ))}
      {done.length > 0 && (
        <>
          <div className="section-title">Historial</div>
          <div className="card">
            {[...done].reverse().map((p) => (
              <div key={p.pledgeId} className="item" style={{ opacity: p.valid ? 1 : 0.5 }}>
                <div className="grow small">
                  {p.title}
                  <div className="tiny muted">
                    {fmtDate(p.madeOn, true)}
                    {!p.valid && ' · no alcanzaba el oro (no cuenta)'}
                  </div>
                </div>
                {p.valid && (p.status === 'kept' ? <b className="num small" style={{ color: 'var(--green)' }}>+{p.payout - p.stake}</b> : <b className="num small" style={{ color: 'var(--red)' }}>−{p.stake}</b>)}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function PledgeCard({ p }: { p: Pledge }) {
  const { state } = useGame();
  const daysLeft = Math.round((Date.parse(p.deadline) - Date.parse(state.today)) / 86400000);
  const resolve = (kept: boolean) => {
    if (!confirmAction(kept ? `¿Cumpliste "${p.title}"? Recibes ${p.stake * GAME_CONFIG.pledge.payoutMultiplier} de oro.` : `¿No se logró "${p.title}"? Pierdes ${p.stake} de oro.`)) return;
    const ev = addEvent('pledge.resolved', { pledgeId: p.pledgeId, kept });
    if (kept) sfx.achievement();
    undoToast(kept ? `Cumpliste. +${p.stake * GAME_CONFIG.pledge.payoutMultiplier} de oro` : 'Ni modo. La próxima.', () => voidEvent(ev.id));
  };
  return (
    <div className="card">
      <div className="card-head" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <h2 style={{ marginBottom: 4 }}>{p.title}</h2>
          <div className="row wrap" style={{ gap: 4 }}>
            <Badge tone="gold">{p.stake} de oro en juego</Badge>
            <Badge tone={daysLeft < 0 ? 'red' : daysLeft <= 1 ? 'flame' : 'blue'}>
              {daysLeft < 0 ? `Venció el ${fmtDate(p.deadline)}` : daysLeft === 0 ? 'Vence hoy' : `${daysLeft} días`}
            </Badge>
          </div>
        </div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary grow" onClick={() => resolve(true)}>
          <Icon name="check" /> Lo cumplí
        </button>
        <button className="btn grow" onClick={() => resolve(false)}>
          No se logró
        </button>
      </div>
    </div>
  );
}

function PledgeSheet({ onClose }: { onClose: () => void }) {
  const { state } = useGame();
  const [title, setTitle] = useState('');
  const [stake, setStake] = useState(10);
  const [deadline, setDeadline] = useState(addDays(state.today, 6));
  const can = state.gold.balance >= stake && stake > 0;
  const save = () => {
    const ev = addEvent('pledge.made', { pledgeId: `pl-${newId().slice(0, 8)}`, title: title.trim(), stake, deadline });
    sfx.coin();
    undoToast(`Compromiso: ${stake} de oro en juego`, () => voidEvent(ev.id));
    onClose();
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title="Nuevo compromiso"
      actions={
        <button className="btn primary" disabled={!title.trim() || !can || deadline < state.today} onClick={save}>
          Apostar {stake} de oro
        </button>
      }
    >
      <Field label="¿Qué te comprometes a lograr?">
        <TextInput className="input" value={title} placeholder="Ej. Ir 4 veces al gym esta semana" onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Oro en juego">
        <Chips value={stake} onChange={setStake} options={[5, 10, 20, 50, 100].map((n) => ({ value: n, label: String(n) }))} />
      </Field>
      <p className="tiny muted" style={{ marginTop: -4 }}>
        Disponible: {fmtNum(state.gold.balance)}. {!can && 'No te alcanza para esa apuesta.'}
      </p>
      <Field label="Fecha límite">
        <Chips
          value={deadline}
          onChange={setDeadline}
          options={[
            { value: state.today, label: 'Hoy' },
            { value: addDays(state.today, 6), label: '1 semana' },
            { value: addDays(state.today, 13), label: '2 semanas' },
            { value: addDays(state.today, 29), label: '1 mes' },
          ]}
        />
      </Field>
      <input className="input" type="date" value={deadline} min={state.today} onChange={(e) => e.target.value && setDeadline(e.target.value)} />
    </Sheet>
  );
}
