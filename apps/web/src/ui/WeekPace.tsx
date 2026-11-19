import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { personalRecords, weekPace } from '@igv/core';
import { useGame } from '../data/store';
import { fmtNum } from '../lib/time';
import { Badge } from './kit';
import '../life.css';

/** "Tú vs. tú": tu semana contra la semana pasada hasta este mismo momento. */
export function WeekPaceCard() {
  const { state, events } = useGame();
  const nowIso = new Date().toISOString();
  const p = useMemo(() => weekPace(state, events, nowIso), [state, events, nowIso.slice(0, 15)]); // eslint-disable-line react-hooks/exhaustive-deps
  const records = useMemo(() => personalRecords(state), [state]);
  const newRecords = records.filter((r) => r.brokenNow && (r.id === 'best_week' || r.id === 'best_day'));
  const max = Math.max(p.xp, p.xpLastWeek, p.xpLastWeekTotal, 1);
  const name = state.settings.name.split(/\s+/)[0] || 'tú';

  let verdict: { text: string; cls: string };
  if (p.xp === 0 && p.xpLastWeek === 0) verdict = { text: 'Semana en blanco para los dos. El primero que registre algo gana.', cls: '' };
  else if (p.diff > 0) verdict = { text: `Vas ${fmtNum(p.diff)} XP arriba del ${name} de la semana pasada.`, cls: 'up' };
  else if (p.diff === 0) verdict = { text: `Empatado con el ${name} de la semana pasada.`, cls: '' };
  else verdict = { text: `Te faltan ${fmtNum(-p.diff)} XP para alcanzar al ${name} de la semana pasada.`, cls: 'down' };

  return (
    <Link to="/records" className="card" style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
      <div className="card-head">
        <h2>Tú vs. tú</h2>
        <div className="row" style={{ gap: 4 }}>
          {newRecords.map((r) => (
            <Badge key={r.id} tone="gold">
              ¡Récord: {r.label.toLowerCase()}!
            </Badge>
          ))}
        </div>
      </div>
      <div className={`vs-verdict small ${verdict.cls}`}>{verdict.text}</div>
      <div className="vs-bars">
        <div className="vs-row">
          <span>Esta semana</span>
          <div className="vs-track">
            <div className="vs-fill" style={{ width: `${(p.xp / max) * 100}%` }} />
          </div>
          <span className="vs-num">{fmtNum(p.xp)}</span>
        </div>
        <div className="vs-row">
          <span className="muted">Pasada, a esta hora</span>
          <div className="vs-track">
            <div className="vs-fill past" style={{ width: `${(p.xpLastWeek / max) * 100}%` }} />
          </div>
          <span className="vs-num muted">{fmtNum(p.xpLastWeek)}</span>
        </div>
      </div>
      <div className="tiny muted">
        {p.missions} misiones vs {p.missionsLastWeek} · la semana pasada cerró con {fmtNum(p.xpLastWeekTotal)} XP
        {p.xp > p.xpLastWeekTotal && p.xpLastWeekTotal > 0 ? ' — ya la superaste' : ''}
      </div>
    </Link>
  );
}
