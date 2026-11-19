import { ATTRIBUTE_IDS, ATTRIBUTE_NAMES, GAME_CONFIG, type AchievementData, type AttributeId } from '@igv/core';
import { useId } from 'react';
import { useGame } from '../data/store';
import { getArmoryItem } from '../lib/armory';
import { Icon } from './icons';

/** Color de cada atributo (el personaje toma el aura de su atributo dominante). */
export const ATTR_COLOR: Record<AttributeId, string> = {
  fuerza: '#e85d5d',
  inteligencia: '#4b9cf5',
  carisma: '#ec6b9b',
  finanzas: '#eab338',
  disciplina: '#d97736',
  relaciones: '#2ec48f',
  creatividad: '#26c6b9',
};

/** Forma del escudo/marco según el título (Aprendiz → Leyenda). */
function framePath(tier: number, c: number, r: number): string {
  const poly = (n: number, rot = -Math.PI / 2, rr = r) =>
    Array.from({ length: n }, (_, i) => {
      const a = rot + (i * 2 * Math.PI) / n;
      return `${(c + Math.cos(a) * rr).toFixed(1)},${(c + Math.sin(a) * rr).toFixed(1)}`;
    }).join(' ');
  if (tier <= 0) return `M${c - r},${c} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0`;
  if (tier === 1) return `M${poly(6, -Math.PI / 2)}Z`;
  if (tier === 2) return `M${c},${c - r} L${c + r * 0.92},${c - r * 0.56} L${c + r * 0.82},${c + r * 0.36} L${c},${c + r} L${c - r * 0.82},${c + r * 0.36} L${c - r * 0.92},${c - r * 0.56}Z`;
  if (tier === 3) return `M${poly(8, -Math.PI / 8)}Z`;
  return (
    'M' +
    Array.from({ length: 24 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 12;
      const rr = i % 2 ? r * 0.86 : r;
      return `${(c + Math.cos(a) * rr).toFixed(1)},${(c + Math.sin(a) * rr).toFixed(1)}`;
    }).join(' L') +
    'Z'
  );
}

export function topAttribute(values: Record<AttributeId, { value: number }>): AttributeId {
  return ATTRIBUTE_IDS.reduce((best, a) => (values[a].value > values[best].value ? a : best), ATTRIBUTE_IDS[0]);
}

/**
 * Personaje RPG que evoluciona:
 * - Silueta y armadura cambian con el título (Aprendiz → Explorador → Constructor → Estratega → Leyenda).
 * - Núcleo y brillo reflejan el atributo más alto.
 * - Equipa auras y emblemas desbloqueados en la Armería + aura de racha (7+ días) e insignias de logros.
 */
export function Avatar({ size = 64, preview }: { size?: number; preview?: { aura?: string; emblem?: string } }) {
  const { state, byId } = useGame();
  const tier = Math.max(0, GAME_CONFIG.titles.filter((t) => state.level.level >= t.level).length - 1);
  const top = topAttribute(state.attributes.values);
  const color = ATTR_COLOR[top];
  const equipped = { ...(state.settings.equipped ?? {}), ...(preview ?? {}) };
  const auraItem = getArmoryItem(equipped.aura);
  const emblemId = equipped.emblem;

  const chosen = (state.settings.avatarBadges ?? []).filter((id) => state.achievements[id]?.unlocked);
  const badges = (
    chosen.length
      ? chosen
      : Object.entries(state.achievements)
          .filter(([, a]) => a.unlocked)
          .sort((a, b) => ((a[1].date ?? '') < (b[1].date ?? '') ? 1 : -1))
          .map(([id]) => id)
  )
    .slice(0, 3)
    .map((id) => byId.get(id)?.data as AchievementData | undefined)
    .filter(Boolean) as AchievementData[];

  const uid = useId().replace(/:/g, '');
  const S = 100;
  const c = S / 2;
  const streakAura = state.streak.current >= 7;
  const hasCrown = tier >= 4 || emblemId === 'armory-emblem-crown';
  const hasPauldrons = tier >= 2 || emblemId === 'armory-emblem-forge';
  const hasCompassClasp = tier >= 1 || emblemId === 'armory-emblem-cloak';
  const hasHighCollar = tier >= 3;

  const auraColor = auraItem?.accent ?? (streakAura ? '#ff7a3d' : null);

  return (
    <div className="avatar" style={{ width: size, height: size }} title={`${state.level.title} · atributo dominante: ${ATTRIBUTE_NAMES[top]}`}>
      <svg viewBox={`0 0 ${S} ${S}`} width={size} height={size} aria-hidden="true">
        <defs>
          <radialGradient id={`bg-${uid}`} cx="50%" cy="35%" r="65%">
            <stop offset="0%" stopColor={color} stopOpacity="0.45" />
            <stop offset="65%" stopColor="#141821" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#090b10" stopOpacity="1" />
          </radialGradient>
          <linearGradient id={`rim-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={tier >= 3 || auraItem ? '#ffd77a' : color} />
            <stop offset="50%" stopColor={color} />
            <stop offset="100%" stopColor="#8a621c" />
          </linearGradient>
          <linearGradient id={`armor-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#353c4c" />
            <stop offset="100%" stopColor="#171b24" />
          </linearGradient>
          <linearGradient id={`gold-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffe194" />
            <stop offset="100%" stopColor="#b87c19" />
          </linearGradient>
          <clipPath id={`clip-${uid}`}>
            <path d={framePath(tier, c, 37)} />
          </clipPath>
        </defs>

        {/* Aura exterior (Armería o Racha 7+) */}
        {auraColor && (
          <circle
            cx={c}
            cy={c}
            r={47}
            fill="none"
            stroke={auraColor}
            strokeOpacity="0.65"
            strokeWidth={auraItem?.id === 'armory-aura-dragon' ? 3.2 : 2.4}
            strokeDasharray={auraItem?.id === 'armory-aura-solar' ? '8 4 2 4' : '5 5'}
            className="avatar-aura"
          />
        )}
        {auraItem?.id === 'armory-aura-dragon' && (
          <circle cx={c} cy={c} r={43.5} fill="none" stroke="#ffd77a" strokeOpacity="0.45" strokeWidth="1.5" strokeDasharray="3 6" className="avatar-aura-rev" />
        )}

        {/* Marco exterior metálico */}
        <path d={framePath(tier, c, 42)} fill={`url(#rim-${uid})`} />
        <path d={framePath(tier, c, 37)} fill={`url(#bg-${uid})`} />

        {/* Retrato ilustrado del Héroe dentro del escudo */}
        <g clipPath={`url(#clip-${uid})`}>
          {/* Resplandor detrás de la silueta */}
          <circle cx={c} cy={44} r={24} fill={color} fillOpacity="0.22" />

          {/* Capa / Manto posterior */}
          <path d="M22,92 Q28,58 50,55 Q72,58 78,92 Z" fill="#1d2230" />
          <path d="M26,92 Q34,63 50,60 Q66,63 74,92 Z" fill={`url(#armor-${uid})`} stroke="rgb(255 255 255 / 0.14)" strokeWidth="1" />

          {/* Cuello alto de Estratega (nivel 15+) */}
          {hasHighCollar && (
            <path d="M35,58 L41,47 L59,47 L65,58 L57,63 L43,63 Z" fill="#232838" stroke={`url(#gold-${uid})`} strokeWidth="1.4" />
          )}

          {/* Hombreras forjadas (Constructor / Armería) */}
          {hasPauldrons && (
            <>
              <path d="M20,76 Q25,58 40,61 L36,75 Q27,76 20,76 Z" fill={`url(#armor-${uid})`} stroke={`url(#gold-${uid})`} strokeWidth="1.6" />
              <path d="M80,76 Q75,58 60,61 L64,75 Q73,76 80,76 Z" fill={`url(#armor-${uid})`} stroke={`url(#gold-${uid})`} strokeWidth="1.6" />
            </>
          )}

          {/* Capucha (Aprendiz / Explorador) o Yelmo/Silueta limpia */}
          {tier <= 1 ? (
            <path d="M33,54 Q33,24 50,24 Q67,24 67,54 Q58,50 50,51 Q42,50 33,54 Z" fill="#202636" stroke="rgb(255 255 255 / 0.18)" strokeWidth="1.2" />
          ) : null}

          {/* Cabeza / Rostro estilizado */}
          <ellipse cx={c} cy={41} rx={11.5} ry={13} fill="#121620" stroke={color} strokeOpacity="0.55" strokeWidth="1.3" />
          {/* Ojos brillantes de determinación */}
          <path d="M44,40.5 L47.5,41.3 L44.3,42 Z" fill="#ffd77a" />
          <path d="M56,40.5 L52.5,41.3 L55.7,42 Z" fill="#ffd77a" />

          {/* Corona (Leyenda o Corona de Estratega) */}
          {hasCrown && (
            <path d="M39,30 L42,20 L47,26 L50,17 L53,26 L58,20 L61,30 Z" fill={`url(#gold-${uid})`} stroke="#4a2e05" strokeWidth="0.9" />
          )}

          {/* Núcleo / Broche del pecho con color de atributo */}
          {hasCompassClasp ? (
            <g>
              <polygon points="50,62 56,70 50,78 44,70" fill={`url(#gold-${uid})`} />
              <polygon points="50,65.5 53,70 50,74.5 47,70" fill={color} />
            </g>
          ) : (
            <circle cx={c} cy={70} r={4} fill={color} fillOpacity="0.85" />
          )}

          {/* Líneas de armadura en el pecho */}
          <path d="M50,79 L50,92" stroke="rgb(255 255 255 / 0.14)" strokeWidth="1.2" />
        </g>

        {/* Borde interior sutil */}
        <path d={framePath(tier, c, 37)} fill="none" stroke="rgb(255 255 255 / 0.2)" strokeWidth="1" />
      </svg>
      {badges.length > 0 && size >= 56 && (
        <div className="avatar-badges">
          {badges.map((b, i) => (
            <span key={i} title={b.name}>
              <Icon name={b.icon} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
