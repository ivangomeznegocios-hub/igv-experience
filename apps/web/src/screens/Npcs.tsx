import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CIRCLE_NAMES,
  GAME_CONFIG,
  PEOPLE_CIRCLES,
  RELATION_LEVEL_NAMES,
  mostSeen,
  type Entity,
  type GuildData,
  type NpcData,
  type PeopleCircle,
  type PlaceData,
} from '@igv/core';
import { deleteEntity, saveEntity, useGame } from '../data/store';
import { fmtDate, newId } from '../lib/time';
import { BarChart } from '../ui/charts';
import { Badge, Bar, Collapse, Empty, Field, PageHeader, Sheet, Tabs, confirmAction, TextInput, TextArea } from '../ui/kit';
import { Icon } from '../ui/icons';
import { FamilyBuilder, LogSheet, PeopleTodayCard, PersonAvatar, PersonRow, PersonSheet, TempDot, byCloseness, lastContactLabel } from '../ui/people';

type Tab = 'people' | 'stats' | 'groups';
const TAB_KEY = 'igv-gente-tab';

/** Mi gente: personas de toda tu vida, su cercanía (nivel que se gana) y su temperatura (que se enfría). */
export default function Npcs() {
  const [tab, setTabState] = useState<Tab>(() => {
    try {
      return (sessionStorage.getItem(TAB_KEY) as Tab) || 'people';
    } catch {
      return 'people';
    }
  });
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      sessionStorage.setItem(TAB_KEY, t);
    } catch {
      /* sin almacenamiento */
    }
  };
  const [creating, setCreating] = useState(false);
  const [log, setLog] = useState<string[] | null>(null);
  return (
    <>
      <PageHeader
        title="Mi gente"
        eyebrow="Personas y círculos"
        right={
          <button className="btn sm primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> {tab === 'groups' ? 'Grupo' : 'Persona'}
          </button>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'people', label: 'Personas' },
          { value: 'stats', label: 'Estadísticas' },
          { value: 'groups', label: 'Grupos' },
        ]}
      />
      {tab === 'people' && <People onLog={(ids) => setLog(ids)} onNew={() => setCreating(true)} />}
      {tab === 'stats' && <Stats />}
      {tab === 'groups' && <Guilds />}
      {creating && (tab === 'groups' ? <GuildForm onClose={() => setCreating(false)} /> : <PersonSheet onClose={() => setCreating(false)} />)}
      {log && <LogSheet preselect={log} onClose={() => setLog(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------------------------

function People({ onLog, onNew }: { onLog: (ids: string[]) => void; onNew: () => void }) {
  const { state, list, byId } = useGame();
  const all = list<NpcData>('npcs', 'npc');
  const [q, setQ] = useState('');
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const query = norm(q.trim());
  const people = (query ? all.filter((p) => norm(`${p.data.name} ${p.data.role ?? ''} ${p.data.metWhere ?? ''}`).includes(query)) : all).filter((p) => state.npcs.npcs[p.id]);
  const sorted = [...people].sort(byCloseness(state));
  const family = sorted.filter((p) => ['familia', 'pareja'].includes(state.npcs.npcs[p.id].circle));
  const logOne = (id: string) => onLog([id]);

  // Por atender: personas que se enfriaron (con frecuencia esperada), de la más urgente a la menos.
  const attention = all
    .filter((p) => state.npcs.npcs[p.id]?.temperature === 'fria' || state.npcs.npcs[p.id]?.overdue)
    .sort((a, b) => {
      const x = state.npcs.npcs[a.id];
      const y = state.npcs.npcs[b.id];
      const r = (s: typeof x) => (s.daysSince ?? 0) / Math.max(1, s.cadenceDays || GAME_CONFIG.npc.keyContactDays);
      return Number(!!b.data.key) - Number(!!a.data.key) || r(y) - r(x);
    })
    .slice(0, 4);
  const birthdays = state.npcs.birthdays.filter((b) => byId.has(b.npcId));

  if (!all.length)
    return (
      <>
        <FamilyBuilder />
        <div className="card">
          <h2>Tu gente, como en un juego</h2>
          <p className="small muted" style={{ marginTop: 0 }}>
            Cada persona tiene un <b>nivel de cercanía</b> del 1 al 5 que se gana con días de contacto, convivencias en persona y constancia (diez mensajes en un día no hacen a nadie tu amigo). La <b>temperatura</b> te dice quién se está enfriando.
          </p>
          <button className="btn block" onClick={onNew}>
            <Icon name="plus" /> Agregar a alguien más
          </button>
        </div>
      </>
    );

  return (
    <>
      {!query && <PeopleTodayCard onLog={() => onLog([])} />}
      {all.length >= 6 && (
        <TextInput className="input" style={{ marginBottom: 12 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar entre ${all.length} personas`} aria-label="Buscar persona" />
      )}

      {!query && attention.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Por atender</h2>
            <span className="tiny muted">toca buscarlas</span>
          </div>
          <div className="gp-list">
            {attention.map((p) => (
              <PersonRow key={p.id} p={p} onLog={logOne} />
            ))}
          </div>
        </div>
      )}

      {!query && birthdays.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Cumpleaños</h2>
            <Icon name="cake" width={20} className="gold" />
          </div>
          {birthdays.map((b) => {
            const e = byId.get(b.npcId) as Entity<NpcData>;
            return (
              <Link key={b.npcId} to={`/npcs/${b.npcId}`} className="item" style={{ color: 'inherit', textDecoration: 'none' }}>
                <div className="grow">
                  <div className="item-title">{e.data.name}</div>
                  <div className="tiny muted">
                    {fmtDate(b.date)}
                    {b.turns ? ` · cumple ${b.turns}` : ''}
                  </div>
                </div>
                <Badge tone={b.inDays === 0 ? 'gold' : b.inDays <= 7 ? 'flame' : undefined}>{b.inDays === 0 ? 'Hoy' : b.inDays === 1 ? 'Mañana' : `En ${b.inDays} días`}</Badge>
              </Link>
            );
          })}
        </div>
      )}

      {(family.length > 0 || !query) && (
        <div className="card">
          <div className="card-head">
            <h2>Familia</h2>
            <span className="tiny muted">{family.length ? `${family.length} ${family.length === 1 ? 'persona' : 'personas'}` : ''}</span>
          </div>
          {family.length > 0 && (
            <div className="gp-list">
              {family.map((p) => (
                <PersonRow key={p.id} p={p} onLog={logOne} />
              ))}
            </div>
          )}
          {!query && (family.length ? <AddFamily /> : <FamilyBuilder compact />)}
        </div>
      )}

      {PEOPLE_CIRCLES.filter((c) => c !== 'familia' && c !== 'pareja').map((c) => {
        const inC = sorted.filter((p) => state.npcs.npcs[p.id].circle === c);
        if (!inC.length) return null;
        return <CircleSection key={c} circle={c} people={inC} onLog={logOne} />;
      })}
      {query && !people.length && <Empty>Nadie con «{q.trim()}».</Empty>}

      {!query && (
        <Collapse title="¿Cómo sube la cercanía?">
          <HowItWorks />
        </Collapse>
      )}
    </>
  );
}

function AddFamily() {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => setOpen(true)}>
        <Icon name="plus" /> Agregar familiar
      </button>
    );
  return (
    <div style={{ marginTop: 10 }}>
      <FamilyBuilder compact />
    </div>
  );
}

function CircleSection({ circle, people, onLog }: { circle: PeopleCircle; people: Entity<NpcData>[]; onLog: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const LIMIT = 8;
  const shown = all ? people : people.slice(0, LIMIT);
  return (
    <>
      <div className="section-title">
        {CIRCLE_NAMES[circle]} · {people.length}
      </div>
      <div className="card">
        <div className="gp-list">
          {shown.map((p) => (
            <PersonRow key={p.id} p={p} onLog={onLog} />
          ))}
        </div>
        {people.length > LIMIT && (
          <button className="btn sm ghost block" onClick={() => setAll((x) => !x)}>
            {all ? 'Ver menos' : `Ver ${people.length - LIMIT} más`}
          </button>
        )}
      </div>
    </>
  );
}

function HowItWorks() {
  const gates = GAME_CONFIG.gente.levels;
  return (
    <div className="small">
      <p className="muted" style={{ marginTop: 0 }}>
        El nivel se <b>gana</b> y nunca baja. Cuenta días distintos (diez mensajes el mismo día = un día), convivencias en persona y constancia en semanas y meses distintos. Cada nivel nuevo da XP de Relaciones.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Nivel</th>
            <th className="r">Días</th>
            <th className="r">En persona</th>
            <th className="r">Semanas</th>
            <th className="r">Meses</th>
            <th className="r">XP</th>
          </tr>
        </thead>
        <tbody>
          {gates.map((g) => (
            <tr key={g.level}>
              <td>
                {g.level} · {RELATION_LEVEL_NAMES.social[g.level - 1][0]}
              </td>
              <td className="r num">{g.days}</td>
              <td className="r num">{g.inPerson}</td>
              <td className="r num">{g.weeks}</td>
              <td className="r num">{g.months}</td>
              <td className="r num">+{g.xp}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tiny muted">
        Nombres por círculo — Familia: {RELATION_LEVEL_NAMES.familia.map((n) => n[0]).join(' → ')}. Trabajo y clientes: {RELATION_LEVEL_NAMES.profesional.map((n) => n[0]).join(' → ')}.
      </p>
      <p className="tiny muted" style={{ marginBottom: 0 }}>
        <TempDot t="calida" /> Cálida · <TempDot t="tibia" /> Tibia · <TempDot t="fria" /> Fría: días sin contacto contra la frecuencia que esperas (pareja diario, hijos cada 2 días, papás cada semana, amigos cada mes). Puedes cambiarla en cada ficha.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Estadísticas
// ---------------------------------------------------------------------------------------------

function Stats() {
  const { state, byId, list } = useGame();
  const people = list<NpcData>('npcs', 'npc').filter((p) => state.npcs.npcs[p.id]);
  const st = state.npcs;
  const name = (id: string) => (byId.get(id)?.data as NpcData | undefined)?.name ?? '—';
  const week = st.weeks.at(-1);
  const month = st.months.at(-1);
  const avg = st.weeks.length ? st.weeks.reduce((s, w) => s + w.contacts, 0) / st.weeks.length : 0;
  const top = useMemo(() => mostSeen(st, state.today, 90, 6), [st, state.today]);
  const warming = people.filter((p) => st.npcs[p.id].trend === 'sube');
  const cooling = people.filter((p) => st.npcs[p.id].trend === 'baja' || st.npcs[p.id].temperature === 'fria');
  const levels = [1, 2, 3, 4, 5].map((l) => people.filter((p) => st.npcs[p.id].level === l).length);
  const places = Object.entries(st.places)
    .map(([placeId, ps]) => ({ placeId, ps, total: ps.reduce((s, x) => s + x.days, 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);
  const placeName = (id: string) => (byId.get(id)?.data as PlaceData | undefined)?.name ?? 'Lugar';
  const ups = st.levelUps.filter((u) => st.npcs[u.npcId]).slice(-6).reverse();

  if (!people.length) return <Empty>Cuando registres contactos verás aquí con quién convives más, quién se acerca y quién se aleja.</Empty>;
  return (
    <>
      <div className="gp-tiles">
        <div className="gp-tile">
          <b>{st.contactedToday.length}</b>
          <span>hoy</span>
        </div>
        <div className="gp-tile">
          <b>{week?.contacts ?? 0}</b>
          <span>esta semana · {week?.people ?? 0} pers.</span>
        </div>
        <div className="gp-tile">
          <b>{month?.contacts ?? 0}</b>
          <span>este mes · {month?.people ?? 0} pers.</span>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Contactos por semana</h2>
          <span className="tiny muted">promedio {avg.toFixed(1)}</span>
        </div>
        <BarChart data={st.weeks.map((w) => ({ label: fmtDate(w.key), value: w.contacts }))} color="var(--teal)" />
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          Un contacto = una persona en un día (aunque hayan hablado varias veces).
        </p>
      </div>

      {top.length > 0 && (
        <div className="card">
          <h2>Con quién más convives</h2>
          <p className="tiny muted" style={{ marginTop: -4 }}>
            Días con contacto, últimos 90 días
          </p>
          <div className="stack">
            {top.map((t) => (
              <Link key={t.npcId} to={`/npcs/${t.npcId}`} style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
                <Bar value={t.days} max={top[0].days} tone="teal" label={<><span>{name(t.npcId)}</span><span className="num">{t.days}</span></>} />
              </Link>
            ))}
          </div>
        </div>
      )}

      {(warming.length > 0 || cooling.length > 0) && (
        <div className="card">
          <h2>Quién se acerca y quién se aleja</h2>
          <p className="tiny muted" style={{ marginTop: -4 }}>
            Últimos {GAME_CONFIG.gente.trendDays} días contra los {GAME_CONFIG.gente.trendDays} anteriores, y quién ya se enfrió
          </p>
          {warming.length > 0 && <PeopleChips icon="warming" tone="green" title="Se acercan" ids={warming.map((p) => p.id)} />}
          {cooling.length > 0 && <PeopleChips icon="cooling" tone="blue" title="Se alejan o se enfriaron" ids={cooling.map((p) => p.id)} />}
        </div>
      )}

      <div className="card">
        <h2>Por círculo</h2>
        <table className="table">
          <tbody>
            {PEOPLE_CIRCLES.filter((c) => st.byCircle[c] > 0).map((c) => {
              const inC = people.filter((p) => st.npcs[p.id].circle === c);
              const warm = inC.filter((p) => st.npcs[p.id].temperature === 'calida').length;
              const avgL = inC.reduce((s, p) => s + st.npcs[p.id].level, 0) / Math.max(1, inC.length);
              return (
                <tr key={c}>
                  <td>{CIRCLE_NAMES[c]}</td>
                  <td className="r num">{st.byCircle[c]}</td>
                  <td className="r tiny muted">nivel prom. {avgL.toFixed(1)}</td>
                  <td className="r tiny muted">{warm === 1 ? '1 cálida' : `${warm} cálidas`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Cercanía</h2>
        <div className="stack">
          {levels.map((n, i) => (
            <Bar key={i} value={n} max={Math.max(1, ...levels)} label={<><span>Nivel {i + 1}</span><span><b className="num">{n}</b> {n === 1 ? 'persona' : 'personas'}</span></>} />
          ))}
        </div>
      </div>

      {places.length > 0 && (
        <div className="card">
          <h2>Lugares con tu gente</h2>
          {places.map((pl) => (
            <div key={pl.placeId} className="item" style={{ alignItems: 'flex-start' }}>
              <Icon name="pin" width={18} className="muted" />
              <div className="grow">
                <div className="item-title">{placeName(pl.placeId)}</div>
                <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                  {pl.ps.slice(0, 6).map((x) => (
                    <Badge key={x.npcId}>
                      {name(x.npcId)} ×{x.days}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {ups.length > 0 && (
        <div className="card">
          <h2>Niveles recientes</h2>
          {ups.map((u) => {
            return (
              <Link key={`${u.npcId}-${u.level}`} to={`/npcs/${u.npcId}`} className="item" style={{ color: 'inherit', textDecoration: 'none' }}>
                <PersonAvatar name={name(u.npcId)} level={u.level} progress={1} size={36} />
                <div className="grow">
                  <div className="item-title">{name(u.npcId)}</div>
                  <div className="tiny muted">
                    Nivel {u.level} · {fmtDate(u.date, true)}
                  </div>
                </div>
                <Badge tone="gold">+{u.xp} XP</Badge>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

function PeopleChips({ icon, tone, title, ids }: { icon: string; tone: string; title: string; ids: string[] }) {
  const { byId, state } = useGame();
  return (
    <div style={{ marginTop: 8 }}>
      <div className={`small ${tone}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 6 }}>
        <Icon name={icon} width={16} /> {title}
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        {ids.map((id) => {
          const e = byId.get(id) as Entity<NpcData> | undefined;
          const st = state.npcs.npcs[id];
          if (!e || !st) return null;
          return (
            <Link key={id} to={`/npcs/${id}`} className="gp-person-chip" title={lastContactLabel(st, state.today)}>
              <PersonAvatar name={e.data.name} level={st.level} progress={st.next?.progress ?? 1} size={26} />
              {e.data.name}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Grupos (equipo, generación, club…)
// ---------------------------------------------------------------------------------------------

function Guilds() {
  const { list } = useGame();
  const guilds = list<GuildData>('npcs', 'guild');
  const npcs = list<NpcData>('npcs', 'npc');
  const [edit, setEdit] = useState<Entity<GuildData> | null>(null);
  if (!guilds.length) return <Empty>Los grupos juntan personas de distintos círculos: tu equipo de fútbol, tu generación de la prepa, un club.</Empty>;
  return (
    <>
      {guilds.map((g) => {
        const members = npcs.filter((n) => n.data.guildId === g.id);
        return (
          <div key={g.id} className="card">
            <div className="card-head">
              <h2>{g.data.name}</h2>
              <button className="btn icon ghost" aria-label="Editar grupo" onClick={() => setEdit(g)}>
                <Icon name="edit" />
              </button>
            </div>
            {g.data.description && <div className="small muted">{g.data.description}</div>}
            <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
              {members.length ? (
                members.map((m) => (
                  <Link key={m.id} to={`/npcs/${m.id}`} className="gp-person-chip" style={{ paddingLeft: 10 }}>
                    {m.data.name}
                  </Link>
                ))
              ) : (
                <span className="tiny faint">Sin miembros. Asigna el grupo desde la ficha de cada persona.</span>
              )}
            </div>
          </div>
        );
      })}
      {edit && <GuildForm initial={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function GuildForm({ initial, onClose }: { initial?: Entity<GuildData>; onClose: () => void }) {
  const [d, setD] = useState<GuildData>(initial?.data ?? { name: '', description: '' });
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Editar grupo' : 'Nuevo grupo'}
      actions={
        <>
          {initial && (
            <button className="btn ghost danger" onClick={() => confirmAction('¿Borrar este grupo? Las personas se quedan.') && (deleteEntity(initial.id), onClose())}>
              Borrar
            </button>
          )}
          <button
            className="btn primary"
            disabled={!d.name.trim()}
            onClick={() => {
              saveEntity({ id: initial?.id ?? `guild-${newId().slice(0, 8)}`, module: 'npcs', kind: 'guild', data: { ...d, name: d.name.trim() } });
              onClose();
            }}
          >
            Guardar
          </button>
        </>
      }
    >
      <Field label="Nombre">
        <TextInput className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Generación prepa, equipo de fut…" />
      </Field>
      <Field label="Descripción">
        <TextArea className="input" value={d.description ?? ''} onChange={(e) => setD({ ...d, description: e.target.value })} />
      </Field>
    </Sheet>
  );
}
