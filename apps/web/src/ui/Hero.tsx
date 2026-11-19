import { GAME_CONFIG } from '@igv/core';
import { useGame } from '../data/store';
import { fmtNum } from '../lib/time';
import { Bar } from './kit';
import { Icon } from './icons';
import { Avatar } from './Avatar';
import { Link } from 'react-router-dom';

export function Hero() {
  const { state } = useGame();
  const { level, settings } = state;
  const rewardLevel = level.nextRewardLevel;
  const reward = settings.levelRewards?.[String(rewardLevel)];
  return (
    <div className="card hero">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="hero-avatar">
          <Avatar size={64} />
          <span className="hero-level num" aria-label={`Nivel ${level.level}`}>
            {level.level}
          </span>
        </div>
        <div className="grow">
          <div className="hero-name ellipsis">{settings.name}</div>
          <div className="muted small">{settings.className}</div>
          <div className="title-chip" style={{ marginTop: 4 }}>
            <Icon name="crown" width={14} height={14} />
            {level.title}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
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
              <span className="num">Faltan {fmtNum(level.nextLevelXp - level.totalXp)} para nivel {level.level + 1}</span>
            </>
          }
        />
      </div>
      <div className="small muted" style={{ marginTop: 8 }}>
        <Icon name="star" width={13} height={13} style={{ verticalAlign: -2, color: 'var(--gold)' }} /> Nivel {rewardLevel}
        {GAME_CONFIG.titles.find((t) => t.level === rewardLevel) ? ` (${GAME_CONFIG.titles.find((t) => t.level === rewardLevel)!.title})` : ''}:{' '}
        {reward ? <b style={{ color: 'var(--text)' }}>{reward}</b> : <span className="faint">premio sin definir (Ajustes)</span>}
      </div>
    </div>
  );
}
