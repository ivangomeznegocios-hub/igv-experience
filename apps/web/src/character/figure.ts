import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Shape,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { CharacterData, FaceTrait, Physique } from '@igv/core';
import { clamp, frontZ, garment, gauss, gridGeometry, halfWidth, lerp, loft, pchip, profile, ringXZ, smoothstep, tube, type P3, type Ring, type RingFn, type RingKey } from './geom';

/**
 * Figura 3D del personaje, 100 % paramétrica (sin modelos ni texturas externas):
 *  - La silueta sale de la complexión (`Physique`: estatura, contornos, grasa y músculo).
 *  - Rostro, cabello, barba y ropa salen de `CharacterData` (ajustes del perfil).
 * Unidades en metros; pies en y = 0; el personaje mira hacia +Z; su lado izquierdo es +X.
 *
 * Para afinar el parecido con fotos: ajusta `look.face` (rasgos de −1 a 1), `look.build`, los colores y
 * los estilos. Cada rasgo dice abajo qué anillo o relieve mueve.
 */

export interface FigureSpec {
  physique: Physique;
  character: CharacterData;
}

export interface Figure {
  group: Group;
  /** Estatura en metros. */
  height: number;
  /** Altura del centro de la cara (para encuadrar el rostro). */
  faceY: number;
  dispose(): void;
}

const TAU = Math.PI * 2;
const PI = Math.PI;

const mix = (a: string, b: string, t: number) => `#${new Color(a).lerp(new Color(b), t).getHexString()}`;
const shade = (a: string, f: number) => `#${new Color(a).multiplyScalar(f).getHexString()}`;
const luminance = (hex: string) => {
  const c = new Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};

export function buildFigure(spec: FigureSpec): Figure {
  const { physique: p, character } = spec;
  const { look, outfit } = character;
  const root = new Group();
  const geos: BufferGeometry[] = [];
  const mats = new Map<string, MeshStandardMaterial>();

  const mat = (color: string, roughness: number, o: { double?: boolean; metalness?: number; decal?: boolean; vertex?: boolean } = {}) => {
    const key = `${color}|${roughness}|${o.double ? 1 : 0}|${o.metalness ?? 0}|${o.decal ? 1 : 0}|${o.vertex ? 1 : 0}`;
    let m = mats.get(key);
    if (!m) {
      m = new MeshStandardMaterial({ color, roughness, metalness: o.metalness ?? 0, side: o.double ? DoubleSide : undefined, vertexColors: !!o.vertex });
      if (o.decal) {
        m.polygonOffset = true;
        m.polygonOffsetFactor = -2;
        m.polygonOffsetUnits = -2;
      }
      mats.set(key, m);
    }
    return m;
  };
  const add = (parent: Group, geo: BufferGeometry, material: MeshStandardMaterial, shadow = true) => {
    if (!geos.includes(geo)) geos.push(geo);
    const mesh = new Mesh(geo, material);
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    parent.add(mesh);
    return mesh;
  };

  // ---------- Medidas ----------
  const H = p.heightCm / 100;
  const k = H / 1.75;
  const Y = (frac: number) => frac * H;
  const fat = clamp(p.fat);
  const mus = clamp(p.muscle);
  const g = {
    neck: p.girths.neck / 100,
    shoulders: p.girths.shoulders / 100,
    chest: p.girths.chest / 100,
    waist: p.girths.waist / 100,
    hips: p.girths.hips / 100,
    arm: p.girths.arm / 100,
    forearm: p.girths.forearm / 100,
    thigh: p.girths.thigh / 100,
    calf: p.girths.calf / 100,
  };
  const trait = (t: FaceTrait) => clamp(look.face?.[t] ?? 0, -1, 1);
  const buildShoulders = clamp(look.build?.shoulders ?? 0, -1, 1);
  const buildLegs = clamp(look.build?.legs ?? 0, -1, 1);
  /** Altura de la entrepierna (fracción de la estatura). */
  const cr = 0.47 + buildLegs * 0.015;

  const skinMat = mat(look.skin, 0.58);

  // Ropa: se decide desde aquí porque la piel que queda tapada no se dibuja (más ligero y sin
  // que la piel se asome por debajo de la tela).
  const top = outfit.top;
  const neckY = Y(0.846);
  const waistY = Y(0.606);
  const bottomCfg = {
    short: { ease: 0.014, fit: 0.75, hem: 0.335 },
    jeans: { ease: 0.008, fit: 0.3, hem: 0.05 },
    pantalon: { ease: 0.0095, fit: 0.42, hem: 0.048 },
    jogger: { ease: 0.012, fit: 0.5, hem: 0.072 },
  }[outfit.bottom];
  const pantsHemY = Y(bottomCfg.hem);

  // Torso
  const nC = 2.45;
  const nW = 2.2;
  const nH = 2.35;
  const qC = 0.68 + 0.1 * fat;
  const wC = halfWidth(g.chest, qC, nC);
  const dC = qC * wC;
  const qW = 0.72 + 0.18 * fat;
  const wW = halfWidth(g.waist, qW, nW);
  const dW = qW * wW;
  const qH = 0.74 + 0.06 * fat;
  const wH = halfWidth(g.hips, qH, nH);
  const dH = qH * wH;
  const rN = g.neck / TAU;

  // Brazos
  const rBi = (g.arm * 0.94) / TAU;
  const rD = rBi * 1.2 + 0.004 * mus;
  const rFo = g.forearm / TAU;
  const rEl = 0.6 * rBi + 0.016 * k;
  const shoulderHalf = halfWidth(g.shoulders, 0.5, 2.6) * (1 + 0.05 * buildShoulders);
  /** Centro del brazo en el hombro. */
  const ax = Math.max(shoulderHalf - rD * 0.9, wC * 0.96);
  const shoulderY = Y(0.784);

  // Piernas
  const rTh = g.thigh / TAU;
  const rCa = g.calf / TAU;
  const rKn = 0.03 * k + 0.2 * rTh + 0.22 * rCa;
  const lx = Math.max(wH - rTh * 0.98, rTh * 0.93);
  const fx = Math.max(0.088 * k, lx * 0.8);

  // Cabeza
  const ws = k ** 0.45;
  const hh = 0.238 * ws * (1 + 0.045 * trait('faceLength'));
  const chinY = H - hh;

  // ---------- Torso ----------
  const fW = dW * (1.08 + 0.2 * fat);
  const bW = dW * (0.92 - 0.2 * fat);
  const neckTop = chinY + 0.035 * k;
  const torsoKeys: RingKey[] = [
    // La cadera se mide en lo más salido de los glúteos: el fondo se va hacia atrás, no al frente.
    { y: Y(cr), w: wH * 0.62, f: dH * 0.58, b: dH * 0.9, cz: -0.004 * k, n: 2.2 },
    { y: Y(cr + 0.03), w: wH * 0.95, f: dH * 0.72, b: dH * 1.16, cz: -0.004 * k, n: nH },
    { y: Y(cr + 0.055), w: wH, f: dH * 0.8 + 0.014 * fat, b: dH * 1.2, cz: -0.004 * k, n: nH },
    { y: Y(0.575), w: lerp(wH, wW, 0.55) + 0.012 * fat, f: lerp(dH, dW, 0.6) * (1 + 0.28 * fat), b: lerp(dH, dW, 0.6) * 0.97, cz: 0.002, n: 2.25 },
    { y: Y(0.615), w: wW, f: fW, b: bW, cz: 0.008 + 0.01 * fat, n: nW },
    { y: Y(0.665), w: lerp(wW, wC, 0.6), f: lerp(fW, dC, 0.55), b: lerp(bW, dC, 0.6), cz: 0.006, n: 2.35 },
    { y: Y(0.725), w: wC, f: dC, b: dC, cz: 0.004, n: nC },
    { y: Y(0.765), w: wC * 0.95, f: dC * 0.93, b: dC * 0.98, cz: 0, n: nC },
    { y: shoulderY, w: Math.max(ax, wC * 0.9), f: dC * 0.76, b: dC * 0.88, cz: -0.006, n: 2.4 },
    { y: Y(0.804), w: ax * 0.99, f: lerp(rN, dC * 0.62, 0.6), b: lerp(rN * 1.1, dC * 0.72, 0.6), cz: -0.008, n: 2.3 },
    { y: Y(0.82), w: lerp(rN * 1.15, ax, 0.68 + 0.1 * mus), f: lerp(rN, dC * 0.6, 0.25), b: lerp(rN * 1.12, dC * 0.7, 0.3), cz: -0.007, n: 2.2 },
    { y: Y(0.838), w: lerp(rN * 1.15, ax, 0.26 + 0.14 * mus), f: rN * 1.02, b: rN * 1.12, cz: -0.003, n: 2.1 },
    { y: Y(0.851), w: rN * 1.13, f: rN, b: rN * 1.05, cz: 0.006, n: 2 },
    { y: (Y(0.851) + neckTop) / 2, w: rN, f: rN, b: rN, cz: 0.014, n: 2 },
    { y: neckTop, w: rN * 0.98, f: rN * 0.98, b: rN * 0.98, cz: 0.02, n: 2 },
  ];
  const torso = profile(torsoKeys);

  /** Relieve del torso (pectorales, abdomen, espalda, glúteos) en metros hacia afuera. */
  const pecA = 0.004 + 0.016 * mus + 0.01 * fat;
  const absA = 0.0035 * mus * clamp(1 - fat / 0.3);
  const gluteA = 0.007 + 0.005 * mus + 0.004 * fat;
  const torsoRelief = (x: number, y: number, front: boolean, factor = 1): number => {
    // Valor absoluto suavizado: evita un pliegue marcado en la línea media.
    const axx = Math.sqrt(x * x + (0.022 * k) ** 2);
    const yf = y / H;
    if (front) {
      const dy = yf - 0.742;
      const sy = dy > 0 ? 0.045 : 0.022 - 0.008 * mus + 0.02 * fat;
      let d = pecA * gauss(axx - 0.48 * wC, 0.42 * wC) * gauss(dy, sy);
      if (absA > 0.0002) for (const row of [0.685, 0.648, 0.612]) d += absA * gauss(axx - 0.032 * k, 0.022 * k) * gauss(yf - row, 0.014);
      d -= 0.005 * k * gauss(x, 0.009 * k) * gauss(yf - 0.603, 0.0055);
      return d * factor;
    }
    let d = -(0.0015 + 0.005 * mus * (1 - fat)) * gauss(x, 0.014 * k) * smoothstep(0.55, 0.6, yf) * (1 - smoothstep(0.78, 0.82, yf));
    d += 0.004 * mus * gauss(axx - 0.09 * k, 0.05 * k) * gauss(yf - 0.75, 0.04);
    // Los glúteos van completos en cualquier prenda, para que el pantalón nunca atraviese la playera.
    return d * factor + gluteA * gauss(axx - 0.5 * wH, 0.42 * wH) * gauss(yf - (cr + 0.04), 0.045);
  };
  const torsoDisplace = (factor: number) => (pt: P3, u: number) => {
    const s = Math.sin(u);
    const d = torsoRelief(pt.x, pt.y, s > 0, factor) * Math.min(1, Math.abs(s) * 2.5);
    pt.z += s > 0 ? d : -d;
  };
  /** Z del frente del torso (o de una prenda sobre él) en un punto. */
  const torsoFront = (ring: RingFn, x: number, y: number, factor: number) => frontZ(ring(y), x) + torsoRelief(x, y, true, factor);

  // Con playera solo se ve el cuello; sin ella, de la cintura para arriba (el resto va dentro del pantalón).
  const torsoSkinY = (top === 'ninguna' ? waistY : neckY) - 0.04 * k;
  add(root, loft(tube(torso, torsoSkinY, neckTop, top === 'ninguna' ? 64 : 16), 104, { warp: 0.4, displace: torsoDisplace(1) }), skinMat);

  // ---------- Piernas ----------
  const legTop = Y(cr + 0.065);
  const legCx = (y: number) => lerp(fx, lx, clamp((y - Y(0.05)) / (Y(cr + 0.02) - Y(0.05))));
  const lk = (yf: number, w: number, f: number, b: number, cz = 0): RingKey => ({ y: Y(yf), w, f, b, cz, cx: legCx(Y(yf)), n: 2.1 });
  const leg = profile([
    lk(cr + 0.065, rTh * 0.8, rTh * 0.85, rTh * 0.9),
    lk(cr + 0.02, rTh, rTh * 1.05, rTh * 1.06),
    lk(cr - 0.02, rTh, rTh * 1.03, rTh * 1.03),
    lk(cr - 0.08, rTh * 0.9, rTh * 0.95, rTh * 0.9),
    lk(0.33, rTh * 0.74, rTh * 0.78, rTh * 0.74, 0.002),
    lk(0.287, rKn, rKn * 1.08, rKn * 0.98, 0.004),
    lk(0.262, rKn * 0.9, rKn * 0.92, rKn * 0.95, 0.002),
    lk(0.215, rCa, rCa * 0.82, rCa * 1.18, -0.004),
    lk(0.15, rCa * 0.74, rCa * 0.72, rCa * 0.85, -0.002),
    lk(0.075, 0.031 * k, 0.036 * k, 0.04 * k),
    lk(0.045, 0.033 * k, 0.045 * k, 0.04 * k, 0.003),
    lk(0.025, 0.033 * k, 0.045 * k, 0.04 * k, 0.003),
  ]);
  const left = new Group();
  const right = new Group();
  right.scale.x = -1;
  root.add(left, right);
  const both = (geo: BufferGeometry, material: MeshStandardMaterial) => {
    add(left, geo, material);
    add(right, geo, material);
  };
  both(loft(tube(leg, Y(0.025), pantsHemY + 0.04 * k, outfit.bottom === 'short' ? 44 : 8), 40), skinMat);

  // ---------- Brazos y manos ----------
  const Lu = 0.172 * H;
  const Lf = 0.145 * H;
  const yE = -Lu;
  const yW = -(Lu + Lf);
  const bend = 0.04 * k;
  const rWrW = (0.0205 + 0.003 * fat) * k;
  const rWrD = 0.0285 * k;
  const armTop = rD * 0.82;
  const arm = profile([
    // El deltoides se redondea hacia el cuello: así el hombro se funde con el trapecio.
    { y: armTop, w: rD * 0.36, f: rD * 0.42, b: rD * 0.42, cx: -rD * 0.52 },
    { y: rD * 0.62, w: rD * 0.62, f: rD * 0.68, b: rD * 0.68, cx: -rD * 0.3 },
    { y: rD * 0.35, w: rD * 0.86, f: rD * 0.88, b: rD * 0.88, cx: -rD * 0.1 },
    { y: 0, w: rD * 0.98, f: rD, b: rD },
    { y: -0.045 * H, w: rD * 0.98, f: rD * 1.02, b: rD },
    { y: -0.085 * H, w: rBi * 0.97, f: rBi * 1.03, b: rBi * 1.05 },
    { y: -0.115 * H, w: rBi * 0.98, f: rBi * 1.1, b: rBi * 1.08 },
    { y: -0.15 * H, w: rBi * 0.86, f: rBi * 0.92, b: rBi * 0.9 },
    { y: yE, w: rEl, f: rEl * 0.95, b: rEl * 1.05, cz: 0.002 },
    { y: yE - 0.035 * H, w: rFo, f: rFo, b: rFo * 0.95, cz: 0.2 * bend },
    { y: yE - 0.085 * H, w: rFo * 0.82, f: rFo * 0.85, b: rFo * 0.8, cz: 0.55 * bend },
    { y: yW, w: rWrW, f: rWrD, b: rWrD, cz: bend },
    { y: yW - 0.02 * k, w: 0.0165 * k, f: 0.034 * k, b: 0.03 * k, cz: bend + 0.004, n: 2.4 },
    { y: yW - 0.055 * k, w: 0.0155 * k, f: 0.044 * k, b: 0.036 * k, cz: bend + 0.008, cx: -0.002, n: 2.6 },
    { y: yW - 0.095 * k, w: 0.013 * k, f: 0.04 * k, b: 0.037 * k, cz: bend + 0.012, cx: -0.005, n: 2.8 },
    { y: yW - 0.14 * k, w: 0.0105 * k, f: 0.033 * k, b: 0.034 * k, cz: bend + 0.016, cx: -0.011, n: 2.8 },
    { y: yW - 0.178 * k, w: 0.008 * k, f: 0.025 * k, b: 0.027 * k, cz: bend + 0.018, cx: -0.017, n: 2.6 },
  ]);
  // Los brazos se abren lo necesario para no chocar con la cadera ni la cintura.
  const clearHand = Math.max(wH, lx + rTh) + 0.052 * k;
  const clearElbow = torso(Y(0.625)).w + rEl + 0.03 * k;
  const abduction = clamp(Math.max(Math.asin(clamp((clearHand - ax) / (0.36 * H), 0, 0.9)), Math.asin(clamp((clearElbow - ax) / Lu, 0, 0.9)), 0.1), 0.1, 0.6);
  const armL = new Group();
  const armR = new Group();
  armL.position.set(ax, shoulderY, -0.008);
  armL.rotation.z = abduction;
  armR.position.set(-ax, shoulderY, -0.008);
  armR.rotation.z = -abduction;
  armR.scale.x = -1;
  root.add(armL, armR);
  const arms = (geo: BufferGeometry, material: MeshStandardMaterial) => {
    add(armL, geo, material);
    add(armR, geo, material);
  };
  /** Hasta dónde llega la manga (null = sin mangas). */
  const sleeveEnd = top === 'ninguna' ? null : top === 'playera' ? -0.105 * H : yW + 0.03 * k;
  const handTip = yW - 0.178 * k;
  arms(
    sleeveEnd === null
      ? loft(tube(arm, handTip, armTop, 96, { top: rD * 0.1, bottom: 0.012 * k }), 36)
      : loft(tube(arm, handTip, sleeveEnd + 0.03 * k, top === 'playera' ? 64 : 30, { bottom: 0.012 * k }), 36),
    skinMat,
  );
  const thumbGeo = new CapsuleGeometry(0.0105 * k, 0.042 * k, 4, 10);
  for (const a of [armL, armR]) {
    const th = add(a, thumbGeo, skinMat);
    th.position.set(-0.004 * k, yW - 0.06 * k, bend + 0.046 * k);
    th.rotation.x = -0.45;
  }

  // ---------- Cabeza ----------
  const J = trait('jaw');
  const fa = 0.007 * fat;
  const hk = (t: number, w: number, cz: number, f: number, b: number, n: number): RingKey => ({ y: t, w: w * ws, cz: cz * ws, f: f * ws, b: b * ws, n });
  const headT = tube(
    profile([
      hk(0.0, 0.03 + 0.005 * J + fa * 0.5, 0.05, 0.031, 0.042, 2.4),
      hk(0.06, 0.044 + 0.007 * J + fa, 0.044, 0.041, 0.056, 2.4),
      hk(0.16, 0.056 + 0.008 * J + fa, 0.035, 0.052, 0.068, 2.35),
      hk(0.28, 0.064 + 0.006 * J + fa, 0.024, 0.064, 0.082, 2.25),
      hk(0.42, 0.0685 + 0.003 * trait('cheeks') + fa * 0.6, 0.015, 0.073, 0.099, 2.15),
      hk(0.55, 0.0735, 0.009, 0.078, 0.107, 2.1),
      hk(0.68, 0.0755, 0.005, 0.08, 0.108, 2.1),
      hk(0.8, 0.0715, 0.0, 0.076, 0.101, 2.1),
    ]),
    0,
    0.8,
    84,
    { top: 0.2, bottom: 0.022 },
  );
  // Los mismos anillos se piden miles de veces (cabello, barba, parches): se guardan por altura.
  const headRingCache = new Map<number, Ring>();
  const headRingRaw = headT.ringAt;
  headT.ringAt = (t) => {
    let r = headRingCache.get(t);
    if (!r) headRingCache.set(t, (r = headRingRaw(t)));
    return r;
  };
  const noseH = 0.021 * (1 + 0.3 * trait('nose'));
  const noseW = 1 + 0.3 * trait('noseWidth');
  const noseHeight = pchip([0.355, 0.4, 0.5, 0.585, 0.625], [0, noseH, 0.0095, 0.004, 0]);
  const noseSigma = pchip([0.355, 0.4, 0.5, 0.6], [0.0135 * noseW, 0.0115 * noseW, 0.0085, 0.0075]);
  const eyeX = (0.0315 + 0.003 * trait('eyeSpacing')) * ws;
  const eyeT = 0.555;
  /** Relieve de la cara (nariz, cuencas, pómulos, boca, mentón): desplazamiento en Z. */
  const faceRelief = (x: number, t: number): number => {
    if (t < -0.02 || t > 0.8) return 0;
    const xs = x / ws;
    const ax2 = Math.abs(xs);
    let d = 0;
    if (t > 0.355 && t < 0.625) d += noseHeight(t) * gauss(xs, noseSigma(t));
    d += 0.0035 * gauss(t - 0.608, 0.03) * (1 - smoothstep(0.045, 0.065, ax2));
    d -= 0.007 * gauss(ax2 - eyeX / ws, 0.015) * gauss(t - eyeT, 0.035);
    d += 0.003 * (1 + trait('cheeks')) * gauss(ax2 - 0.045, 0.02) * gauss(t - 0.43, 0.06);
    d += 0.004 * gauss(xs, 0.025) * gauss(t - 0.27, 0.05);
    d += 0.004 * gauss(xs, 0.018) * gauss(t - 0.09, 0.05);
    return d * ws;
  };
  const headY = (t: number) => chinY + t * hh;
  /** Punto de la superficie de la cabeza en (ángulo u, altura t de 0 = mentón a 1 = coronilla). */
  const headRaw = (u: number, t: number): Vector3 => {
    const ring = headT.ringAt(t);
    const [x, z] = ringXZ(ring, u);
    const s = Math.sin(u);
    return new Vector3(x, headY(t), z + (s > 0 ? faceRelief(x, t) * Math.min(1, s * 3) : 0));
  };
  const headPoint = (u: number, t: number, off = 0): Vector3 => {
    const tt = clamp(t, -0.025, 0.992);
    const pt = headRaw(u, tt);
    if (off === 0) return pt;
    const du = headRaw(u + 0.02, tt).sub(headRaw(u - 0.02, tt));
    const dt = headRaw(u, tt + 0.006).sub(headRaw(u, tt - 0.006));
    const n = dt.cross(du).normalize();
    return pt.addScaledVector(n, off);
  };
  /** Punto del frente de la cara en (x, t), levantado `off` metros sobre la piel. */
  const facePoint = (x: number, t: number, off = 0): Vector3 => {
    const z = (xx: number, tt: number) => frontZ(headT.ringAt(tt), xx) + faceRelief(xx, tt);
    const pt = new Vector3(x, headY(t), z(x, t));
    if (off === 0) return pt;
    const a = (z(x + 0.002, t) - z(x - 0.002, t)) / 0.004;
    const b = (z(x, t + 0.008) - z(x, t - 0.008)) / (0.016 * hh);
    return pt.addScaledVector(new Vector3(-a, -b, 1).normalize(), off);
  };

  const HEAD_SEG = 128;
  const HEAD_WARP = 0.45;
  add(
    root,
    loft(headT, HEAD_SEG, {
      warp: HEAD_WARP,
      displace: (pt, u) => {
        const s = Math.sin(u);
        if (s > 0) pt.z += faceRelief(pt.x, pt.y) * Math.min(1, s * 3);
        pt.y = headY(pt.y);
      },
    }),
    skinMat,
  );

  // Orejas
  const earRing = headT.ringAt(0.47);
  const earGeo = new SphereGeometry(1, 18, 14);
  for (const side of [1, -1]) {
    const ear = add(root, earGeo, skinMat);
    ear.scale.set(0.0055 * ws, 0.028 * ws, 0.015 * ws);
    ear.position.set(side * (earRing.w - 0.0005 * ws + 0.002 * ws * trait('ears')), headY(0.47), earRing.cz - 0.012 * ws);
    ear.rotation.y = -side * (0.3 + 0.3 * trait('ears'));
    ear.rotation.z = -side * 0.08;
  }

  // Ojos, cejas y labios (parches pegados a la superficie de la cara)
  const eyeHW = 0.0135 * ws * (1 + 0.12 * trait('eyes'));
  const eyeHH = 0.0052 * ws * (1 + 0.25 * trait('eyes'));
  const scleraMat = mat('#e9e3da', 0.35, { double: true, decal: true });
  const irisMat = mat(look.eyeColor, 0.3, { double: true, decal: true });
  const pupilMat = mat('#0c0a09', 0.25, { double: true, decal: true });
  const lidMat = mat(mix(look.skin, '#1a100c', 0.78), 0.6, { double: true, decal: true });
  const browColor = look.hair === 'calvo' ? mix(look.hairColor, '#2a1e17', 0.5) : look.hairColor;
  const browMat = mat(shade(browColor, 0.9), 0.75, { double: true, decal: true });
  const lipMat = mat(mix(look.skin, '#9c4a45', 0.32), 0.5, { double: true, decal: true });
  const mouthMat = mat(mix(look.skin, '#3a1c1a', 0.65), 0.6, { double: true, decal: true });
  const lidCurve = (s: number) => (1 - s * s) ** 0.75;
  for (const side of [1, -1]) {
    const cx = side * eyeX;
    add(
      root,
      gridGeometry(13, 7, (i, j) => {
        const s = (i / 12) * 2 - 1;
        const v = (j / 6) * 2 - 1;
        return facePoint(cx + s * eyeHW, eyeT + (v * eyeHH * lidCurve(s)) / hh, 0.0005);
      }),
      scleraMat,
      false,
    );
    const disc = (r: number, off: number) =>
      gridGeometry(19, 3, (i, j) => {
        const a = (i / 18) * TAU;
        const rr = (j / 2) * r;
        return facePoint(cx + rr * Math.cos(a), eyeT + (rr * Math.sin(a)) / hh, off);
      });
    add(root, disc(eyeHH * 0.98, 0.0008), irisMat, false);
    add(root, disc(eyeHH * 0.42, 0.0011), pupilMat, false);
    add(
      root,
      gridGeometry(13, 2, (i, j) => {
        const s = (i / 12) * 2 - 1;
        return facePoint(cx + s * eyeHW * 1.04, eyeT + (eyeHH * lidCurve(s * 0.98) + (j - 0.35) * 0.0016 * ws) / hh, 0.0012);
      }),
      lidMat,
      false,
    );
    // Ceja
    const browTh = (0.0026 + 0.0013 * trait('brows')) * ws;
    add(
      root,
      gridGeometry(11, 3, (i, j) => {
        const s = (i / 10) * 2 - 1;
        const v = j - 1;
        const arch = (0.004 * (1 - s * s) - 0.0015 * s) * ws;
        const th = browTh * (1 - 0.5 * Math.max(0, s)) * (1 - 0.25 * Math.max(0, -s));
        return facePoint(side * (eyeX * 1.04 + s * 0.022 * ws), 0.612 + (arch + v * th) / hh, 0.0012);
      }),
      browMat,
      false,
    );
  }
  const lipHW = 0.0235 * ws * (1 + 0.08 * trait('lips'));
  const lipHH = 0.0058 * ws * (1 + 0.45 * trait('lips'));
  const mouthT = 0.268;
  add(
    root,
    gridGeometry(21, 7, (i, j) => {
      const s = (i / 20) * 2 - 1;
      const v = (j / 6) * 2 - 1;
      return facePoint(s * lipHW, mouthT + (v * lipHH * (v < 0 ? 1.12 : 0.85) * (1 - s * s) ** 0.7) / hh, 0.0013);
    }),
    lipMat,
    false,
  );
  add(
    root,
    gridGeometry(15, 2, (i, j) => {
      const s = (i / 14) * 2 - 1;
      return facePoint(s * lipHW * 0.94, mouthT + ((j - 0.5) * 0.0011 * ws * (1 - s * s) ** 0.5) / hh, 0.0017);
    }),
    mouthMat,
    false,
  );

  // ---------- Cabello y barba ----------
  /** Ángulo desde el frente de la cara (0 = frente, π = nuca). */
  const fromFront = (u: number) => {
    let d = (u - PI / 2) % TAU;
    if (d > PI) d -= TAU;
    if (d < -PI) d += TAU;
    return Math.abs(d);
  };
  /** Cáscara sobre la cabeza: `fn` da el punto y qué tanto existe ahí (0 = nada). */
  const shell = (ts: number[], fn: (u: number, t: number) => { p: Vector3; m: number }, apex?: Vector3, fade?: { from: string; to: string }): BufferGeometry => {
    const rows = ts.length;
    const pos: number[] = [];
    const mask: number[] = [];
    const col: number[] = [];
    const c0 = new Color(fade?.from ?? '#ffffff');
    const c1 = new Color(fade?.to ?? '#ffffff');
    const tmp = new Color();
    const SEG = 96;
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < SEG; j++) {
        const v = (j / SEG) * TAU;
        const r = fn(v + HEAD_WARP * Math.cos(v), ts[i]!);
        pos.push(r.p.x, r.p.y, r.p.z);
        mask.push(r.m);
        if (fade) {
          tmp.copy(c0).lerp(c1, smoothstep(0.1, 0.7, r.m));
          col.push(tmp.r, tmp.g, tmp.b);
        }
      }
    const idx: number[] = [];
    const tri = (a: number, b: number, c: number) => {
      if (Math.max(mask[a]!, mask[b]!, mask[c]!) > 0.02) idx.push(a, b, c);
    };
    for (let i = 0; i < rows - 1; i++)
      for (let j = 0; j < SEG; j++) {
        const a = i * SEG + j;
        const b = i * SEG + ((j + 1) % SEG);
        tri(a, a + SEG, b);
        tri(b, a + SEG, b + SEG);
      }
    if (apex) {
      const v = pos.length / 3;
      pos.push(apex.x, apex.y, apex.z);
      mask.push(1);
      const base = (rows - 1) * SEG;
      for (let j = 0; j < SEG; j++) idx.push(base + j, v, base + ((j + 1) % SEG));
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    if (fade) geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  };
  const steps = (a: number, b: number, n: number) => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));

  const hairline = pchip(
    [0, 0.2, 0.32, 0.385, 0.43, 0.47, 0.5, 0.6, 0.68, 0.82, 1].map((x) => x * PI),
    [0.8, 0.785, 0.72, 0.56, 0.5, 0.56, 0.615, 0.6, 0.42, 0.3, 0.28],
  );
  /** Borde de la gorra: sobre la frente al frente, más abajo en la nuca. */
  const capLine = (phi: number) => 0.7 - 0.17 * (1 - Math.cos(phi)) * 0.5;
  const hairMat = mat(look.hairColor, 0.86);
  if (look.hair !== 'calvo') {
    const volume = (u: number, phi: number, t: number): number => {
      const top = smoothstep(0.6, 0.9, t);
      const fw = Math.cos(phi / 2) ** 2;
      switch (look.hair) {
        case 'rapado':
          return 0.0022;
        case 'corto':
          return 0.005 + 0.008 * top + 0.002 * top * fw;
        case 'volumen':
          return 0.007 + 0.015 * top + 0.016 * top * fw * fw;
        case 'lado':
          return 0.006 + 0.009 * top + 0.009 * top * Math.max(0, Math.cos(u - 0.5)) - 0.006 * top * gauss(u - (PI - 0.95), 0.1);
        case 'chino':
          return 0.011 + 0.012 * top + 0.005 * Math.sin(u * 11 + t * 27) * Math.sin(t * 37 + u * 5);
        default:
          return 0.006;
      }
    };
    const hairAt = (u: number, t: number) => {
      const phi = fromFront(u);
      const hl = hairline(phi);
      if (t <= hl) return { p: headPoint(u, hl, 0.001), m: 1 };
      // El volumen crece desde el nacimiento del pelo; a los lados y en la nuca más gradual (degradado).
      const ramp = lerp(0.06, 0.11, smoothstep(0.28 * PI, 0.42 * PI, phi));
      let off = Math.max(0.001, volume(u, phi, t) * ws * smoothstep(0, ramp, t - hl));
      if (outfit.cap && t > capLine(phi) - 0.03) off = Math.min(off, 0.0035);
      return { p: headPoint(u, t, off), m: 1 };
    };
    const apexOff = outfit.cap ? 0.0035 : volume(0, PI / 2, 1) * ws;
    add(root, shell(steps(0.26, 0.992, 56), hairAt, new Vector3(headT.ringAt(0.8).cx, headY(1) + apexOff, headT.ringAt(0.8).cz)), hairMat);
  }

  if (look.beard !== 'ninguna') {
    const beardTop = pchip([0, 0.12, 0.2, 0.3, 0.38, 0.43].map((x) => x * PI), [0.345, 0.345, 0.33, 0.37, 0.44, 0.5]);
    const thick = { sombra: 0.0007, corta: 0.0035, completa: 0.0095, candado: 0.006, bigote: 0.004 }[look.beard] * ws;
    const beardAt = (u: number, t: number) => {
      const phi = fromFront(u);
      const pt0 = headPoint(u, t);
      let m = smoothstep(0, look.beard === 'sombra' ? 0.08 : 0.045, beardTop(Math.min(phi, 0.43 * PI)) - t);
      const side = 1 - smoothstep(0.43 * PI, 0.47 * PI, phi);
      if (look.beard === 'candado') m *= 1 - smoothstep(0.15 * PI, 0.19 * PI, phi);
      else if (look.beard === 'bigote') m *= (1 - smoothstep(0.13 * PI, 0.17 * PI, phi)) * smoothstep(0.285, 0.3, t);
      else m *= side;
      const e = Math.hypot(pt0.x / (0.027 * ws), (t - mouthT) / 0.03);
      if (look.beard !== 'sombra') m *= smoothstep(1.0, 1.7, e);
      const chin = look.beard === 'completa' ? 1 + 0.5 * gauss(t - 0.05, 0.1) * gauss(phi, 0.5) : 1;
      return { p: headPoint(u, t, Math.max(0.0003, thick * chin * smoothstep(0.05, 0.75, m))), m };
    };
    const beardColor = look.beard === 'sombra' ? mix(look.skin, look.hairColor, 0.4) : look.beard === 'corta' ? mix(look.skin, look.hairColor, 0.85) : look.hairColor;
    add(root, shell(steps(0.004, 0.54, 48), beardAt, undefined, { from: look.skin, to: beardColor }), mat('#ffffff', 0.75, { decal: true, vertex: true }), false);
  }

  // ---------- Lentes y gorra ----------
  if (look.glasses) {
    const frame = mat('#15171b', 0.35, { metalness: 0.3 });
    const zg = facePoint(eyeX, eyeT).z + 0.013 * ws;
    const gy = headY(eyeT) - 0.001;
    const rx = 0.0235 * ws;
    const ry = 0.0185 * ws;
    const tubeOf = (pts: Vector3[], closed: boolean, r = 0.0014 * ws) => new TubeGeometry(new CatmullRomCurve3(pts, closed), closed ? 48 : 16, r, 6, closed);
    for (const side of [1, -1]) {
      const rim = Array.from({ length: 20 }, (_, i) => {
        const a = (i / 20) * TAU;
        const c = Math.cos(a);
        const s = Math.sin(a);
        // Superelipse: aro rectangular redondeado.
        return new Vector3(side * eyeX + rx * Math.sign(c) * Math.abs(c) ** 0.7, gy + ry * Math.sign(s) * Math.abs(s) ** 0.7, zg - 0.004 * ws * Math.abs(c) ** 2);
      });
      add(root, tubeOf(rim, true), frame);
      const hinge = new Vector3(side * (eyeX + rx), gy + ry * 0.35, zg - 0.004 * ws);
      add(root, tubeOf([hinge, new Vector3(side * (earRing.w + 0.004 * ws), gy + ry * 0.3, zg - 0.05 * ws), new Vector3(side * (earRing.w + 0.004 * ws), headY(0.55), earRing.cz - 0.002)], false), frame);
    }
    add(root, tubeOf([new Vector3(-(eyeX - rx), gy + ry * 0.3, zg - 0.004 * ws), new Vector3(0, gy + ry * 0.45, zg + 0.001), new Vector3(eyeX - rx, gy + ry * 0.3, zg - 0.004 * ws)], false), frame);
  }
  if (outfit.cap) {
    const capMat = mat(outfit.capColor, 0.85, { double: true });
    const capOff = 0.0065 * ws;
    const capAt = (u: number, t: number) => ({ p: headPoint(u, Math.max(t, capLine(fromFront(u))), capOff), m: 1 });
    const crown = headT.ringAt(0.8);
    add(root, shell(steps(0.5, 0.992, 36), capAt, new Vector3(crown.cx, headY(1) + capOff, crown.cz)), capMat);
    const button = add(root, new SphereGeometry(0.008 * ws, 12, 8), capMat);
    button.position.set(crown.cx, headY(1) + capOff + 0.001, crown.cz);
    button.scale.y = 0.5;
    const span = 0.34 * PI;
    add(
      root,
      gridGeometry(21, 8, (i, j) => {
        const s = (i / 20) * 2 - 1;
        const r = j / 7;
        const base = headPoint(PI / 2 - s * span, capLine(Math.abs(s) * span), capOff);
        const len = 0.078 * ws * (1 - 0.55 * s * s);
        return { x: base.x * (1 + 0.1 * r), y: base.y - 0.02 * ws * r - 0.012 * ws * r * r - 0.01 * ws * s * s * r, z: base.z + len * r };
      }),
      capMat,
    );
  }

  // ---------- Ropa: parte de arriba ----------
  if (top !== 'ninguna' && sleeveEnd !== null) {
    const cloth = mat(outfit.topColor, 0.9, { double: true });
    const long = top !== 'playera';
    const hoodie = top === 'sudadera';
    const ease = hoodie ? 0.02 : top === 'camisa' ? 0.011 : 0.012;
    const fit = hoodie ? 0.8 : top === 'camisa' ? 0.5 : 0.55;
    const relief = hoodie ? 0.4 : 0.55;
    const hemY = Y(cr + (hoodie ? 0.02 : 0.03));
    const band = 0.05 * k;
    const body = garment(torso, neckY, hemY, {
      ease: (y) => (hoodie ? lerp(0.012, ease, smoothstep(hemY, hemY + band, y)) : ease),
      fit: (y) => (hoodie ? fit * smoothstep(hemY, hemY + band * 1.4, y) : fit),
    });
    add(root, loft(tube(body, hemY, neckY, 64), 88, { warp: 0.4, displace: torsoDisplace(relief) }), cloth);
    // Cuello
    if (top === 'camisa') {
      const c0 = neckY - 0.004;
      const c1 = neckY + 0.034 * k;
      add(root, loft(tube(garment(torso, c1, c0, { ease: (y) => 0.005 + 0.007 * ((y - c0) / (c1 - c0)), fit: 0 }), c0, c1, 8), 64), cloth);
      const placket = mat(shade(outfit.topColor, 0.9), 0.9, { double: true, decal: true });
      const y0 = hemY + 0.004;
      const y1 = Y(0.838);
      add(
        root,
        gridGeometry(3, 44, (i, j) => {
          const x = (i - 1) * 0.013 * k;
          const y = lerp(y0, y1, j / 43);
          return { x, y, z: torsoFront(body, x, y, relief) + 0.0012 };
        }),
        placket,
        false,
      );
      const buttonMat = mat(luminance(outfit.topColor) > 0.45 ? '#3b3f47' : '#e6e2da', 0.4);
      const buttonGeo = new SphereGeometry(0.005 * k, 10, 8);
      for (let i = 0; i < 6; i++) {
        const y = lerp(hemY + 0.06 * k, Y(0.825), i / 5);
        const b = add(root, buttonGeo, buttonMat, false);
        b.position.set(0, y, torsoFront(body, 0, y, relief) + 0.002);
        b.scale.z = 0.4;
      }
    } else {
      const rib = hoodie ? 0.022 * k : 0.012 * k;
      const ribTop = neckY + (hoodie ? 0.006 * k : 0.002);
      add(root, loft(tube(garment(torso, ribTop, neckY - rib, { ease: ease + (hoodie ? 0.005 : 0.0028), fit }), neckY - rib, ribTop, 6), 64), cloth);
    }
    if (hoodie) {
      const hood = add(root, new SphereGeometry(1, 24, 16), cloth);
      const back = torso(Y(0.84));
      hood.scale.set(0.115 * k, 0.062 * k, 0.04 * k);
      hood.position.set(0, Y(0.826), back.cz - back.b - 0.022 * k);
      hood.rotation.x = 0.2;
    }
    // Mangas
    const cuff = 0.04 * k;
    const sEase = hoodie ? 0.016 : 0.009;
    const sFit = hoodie ? 0.6 : long ? 0.3 : 0.5;
    const sleeve = garment(arm, armTop, sleeveEnd, {
      ease: (y) => (long ? lerp(0.006, sEase, smoothstep(sleeveEnd, sleeveEnd + cuff, y)) : sEase),
      fit: (y) => (long ? sFit * smoothstep(sleeveEnd, sleeveEnd + cuff * 1.5, y) : sFit),
    });
    arms(loft(tube(sleeve, sleeveEnd, armTop, long ? 70 : 28, { top: rD * 0.1 + sEase }), 36), cloth);
  }

  // ---------- Ropa: parte de abajo ----------
  {
    const style = outfit.bottom;
    const cloth = mat(outfit.bottomColor, style === 'jeans' ? 0.82 : 0.92, { double: true });
    const cfg = bottomCfg;
    const pelvisEase = 0.0075;
    const pelvis = garment(torso, waistY, Y(cr), { ease: pelvisEase, fit: 0.2 });
    add(root, loft(tube(pelvis, Y(cr), waistY, 30, { bottom: 0.022 * k + pelvisEase }), 96, { warp: 0.4, displace: torsoDisplace(0.9) }), cloth);
    const hemY = pantsHemY;
    const cuff = 0.035 * k;
    const jogger = style === 'jogger';
    const pant = garment(leg, legTop, hemY, {
      ease: (y) => (jogger ? lerp(0.005, cfg.ease, smoothstep(hemY, hemY + cuff, y)) : cfg.ease),
      fit: (y) => (jogger ? cfg.fit * smoothstep(hemY, hemY + cuff * 2.5, y) : cfg.fit),
    });
    both(loft(tube(pant, hemY, legTop, style === 'short' ? 28 : 64, { top: 0.03 * k + cfg.ease }), 40), cloth);
    if ((style === 'jeans' || style === 'pantalon') && top === 'ninguna') {
      const beltMat = mat(style === 'jeans' ? '#3a2a1c' : '#17181b', 0.6, { double: true });
      const belt = garment(torso, Y(0.607), Y(0.583), { ease: pelvisEase + 0.0028, fit: 0.2 });
      add(root, loft(tube(belt, Y(0.585), Y(0.604), 4), 96, { warp: 0.4, displace: torsoDisplace(0.9) }), beltMat);
      const buckle = add(root, new BoxGeometry(0.036 * k, 0.024 * k, 0.004), mat('#a9adb3', 0.3, { metalness: 0.7 }));
      buckle.position.set(0, Y(0.5945), torsoFront(belt, 0, Y(0.5945), 0.9) + 0.002);
    }
  }

  // ---------- Calcetines y zapatos ----------
  both(loft(tube(garment(leg, Y(0.1), Y(0.03), { ease: 0.003, fit: 0 }), Y(0.035), Y(0.092), 8), 40), mat('#d8d5cf', 0.95, { double: true }));
  {
    const dress = outfit.shoes === 'zapato';
    const L = 0.275 * k;
    const heelBack = -0.078 * k;
    const c = dress ? 0.026 * k : 0.03 * k;
    const sk = (s: number, w: number, up: number, down: number): RingKey => ({ y: -s * L, w: w * k, f: up * k, b: down * k, cz: c, n: 2.5 });
    const upper = profile(
      dress
        ? [sk(0, 0.026, 0.034, 0.018), sk(0.06, 0.034, 0.05, 0.022), sk(0.2, 0.038, 0.056, 0.024), sk(0.33, 0.04, 0.054, 0.024), sk(0.46, 0.043, 0.04, 0.024), sk(0.64, 0.046, 0.026, 0.023), sk(0.84, 0.042, 0.019, 0.022), sk(0.97, 0.027, 0.014, 0.018)]
        : [sk(0, 0.027, 0.038, 0.02), sk(0.06, 0.036, 0.058, 0.026), sk(0.2, 0.04, 0.066, 0.028), sk(0.33, 0.042, 0.064, 0.028), sk(0.46, 0.046, 0.049, 0.028), sk(0.63, 0.05, 0.033, 0.027), sk(0.83, 0.05, 0.024, 0.026), sk(0.96, 0.038, 0.018, 0.022)],
    );
    const upperGeo = loft(tube(upper, -0.97 * L, 0, 40, { top: 0.014 * k, bottom: 0.02 * k }), 32);
    upperGeo.rotateX(-PI / 2);
    upperGeo.translate(0, 0, heelBack);
    const soleH = (dress ? 0.009 : 0.02) * k;
    const outline = new Shape();
    const N = 28;
    const half = (s: number) => upper(-clamp(s, 0, 0.97) * L).w * (dress ? 1.03 : 1.06) * Math.sqrt(clamp(1 - Math.max(0, (s - 0.9) / 0.14) ** 2)) * Math.sqrt(clamp(1 - Math.max(0, (0.06 - s) / 0.1) ** 2));
    for (let i = 0; i <= N; i++) {
      const s = lerp(-0.035, 1.035, i / N);
      const pt: [number, number] = [half(s), s * L];
      if (i === 0) outline.moveTo(...pt);
      else outline.lineTo(...pt);
    }
    for (let i = N; i >= 0; i--) outline.lineTo(-half(lerp(-0.035, 1.035, i / N)), lerp(-0.035, 1.035, i / N) * L);
    const soleGeo = new ExtrudeGeometry(outline, { depth: soleH, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 2, curveSegments: 4 });
    soleGeo.rotateX(PI / 2);
    soleGeo.translate(0, soleH + 0.002, heelBack);
    const upperMat = mat(outfit.shoesColor, dress ? 0.35 : 0.7);
    const soleMat = mat(dress ? '#141414' : luminance(outfit.shoesColor) > 0.6 ? '#cfccc5' : '#f1efe9', 0.8);
    const heelGeo = dress ? new BoxGeometry(0.066 * k, 0.012 * k, 0.07 * k) : null;
    for (const side of [1, -1]) {
      const shoe = new Group();
      shoe.position.set(side * fx, 0, 0);
      shoe.rotation.y = side * 0.13;
      const up = add(shoe, upperGeo, upperMat);
      up.position.y = dress ? 0.008 * k : 0.004 * k;
      const sole = add(shoe, soleGeo, soleMat);
      sole.position.y = dress ? 0.006 * k : -0.002;
      if (heelGeo) {
        const heel = add(shoe, heelGeo, soleMat);
        heel.position.set(0, 0.006 * k, heelBack + 0.045 * k);
      }
      root.add(shoe);
    }
  }

  // ---------- Reloj ----------
  if (outfit.watch) {
    const strap = mat('#1b1c1f', 0.7, { double: true });
    add(armL, loft(tube(garment(arm, yW + 0.03 * k, yW + 0.002 * k, { ease: 0.0025, fit: 0 }), yW + 0.005 * k, yW + 0.027 * k, 4), 36), strap);
    const face = add(armL, new CylinderGeometry(0.0185 * k, 0.0185 * k, 0.009 * k, 28), mat('#c9ccd1', 0.25, { metalness: 0.8 }));
    face.rotation.z = PI / 2;
    face.position.set(rWrW + 0.0045, yW + 0.016 * k, arm(yW + 0.016 * k).cz);
    const dial = add(armL, new CylinderGeometry(0.0155 * k, 0.0155 * k, 0.0095 * k, 28), mat('#101114', 0.2));
    dial.rotation.z = PI / 2;
    dial.position.copy(face.position);
    dial.position.x += 0.0006;
  }

  return {
    group: root,
    height: H,
    faceY: headY(0.5),
    dispose() {
      for (const geo of geos) geo.dispose();
      for (const m of mats.values()) m.dispose();
    },
  };
}
