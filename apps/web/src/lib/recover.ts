/**
 * Que la app nunca se quede "en negro" al cambiar de pantalla.
 *
 * Causa principal: se publica una versión nueva mientras la app está abierta. El service worker nuevo
 * (skipWaiting + clientsClaim) borra los archivos de la versión vieja y el servidor responde index.html en su
 * lugar, así que abrir una pantalla que aún no se había cargado falla ("Failed to fetch dynamically imported
 * module"). Sin un límite de errores, React desmonta toda la app y solo queda el fondo.
 *
 * Arreglo:
 * 1. Las pantallas se cargan con `lazyScreen`: si su archivo ya no existe, recarga la app una vez (ya con la
 *    versión nueva) en vez de fallar.
 * 2. Si una versión nueva toma el control con la app abierta, el siguiente cambio de pantalla la carga completa
 *    (`onRouteChange`), antes de que falte algún archivo.
 * 3. `ErrorBoundary` (ui/ErrorBoundary.tsx) atrapa cualquier otro error: muestra cómo salir y deja la navegación.
 *
 * Antes de recargar se guarda en el dispositivo lo pendiente (`persistNow`), así que no se pierde nada.
 */
import { lazy, type ComponentType } from 'react';
import { persistNow } from '../data/store';

const RELOAD_KEY = 'igv-reload-at';
/** Si ya se recargó hace menos de esto y vuelve a fallar, no se recarga sola otra vez (evita un ciclo). */
const RELOAD_COOLDOWN_MS = 20_000;

/** ¿El error es por un archivo de la app que no se pudo descargar (versión vieja, sin conexión)? */
export function isChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err ?? '');
  return /dynamically imported module|Importing a module script failed|Failed to load module script|Expected a JavaScript.*module script|Unable to preload CSS|ChunkLoadError|Loading (CSS )?chunk/i.test(
    msg,
  );
}

function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

let reloading = false;

/**
 * Recarga la app (guardando antes lo pendiente). Devuelve `false` si no conviene: sin conexión, o si ya se recargó
 * sola hace poco y siguió fallando; en ese caso se muestra el aviso con el botón para recargar a mano.
 */
export function reloadApp(reason: string): boolean {
  if (reloading) return true;
  if (isOffline()) return false;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false; // sin sessionStorage no hay forma de evitar un ciclo de recargas
  }
  reloading = true;
  console.warn(`[igv] recargando la app: ${reason}`);
  const go = () => window.location.reload();
  Promise.race([persistNow(), new Promise((r) => setTimeout(r, 1500))]).then(go, go);
  return true;
}

/** Como `React.lazy`, pero si el archivo de la pantalla ya no existe, recarga con la versión nueva. */
export function lazyScreen<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((err: unknown) => {
      // La promesa que nunca se cumple deja el "Cargando…" mientras la página se recarga.
      if (isChunkError(err) && reloadApp('no se pudo cargar una pantalla')) return new Promise<never>(() => {});
      throw err;
    }),
  );
}

let updateReady = false;

/** Se llama una vez al arrancar (main.tsx). */
export function installRecovery() {
  // Vite avisa así cuando falla la descarga de un archivo de la app (incluido el CSS de una pantalla).
  window.addEventListener('vite:preloadError', (e) => {
    const err = (e as Event & { payload?: unknown }).payload;
    if (isChunkError(err)) reloadApp('falló la descarga de un archivo');
  });
  // Ya había un service worker al abrir: si cambia, es que se instaló una versión nueva con la app abierta.
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  if (sw?.controller) sw.addEventListener('controllerchange', () => (updateReady = true));
  // Guarda lo pendiente al salir o mandar la app al fondo (se guardaba con 250 ms de espera).
  window.addEventListener('pagehide', () => void persistNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void persistNow();
  });
}

/** Al cambiar de pantalla: si ya hay una versión nueva instalada, la carga completa (en la pantalla destino). */
export function onRouteChange() {
  if (updateReady) reloadApp('hay una versión nueva');
}
