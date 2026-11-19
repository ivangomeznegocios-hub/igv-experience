import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
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

/** Dictado por voz (es-MX) usando Web Speech API nativa del navegador. */
export function useVoiceInput(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const cbRef = useRef(onTranscript);
  cbRef.current = onTranscript;

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      // ignorar
    }
    recRef.current = null;
    setListening(false);
  }, []);

  const toggle = useCallback(() => {
    if (listening) {
      stop();
      return;
    }
    const Ctor = getSpeechCtor();
    if (!Ctor) {
      setError('Tu navegador no soporta dictado por voz.');
      return;
    }
    setError(null);
    try {
      const rec = new Ctor();
      rec.lang = 'es-MX';
      rec.continuous = false;
      rec.interimResults = false;
      rec.onresult = (ev) => {
        const parts: string[] = [];
        for (let i = 0; i < ev.results.length; i++) {
          const item = ev.results[i]?.[0]?.transcript;
          if (item) parts.push(item.trim());
        }
        const text = parts.join(' ').trim();
        if (text) cbRef.current(text);
      };
      rec.onerror = (ev) => {
        if (ev.error !== 'no-speech' && ev.error !== 'aborted') {
          setError('No pude activar el micrófono.');
        }
        setListening(false);
      };
      rec.onend = () => {
        setListening(false);
        recRef.current = null;
      };
      recRef.current = rec;
      setListening(true);
      rec.start();
    } catch {
      setListening(false);
      setError('No pude iniciar el micrófono.');
    }
  }, [listening, stop]);

  useEffect(() => () => stop(), [stop]);

  return { supported: voiceSupported(), listening, error, toggle, stop };
}
