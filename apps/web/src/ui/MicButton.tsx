import { useDictation } from '../lib/voice';
import { Icon } from './icons';
import '../styles/voz.css';

/**
 * Micrófono para un campo de texto: devuelve el botón (va junto al campo) y una línea con lo que estás diciendo
 * o el error (va debajo). Si el navegador no tiene dictado, no hay botón (el teclado del celular tiene el suyo).
 */
export function useFieldMic(onText: (text: string) => void, label = 'Dictar por voz') {
  const v = useDictation(onText);
  const button = v.supported ? (
    <button
      type="button"
      className={`btn icon vz-field-mic ${v.listening ? 'on' : ''}`}
      onClick={v.toggle}
      aria-label={v.listening ? 'Terminar dictado' : label}
      aria-pressed={v.listening}
      title={v.listening ? 'Terminar dictado' : label}
    >
      <Icon name={v.listening ? 'stop' : 'mic'} />
    </button>
  ) : null;
  const hint = v.error ? <div className="vz-hint err">{v.error}</div> : v.interim ? <div className="vz-hint">{v.interim}…</div> : v.listening ? <div className="vz-hint">Te escucho…</div> : null;
  return { button, hint, listening: v.listening, stop: v.stop };
}
