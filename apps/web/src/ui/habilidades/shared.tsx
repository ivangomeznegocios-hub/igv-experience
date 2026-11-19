import { NavLink } from 'react-router-dom';
import { TIME_AREAS, TIME_AREA_NAMES, type SkillCategory, type SkillData, type TimeArea } from '@igv/core';
import { Chips } from '../kit';
import { Icon } from '../icons';
import '../../styles/habilidades.css';

/** Color de cada área de tiempo (tokens del tema). */
export const AREA_COLOR: Record<TimeArea, string> = {
  trabajo: 'var(--gold)',
  estudio: 'var(--violet-2)',
  lectura: 'var(--season)',
  proyecto: 'var(--teal)',
  ejercicio: 'var(--flame)',
  familia: 'var(--green)',
  pareja: 'var(--red)',
  amigos: 'var(--blue)',
  casa: 'color-mix(in srgb, var(--muted) 80%, var(--gold))',
  traslado: 'var(--faint)',
  ocio: 'color-mix(in srgb, var(--violet) 55%, var(--teal))',
  otro: 'var(--line)',
};

/** Área sugerida al practicar una habilidad. */
const CATEGORY_AREA: Record<SkillCategory, TimeArea> = {
  negocio: 'trabajo',
  oficio: 'trabajo',
  idioma: 'estudio',
  tecnologia: 'estudio',
  deporte: 'ejercicio',
  arte: 'proyecto',
  hogar: 'casa',
  social: 'otro',
  otro: 'estudio',
};
export function areaForSkill(d: SkillData, category: SkillCategory): TimeArea {
  return d.livelihood ? 'trabajo' : CATEGORY_AREA[category];
}

/** Atajos de una sola palabra para la nota de cada área. */
export const AREA_HINT: Record<TimeArea, string> = {
  trabajo: 'Oficina, junta, clientes…',
  estudio: 'Curso, clase, práctica…',
  lectura: 'Qué leíste',
  proyecto: 'Qué proyecto',
  ejercicio: 'Gym, correr…',
  familia: 'Con quién',
  pareja: 'Qué hicieron',
  amigos: 'Con quién',
  casa: 'Pendientes, cocina…',
  traslado: 'De dónde a dónde',
  ocio: 'Serie, juego, salida…',
  otro: 'Qué fue',
};

export function AreaChips({ value, onChange }: { value: TimeArea | null; onChange: (a: TimeArea) => void }) {
  return (
    <Chips
      value={value}
      onChange={onChange}
      options={TIME_AREAS.map((a) => ({
        value: a,
        label: (
          <>
            <i className="hab-dot" style={{ background: AREA_COLOR[a] }} />
            {TIME_AREA_NAMES[a]}
          </>
        ),
      }))}
    />
  );
}

export function AreaDot({ area }: { area: TimeArea }) {
  return <i className="hab-dot" style={{ background: AREA_COLOR[area] }} aria-hidden="true" />;
}

/** Navegación entre lo que sabes, tu tiempo y tu biblioteca. */
export function HubNav() {
  return (
    <nav className="hab-hub" aria-label="Habilidades, tiempo y biblioteca">
      <NavLink to="/habilidades">
        <Icon name="shield" /> Sabes hacer
      </NavLink>
      <NavLink to="/tiempo">
        <Icon name="clock" /> Tu tiempo
      </NavLink>
      <NavLink to="/biblioteca">
        <Icon name="book" /> Biblioteca
      </NavLink>
    </nav>
  );
}

/** Calificación de 1 a 5 (con `onChange` se puede editar). */
export function Stars({ value, onChange, size = 18 }: { value: number | null | undefined; onChange?: (n: number) => void; size?: number }) {
  const v = value ?? 0;
  return (
    <span className={`hab-stars ${onChange ? 'edit' : ''}`} aria-label={v ? `${v} de 5` : 'Sin calificar'}>
      {[1, 2, 3, 4, 5].map((n) =>
        onChange ? (
          <button key={n} type="button" className={n <= v ? 'on' : ''} onClick={() => onChange(n)} aria-label={`${n} de 5`}>
            <Icon name="star" width={size} height={size} />
          </button>
        ) : (
          <Icon key={n} name="star" width={size} height={size} className={n <= v ? 'on' : ''} />
        ),
      )}
    </span>
  );
}

/** Barra horizontal simple con color propio (para distribuciones de tiempo y avance). */
export function HBar({ value, max, color, ghost }: { value: number; max: number; color: string; ghost?: number }) {
  const pct = (n: number) => (max > 0 ? Math.max(0, Math.min(100, (n / max) * 100)) : 0);
  return (
    <div className="hab-hbar" aria-hidden="true">
      {ghost !== undefined && <b style={{ width: `${pct(ghost)}%` }} />}
      <i style={{ width: `${pct(value)}%`, background: color }} />
    </div>
  );
}
