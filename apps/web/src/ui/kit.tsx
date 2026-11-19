import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ATTRIBUTE_IDS, ATTRIBUTE_NAMES, MISSION_SIZE_NAMES, MISSION_SIZES, GAME_CONFIG, type AttributeId, type MissionSize } from '@igv/core';
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
type Toast = { id: number; text: string; kind?: 'error' | 'xp' | 'info' };
const toastListeners = new Set<(t: Toast) => void>();
let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info') {
  const t = { id: ++toastId, text, kind };
  toastListeners.forEach((l) => l(t));
}

export function Toasts() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const l = (t: Toast) => {
      setItems((xs) => [...xs, t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.kind === 'error' ? 5000 : 2600);
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
