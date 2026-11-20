import { useState } from 'react';
import { GAME_CONFIG, addDays, diffDays, weekStart, type Entity, type MainQuestData, type SeasonData } from '@igv/core';
import { addEvent, saveEntity, deleteEntity, useGame } from '../data/store';
import { fmtDate, newId, todayLocal } from '../lib/time';
import { Badge, Bar, Empty, Field, PageHeader, Sheet, Tabs, confirmAction, TextArea, TextInput } from '../ui/kit';
import { Icon } from '../ui/icons';

export default function Temporadas() {
  const [tab, setTab] = useState<'season' | 'story'>('season');
  return (
    <>
      <PageHeader title="Temporadas" eyebrow="Temporadas e historia" />
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'season', label: 'Temporadas' },
          { value: 'story', label: 'Mi historia' },
        ]}
      />
      {tab === 'season' ? <Seasons /> : <Story />}
    </>
  );
}

function Seasons() {
  const { list, state, byId } = useGame();
  const seasons = list<SeasonData>('seasons', 'season').sort((a, b) => (a.data.startDate < b.data.startDate ? -1 : 1));
  const [edit, setEdit] = useState<Entity<SeasonData> | null>(null);
  const [creating, setCreating] = useState(false);
  const [review, setReview] = useState<{ season: Entity<SeasonData>; phase: 'start' | 'end' } | null>(null);
  const upcoming = seasons.filter((s) => s.data.startDate > state.today);
  const past = seasons.filter((s) => s.data.endDate < state.today).reverse();
  const current = state.seasons.current;

  const seasonCard = (s: Entity<SeasonData>) => {
    const rv = state.seasons.reviews[s.id] ?? {};
    const isCurrent = current?.id === s.id;
    const totalDays = diffDays(s.data.startDate, s.data.endDate) + 1;
    const elapsed = Math.max(0, Math.min(totalDays, diffDays(s.data.startDate, state.today) + 1));
    const focus = s.data.focusMainQuestId ? (byId.get(s.data.focusMainQuestId) as Entity<MainQuestData> | undefined) : undefined;
    const started = s.data.startDate <= state.today;
    return (
      <div key={s.id} className={`card ${isCurrent ? 'hero' : ''}`}>
        <div className="card-head" style={{ alignItems: 'flex-start' }}>
          <div className="grow">
            <div className="row wrap" style={{ gap: 6 }}>
              <Badge tone="blue">Temporada {s.data.number}</Badge>
              {isCurrent && <Badge tone="gold">Semana {state.seasons.currentWeek} de {Math.ceil(totalDays / 7)}</Badge>}
              {rv.end && <Badge tone="green">Completada</Badge>}
            </div>
            <h2 style={{ marginTop: 6 }}>{s.data.name}</h2>
            <div className="small muted">
              {fmtDate(s.data.startDate, true)} – {fmtDate(s.data.endDate, true)}
              {focus && ` · En foco: ${focus.data.code} ${focus.data.title}`}
            </div>
          </div>
          <button className="btn icon ghost" aria-label="Editar" onClick={() => setEdit(s)}>
            <Icon name="edit" />
          </button>
        </div>
        {started && <Bar value={elapsed} max={totalDays} tone="blue" size="sm" label={<span>{Math.round((elapsed / totalDays) * 100)}% de la temporada</span>} />}
        <div className="grid2" style={{ marginTop: 10 }}>
          <ReviewBox label="Revisión de inicio" review={rv.start} onWrite={() => setReview({ season: s, phase: 'start' })} />
          <ReviewBox label="Revisión de fin" review={rv.end} onWrite={() => setReview({ season: s, phase: 'end' })} disabled={!started} />
        </div>
      </div>
    );
  };

  return (
    <>
      {current ? seasonCard(current) : <div className="card muted small">No hay temporada activa hoy.</div>}
      {current && <Journal season={current} />}
      {upcoming.length > 0 && <div className="section-title">Próximas</div>}
      {upcoming.map(seasonCard)}
      <button className="btn block" style={{ marginBottom: 12 }} onClick={() => setCreating(true)}>
        <Icon name="plus" /> Nueva temporada
      </button>
      {past.length > 0 && <div className="section-title">Anteriores</div>}
      {past.map(seasonCard)}
      {(edit || creating) && <SeasonForm initial={edit ?? undefined} seasons={seasons} onClose={() => (setEdit(null), setCreating(false))} />}
      {review && <ReviewSheet {...review} onClose={() => setReview(null)} />}
    </>
  );
}

function ReviewBox({ label, review, onWrite, disabled }: { label: string; review?: { text: string; date: string }; onWrite: () => void; disabled?: boolean }) {
  return (
    <div className="card flat" style={{ marginBottom: 0, padding: 10 }}>
      <div className="slot-label">{label}</div>
      {review ? (
        <>
          <div className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 4, maxHeight: 120, overflow: 'auto' }}>
            {review.text}
          </div>
          <button className="btn sm ghost" style={{ paddingLeft: 0 }} onClick={onWrite}>
            Editar
          </button>
        </>
      ) : (
        <button className="btn sm" style={{ marginTop: 6 }} onClick={onWrite} disabled={disabled}>
          Escribir
        </button>
      )}
    </div>
  );
}

function ReviewSheet({ season, phase, onClose }: { season: Entity<SeasonData>; phase: 'start' | 'end'; onClose: () => void }) {
  const { state } = useGame();
  const prev = state.seasons.reviews[season.id]?.[phase];
  const [text, setText] = useState(
    prev?.text ??
      (phase === 'start'
        ? '¿Qué quiero lograr en esta temporada?\n\n¿Qué misión está en foco y por qué?\n\n¿Qué gran reto quiero superar?'
        : '¿Qué logré?\n\n¿Qué no logré y por qué?\n\n¿Qué me llevo a la siguiente temporada?'),
  );
  return (
    <Sheet
      open
      onClose={onClose}
      title={phase === 'start' ? 'Revisión de inicio' : 'Revisión de fin'}
      actions={
        <button
          className="btn primary"
          disabled={!text.trim()}
          onClick={() => {
            if (phase === 'end' && !prev && !confirmAction('¿Cerrar la temporada con esta revisión? Desbloquea el logro "Temporada completa".')) return;
            addEvent('season.review', { seasonId: season.id, phase, text: text.trim() });
            onClose();
          }}
        >
          Guardar
        </button>
      }
    >
      <TextArea className="input" rows={12} value={text} onChange={(e) => setText(e.target.value)} />
    </Sheet>
  );
}

function SeasonForm({ initial, seasons, onClose }: { initial?: Entity<SeasonData>; seasons: Entity<SeasonData>[]; onClose: () => void }) {
  const { list } = useGame();
  const quests = list<MainQuestData>('missions', 'main');
  const last = seasons.at(-1);
  const defStart = last ? addDays(last.data.endDate, 1) : weekStart(addDays(todayLocal(), 7));
  const [d, setD] = useState<SeasonData>(
    initial?.data ?? {
      number: (last?.data.number ?? 0) + 1,
      name: '',
      startDate: defStart,
      endDate: addDays(defStart, GAME_CONFIG.season.weeks * 7 - 1),
      focusMainQuestId: null,
    },
  );
  const up = (p: Partial<SeasonData>) => setD((x) => ({ ...x, ...p }));
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Editar temporada' : 'Nueva temporada'}
      actions={
        <>
          {initial && (
            <button className="btn ghost danger" onClick={() => confirmAction('¿Borrar esta temporada? Su diario se conserva.') && (deleteEntity(initial.id), onClose())}>
              Borrar
            </button>
          )}
          <button
            className="btn primary"
            disabled={!d.name.trim() || d.endDate < d.startDate}
            onClick={() => {
              saveEntity({ id: initial?.id ?? `season-${newId().slice(0, 8)}`, module: 'seasons', kind: 'season', data: d });
              onClose();
            }}
          >
            Guardar
          </button>
        </>
      }
    >
      <div className="grid2">
        <Field label="Número">
          <input className="input" type="number" value={d.number} onChange={(e) => up({ number: Number(e.target.value) })} />
        </Field>
        <Field label="Nombre">
          <TextInput className="input" value={d.name} onChange={(e) => up({ name: e.target.value })} />
        </Field>
        <Field label="Inicio">
          <input className="input" type="date" value={d.startDate} onChange={(e) => up({ startDate: e.target.value, endDate: addDays(e.target.value, GAME_CONFIG.season.weeks * 7 - 1) })} />
        </Field>
        <Field label="Fin">
          <input className="input" type="date" value={d.endDate} onChange={(e) => up({ endDate: e.target.value })} />
        </Field>
      </div>
      <Field label="Misión en foco">
        <select className="input" value={d.focusMainQuestId ?? ''} onChange={(e) => up({ focusMainQuestId: e.target.value || null })}>
          <option value="">— Ninguna —</option>
          {quests.map((q) => (
            <option key={q.id} value={q.id}>
              {q.data.code} {q.data.title}
            </option>
          ))}
        </select>
      </Field>
      <p className="tiny muted">Por defecto las temporadas duran {GAME_CONFIG.season.weeks} semanas.</p>
    </Sheet>
  );
}

function Journal({ season }: { season: Entity<SeasonData> }) {
  const { state } = useGame();
  const [editing, setEditing] = useState<string | null>(null);
  const weeks: string[] = [];
  for (let w = weekStart(season.data.startDate); w <= season.data.endDate && w <= state.today; w = addDays(w, 7)) weeks.push(w);
  const thisWeek = weekStart(state.today);
  return (
    <div className="card">
      <div className="card-head">
        <h2>Diario semanal</h2>
        <span className="tiny muted">Qué pasó · qué aprendí · qué sigue</span>
      </div>
      {weeks.length === 0 && <Empty>La temporada aún no empieza.</Empty>}
      {[...weeks].reverse().map((w, i) => {
        const j = state.seasons.journal[w];
        const n = weeks.length - i;
        return (
          <div key={w} className="item" style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <div className="slot-label">
                Semana {n} · {fmtDate(w)} {w === thisWeek && <span className="gold">· esta semana</span>}
              </div>
              {j ? (
                <div className="small" style={{ marginTop: 4 }}>
                  <div>
                    <b>Pasó:</b> {j.happened}
                  </div>
                  <div>
                    <b>Aprendí:</b> {j.learned}
                  </div>
                  <div>
                    <b>Sigue:</b> {j.next}
                  </div>
                </div>
              ) : (
                <div className="tiny faint">Sin entrada</div>
              )}
            </div>
            <button className="btn sm ghost" onClick={() => setEditing(w)}>
              {j ? 'Editar' : 'Escribir'}
            </button>
          </div>
        );
      })}
      {editing && <JournalSheet weekStart={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function JournalSheet({ weekStart: ws, onClose }: { weekStart: string; onClose: () => void }) {
  const { state } = useGame();
  const prev = state.seasons.journal[ws];
  const [happened, setH] = useState(prev?.happened ?? '');
  const [learned, setL] = useState(prev?.learned ?? '');
  const [next, setN] = useState(prev?.next ?? '');
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Semana del ${fmtDate(ws, true)}`}
      actions={
        <button
          className="btn primary"
          disabled={!happened.trim() && !learned.trim() && !next.trim()}
          onClick={() => {
            addEvent('journal.weekly', { weekStart: ws, happened: happened.trim(), learned: learned.trim(), next: next.trim() });
            onClose();
          }}
        >
          Guardar
        </button>
      }
    >
      <Field label="Qué pasó">
        <TextInput className="input" value={happened} onChange={(e) => setH(e.target.value)} />
      </Field>
      <Field label="Qué aprendí">
        <TextInput className="input" value={learned} onChange={(e) => setL(e.target.value)} />
      </Field>
      <Field label="Qué sigue">
        <TextInput className="input" value={next} onChange={(e) => setN(e.target.value)} />
      </Field>
    </Sheet>
  );
}

function Story() {
  const { state, list } = useGame();
  const seasons = list<SeasonData>('seasons', 'season');
  const entries = Object.values(state.seasons.journal).sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
  if (!entries.length) return <Empty>Tu historia empieza con tu primer diario semanal.</Empty>;
  return (
    <>
      {entries.map((j) => {
        const s = seasons.find((x) => x.data.startDate <= j.weekStart && j.weekStart <= x.data.endDate);
        return (
          <div key={j.weekStart} className="card">
            <div className="slot-label">
              {s ? `T${s.data.number} · ` : ''}Semana del {fmtDate(j.weekStart, true)}
            </div>
            <div style={{ marginTop: 6 }}>{j.happened}</div>
            <div className="small muted" style={{ marginTop: 4 }}>
              Aprendí: {j.learned}
            </div>
            <div className="small muted">Sigue: {j.next}</div>
          </div>
        );
      })}
    </>
  );
}
