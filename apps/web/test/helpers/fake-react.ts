/**
 * React mínimo para probar componentes y hooks en Node, sin DOM: implementa los hooks y "renderiza" un componente
 * llamándolo como función. Sus hijos NO se expanden (render superficial): la prueba revisa los elementos que
 * devuelve (qué componente, con qué props) y dispara sus manejadores (`onClick`, `onChange`) como lo haría un toque.
 *
 * Uso en una prueba (solo los archivos de `src` ven el React falso; react-dom y react-router usan el real):
 *
 *   vi.mock('react', async (importOriginal) => {
 *     const real = await importOriginal<typeof import('react')>();
 *     const { fakeHooks } = await import('./helpers/fake-react');
 *     return { ...real, ...fakeHooks, default: { ...real, ...fakeHooks } };
 *   });
 *
 * Este archivo no importa React en tiempo de ejecución (solo tipos) para no depender del mock.
 */
import type { ReactElement, ReactNode } from 'react';

type Slot = {
  value?: unknown;
  set?: (v: unknown) => void;
  deps?: readonly unknown[];
  effect?: () => void | (() => void);
  nextDeps?: readonly unknown[];
  cleanup?: void | (() => void);
  unsubscribe?: () => void;
  current?: unknown;
};

const sameDeps = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
  !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

let current: Instance<any> | null = null;
let ids = 0;

class Instance<P> {
  slots: Slot[] = [];
  i = 0;
  out: ReactNode = null;
  rendering = false;
  flushing = false;
  dirty = false;
  alive = true;
  constructor(
    public fn: (p: P) => ReactNode,
    public props: P,
  ) {}

  slot(): Slot {
    const i = this.i++;
    return (this.slots[i] ??= {});
  }

  schedule() {
    if (!this.alive) return;
    if (this.rendering || this.flushing) this.dirty = true;
    else this.render();
  }

  render() {
    for (let n = 0; n < 50; n++) {
      this.dirty = false;
      this.rendering = true;
      const prev = current;
      current = this;
      this.i = 0;
      try {
        this.out = this.fn(this.props);
      } finally {
        current = prev;
        this.rendering = false;
      }
      this.flushing = true;
      try {
        for (const s of this.slots) {
          if (!s?.effect) continue;
          const run = s.effect;
          s.effect = undefined;
          if (typeof s.cleanup === 'function') s.cleanup();
          s.cleanup = run();
          s.deps = s.nextDeps;
        }
      } finally {
        this.flushing = false;
      }
      if (!this.dirty) return;
    }
    throw new Error('Demasiados renders seguidos (¿un setState en cada render?)');
  }

  unmount() {
    this.alive = false;
    for (const s of this.slots) {
      if (typeof s?.cleanup === 'function') s.cleanup();
      s?.unsubscribe?.();
    }
  }
}

function me(): Instance<any> {
  if (!current) throw new Error('Hook fuera de un render del React falso');
  return current;
}

function useState<T>(init: T | (() => T)): [T, (v: T | ((p: T) => T)) => void] {
  const inst = me();
  const s = inst.slot();
  if (!('value' in s)) s.value = typeof init === 'function' ? (init as () => T)() : init;
  s.set ??= (v: unknown) => {
    const next = typeof v === 'function' ? (v as (p: unknown) => unknown)(s.value) : v;
    if (Object.is(next, s.value)) return;
    s.value = next;
    inst.schedule();
  };
  return [s.value as T, s.set as (v: T | ((p: T) => T)) => void];
}

function useReducer<S, A>(reducer: (s: S, a: A) => S, init: S): [S, (a: A) => void] {
  const [s, set] = useState(init);
  return [s, (a: A) => set((p) => reducer(p, a))];
}

function useEffect(fn: () => void | (() => void), deps?: readonly unknown[]) {
  const s = me().slot();
  if (!deps || !sameDeps(s.deps, deps)) {
    s.effect = fn;
    s.nextDeps = deps;
  }
}

function useRef<T>(init: T): { current: T } {
  const s = me().slot();
  if (!('current' in s)) s.current = init;
  return s as unknown as { current: T };
}

function useMemo<T>(fn: () => T, deps: readonly unknown[]): T {
  const s = me().slot();
  if (!sameDeps(s.deps, deps)) {
    s.value = fn();
    s.deps = deps;
  }
  return s.value as T;
}

function useCallback<T>(fn: T, deps: readonly unknown[]): T {
  return useMemo(() => fn, deps);
}

function useId(): string {
  const s = me().slot();
  if (!('value' in s)) s.value = `:f${++ids}:`;
  return s.value as string;
}

function useSyncExternalStore<T>(subscribe: (l: () => void) => () => void, getSnapshot: () => T): T {
  const inst = me();
  const s = inst.slot();
  s.unsubscribe ??= subscribe(() => inst.schedule());
  return getSnapshot();
}

function useContext<T>(ctx: { _currentValue?: T }): T | undefined {
  return ctx._currentValue;
}

export const fakeHooks = {
  useState,
  useReducer,
  useEffect,
  useLayoutEffect: useEffect,
  useInsertionEffect: useEffect,
  useRef,
  useMemo,
  useCallback,
  useId,
  useSyncExternalStore,
  useContext,
  useImperativeHandle: () => {},
  useDebugValue: () => {},
};

export interface Rendered<P> {
  /** Lo que devolvió el último render. */
  readonly out: ReactNode;
  rerender(props?: Partial<P>): void;
  unmount(): void;
}

/** Monta un componente (o un hook envuelto en un componente) y corre sus efectos. */
export function render<P>(fn: (p: P) => ReactNode, props: P): Rendered<P> {
  const inst = new Instance(fn, props);
  inst.render();
  return {
    get out() {
      return inst.out;
    },
    rerender(p) {
      inst.props = { ...inst.props, ...p };
      inst.render();
    },
    unmount() {
      inst.unmount();
    },
  };
}

/** Monta un hook y deja ver su último valor. */
export function renderHook<T>(hook: () => T): { readonly value: T; unmount(): void } {
  let value!: T;
  const r = render(() => {
    value = hook();
    return null;
  }, {});
  return {
    get value() {
      return value;
    },
    unmount: r.unmount,
  };
}

// ---------------------------------------------------------------------------------------------
// Recorrer lo renderizado
// ---------------------------------------------------------------------------------------------

const isElement = (x: unknown): x is ReactElement<Record<string, any>> => !!x && typeof x === 'object' && 'type' in x && 'props' in x;

/** Todos los elementos del árbol (incluye los que van en props como `right={<button/>}`), en orden. */
export function* elements(node: unknown): Generator<ReactElement<Record<string, any>>> {
  if (Array.isArray(node)) {
    for (const n of node) yield* elements(n);
    return;
  }
  if (!isElement(node)) return;
  yield node;
  for (const v of Object.values(node.props)) if (Array.isArray(v) || isElement(v)) yield* elements(v);
}

export function findAll(node: unknown, pred: (el: ReactElement<Record<string, any>>) => boolean) {
  return [...elements(node)].filter(pred);
}

export function find(node: unknown, pred: (el: ReactElement<Record<string, any>>) => boolean) {
  const el = [...elements(node)].find(pred);
  if (!el) throw new Error('No encontré el elemento');
  return el;
}

/** Texto visible de un elemento (sin expandir componentes). */
export function text(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  if (isElement(node)) return text(node.props.children);
  return '';
}
