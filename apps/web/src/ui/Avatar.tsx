import { ATTRIBUTE_IDS, ATTRIBUTE_NAMES, GAME_CONFIG, type AchievementData, type AttributeId } from '@igv/core';
import { useId } from 'react';
import { useGame } from '../data/store';
import { Icon } from './icons';

/** Color de cada atributo (el monograma toma el color de su atributo dominante). */
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

/** Iniciales del nombre (máx. 3): "Iván Gómez Vera" → "IGV". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/**
 * Monograma personal que evoluciona (sin ilustraciones):
 * - La forma del marco cambia con el título (Aprendiz → Explorador → Constructor → Estratega → Leyenda).
 * - El color refleja el atributo más alto.
 * - El anillo exterior muestra el avance al siguiente nivel; con racha de 7+ días se pinta de fuego.
 * - Insignias: hasta 3 logros.
 */
export function Avatar({ size = 64 }: { size?: number }) {
  const { state, byId } = useGame();
  const tier = Math.max(0, GAME_CONFIG.titles.filter((t) => state.level.level >= t.level).length - 1);
  const top = topAttribute(state.attributes.values);
  const color = ATTR_COLOR[top];
  const text = initials(state.settings.name);

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
  const ringR = 47;
  const circ = 2 * Math.PI * ringR;
  const progress = Math.min(1, Math.max(0, state.level.progress));
  const ringColor = state.streak.current >= 7 ? 'var(--flame)' : color;
  const fontSize = text.length >= 3 ? 25 : text.length === 2 ? 31 : 38;

  return (
    <div className="avatar" style={{ width: size, height: size }} title={`${state.level.title} · atributo dominante: ${ATTRIBUTE_NAMES[top]}`}>
      <svg viewBox={`0 0 ${S} ${S}`} width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id={`fill-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor="#0d1017" stopOpacity="1" />
          </linearGradient>
        </defs>

        {/* Avance al siguiente nivel */}
        <circle cx={c} cy={c} r={ringR} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="2.5" />
        <circle
          cx={c}
          cy={c}
          r={ringR}
          fill="none"
          stroke={ringColor}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${(circ * progress).toFixed(1)} ${circ.toFixed(1)}`}
          transform={`rotate(-90 ${c} ${c})`}
        />

        {/* Marco según el título */}
        <path d={framePath(tier, c, 40)} fill={`url(#fill-${uid})`} stroke={color} strokeOpacity="0.75" strokeWidth="1.6" />

        {/* Monograma */}
        <text
          x={c}
          y={c}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#f4efe4"
          fontFamily="var(--font-display)"
          fontWeight="700"
          fontSize={fontSize}
          letterSpacing="1"
        >
          {text}
        </text>
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
