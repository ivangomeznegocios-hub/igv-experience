import { useEffect, useRef, useState } from 'react';
import type { CharacterData, MuscleId, Physique } from '@igv/core';
import type { MusclePaintSpec } from './figure';
import { Stage, type StageView } from './stage';

/**
 * Lienzo 3D del personaje. Vive en su propio archivo para que three.js se descargue
 * solo cuando se abre Perfil (se importa con `lazy`).
 */
export default function CharacterView({
  physique,
  character,
  progress,
  ringColor,
  view,
  frontSignal,
  muscles,
  onPick,
  ghost,
  turn,
  label,
  onFail,
}: {
  physique: Physique;
  character: CharacterData;
  /** Avance al siguiente nivel (0–1): anillo del piso. */
  progress: number;
  ringColor: string;
  view: StageView;
  /** Cada vez que cambia, el personaje gira hasta quedar de frente. */
  frontSignal?: number;
  /** Modo músculos: colores de cada músculo y el seleccionado (null = figura normal, con ropa). */
  muscles?: MusclePaintSpec | null;
  /** Al tocar un músculo (modo músculos). */
  onPick?: (m: MuscleId | null) => void;
  /** Silueta de otra fecha encima de la figura (comparar antes / ahora). */
  ghost?: { physique: Physique; color: string } | null;
  /** Giro animado: `yaw` 0 = frente, π = espalda; `n` cambia en cada pedido. */
  turn?: { yaw: number; n: number };
  label?: string;
  /** Si el dispositivo no puede dibujar en 3D. */
  onFail?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (failed) onFail?.();
  }, [failed]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    el.appendChild(canvas);
    try {
      stage.current = new Stage(canvas, el);
    } catch {
      setFailed(true);
    }
    return () => {
      stage.current?.dispose();
      stage.current = null;
      canvas.remove();
    };
  }, []);

  const muscleMode = !!muscles;
  useEffect(() => {
    try {
      stage.current?.setSpec({ physique, character, muscles: muscleMode });
    } catch {
      setFailed(true);
    }
  }, [physique, character, muscleMode]);
  useEffect(() => stage.current?.setMusclePaint(muscles ?? null), [muscles]);
  useEffect(() => {
    if (stage.current) stage.current.onPick = onPick ?? null;
  }, [onPick]);
  useEffect(() => {
    try {
      stage.current?.setGhost(ghost ? { physique: ghost.physique, character, ghost: { color: ghost.color } } : null);
    } catch {
      /* sin silueta: no es grave */
    }
  }, [ghost, character]);
  useEffect(() => {
    if (turn?.n) stage.current?.turnTo(turn.yaw);
  }, [turn?.n]);
  useEffect(() => stage.current?.setRing(progress, ringColor), [progress, ringColor]);
  useEffect(() => stage.current?.setView(view), [view]);
  useEffect(() => {
    if (frontSignal) stage.current?.faceFront();
  }, [frontSignal]);

  return (
    <div ref={host} className="character-canvas" role="img" aria-label={label ?? 'Tu personaje en 3D. Desliza para girarlo.'}>
      {failed && <div className="character-fallback small muted">Este dispositivo no pudo mostrar el personaje en 3D.</div>}
    </div>
  );
}
