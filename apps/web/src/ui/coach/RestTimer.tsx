import { useEffect, useRef, useState } from 'react';
import { getPrefs } from '../../lib/prefs';
import { Icon } from '../icons';

/** Cronómetro de descanso entre series: un toque lo inicia, otro lo detiene; al terminar vibra y suena suave. */
export function RestTimer({ seconds, label }: { seconds: number; label?: string }) {
  const [left, setLeft] = useState<number | null>(null);
  const end = useRef(0);
  useEffect(() => {
    if (left === null) return;
    const t = setInterval(() => {
      const s = Math.max(0, Math.ceil((end.current - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) {
        clearInterval(t);
        done();
        setTimeout(() => setLeft(null), 1500);
      }
    }, 250);
    return () => clearInterval(t);
    // Solo al iniciar o detener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left === null]);
  const start = () => {
    end.current = Date.now() + seconds * 1000;
    setLeft(seconds);
  };
  const mm = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return (
    <button type="button" className={`btn sm rest-timer ${left !== null ? 'on' : ''}`} onClick={() => (left === null ? start() : setLeft(null))} aria-label={left === null ? `Iniciar descanso de ${seconds} segundos` : 'Detener descanso'}>
      <Icon name="clock" /> {left === null ? (label ?? `Descanso ${mm(seconds)}`) : left === 0 ? '¡Va!' : mm(left)}
    </button>
  );
}

function done() {
  const p = getPrefs();
  try {
    if (p.haptics) navigator.vibrate?.([120, 80, 120]);
  } catch {
    /* sin vibración */
  }
  if (!p.sound) return;
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.55);
    setTimeout(() => void ctx.close(), 800);
  } catch {
    /* sin audio */
  }
}
