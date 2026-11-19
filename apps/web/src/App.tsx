import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { onStoreError, sync, useGame, useStore } from './data/store';
import { Fx } from './ui/fx';
import { QuickAdd } from './ui/QuickAdd';
import { SyncPill } from './ui/SyncPill';
import { schedulePlanUpload } from './lib/notifications';
import { Toasts, toast } from './ui/kit';
import { Icon } from './ui/icons';
import Hoy from './screens/Hoy';
import { Mas, Progreso } from './screens/Menus';

const Misiones = lazy(() => import('./screens/Misiones'));
const Personaje = lazy(() => import('./screens/Personaje'));
const Jefes = lazy(() => import('./screens/Jefes'));
const Logros = lazy(() => import('./screens/Logros'));
const Habilidades = lazy(() => import('./screens/Habilidades'));
const Temporadas = lazy(() => import('./screens/Temporadas'));
const Inventario = lazy(() => import('./screens/Inventario'));
const Npcs = lazy(() => import('./screens/Npcs'));
const Mapa = lazy(() => import('./screens/Mapa'));
const Vida = lazy(() => import('./screens/Vida'));
const Ajustes = lazy(() => import('./screens/Ajustes'));
const GameMaster = lazy(() => import('./screens/GameMaster'));
const Historial = lazy(() => import('./screens/Historial'));
const Estadisticas = lazy(() => import('./screens/Estadisticas'));
const Reporte = lazy(() => import('./screens/Reporte'));
const Tienda = lazy(() => import('./screens/Tienda'));
const Metas = lazy(() => import('./screens/Metas'));
const Enemigos = lazy(() => import('./screens/Enemigos'));
const Biblioteca = lazy(() => import('./screens/Biblioteca'));
const Cuerpo = lazy(() => import('./screens/Cuerpo'));
const Buscar = lazy(() => import('./screens/Buscar'));
const Anual = lazy(() => import('./screens/Anual'));

const PROGRESS = ['/progreso', '/jefes', '/logros', '/habilidades', '/temporadas', '/metas', '/estadisticas', '/reporte', '/anual', '/tienda', '/historial'];
const WORLD = ['/mas', '/inventario', '/npcs', '/mapa', '/vida', '/ajustes', '/game-master', '/enemigos', '/biblioteca', '/cuerpo', '/buscar'];

function Nav() {
  const { pathname } = useLocation();
  const cls = (paths: string[]) => ({ isActive }: { isActive: boolean }) => (isActive || paths.some((p) => pathname.startsWith(p)) ? 'active' : '');
  return (
    <nav className="nav" aria-label="Navegación principal">
      <NavLink to="/" end>
        <Icon name="home" />
        Hoy
      </NavLink>
      <NavLink to="/misiones">
        <Icon name="sword" />
        Misiones
      </NavLink>
      <NavLink to="/personaje">
        <Icon name="user" />
        Personaje
      </NavLink>
      <NavLink to="/progreso" className={cls(PROGRESS)}>
        <Icon name="trophy" />
        Progreso
      </NavLink>
      <NavLink to="/mas" className={cls(WORLD)}>
        <Icon name="grid" />
        Mundo
      </NavLink>
    </nav>
  );
}

function StatusBanner() {
  const store = useStore();
  if (store.status === 'auth' && store.authMessage === 'access_disabled')
    return (
      <div className="banner warn">
        <Icon name="lock" width={18} /> Falta activar Cloudflare Access en el Worker (Settings → Domains &amp; Routes → workers.dev). Mientras tanto la app no muestra datos.
      </div>
    );
  if (store.status === 'auth')
    return (
      <div className="banner warn">
        <Icon name="lock" width={18} /> Tu sesión expiró. Tus cambios están guardados en este dispositivo.
        <button className="btn sm" onClick={() => window.location.reload()}>
          Entrar
        </button>
      </div>
    );
  if (store.status === 'offline' || (store.status === 'error' && store.pendingCount > 0))
    return (
      <div className="banner">
        <Icon name="refresh" width={18} /> Sin conexión. {store.pendingCount > 0 ? `${store.pendingCount} cambio(s) se subirán al reconectar.` : 'Mostrando datos guardados.'}
        <button className="btn sm" onClick={() => sync()}>
          Reintentar
        </button>
      </div>
    );
  return null;
}

/** Mantiene al día el plan de notificaciones (solo si están activas en este dispositivo). */
function NotificationsSync() {
  const { state, entities, store } = useGame();
  useEffect(() => {
    if (store.ready) schedulePlanUpload(state, entities);
  }, [state, entities, store.ready]);
  return null;
}

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  const store = useStore();
  useEffect(() => {
    const off = onStoreError((m) => toast(`El servidor rechazó un cambio: ${m}`, 'error'));
    return () => {
      off();
    };
  }, []);
  return (
    <BrowserRouter>
      <ScrollTop />
      <div className="app">
        <Nav />
        <main className="main">
          <StatusBanner />
          {!store.ready ? (
            <div className="empty" style={{ paddingTop: 80 }}>
              {store.status === 'syncing' || store.status === 'idle' ? (
                'Cargando tu partida…'
              ) : (
                <>
                  <p>{store.authMessage === 'access_disabled' ? 'Activa Cloudflare Access en el Worker para entrar.' : 'No pude conectar con el servidor.'}</p>
                  <button className="btn primary" onClick={() => (store.status === 'auth' ? window.location.reload() : sync())}>
                    Reintentar
                  </button>
                </>
              )}
            </div>
          ) : (
            <Suspense fallback={<div className="empty">Cargando…</div>}>
              <Routes>
                <Route path="/" element={<Hoy />} />
                <Route path="/misiones" element={<Misiones />} />
                <Route path="/personaje" element={<Personaje />} />
                <Route path="/progreso" element={<Progreso />} />
                <Route path="/jefes" element={<Jefes />} />
                <Route path="/logros" element={<Logros />} />
                <Route path="/habilidades" element={<Habilidades />} />
                <Route path="/temporadas" element={<Temporadas />} />
                <Route path="/mas" element={<Mas />} />
                <Route path="/inventario" element={<Inventario />} />
                <Route path="/npcs" element={<Npcs />} />
                <Route path="/mapa" element={<Mapa />} />
                <Route path="/vida" element={<Vida />} />
                <Route path="/ajustes" element={<Ajustes />} />
                <Route path="/game-master" element={<GameMaster />} />
                <Route path="/historial" element={<Historial />} />
                <Route path="/estadisticas" element={<Estadisticas />} />
                <Route path="/reporte" element={<Reporte />} />
                <Route path="/tienda" element={<Tienda />} />
                <Route path="/metas" element={<Metas />} />
                <Route path="/enemigos" element={<Enemigos />} />
                <Route path="/biblioteca" element={<Biblioteca />} />
                <Route path="/cuerpo" element={<Cuerpo />} />
                <Route path="/buscar" element={<Buscar />} />
                <Route path="/anual" element={<Anual />} />
                <Route path="*" element={<Hoy />} />
              </Routes>
            </Suspense>
          )}
        </main>
      </div>
      <Fx />
      <Toasts />
      <SyncPill />
      {store.ready && <QuickAdd />}
      {store.ready && <NotificationsSync />}
    </BrowserRouter>
  );
}
