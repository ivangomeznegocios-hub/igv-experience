import { useState } from 'react';
import { GAME_CONFIG, SKILL_RANK_NAMES, type Entity, type SkillData } from '@igv/core';
import { addEvent, deleteEntity, saveEntity, useGame } from '../data/store';
import { fmtDate, newId } from '../lib/time';
import { AttrBadge, AttrSelect, Empty, Field, PageHeader, Sheet, confirmAction } from '../ui/kit';
import { Icon } from '../ui/icons';

export default function Habilidades() {
  const { list, state } = useGame();
  const skills = list<SkillData>('skills', 'skill');
  const [edit, setEdit] = useState<Entity<SkillData> | null>(null);
  const [creating, setCreating] = useState(false);
  const [unlock, setUnlock] = useState<Entity<SkillData> | null>(null);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= skills.length) return;
    const a = skills[i];
    const b = skills[j];
    saveEntity({ ...a, sort: b.sort });
    saveEntity({ ...b, sort: a.sort === b.sort ? a.sort + dir : a.sort });
  };

  return (
    <>
      <PageHeader
        title="Habilidades"
        eyebrow="Ordenadas por prioridad"
        right={
          <button className="btn sm primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> Nueva
          </button>
        }
      />
      {!skills.length && <Empty>Agrega tu primera habilidad.</Empty>}
      {skills.map((s, i) => {
        const st = state.skills[s.id];
        const rank = st?.rank ?? 0;
        return (
          <div key={s.id} className="card">
            <div className="card-head" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <div className="row" style={{ gap: 6 }}>
                  <span className="badge gold">#{i + 1}</span>
                  <AttrBadge attr={s.data.attribute} />
                </div>
                <h2 style={{ marginTop: 6 }}>{s.data.name}</h2>
                <div className="small" style={{ color: rank ? 'var(--violet-2)' : 'var(--muted)', fontWeight: 650 }}>
                  {rank ? SKILL_RANK_NAMES[rank - 1] : 'Sin rango'}
                </div>
              </div>
              <div className="row" style={{ gap: 2 }}>
                <button className="btn icon ghost" aria-label="Subir prioridad" disabled={i === 0} onClick={() => move(i, -1)}>
                  <Icon name="up" />
                </button>
                <button className="btn icon ghost" aria-label="Bajar prioridad" disabled={i === skills.length - 1} onClick={() => move(i, 1)}>
                  <Icon name="down" />
                </button>
                <button className="btn icon ghost" aria-label="Editar" onClick={() => setEdit(s)}>
                  <Icon name="edit" />
                </button>
              </div>
            </div>
            <div className="pips" style={{ marginBottom: 10 }}>
              {[1, 2, 3].map((r) => (
                <div key={r} className={`pip ${r === 3 ? 'gold' : ''} ${rank >= r ? 'on' : ''}`} />
              ))}
            </div>
            {s.data.ranks.map((req, r) => {
              const u = st?.unlocks.find((x) => x.rank === r + 1);
              return (
                <div key={r} className={`item ${u ? 'done' : ''}`} style={{ alignItems: 'flex-start' }}>
                  <div className="grow">
                    <div className="slot-label">{SKILL_RANK_NAMES[r]}</div>
                    <div className="small" style={{ fontWeight: 600 }}>
                      {req}
                    </div>
                    {u && (
                      <div className="tiny muted" style={{ marginTop: 3, textDecoration: 'none' }}>
                        {fmtDate(u.date, true)} · Evidencia: <Evidence text={u.evidence} />
                      </div>
                    )}
                  </div>
                  {!u && rank === r && (
                    <button className="btn sm primary" onClick={() => setUnlock(s)}>
                      Desbloquear
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      {(creating || edit) && <SkillForm initial={edit ?? undefined} onClose={() => (setCreating(false), setEdit(null))} />}
      {unlock && <UnlockSheet skill={unlock} rank={(state.skills[unlock.id]?.rank ?? 0) + 1} onClose={() => setUnlock(null)} />}
    </>
  );
}

function Evidence({ text }: { text: string }) {
  if (/^https?:\/\/\S+$/.test(text.trim()))
    return (
      <a href={text.trim()} target="_blank" rel="noreferrer">
        enlace
      </a>
    );
  return <span>{text}</span>;
}

function UnlockSheet({ skill, rank, onClose }: { skill: Entity<SkillData>; rank: number; onClose: () => void }) {
  const [evidence, setEvidence] = useState('');
  return (
    <Sheet
      open
      onClose={onClose}
      title={`${skill.data.name}: ${SKILL_RANK_NAMES[rank - 1]}`}
      actions={
        <button
          className="btn primary"
          disabled={evidence.trim().length < 3}
          onClick={() => {
            addEvent('skill.rank_unlocked', { skillId: skill.id, rank, evidence: evidence.trim() });
            onClose();
          }}
        >
          Desbloquear (+{GAME_CONFIG.rewards.skillRank} XP)
        </button>
      }
    >
      <p className="small" style={{ marginTop: 0 }}>
        <b>Requisito:</b> {skill.data.ranks[rank - 1]}
      </p>
      <p className="tiny muted">Un rango solo se desbloquea con evidencia escrita: describe qué hiciste o pega un enlace.</p>
      <Field label="Evidencia">
        <textarea className="input" rows={4} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
      </Field>
    </Sheet>
  );
}

function SkillForm({ initial, onClose }: { initial?: Entity<SkillData>; onClose: () => void }) {
  const [d, setD] = useState<SkillData>(initial?.data ?? { name: '', attribute: 'inteligencia', ranks: ['', '', ''] });
  const up = (p: Partial<SkillData>) => setD((x) => ({ ...x, ...p }));
  const valid = d.name.trim() && d.ranks.every((r) => r.trim());
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Editar habilidad' : 'Nueva habilidad'}
      actions={
        <>
          {initial && (
            <button className="btn ghost danger" onClick={() => confirmAction('¿Quitar esta habilidad? Se perdería la XP de sus rangos.') && (deleteEntity(initial.id), onClose())}>
              Quitar
            </button>
          )}
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() => {
              saveEntity({ id: initial?.id ?? `skill-${newId().slice(0, 8)}`, module: 'skills', kind: 'skill', data: d });
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
      <Field label="Atributo">
        <AttrSelect value={d.attribute} onChange={(attribute) => up({ attribute })} />
      </Field>
      {SKILL_RANK_NAMES.map((n, i) => (
        <Field key={n} label={`Requisito para ${n}`}>
          <input className="input" value={d.ranks[i]} onChange={(e) => up({ ranks: d.ranks.map((r, j) => (j === i ? e.target.value : r)) as SkillData['ranks'] })} />
        </Field>
      ))}
    </Sheet>
  );
}
