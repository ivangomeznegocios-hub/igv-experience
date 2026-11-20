import {
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Raycaster,
  RingGeometry,
  Vector2,
  Scene,
  WebGLRenderer,
} from 'three';
import type { MuscleId } from '@igv/core';
import { buildFigure, type Figure, type FigureSpec, type MusclePaintSpec } from './figure';

export type StageView = 'body' | 'face';

/** Radios del anillo de nivel en el piso (metros). */
const INTRO_FROM = -0.75;
const INTRO_TO = 0.4;
const INTRO_SECONDS = 2.4;
const R0 = 0.46;
const R1 = 0.475;

/** Sombra de contacto: degradado radial pintado en un lienzo (sin costo por cuadro). */
function blobTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.5)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.2)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

/**
 * Escenario del personaje: cámara, luces, piso y giro con el dedo.
 * Solo dibuja cuando algo cambia (giro, inercia, transición), para no gastar batería.
 */
export class Stage {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(26, 1, 0.1, 30);
  private pivot = new Group();
  private figure: Figure | null = null;
  /** Silueta "antes" (comparar). */
  private ghost: Figure | null = null;
  private ghostKey = '';
  private pendingGhost: FigureSpec | null | undefined;
  private musclePaint: MusclePaintSpec | null = null;
  /** Al tocar (sin arrastrar) un músculo del modo músculos. */
  onPick: ((m: MuscleId | null) => void) | null = null;
  private downAt = { x: 0, y: 0, t: 0, moved: false };
  private raycaster = new Raycaster();
  /** Giro animado hacia un ángulo (Frente / Espalda). */
  private turnTarget: number | null = null;
  private ring: Mesh;
  private ringTrack: Mesh;
  private ringProgress = -1;
  private specKey = '';
  private pendingSpec: FigureSpec | null = null;
  private key: DirectionalLight;
  private lastMove = 0;
  /** Mallas propias del escenario (piso y anillos), para liberarlas al cerrar. */
  private props: Mesh[] = [];
  private raf = 0;
  private disposed = false;
  private lastT = 0;

  private yaw = INTRO_FROM;
  /** Presentación al abrir: un giro corto de tres cuartos y se queda quieto. */
  private intro = 0;
  private yawVel = 0;
  private pitch = 0.06;
  private zoom = 1;
  private view: StageView = 'body';
  /** Encuadre actual (se acerca suavemente al deseado). */
  private frame = { y: 0.9, dist: 5, init: false };
  private autoRotate = true;
  private dragging = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchStart = 0;
  private zoomStart = 1;
  private observer: ResizeObserver;
  private visible = true;
  private io: IntersectionObserver | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private host: HTMLElement,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    // Mapeo de tonos neutro: los colores elegidos (piel, ropa) se ven como se eligieron.
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;

    this.scene.add(new HemisphereLight('#f4f4f2', '#8f8b86', 1.35));
    const key = (this.key = new DirectionalLight('#fffaf3', 2.5));
    key.position.set(2.2, 3.6, 3.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -1.3;
    key.shadow.camera.right = 1.3;
    key.shadow.camera.top = 2.3;
    key.shadow.camera.bottom = -0.3;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 9;
    key.shadow.bias = -0.001;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 5;
    this.scene.add(key);
    const rim = new DirectionalLight('#dde4f0', 1.3);
    rim.position.set(-2.6, 2.4, -2.8);
    this.scene.add(rim);
    const fill = new DirectionalLight('#fff4ec', 0.7);
    fill.position.set(-2.2, 0.4, 3);
    this.scene.add(fill);
    // Un poco de luz desde abajo para que mentón y cuello no se pierdan en sombra.
    const under = new DirectionalLight('#fff4ec', 0.75);
    under.position.set(0.4, -1.4, 2.6);
    this.scene.add(under);

    // Piso: sombra de contacto suave y anillo de avance de nivel.
    const shadow = new Mesh(new CircleGeometry(0.5, 48), new MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.001;
    this.scene.add(shadow);
    this.ringTrack = new Mesh(new RingGeometry(R0, R1, 96), new MeshBasicMaterial({ color: '#808080', transparent: true, opacity: 0.3 }));
    this.ringTrack.rotation.x = -Math.PI / 2;
    this.ringTrack.position.y = 0.002;
    this.scene.add(this.ringTrack);
    this.ring = new Mesh(new RingGeometry(R0, R1, 96), new MeshBasicMaterial({ color: '#e6a938' }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.003;
    this.scene.add(this.ring);
    this.props.push(shadow, this.ringTrack, this.ring);

    this.scene.add(this.pivot);

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    if ('IntersectionObserver' in window) {
      this.io = new IntersectionObserver((entries) => {
        this.visible = entries.some((e) => e.isIntersecting);
        if (this.visible) this.invalidate();
      });
      this.io.observe(host);
    }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.autoRotate = false;
      this.yaw = INTRO_TO;
    }
    this.resize();
  }

  /** Reconstruye la figura (cambió la complexión, la apariencia o la ropa). */
  setSpec(spec: FigureSpec) {
    // Reconstruir cuesta decenas de milisegundos: solo si de verdad cambió algo, y una vez por cuadro.
    const key = JSON.stringify([spec.physique.heightCm, spec.physique.fat, spec.physique.muscle, spec.physique.girths, spec.character, !!spec.muscles]);
    if (key === this.specKey) return;
    this.specKey = key;
    this.pendingSpec = spec;
    this.invalidate();
  }

  /** Silueta del cuerpo de otra fecha, como contorno encima de la figura (null = quitarla). */
  setGhost(spec: FigureSpec | null) {
    const key = spec ? JSON.stringify([spec.physique.heightCm, spec.physique.fat, spec.physique.muscle, spec.physique.girths, spec.character.look.build, spec.ghost]) : '';
    if (key === this.ghostKey) return;
    this.ghostKey = key;
    this.pendingGhost = spec;
    this.invalidate();
  }

  /** Colores de los músculos (modo músculos). Solo vuelve a pintar; no reconstruye. */
  setMusclePaint(paint: MusclePaintSpec | null) {
    this.musclePaint = paint;
    if (paint && this.figure?.muscleMeshes.length) this.figure.paintMuscles(paint);
    this.invalidate();
  }

  private build() {
    const spec = this.pendingSpec;
    if (spec) {
      this.pendingSpec = null;
      const next = buildFigure(spec);
      if (this.figure) {
        this.pivot.remove(this.figure.group);
        this.figure.dispose();
      }
      this.figure = next;
      this.pivot.add(next.group);
      if (this.musclePaint && next.muscleMeshes.length) next.paintMuscles(this.musclePaint);
    }
    if (this.pendingGhost !== undefined) {
      const g = this.pendingGhost;
      this.pendingGhost = undefined;
      if (this.ghost) {
        this.pivot.remove(this.ghost.group);
        this.ghost.dispose();
        this.ghost = null;
      }
      if (g) {
        this.ghost = buildFigure(g);
        this.ghost.group.renderOrder = 10;
        this.ghost.group.traverse((o) => (o.renderOrder = 10));
        this.pivot.add(this.ghost.group);
      }
    }
  }

  /** Avance al siguiente nivel (0–1) y color del anillo del piso. */
  setRing(progress: number, color: string) {
    const p = Math.max(0, Math.min(1, progress));
    (this.ring.material as MeshBasicMaterial).color = new Color(color);
    if (Math.abs(p - this.ringProgress) > 0.001) {
      this.ringProgress = p;
      this.ring.geometry.dispose();
      this.ring.geometry = new RingGeometry(R0, R1, 96, 1, Math.PI / 2 - Math.PI * 2 * Math.max(p, 0.004), Math.PI * 2 * Math.max(p, 0.004));
    }
    this.invalidate();
  }

  setView(view: StageView) {
    this.view = view;
    this.zoom = 1;
    if (view === 'face') this.autoRotate = false;
    this.invalidate();
  }

  /** Gira hasta dejar al personaje de frente (yaw = 0). */
  faceFront() {
    this.autoRotate = false;
    this.yawVel = 0;
    this.yaw = 0;
    this.invalidate();
  }

  setYaw(yaw: number) {
    this.autoRotate = false;
    this.yaw = yaw;
    this.invalidate();
  }

  /** Gira (animado, por el camino corto) hasta un ángulo: 0 = de frente, π = de espalda. */
  turnTo(yaw: number) {
    this.autoRotate = false;
    this.yawVel = 0;
    const d = Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw));
    this.turnTarget = this.yaw + d;
    this.invalidate();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.io?.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.figure?.dispose();
    this.ghost?.dispose();
    for (const m of this.props) {
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).map?.dispose();
      (m.material as MeshBasicMaterial).dispose();
    }
    this.key.shadow.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private onRestored = () => this.invalidate();

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Cambiar el tamaño borra el lienzo: se redibuja en el mismo instante para que no parpadee.
    if (this.disposed) return;
    cancelAnimationFrame(this.raf);
    this.tick(performance.now());
  }

  invalidate() {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.raf = 0;
    if (this.disposed) return;
    this.build();
    const dt = Math.min(0.05, this.lastT ? (now - this.lastT) / 1000 : 0.016);
    this.lastT = now;
    let moving = false;

    if (!this.dragging) {
      if (this.autoRotate) {
        this.intro = Math.min(1, this.intro + dt / INTRO_SECONDS);
        const e = 1 - (1 - this.intro) ** 3;
        this.yaw = INTRO_FROM + (INTRO_TO - INTRO_FROM) * e;
        if (this.intro >= 1) this.autoRotate = false;
        moving = true;
      } else if (this.turnTarget !== null) {
        const d = this.turnTarget - this.yaw;
        if (Math.abs(d) < 0.002) {
          this.yaw = this.turnTarget;
          this.turnTarget = null;
        } else {
          this.yaw += d * (1 - Math.exp(-dt * 7));
          moving = true;
        }
      } else if (Math.abs(this.yawVel) > 0.02) {
        this.yaw += this.yawVel * dt;
        this.yawVel *= Math.exp(-dt * 3.2);
        moving = true;
      }
    }

    // Encuadre: cuerpo completo o rostro, ajustado al tamaño del lienzo.
    const H = this.figure?.height ?? 1.75;
    const tan = Math.tan((this.camera.fov * Math.PI) / 360);
    // Margen arriba para que los botones del encuadre no tapen la cabeza.
    const fitH = this.view === 'face' ? 0.37 : H * 1.28;
    const fitW = this.view === 'face' ? 0.3 : 0.95;
    const dist = Math.max(fitH / (2 * tan), fitW / (2 * tan * this.camera.aspect)) / this.zoom;
    const targetY = this.view === 'face' ? (this.figure?.faceY ?? H * 0.93) : H * 0.52 + (1 - 1 / this.zoom) * H * 0.3;
    if (!this.frame.init) this.frame = { y: targetY, dist, init: true };
    const ease = 1 - Math.exp(-dt * 9);
    this.frame.y += (targetY - this.frame.y) * ease;
    this.frame.dist += (dist - this.frame.dist) * ease;
    if (Math.abs(targetY - this.frame.y) > 0.001 || Math.abs(dist - this.frame.dist) > 0.002) moving = true;

    this.pivot.rotation.y = this.yaw;
    const d = this.frame.dist;
    // Planos de recorte pegados a la figura: así la ropa no "parpadea" sobre la piel aunque el
    // dispositivo tenga poca precisión de profundidad.
    this.camera.near = Math.max(0.1, d - 1.3);
    this.camera.far = d + 1.6;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(0, this.frame.y + Math.sin(this.pitch) * d, Math.cos(this.pitch) * d);
    this.camera.lookAt(0, this.frame.y, 0);
    this.renderer.render(this.scene, this.camera);

    if (moving && this.visible && !document.hidden) this.invalidate();
    else this.lastT = 0;
  };

  private onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.canvas.setPointerCapture(e.pointerId);
    this.autoRotate = false;
    this.turnTarget = null;
    this.dragging = true;
    this.yawVel = 0;
    if (this.pointers.size === 1) this.downAt = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    else this.downAt.moved = true;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchStart = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      this.zoomStart = this.zoom;
    }
  };

  private onMove = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 8) this.downAt.moved = true;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (this.pinchStart > 0) this.zoom = Math.max(1, Math.min(3, this.zoomStart * (dist / this.pinchStart)));
    } else {
      const k = 2.6 / Math.max(160, this.host.clientWidth);
      const dYaw = dx * k * Math.PI * 0.5;
      const nowMs = performance.now();
      const dtMs = Math.max(8, Math.min(60, nowMs - this.lastMove));
      this.lastMove = nowMs;
      this.yaw += dYaw;
      this.yawVel = Math.max(-8, Math.min(8, dYaw / (dtMs / 1000)));
      // En mouse también se inclina; en táctil el gesto vertical se deja para desplazar la página.
      if (e.pointerType === 'mouse') this.pitch = Math.max(-0.12, Math.min(0.5, this.pitch + dy * 0.004));
    }
    this.invalidate();
  };

  private onUp = (e: PointerEvent) => {
    const tap = e.type === 'pointerup' && this.pointers.size === 1 && !this.downAt.moved && performance.now() - this.downAt.t < 500;
    this.pointers.delete(e.pointerId);
    if (tap && this.onPick && this.figure?.muscleMeshes.length) {
      this.yawVel = 0;
      this.onPick(this.pick(e.clientX, e.clientY));
    }
    if (this.pointers.size === 0) this.dragging = false;
    // Si el dedo se quedó quieto antes de soltar, no hay inercia.
    if (performance.now() - this.lastMove > 90) this.yawVel = 0;
    this.pinchStart = 0;
    this.invalidate();
  };

  /** Qué músculo hay bajo un punto de la pantalla. */
  private pick(clientX: number, clientY: number): MuscleId | null {
    const fig = this.figure;
    if (!fig) return null;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    // La cabeza, las manos y los zapatos también tapan: se prueba contra toda la figura y se ve si lo primero es un músculo.
    const hit = this.raycaster.intersectObject(fig.group, true)[0];
    if (!hit?.face || !fig.muscleMeshes.includes(hit.object as Mesh)) return null;
    const mesh = hit.object as Mesh;
    for (const v of [hit.face.a, hit.face.b, hit.face.c]) {
      const m = fig.muscleAt(mesh, v);
      if (m) return m;
    }
    return null;
  }

  private onWheel = (e: WheelEvent) => {
    // Solo el gesto de pellizco del trackpad (llega como rueda + ctrl); la rueda normal desplaza la página.
    if (!e.ctrlKey) return;
    e.preventDefault();
    this.autoRotate = false;
    this.zoom = Math.max(1, Math.min(3, this.zoom * Math.exp(-e.deltaY * 0.0015)));
    this.invalidate();
  };
}
