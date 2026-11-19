import { useState } from 'react';
import { GAME_CONFIG, type BossData, type BossPhase, type Entity, type MainQuestData, type MissionData, type PhaseMetric, type RecurringBossData } from '@igv/core';
import { addEvent, deleteEntity, saveEntity, useGame } from '../data/store';
import { bossHpPercent } from '../lib/narrator';
import { fmtDate, fmtMoney, newId } from '../lib/time';
import { BossArt, BossHpBar } from '../ui/BossArt';
import { Icon } from '../ui/icons';
import { AttrSelect, Badge, Bar, Empty, Field, PageHeader, Sheet, Tabs, confirmAction } from '../ui/kit';
import { startMissionQuest } from '../ui/QuestMode';
import { openQuickAdd } from '../ui/QuickAdd';

export default function Jefes() {
  const [tab, setTab] = useState<'boss' | 'recurring'>('boss');
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Jefes"
        eyebrow="Arena de Progresión"
        right={
          <button className="btn sm primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> Nuevo
          </button>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'boss', label: 'Jefes de misión' },
          { value: 'recurring', label: 'Recurrentes' },
        ]}
      />
      {tab === 'boss' ? <BossList /> : <RecurringList />}
      {creating && (tab === 'boss' ? <BossForm onClose={() => setCreating(false)} /> : <RecurringForm onClose={() => setCreating(false)} />)}
    </>
  );
}

function metricText(m: PhaseMetric, byId: Map<string, Entity>): string {
  switch (m.type) {
    case 'manual':
      return 'Se marca a mano';
    case 'month_income':
      return `Automático: ingreso de un mes ≥ ${fmtMoney(m.amount)}`;
    case 'consecutive_months_income':
      return `Automático: ${m.months} meses seguidos ≥ ${fmtMoney(m.amount)}`;
    case 'weekly_streak':
      return `Automático: ${m.perWeek}×/semana de ${m.missionIds.map((id) => (byId.get(id)?.data as MissionData | undefined)?.title ?? '¿?').join(' o ')}, ${m.weeks} semanas seguidas`;
  }
}

function BossList() {
  const { list, state, byId } = useGame();
  const bosses = list<BossData>('bosses', 'boss');
  const [edit, setEdit] = useState<Entity<BossData> | null>(null);
  if (!bosses.length) return <Empty>No hay jefes.</Empty>;
  return (
    <>
      {bosses.map((b) => {
        const st = state.bosses.bosses[b.id];
        const quest = b.data.mainQuestId ? (byId.get(b.data.mainQuestId) as Entity<MainQuestData> | undefined) : undefined;
        const lockName = b.data.lockedUntilBossId ? (byId.get(b.data.lockedUntilBossId)?.data as BossData | undefined)?.name : null;
        const { totalHpPct, nextPhaseIndex } = bossHpPercent(b, state);
        const nextMetric = nextPhaseIndex < b.data.phases.length ? b.data.phases[nextPhaseIndex]?.metric : null;
        const linkedMission =
          nextMetric?.type === 'weekly_streak' && nextMetric.missionIds[0]
            ? (byId.get(nextMetric.missionIds[0]) as Entity<MissionData> | undefined)
            : undefined;
        const isIncomeBoss = nextMetric?.type === 'month_income' || nextMetric?.type === 'consecutive_months_income';

        return (
          <div key={b.id} className={`card ${st?.defeated ? 'perfect-card' : 'boss-encounter'}`} style={st?.locked ? { opacity: 0.6 } : undefined}>
            <div className="row" style={{ alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <BossArt bossId={b.id} size={64} defeated={st?.defeated} locked={st?.locked} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row wrap" style={{ gap: 6 }}>
                  {quest && <Badge tone="gold">{quest.data.code}</Badge>}
                  {st?.defeated && <Badge tone="green">Derrotado {fmtDate(st.defeatedOn, true)}</Badge>}
                  {st?.locked && (
                    <Badge tone="red">
                      <Icon name="lock" width={11} /> Bloqueado hasta vencer a {lockName}
                    </Badge>
                  )}
                </div>
                <h2 style={{ margin: '5px 0 3px' }}>{b.data.name}</h2>
                <div className="small muted">{b.data.description}</div>
              </div>
              <button className="btn icon ghost" aria-label="Editar" onClick={() => setEdit(b)}>
                <Icon name="edit" />
              </button>
            </div>

            <BossHpBar
              hpPct={st?.defeated ? 0 : totalHpPct}
              label={`HP total · ${st?.phasesDone ?? 0}/${b.data.phases.length} fases vencidas`}
              right={st?.defeated ? '0% HP' : `${totalHpPct}% HP`}
            />

            {!st?.locked && !st?.defeated && (linkedMission || isIncomeBoss) && (
              <div style={{ marginTop: 10 }}>
                {linkedMission && (
                  <button className="btn sm primary" onClick={() => startMissionQuest(linkedMission)}>
                    <Icon name="play" /> Atacar ({linkedMission.data.title})
                  </button>
                )}
                {isIncomeBoss && (
                  <button className="btn sm primary" onClick={() => openQuickAdd({ mode: 'income' })}>
                    <Icon name="sword" /> Atacar (Registrar ingreso)
                  </button>
                )}
              </div>
            )}

            <div style={{ marginTop: 10 }}>
              {b.data.phases.map((ph, i) => {
                const ps = st?.phases[i];
                const isNext = !ps?.done && (i === 0 || st?.phases[i - 1]?.done) && !st?.locked;
                return (
                  <div key={i} className={`item ${ps?.done ? 'done' : ''}`}>
                    <div className={`check ${ps?.done ? 'done' : ''}`} style={{ width: 32, height: 32, cursor: 'default' }}>
                      {ps?.done ? <Icon name="check" /> : <span className="tiny muted">{i + 1}</span>}
                    </div>
                    <div className="grow">
                      <div className="item-title">{ph.title}</div>
                      <div className="tiny muted">
                        {ps?.done ? `Vencida el ${fmtDate(ps.date, true)} · +${GAME_CONFIG.rewards.bossPhase} XP` : metricText(ph.metric, byId)}
                      </div>
                      {isNext && ps?.progress && ps.progress.target > 0 && (
                        <div style={{ marginTop: 6 }}>
                          <Bar
                            value={ps.progress.current}
                            max={ps.progress.target}
                            tone="flame"
                            size="sm"
                            label={
                              <span className="num">
                                {ps.progress.unit === 'MXN' ? `${fmtMoney(ps.progress.current)} / ${fmtMoney(ps.progress.target)} este mes` : `${ps.progress.current} / ${ps.progress.target} ${ps.progress.unit}`}
                              </span>
                            }
                          />
                        </div>
                      )}
                    </div>
                    {isNext && ph.metric.type === 'manual' && (
                      <button
                        className="btn sm primary"
                        onClick={() => confirmAction(`¿Venciste la fase "${ph.title}"? (+${GAME_CONFIG.rewards.bossPhase} XP)`) && addEvent('boss.phase_completed', { bossId: b.id, phaseIndex: i })}
                      >
                        Vencí
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {edit && <BossForm initial={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function BossForm({ initial, onClose }: { initial?: Entity<BossData>; onClose: () => void }) {
  const { list } = useGame();
  const quests = list<MainQuestData>('missions', 'main');
  const bosses = list<BossData>('bosses', 'boss').filter((b) => b.id !== initial?.id);
  const missions = list<MissionData>('missions').filter((m) => m.kind !== 'main');
  const [d, setD] = useState<BossData>(initial?.data ?? { name: '', description: '', mainQuestId: null, lockedUntilBossId: null, phases: [{ title: '', metric: { type: 'manual' } }] });
  const up = (p: Partial<BossData>) => setD((x) => ({ ...x, ...p }));
  const upPhase = (i: number, p: Partial<BossPhase>) => setD((x) => ({ ...x, phases: x.phases.map((ph, j) => (j === i ? { ...ph, ...p } : ph)) }));
  const setMetricType = (i: number, type: PhaseMetric['type']) => {
    const m: PhaseMetric =
      type === 'manual'
        ? { type }
        : type === 'month_income'
          ? { type, amount: 50000 }
          : type === 'consecutive_months_income'
            ? { type, amount: 100000, months: 3 }
            : { type, missionIds: [], perWeek: 1, weeks: 4 };
    upPhase(i, { metric: m });
  };
  const valid = d.name.trim() && d.phases.length > 0 && d.phases.every((p) => p.title.trim());
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Editar jefe' : 'Nuevo jefe de misión'}
      actions={
        <>
          {initial && (
            <button className="btn ghost danger" onClick={() => confirmAction('¿Borrar este jefe? La XP ya ganada se perdería si dependía de sus fases.') && (deleteEntity(initial.id), onClose())}>
              Borrar
            </button>
          )}
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() => {
              saveEntity({ id: initial?.id ?? `boss-${newId().slice(0, 8)}`, module: 'bosses', kind: 'boss', data: d });
              onClose();
            }}
          >
            Guardar
          </button>
        </>
      }
    >
      <Field label="Nombre">
        <input className="input" value={d.name} onChange={(e) => up({ name: e.target.value })} />
      </Field>
      <Field label="Descripción">
        <textarea className="input" value={d.description} onChange={(e) => up({ description: e.target.value })} />
      </Field>
      <div className="grid2">
        <Field label="Misión principal">
          <select className="input" value={d.mainQuestId ?? ''} onChange={(e) => up({ mainQuestId: e.target.value || null })}>
            <option value="">— Ninguna —</option>
            {quests.map((q) => (
              <option key={q.id} value={q.id}>
                {q.data.code} {q.data.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bloqueado hasta vencer a">
          <select className="input" value={d.lockedUntilBossId ?? ''} onChange={(e) => up({ lockedUntilBossId: e.target.value || null })}>
            <option value="">— Nadie —</option>
            {bosses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.data.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {!d.mainQuestId && (
        <Field label="Atributo de las fases">
          <AttrSelect value={d.attribute ?? 'disciplina'} onChange={(attribute) => up({ attribute })} />
        </Field>
      )}
      <div className="section-title">Fases</div>
      {d.phases.map((ph, i) => (
        <div key={i} className="card flat" style={{ padding: 10 }}>
          <div className="row">
            <input className="input" placeholder={`Fase ${i + 1}`} value={ph.title} onChange={(e) => upPhase(i, { title: e.target.value })} />
            <button className="btn icon ghost danger" aria-label="Quitar fase" disabled={d.phases.length <= 1} onClick={() => up({ phases: d.phases.filter((_, j) => j !== i) })}>
              <Icon name="trash" />
            </button>
          </div>
          <select className="input" style={{ marginTop: 8 }} value={ph.metric.type} onChange={(e) => setMetricType(i, e.target.value as PhaseMetric['type'])}>
            <option value="manual">Manual (lo marco yo)</option>
            <option value="month_income">Ingreso de un mes ≥ monto</option>
            <option value="consecutive_months_income">Meses seguidos con ingreso ≥ monto</option>
            <option value="weekly_streak">Semanas seguidas cumpliendo una misión</option>
          </select>
          {(ph.metric.type === 'month_income' || ph.metric.type === 'consecutive_months_income') && (
            <div className="grid2" style={{ marginTop: 8 }}>
              <input className="input" type="number" value={ph.metric.amount} onChange={(e) => upPhase(i, { metric: { ...ph.metric, amount: Number(e.target.value) } as PhaseMetric })} />
              {ph.metric.type === 'consecutive_months_income' && (
                <input className="input" type="number" min={1} value={ph.metric.months} onChange={(e) => upPhase(i, { metric: { ...ph.metric, months: Number(e.target.value) } as PhaseMetric })} />
              )}
            </div>
          )}
          {ph.metric.type === 'weekly_streak' && (
            <>
              <select
                className="input"
                style={{ marginTop: 8 }}
                value={ph.metric.missionIds[0] ?? ''}
                onChange={(e) => upPhase(i, { metric: { ...ph.metric, missionIds: e.target.value ? [e.target.value] : [] } as PhaseMetric })}
              >
                <option value="">— Elige la misión —</option>
                {missions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.data.title}
                  </option>
                ))}
              </select>
              <div className="grid2" style={{ marginTop: 8 }}>
                <label className="tiny muted">
                  Veces por semana
                  <input className="input" type="number" min={1} value={ph.metric.perWeek} onChange={(e) => upPhase(i, { metric: { ...ph.metric, perWeek: Number(e.target.value) } as PhaseMetric })} />
                </label>
                <label className="tiny muted">
                  Semanas seguidas
                  <input className="input" type="number" min={1} value={ph.metric.weeks} onChange={(e) => upPhase(i, { metric: { ...ph.metric, weeks: Number(e.target.value) } as PhaseMetric })} />
                </label>
              </div>
            </>
          )}
        </div>
      ))}
      <button className="btn sm" onClick={() => up({ phases: [...d.phases, { title: '', metric: { type: 'manual' } }] })}>
        <Icon name="plus" /> Fase
      </button>
    </Sheet>
  );
}

function RecurringList() {
  const { list, state } = useGame();
  const items = list<RecurringBossData>('bosses', 'recurring');
  const [defeat, setDefeat] = useState<Entity<RecurringBossData> | null>(null);
  const [edit, setEdit] = useState<Entity<RecurringBossData> | null>(null);
  const [note, setNote] = useState('');
  if (!items.length) return <Empty>No hay jefes recurrentes.</Empty>;
  return (
    <>
      {items.map((b) => {
        const r = state.bosses.recurring[b.id];
        return (
          <div key={b.id} className="card">
            <div className="row" style={{ alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
              <BossArt bossId={b.id} size={56} />
              <div className="grow">
                <h2 style={{ margin: '0 0 3px' }}>{b.data.name}</h2>
                <div className="small muted">{b.data.description}</div>
                <div className="small" style={{ marginTop: 6 }}>
                  <b>Se vence con:</b> {b.data.defeatCondition}
                </div>
              </div>
              <button className="btn icon ghost" aria-label="Editar" onClick={() => setEdit(b)}>
                <Icon name="edit" />
              </button>
            </div>
            <div className="row between">
              <span className="small muted">
                Vencido {r?.defeats ?? 0} {r?.defeats === 1 ? 'vez' : 'veces'}
                {r?.lastDate ? ` · última ${fmtDate(r.lastDate, true)}` : ''}
              </span>
              <button
                className="btn sm primary"
                onClick={() => {
                  setNote('');
                  setDefeat(b);
                }}
              >
                <Icon name="sword" /> Lo vencí (+{GAME_CONFIG.rewards.recurringBoss})
              </button>
            </div>
          </div>
        );
      })}
      {defeat && (
        <Sheet
          open
          onClose={() => setDefeat(null)}
          title={`Vencer a ${defeat.data.name}`}
          actions={
            <button
              className="btn primary"
              disabled={!note.trim()}
              onClick={() => {
                addEvent('boss.recurring_defeated', { bossId: defeat.id, note: note.trim() });
                setDefeat(null);
              }}
            >
              Registrar
            </button>
          }
        >
          <p className="small muted" style={{ marginTop: 0 }}>
            {defeat.data.defeatCondition}
          </p>
          <Field label="Evidencia">
            <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="La decisión que tomé / lo que entregué" />
          </Field>
        </Sheet>
      )}
      {edit && <RecurringForm initial={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function RecurringForm({ initial, onClose }: { initial?: Entity<RecurringBossData>; onClose: () => void }) {
  const [d, setD] = useState<RecurringBossData>(initial?.data ?? { name: '', description: '', defeatCondition: '', attribute: 'disciplina' });
  const up = (p: Partial<RecurringBossData>) => setD((x) => ({ ...x, ...p }));
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Editar jefe recurrente' : 'Nuevo jefe recurrente'}
      actions={
        <>
          {initial && (
            <button className="btn ghost danger" onClick={() => confirmAction('¿Borrar este jefe?') && (deleteEntity(initial.id), onClose())}>
              Borrar
            </button>
          )}
          <button
            className="btn primary"
            disabled={!d.name.trim()}
            onClick={() => {
              saveEntity({ id: initial?.id ?? `rb-${newId().slice(0, 8)}`, module: 'bosses', kind: 'recurring', data: d });
              onClose();
            }}
          >
            Guardar
          </button>
        </>
      }
    >
      <Field label="Nombre">
        <input className="input" value={d.name} onChange={(e) => up({ name: e.target.value })} />
      </Field>
      <Field label="Descripción">
        <textarea className="input" value={d.description} onChange={(e) => up({ description: e.target.value })} />
      </Field>
      <Field label="Se vence con">
        <input className="input" value={d.defeatCondition} onChange={(e) => up({ defeatCondition: e.target.value })} />
      </Field>
      <Field label="Atributo">
        <AttrSelect value={d.attribute} onChange={(attribute) => up({ attribute })} />
      </Field>
    </Sheet>
  );
}
