import { useState } from 'react';
import { GAME_CONFIG, type AchievementCondition, type AchievementData, type Entity } from '@igv/core';
import { addEvent, deleteEntity, saveEntity, useGame } from '../data/store';
import { fmtDate, newId } from '../lib/time';
import { Bar, Field, PageHeader, Sheet, confirmAction, TextInput } from '../ui/kit';
import { Icon } from '../ui/icons';

const ICONS = ['star', 'step', 'flame', 'bolt', 'handshake', 'chat', 'target', 'scroll', 'heart', 'globe', 'coin', 'compass', 'crown', 'trophy', 'shield', 'book'];

export default function Logros() {
  const { list, state } = useGame();
  const items = list<AchievementData>('achievements', 'achievement');
  const [open, setOpen] = useState<Entity<AchievementData> | null>(null);
  const [creating, setCreating] = useState(false);
  const unlocked = items.filter((a) => state.achievements[a.id]?.unlocked).length;
  return (
    <>
      <PageHeader
        title="Logros"
        eyebrow={`${unlocked} de ${items.length} desbloqueados`}
        right={
          <button className="btn sm primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> Nuevo
          </button>
        }
      />
      <div className="ach-grid">
        {[...items]
          .sort((a, b) => Number(!!state.achievements[b.id]?.unlocked) - Number(!!state.achievements[a.id]?.unlocked))
          .map((a) => {
            const st = state.achievements[a.id];
            return (
              <button key={a.id} className={`ach ${st?.unlocked ? '' : 'locked'}`} onClick={() => setOpen(a)}>
                <div className="ach-icon">
                  <Icon name={a.data.icon} />
                </div>
                <div className="ach-name">{a.data.name}</div>
                <div className="tiny muted" style={{ marginTop: 2 }}>
                  {st?.unlocked ? fmtDate(st.date, true) : st?.auto ? 'Automático' : 'Manual'}
                </div>
                {!st?.unlocked && st?.progress && (
                  <div style={{ marginTop: 6 }}>
                    <Bar value={st.progress.current} max={st.progress.target} size="sm" />
                  </div>
                )}
              </button>
            );
          })}
      </div>
      {open && <AchievementSheet a={open} onClose={() => setOpen(null)} />}
      {creating && <AchievementForm onClose={() => setCreating(false)} />}
    </>
  );
}

function AchievementSheet({ a, onClose }: { a: Entity<AchievementData>; onClose: () => void }) {
  const { state } = useGame();
  const st = state.achievements[a.id];
  const [edit, setEdit] = useState(false);
  if (edit) return <AchievementForm initial={a} onClose={onClose} />;
  return (
    <Sheet
      open
      onClose={onClose}
      title={a.data.name}
      actions={
        <>
          <button className="btn ghost" onClick={() => setEdit(true)}>
            Editar
          </button>
          {!st?.unlocked && (
            <button
              className="btn primary"
              onClick={() => {
                if (confirmAction(`¿Desbloquear "${a.data.name}"? (+${GAME_CONFIG.rewards.achievement} XP)`)) {
                  addEvent('achievement.unlocked', { achievementId: a.id });
                  onClose();
                }
              }}
            >
              Desbloquear
            </button>
          )}
        </>
      }
    >
      <div className={`ach ${st?.unlocked ? '' : 'locked'}`} style={{ cursor: 'default', marginBottom: 12 }}>
        <div className="ach-icon">
          <Icon name={a.data.icon} />
        </div>
        <div>{a.data.description}</div>
      </div>
      <p className="small muted">
        {st?.unlocked
          ? `Desbloqueado el ${fmtDate(st.date, true)} · +${GAME_CONFIG.rewards.achievement} XP`
          : st?.auto
            ? 'Se desbloquea solo cuando se cumple la condición. Si la cumpliste fuera de la app, puedes desbloquearlo a mano.'
            : 'Este logro se desbloquea a mano.'}
      </p>
      {st?.progress && !st.unlocked && <Bar value={st.progress.current} max={st.progress.target} label={<span className="num">{st.progress.current} / {st.progress.target}</span>} />}
    </Sheet>
  );
}

function AchievementForm({ initial, onClose }: { initial?: Entity<AchievementData>; onClose: () => void }) {
  const [d, setD] = useState<AchievementData>(initial?.data ?? { name: '', description: '', icon: 'star', condition: { type: 'manual' } });
  const up = (p: Partial<AchievementData>) => setD((x) => ({ ...x, ...p }));
  const c = d.condition;
  const setCond = (type: string) => {
    const map: Record<string, AchievementCondition> = {
      manual: { type: 'manual' },
      missions_completed: { type: 'missions_completed', count: 10 },
      streak: { type: 'streak', days: 14 },
      lessons: { type: 'lessons', count: 10 },
      discoveries: { type: 'discoveries', count: 10 },
    };
    up({ condition: map[type] ?? c });
  };
  const n = 'count' in c ? c.count : 'days' in c ? c.days : 0;
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Editar logro' : 'Nuevo logro'}
      actions={
        <>
          {initial && (
            <button className="btn ghost danger" onClick={() => confirmAction('¿Borrar este logro?') && (deleteEntity(initial.id), onClose())}>
              Borrar
            </button>
          )}
          <button
            className="btn primary"
            disabled={!d.name.trim()}
            onClick={() => {
              saveEntity({ id: initial?.id ?? `ach-${newId().slice(0, 8)}`, module: 'achievements', kind: 'achievement', data: d });
              onClose();
            }}
          >
            Guardar
          </button>
        </>
      }
    >
      <Field label="Nombre">
        <TextInput className="input" value={d.name} onChange={(e) => up({ name: e.target.value })} />
      </Field>
      <Field label="Descripción">
        <TextInput className="input" value={d.description} onChange={(e) => up({ description: e.target.value })} />
      </Field>
      <Field label="Ícono">
        <div className="row wrap" style={{ gap: 6 }}>
          {ICONS.map((i) => (
            <button key={i} className={`btn icon ${d.icon === i ? 'violet' : ''}`} onClick={() => up({ icon: i })} aria-label={i}>
              <Icon name={i} />
            </button>
          ))}
        </div>
      </Field>
      <Field label="Condición">
        <select className="input" value={['manual', 'missions_completed', 'streak', 'lessons', 'discoveries'].includes(c.type) ? c.type : 'other'} onChange={(e) => setCond(e.target.value)}>
          <option value="manual">Manual</option>
          <option value="missions_completed">Misiones completadas</option>
          <option value="streak">Días de racha</option>
          <option value="lessons">Lecciones escritas</option>
          <option value="discoveries">Primeras visitas en el mapa</option>
          {!['manual', 'missions_completed', 'streak', 'lessons', 'discoveries'].includes(c.type) && <option value="other">Automática (predefinida)</option>}
        </select>
      </Field>
      {(c.type === 'missions_completed' || c.type === 'lessons' || c.type === 'discoveries' || c.type === 'streak') && (
        <Field label="Cantidad">
          <input
            className="input"
            type="number"
            min={1}
            value={n}
            onChange={(e) => up({ condition: c.type === 'streak' ? { ...c, days: Number(e.target.value) } : ({ ...c, count: Number(e.target.value) } as AchievementCondition) })}
          />
        </Field>
      )}
    </Sheet>
  );
}
