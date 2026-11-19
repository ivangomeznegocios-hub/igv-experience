import { useId } from 'react';

/** Arte SVG ilustrado para cada jefe principal, recurrente o personalizado. */
export function BossArt({ bossId, size = 58, defeated = false, locked = false }: { bossId: string; size?: number; defeated?: boolean; locked?: boolean }) {
  const uid = useId().replace(/:/g, '');
  const palette =
    bossId === 'boss-dragon'
      ? { a: '#ff6b35', b: '#f4b740', bg: '#26110e' }
      : bossId === 'boss-imperio'
        ? { a: '#f4b740', b: '#b45309', bg: '#221a0c' }
        : bossId === 'boss-ausente'
          ? { a: '#38bdf8', b: '#1d4ed8', bg: '#0e1928' }
          : bossId === 'boss-sedentario'
            ? { a: '#f87171', b: '#991b1b', bg: '#241114' }
            : bossId === 'boss-torre'
              ? { a: '#60a5fa', b: '#2dd4bf', bg: '#0f1c26' }
              : bossId === 'rb-paralisis'
                ? { a: '#94a3b8', b: '#475569', bg: '#161b24' }
                : bossId === 'rb-perfeccionista'
                  ? { a: '#fbbf24', b: '#e11d48', bg: '#22121a' }
                  : { a: '#f87171', b: '#f4b740', bg: '#1f1315' };

  return (
    <div
      className={`boss-art ${defeated ? 'defeated' : ''} ${locked ? 'locked' : ''}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 80 80" width={size} height={size}>
        <defs>
          <radialGradient id={`ba-${uid}`} cx="50%" cy="40%" r="65%">
            <stop offset="0%" stopColor={palette.a} stopOpacity="0.45" />
            <stop offset="70%" stopColor={palette.bg} />
            <stop offset="100%" stopColor="#090b10" />
          </radialGradient>
          <linearGradient id={`bs-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={palette.b} />
            <stop offset="100%" stopColor={palette.a} />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="76" height="76" rx="18" fill={`url(#ba-${uid})`} stroke={palette.a} strokeOpacity="0.45" strokeWidth="1.6" />

        {bossId === 'boss-dragon' && (
          <g fill="none" stroke={`url(#bs-${uid})`} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            {/* Cuernos y cráneo del dragón */}
            <path d="M22,22 L30,34 L40,26 L50,34 L58,22" />
            <path d="M18,34 L27,40 L31,54 L40,62 L49,54 L53,40 L62,34" fill={palette.a} fillOpacity="0.16" />
            <path d="M31,42 L37,45 L33,47 Z" fill="#ffd77a" stroke="none" />
            <path d="M49,42 L43,45 L47,47 Z" fill="#ffd77a" stroke="none" />
            <path d="M35,54 L40,58 L45,54" />
            <path d="M40,62 L40,68 M34,65 L40,68 L46,65" strokeOpacity="0.7" />
          </g>
        )}

        {bossId === 'boss-imperio' && (
          <g fill="none" stroke={`url(#bs-${uid})`} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18,62 H62 M24,62 V38 H32 V62 M48,62 V38 H56 V62 M32,62 V28 L40,20 L48,28 V62" fill={palette.a} fillOpacity="0.14" />
            <path d="M28,22 L34,14 L40,19 L46,14 L52,22" />
            <path d="M37,48 H43 V62 H37 Z" fill={palette.b} fillOpacity="0.3" />
          </g>
        )}

        {bossId === 'boss-ausente' && (
          <g fill="none" stroke={`url(#bs-${uid})`} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M24,18 H56 M24,62 H56 M27,18 C27,34 40,36 40,40 C40,44 27,46 27,62 M53,18 C53,34 40,36 40,40 C40,44 53,46 53,62" />
            <path d="M32,57 H48 L40,47 Z" fill={palette.a} fillOpacity="0.35" stroke="none" />
            <path d="M33,24 H47 L40,34 Z" fill={palette.b} fillOpacity="0.25" stroke="none" />
          </g>
        )}

        {bossId === 'boss-sedentario' && (
          <g fill="none" stroke={`url(#bs-${uid})`} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            {/* Cadenas pesadas */}
            <rect x="20" y="31" width="18" height="18" rx="7" />
            <rect x="42" y="31" width="18" height="18" rx="7" />
            <line x1="34" y1="40" x2="46" y2="40" stroke="#ffd77a" strokeWidth="3" />
            <path d="M28,56 L40,62 L52,56" strokeOpacity="0.65" />
            <path d="M28,24 L40,18 L52,24" strokeOpacity="0.65" />
          </g>
        )}

        {bossId === 'boss-torre' && (
          <g fill="none" stroke={`url(#bs-${uid})`} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M28,62 L32,26 L40,16 L48,26 L52,62 Z" fill={palette.a} fillOpacity="0.16" />
            <path d="M22,62 H58 M31,38 H49 M30,50 H50" />
            <circle cx="40" cy="30" r="3" fill={palette.b} stroke="none" />
            <path d="M18,28 Q24,25 27,28 M53,33 Q59,30 63,33" strokeOpacity="0.55" />
          </g>
        )}

        {bossId === 'rb-paralisis' && (
          <g fill="none" stroke={`url(#bs-${uid})`} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="40" cy="40" r="22" strokeDasharray="6 4" />
            <circle cx="40" cy="40" r="13" />
            <path d="M40,22 V30 M40,50 V58 M22,40 H30 M50,40 H58" />
            <circle cx="40" cy="40" r="4" fill={palette.a} />
          </g>
        )}

        {bossId === 'rb-perfeccionista' && (
          <g fill="none" stroke={`url(#bs-${uid})`} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M24,26 Q40,16 56,26 L53,50 Q40,64 27,50 Z" fill={palette.a} fillOpacity="0.16" />
            <path d="M40,20 L37,35 L43,43 L38,58" stroke="#ffd77a" />
            <circle cx="33" cy="36" r="2.2" fill={palette.b} stroke="none" />
            <circle cx="47" cy="36" r="2.2" fill={palette.b} stroke="none" />
          </g>
        )}

        {!['boss-dragon', 'boss-imperio', 'boss-ausente', 'boss-sedentario', 'boss-torre', 'rb-paralisis', 'rb-perfeccionista'].includes(bossId) && (
          <g fill="none" stroke={`url(#bs-${uid})`} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M40,18 L58,28 V45 C58,55 49,62 40,65 C31,62 22,55 22,45 V28 Z" fill={palette.a} fillOpacity="0.16" />
            <circle cx="34" cy="39" r="2.5" fill="#ffd77a" stroke="none" />
            <circle cx="46" cy="39" r="2.5" fill="#ffd77a" stroke="none" />
            <path d="M35,50 H45" />
          </g>
        )}

        {defeated && (
          <g>
            <path d="M18,62 L62,18" stroke="#34d399" strokeWidth="3.5" strokeLinecap="round" />
            <circle cx="60" cy="60" r="11" fill="#0d281f" stroke="#34d399" strokeWidth="2" />
            <path d="M55,60 L58.5,63.5 L65,56.5" fill="none" stroke="#34d399" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        )}
      </svg>
    </div>
  );
}

/** Barra de HP de jefe (muestra vida restante con segmentos y estilo de batalla). */
export function BossHpBar({ hpPct, label, right }: { hpPct: number; label: string; right?: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(hpPct)));
  return (
    <div className="boss-hp">
      <div className="boss-hp-head">
        <span className="boss-hp-label">{label}</span>
        <span className="boss-hp-val num">{right ?? `${clamped}% HP`}</span>
      </div>
      <div className="boss-hp-track" role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${clamped}%` }} />
        <span className="boss-hp-segs" aria-hidden="true">
          <b />
          <b />
          <b />
        </span>
      </div>
    </div>
  );
}
