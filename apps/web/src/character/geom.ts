import { BufferAttribute, BufferGeometry } from 'three';

/**
 * Geometría base del personaje: todo el cuerpo y la ropa se arman con "lofts", tubos que pasan por
 * secciones horizontales (anillos) con forma de superelipse. Cambiar un anillo cambia la silueta.
 */

/** Sección horizontal: centro (cx, cz), medio ancho `w`, fondo al frente `f` y atrás `b`, exponente `n` (2 = elipse, mayor = más cuadrado). */
export interface Ring {
  y: number;
  cx: number;
  cz: number;
  w: number;
  f: number;
  b: number;
  n: number;
}
export type RingKey = { y: number; w: number; f?: number; b?: number; cx?: number; cz?: number; n?: number };
export type RingFn = (y: number) => Ring;

export const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const gauss = (x: number, sigma: number) => Math.exp(-((x / sigma) ** 2));

/** Interpolación cúbica monótona (PCHIP): suave y sin rebotes entre puntos. */
export function pchip(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  if (n === 1) return () => ys[0]!;
  const h: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1]! - xs[i]!);
    d.push((ys[i + 1]! - ys[i]!) / h[i]!);
  }
  const m = new Array<number>(n).fill(0);
  m[0] = d[0]!;
  m[n - 1] = d[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1]! * d[i]! <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i]! + h[i - 1]!;
      const w2 = h[i]! + 2 * h[i - 1]!;
      m[i] = (w1 + w2) / (w1 / d[i - 1]! + w2 / d[i]!);
    }
  }
  return (x: number) => {
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]!) i++;
    const t = (x - xs[i]!) / h[i]!;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i]! + (t3 - 2 * t2 + t) * h[i]! * m[i]! + (-2 * t3 + 3 * t2) * ys[i + 1]! + (t3 - t2) * h[i]! * m[i + 1]!;
  };
}

/** Perfil continuo a partir de anillos clave (en cualquier orden de `y`). */
export function profile(keys: RingKey[]): RingFn {
  const ks = [...keys].sort((a, b) => a.y - b.y);
  const ys = ks.map((k) => k.y);
  const ch = (get: (k: RingKey) => number) => pchip(ys, ks.map(get));
  const w = ch((k) => k.w);
  const f = ch((k) => k.f ?? k.w);
  const b = ch((k) => k.b ?? k.w);
  const cx = ch((k) => k.cx ?? 0);
  const cz = ch((k) => k.cz ?? 0);
  const n = ch((k) => k.n ?? 2);
  return (y) => ({ y, w: w(y), f: f(y), b: b(y), cx: cx(y), cz: cz(y), n: n(y) });
}

/** Punto del anillo en el ángulo `u` (0 = lado +x, π/2 = frente). */
export function ringXZ(r: Ring, u: number): [number, number] {
  const c = Math.cos(u);
  const s = Math.sin(u);
  const e = 2 / r.n;
  return [r.cx + r.w * Math.sign(c) * Math.abs(c) ** e, r.cz + (s >= 0 ? r.f : r.b) * Math.sign(s) * Math.abs(s) ** e];
}

/** Z de la superficie del frente del anillo en una `x` dada. */
export function frontZ(r: Ring, x: number): number {
  const q = clamp(Math.abs(x - r.cx) / r.w);
  return r.cz + r.f * (1 - q ** r.n) ** (1 / r.n);
}

/** Perímetro de una superelipse de medio ancho 1 y medio fondo `q`. */
export function unitPerimeter(q: number, n: number): number {
  const N = 72;
  const e = 2 / n;
  let per = 0;
  let px = 1;
  let pz = 0;
  for (let i = 1; i <= N; i++) {
    const u = (i / N) * Math.PI * 2;
    const c = Math.cos(u);
    const s = Math.sin(u);
    const x = Math.sign(c) * Math.abs(c) ** e;
    const z = q * Math.sign(s) * Math.abs(s) ** e;
    per += Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
  }
  return per;
}

/** Medio ancho de la sección cuyo contorno mide `girth` (misma unidad), con fondo/ancho `q`. */
export const halfWidth = (girth: number, q: number, n: number) => girth / unitPerimeter(q, n);

/** Tubo con tapas redondeadas: extiende el perfil más allá de [y0, y1] cerrándolo en domo. */
export interface Tube {
  ringAt: RingFn;
  ys: number[];
  /** Vértices de cierre (si la tapa existe). */
  top?: number;
  bottom?: number;
}

export function tube(p: RingFn, y0: number, y1: number, rings: number, caps: { top?: number; bottom?: number } = {}): Tube {
  const capT = caps.top ?? 0;
  const capB = caps.bottom ?? 0;
  const ringAt: RingFn = (y) => {
    if (y > y1 && capT > 0) {
      const s = clamp((y - y1) / capT);
      const k = Math.sqrt(Math.max(0, 1 - s * s));
      const r = p(y1);
      return { ...r, y, w: r.w * k, f: r.f * k, b: r.b * k };
    }
    if (y < y0 && capB > 0) {
      const s = clamp((y0 - y) / capB);
      const k = Math.sqrt(Math.max(0, 1 - s * s));
      const r = p(y0);
      return { ...r, y, w: r.w * k, f: r.f * k, b: r.b * k };
    }
    return p(clamp(y, y0, y1));
  };
  const ys: number[] = [];
  const CAP = 7;
  if (capB > 0) for (let i = CAP; i >= 1; i--) ys.push(y0 - capB * Math.sin((i / (CAP + 0.5)) * (Math.PI / 2)));
  for (let i = 0; i <= rings; i++) ys.push(lerp(y0, y1, i / rings));
  if (capT > 0) for (let i = 1; i <= CAP; i++) ys.push(y1 + capT * Math.sin((i / (CAP + 0.5)) * (Math.PI / 2)));
  return { ringAt, ys, top: capT > 0 ? y1 + capT : undefined, bottom: capB > 0 ? y0 - capB : undefined };
}

export interface P3 {
  x: number;
  y: number;
  z: number;
}

/** Reparte más vértices al frente (π/2) que atrás: los rasgos de cara y torso viven ahí. */
export const warpU = (v: number, amount: number) => v + amount * Math.cos(v);

/**
 * Malla de un tubo. `displace` permite esculpir relieve (pectorales, nariz…) vértice por vértice.
 * Las normales salen suaves y la costura no se nota (los anillos comparten vértices al cerrar).
 */
export function loft(
  t: Tube,
  seg: number,
  o: {
    warp?: number;
    displace?: (p: P3, u: number, ring: Ring) => void;
    /** Color por vértice (RGB lineal). Se llama antes de `displace`, con el punto aún sin esculpir. */
    paint?: (p: P3, u: number, out: Float32Array, at: number) => void;
  } = {},
): BufferGeometry {
  const { ringAt, ys } = t;
  const rows = ys.length;
  const count = rows * seg + (t.top !== undefined ? 1 : 0) + (t.bottom !== undefined ? 1 : 0);
  const pos = new Float32Array(count * 3);
  const col = o.paint ? new Float32Array(count * 3) : null;
  const p: P3 = { x: 0, y: 0, z: 0 };
  let k = 0;
  for (let i = 0; i < rows; i++) {
    const ring = ringAt(ys[i]!);
    for (let j = 0; j < seg; j++) {
      const u = warpU((j / seg) * Math.PI * 2, o.warp ?? 0);
      const [x, z] = ringXZ(ring, u);
      p.x = x;
      p.y = ring.y;
      p.z = z;
      if (col) o.paint!(p, u, col, k);
      o.displace?.(p, u, ring);
      pos[k++] = p.x;
      pos[k++] = p.y;
      pos[k++] = p.z;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j;
      const b = i * seg + ((j + 1) % seg);
      const c = a + seg;
      const d = b + seg;
      idx.push(a, c, b, b, c, d);
    }
  }
  let v = rows * seg;
  const apex = (y: number, r: Ring) => {
    p.x = r.cx;
    p.y = y;
    p.z = r.cz;
    if (col) o.paint!(p, Math.PI / 2, col, v * 3);
    o.displace?.(p, Math.PI / 2, { ...r, y, w: 0, f: 0, b: 0 });
    pos[v * 3] = p.x;
    pos[v * 3 + 1] = p.y;
    pos[v * 3 + 2] = p.z;
  };
  if (t.top !== undefined) {
    apex(t.top, ringAt(ys[rows - 1]!));
    const base = (rows - 1) * seg;
    for (let j = 0; j < seg; j++) idx.push(base + j, v, base + ((j + 1) % seg));
    v++;
  }
  if (t.bottom !== undefined) {
    apex(t.bottom, ringAt(ys[0]!));
    for (let j = 0; j < seg; j++) idx.push(j, (j + 1) % seg, v);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  if (col) g.setAttribute('color', new BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Prenda sobre un perfil del cuerpo: la tela cuelga desde lo más ancho que tiene arriba.
 * `fit` 0 = pegada al cuerpo, 1 = cae recta; `ease` = holgura en metros.
 */
export function garment(body: RingFn, yTop: number, yBottom: number, o: { ease: number | ((y: number) => number); fit: number | ((y: number) => number) }): RingFn {
  const N = 56;
  const hw: number[] = [];
  const hf: number[] = [];
  const hb: number[] = [];
  let mw = 0;
  let mf = 0;
  let mb = 0;
  for (let i = 0; i < N; i++) {
    const r = body(lerp(yTop, yBottom, i / (N - 1)));
    mw = Math.max(mw, r.w);
    mf = Math.max(mf, r.f);
    mb = Math.max(mb, r.b);
    hw.push(mw);
    hf.push(mf);
    hb.push(mb);
  }
  const at = (arr: number[], y: number) => {
    const x = clamp((yTop - y) / (yTop - yBottom)) * (N - 1);
    const i = Math.min(N - 2, Math.floor(x));
    return lerp(arr[i]!, arr[i + 1]!, x - i);
  };
  return (y) => {
    const r = body(y);
    const fit = typeof o.fit === 'function' ? o.fit(y) : o.fit;
    const ease = typeof o.ease === 'function' ? o.ease(y) : o.ease;
    return { ...r, w: lerp(r.w, Math.max(r.w, at(hw, y)), fit) + ease, f: lerp(r.f, Math.max(r.f, at(hf, y)), fit) + ease, b: lerp(r.b, Math.max(r.b, at(hb, y)), fit) + ease };
  };
}

/** Malla a partir de una rejilla de puntos (para parches pegados a la superficie: cejas, labios, botones…). */
export function gridGeometry(cols: number, rows: number, point: (i: number, j: number) => P3): BufferGeometry {
  const pos = new Float32Array(cols * rows * 3);
  let k = 0;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const p = point(i, j);
      pos[k++] = p.x;
      pos[k++] = p.y;
      pos[k++] = p.z;
    }
  const idx: number[] = [];
  for (let j = 0; j < rows - 1; j++)
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
