import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  CHANNEL_NAMES,
  CIRCLE_NAMES,
  GAME_CONFIG,
  TEMPERATURE_NAMES,
  cadenceFor,
  knownForText,
  relationLevelName,
  roleInfo,
  startLevelOf,
  type ContactChannel,
  type Entity,
  type GateKey,
  type GuildData,
  type NpcData,
  type PlaceData,
} from '@igv/core';
import { restoreEvent, saveEntity, useGame, voidEvent } from '../data/store';
import { fmtDate, fmtWeekday } from '../lib/time';
import { Bar, Chips, Empty, PageHeader, confirmAction, undoToast } from '../ui/kit';
import { Icon } from '../ui/icons';
import { CADENCE_OPTIONS, CHANNEL_ICON, LogSheet, PersonAvatar, PersonSheet, TempDot, freqLabel, lastContactLabel, logContacts } from '../ui/people';

const GATE_LABEL: Record<GateKey, string> = { days: 'Días con contacto', inPerson: 'En persona', weeks: 'Semanas distintas', months: 'Meses distintos' };

/** Ficha de una persona: cercanía (escalera y requisitos), temperatura, datos, lugares e historial. */
export default function Persona() {
  const { id } = useParams();
  const { state, byId } = useGame();
  const [edit, setEdit] = useState(false);
  const [log, setLog] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const ent = id ? (byId.get(id) as Entity<NpcData> | undefined) : undefined;
  const st = ent ? state.npcs.npcs[ent.id] : undefined;
  if (!ent || ent.module !== 'npcs' || ent.kind !== 'npc' || !st)
    return (
      <>
        <PageHeader title="Persona" />
        <Empty>
          No encontré a esta persona. <Link to="/npcs">Volver a Mi gente</Link>
        </Empty>
      </>
    );
  const d = ent.data;
  const today = state.today;
  const fem = !!roleInfo(st.role)?.fem;
  const placeName = (pid: string | null | undefined) => (pid ? ((byId.get(pid)?.data as PlaceData | undefined)?.name ?? 'Lugar') : '');
  const guild = d.guildId ? (byId.get(d.guildId)?.data as GuildData | undefined) : undefined;
  const contacts = state.npcs.contacts.filter((c) => c.npcId === ent.id).reverse();
  const shown = showAll ? contacts : contacts.slice(0, 12);
  const next = st.next;
  const nextGate = next ? GAME_CONFIG.gente.levels.find((g) => g.level === next.level) : null;
  const autoCadence = cadenceFor({ ...d, cadenceDays: undefined }, GAME_CONFIG);
  const known = knownForText(st.knownSince, today);
  const phoneDigits = (d.phone ?? '').replace(/\D/g, '');
  // Días en que subió el nivel que se ve (los niveles ganados por debajo del punto de partida no lo cambian).
  const start = startLevelOf(d);
  const levelUpDays = new Set(Object.entries(st.levelDates).filter(([lv]) => Number(lv) > start).map(([, dt]) => dt));

  const quick = (channel: ContactChannel) => logContacts([ent.id], [d.name], { channel, date: today });
  const setCadence = (v: number) => saveEntity<NpcData>({ ...ent, data: { ...d, cadenceDays: v === -1 ? null : v } });
  const undoContact = (eventId: string) => {
    if (!confirmAction('¿Anular este contacto? Se recalcula su nivel.')) return;
    voidEvent(eventId);
    undoToast('Contacto anulado', () => restoreEvent(eventId));
  };

  return (
    <>
      <div className="row between" style={{ margin: '0 0 6px' }}>
        <Link to="/npcs" className="btn sm ghost" style={{ paddingLeft: 4 }}>
          <Icon name="left" /> Mi gente
        </Link>
        <button className="btn sm" onClick={() => setEdit(true)}>
          <Icon name="edit" /> Editar
        </button>
      </div>

      {/* Cercanía */}
      <div className="card">
        <div className="gp-hero">
          <PersonAvatar name={d.name} level={st.level} progress={next?.progress ?? 1} size={72} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="eyebrow">
              {st.role ? `${st.role} · ` : ''}
              {CIRCLE_NAMES[st.circle]}
            </div>
            <h1 className="row" style={{ gap: 6 }}>
              <span className="ellipsis">{d.name}</span>
              {d.key && <Icon name="star" width={16} fill="currentColor" className="gold" aria-label="Persona clave" />}
            </h1>
            <div className="small" style={{ marginTop: 2 }}>
              Nivel {st.level} · <b>{st.levelName}</b>
            </div>
          </div>
        </div>
        <div className="gp-ladder" aria-label="Escalera de cercanía">
          {[1, 2, 3, 4, 5].map((l) => (
            <div key={l} className={`gp-step ${l <= st.level ? 'on' : ''} ${l === st.level ? 'cur' : ''}`} title={st.levelDates[l] ? `Ganado el ${fmtDate(st.levelDates[l], true)}` : undefined}>
              <b>{l}</b>
              <span>{relationLevelName(st.track, l, fem)}</span>
            </div>
          ))}
        </div>
        {next ? (
          <>
            <Bar value={next.progress} max={1} size="lg" label={<><span>{next.hint}</span><span>+{nextGate?.xp ?? 0} XP</span></>} />
            <div className="gp-gates">
              {next.gaps.map((g) => (
                <div key={g.key} className={`gp-gate ${g.missing === 0 ? 'ok' : ''}`}>
                  <div className="tiny muted">{GATE_LABEL[g.key]}</div>
                  <b>{g.have}</b>
                  <span className="tiny muted"> / {g.need}</span>
                  <Bar value={g.have} max={g.need} size="sm" tone={g.missing === 0 ? 'green' : undefined} />
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="small green" style={{ margin: 0 }}>
            Nivel máximo de cercanía.
          </p>
        )}
        {st.level > st.earnedLevel && (
          <p className="tiny muted" style={{ marginBottom: 0 }}>
            Partiste del nivel {st.level} (lo que ya existía). Con contactos llevas el nivel {st.earnedLevel}; la XP llega al ganar cada nivel.
          </p>
        )}
      </div>

      {/* Registrar en un toque */}
      <div className="gp-quick" style={{ marginBottom: 12 }}>
        {(['persona', 'llamada', 'mensaje'] as ContactChannel[]).map((c) => (
          <button key={c} onClick={() => quick(c)}>
            <Icon name={CHANNEL_ICON[c]} />
            {c === 'persona' ? 'Nos vimos' : CHANNEL_NAMES[c]}
          </button>
        ))}
        <button onClick={() => setLog(true)}>
          <Icon name="plus" />
          Más…
        </button>
      </div>

      {/* Temperatura */}
      <div className="card">
        <div className="card-head">
          <h2 className="row" style={{ gap: 8 }}>
            <TempDot t={st.temperature} />
            <span className={`gp-temp-text ${st.temperature ?? ''}`}>{st.temperature ? TEMPERATURE_NAMES[st.temperature] : 'Sin meta'}</span>
          </h2>
          <span className="small muted">{lastContactLabel(st, today)}</span>
        </div>
        <div className="row wrap small muted" style={{ gap: 12, marginBottom: 10 }}>
          <span>
            Últimos {GAME_CONFIG.gente.trendDays} días: <b className="num">{st.recent}</b>
          </span>
          <span>
            Anteriores: <b className="num">{st.previous}</b>
          </span>
          {st.trend !== 'estable' && (
            <span className={st.trend === 'sube' ? 'green' : 'flame'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Icon name={st.trend === 'sube' ? 'warming' : 'cooling'} width={15} />
              {st.trend === 'sube' ? 'Se están acercando' : 'Se están alejando'}
            </span>
          )}
        </div>
        <div className="tiny muted" style={{ marginBottom: 6 }}>
          ¿Cada cuánto quieres verla o hablarle?
        </div>
        <Chips
          value={d.cadenceDays ?? -1}
          onChange={setCadence}
          options={[{ value: -1, label: `Auto (${freqLabel(autoCadence).toLowerCase()})` }, ...CADENCE_OPTIONS.map((n) => ({ value: n, label: freqLabel(n) }))]}
        />
      </div>

      {/* Datos */}
      <div className="card">
        <h2>Datos</h2>
        <Detail icon="cake" label="Cumpleaños">
          {st.birthday ? (
            <>
              {fmtDate(st.birthday.date)} · {st.birthday.inDays === 0 ? <b className="gold">¡hoy!</b> : st.birthday.inDays === 1 ? 'mañana' : `en ${st.birthday.inDays} días`}
              {st.birthday.turns ? ` · cumple ${st.birthday.turns}` : ''}
            </>
          ) : (
            <Missing onClick={() => setEdit(true)} />
          )}
        </Detail>
        <Detail icon="handshake" label="Se conocieron">
          {d.metWhere || d.metPlaceId || d.metOn ? (
            <>
              {[d.metWhere, placeName(d.metPlaceId)].filter(Boolean).join(' · ') || 'Lugar sin registrar'}
              {d.metOn ? ` · ${d.metOn}` : ''}
            </>
          ) : (
            <Missing onClick={() => setEdit(true)} />
          )}
        </Detail>
        {known && (
          <Detail icon="hourglass" label="Se conocen desde hace">
            {known}
          </Detail>
        )}
        {d.phone && (
          <Detail icon="call" label="Teléfono">
            <span className="row wrap" style={{ gap: 8 }}>
              <a href={`tel:${phoneDigits}`}>{d.phone}</a>
              {phoneDigits.length >= 10 && (
                <a href={`https://wa.me/${phoneDigits.length === 10 ? `52${phoneDigits}` : phoneDigits}`} target="_blank" rel="noreferrer">
                  WhatsApp
                </a>
              )}
            </span>
          </Detail>
        )}
        {guild && (
          <Detail icon="users" label="Grupo">
            {guild.name}
          </Detail>
        )}
        {d.notes && (
          <Detail icon="feather" label="Notas">
            <span style={{ whiteSpace: 'pre-wrap' }}>{d.notes}</span>
          </Detail>
        )}
      </div>

      {/* Números */}
      {st.interactions > 0 && (
        <div className="card">
          <h2>Juntos</h2>
          <div className="gp-tiles" style={{ marginBottom: 8 }}>
            <div className="gp-tile">
              <b>{st.counts.days}</b>
              <span>días con contacto</span>
            </div>
            <div className="gp-tile">
              <b>{st.counts.inPerson}</b>
              <span>en persona</span>
            </div>
            <div className="gp-tile">
              <b>{st.counts.months}</b>
              <span>meses distintos</span>
            </div>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            {(['persona', 'llamada', 'videollamada', 'mensaje'] as ContactChannel[])
              .filter((c) => st.byChannel[c] > 0)
              .map((c) => (
                <span key={c} className="badge">
                  {CHANNEL_NAMES[c]} ×{st.byChannel[c]}
                </span>
              ))}
            {st.byChannel.otro > 0 && <span className="badge">Sin especificar ×{st.byChannel.otro}</span>}
          </div>
          {st.places.length > 0 && (
            <>
              <div className="tiny muted" style={{ margin: '10px 0 6px' }}>
                Lugares juntos
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                {st.places.map((p) => (
                  <span key={p.placeId} className="badge">
                    <Icon name="pin" width={12} /> {placeName(p.placeId)} ×{p.days}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Historial */}
      <div className="card">
        <div className="card-head">
          <h2>Historial</h2>
          <span className="tiny muted">{st.interactions} registros</span>
        </div>
        {!contacts.length && <p className="small muted" style={{ margin: 0 }}>Sin contactos registrados. Usa los botones de arriba cuando hablen o se vean.</p>}
        {shown.map((c) => {
          const ch = c.channel;
          return (
            <div key={`${c.eventId}-${c.npcId}`} className="gp-ev">
              <span className={`gp-ev-icon ${c.inPerson ? 'persona' : ''}`}>
                <Icon name={ch ? CHANNEL_ICON[ch] : c.inPerson ? 'users' : 'chat'} />
              </span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="small" style={{ fontWeight: 650 }}>
                  {c.source === 'mission' ? 'Le escribiste (misión)' : c.source === 'place' ? 'Visita juntos' : ch ? CHANNEL_NAMES[ch] : 'Contacto'}
                  {c.placeId ? ` · ${placeName(c.placeId)}` : ''}
                </div>
                <div className="tiny muted">
                  {fmtWeekday(c.date)} {fmtDate(c.date, c.date.slice(0, 4) !== today.slice(0, 4))}
                  {levelUpDays.has(c.date) ? ' · subió de nivel' : ''}
                </div>
                {c.note && <div className="small" style={{ marginTop: 2 }}>{c.note}</div>}
              </div>
              {c.source === 'interaction' && (
                <button className="btn icon ghost" aria-label="Anular contacto" onClick={() => undoContact(c.eventId)}>
                  <Icon name="x" width={16} />
                </button>
              )}
            </div>
          );
        })}
        {contacts.length > 12 && (
          <button className="btn sm ghost block" onClick={() => setShowAll((x) => !x)}>
            {showAll ? 'Ver menos' : `Ver los ${contacts.length}`}
          </button>
        )}
      </div>

      {edit && <PersonSheet initial={ent} onClose={() => setEdit(false)} />}
      {log && <LogSheet preselect={[ent.id]} onClose={() => setLog(false)} />}
    </>
  );
}

function Detail({ icon, label, children }: { icon: string; label: string; children: ReactNode }) {
  return (
    <div className="item" style={{ alignItems: 'flex-start' }}>
      <Icon name={icon} width={18} className="muted" style={{ marginTop: 2, flex: 'none' }} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="tiny muted">{label}</div>
        <div className="small">{children}</div>
      </div>
    </div>
  );
}

function Missing({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn sm ghost" style={{ padding: '0 4px', minHeight: 24 }} onClick={onClick}>
      <Icon name="plus" width={14} /> Agregar
    </button>
  );
}
