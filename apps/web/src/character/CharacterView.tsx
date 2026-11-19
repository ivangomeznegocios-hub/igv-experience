import { useEffect, useRef, useState } from 'react';
import type { CharacterData, Physique } from '@igv/core';
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
}: {
  physique: Physique;
  character: CharacterData;
  /** Avance al siguiente nivel (0–1): anillo del piso. */
  progress: number;
  ringColor: string;
  view: StageView;
  /** Cada vez que cambia, el personaje gira hasta quedar de frente. */
  frontSignal?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const [failed, setFailed] = useState(false);

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

  useEffect(() => {
    try {
      stage.current?.setSpec({ physique, character });
    } catch {
      setFailed(true);
    }
  }, [physique, character]);
  useEffect(() => stage.current?.setRing(progress, ringColor), [progress, ringColor]);
  useEffect(() => stage.current?.setView(view), [view]);
  useEffect(() => {
    if (frontSignal) stage.current?.faceFront();
  }, [frontSignal]);

  return (
    <div ref={host} className="character-canvas" role="img" aria-label="Tu personaje en 3D. Desliza para girarlo.">
      {failed && <div className="character-fallback small muted">Este dispositivo no pudo mostrar el personaje en 3D.</div>}
    </div>
  );
}
