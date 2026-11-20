import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  Object3D,
  OrthographicCamera,
  PCFShadowMap,
  Raycaster,
  Scene,
  Vector2,
  WebGLRenderer,
} from 'three';

/**
 * Maqueta de tu ciudad: una base con siete lotes (un distrito por atributo) y el edificio principal de cada uno,
 * que crece por nivel con una silueta propia. Estética de maqueta de arquitecto: bloques claros, base grafito y
 * el oro solo en lo que está en obra o listo para inaugurar. Dibuja solo cuando algo cambia.
 */
export interface CityModelDistrict {
  id: string;
  level: number;
  work: { level: number; ready: boolean } | null;
}

const LAYOUT: Record<string, [number, number]> = (() => {
  const ring = ['finanzas', 'fuerza', 'inteligencia', 'carisma', 'relaciones', 'creatividad'];
  const out: Record<string, [number, number]> = { disciplina: [0, 0] };
  ring.forEach((id, i) => {
    const a = (i / ring.length) * Math.PI * 2 + Math.PI / 6;
    out[id] = [Math.cos(a) * 3.3, Math.sin(a) * 3.3];
  });
  return out;
})();

const PLOT = 2.3;

type Mats = { stone: MeshStandardMaterial; stone2: MeshStandardMaterial; glass: MeshStandardMaterial; plot: MeshStandardMaterial; plotEmpty: MeshStandardMaterial; base: MeshStandardMaterial; gold: MeshStandardMaterial; ghost: MeshStandardMaterial };

export class CityScene {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  private world = new Group();
  private city = new Group();
  private mats: Mats;
  private yaw = -0.55;
  private dragging = false;
  private moved = 0;
  private lastX = 0;
  private raf = 0;
  private disposed = false;
  private observer: ResizeObserver;
  private ray = new Raycaster();
  onPick: ((districtId: string) => void) | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private host: HTMLElement,
    dark: boolean,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;

    const std = (color: string, extra: Partial<MeshStandardMaterial> = {}) => Object.assign(new MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 }), extra);
    this.mats = {
      stone: std('#ece7dd'),
      stone2: std('#d9d2c4'),
      glass: std(dark ? '#7f93ad' : '#9fb3cc', { roughness: 0.35 } as Partial<MeshStandardMaterial>),
      plot: std(dark ? '#4a5466' : '#d6cfc1'),
      plotEmpty: std(dark ? '#2f3644' : '#e7e1d5'),
      base: std(dark ? '#20262f' : '#c9c1b2'),
      gold: std('#e6a938', { roughness: 0.5, metalness: 0.2 } as Partial<MeshStandardMaterial>),
      ghost: std('#e6a938', { transparent: true, opacity: 0.22, depthWrite: false } as Partial<MeshStandardMaterial>),
    };

    this.scene.add(new HemisphereLight('#ffffff', dark ? '#4a505c' : '#b9b0a0', dark ? 1.6 : 1.5));
    const key = new DirectionalLight('#fff6ea', 2.2);
    key.position.set(6, 12, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera;
    sc.left = -9;
    sc.right = 9;
    sc.top = 9;
    sc.bottom = -9;
    sc.near = 1;
    sc.far = 40;
    key.shadow.bias = -0.0008;
    this.scene.add(key);

    const base = new Mesh(new CylinderGeometry(6.4, 6.6, 0.35, 6), this.mats.base);
    base.rotation.y = Math.PI / 6;
    base.position.y = -0.18;
    base.receiveShadow = true;
    this.world.add(base, this.city);
    this.scene.add(this.world);

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  setCity(districts: CityModelDistrict[]) {
    for (const c of [...this.city.children]) {
      this.city.remove(c);
      disposeTree(c);
    }
    for (const d of districts) {
      const pos = LAYOUT[d.id];
      if (!pos) continue;
      const g = new Group();
      g.userData.districtId = d.id;
      g.position.set(pos[0], 0, pos[1]);
      const plot = new Mesh(new BoxGeometry(PLOT, 0.12, PLOT), d.level > 0 ? this.mats.plot : this.mats.plotEmpty);
      plot.position.y = 0.06;
      plot.receiveShadow = true;
      g.add(plot);
      if (d.level > 0) g.add(this.building(d.id, d.level, false));
      if (d.work) {
        const ghost = this.building(d.id, d.work.level, true);
        g.add(ghost);
        g.add(scaffold(ghost, d.work.ready ? '#e6a938' : '#b98a3a'));
      }
      this.city.add(g);
    }
    this.invalidate();
  }

  /** Edificio de un distrito a un nivel: cada distrito tiene su silueta. */
  private building(id: string, level: number, ghost: boolean): Group {
    const g = new Group();
    const m = this.mats;
    const stone = ghost ? m.ghost : m.stone;
    const stone2 = ghost ? m.ghost : m.stone2;
    const glass = ghost ? m.ghost : m.glass;
    const top = ghost ? m.ghost : level >= 10 ? m.gold : m.stone2;
    const add = (geo: BufferGeometry, mat: MeshStandardMaterial, x: number, y: number, z: number) => {
      const mesh = new Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = !ghost;
      mesh.receiveShadow = !ghost;
      g.add(mesh);
      return mesh;
    };
    const L = Math.max(1, level);
    const Y0 = 0.12;
    switch (id) {
      case 'disciplina': {
        // Escalonado: un piso más angosto por nivel.
        let y = Y0;
        for (let i = 0; i < L; i++) {
          const w = 1.7 - i * 0.12;
          const h = 0.32;
          add(new BoxGeometry(w, h, w), i === L - 1 ? top : i % 2 ? stone2 : stone, 0, y + h / 2, 0);
          y += h;
        }
        break;
      }
      case 'finanzas': {
        // Torre esbelta con vidrio; crece en altura.
        const h = 0.6 + L * 0.42;
        add(new BoxGeometry(0.9, h, 0.9), glass, 0, Y0 + h / 2, 0);
        add(new BoxGeometry(1.02, 0.12, 1.02), stone, 0, Y0 + 0.06, 0);
        for (let i = 1; i < L; i += 2) add(new BoxGeometry(0.94, 0.05, 0.94), stone, 0, Y0 + i * 0.42 + 0.2, 0);
        add(new BoxGeometry(0.6, 0.18, 0.6), top, 0, Y0 + h + 0.09, 0);
        if (L >= 6) add(new BoxGeometry(0.7, h * 0.55, 0.7), glass, 0.75, Y0 + (h * 0.55) / 2, 0.45);
        break;
      }
      case 'fuerza': {
        // Nave baja y ancha con techo curvo; crece a lo largo.
        const len = 0.9 + L * 0.11;
        add(new BoxGeometry(1.5, 0.45, len), stone, 0, Y0 + 0.225, 0);
        const roof = add(new CylinderGeometry(0.75, 0.75, len, 20, 1, false, 0, Math.PI), top, 0, Y0 + 0.45, 0);
        roof.rotation.set(Math.PI / 2, 0, Math.PI / 2);
        roof.scale.set(1, 1, 0.45);
        if (L >= 4) add(new BoxGeometry(0.5, 0.06, 0.5), stone2, 0.85, Y0 + 0.03, -len / 2 + 0.3);
        break;
      }
      case 'inteligencia': {
        // Biblioteca: cuerpo con columnas al frente; más columnas y un piso más con el nivel.
        const floors = 1 + Math.floor((L - 1) / 4);
        const h = 0.38 * floors;
        add(new BoxGeometry(1.7, h, 1.0), stone, 0, Y0 + h / 2, -0.15);
        const cols = Math.min(7, 2 + L);
        for (let i = 0; i < cols; i++) {
          const x = -0.75 + (1.5 * i) / Math.max(1, cols - 1);
          add(new CylinderGeometry(0.05, 0.05, h, 8), stone2, x, Y0 + h / 2, 0.5);
        }
        add(new BoxGeometry(1.86, 0.1, 1.4), top, 0, Y0 + h + 0.05, 0);
        break;
      }
      case 'carisma': {
        // Auditorio redondo: más ancho y alto con el nivel.
        const r = 0.5 + L * 0.06;
        const h = 0.3 + L * 0.06;
        add(new CylinderGeometry(r, r * 1.05, h, 28), stone, 0, Y0 + h / 2, 0);
        add(new CylinderGeometry(r * 0.75, r * 0.95, 0.14, 28), top, 0, Y0 + h + 0.07, 0);
        break;
      }
      case 'relaciones': {
        // Barrio: una casa más por nivel.
        const n = Math.min(9, L);
        for (let i = 0; i < n; i++) {
          const x = -0.7 + (i % 3) * 0.7;
          const z = -0.7 + Math.floor(i / 3) * 0.7;
          add(new BoxGeometry(0.42, 0.3, 0.42), stone, x, Y0 + 0.15, z);
          const roof = add(new CylinderGeometry(0, 0.34, 0.2, 4), i === n - 1 ? top : stone2, x, Y0 + 0.4, z);
          roof.rotation.y = Math.PI / 4;
        }
        break;
      }
      default: {
        // Taller: volúmenes en voladizo, alternados; un volumen más cada dos niveles.
        let y = Y0;
        const n = Math.min(6, 1 + Math.ceil(L / 2));
        for (let i = 0; i < n; i++) {
          const h = 0.34;
          const wide = i % 2 === 0;
          add(new BoxGeometry(wide ? 1.4 : 0.7, h, wide ? 0.7 : 1.4), i === n - 1 ? top : i % 2 ? stone2 : stone, wide ? 0.2 : -0.15, y + h / 2, wide ? -0.1 : 0.15);
          y += h;
        }
      }
    }
    return g;
  }

  private onDown = (e: PointerEvent) => {
    this.dragging = true;
    this.moved = 0;
    this.lastX = e.clientX;
    this.canvas.setPointerCapture?.(e.pointerId);
  };
  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    this.lastX = e.clientX;
    this.moved += Math.abs(dx);
    this.yaw += dx * 0.008;
    this.invalidate();
  };
  private onUp = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.moved < 6 && this.onPick) {
      const r = this.canvas.getBoundingClientRect();
      const p = new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.ray.setFromCamera(p, this.camera);
      const hit = this.ray.intersectObjects(this.city.children, true)[0];
      let o: Object3D | null = hit?.object ?? null;
      while (o && !o.userData.districtId) o = o.parent;
      const id = o?.userData.districtId as string | undefined;
      if (id) this.onPick(id);
    }
  };

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    const view = 12.2;
    this.camera.left = (-view * aspect) / 2;
    this.camera.right = (view * aspect) / 2;
    this.camera.top = view / 2 + 0.2;
    this.camera.bottom = -view / 2 + 0.2;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  invalidate() {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.disposed) return;
      const d = 18;
      this.camera.position.set(Math.sin(this.yaw) * d, d * 0.82, Math.cos(this.yaw) * d);
      this.camera.lookAt(0, 0.6, 0);
      this.renderer.render(this.scene, this.camera);
    });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    disposeTree(this.world);
    for (const m of Object.values(this.mats)) m.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

/** Andamio: las aristas de la obra en curso. */
function scaffold(target: Group, color: string): LineSegments {
  const segs: number[] = [];
  target.updateMatrixWorld(true);
  target.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const edges = new EdgesGeometry(o.geometry, 30);
    edges.applyMatrix4(o.matrix);
    const arr = edges.getAttribute('position').array as ArrayLike<number>;
    for (let i = 0; i < arr.length; i++) segs.push(arr[i]);
    edges.dispose();
  });
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(segs, 3));
  return new LineSegments(geo, new LineBasicMaterial({ color: new Color(color) }));
}

function disposeTree(o: Object3D) {
  o.traverse((x) => {
    if (x instanceof Mesh || x instanceof LineSegments) {
      x.geometry.dispose();
      if (x instanceof LineSegments) (x.material as LineBasicMaterial).dispose();
    }
  });
}
