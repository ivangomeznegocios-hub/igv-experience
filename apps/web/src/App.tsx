import { Suspense, useEffect, useRef, type ReactNode } from 'react';
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { onStoreError, sync, useGame, useStore } from './data/store';
import { ActionDock } from './ui/ActionDock';
import { DayDeckHost } from './ui/DayDeck';
import { DayResultHost } from './ui/DayResult';
import { Fx } from './ui/fx';
import { QuestMode } from './ui/QuestMode';
import { QuickAdd } from './ui/QuickAdd';
import { PlanSheet } from './ui/DayPlan';
import { RecordWatcher } from './ui/RecordWatcher';
import { DoctorAutoReview } from './lib/medico';
import { SyncPill } from './ui/SyncPill';
import { schedulePlanUpload } from './lib/notifications';
import { scheduleSnapshotUpload } from './lib/aiSnapshot';
import { Toasts, toast } from './ui/kit';
import { Icon } from './ui/icons';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { lazyScreen, onRouteChange } from './lib/recover';
import Hoy from './screens/Hoy';
import { Mas, Progreso } from './screens/Menus';

const Misiones = lazyScreen(() => import('./screens/Misiones'));
const Personaje = lazyScreen(() => import('./screens/Personaje'));
const Jefes = lazyScreen(() => import('./screens/Jefes'));
const Logros = lazyScreen(() => import('./screens/Logros'));
const Habilidades = lazyScreen(() => import('./screens/Habilidades'));
const Temporadas = lazyScreen(() => import('./screens/Temporadas'));
const Inventario = lazyScreen(() => import('./screens/Inventario'));
const Npcs = lazyScreen(() => import('./screens/Npcs'));
const Mapa = lazyScreen(() => import('./screens/Mapa'));
const Vida = lazyScreen(() => import('./screens/Vida'));
const Ajustes = lazyScreen(() => import('./screens/Ajustes'));
const GameMaster = lazyScreen(() => import('./screens/GameMaster'));
const Historial = lazyScreen(() => import('./screens/Historial'));
const Estadisticas = lazyScreen(() => import('./screens/Estadisticas'));
const Reporte = lazyScreen(() => import('./screens/Reporte'));
const Tienda = lazyScreen(() => import('./screens/Tienda'));
const Metas = lazyScreen(() => import('./screens/Metas'));
const Enemigos = lazyScreen(() => import('./screens/Enemigos'));
const Biblioteca = lazyScreen(() => import('./screens/Biblioteca'));
const Cuerpo = lazyScreen(() => import('./screens/Cuerpo'));
const Buscar = lazyScreen(() => import('./screens/Buscar'));
const Anual = lazyScreen(() => import('./screens/Anual'));
const Retos = lazyScreen(() => import('./screens/Retos'));
const Records = lazyScreen(() => import('./screens/Records'));
const ConectarIA = lazyScreen(() => import('./screens/ConectarIA'));

// ---- Sistemas nuevos (pantallas) ----
// [[voz]]
import { Hablar } from './ui/Cuentame';

// [[entreno]]
const Entreno = lazyScreen(() => import('./screens/Entreno'));
const WorkoutSheetHost = lazyScreen(() => import('./ui/WorkoutSheet'));

// [[gente]]
const Persona = lazyScreen(() => import('./screens/Persona'));
import { PeopleWatcher } from './ui/people';

// [[mapa]]

// [[habilidades]]
const Tiempo = lazyScreen(() => import('./screens/Tiempo'));
const TimerPill = lazyScreen(() => import('./ui/habilidades/TimerPill'));

// [[aprendizaje]]
const Aprendizaje = lazyScreen(() => import('./screens/Aprendizaje'));

// [[salud]]
const Salud = lazyScreen(() => import('./screens/Salud'));

// [[habitos]]
const Habitos = lazyScreen(() => import('./screens/Habitos'));
// [[ciudad]]
const Ciudad = lazyScreen(() => import('./screens/Ciudad'));
const Dia = lazyScreen(() => import('./screens/Dia'));


const PROGRESS = ['/progreso', '/jefes', '/logros', '/temporadas', '/metas', '/estadisticas', '/reporte', '/anual', '/tienda', '/historial', '/retos', '/records'];
const WORLD = [
  '/mas', '/inventario', '/npcs', '/mapa', '/vida', '/ajustes', '/game-master', '/conectar-ia', '/enemigos', '/biblioteca', '/cuerpo', '/buscar',
  '/habilidades', '/tiempo', '/aprendizaje', '/salud', '/habitos', '/entreno', '/ciudad',
];
const TODAY = ['/dia'];

function Nav() {
  const { pathname } = useLocation();
  const cls = (paths: string[]) => ({ isActive }: { isActive: boolean }) => (isActive || paths.some((p) => pathname.startsWith(p)) ? 'active' : '');
  return (
    <nav className="nav" aria-label="Navegación principal">
      <NavLink to="/" end className={cls(TODAY)}>
        <Icon name="home" />
        Hoy
      </NavLink>
      <NavLink to="/misiones">
        <Icon name="target" />
        Misiones
      </NavLink>
      <NavLink to="/personaje">
        <Icon name="user" />
        Perfil
      </NavLink>
      <NavLink to="/progreso" className={cls(PROGRESS)}>
        <Icon name="trophy" />
        Progreso
      </NavLink>
      <NavLink to="/mas" className={cls(WORLD)}>
        <Icon name="grid" />
        Más
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

/** Mantiene en el servidor la foto del estado para el MCP y el Coach (ver lib/aiSnapshot.ts). */
function AiSnapshotSync() {
  const { state, entities, store } = useGame();
  useEffect(() => {
    if (store.ready && store.status === 'idle' && store.pendingCount === 0) scheduleSnapshotUpload(state, entities);
  }, [state, entities, store.ready, store.status, store.pendingCount, store.lastSync]);
  return null;
}

/** Aplica el estilo de color elegido en Tienda → Estilo al documento raíz. */
function SkinSync() {
  const { state, store } = useGame();
  const skin = state.settings.equipped?.skin ?? 'obsidian';
  useEffect(() => {
    if (!store.ready) return;
    if (skin && skin !== 'obsidian') document.documentElement.setAttribute('data-skin', skin);
    else document.documentElement.removeAttribute('data-skin');
  }, [skin, store.ready]);
  return null;
}

/** La mesa (Hoy) usa todo el ancho en computadora; las demás pantallas, una columna. */
function Main({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <main className={`main ${pathname === '/' ? 'wide' : ''}`}>{children}</main>;
}

/**
 * El título de la pestaña dice cómo va tu día (sirve con la app abierta en la computadora): es el único aviso, y
 * no es una notificación.
 */
function TabTitle() {
  const { state } = useGame();
  const t = state.days.today;
  useEffect(() => {
    const base = 'IGV EXPERIENCE';
    if (!t) {
      document.title = base;
      return;
    }
    const lead = t.status === 'won' ? '✓ Día ganado' : `${t.score}/100`;
    const extra = state.days.comeback && !state.days.comeback.done ? ' · Regresaste' : !t.closed && t.status === 'won' ? ' · Cierra tu día' : '';
    document.title = `${lead}${extra} · ${base}`;
  }, [t, state.days.comeback]);
  return null;
}

function ScrollTop() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    window.scrollTo(0, 0);
    // Si se instaló una versión nueva con la app abierta, cambiar de pantalla la carga (ver lib/recover.ts).
    if (first.current) first.current = false;
    else onRouteChange();
  }, [pathname]);
  return null;
}

/** Las pantallas: si una falla, se muestra cómo salir y la navegación sigue ahí (nunca la pantalla en negro). */
function Screens({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  return <ErrorBoundary resetKey={pathname + search}>{children}</ErrorBoundary>;
}

/** Hojas y avisos globales: si uno falla, se oculta (con aviso) en vez de tumbar toda la app. */
function Guard({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname} fallback={() => null} onError={() => toast('Algo falló. Intenta de nuevo.', 'error')}>
      {children}
    </ErrorBoundary>
  );
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
        <Main>
          <StatusBanner />
          {!store.ready ? (
            <div className="empty" style={{ paddingTop: 80 }}>
              {store.status === 'syncing' || store.status === 'idle' ? (
                'Cargando tus datos…'
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
            <Screens>
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
                  <Route path="/retos" element={<Retos />} />
                  <Route path="/records" element={<Records />} />
                  <Route path="/conectar-ia" element={<ConectarIA />} />
                  {/* [[voz]] */}

                  {/* [[entreno]] */}
                  <Route path="/entreno" element={<Entreno />} />

                  {/* [[gente]] */}
                  <Route path="/npcs/:id" element={<Persona />} />

                  {/* [[mapa]] */}

                  {/* [[habilidades]] */}
                  <Route path="/tiempo" element={<Tiempo />} />

                  {/* [[aprendizaje]] */}
                  <Route path="/aprendizaje" element={<Aprendizaje />} />

                  {/* [[salud]] */}
                  <Route path="/salud" element={<Salud />} />

                  {/* [[habitos]] */}
                  <Route path="/habitos" element={<Habitos />} />
                  <Route path="/ciudad" element={<Ciudad />} />
                  <Route path="/dia" element={<Dia />} />

                  <Route path="*" element={<Hoy />} />
                </Routes>
              </Suspense>
            </Screens>
          )}
        </Main>
      </div>
      <Guard>
        <Fx />
      </Guard>
      <Toasts />
      <Guard>
        <SyncPill />
      </Guard>
      {store.ready && (
        <Guard>
          <QuestMode />
        </Guard>
      )}
      {store.ready && (
        <Guard>
          <QuickAdd />
        </Guard>
      )}
      <Guard>
        <ActionDock />
      </Guard>
      {store.ready && (
        <Guard>
          <PlanSheet />
        </Guard>
      )}
      {store.ready && (
        <Guard>
          <DayDeckHost />
        </Guard>
      )}
      {store.ready && (
        <Guard>
          <DayResultHost />
        </Guard>
      )}
      {store.ready && (
        <Guard>
          <TabTitle />
          <RecordWatcher />
          <NotificationsSync />
          <SkinSync />
          <AiSnapshotSync />
        </Guard>
      )}
      {/* [[voz]] */}
      {store.ready && (
        <Guard>
          <Hablar />
        </Guard>
      )}

      {/* [[entreno]] */}
      {store.ready && (
        <Guard>
          <Suspense fallback={null}>
            <WorkoutSheetHost />
          </Suspense>
        </Guard>
      )}

      {/* [[gente]] */}
      {store.ready && (
        <Guard>
          <PeopleWatcher />
        </Guard>
      )}

      {/* [[mapa]] */}

      {/* [[habilidades]] */}
      {store.ready && (
        <Guard>
          <Suspense fallback={null}>
            <TimerPill />
          </Suspense>
        </Guard>
      )}

      {/* [[aprendizaje]] */}

      {/* [[salud]] */}
      {store.ready && (
        <Guard>
          <DoctorAutoReview />
        </Guard>
      )}

      {/* [[habitos]] */}

    </BrowserRouter>
  );
}
