import { getPrefs } from './prefs';

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/**
 * Crea o reanuda el audio compartido DENTRO de un toque: iOS deja suspendido un audio que nace fuera de un gesto,
 * así que lo que suena después solo (p. ej. el fin de un descanso) necesita que se haya desbloqueado antes.
 */
export function unlockAudio() {
  try {
    audio();
  } catch {
    /* sin audio */
  }
}

function tone(freq: number, start: number, dur: number, gain = 0.08, type: OscillatorType = 'triangle', endFreq?: number) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  const t = a.currentTime + start;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.06);
}

/** Sonidos de feedback sintetizados (sin archivos externos). Se pueden apagar en Ajustes. */
export const sfx = {
  xp(amount: number) {
    if (!getPrefs().sound) return;
    const big = amount >= 100;
    tone(587.3, 0, 0.14, 0.07, 'triangle');
    tone(880, 0.06, big ? 0.34 : 0.2, 0.08, 'triangle');
    if (big) {
      tone(1174.7, 0.14, 0.42, 0.07, 'sine');
      tone(1760, 0.22, 0.45, 0.04, 'sine');
    }
  },
  levelUp() {
    if (!getPrefs().sound) return;
    const notes = [392, 523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => tone(f, i * 0.095, 0.55, 0.085, 'triangle'));
    tone(1567.98, 0.48, 0.95, 0.055, 'sine');
    tone(261.63, 0, 0.9, 0.06, 'sine');
  },
  achievement() {
    if (!getPrefs().sound) return;
    // Fanfarria metálica estilo trofeo desbloqueado
    tone(659.25, 0, 0.16, 0.07, 'triangle');
    tone(987.77, 0.1, 0.22, 0.08, 'triangle');
    tone(1318.5, 0.22, 0.5, 0.08, 'sine');
    tone(1975.5, 0.26, 0.55, 0.035, 'sine');
  },
  bossHit() {
    if (!getPrefs().sound) return;
    // Avance en un reto: pulso grave + brillo corto
    tone(150, 0, 0.22, 0.14, 'sawtooth', 48);
    tone(920, 0.03, 0.14, 0.05, 'triangle', 520);
  },
  bossDefeat() {
    if (!getPrefs().sound) return;
    tone(130.81, 0, 0.85, 0.11, 'sawtooth', 98);
    [392, 493.88, 587.33, 783.99].forEach((f, i) => tone(f, 0.15 + i * 0.11, 0.7, 0.08, 'triangle'));
    tone(1174.66, 0.62, 1.0, 0.06, 'sine');
  },
  questStart() {
    if (!getPrefs().sound) return;
    tone(440, 0, 0.14, 0.06, 'triangle', 660);
    tone(880, 0.08, 0.24, 0.05, 'sine');
  },
  perfectDay() {
    if (!getPrefs().sound) return;
    [523.25, 659.25, 783.99, 987.77, 1046.5].forEach((f, i) => tone(f, i * 0.075, 0.45, 0.07, 'sine'));
  },
  coin() {
    if (!getPrefs().sound) return;
    tone(1174.7, 0, 0.07, 0.055, 'triangle');
    tone(1760, 0.06, 0.22, 0.055, 'sine');
  },
  undo() {
    if (!getPrefs().sound) return;
    tone(440, 0, 0.12, 0.05, 'triangle', 330);
  },
  /** Fin del descanso entre series: un tono suave. */
  restDone() {
    if (!getPrefs().sound) return;
    tone(880, 0, 0.5, 0.08, 'sine');
  },
};

export function haptic(pattern: number | number[]) {
  if (getPrefs().haptics && typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(pattern);
}

// ---------- Sonido ambiente sintetizado para Modo enfoque (fuego / lluvia) ----------
export type AmbientMode = 'off' | 'fire' | 'rain';
let ambientNodes: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

export function stopAmbient() {
  if (!ambientNodes) return;
  try {
    ambientNodes.src.stop();
    ambientNodes.src.disconnect();
    ambientNodes.gain.disconnect();
  } catch {
    // ignorar
  }
  ambientNodes = null;
}

export function setAmbientSound(mode: AmbientMode) {
  stopAmbient();
  if (mode === 'off') return;
  const a = audio();
  if (!a) return;
  const len = a.sampleRate * 3;
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    // Ruido marrón suave para fuego o rosa/bandpass para lluvia
    last = (last + 0.04 * white) / 1.04;
    data[i] = mode === 'fire' ? last * 2.6 + (Math.random() > 0.9985 ? (Math.random() * 2 - 1) * 0.45 : 0) : (last * 1.4 + white * 0.18);
  }
  const src = a.createBufferSource();
  src.buffer = buf;
  src.loop = true;

  const filter = a.createBiquadFilter();
  filter.type = mode === 'fire' ? 'lowpass' : 'bandpass';
  filter.frequency.value = mode === 'fire' ? 420 : 1200;
  filter.Q.value = mode === 'fire' ? 0.7 : 0.6;

  const gain = a.createGain();
  gain.gain.value = mode === 'fire' ? 0.12 : 0.06;

  src.connect(filter).connect(gain).connect(a.destination);
  src.start();
  ambientNodes = { src, gain };
}
