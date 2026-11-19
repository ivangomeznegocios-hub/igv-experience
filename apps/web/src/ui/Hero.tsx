import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { GAME_CONFIG } from '@igv/core';
import { addEvent, useGame, voidEvent } from '../data/store';
import { computeBuffs } from '../lib/narrator';
import { fmtNum } from '../lib/time';
import { Avatar } from './Avatar';
import { Icon } from './icons';
import { Bar, undoToast } from './kit';

/** HUD principal del Personaje: retrato evolutivo, nivel, XP, oro, energía, racha y buffs activos. */
export function Hero({ compact = false }: { compact?: boolean }) {
  const { state, entities } = useGame();
  const { level, settings, energy, streak } = state;
  const rewardLevel = level.nextRewardLevel;
  const reward = settings.levelRewards?.[String(rewardLevel)];
  const buffs = useMemo(() => computeBuffs(state, entities), [state, entities]);
  const canRest = !streak.todayActive && !streak.todayRest && streak.restDaysLeftThisWeek > 0;

  return (
    <div className="card hero">
      <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <Link to="/personaje" className="hero-avatar" aria-label="Ver personaje">
          <Avatar size={70} />
          <span className="hero-level num" aria-label={`Nivel ${level.level}`}>
            {level.level}
          </span>
        </Link>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="hero-name ellipsis">{settings.name}</div>
          {settings.className && <div className="muted small ellipsis">{settings.className}</div>}
          <div className="title-chip" style={{ marginTop: 4 }}>
            <Icon name="crown" width={13} height={13} />
            {level.title}
          </div>
        </div>
        <div style={{ textAlign: 'right', flex: 'none' }}>
          <div className="eyebrow">XP total</div>
          <div className="num" style={{ fontWeight: 800, fontSize: 18 }}>
            {fmtNum(level.totalXp)}
          </div>
          {state.xp.today > 0 && <div className="small gold num">+{state.xp.today} hoy</div>}
          <Link to="/tienda" className="gold-chip num" aria-label="Oro y tienda">
            <Icon name="coin" width={13} height={13} /> {fmtNum(state.gold.balance)}
          </Link>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <Bar
          value={level.xpIntoLevel}
          max={level.xpNeeded}
          size="lg"
          label={
            <>
              <span className="num">
                {fmtNum(level.xpIntoLevel)} / {fmtNum(level.xpNeeded)} XP
              </span>
              <span className="num">Faltan {fmtNum(level.nextLevelXp - level.totalXp)} → NV {level.level + 1}</span>
            </>
          }
        />
      </div>

      {/* Vitalidad compacta (Racha + Energía + Descanso) */}
      {!compact && (
        <div className="hero-vitals">
          <div className="vital-pill">
            <Icon name="flame" className="flame" width={16} height={16} />
            <span className="num">
              <b>{streak.current}</b>d racha
            </span>
            <span className="tiny muted">
              {streak.todayActive ? `+${streak.bonusToday}` : streak.todayRest ? 'descanso' : `récord ${streak.best}`}
            </span>
          </div>

          <div className="vital-pill">
            <Icon name="bolt" className={energy.low ? 'red' : 'teal'} width={16} height={16} />
            <span className="num">
              <b>{energy.value ?? '—'}</b> energía
            </span>
            {energy.sleepHours !== null && <span className="tiny muted">{energy.sleepHours}h</span>}
          </div>

          {canRest && (
            <button
              className="vital-btn"
              title={`Usar día de descanso (${streak.restDaysLeftThisWeek} disponibles)`}
              onClick={() => {
                const ev = addEvent('rest_day.marked', {});
                undoToast('Día de descanso marcado. Tu racha está a salvo.', () => voidEvent(ev.id));
              }}
            >
              <Icon name="moon" width={14} height={14} /> Descanso ({streak.restDaysLeftThisWeek})
            </button>
          )}
        </div>
      )}

      {/* Buffs activos */}
      {!compact && buffs.length > 0 && (
        <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
          {buffs.map((b) => (
            <span key={b.id} className={`badge ${b.tone}`} title={b.detail}>
              <Icon name={b.icon} width={12} height={12} /> {b.label}
            </span>
          ))}
        </div>
      )}

      <div className="small muted" style={{ marginTop: 10 }}>
        <Icon name="star" width={13} height={13} style={{ verticalAlign: -2, color: 'var(--gold)' }} /> Nivel {rewardLevel}
        {GAME_CONFIG.titles.find((t) => t.level === rewardLevel) ? ` (${GAME_CONFIG.titles.find((t) => t.level === rewardLevel)!.title})` : ''}:{' '}
        {reward ? <b style={{ color: 'var(--text)' }}>{reward}</b> : <span className="faint">premio sin definir (Ajustes)</span>}
      </div>
    </div>
  );
}
