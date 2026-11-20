/** Preferencias de este dispositivo (no se sincronizan). */
export interface Prefs {
  sound: boolean;
  haptics: boolean;
  notify: { enabled: boolean; morning: string; evening: string; npcs: boolean; weekly: boolean };
  /** Cerraste la hoja de bienvenida sin guardar fecha (no volver a mostrarla en este dispositivo). */
  welcomeDismissed?: boolean;
}

const KEY = 'igv-prefs';
const DEFAULTS: Prefs = { sound: true, haptics: true, notify: { enabled: false, morning: '08:30', evening: '21:00', npcs: true, weekly: true } };

export function getPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return { ...DEFAULTS, ...p, notify: { ...DEFAULTS.notify, ...(p.notify ?? {}) } };
  } catch {
    return DEFAULTS;
  }
}

export function setPrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...getPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // sin almacenamiento: solo en esta sesión
  }
  return next;
}
