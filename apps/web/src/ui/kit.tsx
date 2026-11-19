import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ATTRIBUTE_IDS, ATTRIBUTE_NAMES, MISSION_SIZE_NAMES, MISSION_SIZES, GAME_CONFIG, addDays, type AttributeId, type MissionSize } from '@igv/core';
import { Icon } from './icons';

export function Bar({ value, max = 1, tone, size, label }: { value: number; max?: number; tone?: string; size?: 'sm' | 'lg'; label?: ReactNode }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div>
      <div className={`bar ${tone ?? ''} ${size ?? ''}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${pct}%` }} />
      </div>
      {label && <div className="bar-label">{label}</div>}
    </div>
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone ?? ''}`}>{children}</span>;
}

export function SizeBadge({ size }: { size: MissionSize }) {
  return (
    <span className={`badge size-${size}`}>
      {MISSION_SIZE_NAMES[size]} · {GAME_CONFIG.missionXp[size]} XP
    </span>
  );
}

export function AttrBadge({ attr }: { attr: AttributeId | null | undefined }) {
  if (!attr) return null;
  return <span className="badge">{ATTRIBUTE_NAMES[attr]}</span>;
}

export function PageHeader({ title, eyebrow, right }: { title: string; eyebrow?: string; right?: ReactNode }) {
  return (
    <div className="topbar">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
      </div>
      {right}
    </div>
  );
}

export function Sheet({ open, onClose, title, children, actions }: { open: boolean; onClose: () => void; title: string; children: ReactNode; actions?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="Cerrar">
            <Icon name="x" />
          </button>
        </div>
        <div style={{ marginTop: 12 }}>{children}</div>
        {actions && <div className="sheet-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function AttrSelect({ value, onChange }: { value: AttributeId; onChange: (v: AttributeId) => void }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value as AttributeId)}>
      {ATTRIBUTE_IDS.map((a) => (
        <option key={a} value={a}>
          {ATTRIBUTE_NAMES[a]}
        </option>
      ))}
    </select>
  );
}

export function SizeSelect({ value, onChange }: { value: MissionSize; onChange: (v: MissionSize) => void }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value as MissionSize)}>
      {MISSION_SIZES.map((s) => (
        <option key={s} value={s}>
          {MISSION_SIZE_NAMES[s]} ({GAME_CONFIG.missionXp[s]} XP)
        </option>
      ))}
    </select>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

// ---------- Toasts ----------
type Toast = { id: number; text: string; kind?: 'error' | 'xp' | 'info'; action?: { label: string; run: () => void } };
const toastListeners = new Set<(t: Toast) => void>();
let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action']) {
  const t = { id: ++toastId, text, kind, action };
  toastListeners.forEach((l) => l(t));
}
/** Aviso con botón "Deshacer" (5 s). */
export function undoToast(text: string, undo: () => void) {
  toast(text, 'info', { label: 'Deshacer', run: undo });
}

export function Toasts() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const l = (t: Toast) => {
      setItems((xs) => [...xs, t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.kind === 'error' || t.action ? 5000 : 2600);
    };
    toastListeners.add(l);
    return () => {
      toastListeners.delete(l);
    };
  }, []);
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind ?? ''}`}>
          {t.text}
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.run();
                setItems((xs) => xs.filter((x) => x.id !== t.id));
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Confirmación nativa simple (rápida en celular). */
export function confirmAction(msg: string): boolean {
  return window.confirm(msg);
}

export function useAutoFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);
  return ref;
}

// ---------- Chips (selección con botones) ----------
export function Chips<T extends string | number>({
  value,
  onChange,
  options,
  size,
}: {
  value: T | null;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; tone?: string }[];
  size?: 'lg';
}) {
  return (
    <div className={`chips ${size ?? ''}`} role="radiogroup">
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} className={`chip ${o.value === value ? 'on' : ''} ${o.tone ?? ''}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SizeChips({ value, onChange }: { value: MissionSize; onChange: (v: MissionSize) => void }) {
  return (
    <Chips
      value={value}
      onChange={onChange}
      options={MISSION_SIZES.map((s) => ({ value: s, label: <>{MISSION_SIZE_NAMES[s]} <small>{GAME_CONFIG.missionXp[s]}</small></>, tone: `size-${s}` }))}
    />
  );
}

const ATTR_SHORT: Record<AttributeId, string> = {
  fuerza: 'Fuerza',
  inteligencia: 'Intelig.',
  carisma: 'Carisma',
  finanzas: 'Finanzas',
  disciplina: 'Disciplina',
  relaciones: 'Relaciones',
  creatividad: 'Creativ.',
};
export function AttrChips({ value, onChange }: { value: AttributeId; onChange: (v: AttributeId) => void }) {
  return <Chips value={value} onChange={onChange} options={ATTRIBUTE_IDS.map((a) => ({ value: a, label: ATTR_SHORT[a] }))} />;
}

/** Elegir el día de un registro: Hoy · Ayer · Antier · otro. */
export function DateChips({ value, onChange, today }: { value: string; onChange: (d: string) => void; today: string }) {
  const y = addDays(today, -1);
  const y2 = addDays(today, -2);
  const other = value !== today && value !== y && value !== y2;
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      <Chips
        value={other ? null : value}
        onChange={onChange}
        options={[
          { value: today, label: 'Hoy' },
          { value: y, label: 'Ayer' },
          { value: y2, label: 'Antier' },
        ]}
      />
      <input className={`input date-mini ${other ? 'on' : ''}`} type="date" max={today} value={value} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label="Otro día" />
    </div>
  );
}

// ---------- Fila deslizable (deslizar a la derecha = completar, a la izquierda = acción secundaria) ----------
export function SwipeRow({
  children,
  onRight,
  onLeft,
  rightLabel = 'Hecho',
  leftLabel,
  className,
}: {
  children: ReactNode;
  onRight?: () => void;
  onLeft?: () => void;
  rightLabel?: string;
  leftLabel?: string;
  className?: string;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; locked: 'x' | 'y' | null } | null>(null);
  const TH = 80;
  const end = () => {
    if (dx > TH && onRight) onRight();
    else if (dx < -TH && onLeft) onLeft();
    setDx(0);
    start.current = null;
  };
  return (
    <div className={`swipe ${className ?? ''}`}>
      {onRight && dx > 0 && (
        <div className={`swipe-bg right ${dx > TH ? 'armed' : ''}`}>
          <Icon name="check" /> {rightLabel}
        </div>
      )}
      {onLeft && dx < 0 && (
        <div className={`swipe-bg left ${dx < -TH ? 'armed' : ''}`}>
          {leftLabel} <Icon name="right" />
        </div>
      )}
      <div
        className="swipe-fg"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dx ? 'none' : undefined }}
        onTouchStart={(e) => {
          const t = e.touches[0];
          start.current = { x: t.clientX, y: t.clientY, locked: null };
        }}
        onTouchMove={(e) => {
          const s = start.current;
          if (!s) return;
          const t = e.touches[0];
          const mx = t.clientX - s.x;
          const my = t.clientY - s.y;
          if (!s.locked) {
            if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
            s.locked = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
          }
          if (s.locked !== 'x') return;
          const v = mx > 0 ? (onRight ? mx : 0) : onLeft ? mx : 0;
          setDx(Math.max(-140, Math.min(140, v)));
        }}
        onTouchEnd={end}
        onTouchCancel={() => {
          setDx(0);
          start.current = null;
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Contenido que se muestra/oculta. */
export function Collapse({ title, children, defaultOpen = false, right }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card">
      <div className="card-head" style={{ marginBottom: open ? 10 : 0 }}>
        <button className="collapse-btn" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
          <Icon name={open ? 'down' : 'right'} width={16} /> <h2 style={{ margin: 0 }}>{title}</h2>
        </button>
        {right}
      </div>
      {open && children}
    </div>
  );
}
