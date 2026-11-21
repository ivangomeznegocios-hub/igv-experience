import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '../icons';

/**
 * Mapa interactivo sin librerías: proyección Web Mercator, arrastrar para mover, pellizcar / rueda / botones
 * para acercar, agrupación de marcadores cercanos y, si `tiles` está activo, fondo de calles de
 * OpenStreetMap (teselas raster de tile.openstreetmap.org con atribución; solo las visibles, sin descargas
 * masivas). Sin conexión o sin teselas, queda un fondo sobrio con retícula. Mantener presionado (o clic
 * derecho) en un punto llama a `onLongPress` con sus coordenadas (para marcar un lugar ahí).
 */

export type MarkerKind = 'goal' | 'habitual' | 'known' | 'todo' | 'suggest' | 'oficina' | 'sucursal' | 'cliente' | 'proveedor' | 'zona' | 'inactive';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  kind: MarkerKind;
  label: string;
}

export interface MapViewState {
  lat: number;
  lng: number;
  z: number;
}

const TILE = 256;
const MIN_Z = 3;
const MAX_Z = 18;
/** Centro de Guadalajara: vista por defecto sin lugares. */
export const GDL_CENTER = { lat: 20.6736, lng: -103.344 };
const TILE_URL = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

const PRIORITY: Record<MarkerKind, number> = { goal: 0, habitual: 0, oficina: 0, sucursal: 1, known: 1, cliente: 1, proveedor: 2, zona: 2, todo: 3, inactive: 4, suggest: 5 };
const LONG_PRESS_MS = 550;

function worldSize(z: number) {
  return TILE * 2 ** z;
}
export function projectLL(lat: number, lng: number, z: number): [number, number] {
  const s = worldSize(z);
  const sin = Math.min(0.9999, Math.max(-0.9999, Math.sin((lat * Math.PI) / 180)));
  return [((lng + 180) / 360) * s, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s];
}
export function unprojectXY(x: number, y: number, z: number): [number, number] {
  const s = worldSize(z);
  const n = Math.PI - (2 * Math.PI * y) / s;
  return [(180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), (x / s) * 360 - 180];
}
const clampZ = (z: number) => Math.max(MIN_Z, Math.min(MAX_Z, z));

/** Encuadre que muestra todos los puntos (con margen). */
export function fitView(points: { lat: number; lng: number }[], w: number, h: number, pad = 44, maxZ = 15): MapViewState {
  if (!points.length || w < 10 || h < 10) return { ...GDL_CENTER, z: 11 };
  if (points.length === 1) return { lat: points[0].lat, lng: points[0].lng, z: Math.min(14, maxZ) };
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    const [x, y] = projectLL(p.lat, p.lng, 0);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const sx = Math.max(1e-9, x1 - x0);
  const sy = Math.max(1e-9, y1 - y0);
  const z = clampZ(Math.min(maxZ, Math.log2(Math.min((w - pad * 2) / sx, (h - pad * 2) / sy))));
  const [lat, lng] = unprojectXY((x0 + x1) / 2, (y0 + y1) / 2, 0);
  return { lat, lng, z };
}

/**
 * Núcleo de los puntos: descarta los que están lejos (> km) del punto mediano si son minoría, para que el
 * encuadre inicial muestre la ciudad donde está casi todo y no todo el estado por un viaje.
 */
export function corePoints<T extends { lat: number; lng: number }>(pts: T[], km = 25): T[] {
  if (pts.length < 3) return pts;
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const mlat = med(pts.map((p) => p.lat));
  const mlng = med(pts.map((p) => p.lng));
  const kx = 111.32 * Math.cos((mlat * Math.PI) / 180);
  const near = pts.filter((p) => Math.hypot((p.lat - mlat) * 110.57, (p.lng - mlng) * kx) <= km);
  return near.length >= Math.max(2, Math.ceil(pts.length * 0.6)) ? near : pts;
}

interface Cluster {
  key: string;
  x: number;
  y: number;
  members: MapMarker[];
  lead: MapMarker;
}

export function MapView({
  markers,
  fitTo,
  fitAllTo,
  selectedId,
  onSelect,
  fitKey,
  focus,
  height = 340,
  tiles = true,
  crosshair = false,
  initial,
  onViewChange,
  me,
  onLocate,
  onLongPress,
  onAdd,
  adding = false,
  ariaLabel = 'Mapa',
}: {
  markers: MapMarker[];
  /** Puntos a encuadrar (por defecto, todos los marcadores). */
  fitTo?: { lat: number; lng: number }[];
  /** Puntos del botón "Ver todo" (por defecto, todos los marcadores). */
  fitAllTo?: { lat: number; lng: number }[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Cuando cambia, vuelve a encuadrar todos los marcadores. */
  fitKey?: string;
  /** Centra el mapa en un punto (cambia `key` para repetir). */
  focus?: { lat: number; lng: number; z?: number; key: number } | null;
  height?: number | string;
  tiles?: boolean;
  /** Mira fija al centro (para elegir un punto moviendo el mapa). */
  crosshair?: boolean;
  initial?: MapViewState;
  onViewChange?: (v: MapViewState) => void;
  me?: { lat: number; lng: number } | null;
  onLocate?: () => void;
  /** Mantener presionado un punto (o clic derecho): sus coordenadas y el zoom del mapa. */
  onLongPress?: (p: { lat: number; lng: number; z: number }) => void;
  /** Botón "Marcar un lugar" en los controles (`adding` = ya está marcando). */
  onAdd?: () => void;
  adding?: boolean;
  ariaLabel?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setViewState] = useState<MapViewState>(initial ?? { ...GDL_CENTER, z: 11 });
  const viewRef = useRef(view);
  const anim = useRef<number | null>(null);
  const fitted = useRef<string | null>(null);
  const setView = useCallback((v: MapViewState) => {
    const next = { lat: Math.max(-84, Math.min(84, v.lat)), lng: ((((v.lng + 180) % 360) + 360) % 360) - 180, z: clampZ(v.z) };
    viewRef.current = next;
    setViewState(next);
  }, []);

  const animateTo = useCallback(
    (target: MapViewState, ms = 320) => {
      if (anim.current) cancelAnimationFrame(anim.current);
      const from = viewRef.current;
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / ms);
        const e = 1 - (1 - k) ** 3;
        setView({ lat: from.lat + (target.lat - from.lat) * e, lng: from.lng + (target.lng - from.lng) * e, z: from.z + (target.z - from.z) * e });
        anim.current = k < 1 ? requestAnimationFrame(step) : null;
      };
      anim.current = requestAnimationFrame(step);
    },
    [setView],
  );
  useEffect(() => () => void (anim.current && cancelAnimationFrame(anim.current)), []);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Encuadre inicial y cada vez que cambia `fitKey`.
  useEffect(() => {
    if (!size.w || !size.h) return;
    const key = fitKey ?? 'default';
    if (fitted.current === key) return;
    const first = fitted.current === null;
    fitted.current = key;
    if (first && initial) return;
    const target = fitView(fitTo?.length ? fitTo : markers, size.w, size.h);
    if (first) setView(target);
    else animateTo(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, size.w, size.h]);

  useEffect(() => {
    if (focus) animateTo({ lat: focus.lat, lng: focus.lng, z: Math.max(viewRef.current.z, focus.z ?? 14) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key]);

  useEffect(() => {
    onViewChange?.(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // ---------- Gestos ----------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const press = useRef<{ timer: number; at: number } | null>(null);
  const lastLong = useRef(0);
  const clearPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => clearPress, []);
  /** Coordenadas de un punto de la pantalla del mapa. */
  const pointToLL = (px: number, py: number) => {
    const v = viewRef.current;
    const [vx, vy] = projectLL(v.lat, v.lng, v.z);
    const [lat, lng] = unprojectXY(vx + px - size.w / 2, vy + py - size.h / 2, v.z);
    return { lat, lng: ((((lng + 180) % 360) + 360) % 360) - 180, z: v.z };
  };
  const fireLongPress = (px: number, py: number) => {
    if (!onLongPress || Date.now() - lastLong.current < 900) return;
    lastLong.current = Date.now();
    if (gesture.current) gesture.current.moved = true; // al soltar no selecciona nada
    onLongPress(pointToLL(px, py));
  };
  const gesture = useRef<{ x: number; y: number; view: MapViewState; moved: boolean; target: string | null; pinch: { d: number; mx: number; my: number; view: MapViewState } | null } | null>(null);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const panBy = (v: MapViewState, dx: number, dy: number): MapViewState => {
    const [cx, cy] = projectLL(v.lat, v.lng, v.z);
    const [lat, lng] = unprojectXY(cx - dx, cy - dy, v.z);
    return { lat, lng, z: v.z };
  };
  /** Acerca/aleja manteniendo fijo el punto (px, py) de la pantalla. */
  const zoomAt = (v: MapViewState, z: number, px: number, py: number): MapViewState => {
    const nz = clampZ(z);
    const [cx, cy] = projectLL(v.lat, v.lng, v.z);
    const [glat, glng] = unprojectXY(cx + px - size.w / 2, cy + py - size.h / 2, v.z);
    const [gx, gy] = projectLL(glat, glng, nz);
    const [lat, lng] = unprojectXY(gx - (px - size.w / 2), gy - (py - size.h / 2), nz);
    return { lat, lng, z: nz };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.mapa-ctl, .mapa-attrib')) return;
    if (anim.current) cancelAnimationFrame(anim.current);
    box.current!.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) {
      const t = (e.target as Element).closest('[data-mid]');
      gesture.current = { ...p, view: viewRef.current, moved: false, target: t?.getAttribute('data-mid') ?? null, pinch: null };
      clearPress();
      if (onLongPress && e.button === 0) press.current = { timer: window.setTimeout(() => fireLongPress(p.x, p.y), LONG_PRESS_MS), at: Date.now() };
    } else if (pointers.current.size === 2 && gesture.current) {
      clearPress();
      const [a, b] = [...pointers.current.values()];
      gesture.current.moved = true;
      gesture.current.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, view: viewRef.current };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (g.pinch && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const zoomed = zoomAt(g.pinch.view, g.pinch.view.z + Math.log2(d / g.pinch.d), g.pinch.mx, g.pinch.my);
      setView(panBy(zoomed, mx - g.pinch.mx, my - g.pinch.my));
      return;
    }
    if (g.pinch) return;
    const dx = p.x - g.x;
    const dy = p.y - g.y;
    if (!g.moved && Math.hypot(dx, dy) < 6) return;
    clearPress();
    g.moved = true;
    setView(panBy(g.view, dx, dy));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    clearPress();
    const g = gesture.current;
    if (pointers.current.size > 0) {
      // Queda un dedo tras pellizcar: sigue arrastrando desde aquí.
      if (g) {
        const [rest] = [...pointers.current.values()];
        gesture.current = { ...rest, view: viewRef.current, moved: true, target: null, pinch: null };
      }
      return;
    }
    gesture.current = null;
    if (!g || g.moved || !g.target) return;
    if (g.target.startsWith('cluster:')) {
      const c = clusters.find((k) => k.key === g.target);
      if (c) {
        const pts = c.members.map((m) => ({ lat: m.lat, lng: m.lng }));
        const fit = fitView(pts, size.w, size.h, 60, 17);
        animateTo({ ...fit, z: Math.max(fit.z, viewRef.current.z + 1.5) });
      }
    } else onSelect?.(g.target);
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = viewRef.current;
      setView(zoomAt(v, v.z - e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022), e.clientX - r.left, e.clientY - r.top));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);

  const zoomBtn = (dz: number) => animateTo({ ...viewRef.current, z: clampZ(Math.round(viewRef.current.z + dz)) }, 220);

  // ---------- Proyección de lo visible ----------
  const { w, h } = size;
  const [cx, cy] = projectLL(view.lat, view.lng, view.z);
  const toScreen = (lat: number, lng: number): [number, number] => {
    const [x, y] = projectLL(lat, lng, view.z);
    return [x - cx + w / 2, y - cy + h / 2];
  };

  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  const tileEls = useMemo(() => {
    if (!tiles || !online || !w || !h) return [];
    const tz = Math.max(0, Math.min(18, Math.round(view.z)));
    const scale = 2 ** (view.z - tz);
    const [tcx, tcy] = projectLL(view.lat, view.lng, tz);
    const n = 2 ** tz;
    const span = TILE * scale;
    const x0 = Math.floor((tcx - w / 2 / scale) / TILE);
    const x1 = Math.floor((tcx + w / 2 / scale) / TILE);
    const y0 = Math.max(0, Math.floor((tcy - h / 2 / scale) / TILE));
    const y1 = Math.min(n - 1, Math.floor((tcy + h / 2 / scale) / TILE));
    const out: { key: string; src: string; style: CSSProperties }[] = [];
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const wx = ((tx % n) + n) % n;
        out.push({
          key: `${tz}/${tx}/${ty}`,
          src: TILE_URL(tz, wx, ty),
          style: { left: Math.round((tx * TILE - tcx) * scale + w / 2), top: Math.round((ty * TILE - tcy) * scale + h / 2), width: Math.ceil(span) + 1, height: Math.ceil(span) + 1 },
        });
      }
    }
    return out;
  }, [tiles, online, w, h, view.lat, view.lng, view.z]);

  const clusters = useMemo<Cluster[]>(() => {
    if (!w || !h) return [];
    const visible = markers
      .map((m) => {
        const [x, y] = toScreen(m.lat, m.lng);
        return { m, x, y };
      })
      .filter(({ x, y }) => x > -40 && y > -40 && x < w + 40 && y < h + 40)
      .sort((a, b) => (a.m.id === selectedId ? -1 : b.m.id === selectedId ? 1 : PRIORITY[a.m.kind] - PRIORITY[b.m.kind]));
    const radius = view.z >= 16 ? 0 : 20;
    const out: Cluster[] = [];
    for (const v of visible) {
      const near = radius && v.m.id !== selectedId ? out.find((c) => c.lead.id !== selectedId && Math.hypot(c.x - v.x, c.y - v.y) < radius) : undefined;
      if (near) near.members.push(v.m);
      else out.push({ key: v.m.id, x: v.x, y: v.y, members: [v.m], lead: v.m });
    }
    for (const c of out) if (c.members.length > 1) c.key = `cluster:${c.lead.id}`;
    return out.reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, w, h, view.lat, view.lng, view.z, selectedId]);

  const singles = clusters.filter((c) => c.members.length === 1 && c.lead.kind !== 'suggest').length;
  const showLabels = (view.z >= 13 && singles <= 18) || singles <= 8;
  // Etiquetas sin encimarse: primero la del seleccionado, luego por prioridad.
  const labelled = useMemo(() => {
    const out = new Set<string>();
    const boxes: [number, number, number, number][] = [];
    for (const c of [...clusters].reverse()) {
      const m = c.lead;
      if (c.members.length > 1 || !(m.id === selectedId || (showLabels && m.kind !== 'suggest'))) continue;
      const lw = Math.min(m.label.length, 26) * 6.3 + 6;
      const box: [number, number, number, number] = [c.x - lw / 2, c.y - 26, c.x + lw / 2, c.y - 10];
      if (m.id !== selectedId && boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      boxes.push(box);
      out.add(m.id);
    }
    return out;
  }, [clusters, selectedId, showLabels]);
  const mePt = me ? toScreen(me.lat, me.lng) : null;
  const gridStep = 2 ** (view.z - Math.floor(view.z)) * 64;
  const [gx, gy] = [((-(cx - w / 2) % gridStep) + gridStep) % gridStep, ((-(cy - h / 2) % gridStep) + gridStep) % gridStep];

  return (
    <div
      ref={box}
      className={`mapa-canvas ${tiles && online ? 'with-tiles' : 'no-tiles'}`}
      style={{ height, backgroundSize: `${gridStep}px ${gridStep}px`, backgroundPosition: `${gx}px ${gy}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        const p = local(e);
        animateTo(zoomAt(viewRef.current, viewRef.current.z + 1, p.x, p.y), 220);
      }}
      onContextMenu={(e) => {
        // Clic derecho en computadora; en el celular el menú del navegador no debe salir al mantener presionado.
        e.preventDefault();
        if ((e.target as HTMLElement).closest('.mapa-ctl, .mapa-attrib')) return;
        const p = local(e);
        fireLongPress(p.x, p.y);
      }}
      role="application"
      aria-label={ariaLabel}
    >
      {tileEls.length > 0 && (
        <div className="mapa-tiles" aria-hidden="true">
          {tileEls.map((t) => (
            <img key={t.key} src={t.src} style={t.style} alt="" draggable={false} decoding="async" onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')} />
          ))}
        </div>
      )}
      <svg className="mapa-overlay" width={w} height={h} aria-hidden={markers.length === 0}>
        {mePt && (
          <g transform={`translate(${mePt[0]} ${mePt[1]})`} className="mapa-me">
            <circle r="14" className="halo" />
            <circle r="6" className="dot" />
          </g>
        )}
        {clusters.map((c) => {
          const sel = c.lead.id === selectedId && c.members.length === 1;
          if (c.members.length > 1) {
            return (
              <g key={c.key} data-mid={c.key} transform={`translate(${c.x} ${c.y})`} className={`mapa-cluster mk-${c.lead.kind}`}>
                <circle r={Math.min(20, 11 + c.members.length)} />
                <text y="4" textAnchor="middle">
                  {c.members.length}
                </text>
              </g>
            );
          }
          const m = c.lead;
          return (
            <g key={c.key} data-mid={m.id} transform={`translate(${c.x} ${c.y})`} className={`mapa-pin mk-${m.kind} ${sel ? 'sel' : ''}`}>
              <title>{m.label}</title>
              {m.kind === 'zona' && <circle r="24" className="zone" />}
              <circle r="16" className="hit" />
              {sel && <circle r="13" className="ring" />}
              <circle r={m.kind === 'suggest' ? 4.5 : m.kind === 'goal' ? 9 : 7.5} className="dot" />
              {m.kind === 'habitual' && <circle r="2.6" className="core" />}
              {m.kind === 'goal' && <path className="flag" d="M-2.6 4.2V-4.4M-2.6 -4.4H3.6L2.2 -2.4L3.6 -0.4H-2.6" />}
              {labelled.has(m.id) && (
                <text y={-13} textAnchor="middle" className="lbl">
                  {m.label.length > 26 ? `${m.label.slice(0, 25)}…` : m.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {crosshair && <div className="mapa-crosshair" aria-hidden="true" />}
      <div className="mapa-ctl">
        {onAdd && (
          <button type="button" className={`add ${adding ? 'on' : ''}`} aria-label="Marcar un lugar en el mapa" aria-pressed={adding} title="Marcar un lugar" onClick={onAdd}>
            <Icon name="pin-plus" />
          </button>
        )}
        <button type="button" aria-label="Acercar" onClick={() => zoomBtn(1)}>
          <Icon name="plus" />
        </button>
        <button type="button" aria-label="Alejar" onClick={() => zoomBtn(-1)}>
          <Icon name="minus" />
        </button>
        {markers.length > 0 && (
          <button type="button" aria-label="Ver todo" onClick={() => animateTo(fitView(fitAllTo?.length ? fitAllTo : markers, w, h))}>
            <Icon name="expand" />
          </button>
        )}
        {onLocate && (
          <button type="button" aria-label="Mi ubicación" onClick={onLocate}>
            <Icon name="locate" />
          </button>
        )}
      </div>
      {tileEls.length > 0 && (
        <a className="mapa-attrib" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          © OpenStreetMap
        </a>
      )}
    </div>
  );
}
