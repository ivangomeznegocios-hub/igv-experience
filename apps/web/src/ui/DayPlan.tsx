import { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  frequentMissions,
  isInRoutine,
  quickMissionId,
  weekday,
  type AttributeId,
  type CompletionKind,
  type MissionData,
  type MissionSize,
  type PlanItem,
  type TodoData,
} from '@igv/core';
import { useGame } from '../data/store';
import { savePlan, togglePlanItem } from '../lib/plan';
import { fmtWeekday } from '../lib/time';
import { AttrChips, Badge, Field, Sheet, SizeChips, TextInput } from './kit';
import { Icon } from './icons';
import '../life.css';

const bus = new Set<(date: string) => void>();
/** Abre la hoja para planear un día (por defecto, mañana). */
export function openPlanSheet(date: string) {
  bus.forEach((f) => f(date));
}

/** Tarjeta "Tus 3 de hoy": lo que planeaste anoche, con un toque para marcarlo. */
export function TodayPlanCard() {
  const { state } = useGame();
  const today = state.today;
  const plan = state.plans[today];
  const tomorrow = addDays(today, 1);
  const tomorrowPlan = state.plans[tomorrow];
  const closeBonus = state.gold.bonuses.find((b) => b.source === 'day_close' && b.date === today);
  const planBonus = state.gold.bonuses.find((b) => b.source === 'plan' && b.date === today);

  if (!plan?.items.length) {
    return (
      <div className="card">
        <div className="row">
          <div className="grow">
            <h2 style={{ margin: 0 }}>Tus 3 de hoy</h2>
            <div className="tiny muted">Elige las 3 cosas que harían que hoy valga la pena.</div>
          </div>
          <button className="btn sm primary" onClick={() => openPlanSheet(today)}>
            <Icon name="list" /> Planear
          </button>
        </div>
      </div>
    );
  }
  const doneN = plan.items.filter((i) => i.done).length;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Tus 3 de hoy</h2>
        <div className="row" style={{ gap: 6 }}>
          <Badge tone={plan.completed ? 'green' : undefined}>
            {doneN}/{plan.items.length}
          </Badge>
          <button className="btn icon ghost sm" aria-label="Editar plan de hoy" onClick={() => openPlanSheet(today)}>
            <Icon name="edit" />
          </button>
        </div>
      </div>
      {plan.items.map((it, i) => (
        <div key={it.missionId} className={`plan-item ${it.done ? 'done' : ''}`} onClick={() => togglePlanItem(plan, it)} role="checkbox" aria-checked={it.done}>
          <span className="plan-num">{i + 1}</span>
          <span className="plan-check">
            <Icon name="check" width={16} />
          </span>
          <div className="grow item-title">{it.title}</div>
        </div>
      ))}
      {plan.completed ? (
        <div className="tiny" style={{ marginTop: 8, color: 'var(--green)' }}>
          Cumpliste tu plan del día{planBonus ? ` · +${planBonus.amount} de oro` : ''}.
        </div>
      ) : (
        <div className="tiny muted" style={{ marginTop: 8 }}>
          Cumple las {plan.items.length} y ganas +{planBonus?.amount ?? 5} de oro.
        </div>
      )}
      <div className="row between" style={{ marginTop: 10 }}>
        <span className="tiny muted">{closeBonus ? `Bono por cerrar el día: +${closeBonus.amount} de oro` : 'Cierra el día para abrir tu bono sorpresa.'}</span>
        <button className="btn sm ghost" onClick={() => openPlanSheet(tomorrow)}>
          {tomorrowPlan?.items.length ? 'Plan de mañana ✓' : 'Planear mañana'}
        </button>
      </div>
    </div>
  );
}

type Candidate = PlanItem & { group: string };

/** Hoja para elegir hasta 3 cosas para un día. Se monta una vez en App. */
export function PlanSheet() {
  const { state, list, events } = useGame();
  const [date, setDate] = useState<string | null>(null);
  const [picked, setPicked] = useState<PlanItem[]>([]);
  const [free, setFree] = useState('');
  const [size, setSize] = useState<MissionSize>('media');
  const [attr, setAttr] = useState<AttributeId>('disciplina');

  useEffect(() => {
    const f = (d: string) => setDate(d);
    bus.add(f);
    return () => {
      bus.delete(f);
    };
  }, []);
  useEffect(() => {
    if (date) setPicked(state.plans[date]?.items.map(({ done: _d, ...rest }) => rest) ?? []);
    // solo al abrir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const candidates = useMemo<Candidate[]>(() => {
    if (!date) return [];
    const out: Candidate[] = [];
    const seen = new Set<string>();
    const push = (c: Candidate) => {
      if (seen.has(c.missionId)) return;
      seen.add(c.missionId);
      out.push(c);
    };
    for (const t of list<TodoData>('planner', 'todo')) {
      if (state.missions.completions[t.id]) continue;
      if (t.data.date && t.data.date > date) continue;
      push({ missionId: t.id, title: t.data.title, size: t.data.size, attribute: t.data.attribute, kind: 'todo', group: 'Pendientes' });
    }
    for (const kind of ['chapter', 'side', 'event'] as const) {
      for (const m of list<MissionData>('missions', kind)) {
        if (state.missions.completions[m.id]) continue;
        push({ missionId: m.id, title: m.data.title, size: m.data.size, attribute: m.data.attribute, kind, group: 'Misiones' });
      }
    }
    const wd = weekday(date);
    for (const m of list<MissionData>('missions', 'daily')) {
      if (!isInRoutine(m.data, wd)) continue;
      push({ missionId: m.id, title: m.data.title, size: m.data.size, attribute: m.data.attribute, kind: 'daily', group: 'Rutina' });
    }
    for (const f of frequentMissions(events, state.today, 45, 8)) {
      push({ missionId: f.missionId, title: f.title, size: f.size as MissionSize, attribute: f.attribute as AttributeId, kind: f.kind as CompletionKind, group: 'Lo que más haces' });
    }
    return out;
  }, [date, list, state, events]);

  if (!date) return null;
  const close = () => {
    setDate(null);
    setFree('');
  };
  const isOn = (id: string) => picked.some((p) => p.missionId === id);
  const toggle = (c: PlanItem) => setPicked((cur) => (cur.some((p) => p.missionId === c.missionId) ? cur.filter((p) => p.missionId !== c.missionId) : cur.length >= 3 ? cur : [...cur, c]));
  const addFree = () => {
    const t = free.trim();
    if (!t || picked.length >= 3) return;
    toggle({ missionId: quickMissionId(t), title: t, size, attribute: attr, kind: 'quick' });
    setFree('');
  };
  const groups = [...new Set(candidates.map((c) => c.group))];
  const label = date === state.today ? 'hoy' : date === addDays(state.today, 1) ? 'mañana' : fmtWeekday(date);

  return (
    <Sheet
      open
      onClose={close}
      title={`Plan para ${label}`}
      actions={
        <button
          className="btn primary"
          onClick={() => {
            savePlan(date, picked, state.today);
            close();
          }}
        >
          Guardar plan ({picked.length}/3)
        </button>
      }
    >
      <p className="small muted" style={{ marginTop: 0 }}>
        Máximo 3. Si cumples todas, ganas +5 de oro. Lo que no cumplas no te quita nada.
      </p>
      {picked.length > 0 && (
        <div className="card" style={{ padding: 10 }}>
          {picked.map((p, i) => (
            <div key={p.missionId} className="plan-item" onClick={() => toggle(p)}>
              <span className="plan-num">{i + 1}</span>
              <div className="grow item-title">{p.title}</div>
              <Icon name="x" width={16} />
            </div>
          ))}
        </div>
      )}
      <Field label="Algo nuevo">
        <div className="row" style={{ gap: 6 }}>
          <TextInput className="input grow" value={free} placeholder="Ej. Llamar a 5 clientes" onChange={(e) => setFree(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addFree()} />
          <button className="btn" disabled={!free.trim() || picked.length >= 3} onClick={addFree}>
            <Icon name="plus" />
          </button>
        </div>
      </Field>
      {free.trim() && (
        <>
          <div style={{ marginBottom: 8 }}>
            <SizeChips value={size} onChange={setSize} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <AttrChips value={attr} onChange={setAttr} />
          </div>
        </>
      )}
      {groups.map((g) => (
        <div key={g}>
          <div className="section-title">{g}</div>
          <div className="chips">
            {candidates
              .filter((c) => c.group === g)
              .map((c) => (
                <button key={c.missionId} className={`chip ${isOn(c.missionId) ? 'on' : ''}`} disabled={!isOn(c.missionId) && picked.length >= 3} onClick={() => toggle(c)}>
                  {c.title}
                </button>
              ))}
          </div>
        </div>
      ))}
    </Sheet>
  );
}
