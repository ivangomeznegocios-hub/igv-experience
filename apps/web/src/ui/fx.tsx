import { useEffect, useRef, useState } from 'react';
import { useGame } from '../data/store';

/** Animación breve al ganar XP y celebración al subir de nivel (solo por acciones propias). */
export function Fx() {
  const { state, store } = useGame();
  const prev = useRef<{ xp: number; level: number } | null>(null);
  const [floats, setFloats] = useState<{ id: number; amount: number }[]>([]);
  const [levelUp, setLevelUp] = useState<{ level: number; title: string; reward?: string } | null>(null);

  useEffect(() => {
    const cur = { xp: state.xp.total, level: state.level.level };
    const p = prev.current;
    prev.current = cur;
    if (!p || !store.ready) return;
    const recentLocal = Date.now() - store.lastLocalAction < 4000;
    if (!recentLocal) return;
    const diff = cur.xp - p.xp;
    if (diff > 0) {
      const id = Date.now();
      setFloats((f) => [...f, { id, amount: diff }]);
      setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1400);
      if (navigator.vibrate) navigator.vibrate(18);
    }
    if (cur.level > p.level) {
      const reward = state.settings.levelRewards?.[String(cur.level)];
      setLevelUp({ level: cur.level, title: state.level.title, reward: reward || undefined });
      if (navigator.vibrate) navigator.vibrate([30, 60, 30]);
    }
  }, [state.xp.total, state.level.level, store.ready, store.lastLocalAction, state.settings.levelRewards, state.level.title]);

  return (
    <>
      {floats.map((f) => (
        <div key={f.id} className="xp-float num">
          +{f.amount} XP
        </div>
      ))}
      {levelUp && (
        <div className="levelup" onClick={() => setLevelUp(null)} role="dialog" aria-label="Subiste de nivel">
          <div className="levelup-box">
            <div className="levelup-ring">
              <div>
                <b>{levelUp.level}</b>
              </div>
            </div>
            <h2>¡Subiste de nivel!</h2>
            <p>
              Ahora eres <b style={{ color: '#ffd77a' }}>{levelUp.title}</b>
            </p>
            {levelUp.reward && <p style={{ marginTop: 10 }}>Premio desbloqueado: {levelUp.reward}</p>}
            <p className="tiny" style={{ marginTop: 18, opacity: 0.6 }}>
              Toca para continuar
            </p>
          </div>
        </div>
      )}
    </>
  );
}
