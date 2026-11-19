import { getPrefs } from './prefs';

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq: number, start: number, dur: number, gain = 0.08, type: OscillatorType = 'triangle') {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = a.currentTime + start;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** Sonidos cortos sintetizados (sin archivos). Se pueden apagar en Ajustes. */
export const sfx = {
  xp(amount: number) {
    if (!getPrefs().sound) return;
    const big = amount >= 100;
    tone(660, 0, 0.12);
    tone(990, 0.07, big ? 0.3 : 0.18);
    if (big) tone(1320, 0.16, 0.35, 0.06);
  },
  levelUp() {
    if (!getPrefs().sound) return;
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.45, 0.09));
    tone(1568, 0.5, 0.8, 0.05, 'sine');
  },
  coin() {
    if (!getPrefs().sound) return;
    tone(1200, 0, 0.08, 0.06, 'square');
    tone(1800, 0.06, 0.18, 0.05, 'square');
  },
  undo() {
    if (!getPrefs().sound) return;
    tone(440, 0, 0.12, 0.05);
  },
};

export function haptic(pattern: number | number[]) {
  if (getPrefs().haptics && typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(pattern);
}
