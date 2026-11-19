import { useEffect, useRef, useState } from 'react';
import { ATTRIBUTE_IDS, ATTRIBUTE_NAMES, type AttributeId } from '@igv/core';
import { useGame } from '../data/store';
import { haptic, sfx } from '../lib/sound';
import { toast } from './kit';

type Snap = { xp: number; level: number; gold: number; attrs: Record<AttributeId, number> };

/** Animaciones al ganar XP/oro, puntos de atributo y celebración al subir de nivel (solo por acciones propias). */
export function Fx() {
  const { state, store } = useGame();
  const prev = useRef<Snap | null>(null);
  const [floats, setFloats] = useState<{ id: number; amount: number; gold: number }[]>([]);
  const [levelUp, setLevelUp] = useState<{ level: number; title: string; reward?: string; attrs: { a: AttributeId; v: number }[] } | null>(null);

  useEffect(() => {
    const cur: Snap = {
      xp: state.xp.total,
      level: state.level.level,
      gold: state.gold.balance,
      attrs: Object.fromEntries(ATTRIBUTE_IDS.map((a) => [a, state.attributes.values[a].value])) as Record<AttributeId, number>,
    };
    const p = prev.current;
    prev.current = cur;
    if (!p || !store.ready) return;
    const recentLocal = Date.now() - store.lastLocalAction < 4000;
    if (!recentLocal) return;
    const diff = cur.xp - p.xp;
    if (diff > 0) {
      const id = Date.now() + Math.random();
      setFloats((f) => [...f, { id, amount: diff, gold: Math.max(0, cur.gold - p.gold) }]);
      setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1500);
      sfx.xp(diff);
      haptic(18);
      for (const a of ATTRIBUTE_IDS) {
        const d = cur.attrs[a] - p.attrs[a];
        if (d > 0) setTimeout(() => toast(`▲ ${ATTRIBUTE_NAMES[a]} +${d} (ahora ${cur.attrs[a]})`, 'xp'), 500);
      }
    }
    if (cur.level > p.level) {
      const reward = state.settings.levelRewards?.[String(cur.level)];
      const attrs = ATTRIBUTE_IDS.map((a) => ({ a, v: cur.attrs[a] })).sort((x, y) => y.v - x.v);
      setLevelUp({ level: cur.level, title: state.level.title, reward: reward || undefined, attrs });
      sfx.levelUp();
      haptic([30, 60, 30, 60, 80]);
    }
  }, [state.xp.total, state.level.level, state.gold.balance, state.attributes, store.ready, store.lastLocalAction, state.settings.levelRewards, state.level.title]);

  return (
    <>
      {floats.map((f) => (
        <div key={f.id} className="xp-float num">
          +{f.amount} XP
          {f.gold > 0 && <span className="gold-float">+{f.gold} oro</span>}
        </div>
      ))}
      {levelUp && (
        <div className="levelup" onClick={() => setLevelUp(null)} role="dialog" aria-label="Subiste de nivel">
          <div className="confetti" aria-hidden="true">
            {Array.from({ length: 36 }, (_, i) => (
              <i key={i} style={{ left: `${(i * 97) % 100}%`, animationDelay: `${(i % 9) * 0.12}s`, background: ['var(--gold)', 'var(--violet)', 'var(--teal)', 'var(--flame)'][i % 4] }} />
            ))}
          </div>
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
            {levelUp.reward && <p style={{ marginTop: 10 }}>🎁 Premio desbloqueado: {levelUp.reward}</p>}
            <div className="levelup-attrs">
              {levelUp.attrs.map(({ a, v }) => (
                <div key={a}>
                  <span>{ATTRIBUTE_NAMES[a]}</span>
                  <i style={{ width: `${v}%` }} />
                  <b>{v}</b>
                </div>
              ))}
            </div>
            <p className="tiny" style={{ marginTop: 18, opacity: 0.6 }}>
              Toca para continuar
            </p>
          </div>
        </div>
      )}
    </>
  );
}
