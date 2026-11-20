import { Link } from 'react-router-dom';
import { ATTRIBUTE_NAMES, MISSION_SIZE_NAMES, isDailyDone, quickMissionId, type AttributeId, type Entity, type MissionData, type MissionSize } from '@igv/core';
import { getEntity, useGame } from '../data/store';
import { uncomplete } from '../lib/actions';
import { completePending } from '../lib/play';
import { Icon } from './icons';
import { startMissionQuest } from './QuestMode';

interface Tile {
  id: string;
  title: string;
  size: MissionSize;
  attribute: AttributeId;
  done: boolean;
  /** Id con el que quedó registrado (para desmarcar). */
  doneId: string | null;
  planSlot: number | null;
  recovery: boolean;
}

/** "Hoy te toca": tus 3 primero (con su número) y luego tu rutina. Un toque marca; otro desmarca. */
export function TodayTiles() {
  const game = useGame();
  const { state, list } = game;
  const doneToday = new Set(state.missions.completedToday);
  const plan = state.plans[state.today];
  const dailies = new Map(list<MissionData>('missions', 'daily').map((m) => [m.id, m] as const));
  const points = new Map((state.days.today?.pending ?? []).map((p) => [p.missionId, p.points] as const));
  const low = state.energy.low;
  const bounty = state.bounty.today;

  const doneIdOf = (id: string, title: string) => (doneToday.has(id) ? id : doneToday.has(quickMissionId(title)) ? quickMissionId(title) : null);
  const tiles: Tile[] = [];
  const seen = new Set<string>();
  (plan?.items ?? []).forEach((it, i) => {
    seen.add(it.missionId);
    const d = dailies.get(it.missionId);
    const doneId = doneIdOf(it.missionId, it.title);
    tiles.push({ id: it.missionId, title: it.title, size: it.size, attribute: it.attribute, done: it.done || !!doneId, doneId, planSlot: i + 1, recovery: !!d?.data.recovery });
  });
  for (const h of state.habits.routine) {
    if (!h.dueToday || seen.has(h.id)) continue;
    const m = dailies.get(h.id);
    if (!m) continue;
    const done = isDailyDone({ doneOn: doneToday }, m as Entity<MissionData>);
    tiles.push({ id: m.id, title: m.data.title, size: m.data.size, attribute: m.data.attribute, done, doneId: done ? doneIdOf(m.id, m.data.title) : null, planSlot: null, recovery: !!m.data.recovery });
  }
  const doneCount = tiles.filter((t) => t.done).length;

  const toggle = (t: Tile) => {
    if (t.done) {
      if (t.doneId) uncomplete(t.doneId, state.today, t.title);
      return;
    }
    completePending(game, t.id);
  };

  return (
    <section className="card tiles-card" aria-label="Hoy te toca">
      <div className="card-head">
        <div>
          <h2>Hoy te toca</h2>
          <div className="tiny muted">{tiles.length ? `${doneCount} de ${tiles.length} hechas` : 'Nada en tu rutina para hoy'}</div>
        </div>
        <div className="row" style={{ gap: 2 }}>
          <Link to="/habitos" className="btn sm ghost">
            Hábitos
          </Link>
          <Link to="/misiones?tab=daily" className="btn sm ghost">
            Editar
          </Link>
        </div>
      </div>
      {low && (
        <div className="banner warn" style={{ margin: '0 0 10px' }}>
          <Icon name="bolt" width={18} /> Energía baja: hoy prioriza lo chico y lo de recuperación.
        </div>
      )}
      <div className="tiles">
        {tiles.map((t) => {
          const dim = low && !t.done && t.size !== 'chica' && !t.recovery;
          const ent = getEntity(t.id);
          const pts = points.get(t.id);
          return (
            <div key={t.id} className={`tile ${t.done ? 'done' : ''} ${dim ? 'dim' : ''}`}>
              <button className="tile-main" aria-pressed={t.done} aria-label={`${t.done ? 'Desmarcar' : 'Completar'} ${t.title}`} onClick={() => toggle(t)}>
                <span className="tile-top">
                  {t.planSlot ? <span className="tile-slot num">{t.planSlot}</span> : <span className="tile-check" aria-hidden="true"><Icon name="check" /></span>}
                  {t.done ? <span className="tile-state">Hecho</span> : pts ? <span className="tile-pts num">+{pts}</span> : null}
                </span>
                <span className="tile-title">{t.title}</span>
                <span className="tile-meta">
                  {MISSION_SIZE_NAMES[t.size]} · {ATTRIBUTE_NAMES[t.attribute]}
                  {bounty?.missionId === t.id && !t.done && <em> · sorpresa +{bounty.bonus} XP</em>}
                </span>
              </button>
              {!t.done && ent?.module === 'missions' && (
                <button className="tile-play" aria-label={`Empezar ${t.title} en modo enfoque`} title="Modo enfoque" onClick={() => startMissionQuest(ent as Entity<MissionData>)}>
                  <Icon name="play" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {tiles.length === 0 && (
        <Link to="/misiones?tab=daily" className="btn sm" style={{ marginTop: 4 }}>
          Armar mi rutina
        </Link>
      )}
    </section>
  );
}
