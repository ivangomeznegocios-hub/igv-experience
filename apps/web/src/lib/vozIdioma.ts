import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Voz para practicar idiomas (Aprendizaje): reconocimiento en el idioma que aprendes (en-US por defecto) con
 * resultados parciales, y lectura en voz alta (síntesis del navegador) para escuchar cómo se dice.
 * Independiente del dictado en español de lib/voice.ts.
 */

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean } & ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

function ctor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const listenSupported = () => ctor() !== null;
export const speakSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Lee un texto en voz alta en el idioma indicado. */
export function speak(text: string, lang = 'en-US', rate = 0.95) {
  if (!speakSupported() || !text.trim()) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = rate;
    const base = lang.slice(0, 2).toLowerCase();
    const voice = synth.getVoices().find((v) => v.lang === lang) ?? synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(base));
    if (voice) u.voice = voice;
    synth.speak(u);
  } catch {
    // sin voz disponible
  }
}

/**
 * Escucha una frase en `lang`. `onFinal` recibe lo que dijo (texto final). `interim` muestra lo que va entendiendo.
 */
export function useListen(lang: string, onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<RecognitionLike | null>(null);
  const cb = useRef(onFinal);
  cb.current = onFinal;

  const stop = useCallback(() => {
    try {
      rec.current?.stop();
    } catch {
      // ya estaba detenido
    }
  }, []);

  const start = useCallback(() => {
    const C = ctor();
    if (!C) {
      setError('Tu navegador no reconoce voz. Escribe tu respuesta.');
      return;
    }
    try {
      rec.current?.abort();
    } catch {
      // nada
    }
    setError(null);
    setInterim('');
    const r = new C();
    r.lang = lang;
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 1;
    let finalText = '';
    r.onresult = (ev) => {
      let partial = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const t = res[0]?.transcript ?? '';
        if (res.isFinal) finalText = `${finalText} ${t}`.trim();
        else partial += t;
      }
      setInterim(`${finalText} ${partial}`.trim());
    };
    r.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') setError('Permite el micrófono para practicar en voz alta.');
      else if (ev.error !== 'no-speech' && ev.error !== 'aborted') setError('No pude escucharte. Intenta otra vez.');
    };
    r.onend = () => {
      setListening(false);
      rec.current = null;
      if (finalText) cb.current(finalText);
    };
    rec.current = r;
    setListening(true);
    try {
      r.start();
    } catch {
      setListening(false);
      setError('No pude iniciar el micrófono.');
    }
  }, [lang]);

  useEffect(
    () => () => {
      try {
        rec.current?.abort();
      } catch {
        // nada
      }
      if (speakSupported()) window.speechSynthesis.cancel();
    },
    [],
  );

  return { supported: listenSupported(), listening, interim, error, start, stop, toggle: () => (listening ? stop() : start()) };
}
