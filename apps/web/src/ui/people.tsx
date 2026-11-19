import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CHANNEL_NAMES,
  CIRCLE_NAMES,
  PEOPLE_CIRCLES,
  PERSON_ROLES,
  TEMPERATURE_NAMES,
  cadenceFor,
  circleOf,
  diffDays,
  GAME_CONFIG,
  isValidBirthday,
  legacyNpcType,
  relationLevelName,
  relationTrack,
  roleInfo,
  type ContactChannel,
  type Entity,
  type GameEvent,
  type GuildData,
  type NpcData,
  type NpcState,
  type PeopleCircle,
  type PlaceData,
  type Temperature,
} from '@igv/core';
import { addEvent, deleteEntity, saveEntity, useGame, voidEvent } from '../data/store';
import { haptic, sfx } from '../lib/sound';
import { newId } from '../lib/time';
import { Chips, Collapse, DateChips, Field, Sheet, confirmAction, toast, undoToast, useAutoFocus } from './kit';
import { Icon } from './icons';
import { initials } from './Avatar';
import '../styles/gente.css';

// ---------------------------------------------------------------------------------------------
// Etiquetas
// ---------------------------------------------------------------------------------------------

export const CHANNEL_ICON: Record<ContactChannel, string> = { persona: 'users', llamada: 'call', videollamada: 'videocall', mensaje: 'chat' };
export const CADENCE_OPTIONS = [1, 3, 7, 14, 30, 90, 180, 0];

export function freqLabel(n: number): string {
  if (n <= 0) return 'Sin meta';
  if (n === 1) return 'Diario';
  if (n === 7) return 'Semanal';
  if (n === 14) return 'Cada 2 semanas';
  if (n === 30) return 'Mensual';
  if (n === 90) return 'Cada 3 meses';
  if (n === 180) return 'Cada 6 meses';
  return `Cada ${n} días`;
}

/** "hoy", "ayer", "hace 5 días" a partir del último contacto real (no de la fecha de alta). */
export function lastContactLabel(st: NpcState | undefined, today: string): string {
  if (!st?.lastInteraction) return 'Sin contacto registrado';
  const d = Math.max(0, diffDays(st.lastInteraction, today));
  return d === 0 ? 'Hoy' : d === 1 ? 'Ayer' : `Hace ${d} días`;
}

export const joinNames = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`);

const isFamily = (c: PeopleCircle) => c === 'familia' || c === 'pareja';

/** Orden de personas: familia por prioridad, luego nivel, luego nombre. */
export function byCloseness(state: { npcs: { npcs: Record<string, NpcState> } }) {
  return (a: Entity<NpcData>, b: Entity<NpcData>) => {
    const x = state.npcs.npcs[a.id];
    const y = state.npcs.npcs[b.id];
    return (x?.priority ?? 9) - (y?.priority ?? 9) || (y?.level ?? 0) - (x?.level ?? 0) || a.data.name.localeCompare(b.data.name, 'es');
  };
}

// ---------------------------------------------------------------------------------------------
// Piezas visuales
// ---------------------------------------------------------------------------------------------

export function PersonAvatar({ name, level, progress, size = 48 }: { name: string; level: number; progress: number; size?: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const max = level >= 5;
  const p = max ? 1 : Math.max(0, Math.min(1, progress));
  return (
    <span className={`gp-av ${max ? 'max' : ''}`} style={{ width: size, height: size }} aria-label={`Nivel ${level}`}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r={r} className="gp-ring-bg" />
        <circle cx="24" cy="24" r={r} className="gp-ring" strokeDasharray={c} strokeDashoffset={c * (1 - p)} />
      </svg>
      <span className="gp-ini" style={{ fontSize: Math.round(size * 0.3) }}>
        {initials(name).slice(0, 2)}
      </span>
      <span className="gp-lvl">{level}</span>
    </span>
  );
}

export function TempDot({ t }: { t: Temperature | null | undefined }) {
  return <span className={`gp-temp ${t ?? ''}`} title={t ? `Relación ${TEMPERATURE_NAMES[t].toLowerCase()}` : 'Sin meta de frecuencia'} />;
}

export function PersonRow({ p, onLog }: { p: Entity<NpcData>; onLog?: (id: string) => void }) {
  const { state } = useGame();
  const nav = useNavigate();
  const st = state.npcs.npcs[p.id];
  if (!st) return null;
  return (
    <div className="gp-row">
      <button className="gp-main" onClick={() => nav(`/npcs/${p.id}`)}>
        <PersonAvatar name={p.data.name} level={st.level} progress={st.next?.progress ?? 1} />
        <span className="gp-text">
          <span className="gp-name">
            <span>{p.data.name}</span>
            {p.data.key && <Icon name="star" fill="currentColor" aria-label="Persona clave" />}
          </span>
          <span className="gp-sub">
            <span>
              {st.role ?? CIRCLE_NAMES[st.circle]} · {st.levelName}
            </span>
          </span>
          <span className="gp-sub">
            <TempDot t={st.temperature} />
            <span>
              {lastContactLabel(st, state.today)}
              {st.trend === 'sube' ? ' · se acerca' : st.trend === 'baja' ? ' · se aleja' : ''}
            </span>
          </span>
        </span>
      </button>
      {onLog && (
        <button className="btn icon gp-log" aria-label={`Registrar contacto con ${p.data.name}`} onClick={() => onLog(p.id)}>
          <Icon name="chat" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Registrar contacto (una o varias personas)
// ---------------------------------------------------------------------------------------------

/** Registra un contacto con varias personas (un evento por persona) con "Deshacer". */
export function logContacts(ids: string[], names: string[], opts: { channel?: ContactChannel; placeId?: string | null; note?: string; date: string }): GameEvent[] {
  const evs = ids.map((npcId) =>
    addEvent(
      'npc.interaction',
      { npcId, ...(opts.channel ? { channel: opts.channel } : {}), ...(opts.placeId ? { placeId: opts.placeId } : {}), ...(opts.note?.trim() ? { note: opts.note.trim() } : {}) },
      { localDate: opts.date },
    ),
  );
  sfx.coin();
  haptic(15);
  undoToast(`Contacto con ${joinNames(names)}${opts.channel ? ` · ${CHANNEL_NAMES[opts.channel].toLowerCase()}` : ''}`, () => evs.forEach((e) => voidEvent(e.id)));
  return evs;
}

export function ContactForm({ preselect, date, setDate, today, onDone }: { preselect?: string[]; date: string; setDate: (d: string) => void; today: string; onDone: () => void }) {
  const { state, list } = useGame();
  const people = list<NpcData>('npcs', 'npc');
  const places = list<PlaceData>('map', 'place');
  const [sel, setSel] = useState<string[]>(preselect ?? []);
  const [channel, setChannel] = useState<ContactChannel>('persona');
  const [placeId, setPlaceId] = useState<string>('');
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [newCircle, setNewCircle] = useState(false);

  const recentRank = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of state.npcs.contacts) m.set(c.npcId, (m.get(c.npcId) ?? 0) + 1);
    return m;
  }, [state.npcs.contacts]);
  const ordered = useMemo(
    () =>
      [...people].sort((a, b) => {
        const x = state.npcs.npcs[a.id];
        const y = state.npcs.npcs[b.id];
        const fa = x && isFamily(x.circle) ? x.priority : 50;
        const fb = y && isFamily(y.circle) ? y.priority : 50;
        return fa - fb || (recentRank.get(b.id) ?? 0) - (recentRank.get(a.id) ?? 0) || a.data.name.localeCompare(b.data.name, 'es');
      }),
    [people, state.npcs.npcs, recentRank],
  );
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const query = norm(q.trim());
  const matches = query ? ordered.filter((p) => norm(`${p.data.name} ${p.data.role ?? ''}`).includes(query)) : ordered;
  const LIMIT = 14;
  const shown = [...(showAll || query ? matches : matches.slice(0, LIMIT))];
  // Las elegidas siempre visibles
  for (const id of sel) if (!shown.some((p) => p.id === id)) {
    const p = people.find((x) => x.id === id);
    if (p) shown.unshift(p);
  }
  const exact = query && people.some((p) => norm(p.data.name) === query);
  const toggle = (id: string) => setSel((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  const createPerson = (circle: PeopleCircle) => {
    const name = q.trim();
    if (!name) return;
    const e = saveEntity<NpcData>({ id: `npc-${newId().slice(0, 8)}`, module: 'npcs', kind: 'npc', data: { name, circle, role: null, npcType: legacyNpcType(circle, null), relation: 3, key: false } });
    setSel((xs) => [...xs, e.id]);
    setQ('');
    setNewCircle(false);
    toast(`Agregaste a ${name} (${CIRCLE_NAMES[circle]})`);
  };

  const save = () => {
    if (!sel.length) return;
    const names = sel.map((id) => people.find((p) => p.id === id)?.data.name ?? '').filter(Boolean);
    logContacts(sel, names, { channel, placeId: channel === 'persona' ? placeId || null : null, note, date });
    onDone();
  };

  return (
    <>
      <Field label={sel.length > 1 ? `¿Con quién? · ${sel.length} personas` : '¿Con quién?'}>
        <div className="stack">
          {people.length > 6 || !people.length ? (
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={people.length ? 'Buscar o escribir un nombre nuevo' : 'Nombre de la persona'} />
          ) : null}
          {shown.length > 0 && (
            <div className="gp-pick" role="group" aria-label="Personas">
              {shown.map((p) => {
                const st = state.npcs.npcs[p.id];
                const on = sel.includes(p.id);
                return (
                  <button key={p.id} type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggle(p.id)}>
                    {on ? <Icon name="check" width={14} /> : <TempDot t={st?.temperature} />}
                    {p.data.name}
                  </button>
                );
              })}
              {!showAll && !query && matches.length > LIMIT && (
                <button type="button" className="chip" onClick={() => setShowAll(true)}>
                  +{matches.length - LIMIT} más
                </button>
              )}
            </div>
          )}
          {query && !exact && (
            <>
              <button type="button" className="btn sm" onClick={() => setNewCircle((x) => !x)}>
                <Icon name="plus" /> Agregar a «{q.trim()}»
              </button>
              {newCircle && (
                <Chips value={null as PeopleCircle | null} onChange={createPerson} options={PEOPLE_CIRCLES.map((c) => ({ value: c, label: CIRCLE_NAMES[c] }))} />
              )}
            </>
          )}
        </div>
      </Field>
      <Field label="¿Cómo?">
        <div className="gp-channel" role="radiogroup">
          {(['persona', 'llamada', 'videollamada', 'mensaje'] as ContactChannel[]).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={channel === c} className={channel === c ? 'on' : ''} onClick={() => setChannel(c)}>
              <Icon name={CHANNEL_ICON[c]} />
              {c === 'videollamada' ? 'Video' : CHANNEL_NAMES[c]}
            </button>
          ))}
        </div>
      </Field>
      {channel === 'persona' && places.length > 0 && (
        <Field label="¿Dónde? (opcional)">
          {places.length <= 10 ? (
            <Chips value={placeId} onChange={(v) => setPlaceId(v === placeId ? '' : v)} options={places.map((p) => ({ value: p.id, label: p.data.name }))} />
          ) : (
            <select className="input" value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
              <option value="">— Ningún lugar —</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.data.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <Field label="Nota (opcional)">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Qué hicieron o de qué hablaron" onKeyDown={(e) => e.key === 'Enter' && save()} />
      </Field>
      <Field label="¿Cuándo?">
        <DateChips value={date} onChange={setDate} today={today} />
      </Field>
      <button className="btn primary block" disabled={!sel.length} onClick={save}>
        {sel.length > 1 ? `Registrar con ${sel.length} personas` : 'Registrar contacto'}
      </button>
      <p className="tiny muted" style={{ marginBottom: 0 }}>
        Cuenta para su nivel de cercanía: un día con contacto, y si fue en persona, una convivencia.
      </p>
    </>
  );
}

export function LogSheet({ preselect, onClose }: { preselect?: string[]; onClose: () => void }) {
  const { state } = useGame();
  const [date, setDate] = useState(state.today);
  return (
    <Sheet open onClose={onClose} title="Registrar contacto">
      <ContactForm preselect={preselect} date={date} setDate={setDate} today={state.today} onDone={onClose} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------
// Ficha de persona (crear / editar)
// ---------------------------------------------------------------------------------------------

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function splitBirthday(b: string | null | undefined) {
  const m = b ? /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(b) : null;
  return { y: m?.[1] ?? '', m: m ? String(Number(m[2])) : '', d: m ? String(Number(m[3])) : '' };
}

export function PersonSheet({
  initial,
  preset,
  onClose,
  onSaved,
}: {
  initial?: Entity<NpcData>;
  preset?: { circle?: PeopleCircle; role?: string };
  onClose: () => void;
  onSaved?: (e: Entity<NpcData>) => void;
}) {
  const { list, state } = useGame();
  const nav = useNavigate();
  const guilds = list<GuildData>('npcs', 'guild');
  const places = list<PlaceData>('map', 'place');
  const p = initial?.data;
  const [name, setName] = useState(p?.name ?? '');
  const [circle, setCircle] = useState<PeopleCircle>(p ? circleOf(p) : (preset?.circle ?? (preset?.role ? roleInfo(preset.role)?.circle : undefined) ?? 'amigos'));
  const [role, setRole] = useState(p?.role ?? preset?.role ?? '');
  const [key, setKey] = useState(!!p?.key);
  const [start, setStart] = useState<number>(p?.startLevel ?? 1);
  const [cadence, setCadence] = useState<number | null>(p?.cadenceDays ?? null);
  const bd0 = splitBirthday(p?.birthday);
  const [bd, setBd] = useState(bd0);
  const [metWhere, setMetWhere] = useState(p?.metWhere ?? '');
  const [metPlaceId, setMetPlaceId] = useState(p?.metPlaceId ?? '');
  const [metOn, setMetOn] = useState(p?.metOn ?? '');
  const [phone, setPhone] = useState(p?.phone ?? '');
  const [guildId, setGuildId] = useState(p?.guildId ?? '');
  const [notes, setNotes] = useState(p?.notes ?? '');
  const ref = useAutoFocus<HTMLInputElement>();

  const fem = !!roleInfo(role)?.fem;
  const track = relationTrack(circle);
  const roles = PERSON_ROLES.filter((r) => r.circle === circle);
  const autoCadence = cadenceFor({ circle, role }, GAME_CONFIG);
  const birthday = bd.m && bd.d ? `${bd.y ? `${bd.y}-` : ''}${bd.m.padStart(2, '0')}-${bd.d.padStart(2, '0')}` : '';
  const bdOk = !birthday || isValidBirthday(birthday);
  const metOk = !metOn || /^\d{4}(-\d{2})?$/.test(metOn);
  const valid = !!name.trim() && bdOk && metOk;

  const save = () => {
    if (!valid) return;
    const r = role.trim() || null;
    const data: NpcData = {
      ...(p ?? ({} as NpcData)),
      name: name.trim(),
      circle,
      role: r,
      npcType: legacyNpcType(circle, r),
      relation: p?.relation ?? 3,
      key,
      guildId: guildId || null,
      notes: notes.trim(),
      metWhere: metWhere.trim() || null,
      metPlaceId: metPlaceId || null,
      metOn: metOn || null,
      birthday: birthday || null,
      phone: phone.trim() || null,
      startLevel: start,
      cadenceDays: cadence,
    };
    const saved = saveEntity<NpcData>({ id: initial?.id ?? `npc-${newId().slice(0, 8)}`, module: 'npcs', kind: 'npc', data });
    toast(initial ? 'Ficha guardada' : `Agregaste a ${data.name}`);
    onSaved?.(saved);
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? `Editar a ${p?.name}` : 'Nueva persona'}
      actions={
        <>
          {initial && (
            <button
              className="btn ghost danger"
              onClick={() => {
                if (!confirmAction(`¿Borrar a ${p?.name}? Su XP ganada se conserva.`)) return;
                deleteEntity(initial.id);
                onClose();
                nav('/npcs');
              }}
            >
              Borrar
            </button>
          )}
          <button className="btn primary" disabled={!valid} onClick={save}>
            Guardar
          </button>
        </>
      }
    >
      <Field label="Nombre">
        <input ref={ref} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Cómo le dices" />
      </Field>
      <Field label="Círculo">
        <Chips value={circle} onChange={setCircle} options={PEOPLE_CIRCLES.map((c) => ({ value: c, label: CIRCLE_NAMES[c] }))} />
      </Field>
      <Field label="Rol">
        <div className="stack">
          {roles.length > 0 && <Chips value={role} onChange={(v) => setRole(v === role ? '' : v)} options={roles.map((r) => ({ value: r.label, label: r.label }))} />}
          <input className="input" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Otro: madrina, amigo de la prepa…" />
        </div>
      </Field>
      <label className="checkbox">
        <input type="checkbox" checked={key} onChange={(e) => setKey(e.target.checked)} />
        Persona clave (avisarme en Hoy si se enfría)
      </label>
      <Field label="¿Qué tan cercana es hoy? (punto de partida)">
        <Chips value={start} onChange={setStart} options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n} · ${relationLevelName(track, n, fem)}` }))} />
      </Field>
      <p className="tiny muted" style={{ marginTop: -6 }}>
        Lo que ya existía antes de la app. Desde aquí, el nivel sube con días de contacto, convivencias en persona y constancia. El punto de partida no da XP.
      </p>
      <Field label="¿Cada cuánto quieres verla o hablarle?">
        <Chips
          value={cadence ?? -1}
          onChange={(v) => setCadence(v === -1 ? null : v)}
          options={[{ value: -1, label: `Automático (${freqLabel(autoCadence).toLowerCase()})` }, ...CADENCE_OPTIONS.map((n) => ({ value: n, label: freqLabel(n) }))]}
        />
      </Field>
      <Collapse title="Más datos" defaultOpen={!!initial && !!(p?.birthday || p?.metWhere || p?.metOn || p?.phone || p?.notes)}>
        <Field label="Cumpleaños">
          <div className="row" style={{ gap: 6 }}>
            <select className="input" value={bd.d} onChange={(e) => setBd({ ...bd, d: e.target.value })} aria-label="Día">
              <option value="">Día</option>
              {Array.from({ length: 31 }, (_, i) => (
                <option key={i + 1} value={String(i + 1)}>
                  {i + 1}
                </option>
              ))}
            </select>
            <select className="input" value={bd.m} onChange={(e) => setBd({ ...bd, m: e.target.value })} aria-label="Mes">
              <option value="">Mes</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={String(i + 1)}>
                  {m}
                </option>
              ))}
            </select>
            <input className="input" inputMode="numeric" maxLength={4} value={bd.y} onChange={(e) => setBd({ ...bd, y: e.target.value.replace(/\D/g, '') })} placeholder="Año" aria-label="Año (opcional)" />
          </div>
          {!bdOk && <span className="tiny red">Fecha inválida</span>}
        </Field>
        <Field label="¿Dónde se conocieron?">
          <input className="input" value={metWhere} onChange={(e) => setMetWhere(e.target.value)} placeholder="En la prepa, en el trabajo, por un amigo…" />
        </Field>
        {places.length > 0 && (
          <Field label="Lugar del mapa (opcional)">
            <select className="input" value={metPlaceId} onChange={(e) => setMetPlaceId(e.target.value)}>
              <option value="">— Ninguno —</option>
              {places.map((pl) => (
                <option key={pl.id} value={pl.id}>
                  {pl.data.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="¿Cuándo? (año, o año y mes)">
          <input className="input" value={metOn} onChange={(e) => setMetOn(e.target.value.replace(/[^\d-]/g, '').slice(0, 7))} placeholder={`${state.today.slice(0, 4)} o ${state.today.slice(0, 7)}`} inputMode="numeric" />
          {!metOk && <span className="tiny red">Usa el año (2015) o año y mes (2015-06)</span>}
        </Field>
        <Field label="Teléfono (opcional)">
          <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Con lada, para WhatsApp" />
        </Field>
        {guilds.length > 0 && (
          <Field label="Grupo">
            <select className="input" value={guildId} onChange={(e) => setGuildId(e.target.value)}>
              <option value="">— Ninguno —</option>
              {guilds.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.data.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Notas">
          <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Lo que no quieres olvidar" />
        </Field>
      </Collapse>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------
// Arma tu familia
// ---------------------------------------------------------------------------------------------

const FAMILY_ROLES = ['Pareja', 'Novia', 'Esposa', 'Hija', 'Hijo', 'Mamá', 'Papá', 'Hermana', 'Hermano', 'Abuela', 'Abuelo', 'Tía', 'Tío', 'Prima', 'Primo'];

export function FamilyBuilder({ compact = false }: { compact?: boolean }) {
  const { list } = useGame();
  const people = list<NpcData>('npcs', 'npc');
  const [role, setRole] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [more, setMore] = useState(false);
  const [other, setOther] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (role) setTimeout(() => input.current?.focus(), 40);
  }, [role]);
  const count = (r: string) => people.filter((p) => (p.data.role ?? '').toLowerCase() === r.toLowerCase()).length;
  const shown = more ? FAMILY_ROLES : FAMILY_ROLES.slice(0, 9);
  const add = () => {
    const n = name.trim();
    if (!n || !role) return;
    const info = roleInfo(role);
    const circle: PeopleCircle = info?.circle ?? 'familia';
    saveEntity<NpcData>({ id: `npc-${newId().slice(0, 8)}`, module: 'npcs', kind: 'npc', data: { name: n, circle, role, npcType: legacyNpcType(circle, role), relation: 3, key: false } });
    toast(`Agregaste a ${n} (${role})`);
    setName('');
    setRole(null);
  };
  return (
    <div className={compact ? '' : 'card'}>
      {!compact && (
        <>
          <h2>Arma tu familia</h2>
          <p className="small muted" style={{ marginTop: 0 }}>
            Toca quién es y escribe su nombre. Puedes agregar a toda tu gente cercana en un minuto.
          </p>
        </>
      )}
      <div className="gp-roles">
        {shown.map((r) => {
          const n = count(r);
          return (
            <button key={r} type="button" className={`gp-role ${role === r ? 'on' : ''}`} onClick={() => setRole(role === r ? null : r)}>
              {r}
              {n > 0 && <small>✓{n > 1 ? n : ''}</small>}
            </button>
          );
        })}
        {!more ? (
          <button type="button" className="gp-role" onClick={() => setMore(true)}>
            Más…
          </button>
        ) : (
          <button type="button" className="gp-role" onClick={() => setOther(true)}>
            Otro familiar
          </button>
        )}
      </div>
      {role && (
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <input ref={input} className="input grow" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder={`Nombre de tu ${role.toLowerCase()}`} />
          <button className="btn primary" disabled={!name.trim()} onClick={add}>
            Agregar
          </button>
        </div>
      )}
      {other && <PersonSheet preset={{ circle: 'familia' }} onClose={() => setOther(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Hoy hablaste con… (también sirve para la pantalla Hoy)
// ---------------------------------------------------------------------------------------------

export function PeopleTodayCard({ onLog }: { onLog?: () => void }) {
  const { state, byId } = useGame();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ids = state.npcs.contactedToday;
  const bdays = state.npcs.birthdays.filter((b) => b.inDays === 0);
  const log = onLog ?? (() => setOpen(true));
  return (
    <div className="card">
      <div className="card-head">
        <h2>Hoy hablaste con…</h2>
        <button className="btn sm primary" onClick={log}>
          <Icon name="plus" /> Registrar
        </button>
      </div>
      {ids.length ? (
        <div className="gp-today">
          {ids.map((id) => {
            const e = byId.get(id) as Entity<NpcData> | undefined;
            const st = state.npcs.npcs[id];
            if (!e || !st) return null;
            return (
              <button key={id} className="gp-today-item" onClick={() => nav(`/npcs/${id}`)}>
                <PersonAvatar name={e.data.name} level={st.level} progress={st.next?.progress ?? 1} size={46} />
                <small>{e.data.name}</small>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          Todavía nadie. Registra con quién hablaste o convivas hoy: así ves qué relaciones se fortalecen.
        </p>
      )}
      {bdays.map((b) => {
        const e = byId.get(b.npcId) as Entity<NpcData> | undefined;
        if (!e) return null;
        return (
          <button key={b.npcId} className="btn block" style={{ marginTop: 10 }} onClick={() => nav(`/npcs/${b.npcId}`)}>
            <Icon name="cake" /> Hoy cumple {e.data.name}
            {b.turns ? ` (${b.turns})` : ''}
          </button>
        );
      })}
      {open && <LogSheet onClose={() => setOpen(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Aviso global: nivel de cercanía nuevo
// ---------------------------------------------------------------------------------------------

/** Muestra un aviso cuando un registro tuyo sube el nivel de cercanía con alguien (no al abrir la app). */
export function PeopleWatcher() {
  const { state, store, byId } = useGame();
  const seen = useRef<Set<string> | null>(null);
  const [items, setItems] = useState<{ id: string; title: string; sub: string }[]>([]);
  useEffect(() => {
    if (!store.ready) return;
    const keys = new Set(state.npcs.levelUps.map((u) => `${u.npcId}:${u.level}`));
    const prev = seen.current;
    seen.current = keys;
    if (!prev || Date.now() - store.lastLocalAction > 4500) return;
    const fresh = state.npcs.levelUps.filter((u) => !prev.has(`${u.npcId}:${u.level}`) && state.npcs.npcs[u.npcId]);
    if (!fresh.length) return;
    const top = fresh.reduce((a, b) => (b.level > a.level ? b : a));
    const e = byId.get(top.npcId) as Entity<NpcData> | undefined;
    const st = state.npcs.npcs[top.npcId];
    if (!e || !st) return;
    const levelName = relationLevelName(st.track, top.level, !!roleInfo(st.role)?.fem);
    const id = `${top.npcId}:${top.level}:${Date.now()}`;
    const verb = st.track === 'familia' ? `Tu relación con ${e.data.name} ahora es` : `${e.data.name} ahora es`;
    setItems((xs) => [...xs, { id, title: `${verb} ${levelName}`, sub: `Nivel ${top.level} de cercanía · +${top.xp} XP Relaciones` }]);
    sfx.achievement();
    haptic([20, 40, 20]);
    window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4600);
  }, [state, store.ready, store.lastLocalAction, byId]);
  if (!items.length) return null;
  return (
    <div className="gp-banners" aria-live="polite">
      {items.map((b) => (
        <div key={b.id} className="gp-banner">
          <Icon name="handshake" width={26} height={26} style={{ color: 'var(--gold)', flex: 'none' }} />
          <div className="grow">
            <div className="gp-banner-eye">Cercanía</div>
            <div className="gp-banner-title">{b.title}</div>
            <div className="gp-banner-sub">{b.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
