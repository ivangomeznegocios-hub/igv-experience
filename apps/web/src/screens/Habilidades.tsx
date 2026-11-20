import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ATTRIBUTE_NAMES,
  GAME_CONFIG,
  SKILL_CATEGORIES,
  SKILL_CATEGORY_ATTRIBUTE,
  SKILL_CATEGORY_NAMES,
  SKILL_DEFAULT_RANKS,
  SKILL_RANK_NAMES,
  TIME_AREA_NAMES,
  diffDays,
  fmtHoursMinutes,
  groupSkillsByCategory,
  guessSkillCategory,
  skillCategory,
  skillNameEdit,
  topAreas,
  type BookData,
  type Entity,
  type SkillCategory,
  type SkillData,
} from '@igv/core';
import { addEvent, deleteEntity, saveEntity, useGame } from '../data/store';
import { startTimer, useTimer } from '../lib/timeTimer';
import { daysAgo, fmtDate, newId } from '../lib/time';
import { Icon } from '../ui/icons';
import { AttrSelect, Badge, Chips, Empty, Field, PageHeader, Sheet, confirmAction, toast, undoToast } from '../ui/kit';
import { HubNav, areaForSkill } from '../ui/habilidades/shared';
import '../styles/habilidades.css';

type View = { kind: 'detail' | 'edit' | 'unlock'; id: string } | { kind: 'new' } | null;

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Lo que sabes hacer: habilidades por categoría, con rango, tiempo invertido, libros y lo que sabes. */
export default function Habilidades() {
  const { list, state } = useGame();
  const skills = list<SkillData>('skills', 'skill');
  const [view, setView] = useState<View>(null);
  const groups = groupSkillsByCategory(skills);
  const current = view && view.kind !== 'new' ? skills.find((s) => s.id === view.id) : undefined;

  return (
    <>
      <PageHeader
        title="Lo que sabes hacer"
        eyebrow="Habilidades y conocimiento"
        right={
          <button className="btn sm" onClick={() => setView({ kind: 'new' })}>
            <Icon name="plus" /> Nueva
          </button>
        }
      />
      <HubNav />
      <Dedicas skills={skills} />
      <QuickSkill skills={skills} />
      {!skills.length && <Empty>Escribe arriba algo que sabes hacer. Una línea basta.</Empty>}
      {groups.map((g) => (
        <section key={g.category}>
          <div className="section-title">
            {SKILL_CATEGORY_NAMES[g.category]} · {g.items.length}
          </div>
          <div className="card hab-skill-list">
            {g.items.map((s) => (
              <SkillRow key={s.id} skill={s} onOpen={() => setView({ kind: 'detail', id: s.id })} />
            ))}
          </div>
        </section>
      ))}
      {view?.kind === 'detail' && current && (
        <SkillSheet
          skill={current}
          siblings={groups.find((g) => g.category === skillCategory(current.data))?.items ?? []}
          onClose={() => setView(null)}
          onEdit={() => setView({ kind: 'edit', id: current.id })}
          onUnlock={() => setView({ kind: 'unlock', id: current.id })}
        />
      )}
      {(view?.kind === 'new' || (view?.kind === 'edit' && current)) && (
        <SkillForm initial={view.kind === 'edit' ? current : undefined} onClose={() => setView(current ? { kind: 'detail', id: current.id } : null)} onDeleted={() => setView(null)} />
      )}
      {view?.kind === 'unlock' && current && (
        <UnlockSheet skill={current} rank={(state.skills[current.id]?.rank ?? 0) + 1} onClose={() => setView({ kind: 'detail', id: current.id })} />
      )}
    </>
  );
}

/** "A qué te dedicas": de qué vives, en qué se va tu semana y qué estás leyendo. */
function Dedicas({ skills }: { skills: Entity<SkillData>[] }) {
  const { state, list } = useGame();
  const living = skills.filter((s) => s.data.livelihood);
  const week = topAreas(state.time.weekByArea, 3);
  const reading = list<BookData>('library', 'book').filter((b) => !state.library.finished[b.id] && b.data.status === 'leyendo');
  const ranks = skills.reduce((n, s) => n + (state.skills[s.id]?.rank ?? 0), 0);
  const minutes = skills.reduce((n, s) => n + (state.skills[s.id]?.minutes ?? 0), 0);
  const book = reading[0];
  const pct = book ? state.library.progress[book.id]?.percent : null;
  return (
    <div className="card hab-dedicas">
      <div className="eyebrow">A qué te dedicas</div>
      <div className="hab-living">
        {living.length ? (
          living.map((s) => (
            <span key={s.id} className="badge gold">
              {s.data.name}
              {state.skills[s.id]?.rankName ? ` · ${state.skills[s.id]!.rankName}` : ''}
            </span>
          ))
        ) : (
          <span className="small muted">Abre una habilidad y marca «De esto vivo».</span>
        )}
      </div>
      <Link to="/tiempo" className="hab-line">
        <Icon name="clock" />
        <span className="grow">
          {week.length ? (
            <>
              Esta semana: {week.map((w) => `${TIME_AREA_NAMES[w.area]} ${fmtHoursMinutes(w.minutes)}`).join(' · ')}
            </>
          ) : (
            'Tu tiempo: ¿en qué se te va el día?'
          )}
        </span>
        <Icon name="right" />
      </Link>
      <Link to="/biblioteca" className="hab-line">
        <Icon name="book" />
        <span className="grow">
          {book ? (
            <>
              Leyendo: {book.data.title}
              {pct !== null && pct !== undefined ? ` · ${pct}%` : ''}
              {reading.length > 1 ? ` y ${reading.length - 1} más` : ''}
            </>
          ) : (
            'Biblioteca: ¿qué estás leyendo?'
          )}
        </span>
        <Icon name="right" />
      </Link>
      {skills.length > 0 && (
        <div className="hab-kpis">
          <span>
            <b className="hab-n">{skills.length}</b> habilidades
          </span>
          <span>
            <b className="hab-n">{ranks}</b>/{skills.length * 3} rangos
          </span>
          <span>
            <b className="hab-n">{fmtHoursMinutes(minutes)}</b> invertidas
          </span>
        </div>
      )}
    </div>
  );
}

/** Agregar en una línea: "Sé hacer…". La categoría se deduce (y se puede cambiar antes de guardar). */
function QuickSkill({ skills }: { skills: Entity<SkillData>[] }) {
  const [name, setName] = useState('');
  const [cat, setCat] = useState<SkillCategory | null>(null);
  const [picking, setPicking] = useState(false);
  const t = name.trim();
  const category: SkillCategory = cat ?? (t ? guessSkillCategory(t) : 'otro');
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!t) return;
    const clean = t.replace(/^s[eé] hacer\s+/i, '');
    // Se compara con el nombre que se guardaría ("Sé hacer ventas" → "Ventas").
    const twin = skills.find((s) => norm(s.data.name) === norm(clean));
    if (twin) {
      toast(`Ya la tienes: ${twin.data.name}`);
      return;
    }
    const display = clean.charAt(0).toUpperCase() + clean.slice(1);
    const ent = saveEntity<SkillData>({
      id: `skill-${newId().slice(0, 8)}`,
      module: 'skills',
      kind: 'skill',
      data: { name: display, category, attribute: SKILL_CATEGORY_ATTRIBUTE[category], ranks: [...SKILL_DEFAULT_RANKS], livelihood: false },
    });
    undoToast(`Agregada en ${SKILL_CATEGORY_NAMES[category]}`, () => deleteEntity(ent.id));
    setName('');
    setCat(null);
    setPicking(false);
  };
  return (
    <div className="card hab-quick">
      <form className="row" style={{ gap: 8 }} onSubmit={submit}>
        <input className="input grow" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Sé hacer…" aria-label="Algo que sabes hacer" />
        <button className="btn primary" type="submit" disabled={!t}>
          Agregar
        </button>
      </form>
      {t && (
        <div className="tiny muted" style={{ marginTop: 8 }}>
          Va en{' '}
          <button type="button" className="linklike" onClick={() => setPicking((x) => !x)}>
            {SKILL_CATEGORY_NAMES[category]}
          </button>{' '}
          · con rangos genéricos (los cambias cuando quieras).
        </div>
      )}
      {t && picking && (
        <div style={{ marginTop: 8 }}>
          <Chips
            value={category}
            onChange={(c) => (setCat(c), setPicking(false))}
            options={SKILL_CATEGORIES.map((c) => ({ value: c, label: SKILL_CATEGORY_NAMES[c] }))}
          />
        </div>
      )}
    </div>
  );
}

function SkillRow({ skill, onOpen }: { skill: Entity<SkillData>; onOpen: () => void }) {
  const { state, list } = useGame();
  const st = state.skills[skill.id];
  const rank = st?.rank ?? 0;
  const books = list<BookData>('library', 'book').filter((b) => b.data.skillId === skill.id).length;
  const meta = [
    rank ? SKILL_RANK_NAMES[rank - 1] : 'Sin rango',
    st?.minutes ? fmtHoursMinutes(st.minutes) : '',
    st?.lastPractice ? daysAgo(diffDays(st.lastPractice, state.today)) : '',
    books ? `${books} ${books === 1 ? 'libro' : 'libros'}` : '',
  ].filter(Boolean);
  return (
    <button className="hab-skill" onClick={onOpen}>
      <span className="hab-pips" aria-hidden="true">
        {[1, 2, 3].map((r) => (
          <i key={r} className={rank >= r ? 'on' : rank + 1 === r ? 'next' : ''} />
        ))}
      </span>
      <span className="grow">
        <span className="hab-skill-name">
          {skill.data.name}
          {skill.data.livelihood && <span className="badge gold">De esto vivo</span>}
        </span>
        <span className="tiny muted">{meta.join(' · ')}</span>
      </span>
      <Icon name="right" width={16} className="faint" />
    </button>
  );
}

function SkillSheet({
  skill,
  siblings,
  onClose,
  onEdit,
  onUnlock,
}: {
  skill: Entity<SkillData>;
  siblings: Entity<SkillData>[];
  onClose: () => void;
  onEdit: () => void;
  onUnlock: () => void;
}) {
  const { state, list } = useGame();
  const navigate = useNavigate();
  const timer = useTimer();
  const st = state.skills[skill.id];
  const rank = st?.rank ?? 0;
  const category = skillCategory(skill.data);
  const [notes, setNotes] = useState(skill.data.notes ?? '');
  const books = list<BookData>('library', 'book');
  const linked = books.filter((b) => b.data.skillId === skill.id);
  const unlinked = books.filter((b) => b.data.skillId !== skill.id);
  const i = siblings.findIndex((s) => s.id === skill.id);
  const move = (dir: -1 | 1) => {
    const other = siblings[i + dir];
    if (!other) return;
    saveEntity({ ...skill, sort: other.sort });
    saveEntity({ ...other, sort: skill.sort === other.sort ? skill.sort - dir : skill.sort });
  };
  const area = areaForSkill(skill.data, category);
  return (
    <Sheet
      open
      onClose={onClose}
      title={skill.data.name}
      actions={
        <>
          <button className="btn ghost" onClick={onEdit}>
            <Icon name="edit" /> Editar
          </button>
          <button className="btn primary" onClick={() => navigate(`/tiempo?habilidad=${encodeURIComponent(skill.id)}&area=${area}`)}>
            <Icon name="clock" /> Registrar práctica
          </button>
        </>
      }
    >
      <div className="row wrap" style={{ gap: 6 }}>
        <Badge>{SKILL_CATEGORY_NAMES[category]}</Badge>
        <Badge>{ATTRIBUTE_NAMES[skill.data.attribute]}</Badge>
        {skill.data.livelihood && <Badge tone="gold">De esto vivo</Badge>}
      </div>

      {/* Camino visual de 3 nodos conectados */}
      <div className="skill-tree hab-tree" aria-label={`Progreso de ${skill.data.name}`}>
        {[1, 2, 3].map((r) => {
          const done = rank >= r;
          const next = rank + 1 === r;
          return (
            <div key={r} className="skill-node-wrap">
              {r > 1 && <div className={`skill-rail ${done ? 'on' : ''}`} />}
              <button type="button" className={`skill-node ${done ? 'done' : next ? 'next' : ''}`} disabled={!next} onClick={() => next && onUnlock()} title={SKILL_RANK_NAMES[r - 1]}>
                {done ? <Icon name={r === 3 ? 'crown' : 'check'} width={15} height={15} /> : <span>{r}</span>}
                <span className="skill-node-lbl">{SKILL_RANK_NAMES[r - 1]}</span>
              </button>
            </div>
          );
        })}
      </div>
      {skill.data.ranks.map((req, r) => {
        const u = st?.unlocks.find((x) => x.rank === r + 1);
        return (
          <div key={r} className={`item ${u ? 'done' : ''}`} style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <div className="slot-label">{SKILL_RANK_NAMES[r]}</div>
              <div className="small" style={{ fontWeight: 600 }}>
                {req}
              </div>
              {u && (
                <div className="tiny muted" style={{ marginTop: 3 }}>
                  {fmtDate(u.date, true)} · Evidencia: <Evidence text={u.evidence} />
                </div>
              )}
            </div>
            {!u && rank === r && (
              <button className="btn sm primary" onClick={onUnlock}>
                Desbloquear
              </button>
            )}
          </div>
        );
      })}

      <div className="hab-stats">
        <div>
          <span>Tiempo invertido</span>
          <b className="hab-n">{fmtHoursMinutes(st?.minutes ?? 0)}</b>
        </div>
        <div>
          <span>Esta semana</span>
          <b className="hab-n">{fmtHoursMinutes(st?.minutesThisWeek ?? 0)}</b>
        </div>
        <div>
          <span>Sesiones</span>
          <b className="hab-n">{st?.sessions ?? 0}</b>
        </div>
        <div>
          <span>Última práctica</span>
          <b>{st?.lastPractice ? daysAgo(diffDays(st.lastPractice, state.today)) : '—'}</b>
        </div>
      </div>
      {!timer && (
        <button className="btn block sm" style={{ marginBottom: 12 }} onClick={() => (startTimer({ area, skillId: skill.id, note: '' }), navigate('/tiempo'))}>
          <Icon name="play" /> Practicar ahora (cronómetro)
        </button>
      )}

      <Field label="Lo que sé de esto (métodos, recursos, cómo lo aprendí)">
        <textarea className="input" rows={4} value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} placeholder="Ej. Cierro mejor cuando pregunto antes de presentar…" />
      </Field>
      {notes !== (skill.data.notes ?? '') && (
        <button className="btn sm" style={{ marginTop: -6, marginBottom: 12 }} onClick={() => (saveEntity({ ...skill, data: { ...skill.data, notes: notes.trim() || undefined } }), toast('Guardado'))}>
          Guardar lo que sé
        </button>
      )}

      <div className="slot-label" style={{ marginBottom: 4 }}>
        Libros y cursos
      </div>
      {linked.map((b) => {
        const done = state.library.finished[b.id];
        const pct = state.library.progress[b.id]?.percent;
        return (
          <div key={b.id} className="item">
            <Icon name="book" width={18} className="gold" />
            <div className="grow small">
              <b>{b.data.title}</b>
              <div className="tiny muted">{done ? `Terminado ${fmtDate(done.date, true)}` : b.data.status === 'leyendo' ? `Leyendo${pct !== null && pct !== undefined ? ` · ${pct}%` : ''}` : 'Pendiente'}</div>
            </div>
            <button className="btn icon ghost" aria-label="Desligar" onClick={() => saveEntity({ ...b, data: { ...b.data, skillId: null } })}>
              <Icon name="x" />
            </button>
          </div>
        );
      })}
      {unlinked.length > 0 && (
        <select
          className="input"
          value=""
          onChange={(e) => {
            const b = unlinked.find((x) => x.id === e.target.value);
            if (b) saveEntity({ ...b, data: { ...b.data, skillId: skill.id } });
          }}
          aria-label="Ligar un libro"
        >
          <option value="">+ Ligar un libro de tu biblioteca…</option>
          {unlinked.map((b) => (
            <option key={b.id} value={b.id}>
              {b.data.title}
            </option>
          ))}
        </select>
      )}
      {!books.length && (
        <p className="tiny muted">
          <Link to="/biblioteca">Agrega libros o cursos</Link> y lígalos aquí.
        </p>
      )}

      {siblings.length > 1 && (
        <div className="row between" style={{ marginTop: 14 }}>
          <span className="tiny muted">
            Prioridad en {SKILL_CATEGORY_NAMES[category]}: {i + 1} de {siblings.length}
          </span>
          <span className="row" style={{ gap: 2 }}>
            <button className="btn icon ghost" aria-label="Subir prioridad" disabled={i <= 0} onClick={() => move(-1)}>
              <Icon name="up" />
            </button>
            <button className="btn icon ghost" aria-label="Bajar prioridad" disabled={i >= siblings.length - 1} onClick={() => move(1)}>
              <Icon name="down" />
            </button>
          </span>
        </div>
      )}
    </Sheet>
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
  if (rank > 3) return null;
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

function SkillForm({ initial, onClose, onDeleted }: { initial?: Entity<SkillData>; onClose: () => void; onDeleted: () => void }) {
  const [d, setD] = useState<SkillData>(
    initial
      ? { ...initial.data, category: skillCategory(initial.data) }
      : { name: '', attribute: SKILL_CATEGORY_ATTRIBUTE.otro, category: 'otro', ranks: [...SKILL_DEFAULT_RANKS], livelihood: false },
  );
  const [touchedCat, setTouchedCat] = useState(!!initial);
  // El atributo que elijas a mano no se cambia al corregir el nombre.
  const [touchedAttr, setTouchedAttr] = useState(!!initial);
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
            <button className="btn ghost danger" onClick={() => confirmAction('¿Quitar esta habilidad? Se perdería la XP de sus rangos.') && (deleteEntity(initial.id), onDeleted())}>
              Quitar
            </button>
          )}
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() => {
              saveEntity({ id: initial?.id ?? `skill-${newId().slice(0, 8)}`, module: 'skills', kind: 'skill', data: { ...d, name: d.name.trim(), notes: d.notes?.trim() || undefined } });
              onClose();
            }}
          >
            Guardar
          </button>
        </>
      }
    >
      <Field label="Nombre">
        <input
          className="input"
          value={d.name}
          onChange={(e) => up(skillNameEdit(e.target.value, { category: touchedCat, attribute: touchedAttr }))}
        />
      </Field>
      <Field label="Categoría">
        <Chips
          value={d.category ?? 'otro'}
          onChange={(category) => (setTouchedCat(true), up({ category }))}
          options={SKILL_CATEGORIES.map((c) => ({ value: c, label: SKILL_CATEGORY_NAMES[c] }))}
        />
      </Field>
      <Field label="Atributo al que suma (sus rangos)">
        <AttrSelect value={d.attribute} onChange={(attribute) => (setTouchedAttr(true), up({ attribute }))} />
      </Field>
      <label className="checkbox">
        <input type="checkbox" checked={!!d.livelihood} onChange={(e) => up({ livelihood: e.target.checked })} />
        De esto vivo (es parte de a qué me dedico)
      </label>
      {SKILL_RANK_NAMES.map((n, i) => (
        <Field key={n} label={`Requisito para ${n}`}>
          <input className="input" value={d.ranks[i]} onChange={(e) => up({ ranks: d.ranks.map((r, j) => (j === i ? e.target.value : r)) as SkillData['ranks'] })} />
        </Field>
      ))}
      <Field label="Lo que sé de esto (opcional)">
        <textarea className="input" rows={3} value={d.notes ?? ''} maxLength={4000} onChange={(e) => up({ notes: e.target.value })} />
      </Field>
    </Sheet>
  );
}
