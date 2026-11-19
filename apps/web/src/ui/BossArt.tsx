import { Icon } from './icons';

/** Ícono por reto conocido (ids fijos del seed); los personalizados usan una bandera. */
const RETO_ICON: Record<string, string> = {
  'boss-dragon': 'coin',
  'boss-imperio': 'step',
  'boss-ausente': 'heart',
  'boss-sedentario': 'bolt',
  'boss-torre': 'globe',
  'rb-paralisis': 'clock',
  'rb-perfeccionista': 'target',
};

/**
 * Ícono sobrio de un gran reto (principal, recurrente o personalizado): mosaico redondeado con su ícono.
 * Opcional: `progress` (0–100) dibuja un anillo de avance alrededor. Superado → verde con ✓; bloqueado → gris con candado.
 */
export function BossArt({
  bossId,
  size = 58,
  defeated = false,
  locked = false,
  progress,
}: {
  bossId: string;
  size?: number;
  defeated?: boolean;
  locked?: boolean;
  progress?: number;
}) {
  const icon = RETO_ICON[bossId] ?? 'flag';
  const pct = progress === undefined ? null : Math.max(0, Math.min(100, Math.round(progress)));
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <div
      className={`boss-art ${defeated ? 'defeated' : ''} ${locked ? 'locked' : ''} ${pct !== null ? 'ringed' : ''}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {pct !== null && (
        <svg className="boss-art-ring" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="4" />
          <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(c * pct) / 100} ${c}`} />
        </svg>
      )}
      <Icon name={icon} />
      {(defeated || locked) && (
        <span className="boss-art-badge">
          <Icon name={defeated ? 'check' : 'lock'} strokeWidth={2.4} />
        </span>
      )}
    </div>
  );
}

/**
 * Barra de avance de un reto, segmentada. Recibe lo que FALTA (`hpPct`, 0–100; se conserva el nombre de la
 * prop para no romper a quien la usa) y pinta el avance = 100 − hpPct.
 */
export function BossHpBar({ hpPct, label, right }: { hpPct: number; label: string; right?: string }) {
  const remaining = Math.max(0, Math.min(100, Math.round(hpPct)));
  const done = 100 - remaining;
  return (
    <div className="boss-hp">
      <div className="boss-hp-head">
        <span className="boss-hp-label">{label}</span>
        <span className="boss-hp-val num">{right ?? `${done}% de avance`}</span>
      </div>
      <div className="boss-hp-track" role="progressbar" aria-label="Avance" aria-valuenow={done} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${done}%` }} />
        <span className="boss-hp-segs" aria-hidden="true">
          <b />
          <b />
          <b />
          <b />
        </span>
      </div>
    </div>
  );
}
