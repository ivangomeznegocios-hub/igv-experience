import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ATTRIBUTE_NAMES, type BossData, type Entity, type MainQuestData, type MissionData, type MissionKind } from '@igv/core';
import { deleteEntity, saveEntity, useGame } from '../data/store';
import { completeMission, isDone } from '../lib/actions';
import { fmtDate, newId } from '../lib/time';
import { AttrBadge, AttrSelect, Badge, Empty, Field, PageHeader, Sheet, SizeBadge, Tabs, confirmAction } from '../ui/kit';
import { Icon } from '../ui/icons';
import { LessonForm, MissionForm } from '../ui/MissionForm';

type Tab = 'main' | 'side' | 'daily' | 'event';

export default function Misiones() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'main';
  const [creating, setCreating] = useState(false);
  const [creatingMain, setCreatingMain] = useState(false);
  return (
    <>
      <PageHeader
        title="Misiones"
        right={
          <button className="btn sm primary" onClick={() => (tab === 'main' ? setCreatingMain(true) : setCreating(true))}>
            <Icon name="plus" /> Nueva
          </button>
        }
      />
      <Tabs
        value={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
        options={[
          { value: 'main', label: 'Principales' },
          { value: 'side', label: 'Secundarias' },
          { value: 'daily', label: 'Diarias' },
          { value: 'event', label: 'Eventos' },
        ]}
      />
      {tab === 'main' && <MainQuests />}
      {tab !== 'main' && <MissionList kind={tab} />}
      {creating && tab !== 'main' && <MissionForm open kind={tab} onClose={() => setCreating(false)} />}
      {creatingMain && <MainQuestForm onClose={() => setCreatingMain(false)} />}
    </>
  );
}

function MainQuests() {
  const { list, state } = useGame();
  const quests = list<MainQuestData>('missions', 'main');
  const chapters = list<MissionData>('missions', 'chapter');
  const bosses = list<BossData>('bosses', 'boss');
  const [edit, setEdit] = useState<Entity<MainQuestData> | null>(null);
  const [chapterFor, setChapterFor] = useState<{ quest: Entity<MainQuestData>; chapter?: Entity<MissionData> } | null>(null);
  const focusId = state.seasons.current?.data.focusMainQuestId;
  if (!quests.length) return <Empty>No hay misiones principales.</Empty>;
  return (
    <>
      {quests.map((q) => {
        const chs = chapters.filter((c) => c.data.mainQuestId === q.id).sort((a, b) => (a.data.number ?? 0) - (b.data.number ?? 0));
        const boss = bosses.find((b) => b.data.mainQuestId === q.id);
        const bs = boss ? state.bosses.bosses[boss.id] : null;
        return (
          <div key={q.id} className="card">
            <div className="card-head" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <div className="row wrap" style={{ gap: 6 }}>
                  <Badge tone="gold">{q.data.code}</Badge>
                  {focusId === q.id && <Badge tone="blue">En foco</Badge>}
                  <AttrBadge attr={q.data.attribute} />
                </div>
                <h2 style={{ marginTop: 6 }}>{q.data.title}</h2>
                <div className="small muted">{q.data.goal}</div>
              </div>
              <button className="btn icon ghost" aria-label="Editar" onClick={() => setEdit(q)}>
                <Icon name="edit" />
              </button>
            </div>
            {chs.map((c) => {
              const done = isDone(state.missions.completions, c.id);
              return (
                <div key={c.id} className={`item ${done ? 'done' : ''}`}>
                  <button
                    className={`check ${done ? 'done' : ''}`}
                    disabled={done}
                    aria-label={`Completar capítulo ${c.data.number}`}
                    onClick={() => confirmAction(`¿Completaste el capítulo ${c.data.number}: "${c.data.title}"?`) && completeMission(c)}
                  >
                    <Icon name="check" />
                  </button>
                  <div className="grow">
                    <div className="slot-label">Capítulo {c.data.number}</div>
                    <div className="item-title">{c.data.title}</div>
                    <div className="row wrap" style={{ gap: 4, marginTop: 3 }}>
                      <SizeBadge size={c.data.size} />
                      {done && <Badge tone="green">{fmtDate(state.missions.completions[c.id].firstDate, true)}</Badge>}
                    </div>
                  </div>
                  <button className="btn icon ghost" aria-label="Editar capítulo" onClick={() => setChapterFor({ quest: q, chapter: c })}>
                    <Icon name="edit" />
                  </button>
                </div>
              );
            })}
            <div className="row between" style={{ marginTop: 8 }}>
              <button className="btn sm ghost" onClick={() => setChapterFor({ quest: q })}>
                <Icon name="plus" /> Capítulo
              </button>
              {boss && bs && (
                <span className="small muted">
                  <Icon name="skull" width={14} style={{ verticalAlign: -2 }} /> {boss.data.name}: {bs.locked ? 'bloqueado' : `${bs.phasesDone}/${bs.phases.length} fases`}
                </span>
              )}
            </div>
          </div>
        );
      })}
      {edit && <MainQuestForm initial={edit} onClose={() => setEdit(null)} />}
      {chapterFor && (
        <MissionForm
          open
          kind="chapter"
          initial={chapterFor.chapter}
          defaults={{
            mainQuestId: chapterFor.quest.id,
            attribute: chapterFor.quest.data.attribute,
            number: chapters.filter((c) => c.data.mainQuestId === chapterFor.quest.id).length + 1,
          }}
          onClose={() => setChapterFor(null)}
        />
      )}
    </>
  );
}

function MainQuestForm({ initial, onClose }: { initial?: Entity<MainQuestData>; onClose: () => void }) {
  const { list } = useGame();
  const count = list('missions', 'main').length;
  const [d, setD] = useState<MainQuestData>(initial?.data ?? { code: String(count + 1).padStart(2, '0'), title: '', goal: '', attribute: 'disciplina' });
  const up = (p: Partial<MainQuestData>) => setD((x) => ({ ...x, ...p }));
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Editar misión principal' : 'Nueva misión principal'}
      actions={
        <>
          {initial && (
            <button
              className="btn danger ghost"
              onClick={() => {
                if (confirmAction('¿Borrar esta misión principal? Su historial de XP se conserva.')) {
                  deleteEntity(initial.id);
                  onClose();
                }
              }}
            >
              Borrar
            </button>
          )}
          <button
            className="btn primary"
            disabled={!d.title.trim()}
            onClick={() => {
              saveEntity({ id: initial?.id ?? `mq-${newId().slice(0, 8)}`, module: 'missions', kind: 'main', data: d });
              onClose();
            }}
          >
            Guardar
          </button>
        </>
      }
    >
      <div className="grid2">
        <Field label="Código">
          <input className="input" value={d.code} onChange={(e) => up({ code: e.target.value })} />
        </Field>
        <Field label="Atributo">
          <AttrSelect value={d.attribute} onChange={(attribute) => up({ attribute })} />
        </Field>
      </div>
      <Field label="Nombre">
        <input className="input" value={d.title} onChange={(e) => up({ title: e.target.value })} />
      </Field>
      <Field label="Objetivo">
        <textarea className="input" value={d.goal} onChange={(e) => up({ goal: e.target.value })} />
      </Field>
      <p className="tiny muted">Las fases de jefe de esta misión suman XP a {ATTRIBUTE_NAMES[d.attribute]}.</p>
    </Sheet>
  );
}

function MissionList({ kind }: { kind: Exclude<MissionKind, 'main' | 'chapter'> }) {
  const { list, state, byId } = useGame();
  const items = list<MissionData>('missions', kind);
  const [edit, setEdit] = useState<Entity<MissionData> | null>(null);
  const [lessonFor, setLessonFor] = useState<Entity<MissionData> | null>(null);
  const [showDone, setShowDone] = useState(false);
  const repeatable = kind === 'daily';
  const today = new Set(state.missions.completedToday);
  const pending = items.filter((m) => repeatable || !isDone(state.missions.completions, m.id));
  const done = repeatable ? [] : items.filter((m) => isDone(state.missions.completions, m.id));
  const groups = repeatable ? (['trabajo', 'cuerpo', 'libre'] as const).map((c) => ({ c, items: pending.filter((m) => (m.data.category ?? 'libre') === c) })) : [{ c: null, items: pending }];

  const row = (m: Entity<MissionData>) => {
    const completed = repeatable ? today.has(m.id) : isDone(state.missions.completions, m.id);
    const quest = m.data.mainQuestId ? (byId.get(m.data.mainQuestId) as Entity<MainQuestData> | undefined) : undefined;
    const c = state.missions.completions[m.id];
    return (
      <div key={m.id} className={`item ${completed ? 'done' : ''}`}>
        <button
          className={`check ${completed ? 'done' : ''}`}
          disabled={completed}
          aria-label={`Completar ${m.data.title}`}
          onClick={() => (repeatable || confirmAction(`¿Completaste "${m.data.title}"?`)) && completeMission(m)}
        >
          <Icon name="check" />
        </button>
        <div className="grow">
          <div className="item-title">{m.data.title}</div>
          <div className="row wrap" style={{ gap: 4, marginTop: 3 }}>
            <SizeBadge size={m.data.size} />
            <AttrBadge attr={m.data.attribute} />
            {quest && <Badge tone="gold">{quest.data.code}</Badge>}
            {m.data.recovery && <Badge tone="teal">Recuperación</Badge>}
            {m.data.date && <Badge tone="blue">{fmtDate(m.data.date, true)}</Badge>}
            {repeatable && c && <Badge>{c.count}× · última {fmtDate(c.lastDate)}</Badge>}
            {!repeatable && c && <Badge tone="green">{fmtDate(c.firstDate, true)}</Badge>}
          </div>
          {m.data.notes && <div className="tiny muted" style={{ marginTop: 4 }}>{m.data.notes}</div>}
        </div>
        <div className="row" style={{ gap: 2 }}>
          <button className="btn icon ghost" aria-label="Escribir lección" title="Fallé: escribir lección" onClick={() => setLessonFor(m)}>
            <Icon name="feather" />
          </button>
          <button className="btn icon ghost" aria-label="Editar" onClick={() => setEdit(m)}>
            <Icon name="edit" />
          </button>
          <button
            className="btn icon ghost danger"
            aria-label="Borrar"
            onClick={() => confirmAction(`¿Borrar "${m.data.title}"? La XP que ya ganaste se conserva.`) && deleteEntity(m.id)}
          >
            <Icon name="trash" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      {groups.map((g) => (
        <div key={g.c ?? 'all'} className="card">
          {g.c && <h3 style={{ textTransform: 'capitalize' }}>{g.c}</h3>}
          {g.items.length ? g.items.map(row) : <Empty>Nada pendiente aquí.</Empty>}
        </div>
      ))}
      {done.length > 0 && (
        <div className="card flat">
          <button className="btn sm ghost" onClick={() => setShowDone((x) => !x)}>
            {showDone ? 'Ocultar' : 'Ver'} completadas ({done.length})
          </button>
          {showDone && done.map(row)}
        </div>
      )}
      {edit && <MissionForm open kind={kind} initial={edit} onClose={() => setEdit(null)} />}
      {lessonFor && <LessonForm open mission={lessonFor} onClose={() => setLessonFor(null)} />}
    </>
  );
}
