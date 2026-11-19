import { addDays, isInRoutine, weekday, zonedTimeToUtc, type Entity, type GameState, type MissionData, type TodoData } from '@igv/core';
import { api, type PushPlanItem } from '../data/api';
import { getPrefs, setPrefs, type Prefs } from './prefs';
import { TZ } from './time';

/**
 * Las notificaciones están apagadas por decisión del usuario (no hay cron en el Worker).
 * Solo se activan si él lo pide: poner `true` aquí y el cron en apps/api/wrangler.jsonc.
 */
export const PUSH_AVAILABLE = false;

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** iOS solo permite notificaciones con la app instalada en la pantalla de inicio. */
export function needsInstall(): boolean {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

function keyToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error('Este navegador no soporta notificaciones push.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('No diste permiso de notificaciones.');
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api.pushKey();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) });
  await api.pushSubscribe(sub.toJSON());
  setPrefs({ notify: { ...getPrefs().notify, enabled: true } });
}

export async function disablePush(): Promise<void> {
  setPrefs({ notify: { ...getPrefs().notify, enabled: false } });
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api.pushUnsubscribe(sub.endpoint).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}

/**
 * Plan de recordatorios de los próximos 3 días, calculado en el dispositivo con el estado del juego.
 * Se vuelve a subir tras cada cambio, así que lo de hoy siempre refleja lo que ya hiciste.
 */
export function buildPlan(state: GameState, entities: Entity[], prefs: Prefs['notify'], now = new Date()): PushPlanItem[] {
  const items: PushPlanItem[] = [];
  const nowIso = now.toISOString();
  const dailies = entities.filter((e) => e.module === 'missions' && e.kind === 'daily') as Entity<MissionData>[];
  const todos = (entities.filter((e) => e.module === 'planner' && e.kind === 'todo') as Entity<TodoData>[]).filter((t) => !state.missions.completions[t.id]);
  const add = (id: string, date: string, time: string, title: string, body: string, url = '/') => {
    const at = zonedTimeToUtc(date, time, TZ);
    if (at > nowIso) items.push({ id: `${id}-${date}-${time}`, at, title, body, url });
  };
  for (let i = 0; i < 3; i++) {
    const d = addDays(state.today, i);
    const isToday = i === 0;
    const routine = dailies.filter((m) => isInRoutine(m.data, weekday(d))).length;
    const planned = todos.filter((t) => t.data.date <= d).length;
    // Mañana: check-in + rutina + agenda
    if (!(isToday && state.energy.value !== null)) {
      const extra = [routine ? `${routine} diarias en tu rutina` : '', planned ? `${planned} pendiente(s) en la agenda` : ''].filter(Boolean).join(' · ');
      add('morning', d, prefs.morning, 'Buenos días ⚔️', `Haz tu check-in de energía.${extra ? ` Hoy: ${extra}.` : ''}`);
    }
    // Noche: racha en riesgo (hoy solo si aún no hay misiones ni descanso)
    if (!(isToday && (state.streak.todayActive || state.streak.todayRest))) {
      const n = state.streak.current;
      const title = isToday && n > 0 ? `🔥 Tu racha de ${n} días está en riesgo` : '🔥 ¿Ya cuidaste tu racha hoy?';
      add('streak', d, prefs.evening, title, 'Completa una misión chica (o marca descanso) antes de dormir.');
    }
    if (prefs.npcs && state.npcs.generatedMissions.length && i < 2) {
      const names = state.npcs.generatedMissions.map((m) => m.title.replace('Escribirle a ', '')).slice(0, 3).join(', ');
      add('npc', d, '13:00', 'Tu party te extraña', `Hace mucho no hablas con ${names}. Un mensaje cuenta como misión.`);
    }
    if (prefs.weekly && weekday(d) === 6) add('weekly', d, '19:00', '📜 Cierre de semana', 'Escribe tu diario de 3 líneas y mira tu reporte de batalla.', '/reporte');
  }
  return items.sort((a, b) => (a.at < b.at ? -1 : 1)).slice(0, 40);
}

let timer: ReturnType<typeof setTimeout> | null = null;
let lastSent = '';
/** Sube el plan (con retraso para agrupar cambios). Solo si las notificaciones están activas en este dispositivo. */
export function schedulePlanUpload(state: GameState, entities: Entity[]) {
  const prefs = getPrefs().notify;
  if (!PUSH_AVAILABLE || !prefs.enabled) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const plan = buildPlan(state, entities, prefs);
    const key = JSON.stringify(plan);
    if (key === lastSent) return;
    api
      .pushPlan(plan)
      .then(() => {
        lastSent = key;
      })
      .catch(() => {});
  }, 3000);
}
