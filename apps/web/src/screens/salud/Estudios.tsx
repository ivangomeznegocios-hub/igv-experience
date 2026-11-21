import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  GAME_CONFIG,
  HEALTH_RECORD_TYPES,
  HEALTH_RECORD_TYPE_NAMES,
  HEALTH_SUGGESTIONS,
  suggestionCheckupId,
  type CheckupData,
  type Entity,
  type HealthFileRef,
  type HealthRecordData,
  type HealthRecordEntry,
  type HealthRecordType,
  type HealthRecordValue,
  type MissionSize,
} from '@igv/core';
import { addEvent, getEntity, saveEntity, useGame } from '../../data/store';
import { medicoApi, type ReadResult } from '../../data/medicoApi';
import { activateSuggestion, checkupSizeOf } from '../../lib/health';
import {
  applyReading,
  deleteRecord,
  fileUrl,
  fmtBytes,
  newRecordId,
  prepareFile,
  profileLine,
  readingValues,
  recordExpense,
  saveRecord,
  saveRecordMetrics,
  savableValues,
  uploadFiles,
  type PreparedFile,
} from '../../lib/medico';
import { fmtDate, fmtMoney } from '../../lib/time';
import { Badge, Chips, Empty, Field, Sheet, TextArea, TextInput, confirmAction, toast } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { useMedicoStatus } from './Medico';

/** Estudios: análisis, consultas, recetas e imágenes con sus archivos, costo y lo que leyó tu médico IA. */

const TYPE_ICON: Record<HealthRecordType, string> = {
  laboratorio: 'salud-flask',
  consulta: 'salud-stethoscope',
  imagen: 'salud-skin',
  receta: 'salud-doc',
  vacuna: 'salud-syringe',
  dental: 'salud-tooth',
  otro: 'salud-doc',
};
const TYPE_SHORT: Record<HealthRecordType, string> = { laboratorio: 'Laboratorio', consulta: 'Consulta', imagen: 'Imagen', receta: 'Receta', vacuna: 'Vacuna', dental: 'Dental', otro: 'Otro' };

type View = { type: 'new' } | { type: 'open'; id: string } | { type: 'edit'; id: string } | null;

export function Estudios({ goTab: _goTab }: { goTab: (t: 'medico') => void }) {
  const { state } = useGame();
  const [view, setView] = useState<View>(null);
  const status = useMedicoStatus();
  const h = state.health;
  const currency = state.settings.currency ?? 'MXN';
  const byYear = useMemo(() => {
    const m = new Map<string, HealthRecordEntry[]>();
    for (const r of h.records) {
      const y = r.date?.slice(0, 4) || '—';
      if (!m.has(y)) m.set(y, []);
      m.get(y)!.push(r);
    }
    return [...m];
  }, [h.records]);
  const close = () => setView(null);
  const files = useMemo(() => {
    const all = h.records.flatMap((r) => r.files);
    return { n: all.length, bytes: all.reduce((t, f) => t + (f.size || 0), 0) };
  }, [h.records]);

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>
            <Icon name="salud-doc" width={18} style={{ verticalAlign: -3, marginRight: 6 }} />
            Tus estudios
          </h2>
          <button className="btn sm primary" onClick={() => setView({ type: 'new' })}>
            <Icon name="upload" /> Subir
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          Sube tus análisis, consultas, recetas o estudios (PDF o fotos). Tu médico IA los lee, saca tus valores y los guarda en tus mediciones para ver cómo evolucionas.
        </p>
        <div className="salud-tiles">
          <div className="stat-tile">
            <span>Estudios</span>
            <b>{h.records.length}</b>
            <em>{h.records[0] ? `último ${fmtDate(h.records[0].date)}` : 'ninguno aún'}</em>
          </div>
          <div className="stat-tile">
            <span>Gastado {state.today.slice(0, 4)}</span>
            <b>{fmtMoney(h.spendThisYear, currency)}</b>
            <em>{h.spendTotal > h.spendThisYear ? `${fmtMoney(h.spendTotal, currency)} en total` : 'en salud'}</em>
          </div>
          <div className="stat-tile">
            <span>Archivos</span>
            <b>{files.n}</b>
            <em>{files.n ? fmtBytes(files.bytes) : 'PDF o fotos'}</em>
          </div>
        </div>
      </div>

      {!h.records.length ? (
        <div className="card">
          <Empty>Empieza con tus últimos análisis de sangre: es lo que más le sirve a tu médico IA.</Empty>
          <button className="btn primary block" onClick={() => setView({ type: 'new' })}>
            <Icon name="upload" /> Subir mi primer estudio
          </button>
        </div>
      ) : (
        byYear.map(([year, items]) => (
          <div key={year} className="card">
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              {year}
            </div>
            {items.map((r) => (
              <button key={r.id} className="salud-row tap salud-plain" style={{ width: '100%', textAlign: 'left' }} onClick={() => setView({ type: 'open', id: r.id })}>
                <div className={`salud-ico ${r.flagged ? 'atrasado' : ''}`}>
                  <Icon name={TYPE_ICON[r.type] ?? 'salud-doc'} />
                </div>
                <div className="grow">
                  <div className="salud-name">{r.title}</div>
                  <div className="salud-sub">
                    {fmtDate(r.date, true)} · {TYPE_SHORT[r.type] ?? r.type}
                    {r.place ? ` · ${r.place}` : ''}
                  </div>
                  <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                    {r.flagged > 0 && <Badge tone="red">{r.flagged} fuera de rango</Badge>}
                    {r.ai && !r.flagged && r.ai.values.length > 0 && <Badge tone="green">Todo en rango</Badge>}
                    {r.ai && <Badge>Leído por IA</Badge>}
                    {r.files.length > 0 && (
                      <Badge>
                        {r.files.length} {r.files.length === 1 ? 'archivo' : 'archivos'}
                      </Badge>
                    )}
                    {typeof r.cost === 'number' && r.cost > 0 && <Badge tone="gold">{fmtMoney(r.cost, currency)}</Badge>}
                  </div>
                </div>
                <Icon name="right" width={16} className="muted" />
              </button>
            ))}
          </div>
        ))
      )}

      {view?.type === 'new' && <NewRecordSheet aiEnabled={!!status?.enabled} onClose={close} onSaved={(id) => setView({ type: 'open', id })} />}
      {view?.type === 'open' && <RecordSheet id={view.id} aiEnabled={!!status?.enabled} onClose={close} onEdit={() => setView({ type: 'edit', id: view.id })} />}
      {view?.type === 'edit' && <EditRecordSheet id={view.id} onClose={() => setView({ type: 'open', id: view.id })} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Campos del estudio
// ---------------------------------------------------------------------------------------------

type Fields = { title: string; type: HealthRecordType; date: string; place: string; doctor: string; cost: string; notes: string };

function RecordFields({ f, setF, today }: { f: Fields; setF: (f: Fields) => void; today: string }) {
  return (
    <>
      <Field label="¿Qué es?">
        <Chips value={f.type} onChange={(type) => setF({ ...f, type })} options={HEALTH_RECORD_TYPES.map((t) => ({ value: t, label: TYPE_SHORT[t] }))} />
      </Field>
      <Field label="Nombre">
        <TextInput className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Química sanguínea, consulta con el cardiólogo… (la IA lo llena si lo dejas vacío)" maxLength={200} />
      </Field>
      <div className="grid2" style={{ gap: 10 }}>
        <Field label="Fecha">
          <input className="input" type="date" max={today} value={f.date} onChange={(e) => e.target.value && setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label="¿Cuánto costó?">
          <input className="input num" type="number" inputMode="decimal" min={0} step="any" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} placeholder="0" />
        </Field>
        <Field label="Lugar">
          <TextInput className="input" value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} placeholder="Laboratorio, clínica…" maxLength={200} />
        </Field>
        <Field label="Médico">
          <TextInput className="input" value={f.doctor} onChange={(e) => setF({ ...f, doctor: e.target.value })} maxLength={200} />
        </Field>
      </div>
      <Field label="Notas">
        <TextArea className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Lo que te dijo el médico, cómo te sentías, qué te recetó…" maxLength={4000} />
      </Field>
    </>
  );
}

const costOf = (s: string) => {
  const n = Number(s.replace(',', '.'));
  return s.trim() && Number.isFinite(n) && n > 0 ? Math.min(n, 9_999_999) : null;
};

// ---------------------------------------------------------------------------------------------
// Subir un estudio
// ---------------------------------------------------------------------------------------------

function NewRecordSheet({ aiEnabled, onClose, onSaved }: { aiEnabled: boolean; onClose: () => void; onSaved: (id: string) => void }) {
  const { state, list, events } = useGame();
  const today = state.today;
  const [f, setFRaw] = useState<Fields>({ title: '', type: 'laboratorio', date: today, place: '', doctor: '', cost: '', notes: '' });
  // Si no cambias la fecha, gana la que trae el documento (la IA la lee).
  const [dateTouched, setDateTouched] = useState(false);
  const setF = (n: Fields) => {
    if (n.date !== f.date) setDateTouched(true);
    setFRaw(n);
  };
  const [files, setFiles] = useState<PreparedFile[]>([]);
  const [asExpense, setAsExpense] = useState(true);
  const [checkupId, setCheckupId] = useState('');
  const [read, setRead] = useState(true);
  const [step, setStep] = useState<{ kind: 'form' } | { kind: 'busy'; text: string } | { kind: 'review'; id: string; reading: ReadResult }>({ kind: 'form' });
  /** Gasto y chequeo van al final, con la fecha definitiva del estudio. */
  const finalize = (rid: string) => {
    let rec = getEntity(rid) as Entity<HealthRecordData> | undefined;
    if (!rec) return;
    if (!rec.data.title) rec = saveRecord(rid, { ...rec.data, title: files[0]?.name.replace(/\.[a-z0-9]+$/i, '') || `Estudio del ${fmtDate(rec.data.date, true)}` });
    if (rec.data.cost && asExpense) rec = recordExpense(rec) ?? rec;
    if (checkupId) markRecordCheckup(rec, checkupId, events);
  };
  const [err, setErr] = useState<string | null>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const checkups = list<CheckupData>('health', 'checkup').filter((c) => c.data.active !== false);
  const cost = costOf(f.cost);

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setErr(null);
    const out: PreparedFile[] = [];
    for (const file of [...list]) {
      try {
        out.push(await prepareFile(file));
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'No pude abrir el archivo.');
      }
    }
    setFiles((xs) => [...xs, ...out].slice(0, 8));
  };

  const save = async () => {
    if (!files.length && !f.title.trim()) return;
    setErr(null);
    const id = newRecordId();
    let refs: HealthFileRef[] = [];
    try {
      if (files.length) {
        setStep({ kind: 'busy', text: files.length > 1 ? `Subiendo 1 de ${files.length}…` : 'Subiendo…' });
        refs = await uploadFiles(files, (n) => n < files.length && setStep({ kind: 'busy', text: `Subiendo ${n + 1} de ${files.length}…` }));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo subir. Revisa tu conexión.');
      setStep({ kind: 'form' });
      return;
    }
    const fallback = files[0]?.name.replace(/\.[a-z0-9]+$/i, '') || `Estudio del ${fmtDate(f.date, true)}`;
    let record = saveRecord(id, {
      title: f.title.trim() || (read && aiEnabled && files.length ? '' : fallback),
      type: f.type,
      date: f.date,
      place: f.place.trim() || undefined,
      doctor: f.doctor.trim() || undefined,
      cost,
      notes: f.notes.trim() || undefined,
      files: refs,
      checkupId: checkupId || null,
    });
    if (!(read && aiEnabled && refs.length)) {
      if (!record.data.title) record = saveRecord(id, { ...record.data, title: fallback });
      finalize(id);
      toast('Estudio guardado');
      onSaved(id);
      return;
    }
    setStep({ kind: 'busy', text: 'Tu médico está leyendo el estudio…' });
    try {
      const reading = await medicoApi.read({ fileIds: refs.map((r) => r.id), today, profile: profileLine(state), hint: { title: f.title || null, date: f.date, notes: f.notes || null } });
      setStep({ kind: 'review', id, reading });
    } catch (e) {
      if (!record.data.title) saveRecord(id, { ...record.data, title: fallback });
      finalize(id);
      toast(`Guardado, pero no se pudo leer: ${e instanceof Error ? e.message : 'error'}. Puedes reintentar desde el estudio.`, 'error');
      onSaved(id);
    }
  };

  if (step.kind === 'review')
    return (
      <Sheet
        open
        onClose={() => {
          finalize(step.id);
          onSaved(step.id);
        }}
        title="Lo que leyó tu médico"
      >
        <ReadingReview id={step.id} reading={step.reading} preferReadingDate={!dateTouched} expenseDefault={asExpense} formCheckupId={checkupId || null} onDone={() => onSaved(step.id)} />
      </Sheet>
    );

  const busy = step.kind === 'busy';
  return (
    <Sheet
      open
      onClose={busy ? () => undefined : onClose}
      title="Subir estudio"
      actions={
        <button className="btn primary" disabled={busy || (!files.length && !f.title.trim())} onClick={save}>
          {busy ? step.text : read && aiEnabled && files.length ? (
            <>
              <Icon name="sparkles" /> Guardar y leer con IA
            </>
          ) : (
            'Guardar'
          )}
        </button>
      }
    >
      <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
        <button className="btn" disabled={busy} onClick={() => camRef.current?.click()}>
          <Icon name="camera" /> Tomar foto
        </button>
        <button className="btn" disabled={busy} onClick={() => pickRef.current?.click()}>
          <Icon name="paperclip" /> Elegir PDF o fotos
        </button>
        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))} />
        <input ref={pickRef} type="file" accept="application/pdf,image/*" multiple hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))} />
      </div>
      {files.length > 0 && (
        <div className="salud-files">
          {files.map((x, i) => (
            <div key={i} className="salud-file">
              {x.preview ? <img src={x.preview} alt="" /> : <Icon name="salud-doc" />}
              <div className="grow">
                <div className="small" style={{ fontWeight: 600, wordBreak: 'break-word' }}>
                  {x.name}
                </div>
                <div className="tiny muted">{fmtBytes(x.size)}</div>
              </div>
              <button className="btn icon ghost" disabled={busy} aria-label="Quitar" onClick={() => setFiles((xs) => xs.filter((_, j) => j !== i))}>
                <Icon name="x" />
              </button>
            </div>
          ))}
          <div className="tiny muted">Varias fotos del mismo estudio se leen juntas.</div>
        </div>
      )}
      {err && <div className="salud-note" style={{ color: 'var(--red)' }}>{err}</div>}
      <RecordFields f={f} setF={setF} today={today} />
      {cost !== null && (
        <label className="row" style={{ gap: 8, marginBottom: 10 }}>
          <input type="checkbox" checked={asExpense} onChange={(e) => setAsExpense(e.target.checked)} />
          <span className="small">Registrar {fmtMoney(cost, state.settings.currency ?? 'MXN')} como gasto (Salud)</span>
        </label>
      )}
      {checkups.length > 0 && (
        <Field label="¿Es de uno de tus chequeos? (lo marca como hecho, con su XP)">
          <select className="input" value={checkupId} onChange={(e) => setCheckupId(e.target.value)}>
            <option value="">No</option>
            {checkups.map((c) => (
              <option key={c.id} value={c.id}>
                {c.data.name} (+{GAME_CONFIG.missionXp[checkupSizeOf(c.data)]} XP)
              </option>
            ))}
          </select>
        </Field>
      )}
      {aiEnabled && files.length > 0 && (
        <label className="row" style={{ gap: 8, marginBottom: 6 }}>
          <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} />
          <span className="small">Que tu médico IA lo lea y saque tus valores</span>
        </label>
      )}
      {!aiEnabled && files.length > 0 && <div className="tiny muted">La lectura con IA no está activada (falta la clave de la API de Claude). Se guarda el archivo y puedes capturar tus valores en Mediciones.</div>}
    </Sheet>
  );
}

/** Marca el chequeo como hecho en la fecha del estudio (con XP), si no estaba ya registrado ese día. */
function markRecordCheckup(record: Entity<HealthRecordData>, checkupId: string, events: { type: string; localDate: string; voidedAt?: string | null; payload?: any }[]): Entity<HealthRecordData> | null {
  const c = getEntity(checkupId) as Entity<CheckupData> | undefined;
  if (!c || record.data.checkupEventId) return null;
  if (events.some((e) => !e.voidedAt && e.type === 'health.checkup_done' && e.localDate === record.data.date && e.payload?.checkupId === checkupId)) return saveRecord(record.id, { ...record.data, checkupId });
  const size: MissionSize = checkupSizeOf(c.data);
  const ev = addEvent('health.checkup_done', { checkupId, name: c.data.name, size, result: record.data.title || undefined }, { localDate: record.data.date });
  toast(`✓ ${c.data.name} · +${GAME_CONFIG.missionXp[size]} XP`, 'xp');
  return saveRecord(record.id, { ...record.data, checkupId, checkupEventId: ev.id });
}

// ---------------------------------------------------------------------------------------------
// Revisar lo que leyó la IA
// ---------------------------------------------------------------------------------------------

function ValueRow({ v, checked, onToggle, saved }: { v: HealthRecordValue; checked?: boolean; onToggle?: () => void; saved?: boolean }) {
  const n = (x: number) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100));
  const val = typeof v.value === 'number' ? `${n(v.value)}${typeof v.value2 === 'number' ? `/${n(v.value2)}` : ''}` : v.text || '—';
  return (
    <label className={`salud-value ${v.flag ? 'flag' : ''}`}>
      {onToggle ? <input type="checkbox" checked={!!checked} onChange={onToggle} /> : <span style={{ width: 16 }} />}
      <span className="grow">
        <span className="small" style={{ fontWeight: 600 }}>
          {v.name}
        </span>
        {v.ref && <span className="tiny muted"> · ref. {v.ref}</span>}
      </span>
      <span className="num small" style={{ fontWeight: 700 }}>
        {val}
        {v.unit && typeof v.value === 'number' ? <span className="tiny muted"> {v.unit}</span> : null}
      </span>
      {v.flag ? <span className={`salud-level ${v.flag === 'bajo' ? 'bajo' : 'alto'}`}>{v.flag}</span> : saved ? <Icon name="check" width={14} className="muted" /> : <span style={{ width: 14 }} />}
    </label>
  );
}

function ReadingReview({
  id,
  reading,
  onDone,
  preferReadingDate = false,
  expenseDefault = false,
  formCheckupId = null,
}: {
  id: string;
  reading: ReadResult;
  onDone: () => void;
  /** La fecha del documento gana (no la cambiaste al subirlo). */
  preferReadingDate?: boolean;
  expenseDefault?: boolean;
  /** Chequeo que elegiste al subirlo (se marca hecho con la fecha final). */
  formCheckupId?: string | null;
}) {
  const { state, list, events } = useGame();
  const values = readingValues(reading);
  const savable = savableValues(values);
  const [pick, setPick] = useState<Set<number>>(() => new Set(savable.map((x) => x.i)));
  const record = getEntity(id) as Entity<HealthRecordData> | undefined;
  // ¿Cuenta como un chequeo? (p. ej. laboratorios): se ofrece marcarlo hecho en la fecha del estudio.
  const sug = reading.checkup ? HEALTH_SUGGESTIONS.find((s) => s.id === reading.checkup) : undefined;
  const all = list<CheckupData>('health', 'checkup');
  const sugEntity = sug ? all.find((c) => c.id === suggestionCheckupId(sug.id)) ?? all.find((c) => c.data.suggestionId === sug.id) : undefined;
  const offerCheckup = !!sug && !!record && !formCheckupId && !record.data.checkupEventId && !record.data.checkupId;
  const [countCheckup, setCountCheckup] = useState(true);
  const cost = record?.data.cost ?? reading.cost ?? null;
  const offerExpense = !!record && !record.data.expenseEventId && typeof cost === 'number' && cost > 0;
  const [expense, setExpense] = useState(expenseDefault);
  if (!record) return <Empty>Ese estudio ya no existe.</Empty>;
  const fromDoc = reading.date && reading.date <= state.today ? reading.date : null;
  const date = preferReadingDate && fromDoc ? fromDoc : record.data.date || fromDoc || state.today;

  const save = () => {
    let saved = applyReading(record, reading, pick, state.today, preferReadingDate);
    if (formCheckupId) saved = markRecordCheckup(saved, formCheckupId, events) ?? saved;
    else if (offerCheckup && countCheckup && sug) {
      const c = sugEntity && sugEntity.data.active !== false ? sugEntity : activateSuggestion(sug, sugEntity ?? null);
      saved = markRecordCheckup(saved, c.id, events) ?? saved;
    }
    if (offerExpense && expense) recordExpense(saved);
    onDone();
  };

  return (
    <>
      <div className="salud-reading-head">
        <b>{reading.title}</b>
        <div className="tiny muted">
          {reading.date ? fmtDate(reading.date, true) : 'Sin fecha en el documento'}
          {reading.place ? ` · ${reading.place}` : ''}
          {reading.doctor ? ` · ${reading.doctor}` : ''}
          {reading.cost ? ` · ${fmtMoney(reading.cost, state.settings.currency ?? 'MXN')}` : ''}
        </div>
      </div>
      <div className="salud-consult-msg">
        <p>{reading.summary}</p>
      </div>
      {values.length > 0 && (
        <>
          <div className="eyebrow" style={{ margin: '12px 0 4px' }}>
            Valores ({values.length}) · marca los que quieres en tus mediciones
          </div>
          <div className="salud-values">
            {values.map((v, i) => {
              const can = savable.some((x) => x.i === i);
              return (
                <ValueRow
                  key={i}
                  v={v}
                  checked={pick.has(i)}
                  onToggle={
                    can
                      ? () =>
                          setPick((p) => {
                            const n = new Set(p);
                            if (n.has(i)) n.delete(i);
                            else n.add(i);
                            return n;
                          })
                      : undefined
                  }
                />
              );
            })}
          </div>
        </>
      )}
      {reading.findings.length > 0 && (
        <div className="salud-missing">
          <div className="eyebrow">Hallazgos</div>
          <ul>
            {reading.findings.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      {reading.recommendations.length > 0 && (
        <div className="salud-missing">
          <div className="eyebrow">Recomendaciones</div>
          <ul>
            {reading.recommendations.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      {offerCheckup && sug && (
        <label className="row" style={{ gap: 8, margin: '10px 0' }}>
          <input type="checkbox" checked={countCheckup} onChange={(e) => setCountCheckup(e.target.checked)} />
          <span className="small">
            {sugEntity && sugEntity.data.active !== false ? 'Contarlo como tu chequeo' : 'Activar y contar como tu chequeo'} «{sug.name}» del {fmtDate(date, true)} (+{GAME_CONFIG.missionXp[sugEntity ? checkupSizeOf(sugEntity.data) : sug.size]} XP)
          </span>
        </label>
      )}
      {offerExpense && (
        <label className="row" style={{ gap: 8, margin: '10px 0' }}>
          <input type="checkbox" checked={expense} onChange={(e) => setExpense(e.target.checked)} />
          <span className="small">Registrar {fmtMoney(cost!, state.settings.currency ?? 'MXN')} como gasto (Salud)</span>
        </label>
      )}
      <button className="btn primary block" onClick={save}>
        <Icon name="check" /> Guardar en mi expediente{pick.size ? ` (${pick.size} ${pick.size === 1 ? 'valor' : 'valores'})` : ''}
      </button>
      <p className="tiny muted" style={{ marginBottom: 0 }}>
        Revisa que los números coincidan con tu estudio. Orientación general; no sustituye a tu médico.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Ver un estudio
// ---------------------------------------------------------------------------------------------

function RecordSheet({ id, aiEnabled, onClose, onEdit }: { id: string; aiEnabled: boolean; onClose: () => void; onEdit: () => void }) {
  const { state, events } = useGame();
  const [, setParams] = useSearchParams();
  const [viewer, setViewer] = useState<HealthFileRef | null>(null);
  const [reading, setReading] = useState<ReadResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const record = getEntity(id) as Entity<HealthRecordData> | undefined;
  if (!record) return null;
  const d = record.data;
  const currency = state.settings.currency ?? 'MXN';
  const liveMetrics = (d.metricEventIds ?? []).filter((eid) => events.some((e) => e.id === eid && !e.voidedAt)).length;
  const savable = d.ai ? savableValues(d.ai.values) : [];

  if (reading)
    return (
      <Sheet open onClose={() => setReading(null)} title="Lo que leyó tu médico">
        <ReadingReview id={id} reading={reading} onDone={() => setReading(null)} />
      </Sheet>
    );
  if (viewer) return <FileViewer f={viewer} onClose={() => setViewer(null)} />;

  const readAgain = async () => {
    setBusy('Tu médico está leyendo el estudio…');
    setErr(null);
    try {
      setReading(await medicoApi.read({ fileIds: d.files.map((f) => f.id), today: state.today, profile: profileLine(state), hint: { title: d.title, date: d.date, notes: d.notes ?? null } }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo leer.');
    } finally {
      setBusy(null);
    }
  };

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setErr(null);
    setBusy('Subiendo…');
    try {
      const prepared: PreparedFile[] = [];
      for (const f of [...list]) prepared.push(await prepareFile(f));
      const refs = await uploadFiles(prepared);
      const cur = getEntity(id) as Entity<HealthRecordData> | undefined;
      if (cur) saveRecord(id, { ...cur.data, files: [...cur.data.files, ...refs] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo subir.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirmAction(`¿Borrar "${d.title}" y sus archivos? El gasto y la XP del chequeo (si los hubo) se conservan.`)) return;
    const also = liveMetrics > 0 && confirmAction(`¿Quitar también sus ${liveMetrics} mediciones de tu historial?`);
    onClose();
    await deleteRecord(record, also);
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={d.title || 'Estudio'}
      actions={
        <>
          <button className="btn ghost danger" onClick={remove}>
            <Icon name="trash" /> Borrar
          </button>
          <button className="btn" onClick={onEdit}>
            <Icon name="edit" /> Editar
          </button>
        </>
      }
    >
      <div className="row wrap" style={{ gap: 4, marginBottom: 10 }}>
        <Badge>{HEALTH_RECORD_TYPE_NAMES[d.type] ?? d.type}</Badge>
        <Badge>{fmtDate(d.date, true)}</Badge>
        {d.place && <Badge>{d.place}</Badge>}
        {d.doctor && <Badge>{d.doctor}</Badge>}
        {typeof d.cost === 'number' && d.cost > 0 && <Badge tone="gold">{fmtMoney(d.cost, currency)}</Badge>}
      </div>
      {typeof d.cost === 'number' && d.cost > 0 && (
        <div className="tiny muted" style={{ marginBottom: 8 }}>
          {d.expenseEventId ? (
            'Registrado como gasto (Salud).'
          ) : (
            <button className="salud-link" onClick={() => recordExpense(record) && toast('Gasto registrado')}>
              Registrar como gasto
            </button>
          )}
        </div>
      )}
      {d.notes && <div className="small" style={{ whiteSpace: 'pre-wrap', marginBottom: 10 }}>{d.notes}</div>}

      <div className="eyebrow" style={{ marginBottom: 4 }}>
        Archivos
      </div>
      <div className="salud-files">
        {d.files.map((f) => (
          <button key={f.id} className="salud-file salud-plain" onClick={() => setViewer(f)}>
            <Icon name={f.mime === 'application/pdf' ? 'salud-doc' : 'camera'} />
            <div className="grow" style={{ textAlign: 'left' }}>
              <div className="small" style={{ fontWeight: 600, wordBreak: 'break-word' }}>
                {f.name}
              </div>
              <div className="tiny muted">{fmtBytes(f.size)}</div>
            </div>
            <Icon name="right" width={16} />
          </button>
        ))}
        <button className="btn sm ghost" disabled={!!busy} onClick={() => addRef.current?.click()}>
          <Icon name="plus" /> Agregar archivo
        </button>
        <input ref={addRef} type="file" accept="application/pdf,image/*" multiple hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))} />
      </div>

      {d.ai ? (
        <>
          <div className="eyebrow" style={{ margin: '14px 0 4px' }}>
            Lo que leyó tu médico
          </div>
          <div className="salud-consult-msg">
            <p>{d.ai.summary}</p>
          </div>
          {d.ai.values.length > 0 && (
            <div className="salud-values">
              {d.ai.values.map((v, i) => (
                <ValueRow key={i} v={v} saved={liveMetrics > 0 && savable.some((x) => x.i === i)} />
              ))}
            </div>
          )}
          {d.ai.findings.length > 0 && (
            <div className="salud-missing">
              <div className="eyebrow">Hallazgos</div>
              <ul>
                {d.ai.findings.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          {d.ai.recommendations.length > 0 && (
            <div className="salud-missing">
              <div className="eyebrow">Recomendaciones</div>
              <ul>
                {d.ai.recommendations.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="tiny muted" style={{ marginTop: 6 }}>
            {liveMetrics ? `${liveMetrics} ${liveMetrics === 1 ? 'valor está' : 'valores están'} en tus mediciones.` : savable.length ? (
              <button className="salud-link" onClick={() => saveRecordMetrics(record, new Set(savable.map((x) => x.i)))}>
                Guardar {savable.length} {savable.length === 1 ? 'valor' : 'valores'} en tus mediciones
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {err && <div className="salud-note" style={{ color: 'var(--red)' }}>{err}</div>}
      <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
        {aiEnabled && d.files.length > 0 && (
          <button className="btn" disabled={!!busy} onClick={readAgain}>
            <Icon name="sparkles" /> {busy ?? (d.ai ? 'Volver a leer' : 'Leer con IA')}
          </button>
        )}
        {aiEnabled && (
          <button
            className="btn ghost"
            onClick={() => {
              onClose();
              setParams({ tab: 'medico', estudio: id }, { replace: true });
            }}
          >
            <Icon name="chat" /> Preguntarle a tu médico
          </button>
        )}
      </div>
      {busy && !aiEnabled && <div className="tiny muted">{busy}</div>}
    </Sheet>
  );
}

function FileViewer({ f, onClose }: { f: HealthFileRef; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fileUrl(f)
      .then((u) => alive && setUrl(u))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : 'No se pudo abrir.'));
    return () => {
      alive = false;
    };
  }, [f]);
  return (
    <Sheet open onClose={onClose} title={f.name}>
      {err && <Empty>{err}</Empty>}
      {!url && !err && <Empty>Abriendo…</Empty>}
      {url && (f.mime === 'application/pdf' ? <iframe className="salud-pdf" src={url} title={f.name} /> : <img className="salud-img" src={url} alt={f.name} />)}
      {url && (
        <a className="btn block" style={{ marginTop: 10 }} href={url} download={f.name} target="_blank" rel="noreferrer">
          <Icon name="download" /> Descargar / abrir aparte
        </a>
      )}
    </Sheet>
  );
}

function EditRecordSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { state } = useGame();
  const record = getEntity(id) as Entity<HealthRecordData> | undefined;
  const d = record?.data;
  const [f, setF] = useState<Fields>({ title: d?.title ?? '', type: d?.type ?? 'otro', date: d?.date ?? state.today, place: d?.place ?? '', doctor: d?.doctor ?? '', cost: d?.cost ? String(d.cost) : '', notes: d?.notes ?? '' });
  if (!record || !d) return null;
  return (
    <Sheet
      open
      onClose={onClose}
      title="Editar estudio"
      actions={
        <button
          className="btn primary"
          disabled={!f.title.trim()}
          onClick={() => {
            const prev = record;
            saveEntity<HealthRecordData>({ ...record, data: { ...d, title: f.title.trim(), type: f.type, date: f.date, place: f.place.trim() || undefined, doctor: f.doctor.trim() || undefined, cost: costOf(f.cost), notes: f.notes.trim() || undefined } });
            toast('Guardado', 'info', { label: 'Deshacer', run: () => saveEntity(prev) });
            onClose();
          }}
        >
          Guardar
        </button>
      }
    >
      <RecordFields f={f} setF={setF} today={state.today} />
      {d.metricEventIds?.length ? <div className="tiny muted">Cambiar la fecha no mueve las mediciones que ya se guardaron.</div> : null}
    </Sheet>
  );
}
