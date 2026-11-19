import { useEffect, useRef, useState } from 'react';
import {
  ATTRIBUTE_IDS,
  ATTRIBUTE_NAMES,
  GAME_CONFIG,
  isInRoutine,
  weekday,
  type AchievementData,
  type AttributeId,
  type BossData,
  type MissionData,
  type SkillData,
  SKILL_RANK_NAMES,
} from '@igv/core';
import { useGame } from '../data/store';
import { haptic, sfx } from '../lib/sound';
import { Avatar } from './Avatar';
import { BossArt } from './BossArt';
import { Icon } from './icons';
import { toast } from './kit';

type Snap = {
  xp: number;
  level: number;
  gold: number;
  missionsToday: number;
  routineComplete: boolean;
  monthIncome: number;
  attrs: Record<AttributeId, number>;
  achievements: Record<string, boolean>;
  bossPhases: Record<string, number>;
  skillRanks: Record<string, number>;
};

type BannerItem = {
  id: number;
  kind: 'achievement' | 'skill' | 'perfect' | 'boss-hit';
  eyebrow: string;
  title: string;
  sub: string;
  icon: string;
};

type BossVictory = {
  bossId: string;
  bossName: string;
  phaseTitle: string;
  defeated: boolean;
};

/**
 * Celebraciones y feedback:
 * - +XP y +Oro flotante con contador de combo diario
 * - Banner "Logro desbloqueado"
 * - Banner de "Rango de habilidad" y "¡Día perfecto!"
 * - "Avanzaste en el reto" al registrar ingreso (meta mensual)
 * - Pantalla de "Fase completada" / "Reto superado"
 * - Pantalla de "¡Subiste de nivel!" con tu monograma
 */
export function Fx() {
  const { state, store, list, byId } = useGame();
  const prev = useRef<Snap | null>(null);
  const [floats, setFloats] = useState<{ id: number; amount: number; gold: number; combo: number }[]>([]);
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [bossVictory, setBossVictory] = useState<BossVictory | null>(null);
  const [levelUp, setLevelUp] = useState<{ level: number; title: string; reward?: string; attrs: { a: AttributeId; v: number }[] } | null>(null);

  const pushBanner = (b: Omit<BannerItem, 'id'>, ms = 4200) => {
    const id = Date.now() + Math.random();
    setBanners((xs) => [...xs, { ...b, id }]);
    window.setTimeout(() => setBanners((xs) => xs.filter((x) => x.id !== id)), ms);
  };

  useEffect(() => {
    const wd = weekday(state.today);
    const routine = list<MissionData>('missions', 'daily').filter((m) => isInRoutine(m.data, wd));
    const doneToday = new Set(state.missions.completedToday);
    const routineComplete = routine.length > 0 && routine.every((m) => doneToday.has(m.id));

    const cur: Snap = {
      xp: state.xp.total,
      level: state.level.level,
      gold: state.gold.balance,
      missionsToday: state.missions.completedToday.length,
      routineComplete,
      monthIncome: state.money.monthIncome,
      attrs: Object.fromEntries(ATTRIBUTE_IDS.map((a) => [a, state.attributes.values[a].value])) as Record<AttributeId, number>,
      achievements: Object.fromEntries(Object.entries(state.achievements).map(([k, v]) => [k, v.unlocked])),
      bossPhases: Object.fromEntries(Object.entries(state.bosses.bosses).map(([k, v]) => [k, v.phasesDone])),
      skillRanks: Object.fromEntries(Object.entries(state.skills).map(([k, v]) => [k, v.rank])),
    };

    const p = prev.current;
    prev.current = cur;
    if (!p || !store.ready) return;
    const recentLocal = Date.now() - store.lastLocalAction < 4500;
    if (!recentLocal) return;

    // 1. XP / Oro flotante + Combo
    const diff = cur.xp - p.xp;
    if (diff > 0) {
      const id = Date.now() + Math.random();
      const combo = cur.missionsToday > p.missionsToday && cur.missionsToday >= 2 ? cur.missionsToday : 0;
      setFloats((f) => [...f, { id, amount: diff, gold: Math.max(0, cur.gold - p.gold), combo }]);
      window.setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1550);
      sfx.xp(diff);
      haptic(18);
      for (const a of ATTRIBUTE_IDS) {
        const d = cur.attrs[a] - p.attrs[a];
        if (d > 0) window.setTimeout(() => toast(`▲ ${ATTRIBUTE_NAMES[a]} +${d} (ahora ${cur.attrs[a]})`, 'xp'), 480);
      }
    }

    // 2. Avance en la meta mensual de ingresos al registrar ingreso
    if (cur.monthIncome > p.monthIncome) {
      const delta = cur.monthIncome - p.monthIncome;
      const pctLeft = Math.max(0, Math.round((1 - cur.monthIncome / Math.max(state.money.goal, 1)) * 100));
      sfx.bossHit();
      haptic([25, 40, 25]);
      pushBanner({
        kind: 'boss-hit',
        eyebrow: 'Avanzaste en el reto',
        title: 'Meta de ingresos del mes',
        sub: `+${delta.toLocaleString('es-MX')} · llevas ${100 - pctLeft}% de la meta mensual`,
        icon: 'coin',
      });
    }

    // 3. Logros desbloqueados (banner estilo trofeo)
    for (const [achId, unlocked] of Object.entries(cur.achievements)) {
      if (unlocked && !p.achievements[achId]) {
        const ent = byId.get(achId)?.data as AchievementData | undefined;
        if (ent) {
          sfx.achievement();
          haptic([25, 40, 60]);
          pushBanner(
            {
              kind: 'achievement',
              eyebrow: 'Logro desbloqueado',
              title: ent.name,
              sub: `+${GAME_CONFIG.rewards.achievement} XP · ${ent.description}`,
              icon: ent.icon,
            },
            5000,
          );
        }
      }
    }

    // 4. Rango de habilidad desbloqueado
    for (const [skillId, rank] of Object.entries(cur.skillRanks)) {
      if (rank > (p.skillRanks[skillId] ?? 0)) {
        const sk = byId.get(skillId)?.data as SkillData | undefined;
        if (sk) {
          sfx.achievement();
          haptic([25, 35, 55]);
          pushBanner({
            kind: 'skill',
            eyebrow: 'Nuevo rango de habilidad',
            title: `${sk.name} · ${SKILL_RANK_NAMES[rank - 1]}`,
            sub: `+${GAME_CONFIG.rewards.skillRank} XP en ${ATTRIBUTE_NAMES[sk.attribute]}`,
            icon: 'shield',
          });
        }
      }
    }

    // 5. ¡Día perfecto! (todas las diarias de la rutina hechas)
    if (cur.routineComplete && !p.routineComplete) {
      window.setTimeout(() => {
        sfx.perfectDay();
        haptic([20, 40, 20, 40]);
        pushBanner(
          {
            kind: 'perfect',
            eyebrow: 'Rutina completa',
            title: '¡Día perfecto!',
            sub: `Completaste ${routine.length}/${routine.length} misiones de tu rutina de hoy`,
            icon: 'crown',
          },
          4800,
        );
      }, 350);
    }

    // 6. Fase de reto completada / Reto superado
    for (const [bossId, phasesDone] of Object.entries(cur.bossPhases)) {
      if (phasesDone > (p.bossPhases[bossId] ?? 0)) {
        const bossEnt = byId.get(bossId)?.data as BossData | undefined;
        const bs = state.bosses.bosses[bossId];
        if (bossEnt && bs) {
          const clearedPhase = bossEnt.phases[phasesDone - 1]?.title ?? `Fase ${phasesDone}`;
          setBossVictory({ bossId, bossName: bossEnt.name, phaseTitle: clearedPhase, defeated: bs.defeated });
          sfx.bossDefeat();
          haptic([40, 60, 40, 60, 100]);
        }
      }
    }

    // 7. Subida de nivel
    if (cur.level > p.level) {
      const reward = state.settings.levelRewards?.[String(cur.level)];
      const attrs = ATTRIBUTE_IDS.map((a) => ({ a, v: cur.attrs[a] })).sort((x, y) => y.v - x.v);
      setLevelUp({ level: cur.level, title: state.level.title, reward: reward || undefined, attrs });
      sfx.levelUp();
      haptic([30, 60, 30, 60, 80]);
    }
  }, [
    state.xp.total,
    state.level.level,
    state.gold.balance,
    state.attributes,
    state.achievements,
    state.bosses,
    state.skills,
    state.missions.completedToday,
    state.money.monthIncome,
    state.money.goal,
    state.today,
    store.ready,
    store.lastLocalAction,
    state.settings.levelRewards,
    state.level.title,
    list,
    byId,
  ]);

  return (
    <>
      {/* Banners de logros / avance en retos / día perfecto */}
      {banners.length > 0 && (
        <div className="rpg-banners" aria-live="polite">
          {banners.map((b) => (
            <div key={b.id} className={`rpg-banner ${b.kind}`}>
              <div className="rpg-banner-icon">
                <Icon name={b.icon} />
              </div>
              <div className="grow">
                <div className="rpg-banner-eye">{b.eyebrow}</div>
                <div className="rpg-banner-title">{b.title}</div>
                <div className="rpg-banner-sub">{b.sub}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* +XP / +Oro flotante */}
      {floats.map((f) => (
        <div key={f.id} className="xp-float num">
          {f.combo > 0 && <span className="combo-float">{f.combo} misiones hoy</span>}
          +{f.amount} XP
          {f.gold > 0 && <span className="gold-float">+{f.gold} oro</span>}
        </div>
      ))}

      {/* Celebración de Fase completada / Reto superado */}
      {bossVictory && !levelUp && (
        <div className="levelup boss-victory" onClick={() => setBossVictory(null)} role="dialog" aria-label="Reto superado">
          <div className="confetti" aria-hidden="true">
            {Array.from({ length: 30 }, (_, i) => (
              <i
                key={i}
                style={{
                  left: `${(i * 83) % 100}%`,
                  animationDelay: `${(i % 7) * 0.12}s`,
                  background: ['var(--gold)', 'var(--green)', 'var(--teal)', 'var(--gold-2)'][i % 4],
                }}
              />
            ))}
          </div>
          <div className="levelup-box">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <BossArt bossId={bossVictory.bossId} size={112} defeated={bossVictory.defeated} />
            </div>
            <div className="eyebrow" style={{ color: 'var(--gold)', marginBottom: 6 }}>
              {bossVictory.defeated ? 'Reto superado' : 'Fase completada'}
            </div>
            <h2>{bossVictory.bossName}</h2>
            <p>{bossVictory.phaseTitle}</p>
            <p style={{ marginTop: 10, color: 'var(--gold-2)', fontWeight: 800 }}>+{GAME_CONFIG.rewards.bossPhase} XP</p>
            <p className="tiny" style={{ marginTop: 22, opacity: 0.6 }}>
              Toca para continuar
            </p>
          </div>
        </div>
      )}

      {/* Celebración de Subida de Nivel */}
      {levelUp && (
        <div className="levelup" onClick={() => setLevelUp(null)} role="dialog" aria-label="Subiste de nivel">
          <div className="confetti" aria-hidden="true">
            {Array.from({ length: 36 }, (_, i) => (
              <i
                key={i}
                style={{
                  left: `${(i * 97) % 100}%`,
                  animationDelay: `${(i % 9) * 0.12}s`,
                  background: ['var(--gold)', 'var(--flame)', 'var(--teal)', 'var(--gold-2)'][i % 4],
                }}
              />
            ))}
          </div>
          <div className="levelup-box">
            <div className="levelup-hero-wrap">
              <Avatar size={108} />
              <div className="levelup-badge num">NV {levelUp.level}</div>
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
