import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { nextPlay, type Entity, type MissionData } from '@igv/core';
import { addEvent, getEntity, useGame, voidEvent } from '../data/store';
import { localHour } from '../lib/narrator';
import { completePending } from '../lib/play';
import { collect, inaugurate, startBuild } from '../lib/city';
import { startScore } from './DayRing';
import { openDayDeck } from './DayDeck';
import { openPlanSheet } from './DayPlan';
import { Icon } from './icons';
import { undoToast } from './kit';
import { openQuickAdd } from './QuickAdd';
import { startMissionQuest } from './QuestMode';

const SLEEP_OPTIONS = [5, 6, 7, 8];

/** La única cosa que la mesa te propone ahora. Se recalcula con cada registro. */
export function NextPlayCard() {
  const game = useGame();
  const { state } = game;
  const navigate = useNavigate();
  const play = useMemo(() => nextPlay(state, { hour: localHour() }), [state]);
  const a = play.action;
  if (a.kind === 'start') return null; // la tarjeta del día ya ofrece empezar

  let main: { label: string; run: () => void } | null = null;
  let extra: { label: string; icon: string; run: () => void } | null = null;
  switch (a.kind) {
    case 'comeback':
      main = { label: 'Registrar algo', run: () => openQuickAdd({ mode: 'did' }) };
      break;
    case 'pledge':
      main = { label: 'Resolver', run: () => navigate('/retos') };
      break;
    case 'plan':
    case 'plan-tomorrow':
      main = { label: a.kind === 'plan' ? 'Elegir mis 3' : 'Planear mañana', run: () => openPlanSheet(a.date) };
      break;
    case 'mission': {
      main = { label: 'Hecho', run: () => completePending(game, a.missionId) };
      const ent = getEntity(a.missionId);
      if (ent?.module === 'missions') extra = { label: 'Empezar', icon: 'play', run: () => startMissionQuest(ent as Entity<MissionData>) };
      break;
    }
    case 'inaugurate': {
      const d = state.city.districts[a.districtId as keyof typeof state.city.districts];
      main = { label: 'Inaugurar', run: () => inaugurate(d) };
      break;
    }
    case 'collect':
      main = { label: 'Recoger', run: () => collect(state) };
      break;
    case 'build': {
      const d = state.city.districts[a.districtId as keyof typeof state.city.districts];
      main = { label: d.level === 0 ? 'Fundar' : 'Construir', run: () => startBuild(d) };
      extra = { label: 'Ver ciudad', icon: 'building', run: () => navigate('/ciudad') };
      break;
    }
    case 'log':
      main = { label: 'Registrar', run: () => openDayDeck({ date: state.today }) };
      break;
    case 'close':
      main = { label: 'Cerrar el día', run: () => openDayDeck({ date: state.today, closeOnly: true }) };
      break;
    default:
      break;
  }

  const logSleep = (h: number) => {
    const ev = addEvent('checkin.morning', { sleepHours: h });
    undoToast(`Sueño: ${h} h`, () => voidEvent(ev.id));
  };

  return (
    <section className={`card next-play np-${a.kind}`} aria-label="Siguiente jugada">
      <div className="np-head">
        <span className="np-label">Ahora</span>
        {play.points ? <span className="np-points num">+{play.points} pts</span> : null}
      </div>
      <h2 className="np-title">{play.title}</h2>
      <p className="np-sub">{play.sub}</p>
      {a.kind === 'sleep' ? (
        <div className="np-actions">
          {SLEEP_OPTIONS.map((h) => (
            <button key={h} className={`btn ${h >= 7 ? 'primary' : ''}`} onClick={() => logSleep(h)}>
              {h === 8 ? '8 h o más' : `${h} h`}
            </button>
          ))}
        </div>
      ) : (
        (main || extra) && (
          <div className="np-actions">
            {main && (
              <button className="btn primary" onClick={main.run}>
                {main.label}
              </button>
            )}
            {extra && (
              <button className="btn" onClick={extra.run}>
                <Icon name={extra.icon} /> {extra.label}
              </button>
            )}
          </div>
        )
      )}
    </section>
  );
}
