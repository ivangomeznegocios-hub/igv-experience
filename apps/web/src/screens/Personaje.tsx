import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ATTRIBUTE_GUIDE, ATTRIBUTE_IDS, ATTRIBUTE_NAMES, GAME_CONFIG, addDays, xpSourceLabel, type AchievementData, type AttributeId, type SeasonData, type Entity } from '@igv/core';
import { addEvent, projectAsOf, useGame } from '../data/store';
import { getTheme } from '../lib/themes';
import { fmtDate, fmtNum } from '../lib/time';
import { Hero } from '../ui/Hero';
import { Bar, PageHeader, confirmAction } from '../ui/kit';
import { Avatar, topAttribute } from '../ui/Avatar';
import { Icon } from '../ui/icons';
import { updateSettings } from '../lib/actions';
import { CharacterCard } from '../ui/CharacterCard';

export default function Personaje() {
  const { state } = useGame();
  return (
    <>
      <PageHeader title="Perfil" eyebrow="Atributos" />
      <CharacterCard />
      <Hero compact />
      <AvatarCard />
      {state.attributes.rated ? <Attributes /> : <RateAttributes />}
      {state.attributes.rated && <SeasonSnapshots />}
      <XpLedger />
    </>
  );
}

function AvatarCard() {
  const { state, list } = useGame();
  const [picking, setPicking] = useState(false);
  const top = topAttribute(state.attributes.values);
  const unlocked = list<AchievementData>('achievements', 'achievement').filter((a) => state.achievements[a.id]?.unlocked);
  const chosen = state.settings.avatarBadges ?? [];
  const nextTitle = state.level.nextTitle;
  const theme = getTheme(state.settings.equipped?.skin);
  return (
    <div className="card">
      <div className="row" style={{ gap: 16 }}>
        <Avatar size={88} />
        <div className="grow small">
          <div>
            <b>Título:</b> {state.level.title}
            {nextTitle ? <span className="muted"> · evoluciona a {nextTitle.title} en NV {nextTitle.level}</span> : null}
          </div>
          <div>
            <b>Tu fuerte:</b> {ATTRIBUTE_NAMES[top]} <span className="muted">(tu atributo más alto)</span>
          </div>
          <div>
            <b>Racha:</b>{' '}
            {state.streak.current >= 7 ? (
              <span>{state.streak.current} días 🔥 (el anillo se pinta de fuego)</span>
            ) : (
              <span className="muted">{state.streak.current} días · con 7+ el anillo se pinta de fuego</span>
            )}
          </div>
          <div className="tiny muted" style={{ marginTop: 2 }}>
            El anillo marca tu avance al siguiente nivel · Estilo: {theme.name}
          </div>
          <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
            <button className="btn sm" onClick={() => setPicking((x) => !x)} disabled={!unlocked.length}>
              <Icon name="trophy" /> Insignias ({chosen.length || 'auto'})
            </button>
            <Link to="/tienda" className="btn sm ghost">
              <Icon name="sparkles" /> Estilo
            </Link>
          </div>
        </div>
      </div>
      {picking && (
        <div style={{ marginTop: 12 }}>
          <div className="tiny muted" style={{ marginBottom: 6 }}>
            Elige hasta 3 logros para lucir en tu avatar (sin elegir, se muestran los más recientes).
          </div>
          <div className="chips">
            {unlocked.map((a) => {
              const on = chosen.includes(a.id);
              return (
                <button
                  key={a.id}
                  className={`chip ${on ? 'on' : ''}`}
                  onClick={() => {
                    const next = on ? chosen.filter((x) => x !== a.id) : [...chosen, a.id].slice(-3);
                    updateSettings(state.settings, { avatarBadges: next });
                  }}
                >
                  <Icon name={a.data.icon} width={14} /> {a.data.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Attributes() {
  const { state } = useGame();
  const v = state.attributes.values;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Atributos</h2>
        <span className="tiny muted">Cada {GAME_CONFIG.attributes.xpPerPoint} XP = +1 punto</span>
      </div>
      {ATTRIBUTE_IDS.map((a) => (
        <div key={a} style={{ marginBottom: 14 }}>
          <div className="row between" style={{ marginBottom: 5 }}>
            <b>{ATTRIBUTE_NAMES[a]}</b>
            <span className="num">
              <b style={{ fontSize: 18 }}>{v[a].value}</b>
              <span className="muted small"> / {GAME_CONFIG.attributes.max}</span>
            </span>
          </div>
          <Bar value={v[a].value} max={GAME_CONFIG.attributes.max} tone="violet" />
          <div className="bar-label">
            <span>
              Inicial {v[a].base} · +{v[a].gained} por XP
            </span>
            <span className="num">
              {fmtNum(v[a].xp)} XP · {Math.round(v[a].progressToNext * 100)}% al siguiente
            </span>
          </div>
        </div>
      ))}
      <div className="tiny muted">Calificación inicial hecha el {fmtDate(state.attributes.ratedOn, true)}. El bono de racha suma a Disciplina.</div>
    </div>
  );
}

function RateAttributes() {
  const [vals, setVals] = useState<Record<AttributeId, number>>(() => Object.fromEntries(ATTRIBUTE_IDS.map((a) => [a, 30])) as Record<AttributeId, number>);
  return (
    <div className="card">
      <h2>Califica tus atributos iniciales</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        Se hace una sola vez. Sé honesto: el punto es ver tu evolución. Usa la guía de cómo se ve un 30 y un 70.
      </p>
      {ATTRIBUTE_IDS.map((a) => (
        <div key={a} style={{ marginBottom: 16 }}>
          <div className="row between">
            <b>{ATTRIBUTE_NAMES[a]}</b>
            <b className="num gold" style={{ fontSize: 18 }}>
              {vals[a]}
            </b>
          </div>
          <input type="range" min={0} max={100} value={vals[a]} onChange={(e) => setVals((v) => ({ ...v, [a]: Number(e.target.value) }))} aria-label={ATTRIBUTE_NAMES[a]} />
          <div className="grid2 tiny" style={{ gap: 8 }}>
            <div className="muted">
              <b>30:</b> {ATTRIBUTE_GUIDE[a].at30}
            </div>
            <div className="muted">
              <b>70:</b> {ATTRIBUTE_GUIDE[a].at70}
            </div>
          </div>
        </div>
      ))}
      <button
        className="btn primary block"
        onClick={() => confirmAction('¿Guardar la calificación inicial? Solo se hace una vez.') && addEvent('profile.attributes_rated', { values: vals })}
      >
        Guardar calificación inicial
      </button>
    </div>
  );
}

function SeasonSnapshots() {
  const { list, events, entities, state } = useGame();
  const seasons = list<SeasonData>('seasons', 'season').filter((s) => s.data.startDate <= state.today);
  const [sel, setSel] = useState<string>(state.seasons.current?.id ?? seasons.at(-1)?.id ?? '');
  const season = seasons.find((s) => s.id === sel) as Entity<SeasonData> | undefined;
  const snaps = useMemo(() => {
    if (!season) return null;
    const start = projectAsOf(events, entities, addDays(season.data.startDate, -1));
    const endDate = season.data.endDate < state.today ? season.data.endDate : state.today;
    const end = projectAsOf(events, entities, endDate);
    return { start, end, endDate, finished: season.data.endDate < state.today };
  }, [season, events, entities, state.today]);
  if (!seasons.length || !season || !snaps) return null;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Foto de temporada</h2>
        {seasons.length > 1 && (
          <select className="input" style={{ width: 'auto', minHeight: 32 }} value={sel} onChange={(e) => setSel(e.target.value)}>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                T{s.data.number} {s.data.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Atributo</th>
            <th className="r">Inicio</th>
            <th className="r">{snaps.finished ? 'Final' : 'Hoy'}</th>
            <th className="r">Δ</th>
          </tr>
        </thead>
        <tbody>
          {ATTRIBUTE_IDS.map((a) => {
            const s0 = snaps.start.attributes.values[a].value;
            const s1 = snaps.end.attributes.values[a].value;
            return (
              <tr key={a}>
                <td>{ATTRIBUTE_NAMES[a]}</td>
                <td className="r num">{s0}</td>
                <td className="r num">{s1}</td>
                <td className={`r num ${s1 > s0 ? 'green' : 'muted'}`}>{s1 > s0 ? `+${s1 - s0}` : '0'}</td>
              </tr>
            );
          })}
          <tr>
            <td>
              <b>Nivel</b>
            </td>
            <td className="r num">{snaps.start.level.level}</td>
            <td className="r num">{snaps.end.level.level}</td>
            <td className="r num green">{snaps.end.level.level > snaps.start.level.level ? `+${snaps.end.level.level - snaps.start.level.level}` : ''}</td>
          </tr>
        </tbody>
      </table>
      <div className="tiny muted" style={{ marginTop: 6 }}>
        Inicio: {fmtDate(season.data.startDate, true)} · {snaps.finished ? 'Final' : 'Corte'}: {fmtDate(snaps.endDate, true)}. Se calcula desde tus eventos, así que siempre está al día.
      </div>
    </div>
  );
}


function XpLedger() {
  const { state } = useGame();
  const [n, setN] = useState(15);
  const items = [...state.xp.ledger].reverse().slice(0, n);
  return (
    <div className="card">
      <h2>Historial de XP</h2>
      {items.length === 0 && <div className="muted small">Completa tu primera misión para ganar XP.</div>}
      {items.map((e, i) => (
        <div key={i} className="item">
          <div className="grow">
            <div className="small" style={{ fontWeight: 600 }}>
              {e.label}
            </div>
            <div className="tiny muted">
              {fmtDate(e.date, true)} · {xpSourceLabel(e.source)}
              {e.attribute ? ` · ${ATTRIBUTE_NAMES[e.attribute]}` : ''}
            </div>
          </div>
          <b className="gold num">+{e.amount}</b>
        </div>
      ))}
      {state.xp.ledger.length > n && (
        <button className="btn sm ghost block" onClick={() => setN((x) => x + 30)}>
          Ver más
        </button>
      )}
    </div>
  );
}
