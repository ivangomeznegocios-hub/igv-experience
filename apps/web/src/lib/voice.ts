import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * Dictado por voz (es-MX) con la Web Speech API del navegador (`SpeechRecognition` / `webkitSpeechRecognition`:
 * Chrome en Android y escritorio, Safari en iPhone 14.5+).
 *
 * - Escucha de corrido con texto en vivo (`interim`) y acumula lo final (`onFinal`).
 * - El navegador corta solo tras unos segundos de silencio: si no tocaste "detener", se reinicia solo.
 * - En Android se usa modo no continuo + reinicio, porque Chrome Android repite resultados en modo continuo.
 * - Al detener se espera el último resultado (`stopAndFlush`) para no perder las últimas palabras.
 * - Errores claros en español (permiso, sin micrófono, sin internet, navegador sin dictado).
 * - Solo un dictado a la vez en toda la app.
 */

interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  isFinal: boolean;
  length: number;
  [i: number]: SpeechAlternative;
}
interface SpeechEventLike {
  resultIndex?: number;
  results: ArrayLike<SpeechResult>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechCtor = new () => SpeechRecognitionLike;

function getSpeechCtor(): SpeechCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function voiceSupported(): boolean {
  return getSpeechCtor() !== null;
}

const isAndroid = () => typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);

export type VoiceErrorCode = 'no-support' | 'permission' | 'no-mic' | 'network' | 'language' | 'other';

export const VOICE_ERRORS: Record<VoiceErrorCode, string> = {
  'no-support': 'Este navegador no tiene dictado por voz. Usa el micrófono de tu teclado o escribe.',
  permission: 'Permite el micrófono para dictar: toca el candado junto a la dirección → Micrófono → Permitir. En iPhone, activa también Dictado en Ajustes → General → Teclado.',
  'no-mic': 'No encontré un micrófono. Revisa que no lo esté usando otra app.',
  network: 'El dictado de este navegador necesita internet. Usa el micrófono de tu teclado o escribe; se guarda igual.',
  language: 'Este navegador no tiene dictado en ese idioma.',
  other: 'No pude usar el micrófono. Intenta de nuevo.',
};

export interface VoiceState {
  listening: boolean;
  /** Lo que estás diciendo y aún no es definitivo. */
  interim: string;
  error: string | null;
  code: VoiceErrorCode | null;
}

const IDLE: VoiceState = { listening: false, interim: '', error: null, code: null };
let active: Dictation | null = null;

/** Un dictado. Se usa con `useDictation` o directamente (el botón global inicia el dictado dentro del toque). */
export class Dictation {
  private rec: SpeechRecognitionLike | null = null;
  private want = false;
  private fatal = false;
  private restarts: number[] = [];
  /** La sesión actual se abrió sola (reinicio tras silencio), no con un toque. */
  private auto = false;
  private sessionFinal = '';
  private stopInterim = '';
  private gotFinalSinceStop = false;
  private buffered: string[] = [];
  private waiters: (() => void)[] = [];
  private snap: VoiceState = IDLE;
  private listeners = new Set<() => void>();
  private onFinalCb: ((text: string) => void) | null = null;

  /** `lang`: idioma del dictado (es-MX por defecto; en-US para frases en inglés). */
  constructor(readonly lang = 'es-MX') {}

  get state(): VoiceState {
    return this.snap;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  /** Recibe cada pedazo final de texto. Lo que llegó antes de conectarse se entrega al conectarse. */
  setOnFinal(fn: ((text: string) => void) | null) {
    this.onFinalCb = fn;
    if (fn && this.buffered.length) {
      const b = this.buffered.splice(0);
      b.forEach((t) => fn(t));
    }
  }

  private set(patch: Partial<VoiceState>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((f) => f());
  }

  private emitFinal(raw: string) {
    let t = raw.replace(/\s+/g, ' ').trim();
    if (!t) return;
    // Algunos navegadores (Chrome Android) repiten lo anterior dentro de la misma sesión: solo se agrega lo nuevo.
    // Repetir exactamente lo mismo solo se descarta en Android (en otros navegadores puede ser que lo dijiste dos veces).
    const prev = this.sessionFinal;
    const low = t.toLowerCase();
    const p = prev.toLowerCase();
    if (prev && (low.length > p.length ? low.startsWith(p) : low === p && isAndroid())) t = t.slice(prev.length).trim();
    this.sessionFinal = raw.replace(/\s+/g, ' ').trim();
    if (!t) return;
    this.gotFinalSinceStop = true;
    if (this.onFinalCb) this.onFinalCb(t);
    else this.buffered.push(t);
  }

  private fail(code: VoiceErrorCode) {
    this.fatal = true;
    this.want = false;
    this.set({ error: VOICE_ERRORS[code], code });
  }

  /** Empieza a escuchar. Llámalo dentro de un toque (los navegadores lo exigen para pedir el micrófono). */
  start(): boolean {
    const Ctor = getSpeechCtor();
    if (!Ctor) {
      this.set({ error: VOICE_ERRORS['no-support'], code: 'no-support' });
      return false;
    }
    if (active && active !== this) active.abort();
    active = this;
    if (this.rec) {
      // Volviste a tocar mientras se estaba deteniendo: sigue escuchando (se reinicia al cerrar la sesión).
      if (!this.want) {
        this.want = true;
        this.fatal = false;
        this.stopInterim = '';
        this.set({ listening: true });
      }
      return true;
    }
    this.want = true;
    this.fatal = false;
    this.restarts = [];
    this.set({ error: null, code: null, interim: '' });
    try {
      this.auto = false;
      this.spawn(Ctor);
      return true;
    } catch {
      this.want = false;
      this.set({ ...IDLE, error: VOICE_ERRORS.other, code: 'other' });
      return false;
    }
  }

  private spawn(Ctor: SpeechCtor) {
    const rec = new Ctor();
    rec.lang = this.lang;
    rec.continuous = !isAndroid();
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    this.sessionFinal = '';
    rec.onresult = (ev) => {
      let interim = '';
      const finals: string[] = [];
      for (let i = ev.resultIndex ?? 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        const t = r?.[0]?.transcript ?? '';
        if (r?.isFinal) finals.push(t);
        else interim += t;
      }
      if (finals.length) this.emitFinal(finals.join(' '));
      this.set({ interim: interim.replace(/\s+/g, ' ').trim() });
    };
    rec.onerror = (ev) => {
      switch (ev.error) {
        case 'no-speech':
        case 'aborted':
          return; // se reinicia (o se cierra) en onend
        case 'not-allowed':
        case 'service-not-allowed':
          // Algunos navegadores (Safari) no dejan reiniciar sin un toque: se detiene sin asustar con un error.
          if (this.auto) {
            this.want = false;
            return;
          }
          return this.fail('permission');
        case 'audio-capture':
          return this.fail('no-mic');
        case 'network':
          return this.fail('network');
        case 'language-not-supported':
          return this.fail('language');
        default:
          return this.fail('other');
      }
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.rec = null;
      if (this.want && !this.fatal) {
        // El navegador cortó por silencio: se reinicia, salvo que se esté reiniciando en ciclo.
        const now = Date.now();
        this.restarts = this.restarts.filter((t) => now - t < 8000);
        this.restarts.push(now);
        if (this.restarts.length <= 6) {
          try {
            this.auto = true;
            this.spawn(Ctor);
            return;
          } catch {
            // cae al cierre normal
          }
        }
      }
      // Safari a veces no entrega como final lo último que dijiste antes de detener.
      if (!this.want && this.stopInterim && !this.gotFinalSinceStop) this.emitFinal(this.stopInterim);
      this.stopInterim = '';
      this.want = false;
      if (active === this) active = null;
      this.set({ listening: false, interim: '' });
      this.waiters.splice(0).forEach((w) => w());
    };
    this.rec = rec;
    rec.start();
    this.set({ listening: true });
  }

  /** Deja de escuchar (lo que ya dijiste todavía llega como final). */
  stop() {
    this.want = false;
    this.stopInterim = this.snap.interim;
    this.gotFinalSinceStop = false;
    if (!this.rec) {
      this.set({ listening: false, interim: '' });
      return;
    }
    try {
      this.rec.stop();
    } catch {
      this.abort();
    }
  }

  /** Detiene y espera el último resultado (máx. 1.5 s). */
  stopAndFlush(): Promise<void> {
    if (!this.rec) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== done);
        if (this.stopInterim && !this.gotFinalSinceStop) this.emitFinal(this.stopInterim);
        this.stopInterim = '';
        resolve();
      }, 1500);
      this.waiters.push(done);
      this.stop();
    });
  }

  /** Corta sin esperar resultados. */
  abort() {
    this.want = false;
    const rec = this.rec;
    this.rec = null;
    try {
      rec?.abort();
    } catch {
      // ignorar
    }
    if (active === this) active = null;
    this.set({ listening: false, interim: '' });
    this.waiters.splice(0).forEach((w) => w());
  }

  toggle() {
    if (this.snap.listening) this.stop();
    else this.start();
  }

  clearError() {
    if (this.snap.error) this.set({ error: null, code: null });
  }
}

/**
 * Dictado para un campo o pantalla. `onFinal` recibe cada pedazo de texto definitivo.
 * Pasa `instance` para compartir un dictado ya iniciado (p. ej. el botón global "Hablar").
 */
export function useDictation(onFinal: (text: string) => void, instance?: Dictation, lang = 'es-MX') {
  const own = useRef<Dictation | null>(null);
  if (!instance && (!own.current || own.current.lang !== lang)) {
    own.current?.abort();
    own.current = new Dictation(lang);
  }
  const d = instance ?? own.current!;
  const cb = useRef(onFinal);
  cb.current = onFinal;
  useEffect(() => {
    d.setOnFinal((t) => cb.current(t));
    return () => {
      d.setOnFinal(null);
      if (!instance) d.abort();
    };
  }, [d, instance]);
  const state = useSyncExternalStore(d.subscribe, () => d.state, () => IDLE);
  const start = useCallback(() => d.start(), [d]);
  const stop = useCallback(() => d.stop(), [d]);
  const toggle = useCallback(() => d.toggle(), [d]);
  const flush = useCallback(() => d.stopAndFlush(), [d]);
  return { supported: voiceSupported(), ...state, start, stop, toggle, flush, dictation: d };
}

/**
 * Detiene el dictado que esté en curso (en cualquier campo) y espera su último resultado. Útil antes de enviar
 * un formulario cuyo campo tiene micrófono integrado, para no perder las últimas palabras.
 */
export function flushActiveDictation(): Promise<void> {
  return active ? active.stopAndFlush() : Promise.resolve();
}

/** Une texto dictado a lo que ya había ("Fui al gym" + "y leí" → "Fui al gym y leí"). */
export function appendSpeech(prev: string, add: string): string {
  const a = add.trim();
  if (!a) return prev;
  const p = prev.replace(/\s+$/, '');
  if (!p) return a.charAt(0).toUpperCase() + a.slice(1);
  return `${p}${/[.!?]$/.test(p) ? ' ' + a.charAt(0).toUpperCase() + a.slice(1) : ' ' + a}`;
}
