import { useEffect, useRef, useState } from 'react';
import { getPrefs } from '../../lib/prefs';
import { sfx, unlockAudio } from '../../lib/sound';
import { Icon } from '../icons';

/** Cronómetro de descanso entre series: un toque lo inicia, otro lo detiene; al terminar vibra y suena suave. */
export function RestTimer({ seconds, label }: { seconds: number; label?: string }) {
  const [left, setLeft] = useState<number | null>(null);
  const end = useRef(0);
  // El "¡Va!" se quita solo a los 1.5 s; ese temporizador se cancela al detener, al iniciar otro descanso y al
  // desmontar (si no, apagaría el descanso siguiente).
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHide = () => {
    if (hide.current !== null) clearTimeout(hide.current);
    hide.current = null;
  };
  useEffect(() => {
    if (left === null) return;
    const t = setInterval(() => {
      const s = Math.max(0, Math.ceil((end.current - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) {
        clearInterval(t);
        done();
        clearHide();
        hide.current = setTimeout(() => {
          hide.current = null;
          setLeft(null);
        }, 1500);
      }
    }, 250);
    return () => clearInterval(t);
    // Solo al iniciar o detener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left === null]);
  useEffect(() => clearHide, []);
  const start = () => {
    clearHide();
    // Dentro del toque: así el aviso del final sí suena en iPhone.
    unlockAudio();
    end.current = Date.now() + seconds * 1000;
    setLeft(seconds);
  };
  const stop = () => {
    clearHide();
    setLeft(null);
  };
  const mm = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return (
    <button type="button" className={`btn sm rest-timer ${left !== null ? 'on' : ''}`} onClick={() => (left === null ? start() : stop())} aria-label={left === null ? `Iniciar descanso de ${seconds} segundos` : 'Detener descanso'}>
      <Icon name="clock" /> {left === null ? (label ?? `Descanso ${mm(seconds)}`) : left === 0 ? '¡Va!' : mm(left)}
    </button>
  );
}

/** Fin del descanso: vibra y suena con el audio compartido de la app (respeta tus preferencias). */
function done() {
  try {
    if (getPrefs().haptics) navigator.vibrate?.([120, 80, 120]);
  } catch {
    /* sin vibración */
  }
  sfx.restDone();
}
