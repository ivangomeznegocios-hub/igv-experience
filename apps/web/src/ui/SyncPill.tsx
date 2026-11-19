import { sync, useStore } from '../data/store';
import { Icon } from './icons';

/** Indicador permanente de sincronización: verde = al día; naranja = cambios por subir. */
export function SyncPill({ inline = false }: { inline?: boolean }) {
  const store = useStore();
  if (!store.ready) return null;
  const pending = store.pendingCount;
  const syncing = store.status === 'syncing';
  const offline = store.status === 'offline' || store.status === 'error';
  const cls = offline || store.status === 'auth' ? 'warn' : pending ? 'warn' : 'ok';
  // Flotante solo cuando hay algo que avisar; en Hoy se muestra siempre (en línea).
  if (!inline && cls === 'ok') return null;
  const text = store.status === 'auth' ? 'Sesión' : offline ? `Sin conexión${pending ? ` · ${pending}` : ''}` : pending ? `${pending} por subir` : syncing ? 'Sincronizando' : 'Al día';
  return (
    <button className={`sync-pill ${inline ? 'inline' : ''} ${cls} ${syncing ? 'spin' : ''}`} onClick={() => sync()} title={store.lastSync ? `Última sincronización: ${new Date(store.lastSync).toLocaleTimeString('es-MX')}` : 'Sin sincronizar'}>
      <Icon name={offline ? 'lock' : 'refresh'} />
      {text}
    </button>
  );
}
