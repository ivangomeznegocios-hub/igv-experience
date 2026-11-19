import { useState } from 'react';
import { GAME_CONFIG, NPC_TYPES, type Entity, type GuildData, type NpcData, type NpcType } from '@igv/core';
import { addEvent, deleteEntity, saveEntity, useGame } from '../data/store';
import { daysAgo, newId } from '../lib/time';
import { Badge, Empty, Field, PageHeader, Sheet, Tabs, confirmAction, toast } from '../ui/kit';
import { Icon } from '../ui/icons';

const TYPE_LABEL: Record<NpcType, string> = { party: 'Party', aliado: 'Aliado', mentor: 'Mentor', cliente: 'Cliente', rival: 'Rival' };
const TYPE_TONE: Record<NpcType, string> = { party: 'gold', aliado: 'green', mentor: 'violet', cliente: 'teal', rival: 'red' };

export default function Npcs() {
  const [tab, setTab] = useState<'npc' | 'guild'>('npc');
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="NPCs y gremios"
        eyebrow="Mundo"
        right={
          <button className="btn sm primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> Nuevo
          </button>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'npc', label: 'Personas' },
          { value: 'guild', label: 'Gremios' },
        ]}
      />
      {tab === 'npc' ? <People /> : <Guilds />}
      {creating && (tab === 'npc' ? <NpcForm onClose={() => setCreating(false)} /> : <GuildForm onClose={() => setCreating(false)} />)}
    </>
  );
}

function Hearts({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <span className="hearts" aria-label={`Relación ${value} de 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} className={n <= value ? 'on' : ''} disabled={!onChange} onClick={() => onChange?.(n === value ? n - 1 : n)} aria-label={`${n}`}>
          <Icon name="heart" fill={n <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </span>
  );
}

function People() {
  const { list, state, byId } = useGame();
  const npcs = list<NpcData>('npcs', 'npc');
  const [filter, setFilter] = useState<'all' | NpcType>('all');
  const [edit, setEdit] = useState<Entity<NpcData> | null>(null);
  const [talk, setTalk] = useState<Entity<NpcData> | null>(null);
  const shown = npcs
    .filter((n) => filter === 'all' || n.data.npcType === filter)
    .sort((a, b) => Number(!!state.npcs.npcs[b.id]?.overdue) - Number(!!state.npcs.npcs[a.id]?.overdue) || Number(b.data.key) - Number(a.data.key));
  return (
    <>
      <div className="tabs">
        {(['all', ...NPC_TYPES] as const).map((t) => (
          <button key={t} className={filter === t ? 'on' : ''} onClick={() => setFilter(t)}>
            {t === 'all' ? 'Todos' : TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      {shown.length === 0 && <Empty>Agrega a las personas clave de tu historia: tu party, aliados, mentores, clientes y rivales.</Empty>}
      {shown.map((n) => {
        const st = state.npcs.npcs[n.id];
        const guild = n.data.guildId ? (byId.get(n.data.guildId)?.data as GuildData | undefined) : undefined;
        return (
          <div key={n.id} className="card" style={st?.overdue ? { borderColor: 'var(--flame)' } : undefined}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <div className="row wrap" style={{ gap: 6 }}>
                  <b style={{ fontSize: 16 }}>{n.data.name}</b>
                  {n.data.key && (
                    <span title="Clave" className="gold">
                      <Icon name="star" width={14} fill="currentColor" />
                    </span>
                  )}
                </div>
                <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                  <Badge tone={TYPE_TONE[n.data.npcType]}>{TYPE_LABEL[n.data.npcType]}</Badge>
                  {guild && <Badge>{guild.name}</Badge>}
                </div>
              </div>
              <button className="btn icon ghost" aria-label="Editar" onClick={() => setEdit(n)}>
                <Icon name="edit" />
              </button>
            </div>
            <div className="row between" style={{ marginTop: 8 }}>
              <Hearts value={n.data.relation} onChange={(relation) => saveEntity({ ...n, data: { ...n.data, relation } })} />
              <span className={`small ${st?.overdue ? 'flame' : 'muted'}`}>Última: {daysAgo(st?.daysSince ?? null)}</span>
            </div>
            {n.data.notes && <div className="tiny muted" style={{ marginTop: 6 }}>{n.data.notes}</div>}
            <button className="btn sm block" style={{ marginTop: 10 }} onClick={() => setTalk(n)}>
              <Icon name="chat" /> Registrar interacción
            </button>
          </div>
        );
      })}
      <p className="tiny muted">Si alguien clave pasa {GAME_CONFIG.npc.keyContactDays} días sin contacto, aparece en Hoy la misión chica "Escribirle".</p>
      {edit && <NpcForm initial={edit} onClose={() => setEdit(null)} />}
      {talk && <TalkSheet npc={talk} onClose={() => setTalk(null)} />}
    </>
  );
}

function TalkSheet({ npc, onClose }: { npc: Entity<NpcData>; onClose: () => void }) {
  const { state } = useGame();
  const [note, setNote] = useState('');
  const [date, setDate] = useState(state.today);
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Interacción con ${npc.data.name}`}
      actions={
        <button
          className="btn primary"
          onClick={() => {
            addEvent('npc.interaction', { npcId: npc.id, note: note.trim() || undefined }, { localDate: date });
            toast('Interacción registrada');
            onClose();
          }}
        >
          Guardar
        </button>
      }
    >
      <Field label="Fecha">
        <input className="input" type="date" value={date} max={state.today} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Nota (opcional)">
        <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Sheet>
  );
}

function NpcForm({ initial, onClose }: { initial?: Entity<NpcData>; onClose: () => void }) {
  const { list, state } = useGame();
  const guilds = list<GuildData>('npcs', 'guild');
  const [d, setD] = useState<NpcData>(initial?.data ?? { name: '', npcType: 'aliado', relation: 3, key: false, guildId: null, notes: '', lastContact: state.today });
  const up = (p: Partial<NpcData>) => setD((x) => ({ ...x, ...p }));
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Editar NPC' : 'Nuevo NPC'}
      actions={
        <>
          {initial && (
            <button className="btn ghost danger" onClick={() => confirmAction('¿Borrar esta ficha?') && (deleteEntity(initial.id), onClose())}>
              Borrar
            </button>
          )}
          <button
            className="btn primary"
            disabled={!d.name.trim()}
            onClick={() => {
              saveEntity({ id: initial?.id ?? `npc-${newId().slice(0, 8)}`, module: 'npcs', kind: 'npc', data: d });
              onClose();
            }}
          >
            Guardar
          </button>
        </>
      }
    >
      <Field label="Nombre">
        <input className="input" value={d.name} onChange={(e) => up({ name: e.target.value })} />
      </Field>
      <div className="grid2">
        <Field label="Tipo">
          <select className="input" value={d.npcType} onChange={(e) => up({ npcType: e.target.value as NpcType })}>
            {NPC_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Gremio">
          <select className="input" value={d.guildId ?? ''} onChange={(e) => up({ guildId: e.target.value || null })}>
            <option value="">— Ninguno —</option>
            {guilds.map((g) => (
              <option key={g.id} value={g.id}>
                {g.data.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Relación (0 a 5)">
        <Hearts value={d.relation} onChange={(relation) => up({ relation })} />
      </Field>
      <label className="checkbox">
        <input type="checkbox" checked={d.key} onChange={(e) => up({ key: e.target.checked })} />
        Persona clave (avisar si pasan {GAME_CONFIG.npc.keyContactDays} días sin contacto)
      </label>
      {!initial && (
        <Field label="Última interacción">
          <input className="input" type="date" max={state.today} value={d.lastContact ?? ''} onChange={(e) => up({ lastContact: e.target.value || null })} />
        </Field>
      )}
      <Field label="Notas">
        <textarea className="input" value={d.notes ?? ''} onChange={(e) => up({ notes: e.target.value })} />
      </Field>
    </Sheet>
  );
}

function Guilds() {
  const { list } = useGame();
  const guilds = list<GuildData>('npcs', 'guild');
  const npcs = list<NpcData>('npcs', 'npc');
  const [edit, setEdit] = useState<Entity<GuildData> | null>(null);
  if (!guilds.length) return <Empty>Los gremios agrupan personas: tu equipo, una comunidad, un club.</Empty>;
  return (
    <>
      {guilds.map((g) => {
        const members = npcs.filter((n) => n.data.guildId === g.id);
        return (
          <div key={g.id} className="card">
            <div className="card-head">
              <h2>{g.data.name}</h2>
              <button className="btn icon ghost" aria-label="Editar" onClick={() => setEdit(g)}>
                <Icon name="edit" />
              </button>
            </div>
            {g.data.description && <div className="small muted">{g.data.description}</div>}
            <div className="row wrap" style={{ gap: 4, marginTop: 8 }}>
              {members.length ? members.map((m) => <Badge key={m.id}>{m.data.name}</Badge>) : <span className="tiny faint">Sin miembros</span>}
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
      title={initial ? 'Editar gremio' : 'Nuevo gremio'}
      actions={
        <>
          {initial && (
            <button className="btn ghost danger" onClick={() => confirmAction('¿Borrar este gremio?') && (deleteEntity(initial.id), onClose())}>
              Borrar
            </button>
          )}
          <button
            className="btn primary"
            disabled={!d.name.trim()}
            onClick={() => {
              saveEntity({ id: initial?.id ?? `guild-${newId().slice(0, 8)}`, module: 'npcs', kind: 'guild', data: d });
              onClose();
            }}
          >
            Guardar
          </button>
        </>
      }
    >
      <Field label="Nombre">
        <input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
      </Field>
      <Field label="Descripción">
        <textarea className="input" value={d.description ?? ''} onChange={(e) => setD({ ...d, description: e.target.value })} />
      </Field>
    </Sheet>
  );
}
