import { useEffect, useRef, useState } from 'react';
import { CityScene, type CityModelDistrict } from './scene';

/**
 * Lienzo de la maqueta de tu ciudad. Vive en su propio archivo para que three.js se descargue solo cuando se
 * muestra (se importa con `lazy`). El <canvas> se crea en cada montaje: liberar un renderer pierde su contexto
 * WebGL, y reutilizar ese mismo lienzo (p. ej., al montar dos veces en desarrollo) ya no dibuja.
 */
export default function CityView({ districts, onPick, onFail, label }: { districts: CityModelDistrict[]; onPick?: (id: string) => void; onFail?: () => void; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<CityScene | null>(null);
  const latest = useRef({ districts, onPick });
  latest.current = { districts, onPick };
  const [dark] = useState(() => getComputedStyle(document.documentElement).colorScheme !== 'light');

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const canvas = document.createElement('canvas');
    el.appendChild(canvas);
    try {
      const s = new CityScene(canvas, el, dark);
      s.onPick = latest.current.onPick ?? null;
      s.setCity(latest.current.districts);
      scene.current = s;
    } catch {
      canvas.remove();
      onFail?.();
      return;
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
      canvas.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  useEffect(() => {
    scene.current?.setCity(districts);
  }, [districts]);

  useEffect(() => {
    if (scene.current) scene.current.onPick = onPick ?? null;
  }, [onPick]);

  return <div ref={host} className="city-canvas" role="img" aria-label={label} />;
}
