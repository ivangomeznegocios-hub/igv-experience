import { useMemo, useState } from 'react';
import { ATTRIBUTE_NAMES, BOOK_TYPES, GAME_CONFIG, bookPercent, diffDays, type BookData, type BookStatus, type Entity, type SkillData } from '@igv/core';
import { addEvent, deleteEntity, restoreEvent, saveEntity, useGame, voidEvent } from '../data/store';
import { daysAgo, fmtDate, newId } from '../lib/time';
import { AttrChips, Badge, Chips, Empty, Field, PageHeader, Sheet, SizeChips, Tabs, confirmAction, undoToast } from '../ui/kit';
import { Icon } from '../ui/icons';
import { HBar, HubNav, Stars } from '../ui/habilidades/shared';
import '../styles/habilidades.css';

type Tab = 'leyendo' | 'pendiente' | 'terminado' | 'aprendido';
type Open = { kind: 'detail' | 'edit' | 'finish' | 'progress' | 'note'; id: string } | { kind: 'new' } | null;
const TYPE_LABEL: Record<string, string> = { libro: 'Libro', curso: 'Curso', audiolibro: 'Audiolibro' };

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/**
 * Biblioteca: leyendo ahora (con avance), pendientes, terminados por año y "lo que has aprendido".
 * Terminar un libro da la XP de una misión de su tamaño (una vez); el avance y las notas no dan XP.
 */
export default function Biblioteca() {
  const { state, list } = useGame();
  const [tab, setTab] = useState<Tab>('leyendo');
  const [open, setOpen] = useState<Open>(null);
  const books = list<BookData>('library', 'book');
  const fin = state.library.finished;
  const reading = books.filter((b) => !fin[b.id] && b.data.status === 'leyendo');
  const pending = books.filter((b) => !fin[b.id] && b.data.status === 'pendiente');
  const finished = books.filter((b) => !!fin[b.id]).sort((a, b) => (fin[a.id].date < fin[b.id].date ? 1 : -1));
  const learnedCount = state.library.notes.length + Object.values(fin).filter((f) => f.note?.trim()).length;
  const year = state.today.slice(0, 4);
  const current = open && open.kind !== 'new' ? books.find((b) => b.id === open.id) : undefined;
  const back = () => setOpen(current ? { kind: 'detail', id: current.id } : null);

  const byYear = new Map<string, Entity<BookData>[]>();
  for (const b of finished) {
    const y = fin[b.id].date.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(b);
  }

  return (
    <>
      <PageHeader
        title="Biblioteca"
        eyebrow={`${state.library.byYear[year] ?? 0} ${(state.library.byYear[year] ?? 0) === 1 ? 'terminado' : 'terminados'} en ${year}`}
        right={
          <button className="btn sm primary" onClick={() => setOpen({ kind: 'new' })}>
            <Icon name="plus" /> Agregar
          </button>
        }
      />
      <HubNav />
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'leyendo', label: `Leyendo (${reading.length})` },
          { value: 'pendiente', label: `Pendientes (${pending.length})` },
          { value: 'terminado', label: `Terminados (${finished.length})` },
          { value: 'aprendido', label: `Lo aprendido (${learnedCount})` },
        ]}
      />

      {tab === 'leyendo' && (
        <>
          {!reading.length && (
            <div className="card">
              <Empty>No estás leyendo nada ahora. {pending.length ? 'Empieza algo de pendientes.' : 'Agrega un libro o curso.'}</Empty>
            </div>
          )}
          {reading.map((b) => (
            <ReadingCard key={b.id} book={b} onOpen={(kind) => setOpen({ kind, id: b.id })} />
          ))}
        </>
      )}

      {tab === 'pendiente' && (
        <div className="card">
          {!pending.length && <Empty>Agrega libros y cursos que quieras hacer.</Empty>}
          {pending.map((b) => (
            <div key={b.id} className="item">
              <Icon name="book" width={22} className="faint" />
              <button className="grow hab-plain" onClick={() => setOpen({ kind: 'detail', id: b.id })}>
                <div className="item-title">{b.data.title}</div>
                <div className="tiny muted">{[b.data.author, TYPE_LABEL[b.data.bookType], b.data.pages ? `${b.data.pages} págs.` : ''].filter(Boolean).join(' · ')}</div>
              </button>
              <button className="btn sm" onClick={() => saveEntity({ ...b, data: { ...b.data, status: 'leyendo' } })}>
                Empezar
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === 'terminado' && (
        <>
          {!finished.length && (
            <div className="card">
              <Empty>Aún no terminas ninguno. Cada uno da la XP de su tamaño.</Empty>
            </div>
          )}
          {[...byYear.entries()].map(([y, items]) => (
            <section key={y}>
              <div className="section-title">
                {y} · {items.length} {items.length === 1 ? 'terminado' : 'terminados'}
              </div>
              <div className="card">
                {items.map((b) => {
                  const f = fin[b.id];
                  const notes = state.library.notesByBook[b.id] ?? 0;
                  return (
                    <button key={b.id} className="item hab-plain" style={{ width: '100%' }} onClick={() => setOpen({ kind: 'detail', id: b.id })}>
                      <Icon name="book" width={22} className="gold" />
                      <div className="grow">
                        <div className="item-title">{b.data.title}</div>
                        <div className="row wrap" style={{ gap: 6, marginTop: 2 }}>
                          <span className="tiny muted">{fmtDate(f.date)}</span>
                          {b.data.rating ? <Stars value={b.data.rating} size={13} /> : null}
                          {notes > 0 && <span className="tiny muted">{notes} {notes === 1 ? 'nota' : 'notas'}</span>}
                        </div>
                        {f.note && <div className="tiny muted hab-quote">“{f.note}”</div>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      )}

      {tab === 'aprendido' && <Learned onOpen={(id) => setOpen({ kind: 'detail', id })} />}

      {open?.kind === 'detail' && current && <BookDetail book={current} onClose={() => setOpen(null)} go={(kind) => setOpen({ kind, id: current.id })} />}
      {(open?.kind === 'new' || (open?.kind === 'edit' && current)) && <BookSheet initial={open.kind === 'edit' ? (current ?? null) : null} onClose={back} onDeleted={() => setOpen(null)} />}
      {open?.kind === 'finish' && current && <FinishSheet book={current} onClose={() => setOpen(null)} />}
      {open?.kind === 'progress' && current && <ProgressSheet book={current} onClose={() => setOpen(null)} />}
      {open?.kind === 'note' && current && <NoteSheet book={current} onClose={() => setOpen(null)} />}
    </>
  );
}

function ReadingCard({ book, onOpen }: { book: Entity<BookData>; onOpen: (kind: 'detail' | 'finish' | 'progress' | 'note') => void }) {
  const { state, byId } = useGame();
  const pr = state.library.progress[book.id];
  const pct = pr?.percent ?? null;
  const last = state.library.notes.find((n) => n.bookId === book.id);
  const skill = book.data.skillId ? (byId.get(book.data.skillId)?.data as SkillData | undefined) : undefined;
  return (
    <div className="card hab-book">
      <button className="hab-plain row" style={{ gap: 10, alignItems: 'flex-start', width: '100%' }} onClick={() => onOpen('detail')}>
        <Icon name="book" width={22} className="gold" />
        <span className="grow">
          <span className="item-title" style={{ display: 'block' }}>
            {book.data.title}
          </span>
          <span className="tiny muted">{[book.data.author, TYPE_LABEL[book.data.bookType], skill?.name].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="hab-n small" style={{ fontWeight: 750 }}>
          {pct !== null ? `${pct}%` : ''}
        </span>
      </button>
      <div style={{ margin: '10px 0 4px' }}>
        <HBar value={pct ?? 0} max={100} color="var(--gold)" />
      </div>
      <div className="tiny muted">
        {pr
          ? [pr.page !== null ? `Página ${pr.page}${book.data.pages ? ` de ${book.data.pages}` : ''}` : '', `actualizado ${daysAgo(diffDays(pr.date, state.today))}`].filter(Boolean).join(' · ')
          : 'Sin avance registrado'}
      </div>
      {last && <div className="small hab-quote">“{last.text}”</div>}
      <div className="row" style={{ gap: 6, marginTop: 10 }}>
        <button className="btn sm grow" onClick={() => onOpen('progress')}>
          <Icon name="step" /> Avance
        </button>
        <button className="btn sm grow" onClick={() => onOpen('note')}>
          <Icon name="feather" /> Anotar
        </button>
        <button className="btn sm primary grow" onClick={() => onOpen('finish')}>
          <Icon name="check" /> Terminé
        </button>
      </div>
    </div>
  );
}

/** "Lo que has aprendido": todas las notas y las ideas principales de los libros, con búsqueda. */
function Learned({ onOpen }: { onOpen: (bookId: string) => void }) {
  const { state, byId } = useGame();
  const [q, setQ] = useState('');
  const items = useMemo(() => {
    const out = state.library.notes.map((n) => ({ key: n.eventId, bookId: n.bookId, title: n.title, text: n.text, date: n.date, page: n.page, main: false }));
    for (const [bookId, f] of Object.entries(state.library.finished)) {
      if (!f.note?.trim()) continue;
      const title = (byId.get(bookId)?.data as BookData | undefined)?.title ?? 'Libro';
      out.push({ key: f.eventId, bookId, title, text: f.note, date: f.date, page: null, main: true });
    }
    return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [state.library.notes, state.library.finished, byId]);
  const nq = norm(q.trim());
  const shown = nq ? items.filter((x) => norm(`${x.text} ${x.title}`).includes(nq)) : items;
  if (!items.length)
    return (
      <div className="card">
        <Empty>Cuando leas, anota lo que aprendes («Anotar» en cada libro). Aquí se junta todo tu conocimiento.</Empty>
      </div>
    );
  return (
    <>
      <input className="input" style={{ marginBottom: 12 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar en ${items.length} ideas…`} aria-label="Buscar en lo aprendido" />
      {!shown.length && <Empty>Nada con «{q}».</Empty>}
      {shown.map((x) => (
        <div key={x.key} className="card hab-note">
          <p>{x.text}</p>
          <button className="hab-plain tiny muted" onClick={() => byId.has(x.bookId) && onOpen(x.bookId)}>
            — {x.title} · {fmtDate(x.date, true)}
            {x.page !== null ? ` · p. ${x.page}` : ''}
            {x.main ? ' · idea principal' : ''}
          </button>
        </div>
      ))}
    </>
  );
}

function BookDetail({ book, onClose, go }: { book: Entity<BookData>; onClose: () => void; go: (kind: 'edit' | 'finish' | 'progress' | 'note') => void }) {
  const { state, list } = useGame();
  const f = state.library.finished[book.id];
  const pr = state.library.progress[book.id];
  const notes = state.library.notes.filter((n) => n.bookId === book.id);
  const skills = list<SkillData>('skills', 'skill');
  const set = (patch: Partial<BookData>) => saveEntity({ ...book, data: { ...book.data, ...patch } });
  return (
    <Sheet
      open
      onClose={onClose}
      title={book.data.title}
      actions={
        <>
          <button className="btn ghost" onClick={() => go('edit')}>
            <Icon name="edit" /> Editar
          </button>
          <button className="btn primary" onClick={() => go('note')}>
            <Icon name="feather" /> Anotar
          </button>
        </>
      }
    >
      <div className="row wrap" style={{ gap: 6 }}>
        {book.data.author && <span className="small muted">{book.data.author}</span>}
        <Badge>{TYPE_LABEL[book.data.bookType]}</Badge>
        <Badge>{ATTRIBUTE_NAMES[book.data.attribute]}</Badge>
        {f ? <Badge tone="green">Terminado {fmtDate(f.date, true)}</Badge> : <Badge>{book.data.status === 'leyendo' ? 'Leyendo' : 'Pendiente'}</Badge>}
      </div>
      {!f && (
        <div style={{ marginTop: 12 }}>
          <HBar value={pr?.percent ?? 0} max={100} color="var(--gold)" />
          <div className="row between tiny muted" style={{ marginTop: 4 }}>
            <span>{pr ? `${pr.percent !== null ? `${pr.percent}%` : `Página ${pr.page}`} · desde ${fmtDate(pr.startedOn)}` : 'Sin avance'}</span>
            <button className="linklike" onClick={() => go('progress')}>
              Actualizar
            </button>
          </div>
        </div>
      )}
      <div className="row between" style={{ marginTop: 14 }}>
        <span className="small">Calificación</span>
        <Stars value={book.data.rating} onChange={(rating) => set({ rating })} />
      </div>
      {skills.length > 0 && (
        <Field label="Aporta a la habilidad">
          <select className="input" value={book.data.skillId ?? ''} onChange={(e) => set({ skillId: e.target.value || null })}>
            <option value="">— Ninguna —</option>
            {skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.data.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {f?.note && (
        <>
          <div className="slot-label">La idea que me llevo</div>
          <p className="small hab-quote" style={{ marginTop: 4 }}>
            “{f.note}”
          </p>
        </>
      )}
      <div className="slot-label" style={{ marginTop: 10 }}>
        Lo que aprendí ({notes.length})
      </div>
      {!notes.length && <p className="tiny muted">Sin notas todavía.</p>}
      {notes.map((n) => (
        <div key={n.eventId} className="item" style={{ alignItems: 'flex-start' }}>
          <div className="grow">
            <div className="small">{n.text}</div>
            <div className="tiny muted">
              {fmtDate(n.date, true)}
              {n.page !== null ? ` · p. ${n.page}` : ''}
            </div>
          </div>
          <button
            className="btn icon ghost"
            aria-label="Quitar nota"
            onClick={() => {
              voidEvent(n.eventId);
              undoToast('Nota quitada', () => restoreEvent(n.eventId));
            }}
          >
            <Icon name="x" />
          </button>
        </div>
      ))}
      {!f && (
        <button className="btn block" style={{ marginTop: 12 }} onClick={() => go('finish')}>
          <Icon name="check" /> Lo terminé · +{GAME_CONFIG.missionXp[book.data.size]} XP
        </button>
      )}
    </Sheet>
  );
}

function ProgressSheet({ book, onClose }: { book: Entity<BookData>; onClose: () => void }) {
  const { state } = useGame();
  const last = state.library.progress[book.id];
  const [mode, setMode] = useState<'page' | 'percent'>(last && last.page === null && last.percent !== null ? 'percent' : 'page');
  const [page, setPage] = useState(last?.page !== null && last?.page !== undefined ? String(last.page) : '');
  const [pages, setPages] = useState(book.data.pages ? String(book.data.pages) : '');
  const [percent, setPercent] = useState(last?.percent !== null && last?.percent !== undefined ? String(last.percent) : '');
  const pageN = Number(page);
  const pagesN = Number(pages);
  const pctN = Number(percent);
  const pageOk = page !== '' && Number.isInteger(pageN) && pageN >= 0 && (!pagesN || pageN <= pagesN);
  const pagesOk = pages === '' || (Number.isInteger(pagesN) && pagesN >= 1);
  const pctOk = percent !== '' && pctN >= 0 && pctN <= 100;
  const valid = mode === 'page' ? pageOk && pagesOk : pctOk;
  const preview = mode === 'page' ? bookPercent({ page: pageOk ? pageN : null }, pagesN || null) : pctOk ? Math.round(pctN) : null;
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Avance · ${book.data.title}`}
      actions={
        <button
          className="btn primary"
          disabled={!valid}
          onClick={() => {
            const newPages = pagesN || null;
            const patch: Partial<BookData> = {};
            if (mode === 'page' && newPages !== (book.data.pages ?? null)) patch.pages = newPages;
            if (book.data.status === 'pendiente') patch.status = 'leyendo';
            if (Object.keys(patch).length) saveEntity({ ...book, data: { ...book.data, ...patch } });
            const ev = addEvent('library.progress', mode === 'page' ? { bookId: book.id, page: pageN } : { bookId: book.id, percent: pctN });
            undoToast(`Avance guardado${preview !== null ? `: ${preview}%` : ''}`, () => voidEvent(ev.id));
            onClose();
          }}
        >
          Guardar
        </button>
      }
    >
      <Tabs
        value={mode}
        onChange={setMode}
        options={[
          { value: 'page', label: 'Por página' },
          { value: 'percent', label: 'Por porcentaje' },
        ]}
      />
      {mode === 'page' ? (
        <div className="grid2" style={{ gap: 10 }}>
          <Field label="Voy en la página">
            <input className="input" type="number" inputMode="numeric" min={0} value={page} onChange={(e) => setPage(e.target.value)} autoFocus />
          </Field>
          <Field label="De (total)">
            <input className="input" type="number" inputMode="numeric" min={1} value={pages} onChange={(e) => setPages(e.target.value)} placeholder="opcional" />
          </Field>
        </div>
      ) : (
        <>
          <Chips value={pctOk ? pctN : null} onChange={(n) => setPercent(String(n))} options={[10, 25, 50, 75, 90].map((n) => ({ value: n, label: `${n}%` }))} />
          <Field label="Porcentaje">
            <input className="input" type="number" inputMode="numeric" min={0} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} style={{ marginTop: 8 }} />
          </Field>
        </>
      )}
      {mode === 'page' && pageN > pagesN && pagesN > 0 && <p className="tiny red">La página no puede pasar del total.</p>}
      <p className="tiny muted" style={{ marginBottom: 0 }}>
        {preview !== null ? `Quedaría en ${preview}%. ` : ''}El avance no da XP; terminarlo sí.
      </p>
    </Sheet>
  );
}

function NoteSheet({ book, onClose }: { book: Entity<BookData>; onClose: () => void }) {
  const [text, setText] = useState('');
  const [page, setPage] = useState('');
  const t = text.trim();
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Lo que aprendí · ${book.data.title}`}
      actions={
        <button
          className="btn primary"
          disabled={t.length < 2}
          onClick={() => {
            const p = Number(page);
            const ev = addEvent('library.note', { bookId: book.id, title: book.data.title, text: t, page: page && Number.isInteger(p) && p >= 0 ? p : undefined });
            undoToast('Nota guardada', () => voidEvent(ev.id));
            onClose();
          }}
        >
          Guardar
        </button>
      }
    >
      <Field label="Una idea, en tus palabras">
        <textarea className="input" rows={5} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} placeholder="Lo que me sirve, lo que voy a aplicar…" autoFocus />
      </Field>
      <Field label="Página (opcional)">
        <input className="input" type="number" inputMode="numeric" min={0} value={page} onChange={(e) => setPage(e.target.value)} />
      </Field>
      <p className="tiny muted" style={{ marginBottom: 0 }}>
        Se junta en «Lo aprendido». Las notas no dan XP.
      </p>
    </Sheet>
  );
}

function FinishSheet({ book, onClose }: { book: Entity<BookData>; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [rating, setRating] = useState<number | null>(book.data.rating ?? null);
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Terminé: ${book.data.title}`}
      actions={
        <button
          className="btn primary"
          onClick={() => {
            const prev = book.data.rating ?? null;
            if (rating !== prev) saveEntity({ ...book, data: { ...book.data, rating } });
            const ev = addEvent('library.finished', { bookId: book.id, title: book.data.title, size: book.data.size, attribute: book.data.attribute, note: note.trim() || undefined });
            undoToast(`${book.data.title} terminado`, () => {
              voidEvent(ev.id);
              if (rating !== prev) saveEntity({ ...book, data: { ...book.data, rating: prev } });
            });
            onClose();
          }}
        >
          Registrar · +{GAME_CONFIG.missionXp[book.data.size]} XP
        </button>
      }
    >
      <div className="row between" style={{ marginBottom: 12 }}>
        <span className="small">¿Qué tal estuvo?</span>
        <Stars value={rating} onChange={setRating} size={22} />
      </div>
      <Field label="La idea que me llevo (opcional)">
        <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Lo más valioso, lo que voy a aplicar…" />
      </Field>
    </Sheet>
  );
}

function BookSheet({ initial, onClose, onDeleted }: { initial: Entity<BookData> | null; onClose: () => void; onDeleted: () => void }) {
  const { state, list } = useGame();
  const skills = list<SkillData>('skills', 'skill');
  const [d, setD] = useState<BookData>(initial?.data ?? { title: '', author: '', bookType: 'libro', status: 'pendiente', attribute: 'inteligencia', size: 'media' });
  const [pages, setPages] = useState(initial?.data.pages ? String(initial.data.pages) : '');
  const finished = initial ? !!state.library.finished[initial.id] : false;
  const notes = initial ? (state.library.notesByBook[initial.id] ?? 0) : 0;
  const pagesN = Number(pages);
  const pagesOk = pages === '' || (Number.isInteger(pagesN) && pagesN >= 1 && pagesN <= 100000);
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Editar' : 'Agregar a la biblioteca'}
      actions={
        <>
          {initial && !finished && (
            <button
              className="btn ghost danger"
              onClick={() => confirmAction(notes ? `¿Borrar? Sus ${notes} notas se quedan en «Lo aprendido».` : '¿Borrar?') && (deleteEntity(initial.id), onDeleted())}
            >
              Borrar
            </button>
          )}
          <button
            className="btn primary"
            disabled={!d.title.trim() || !pagesOk}
            onClick={() => {
              saveEntity({
                id: initial?.id ?? `book-${newId().slice(0, 8)}`,
                module: 'library',
                kind: 'book',
                data: { ...d, title: d.title.trim(), author: d.author?.trim(), pages: pages ? pagesN : null },
              });
              onClose();
            }}
          >
            Guardar
          </button>
        </>
      }
    >
      <Field label="Título">
        <input className="input" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
      </Field>
      <Field label="Autor / plataforma">
        <input className="input" value={d.author ?? ''} onChange={(e) => setD({ ...d, author: e.target.value })} />
      </Field>
      <Field label="Tipo">
        <Chips value={d.bookType} onChange={(bookType) => setD({ ...d, bookType })} options={BOOK_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))} />
      </Field>
      {!finished && (
        <Field label="Estado">
          <Chips<BookStatus>
            value={d.status}
            onChange={(status) => setD({ ...d, status })}
            options={[
              { value: 'pendiente', label: 'Pendiente' },
              { value: 'leyendo', label: 'Leyendo' },
            ]}
          />
        </Field>
      )}
      <Field label={d.bookType === 'curso' ? 'Lecciones o páginas en total (opcional)' : 'Páginas (opcional, para el avance en %)'}>
        <input className="input" type="number" inputMode="numeric" min={1} value={pages} onChange={(e) => setPages(e.target.value)} />
      </Field>
      {skills.length > 0 && (
        <Field label="Aporta a la habilidad (opcional)">
          <select className="input" value={d.skillId ?? ''} onChange={(e) => setD({ ...d, skillId: e.target.value || null })}>
            <option value="">— Ninguna —</option>
            {skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.data.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="XP al terminarlo">
        <SizeChips value={d.size} onChange={(size) => setD({ ...d, size })} />
      </Field>
      <Field label="Atributo">
        <AttrChips value={d.attribute} onChange={(attribute) => setD({ ...d, attribute })} />
      </Field>
    </Sheet>
  );
}
