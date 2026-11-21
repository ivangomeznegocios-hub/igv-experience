import { forwardRef, useImperativeHandle, useRef, type CSSProperties, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { appendSpeech, useDictation } from '../lib/voice';
import { Icon } from './icons';
import '../styles/voz.css';

/**
 * Campos de texto con micrófono integrado (dictado por voz). Son reemplazo directo de `<input>` y `<textarea>`:
 * mismos props (`value` + `onChange`, o `defaultValue`), y el texto dictado se agrega al final disparando un
 * `input` nativo, así que `onChange` recibe el valor nuevo como si lo hubieras tecleado.
 *
 * - Un toque al micrófono dicta, otro lo detiene. Lo que estás diciendo se ve debajo del campo.
 * - `lang` = idioma del dictado (y del campo): `es-MX` por defecto, `en-US` para frases en inglés.
 * - `voice={false}` lo quita. Tampoco aparece en campos de correo, URL, contraseña o número, ni si el navegador
 *   no tiene dictado (el teclado del celular tiene el suyo).
 */

type Common = { lang?: string; voice?: boolean; voiceLabel?: string };
export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & Common;
export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & Common;

const NO_VOICE_TYPES = new Set(['email', 'url', 'password', 'number', 'tel', 'date', 'time', 'datetime-local', 'month', 'week', 'color', 'range', 'file', 'checkbox', 'radio', 'hidden']);
/** Propiedades de estilo que acomodan el campo en su fila: van en el contenedor, no en el campo. */
const LAYOUT_KEYS = ['flex', 'flexGrow', 'flexShrink', 'flexBasis', 'width', 'minWidth', 'maxWidth', 'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'alignSelf', 'gridColumn'] as const;

function splitStyle(style: CSSProperties | undefined): [CSSProperties | undefined, CSSProperties | undefined] {
  if (!style) return [undefined, undefined];
  const wrap: Record<string, unknown> = {};
  const inner: Record<string, unknown> = { ...style };
  for (const k of LAYOUT_KEYS) {
    if (k in inner) {
      wrap[k] = inner[k];
      delete inner[k];
    }
  }
  return [Object.keys(wrap).length ? (wrap as CSSProperties) : undefined, inner as CSSProperties];
}

/**
 * Agrega texto al final del campo como si lo hubieras escrito (React recibe su `onChange`). Respeta `maxLength`:
 * el navegador solo lo aplica a lo que tecleas, no a lo que se escribe desde código.
 */
export function appendToField(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  let next = appendSpeech(el.value, text);
  if (el.maxLength > 0 && next.length > el.maxLength) next = next.slice(0, el.maxLength);
  if (next === el.value) return;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, next);
  else el.value = next;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  if (el instanceof HTMLTextAreaElement) el.scrollTop = el.scrollHeight;
}

function useMic(target: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>, lang: string, enabled: boolean, label: string, multiline: boolean) {
  const v = useDictation(
    (t) => {
      const el = target.current;
      if (el) appendToField(el, t);
    },
    undefined,
    lang,
  );
  if (!enabled || !v.supported) return { button: null, hint: null, listening: false };
  const button = (
    <button
      type="button"
      className={`vf-mic ${multiline ? 'top' : ''} ${v.listening ? 'on' : ''}`}
      // Que el toque no le quite el foco al campo (el teclado del celular no se cierra y abre de nuevo).
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        v.toggle();
      }}
      aria-label={v.listening ? 'Terminar dictado' : label}
      aria-pressed={v.listening}
      title={v.listening ? 'Terminar dictado' : label}
    >
      <Icon name={v.listening ? 'stop' : 'mic'} />
    </button>
  );
  const hint = v.error ? (
    <span className="vf-hint err" role="alert">
      {v.error}
    </span>
  ) : v.interim ? (
    <span className="vf-hint">{v.interim}…</span>
  ) : v.listening ? (
    <span className="vf-hint">{lang.startsWith('en') ? 'Te escucho (en inglés)…' : 'Te escucho…'}</span>
  ) : null;
  return { button, hint, listening: v.listening };
}

/** `<input>` de texto con micrófono. */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput({ lang = 'es-MX', voice = true, voiceLabel = 'Dictar por voz', style, className, type, ...rest }, ref) {
  const inner = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLInputElement);
  const enabled = voice && !rest.disabled && !rest.readOnly && !NO_VOICE_TYPES.has(type ?? 'text');
  const mic = useMic(inner, lang, enabled, voiceLabel, false);
  const [wrapStyle, inputStyle] = splitStyle(style);
  return (
    <span className={`vf ${mic.button ? 'has-mic' : ''} ${mic.listening ? 'listening' : ''}`} style={wrapStyle}>
      <input ref={inner} type={type} lang={lang} className={className ?? 'input'} style={inputStyle} {...rest} />
      {mic.button}
      {mic.hint}
    </span>
  );
});

/** `<textarea>` con micrófono. */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea({ lang = 'es-MX', voice = true, voiceLabel = 'Dictar por voz', style, className, ...rest }, ref) {
  const inner = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement);
  const enabled = voice && !rest.disabled && !rest.readOnly;
  const mic = useMic(inner, lang, enabled, voiceLabel, true);
  const [wrapStyle, inputStyle] = splitStyle(style);
  return (
    <span className={`vf ${mic.button ? 'has-mic' : ''} ${mic.listening ? 'listening' : ''}`} style={wrapStyle}>
      <textarea ref={inner} lang={lang} className={className ?? 'input'} style={inputStyle} {...rest} />
      {mic.button}
      {mic.hint}
    </span>
  );
});
