import { useState } from 'react';
import { DAILY_SLOTS, type Entity, type MissionData, type MissionKind, type MainQuestData } from '@igv/core';
import { saveEntity, useGame } from '../data/store';
import { newId } from '../lib/time';
import { writeLesson } from '../lib/actions';
import { AttrChips, Field, Sheet, SizeChips, useAutoFocus } from './kit';

const KIND_LABEL: Record<string, string> = { side: 'secundaria', daily: 'diaria', event: 'evento', chapter: 'capítulo' };

export function MissionForm({
  open,
  onClose,
  kind,
  initial,
  defaults,
}: {
  open: boolean;
  onClose: () => void;
  kind: Exclude<MissionKind, 'main'>;
  initial?: Entity<MissionData> | null;
  defaults?: Partial<MissionData>;
}) {
  const { list } = useGame();
  const quests = list<MainQuestData>('missions', 'main');
  const [d, setD] = useState<MissionData>(
    () =>
      initial?.data ?? {
        title: '',
        size: kind === 'chapter' ? 'epica' : kind === 'daily' ? 'chica' : 'grande',
        attribute: 'disciplina',
        mainQuestId: null,
        category: kind === 'daily' ? 'libre' : undefined,
        ...defaults,
      },
  );
  const ref = useAutoFocus<HTMLInputElement>();
  const up = (p: Partial<MissionData>) => setD((x) => ({ ...x, ...p }));
  const save = () => {
    if (!d.title.trim()) return;
    saveEntity({ id: initial?.id ?? `${kind}-${newId().slice(0, 8)}`, module: 'missions', kind, data: { ...d, title: d.title.trim() } });
    onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={initial ? `Editar ${KIND_LABEL[kind]}` : `Nueva ${KIND_LABEL[kind]}`}
      actions={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" onClick={save} disabled={!d.title.trim()}>
            Guardar
          </button>
        </>
      }
    >
      <Field label="Nombre">
        <input ref={ref} className="input" value={d.title} onChange={(e) => up({ title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && save()} />
      </Field>
      <Field label="Tamaño">
        <SizeChips value={d.size} onChange={(size) => up({ size })} />
      </Field>
      <Field label="Atributo">
        <AttrChips value={d.attribute} onChange={(attribute) => up({ attribute })} />
      </Field>
      <Field label="Misión principal ligada">
        <select className="input" value={d.mainQuestId ?? ''} onChange={(e) => up({ mainQuestId: e.target.value || null })}>
          <option value="">— Ninguna —</option>
          {quests.map((q) => (
            <option key={q.id} value={q.id}>
              {q.data.code} {q.data.title}
            </option>
          ))}
        </select>
      </Field>
      {kind === 'daily' && (
        <>
          <Field label="Categoría del menú">
            <select className="input" value={d.category ?? 'libre'} onChange={(e) => up({ category: e.target.value as MissionData['category'] })}>
              {DAILY_SLOTS.map((s) => (
                <option key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </Field>
          <label className="checkbox">
            <input type="checkbox" checked={d.routine !== false} onChange={(e) => up({ routine: e.target.checked })} />
            En mi rutina (aparece sola en Hoy como check)
          </label>
          {d.routine !== false && (
            <Field label="¿Qué días? (ninguno = todos)">
              <div className="chips">
                {['L', 'M', 'Mi', 'J', 'V', 'S', 'D'].map((l, i) => {
                  const on = d.days?.includes(i) ?? false;
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`chip ${on ? 'on' : ''}`}
                      onClick={() => up({ days: on ? (d.days ?? []).filter((x) => x !== i) : [...(d.days ?? []), i].sort() })}
                    >
                      {l}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}
          <label className="checkbox">
            <input type="checkbox" checked={!!d.recovery} onChange={(e) => up({ recovery: e.target.checked })} />
            Misión de recuperación (se sugiere con energía baja)
          </label>
        </>
      )}
      {kind === 'chapter' && (
        <Field label="Número de capítulo">
          <input className="input" type="number" min={1} value={d.number ?? 1} onChange={(e) => up({ number: Number(e.target.value) })} />
        </Field>
      )}
      {kind === 'event' && (
        <Field label="Fecha (opcional)">
          <input className="input" type="date" value={d.date ?? ''} onChange={(e) => up({ date: e.target.value || null })} />
        </Field>
      )}
      <Field label="Notas">
        <textarea className="input" value={d.notes ?? ''} onChange={(e) => up({ notes: e.target.value })} />
      </Field>
    </Sheet>
  );
}

export function LessonForm({ open, onClose, mission }: { open: boolean; onClose: () => void; mission?: Entity<MissionData> | null }) {
  const { list } = useGame();
  const [text, setText] = useState('');
  const [missionId, setMissionId] = useState(mission?.id ?? '');
  const ref = useAutoFocus<HTMLTextAreaElement>();
  const all = list<MissionData>('missions').filter((m) => m.kind !== 'main');
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Escribir lección"
      actions={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn primary"
            disabled={text.trim().length < 3}
            onClick={() => {
              writeLesson(text.trim(), all.find((m) => m.id === missionId) ?? null);
              onClose();
            }}
          >
            Guardar (+30 XP)
          </button>
        </>
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        Un fracaso con lección escrita vale 30 XP. Suma al atributo de la misión en la que fallaste (o a Inteligencia).
      </p>
      <Field label="¿En qué misión fallaste? (opcional)">
        <select className="input" value={missionId} onChange={(e) => setMissionId(e.target.value)}>
          <option value="">— Ninguna (Inteligencia) —</option>
          {all.map((m) => (
            <option key={m.id} value={m.id}>
              {m.data.title}
            </option>
          ))}
        </select>
      </Field>
      <Field label="¿Qué aprendí?">
        <textarea ref={ref} className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Qué pasó, por qué, y qué haré distinto." />
      </Field>
    </Sheet>
  );
}
