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

  const mat = (color: string, roughness: number, o: { double?: boolean; metalness?: number; decal?: boolean; vertex?: boolean; alpha?: boolean; depthWrite?: boolean } = {}) => {
    const key = `${color}|${roughness}|${o.double ? 1 : 0}|${o.metalness ?? 0}|${o.decal ? 1 : 0}|${o.vertex ? 1 : 0}|${o.alpha ? 1 : 0}|${o.depthWrite === false ? 0 : 1}`;
    let m = mats.get(key);
    if (!m) {
      m = new MeshStandardMaterial({ color, roughness, metalness: o.metalness ?? 0, vertexColors: !!o.vertex });
      if (o.double) m.side = DoubleSide;
      if (o.alpha) {
        // Con color RGBA por vértice el borde se desvanece sobre la piel (sin recuadros ni costuras).
        m.transparent = true;
        m.depthWrite = o.depthWrite ?? false;
      }
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
    // El cuello queda por detrás del mentón (unos 2 cm), como en un perfil real.
    { y: Y(0.851), w: rN * 1.13, f: rN, b: rN * 1.05, cz: 0.004, n: 2 },
    { y: (Y(0.851) + neckTop) / 2, w: rN, f: rN, b: rN, cz: 0.004, n: 2 },
    { y: neckTop, w: rN * 0.98, f: rN * 0.98, b: rN * 0.98, cz: 0.002, n: 2 },
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
  // Alturas de los rasgos en `t` (0 = mentón, ~1 = coronilla) con proporciones promedio de adulto:
  // ojos a media cabeza, base de la nariz a ~7 cm del mentón, boca a un tercio de ese tramo,
  // cejas ~1.8 cm sobre la pupila y orejas de la ceja a la base de la nariz.
  const J = trait('jaw');
  const CH = trait('chin');
  const CK = trait('cheeks');
  const lowerF = 1 + 0.12 * trait('lowerFace');
  const tNose = 0.3 * lowerF;
  const tMouth = 0.203 * lowerF;
  const tChin = 0.07 * lowerF;
  const tEye = tNose + 0.195 * (1 + 0.1 * trait('midFace'));
  const tBrow = tEye + 0.075 + 0.014 * trait('browHeight');
  const tHairline = tEye + 0.32 + 0.03 * trait('forehead');
  const tEar = tEye - 0.12;
  const FU = trait('fullness');
  const capH = 0.2 * (1 + 0.3 * trait('crown'));
  /** Coronilla. */
  const tTop = 0.8 + capH;
  /** Tejido blando: la grasa corporal y el rasgo `fullness` llenan mejillas, mandíbula y mentón. */
  const soft = 0.007 * fat + 0.005 * FU;
  const nLow = 2.3 + 0.35 * FU;
  // Anillo de la cabeza: medio ancho `w`, frente en `front`, centro en `cz` (lo más ancho queda ahí) y fondo atrás `b`.
  // En la mandíbula el centro va atrás, bajo la oreja, para que el contorno se funda con el cuello.
  const hk = (t: number, w: number, front: number, cz: number, b: number, n: number): RingKey => ({ y: t, w: w * ws, cz: cz * ws, f: (front - cz) * ws, b: b * ws, n });
  const headT = tube(
    profile([
      hk(0, 0.033 + 0.009 * CH + soft * 0.5, 0.078, 0.02, 0.034, nLow + 0.3),
      hk(0.045 * lowerF, 0.047 + 0.01 * CH + 0.003 * J + soft * 0.9, 0.085, 0.018, 0.04, nLow + 0.3),
      hk(0.11 * lowerF, 0.0555 + 0.006 * CH + 0.007 * J + soft * 1.1, 0.086, 0.015, 0.046, nLow),
      hk(tMouth + 0.005, 0.0625 + 0.01 * J + soft * 1.2, 0.087, 0.013, 0.058, nLow),
      hk(tNose + 0.01, 0.068 + 0.006 * J + 0.002 * CK + soft, 0.087, 0.012, 0.082, 2.2 + 0.2 * FU),
      hk(tNose + 0.1, 0.0712 + 0.003 * CK + soft * 0.5, 0.086, 0.01, 0.1, 2.15),
      hk(tEye + 0.005, 0.0735, 0.085, 0.008, 0.107, 2.1),
      hk(0.65, 0.0755, 0.084, 0.005, 0.108, 2.1),
      hk(0.8, 0.067, 0.072, 0, 0.099, 2.1),
    ]),
    0,
    0.8,
    84,
    { top: capH, bottom: 0.02 },
  );
  // Los mismos anillos se piden miles de veces (cabello, barba, parches): se guardan por altura.
  const headRingCache = new Map<number, Ring>();
  const headRingRaw = headT.ringAt;
  headT.ringAt = (t) => {
    let r = headRingCache.get(t);
    if (!r) headRingCache.set(t, (r = headRingRaw(t)));
    return r;
  };
  /** Alto de la cabeza en unidades normalizadas (para convertir diferencias de `t` a metros). */
  const hhN = hh / ws;
  const eyeX = (0.0315 + 0.003 * trait('eyeSpacing')) * ws;
  /** Ángulo desde el frente de la cara (0 = frente, π = nuca). */
  const fromFront = (u: number) => {
    let d = (u - PI / 2) % TAU;
    if (d > PI) d -= TAU;
    if (d < -PI) d += TAU;
    return Math.abs(d);
  };
  // Nacimiento del pelo: arco bajo en la frente, baja por la sien a una patilla corta y recta que
  // termina a media oreja, rodea la oreja y cae a la nuca.
  const hairline = pchip(
    [0, 0.15, 0.25, 0.31, 0.36, 0.395, 0.405, 0.44, 0.455, 0.49, 0.6, 0.68, 0.82, 1].map((x) => x * PI),
    [tHairline, tHairline, tHairline - 0.04, tEye + 0.19, tEye + 0.14, tEye + 0.05, tEar + 0.02, tEar + 0.015, tEar + 0.05, tEar + 0.16, tEar + 0.155, tEar - 0.02, 0.27, 0.25],
  );
  /** Ruido determinista 0–1 (grano de barba, borde irregular del pelo). */
  const noise = (a: number, b: number) => Math.abs((Math.sin(a * 127.1 + b * 311.7) * 43758.5453) % 1);

  // --- Nariz: dorso, punta redonda y aletas como volúmenes propios (no un bulto difuso) ---
  const noseS = 1 + 0.3 * trait('nose');
  const noseW = 1 + 0.4 * trait('noseWidth');
  const ridgeH = pchip([tNose + 0.02, tNose + 0.07, tNose + 0.14, tBrow - 0.02, tBrow + 0.02, tBrow + 0.06], [0.0115, 0.0088, 0.0055, 0.003, 0.0016, 0]);
  const ridgeS = pchip([tNose + 0.02, tNose + 0.1, tBrow - 0.02, tBrow + 0.05], [0.0098 * noseW, 0.0088 * (0.6 + 0.4 * noseW), 0.0082, 0.0105]);
  const pos = (v: number) => (v > 0 ? v : 0);
  const noseAt = (xs: number, ax: number, t: number): number => {
    if (t < tNose - 0.006 || t > tBrow + 0.06) return 0;
    // Dorso: lomo suave que se abre hacia la base (sin aristas a los lados).
    const ridge = noseS * ridgeH(Math.max(t, tNose + 0.02)) * gauss(xs, ridgeS(t)) * smoothstep(tNose - 0.004, tNose + 0.03, t);
    // Punta: redonda hacia arriba y a los lados, con caída corta hacia abajo (la base de la nariz).
    const ty = (t - (tNose + 0.031)) * hhN;
    const tip = 0.0172 * noseS * gauss(xs, 0.0092 * noseW) * (ty > 0 ? gauss(ty, 0.0105) : pos(1 - (ty / 0.0078) ** 2) ** 0.5);
    // Aletas: dos lóbulos bajos que bordean la punta y marcan el ancho de la nariz.
    const ay = (t - (tNose + 0.017)) * hhN;
    const ala = 0.0078 * noseS * gauss(ax - 0.0128 * noseW, 0.0052 * noseW) * (ay > 0 ? gauss(ay, 0.0068) : pos(1 - (ay / 0.004) ** 2) ** 0.5);
    // Unión suave de los tres volúmenes (sin pliegues duros entre ellos).
    return (ridge ** 3 + tip ** 3 + ala ** 3) ** (1 / 3);
  };

  // --- Labios: dos volúmenes con la comisura apenas levantada; el mismo trazo da relieve y color ---
  const lipHWn = 0.025 * (1 + 0.12 * trait('mouthWidth'));
  const lipHW = lipHWn * ws;
  const lipUp = 0.0052 * (1 + 0.4 * trait('lips'));
  const lipLo = 0.0074 * (1 + 0.4 * trait('lips'));
  const lipAt = (xs: number, t: number) => {
    const s = xs / lipHWn;
    if (Math.abs(s) >= 1.1 || Math.abs(t - tMouth) > 0.06) return null;
    const s2 = Math.min(1, s * s);
    const dy = (t - (tMouth + (0.0006 * s2) / hhN)) * hhN;
    const ub = lipUp * (1 - s2) ** 0.5 * (1 - 0.2 * gauss(s, 0.13)) * (1 + 0.12 * gauss(Math.abs(s) - 0.3, 0.2));
    const lb = lipLo * (1 - s2) ** 0.6;
    let bulge = 0;
    let mask = 0;
    if (dy >= 0 && dy < ub) {
      const q = dy / ub;
      bulge = 0.0021 * Math.sin(PI * q) ** 0.8;
      mask = smoothstep(1, 0.7, q);
    } else if (dy < 0 && -dy < lb) {
      const q = -dy / lb;
      bulge = 0.0034 * Math.sin(PI * q) ** 0.7;
      mask = smoothstep(1, 0.72, q);
    }
    const inside = 1 - s2 * s2;
    return { bulge: bulge * inside, mask, seam: gauss(dy, 0.0008) * (Math.abs(s) < 1 ? inside : 0), upper: dy >= 0 };
  };

  /** Relieve de la cara (nariz, arco de las cejas, cuencas, pómulos, boca, mentón): desplazamiento en Z. */
  const faceRelief = (x: number, t: number): number => {
    if (t < -0.02 || t > 0.8) return 0;
    const xs = x / ws;
    const ax2 = Math.abs(xs);
    let d = noseAt(xs, ax2, t);
    d += 0.0045 * gauss(t - tBrow, 0.028) * (1 - smoothstep(0.045, 0.068, ax2));
    d -= 0.0095 * gauss(ax2 - eyeX / ws, 0.017) * gauss(t - tEye, 0.03);
    d += 0.003 * (1 + CK) * gauss(ax2 - 0.046, 0.022) * gauss(t - (tNose + 0.085), 0.06);
    d += 0.0045 * gauss(xs, 0.028) * gauss(t - tMouth, 0.04);
    d -= 0.0012 * gauss(xs, 0.0042) * smoothstep(tMouth + 0.025, tMouth + 0.04, t) * (1 - smoothstep(tNose - 0.02, tNose - 0.006, t));
    d -= 0.002 * gauss(xs, 0.02) * gauss(t - tMouth * 0.62, 0.025);
    d += 0.0045 * gauss(xs, 0.02) * gauss(t - tChin, 0.04);
    const lip = lipAt(xs, t);
    if (lip) d += lip.bulge - 0.001 * lip.seam;
    d -= 0.0014 * gauss(ax2 - lipHWn * 1.06, 0.004) * gauss((t - tMouth) * hhN, 0.004);
    return d * ws;
  };
  const headY = (t: number) => chinY + t * hh;
  /** Punto de la superficie de la cabeza en (ángulo u, altura t de 0 = mentón a `tTop` = coronilla). */
  const headRaw = (u: number, t: number): Vector3 => {
    const ring = headT.ringAt(t);
    const [x, z] = ringXZ(ring, u);
    const s = Math.sin(u);
    return new Vector3(x, headY(t), z + (s > 0 ? faceRelief(x, t) * Math.min(1, s * 3) : 0));
  };
  const headPoint = (u: number, t: number, off = 0): Vector3 => {
    const tt = clamp(t, -0.016, tTop - 0.008);
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

  /** Igual que `facePoint`, pero levantado derecho hacia el frente (una sola evaluación: para parches densos). */
  const faceFront = (x: number, t: number, dz: number): P3 => ({ x, y: headY(t), z: frontZ(headT.ringAt(t), x) + faceRelief(x, t) + dz });

  // --- Sombra de barba (uno o dos días): se pinta sobre la piel, con grano fino ---
  const sombra = look.beard === 'sombra';
  /** Qué tan cerrada se ve la sombra de barba (0.4 a 1.6). */
  const beardK = 1 + 0.6 * clamp(look.beardTone ?? 0, -1, 1);
  const beardTop = pchip([0, 0.12, 0.2, 0.3, 0.38, 0.43].map((x) => x * PI), [tNose - 0.04, tNose - 0.04, tNose - 0.045, tNose + 0.005, tNose + 0.07, tEar]);
  const stubbleAt = (u: number, t: number, xs: number): number => {
    const phi = fromFront(u);
    if (phi > 0.47 * PI || t > tNose + 0.08) return 0;
    const base = smoothstep(0, 0.03, beardTop(Math.min(phi, 0.43 * PI)) - t) * (1 - smoothstep(0.43 * PI, 0.47 * PI, phi));
    if (base <= 0) return 0;
    // Bigote (más a los lados que al centro), mentón, mosca y un rastro por el borde de la mandíbula.
    const moustache = smoothstep(tMouth + 0.014, tMouth + 0.03, t) * (1 - smoothstep(tNose - 0.05, tNose - 0.03, t)) * (1 - smoothstep(0.03, 0.04, xs)) * (0.25 + 0.6 * smoothstep(0.005, 0.016, xs));
    const chin = (1 - smoothstep(0.08 * lowerF, 0.12 * lowerF, t)) * (1 - smoothstep(0.26 * PI, 0.36 * PI, phi));
    const soul = 0.5 * gauss(xs, 0.006) * gauss(t - (tMouth - 0.04), 0.012);
    const jawEdge = lerp(0.1 * lowerF, tNose, clamp(phi / (0.42 * PI)) ** 1.6);
    const jaw = 0.22 * (1 - smoothstep(jawEdge - 0.02, jawEdge + 0.05, t)) * (1 - smoothstep(0.3 * PI, 0.42 * PI, phi));
    return clamp(base * Math.max(moustache, chin * 0.55, soul, jaw, 0.05) * (0.55 + 0.9 * noise(u * 3.1, t * 5.3)) * beardK);
  };

  // --- Piel pintada por vértice: rubor, luz, sombras suaves, labios, fosas, barba y nacimiento del pelo ---
  const skinC = new Color(look.skin);
  const blushC = new Color(mix(look.skin, '#c05a52', 0.55));
  const lightC = new Color(mix(look.skin, '#fff1e6', 0.5));
  const lipC = new Color(mix(look.skin, '#b3506a', 0.44));
  const lipUpC = lipC.clone().multiplyScalar(0.9);
  const mouthC = new Color(mix(look.skin, '#3a1c1a', 0.82));
  const nostrilC = new Color(mix(look.skin, '#2e1513', 0.8));
  const stubbleC = new Color(mix(look.skin, look.hairColor, 0.62));
  const hairC = new Color(look.hairColor);
  const tmpC = new Color();
  const paintSkin = (x: number, t: number, u: number): Color => {
    const c = tmpC.copy(skinC);
    const phi = fromFront(u);
    if (Math.sin(u) > 0 && t > -0.02 && t < 0.8) {
      const xs = x / ws;
      const ax = Math.abs(xs);
      c.lerp(blushC, 0.3 * gauss(ax - 0.04, 0.026) * gauss(t - (tNose + 0.055), 0.07) + 0.2 * gauss(xs, 0.016) * gauss(t - (tNose + 0.03), 0.035) + 0.08 * gauss(xs, 0.03) * gauss(t - tChin, 0.05));
      c.lerp(lightC, 0.3 * gauss(xs, 0.04) * gauss(t - (tBrow + 0.12), 0.08));
      c.multiplyScalar(1 - 0.14 * gauss(ax - (eyeX / ws - 0.014), 0.009) * gauss(t - (tEye + 0.004), 0.026) - 0.1 * gauss(xs, 0.02) * gauss(t - (tNose - 0.014), 0.012) - 0.08 * gauss(xs, 0.022) * gauss(t - tMouth * 0.6, 0.02) - 0.07 * gauss(ax - 0.0195 * noseW, 0.003) * gauss(t - (tNose + 0.022), 0.022));
      c.lerp(nostrilC, 0.95 * gauss(ax - 0.0078 * noseW, 0.0038) * gauss((t - (tNose + 0.001)) * hhN, 0.002));
      const lip = lipAt(xs, t);
      if (lip) {
        c.lerp(lip.upper ? lipUpC : lipC, lip.mask * 0.92);
        c.lerp(mouthC, lip.seam * 0.85);
      }
      if (sombra) c.lerp(stubbleC, 0.9 * stubbleAt(u, t, ax));
    }
    // El pelo no termina en un corte seco: se desvanece unos milímetros sobre la piel.
    if (look.hair !== 'calvo') {
      const h = hairline(phi) - t;
      if (h > 0 && h < 0.045) c.lerp(hairC, (1 - h / 0.045) ** 1.5 * 0.75);
    }
    return c;
  };

  // Malla de la cabeza: más fina al frente y en la zona de los rasgos (≈1 mm) que en la nuca.
  const HEAD_SEG = 176;
  const HEAD_WARP = 0.6;
  const SHELL_WARP = 0.45;
  const headRows: number[] = headT.ys.filter((y) => y < 0);
  const rowsBetween = (a: number, b: number, step: number) => {
    const n = Math.max(1, Math.round((b - a) / step));
    for (let i = 0; i < n; i++) headRows.push(a + ((b - a) * i) / n);
  };
  rowsBetween(0, 0.12, 0.008);
  rowsBetween(0.12, 0.64, 0.0045);
  // Fino también hasta el nacimiento del pelo, para que su desvanecido no se vea escalonado.
  const fineTop = Math.min(tTop - 0.02, tHairline + 0.012);
  rowsBetween(0.64, Math.max(0.8, fineTop), 0.0048);
  rowsBetween(Math.max(0.8, fineTop), tTop - 0.006, 0.008);
  headRows.push(tTop - 0.006);
  add(
    root,
    loft({ ringAt: headT.ringAt, ys: headRows, top: tTop, bottom: headT.bottom }, HEAD_SEG, {
      warp: HEAD_WARP,
      paint: (pt, u, out, at) => {
        const c = paintSkin(pt.x, pt.y, u);
        out[at] = c.r;
        out[at + 1] = c.g;
        out[at + 2] = c.b;
      },
      displace: (pt, u) => {
        const s = Math.sin(u);
        if (s > 0) pt.z += faceRelief(pt.x, pt.y) * Math.min(1, s * 3);
        pt.y = headY(pt.y);
      },
    }),
    mat('#ffffff', 0.58, { vertex: true }),
  );

  // Orejas: pabellón delgado, un poco abierto y echado hacia atrás, con la concha más oscura.
  const earRing = headT.ringAt(tEar);
  const earGeo = new SphereGeometry(1, 18, 14);
  const earMat = mat(mix(look.skin, '#c05a52', 0.12), 0.58);
  const conchaMat = mat(mix(look.skin, '#5a2f27', 0.38), 0.7);
  for (const side of [1, -1]) {
    const ear = new Group();
    ear.position.set(side * (earRing.w + (0.0028 + 0.003 * trait('ears')) * ws), headY(tEar), earRing.cz - 0.012 * ws);
    ear.rotation.set(-0.16, -side * (0.42 + 0.3 * trait('ears')), -side * 0.07);
    const shellMesh = add(ear, earGeo, earMat);
    shellMesh.scale.set(0.0058 * ws, 0.034 * ws, 0.016 * ws);
    const concha = add(ear, earGeo, conchaMat, false);
    concha.scale.set(0.003 * ws, 0.0165 * ws, 0.0072 * ws);
    concha.position.set(side * 0.0036 * ws, -0.002 * ws, 0.002 * ws);
    root.add(ear);
  }

  // Parches pegados a la cara, pintados por vértice (color + transparencia): párpados y cejas.
  const paint = mat('#ffffff', 0.55, { double: true, decal: true, vertex: true, alpha: true });
  const patchGeo = (cols: number, rows: number, fn: (i: number, j: number) => { p: P3; c: Color; a?: number }): BufferGeometry => {
    const colors = new Float32Array(cols * rows * 4);
    let n = 0;
    const geo = gridGeometry(cols, rows, (i, j) => {
      const r = fn(i, j);
      colors[n++] = r.c.r;
      colors[n++] = r.c.g;
      colors[n++] = r.c.b;
      colors[n++] = r.a ?? 1;
      return r.p;
    });
    geo.setAttribute('color', new BufferAttribute(colors, 4));
    return geo;
  };
  const patch = (cols: number, rows: number, fn: (i: number, j: number) => { p: P3; c: Color; a?: number }, order = 2): Mesh => {
    const mesh = add(root, patchGeo(cols, rows, fn), paint, false);
    mesh.renderOrder = order;
    return mesh;
  };

  // --- Ojos: globo brillante con córnea abombada (ahí cae el brillo), y párpados con grosor ---
  const eyeHW = 0.0162 * ws * (1 + 0.15 * trait('eyes'));
  const eyeHH = 0.0066 * ws * (1 + 0.1 * trait('eyes') + 0.25 * trait('eyeOpen'));
  const irisR = 0.0064 * ws;
  const pupilR = 0.0023 * ws;
  const scleraC = new Color('#cbc2ba');
  const irisC = new Color(look.eyeColor);
  const irisRimC = irisC.clone().multiplyScalar(0.35);
  const irisInC = irisC.clone().lerp(new Color('#8a5a3a'), 0.25);
  const pupilC = new Color('#070605');
  const glintC = new Color('#fffaf2');
  const lashC = new Color(mix(look.skin, '#140c09', 0.9));
  const lidC = new Color(mix(look.skin, '#7a4a3c', 0.22));
  const creaseC = new Color(mix(look.skin, '#5a352b', 0.5));
  const browColor = look.hair === 'calvo' ? mix(look.hairColor, '#2a1e17', 0.5) : look.hairColor;
  const browC = new Color(browColor);
  const eyeMat = mat('#ffffff', 0.34, { double: true, decal: true, vertex: true });
  const almond = (s: number) => pos(1 - s * s) ** 0.7;
  const UP = 1.25;
  const DOWN = 0.75;
  for (const side of [1, -1]) {
    const cx = side * eyeX;
    const tilt = (s: number) => s * side * 0.0008 * ws;
    const upper = (s: number) => eyeHH * UP * almond(s) + tilt(s);
    const lower = (s: number) => -eyeHH * DOWN * almond(s) + tilt(s);
    // Globo: esclerótica sombreada hacia el párpado, iris con borde oscuro, pupila; la córnea sobresale.
    const ball = add(
      root,
      patchGeo(65, 27, (i, j) => {
        const s = (i / 64) * 2 - 1;
        const v = (j / 26) * 2 - 1;
        const dx = s * eyeHW;
        const dy = lerp(lower(s), upper(s), (v + 1) / 2);
        // El iris va un poco hacia la nariz (así se ve más blanco del lado de la sien, como en un ojo real).
        const ix = dx + side * 0.0009 * ws;
        const r = Math.hypot(ix, dy - 0.0003 * ws);
        const c = scleraC.clone().multiplyScalar((1 - 0.34 * smoothstep(0.1, 1, v)) * (1 - 0.3 * Math.abs(s) ** 2.5));
        c.lerp(irisRimC, 1 - smoothstep(irisR * 0.9, irisR * 1.05, r));
        c.lerp(irisC, 1 - smoothstep(irisR * 0.74, irisR * 0.93, r));
        c.lerp(irisInC, (1 - smoothstep(irisR * 0.3, irisR * 0.62, r)) * 0.7);
        c.lerp(pupilC, 1 - smoothstep(pupilR * 0.85, pupilR * 1.2, r));
        c.multiplyScalar(1 - 0.28 * smoothstep(0.35, 1, v));
        // Brillo del ojo: un punto pequeño arriba, del lado de la luz (da vida a la mirada).
        c.lerp(glintC, 0.9 * (1 - smoothstep(0.0005 * ws, 0.0011 * ws, Math.hypot(ix - 0.0022 * ws, dy - 0.0003 * ws - 0.002 * ws))));
        const bulge = 0.0003 * ws + 0.0013 * ws * pos(1 - (dx / (eyeHW * 1.05)) ** 2) + 0.0024 * ws * pos(1 - (r / (irisR * 1.18)) ** 2) ** 2;
        return { p: faceFront(cx + dx, tEye + dy / hh, bulge), c };
      }),
      eyeMat,
      false,
    );
    ball.renderOrder = 1;
    // Párpado superior: con grosor, cubre la parte alta del iris y lleva la línea de pestañas en el borde.
    patch(
      45,
      9,
      (i, j) => {
        const s = ((i / 44) * 2 - 1) * 1.07;
        const sc = clamp(s, -1, 1);
        const margin = lerp(lower(sc), upper(sc), 0.93);
        const crease = upper(sc) + (0.003 * almond(sc * 0.85) + 0.0009) * ws;
        const end = pos(1 - Math.abs(s) ** 6);
        if (j === 0) return { p: faceFront(cx + s * eyeHW, tEye + (margin - 0.0005 * ws) / hh, 0.0005 * ws), c: lashC, a: end };
        const w = (j - 1) / 7;
        const y = lerp(margin, crease, w);
        const off = (0.0003 + 0.0019 * (1 - w) ** 0.75 * end) * ws;
        const c = lidC.clone().lerp(lashC, (1 - smoothstep(0, 0.14, w)) * 0.9).lerp(creaseC, gauss(w - 1, 0.18) * 0.6);
        return { p: faceFront(cx + s * eyeHW, tEye + y / hh, off), c, a: end * (1 - smoothstep(0.86, 1, w) * 0.35) * (w > 0.99 ? 0 : 1) };
      },
      3,
    );
    // Párpado inferior: un borde delgado.
    patch(
      41,
      5,
      (i, j) => {
        const s = ((i / 40) * 2 - 1) * 1.03;
        const sc = clamp(s, -1, 1);
        const w = j / 4;
        const margin = lerp(lower(sc), upper(sc), 0.03);
        const y = lerp(margin, lower(sc) - 0.0022 * ws, w);
        const end = pos(1 - Math.abs(s) ** 6);
        return { p: faceFront(cx + s * eyeHW, tEye + y / hh, (0.0003 + 0.0012 * (1 - w) * end) * ws), c: lidC.clone().lerp(creaseC, (1 - w) * 0.35), a: end * (1 - w) ** 0.8 };
      },
      3,
    );
    // Ceja: llena en los dos tercios internos y afinada hacia la sien, con trazo de vello.
    const browHalf = (0.0033 + 0.0013 * trait('brows')) * ws;
    const browLen = 0.0255 * ws;
    patch(97, 11, (i, j) => {
      const so = (i / 96) * 2 - 1; // −1 = entrecejo, +1 = cola (hacia la sien)
      const v = (j - 5) / 5;
      const arch = (0.0022 * (1 - (so - 0.2) ** 2) - 0.002 * Math.max(0, so) ** 2) * ws;
      const th = browHalf * (so < 0.33 ? 1 - 0.15 * Math.max(0, -so) ** 3 : 1 - 0.8 * ((so - 0.33) / 0.67) ** 1.3);
      const edge = Math.max(Math.abs(v) ** 1.6, so < 0 ? (-so) ** 4 : so ** 8);
      const strokes = 0.84 + 0.16 * Math.sin(so * 70 + v * 2.2 + 6 * noise(i * 0.37, 1.7));
      const body = 1 - smoothstep(0.3 + 0.25 * noise(i * 0.91, j * 0.53), 1, edge);
      return { p: faceFront(side * (eyeX + 0.0012 * ws + so * browLen), tBrow + (arch + v * th * 1.3) / hh, 0.0009), c: browC, a: 0.95 * body * strokes };
    });
  }

  // ---------- Cabello y barba ----------
  /** Cáscara sobre la cabeza: `fn` da el punto y qué tanto existe ahí (0 = nada). Con `fade`, el color se funde con la piel. */
  const shell = (
    ts: number[],
    fn: (u: number, t: number) => { p: Vector3; m: number },
    apex?: Vector3,
    fade?: { color: string; linear?: boolean },
  ): BufferGeometry => {
    const rows = ts.length;
    const pos: number[] = [];
    const mask: number[] = [];
    const col: number[] = [];
    const tint = new Color(fade?.color ?? '#ffffff');
    const SEG = 96;
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < SEG; j++) {
        const v = (j / SEG) * TAU;
        const r = fn(v + SHELL_WARP * Math.cos(v), ts[i]!);
        pos.push(r.p.x, r.p.y, r.p.z);
        mask.push(r.m);
        if (fade) col.push(tint.r, tint.g, tint.b, fade.linear ? clamp(r.m) : smoothstep(0.08, 0.6, r.m));
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
    if (fade) geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 4));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  };
  const steps = (a: number, b: number, n: number) => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));
  const crown = headT.ringAt(0.8);

  /** Borde de la gorra: sobre la frente al frente, más abajo en la nuca. */
  const capLine = (phi: number) => tBrow + 0.105 - 0.17 * (1 - Math.cos(phi)) * 0.5;
  const hairMat = mat(look.hairColor, 0.9);
  if (look.hair !== 'calvo') {
    const shape = look.hairShape ?? {};
    const kTop = 1 + 0.5 * clamp(shape.top ?? 0, -1, 1);
    const kFront = 1 + 0.6 * clamp(shape.front ?? 0, -1, 1);
    const kSide = 1 + 0.8 * clamp(shape.sides ?? 0, -1, 1);
    /** Grosor del pelo (metros, a lo largo de la normal) en cada punto de la cabeza. */
    const volume = (u: number, phi: number, t: number, pt: Vector3): number => {
      const top = smoothstep(0.62, 0.88, t);
      const fw = Math.cos(phi / 2) ** 2;
      switch (look.hair) {
        case 'rapado':
          return 0.0022;
        case 'corto':
          return 0.0045 * kSide + 0.007 * kTop * top + 0.003 * kFront * top * fw * fw;
        case 'volumen':
          return 0.006 * kSide + 0.013 * kTop * top + 0.014 * kFront * top * fw * fw;
        case 'lado':
          return 0.006 * kSide + 0.009 * kTop * top + 0.008 * kFront * top * Math.max(0, Math.cos(u - 0.5)) - 0.005 * top * gauss(u - (PI - 0.95), 0.1);
        case 'chino':
          return 0.011 * kSide + 0.012 * kTop * top + 0.005 * Math.sin(u * 11 + t * 27) * Math.sin(t * 37 + u * 5);
        case 'copete': {
          // Lados cortos, más llenos a la altura de la sien; arriba bajo y redondeado, peinado hacia atrás y
          // hacia su izquierda (+X); al frente se levanta desde el nacimiento, más del lado derecho (−X),
          // con surcos suaves de peinado.
          const side = kSide * (0.0062 + 0.0042 * gauss(t - (tEye + 0.13), 0.16)) * (1 - 0.75 * smoothstep(0.84, tTop, t) * (1 - fw));
          const crownTop = 0.0055 * kTop * smoothstep(0.8, tTop, t) * (0.6 + 0.4 * fw) * (1 + 0.12 * Math.cos(u));
          const front = (1 - smoothstep(0.2 * PI, 0.46 * PI, phi)) * (1 - smoothstep(Math.min(tHairline + 0.07, tTop - 0.03), tTop, t));
          const lift = 0.0072 * kFront * front * (1 - 0.4 * Math.cos(u));
          const comb = 0.0014 * Math.sin((0.83 * pt.x + 0.55 * pt.z) * (TAU / (0.017 * ws))) * smoothstep(tHairline - 0.02, tHairline + 0.06, t);
          return side + crownTop + lift + comb;
        }
        default:
          return 0.006;
      }
    };
    const hairAt = (u: number, t: number) => {
      const phi = fromFront(u);
      const hl = hairline(phi);
      if (t <= hl) return { p: headPoint(u, hl, 0.001), m: 1 };
      // El volumen crece desde el nacimiento del pelo; a los lados y en la nuca más gradual (degradado).
      const frontRamp = look.hair === 'copete' ? 0.045 : 0.06;
      const ramp = lerp(frontRamp, 0.11, smoothstep(0.28 * PI, 0.42 * PI, phi));
      let off = Math.max(0.001, volume(u, phi, t, headPoint(u, t)) * ws * smoothstep(0, ramp, t - hl));
      if (outfit.cap && t > capLine(phi) - 0.03) off = Math.min(off, 0.0035);
      return { p: headPoint(u, t, off), m: 1 };
    };
    const apexOff = outfit.cap ? 0.0035 : volume(0, PI / 2, tTop, new Vector3(crown.cx, 0, crown.cz)) * ws;
    add(root, shell(steps(0.24, tTop - 0.008, 56), hairAt, new Vector3(crown.cx, headY(tTop) + apexOff, crown.cz)), hairMat);
  }

  if (look.beard !== 'ninguna' && !sombra) {
    const thick = { corta: 0.0035, completa: 0.0095, candado: 0.006, bigote: 0.004 }[look.beard as 'corta' | 'completa' | 'candado' | 'bigote'] * ws;
    const beardAt = (u: number, t: number) => {
      const phi = fromFront(u);
      const pt0 = headPoint(u, t);
      let m = smoothstep(0, 0.045, beardTop(Math.min(phi, 0.43 * PI)) - t) * (1 - smoothstep(0.43 * PI, 0.47 * PI, phi));
      if (look.beard === 'candado') m *= 1 - smoothstep(0.15 * PI, 0.19 * PI, phi);
      else if (look.beard === 'bigote') m *= (1 - smoothstep(0.13 * PI, 0.17 * PI, phi)) * smoothstep(tMouth + 0.012, tMouth + 0.028, t);
      m *= smoothstep(1.0, 1.7, Math.hypot(pt0.x / (lipHW * 1.12), (t - tMouth) / 0.035));
      const chinBulk = look.beard === 'completa' ? 1 + 0.5 * gauss(t - 0.04, 0.1) * gauss(phi, 0.5) : 1;
      return { p: headPoint(u, t, Math.max(0.0003, thick * chinBulk * smoothstep(0.05, 0.75, m))), m };
    };
    const beardColor = look.beard === 'corta' ? mix(look.skin, look.hairColor, 0.85) : look.hairColor;
    const beard = add(root, shell(steps(0.004, tEar + 0.03, 52), beardAt, undefined, { color: beardColor }), mat('#ffffff', 0.75, { decal: true, vertex: true, alpha: true, depthWrite: true }), false);
    beard.renderOrder = 1;
  }

  // ---------- Lentes y gorra ----------
  if (look.glasses) {
    const frame = mat('#15171b', 0.35, { metalness: 0.3 });
    const zg = facePoint(eyeX, tEye).z + 0.014 * ws;
    const gy = headY(tEye) - 0.001;
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
      add(root, tubeOf([hinge, new Vector3(side * (earRing.w + 0.004 * ws), gy + ry * 0.3, zg - 0.05 * ws), new Vector3(side * (earRing.w + 0.004 * ws), headY(tEar + 0.11), earRing.cz - 0.004)], false), frame);
    }
    add(root, tubeOf([new Vector3(-(eyeX - rx), gy + ry * 0.3, zg - 0.004 * ws), new Vector3(0, gy + ry * 0.45, zg + 0.001), new Vector3(eyeX - rx, gy + ry * 0.3, zg - 0.004 * ws)], false), frame);
  }
  if (outfit.cap) {
    const capMat = mat(outfit.capColor, 0.85, { double: true });
    const capOff = 0.0065 * ws;
    const capAt = (u: number, t: number) => ({ p: headPoint(u, Math.max(t, capLine(fromFront(u))), capOff), m: 1 });
    add(root, shell(steps(0.45, tTop - 0.008, 36), capAt, new Vector3(crown.cx, headY(tTop) + capOff, crown.cz)), capMat);
    const button = add(root, new SphereGeometry(0.008 * ws, 12, 8), capMat);
    button.position.set(crown.cx, headY(tTop) + capOff + 0.001, crown.cz);
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
