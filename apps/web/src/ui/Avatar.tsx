import { ATTRIBUTE_IDS, ATTRIBUTE_NAMES, GAME_CONFIG, type AchievementData, type AttributeId } from '@igv/core';
import { useId } from 'react';
import { useGame } from '../data/store';
import { Icon } from './icons';

/** Color de cada atributo (el avatar toma el de tu atributo más alto). */
export const ATTR_COLOR: Record<AttributeId, string> = {
  fuerza: '#f87171',
  inteligencia: '#60a5fa',
  carisma: '#f472b6',
  finanzas: '#f4b740',
  disciplina: '#8b6cf6',
  relaciones: '#34d399',
  creatividad: '#2dd4bf',
};

/** Forma del marco según el título (Aprendiz → Leyenda). */
function framePath(tier: number, c: number, r: number): string {
  const poly = (n: number, rot = -Math.PI / 2, rr = r) =>
    Array.from({ length: n }, (_, i) => {
      const a = rot + (i * 2 * Math.PI) / n;
      return `${(c + Math.cos(a) * rr).toFixed(1)},${(c + Math.sin(a) * rr).toFixed(1)}`;
    }).join(' ');
  if (tier <= 0) return `M${c - r},${c} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0`;
  if (tier === 1) return `M${poly(6, -Math.PI / 2)}Z`;
  if (tier === 2) return `M${c},${c - r} L${c + r * 0.9},${c - r * 0.55} L${c + r * 0.8},${c + r * 0.35} L${c},${c + r} L${c - r * 0.8},${c + r * 0.35} L${c - r * 0.9},${c - r * 0.55}Z`;
  if (tier === 3) return `M${poly(8, -Math.PI / 8)}Z`;
  // Leyenda: estrella de 12 puntas
  return (
    'M' +
    Array.from({ length: 24 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 12;
      const rr = i % 2 ? r * 0.84 : r;
      return `${(c + Math.cos(a) * rr).toFixed(1)},${(c + Math.sin(a) * rr).toFixed(1)}`;
    }).join(' L') +
    'Z'
  );
}

export function topAttribute(values: Record<AttributeId, { value: number }>): AttributeId {
  return ATTRIBUTE_IDS.reduce((best, a) => (values[a].value > values[best].value ? a : best), ATTRIBUTE_IDS[0]);
}

/** Avatar que evoluciona: marco por título, color por tu atributo más alto, aura por racha e insignias de logros. */
export function Avatar({ size = 64 }: { size?: number }) {
  const { state, byId } = useGame();
  const tier = Math.max(0, GAME_CONFIG.titles.filter((t) => state.level.level >= t.level).length - 1);
  const top = topAttribute(state.attributes.values);
  const color = ATTR_COLOR[top];
  const name = state.settings.name || 'J';
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  const chosen = (state.settings.avatarBadges ?? []).filter((id) => state.achievements[id]?.unlocked);
  const badges = (chosen.length ? chosen : Object.entries(state.achievements).filter(([, a]) => a.unlocked).sort((a, b) => ((a[1].date ?? '') < (b[1].date ?? '') ? 1 : -1)).map(([id]) => id))
    .slice(0, 3)
    .map((id) => byId.get(id)?.data as AchievementData | undefined)
    .filter(Boolean) as AchievementData[];
  const gid = `av-${useId().replace(/:/g, '')}`;
  const S = 100;
  const c = S / 2;
  const aura = state.streak.current >= 7;
  return (
    <div className="avatar" style={{ width: size, height: size }} title={`${state.level.title} · atributo dominante: ${ATTRIBUTE_NAMES[top]}`}>
      <svg viewBox={`0 0 ${S} ${S}`} width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.95" />
            <stop offset="1" stopColor={color} stopOpacity="0.45" />
          </linearGradient>
        </defs>
        {aura && <circle cx={c} cy={c} r={48} fill="none" stroke="var(--flame)" strokeOpacity="0.45" strokeWidth="3" strokeDasharray="4 5" className="avatar-aura" />}
        <path d={framePath(tier, c, 42)} fill={`url(#${gid})`} stroke={tier >= 4 ? 'var(--gold-2)' : 'rgb(255 255 255 / 0.35)'} strokeWidth={tier >= 3 ? 3 : 2} />
        <path d={framePath(tier, c, 33)} fill="rgb(10 14 22 / 0.55)" />
        <text x={c} y={c + 1} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={initials.length > 1 ? 24 : 30} fontWeight={800}>
          {initials}
        </text>
      </svg>
      {badges.length > 0 && (
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
