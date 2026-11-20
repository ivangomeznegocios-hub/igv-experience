import type { KeyboardEvent } from 'react';
import { MUSCLES, type MuscleId } from '@igv/core';

/**
 * Mapa del cuerpo 2D (frente y espalda), dibujado a mano en SVG: cada zona es un grupo muscular de
 * `MUSCLE_IDS`. Se dibuja la mitad izquierda y se refleja. Las clases de color las decide quien lo usa
 * (volumen de la semana o recuperación; ver styles/entreno.css) o, con `fills`, los mismos tonos del cuerpo 3D
 * (ui/MuscleBody.tsx). Es el respaldo del cuerpo 3D cuando el dispositivo no puede dibujarlo.
 */

type Part = { m?: MuscleId; d: string };

const HEAD = 'M50 3 C55 3 58 7.5 58 13 C58 18.5 55 23 50 23 C45 23 42 18.5 42 13 C42 7.5 45 3 50 3 Z';
const NECK = 'M45.5 20 L54.5 20 L55.5 29 L44.5 29 Z';
const FOREARM = 'M28.8 70 Q31 69.3 33 70.2 Q33.5 76 31.7 84 Q30.5 90 29.6 95 L26.8 95 Q25.7 88 25.9 81 Q26.2 73.5 28.8 70 Z';
const HAND = 'M26.4 96 L29.8 96 Q31 101 29.6 106 Q27.6 108 25.8 105.5 Q25 100.5 26.4 96 Z';

const FRONT: Part[] = [
  { m: 'trapecio', d: 'M45 24 Q42 28 36 30.5 L39.5 31.5 Q44 30.5 46 29 Z' },
  { m: 'hombro_frontal', d: 'M39.5 31.4 Q36 31.2 33.6 32.6 Q33 40 32.6 46.4 Q35 43 36.3 38.5 Q37.4 34.6 39.5 31.4 Z' },
  { m: 'hombro_lateral', d: 'M33.6 32.6 Q29.5 33.4 28.4 37.5 Q27.9 42 29.4 45 Q31 46.4 32.6 46.4 Q33 40 33.6 32.6 Z' },
  { m: 'pecho', d: 'M49.6 32.5 L49.6 49.5 Q44 51 40 49.5 Q36.8 47.8 36.2 44 Q36.6 39 39.5 31.6 Q44.5 31.6 49.6 32.5 Z' },
  { m: 'biceps', d: 'M32.4 47.6 Q35 48.5 35 53 Q34.8 61 33 67.5 Q30.8 69 28.8 67.5 Q27.2 60 27.8 52.5 Q28.6 48.4 32.4 47.6 Z' },
  { m: 'antebrazo', d: FOREARM },
  { d: HAND },
  { m: 'abdomen', d: 'M49.6 51.5 L49.6 88 Q46.5 87 45 83 L44.6 53.5 Q47 51.6 49.6 51.5 Z' },
  { m: 'oblicuos', d: 'M43.8 53 L44.2 83.5 Q42 86 39.6 84.5 Q40.4 76 38.8 70 Q37.2 62 37.6 53.8 Q40.5 52.4 43.8 53 Z' },
  { d: 'M39.4 85 Q42.5 87 45.5 86.5 Q47.6 89.5 49.6 90 L49.6 97 Q46 96.5 43 93.5 Q40 90.5 39.4 85 Z' },
  { m: 'cuadriceps', d: 'M39 88.5 Q42.5 93.5 46.4 97.4 Q46.5 104 45.6 112 Q45.4 120 46.2 127 Q46.4 131.5 45.4 134.5 Q42 136.5 39.2 134.5 Q36.4 124 36.4 112 Q36.5 98 39 88.5 Z' },
  { m: 'aductores', d: 'M46.9 97.8 Q48.8 98.6 49.5 99.6 Q49.4 108 48.2 115 Q47.2 120 46.3 124 Q45.5 118 45.9 111 Q46.6 104 46.9 97.8 Z' },
  { d: 'M39.4 135.2 Q42.6 137 45.6 135.4 Q46.4 139.5 45.6 143 Q42.5 144.5 39.8 143 Q38.8 139 39.4 135.2 Z' },
  { d: 'M39.6 144 Q41.6 145 43 144.7 Q43.2 156 42.2 166 Q41.8 176 42.6 184 L40.6 184 Q39 174 38.6 163 Q38.3 152 39.6 144 Z' },
  { m: 'pantorrillas', d: 'M43.6 144.6 Q46.9 145.4 47.3 151 Q47.5 159 45.9 167 Q44.7 173 43.6 180 Q42.7 172 42.9 162 Q43.2 152 43.6 144.6 Z' },
  { d: 'M40.6 185 L44 185 Q45 189 46.2 192.5 Q46.4 195 44 195.2 L39.6 195.2 Q38.6 194.4 39.2 191 Q40.2 188 40.6 185 Z' },
];

const BACK: Part[] = [
  { m: 'trapecio', d: 'M50 21 L50 56 Q47.2 50 44.6 44.4 Q41.6 38.6 37.4 34 Q35 32.8 35.8 31.2 Q41 29.4 45 25.5 Q47.4 22.5 50 21 Z' },
  { m: 'espalda', d: 'M38.6 36.4 Q42.4 40 44.8 45.4 Q47.4 51.4 49.6 57.5 L49.6 65.5 Q46 70.5 42.8 77.6 Q39 72.6 37.4 64 Q35.6 55.5 35.8 47.6 Q36.4 40.4 38.6 36.4 Z' },
  { m: 'hombro_posterior', d: 'M36.4 33.2 Q39.4 36 40 40.2 Q37.6 44.4 33.2 46.2 Q32.4 40 33.4 33.6 Q34.8 32.8 36.4 33.2 Z' },
  { m: 'hombro_lateral', d: 'M33.4 33.6 Q32.4 40 33.2 46.2 Q30.8 46.4 29.4 45 Q27.9 42 28.4 37.5 Q29.5 33.8 33.4 33.6 Z' },
  { m: 'triceps', d: 'M29.2 47 Q32.6 47.6 34.6 48.6 Q35.4 56 34 63.5 Q32.6 68.5 30.4 68.8 Q28 67 27.6 60 Q27.4 51 29.2 47 Z' },
  { m: 'antebrazo', d: FOREARM },
  { d: HAND },
  { m: 'lumbar', d: 'M49.6 66.5 L49.6 88.5 Q46.6 88.8 44.4 87 Q43.4 81.5 43.2 77.6 Q46.2 71 49.6 66.5 Z' },
  { m: 'oblicuos', d: 'M42.4 78.6 Q43.2 83 44 87.4 Q41.6 87.6 39.6 86 Q39.6 81 38.8 75.5 Q40.4 77.6 42.4 78.6 Z' },
  { m: 'gluteos', d: 'M49.6 89.5 L49.6 106.5 Q45 109.5 40.6 107.4 Q37 104 37.4 97 Q38.2 90.8 42 88.4 Q46 88 49.6 89.5 Z' },
  { m: 'isquios', d: 'M38 108 Q42.5 110.2 47.6 108.6 Q47 118 46.2 126 Q45.8 131 45.4 135 Q42.2 136.6 39.4 135 Q36.6 124 36.6 115 Q36.9 111 38 108 Z' },
  { m: 'aductores', d: 'M48.2 108.4 Q49.4 108 49.6 108.6 Q49.4 115 48 120.6 Q47 124.6 46.4 126.6 Q46.6 119 47.4 113.6 Q47.9 110.6 48.2 108.4 Z' },
  { d: 'M39.4 135.8 Q42.6 137.4 45.6 136 Q46.4 139.5 45.6 143 Q42.5 144.2 39.8 143 Q38.8 139 39.4 135.8 Z' },
  { m: 'pantorrillas', d: 'M39.6 143.6 Q42.4 144.8 45.4 143.6 Q47.6 148 47.2 156 Q46.6 165 44.6 174 L41.6 174 Q38.4 163 38.2 154 Q38.4 147.6 39.6 143.6 Z' },
  { d: 'M41.6 175 L44.6 175 Q44.2 180 44.2 185 L41.2 185 Q41.6 180 41.6 175 Z' },
  { d: 'M40.8 185.6 L44.6 185.6 Q45.4 190 45 194 Q42.8 195.6 40.6 194.2 Q40 190 40.8 185.6 Z' },
];

export interface BodyMapProps {
  /** Clase de color por músculo (p. ej. `v3`, `rec2`, `ready`). */
  classes: Partial<Record<MuscleId, string>>;
  /** Color de relleno por músculo (gana sobre la clase): los mismos tonos que el cuerpo 3D. */
  fills?: Partial<Record<MuscleId, string>>;
  /** Texto del globo de cada músculo. */
  titles?: Partial<Record<MuscleId, string>>;
  selected?: MuscleId | null;
  onSelect?: (m: MuscleId) => void;
  height?: number;
}

function Figure({ parts, label, classes, fills, titles, selected, onSelect, height }: BodyMapProps & { parts: Part[]; label: string }) {
  const half = (mirror: boolean) =>
    parts.map((p, i) => {
      if (!p.m) return <path key={i} className="bm-base" d={p.d} />;
      const m = p.m;
      const props = onSelect
        ? {
            role: 'button',
            tabIndex: mirror ? -1 : 0,
            'aria-label': titles?.[m] ?? MUSCLES[m].name,
            onClick: () => onSelect(m),
            onKeyDown: (e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(m)),
          }
        : {};
      return (
        <path key={i} className={`bm-m ${classes[m] ?? ''} ${selected === m ? 'sel' : ''}`} d={p.d} style={fills?.[m] ? { fill: fills[m] } : undefined} {...props}>
          <title>{titles?.[m] ?? MUSCLES[m].name}</title>
        </path>
      );
    });
  return (
    <figure className="bm-fig">
      <svg viewBox="22 1 56 196" style={{ height }} role="img" aria-label={`Mapa muscular: ${label}`}>
        <path className="bm-base" d={NECK} />
        <path className="bm-base" d={HEAD} />
        {half(false)}
        <g transform="translate(100 0) scale(-1 1)">{half(true)}</g>
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

/** Frente y espalda lado a lado. */
export function BodyMap(props: BodyMapProps) {
  return (
    <div className="bm">
      <Figure {...props} parts={FRONT} label="Frente" />
      <Figure {...props} parts={BACK} label="Espalda" />
    </div>
  );
}
