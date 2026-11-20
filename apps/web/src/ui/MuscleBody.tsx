import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MUSCLE_IDS,
  ageOn,
  muscleDetail,
  muscleLegend,
  musclePaint,
  physiqueAsOf,
  resolveCharacter,
  type MuscleId,
  type MusclePaintMode,
  type MuscleStatus,
  type MuscleTone,
} from '@igv/core';
import type { MusclePaintSpec } from '../character/figure';
import { useGame } from '../data/store';
import { BodyMap } from './BodyMap';
import { Chips } from './kit';
import '../styles/cuerpo3d.css';

const CharacterView = lazy(() => import('../character/CharacterView'));

/**
 * Músculos sobre tu cuerpo 3D: colores sobrios tipo lámina de anatomía (tintes suaves, nada neón). Los mismos
 * colores van en la leyenda, en el mapa plano de respaldo y en la figura.
 */
export const MUSCLE_TONE_COLORS: Record<MuscleTone, string> = {
  falta: '#c4625b',
  efectivo: '#7dbcab',
  meta: '#2f8f7c',
  recuperando: '#d98b3a',
  v1: '#b4d8ce',
  v2: '#78b9a8',
  v3: '#2f8f7c',
  v4: '#d98b3a',
  listo: '#4f9a6a',
  olvidado: '#c4625b',
};

export const PAINT_MODES: { value: MusclePaintMode; label: string }[] = [
  { value: 'estado', label: 'Estado' },
  { value: 'volumen', label: 'Volumen' },
  { value: 'recuperacion', label: 'Recuperación' },
];

/** Hora actual en ISO, al minuto (la recuperación depende de la hora). */
export function useNowIso(): string {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toISOString()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Tu complexión de hoy (de tus medidas) y tu apariencia guardada. */
export function useMyBody() {
  const { state } = useGame();
  const age = state.settings.birthDate ? ageOn(state.settings.birthDate, state.today).years : null;
  const physique = useMemo(
    () => physiqueAsOf(state.body.entries, state.today, { heightCm: state.settings.heightCm, age }),
    [state.body.entries, state.today, state.settings.heightCm, age],
  );
  const character = useMemo(() => resolveCharacter(state.settings.character), [state.settings.character]);
  return { physique, character };
}

/** Colores de cada músculo para la figura 3D. */
export function useMusclePaint(muscles: Record<MuscleId, MuscleStatus>, mode: MusclePaintMode, selected: MuscleId | null): MusclePaintSpec {
  return useMemo(() => {
    const tints: MusclePaintSpec['tints'] = {};
    for (const id of MUSCLE_IDS) {
      const p = musclePaint(muscles[id], mode);
      if (p.tone) tints[id] = { color: MUSCLE_TONE_COLORS[p.tone], strength: p.strength };
    }
    return { tints, selected };
  }, [muscles, mode, selected]);
}

export function MuscleLegend({ mode }: { mode: MusclePaintMode }) {
  return (
    <div className="mb3-legend" aria-label="Leyenda">
      {muscleLegend(mode).map((l) => (
        <span key={l.label}>
          <i style={{ background: l.tone ? MUSCLE_TONE_COLORS[l.tone] : undefined }} className={l.tone ? '' : 'none'} />
          {l.label}
        </span>
      ))}
    </div>
  );
}

/** Tarjeta del músculo seleccionado (o la invitación a tocar uno). */
export function MuscleInfo({ status, onDetail, onClear }: { status: MuscleStatus | null; onDetail?: () => void; onClear: () => void }) {
  if (!status) return <div className="mb3-info empty tiny muted">Toca un músculo para ver sus series de la semana y cuándo lo entrenaste.</div>;
  const d = muscleDetail(status);
  return (
    <div className="mb3-info" aria-live="polite">
      <div className="row between" style={{ alignItems: 'flex-start', gap: 8 }}>
        <div>
          <b>{d.title}</b>
          <div className="small">{d.status}</div>
        </div>
        <button className="linklike tiny" onClick={onClear} aria-label="Quitar selección">
          Cerrar
        </button>
      </div>
      <ul>
        {d.lines.map((l) => (
          <li key={l} className="tiny muted">
            {l}
          </li>
        ))}
      </ul>
      {onDetail && (
        <button className="btn sm ghost" onClick={onDetail}>
          Ver ejercicios y detalle
        </button>
      )}
    </div>
  );
}

/** Botones rápidos para girar la figura. */
export function FrontBack({ side, onSide }: { side: 'frente' | 'espalda'; onSide: (s: 'frente' | 'espalda') => void }) {
  return (
    <div className="character-views mb3-side" role="group" aria-label="Lado del cuerpo">
      <button className={side === 'frente' ? 'on' : ''} onClick={() => onSide('frente')}>
        Frente
      </button>
      <button className={side === 'espalda' ? 'on' : ''} onClick={() => onSide('espalda')}>
        Espalda
      </button>
    </div>
  );
}

/**
 * Tu cuerpo 3D con los músculos de la semana (pantalla de Entrenamiento). Si el dispositivo no puede con 3D,
 * queda el mapa plano.
 */
export function MuscleBody({ muscles, mode, onMode, selected, onSelect, onDetail }: {
  muscles: Record<MuscleId, MuscleStatus>;
  mode: MusclePaintMode;
  onMode: (m: MusclePaintMode) => void;
  selected: MuscleId | null;
  onSelect: (m: MuscleId | null) => void;
  onDetail: (m: MuscleId) => void;
}) {
  const { state } = useGame();
  const { physique, character } = useMyBody();
  const paint = useMusclePaint(muscles, mode, selected);
  const [side, setSide] = useState<'frente' | 'espalda'>('frente');
  const [turn, setTurn] = useState({ yaw: 0, n: 0 });
  const [flat, setFlat] = useState(false);
  const turnTo = (s: 'frente' | 'espalda') => {
    setSide(s);
    setTurn((t) => ({ yaw: s === 'frente' ? 0 : Math.PI, n: t.n + 1 }));
  };
  const fills: Partial<Record<MuscleId, string>> = {};
  for (const id of MUSCLE_IDS) if (paint.tints[id]) fills[id] = paint.tints[id]!.color;

  return (
    <div className="mb3">
      <div className="row between" style={{ marginBottom: 8, gap: 8 }}>
        <Chips value={mode} onChange={onMode} options={PAINT_MODES} />
      </div>
      {flat ? (
        <BodyMap classes={{}} fills={fills} selected={selected} onSelect={(m) => onSelect(m)} />
      ) : (
        <div className="mb3-stage">
          <Suspense fallback={<div className="character-canvas character-loading small muted">Cargando tu cuerpo…</div>}>
            <CharacterView
              physique={physique}
              character={character}
              progress={state.level.progress}
              ringColor="#808080"
              view="body"
              muscles={paint}
              onPick={(m) => onSelect(m)}
              turn={turn}
              onFail={() => setFlat(true)}
              label="Tu cuerpo en 3D con los músculos de la semana. Desliza para girarlo y toca un músculo para ver su estado."
            />
          </Suspense>
          <div className="mb3-top">
            <FrontBack side={side} onSide={turnTo} />
          </div>
        </div>
      )}
      <MuscleLegend mode={mode} />
      <MuscleInfo status={selected ? muscles[selected] : null} onDetail={selected ? () => onDetail(selected) : undefined} onClear={() => onSelect(null)} />
      <div className="row" style={{ justifyContent: 'center', marginTop: 6 }}>
        <button className="linklike tiny" onClick={() => setFlat((f) => !f)}>
          {flat ? 'Ver en 3D' : 'Ver mapa plano'}
        </button>
      </div>
    </div>
  );
}

/** Panel del modo músculos en Perfil: modo, leyenda, músculo seleccionado y enlace a Entrenamiento. */
export function MusclePanel({ muscles, mode, onMode, selected, onSelect }: {
  muscles: Record<MuscleId, MuscleStatus>;
  mode: MusclePaintMode;
  onMode: (m: MusclePaintMode) => void;
  selected: MuscleId | null;
  onSelect: (m: MuscleId | null) => void;
}) {
  return (
    <div className="mb3-panel">
      <Chips value={mode} onChange={onMode} options={PAINT_MODES} />
      <MuscleLegend mode={mode} />
      <MuscleInfo status={selected ? muscles[selected] : null} onClear={() => onSelect(null)} />
      <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
        <Link to="/entreno" className="btn sm ghost">
          Ir a Entrenamiento
        </Link>
      </div>
    </div>
  );
}
