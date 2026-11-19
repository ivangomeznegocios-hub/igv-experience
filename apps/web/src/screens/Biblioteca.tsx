import { useState } from 'react';
import { ATTRIBUTE_NAMES, BOOK_TYPES, GAME_CONFIG, type BookData, type BookStatus, type Entity } from '@igv/core';
import { addEvent, deleteEntity, saveEntity, useGame, voidEvent } from '../data/store';
import { fmtDate, newId } from '../lib/time';
import { AttrChips, Badge, Chips, Empty, Field, PageHeader, Sheet, SizeChips, Tabs, confirmAction, undoToast } from '../ui/kit';
import { Icon } from '../ui/icons';

type Tab = 'leyendo' | 'pendiente' | 'terminado';
const TYPE_LABEL: Record<string, string> = { libro: 'Libro', curso: 'Curso', audiolibro: 'Audiolibro' };

/** Biblioteca: libros y cursos. Terminar uno da la XP de una misión de su tamaño. */
export default function Biblioteca() {
  const { state, list } = useGame();
  const [tab, setTab] = useState<Tab>('leyendo');
  const [edit, setEdit] = useState<Entity<BookData> | 'new' | null>(null);
  const [finishing, setFinishing] = useState<Entity<BookData> | null>(null);
  const books = list<BookData>('library', 'book');
  const fin = state.library.finished;
  const shown = books.filter((b) => (tab === 'terminado' ? !!fin[b.id] : !fin[b.id] && b.data.status === tab));
  if (tab === 'terminado') shown.sort((a, b) => (fin[a.id].date < fin[b.id].date ? 1 : -1));
  const year = state.today.slice(0, 4);
  return (
    <>
      <PageHeader
        title="Biblioteca"
        eyebrow={`${state.library.byYear[year] ?? 0} terminados en ${year}`}
        right={
          <button className="btn sm primary" onClick={() => setEdit('new')}>
            <Icon name="plus" /> Agregar
          </button>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'leyendo', label: `Leyendo (${books.filter((b) => !fin[b.id] && b.data.status === 'leyendo').length})` },
          { value: 'pendiente', label: `Pendientes (${books.filter((b) => !fin[b.id] && b.data.status === 'pendiente').length})` },
          { value: 'terminado', label: `Terminados (${Object.keys(fin).length})` },
        ]}
      />
      <div className="card">
        {shown.length === 0 && <Empty>{tab === 'leyendo' ? 'No estás leyendo nada ahora. Mueve algo de pendientes.' : tab === 'pendiente' ? 'Agrega libros y cursos que quieras hacer.' : 'Aún no terminas ninguno.'}</Empty>}
        {shown.map((b) => (
          <div key={b.id} className="item">
            <Icon name="book" width={22} className="gold" />
            <div className="grow" style={{ cursor: 'pointer' }} onClick={() => setEdit(b)}>
              <div className="item-title">{b.data.title}</div>
              <div className="row wrap" style={{ gap: 4, marginTop: 3 }}>
                {b.data.author && <span className="tiny muted">{b.data.author}</span>}
                <Badge>{TYPE_LABEL[b.data.bookType]}</Badge>
                <Badge>{ATTRIBUTE_NAMES[b.data.attribute]}</Badge>
                {fin[b.id] && <Badge tone="green">{fmtDate(fin[b.id].date, true)}</Badge>}
              </div>
              {fin[b.id]?.note && <div className="tiny muted" style={{ marginTop: 4 }}>“{fin[b.id].note}”</div>}
            </div>
            {!fin[b.id] &&
              (b.data.status === 'pendiente' ? (
                <button className="btn sm" onClick={() => saveEntity({ ...b, data: { ...b.data, status: 'leyendo' } })}>
                  Empezar
                </button>
              ) : (
                <button className="btn sm primary" onClick={() => setFinishing(b)}>
                  Terminé
                </button>
              ))}
          </div>
        ))}
      </div>
      {edit && <BookSheet initial={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {finishing && <FinishSheet book={finishing} onClose={() => setFinishing(null)} />}
    </>
  );
}

function FinishSheet({ book, onClose }: { book: Entity<BookData>; onClose: () => void }) {
  const [note, setNote] = useState('');
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Terminé: ${book.data.title}`}
      actions={
        <button
          className="btn primary"
          onClick={() => {
            const ev = addEvent('library.finished', { bookId: book.id, title: book.data.title, size: book.data.size, attribute: book.data.attribute, note: note.trim() || undefined });
            undoToast(`📚 ${book.data.title} terminado`, () => voidEvent(ev.id));
            onClose();
          }}
        >
          Registrar · +{GAME_CONFIG.missionXp[book.data.size]} XP
        </button>
      }
    >
      <Field label="La idea que me llevo (opcional)">
        <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Lo más valioso, lo que voy a aplicar…" />
      </Field>
    </Sheet>
  );
}

function BookSheet({ initial, onClose }: { initial: Entity<BookData> | null; onClose: () => void }) {
  const { state } = useGame();
  const [d, setD] = useState<BookData>(initial?.data ?? { title: '', author: '', bookType: 'libro', status: 'pendiente', attribute: 'inteligencia', size: 'media' });
  const finished = initial ? !!state.library.finished[initial.id] : false;
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Editar' : 'Agregar a la biblioteca'}
      actions={
        <>
          {initial && !finished && (
            <button className="btn ghost danger" onClick={() => confirmAction('¿Borrar?') && (deleteEntity(initial.id), onClose())}>
              Borrar
            </button>
          )}
          <button
            className="btn primary"
            disabled={!d.title.trim()}
            onClick={() => {
              saveEntity({ id: initial?.id ?? `book-${newId().slice(0, 8)}`, module: 'library', kind: 'book', data: { ...d, title: d.title.trim(), author: d.author?.trim() } });
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
      <Field label="XP al terminarlo">
        <SizeChips value={d.size} onChange={(size) => setD({ ...d, size })} />
      </Field>
      <Field label="Atributo">
        <AttrChips value={d.attribute} onChange={(attribute) => setD({ ...d, attribute })} />
      </Field>
    </Sheet>
  );
}
