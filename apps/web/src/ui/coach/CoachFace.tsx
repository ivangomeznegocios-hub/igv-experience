import type { CoachMood } from '@igv/core';

/**
 * La cara de tu entrenador: un círculo sobrio con cinta deportiva y una expresión según su ánimo (feliz, ánimo,
 * calma, atento, serio). SVG propio, sin imágenes ni emojis; parpadea de vez en cuando (sin animación si el sistema
 * pide movimiento reducido).
 */
export function CoachFace({ mood, size = 56, title }: { mood: CoachMood; size?: number; title?: string }) {
  const eyes = {
    feliz: (
      <>
        <path d="M21 31q3-4 6 0M37 31q3-4 6 0" />
      </>
    ),
    animo: (
      <>
        <circle cx="24" cy="31" r="2.2" className="cf-fill cf-eye" />
        <circle cx="40" cy="31" r="2.2" className="cf-fill cf-eye" />
        <path d="M20 25.5l7 1.5M44 25.5l-7 1.5" />
      </>
    ),
    calma: (
      <>
        <path d="M21 31.5q3 2 6 0M37 31.5q3 2 6 0" />
      </>
    ),
    atento: (
      <>
        <circle cx="24" cy="31" r="2.2" className="cf-fill cf-eye" />
        <circle cx="40" cy="31" r="2.2" className="cf-fill cf-eye" />
        <path d="M20 26.5l7-1.5M44 26.5l-7-1.5" />
      </>
    ),
    serio: (
      <>
        <circle cx="24" cy="31" r="2.2" className="cf-fill cf-eye" />
        <circle cx="40" cy="31" r="2.2" className="cf-fill cf-eye" />
        <path d="M20 26h7M37 26h7" />
      </>
    ),
  }[mood];
  const mouth = {
    feliz: 'M22 40q10 10 20 0',
    animo: 'M24 41q8 6 16 0',
    calma: 'M26 42q6 3 12 0',
    atento: 'M27 43q5-3 10 0',
    serio: 'M26 42.5h12',
  }[mood];
  return (
    <svg className={`coach-face cf-${mood}`} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title ?? 'Tu coach'}>
      <circle cx="32" cy="32" r="30" className="cf-head" />
      <path d="M6.5 22.5q25.5-9 51 0v6q-25.5-9-51 0z" className="cf-band" />
      <g className="cf-line">
        {eyes}
        <path d={mouth} />
      </g>
    </svg>
  );
}
