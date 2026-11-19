import { useEffect, useRef, useState } from 'react';
import { EVENT_LABELS, GAME_CONFIG, MISSION_SIZE_NAMES, type EventType } from '@igv/core';
import { api } from '../data/api';
import { resetAndResync, restoreEvent, sync, useGame, useStore, voidEvent } from '../data/store';
import { updateSettings } from '../lib/actions';
import { fmtDate } from '../lib/time';
import { getTheme, setTheme, type Theme } from '../lib/theme';
import { Field, PageHeader, Tabs, confirmAction, toast } from '../ui/kit';
import { getPrefs, setPrefs, type Prefs } from '../lib/prefs';
import { sfx } from '../lib/sound';
import { PUSH_AVAILABLE, disablePush, enablePush, needsInstall, pushSupported, schedulePlanUpload } from '../lib/notifications';
import { describeEvent } from '../ui/DaySheet';
import { Icon } from '../ui/icons';

export default function Ajustes() {
  return (
    <>
      <PageHeader title="Ajustes" />
      <Profile />
      <Rewards />
      <ThemeCard />
      <FeelCard />
      {PUSH_AVAILABLE && <NotifyCard />}
      <BackupCard />
      <EventLog />
      <ConfigCard />
      <SessionCard />
    </>
  );
}

function Profile() {
  const { state } = useGame();
  const s = state.settings;
  const [d, setD] = useState({ name: s.name, className: s.className, birthDate: s.birthDate ?? '', monthlyGoal: String(s.monthlyGoal) });
  useEffect(() => {
    setD({ name: s.name, className: s.className, birthDate: s.birthDate ?? '', monthlyGoal: String(s.monthlyGoal) });
  }, [s.name, s.className, s.birthDate, s.monthlyGoal]);
  const dirty = d.name !== s.name || d.className !== s.className || d.birthDate !== (s.birthDate ?? '') || Number(d.monthlyGoal) !== s.monthlyGoal;
  return (
    <div className="card">
      <h2>Perfil</h2>
      <Field label="Nombre">
        <input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
      </Field>
      <Field label="A qué te dedicas">
        <input className="input" value={d.className} onChange={(e) => setD({ ...d, className: e.target.value })} />
      </Field>
      <div className="grid2">
        <Field label="Fecha de nacimiento">
          <input className="input" type="date" max={state.today} value={d.birthDate} onChange={(e) => setD({ ...d, birthDate: e.target.value })} />
        </Field>
        <Field label={`Meta mensual (${s.currency})`}>
          <input className="input" type="number" value={d.monthlyGoal} onChange={(e) => setD({ ...d, monthlyGoal: e.target.value })} />
        </Field>
      </div>
      <button
        className="btn primary"
        disabled={!dirty || !d.name.trim() || !(Number(d.monthlyGoal) > 0)}
        onClick={() => {
          updateSettings(s, { name: d.name.trim(), className: d.className.trim(), birthDate: d.birthDate || null, monthlyGoal: Number(d.monthlyGoal) });
          toast('Guardado');
        }}
      >
        Guardar
      </button>
    </div>
  );
}

function Rewards() {
  const { state } = useGame();
  const s = state.settings;
  const levels = [5, 10, 15, 20, 25, 30];
  const [r, setR] = useState<Record<string, string>>(s.levelRewards ?? {});
  useEffect(() => {
    setR(s.levelRewards ?? {});
  }, [s.levelRewards]);
  return (
    <div className="card">
      <h2>Premios reales por nivel</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        Cada {GAME_CONFIG.rewardEveryLevels} niveles te das un premio real. Se muestra en Hoy y al subir de nivel.
      </p>
      {levels.map((l) => {
        const t = GAME_CONFIG.titles.find((x) => x.level === l);
        return (
          <Field key={l} label={`Nivel ${l}${t ? ` · ${t.title}` : ''}${state.level.level >= l ? ' ✓' : ''}`}>
            <input className="input" value={r[String(l)] ?? ''} placeholder="Define tu premio" onChange={(e) => setR({ ...r, [String(l)]: e.target.value })} />
          </Field>
        );
      })}
      <button
        className="btn primary"
        onClick={() => {
          const clean = Object.fromEntries(Object.entries(r).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
          updateSettings(s, { levelRewards: clean });
          toast('Premios guardados');
        }}
      >
        Guardar premios
      </button>
    </div>
  );
}

function FeelCard() {
  const [p, setP] = useState(getPrefs());
  const up = (patch: Partial<Prefs>) => setP(setPrefs(patch));
  return (
    <div className="card">
      <h2>Sonido y vibración</h2>
      <label className="checkbox">
        <input type="checkbox" checked={p.sound} onChange={(e) => (up({ sound: e.target.checked }), e.target.checked && sfx.xp(30))} />
        Sonidos al ganar XP y subir de nivel
      </label>
      <label className="checkbox" style={{ marginBottom: 0 }}>
        <input type="checkbox" checked={p.haptics} onChange={(e) => up({ haptics: e.target.checked })} />
        Vibración (en celulares que la soportan)
      </label>
    </div>
  );
}

function NotifyCard() {
  const { state, entities } = useGame();
  const [p, setP] = useState(getPrefs());
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<number | null>(null);
  const n = p.notify;
  useEffect(() => {
    if (n.enabled) api.pushStatus().then((s) => setDevices(s.devices)).catch(() => {});
  }, [n.enabled]);
  const upNotify = (patch: Partial<Prefs['notify']>) => {
    const next = setPrefs({ notify: { ...getPrefs().notify, ...patch } });
    setP(next);
    schedulePlanUpload(state, entities);
  };
  if (!pushSupported())
    return (
      <div className="card">
        <h2>Notificaciones</h2>
        <p className="small muted">Este navegador no soporta notificaciones push.</p>
      </div>
    );
  return (
    <div className="card">
      <h2>Notificaciones</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        Recordatorio del check-in en la mañana, aviso de racha en riesgo en la noche, personas olvidadas y cierre de semana. Se calculan con tu progreso y se envían desde tu Worker (cada 15 min).
      </p>
      {needsInstall() && (
        <div className="banner warn">
          <Icon name="download" width={18} /> En iPhone primero instala la app: Compartir → “Agregar a inicio”, y actívalas desde ahí.
        </div>
      )}
      {n.enabled ? (
        <>
          <div className="grid2">
            <Field label="Mañana (check-in)">
              <input className="input" type="time" value={n.morning} onChange={(e) => upNotify({ morning: e.target.value })} />
            </Field>
            <Field label="Noche (racha en riesgo)">
              <input className="input" type="time" value={n.evening} onChange={(e) => upNotify({ evening: e.target.value })} />
            </Field>
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={n.npcs} onChange={(e) => upNotify({ npcs: e.target.checked })} />
            Personas clave sin contacto
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={n.weekly} onChange={(e) => upNotify({ weekly: e.target.checked })} />
            Cierre de semana (domingo 7 pm)
          </label>
          <div className="row wrap" style={{ gap: 6 }}>
            <button
              className="btn sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await api.pushTest();
                  toast(r.sent ? 'Notificación de prueba enviada' : 'No se pudo entregar: vuelve a activarlas', r.sent ? 'info' : 'error');
                } catch (e) {
                  toast(e instanceof Error ? e.message : 'Error', 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="bolt" /> Probar
            </button>
            <button
              className="btn sm ghost danger"
              onClick={async () => {
                await disablePush();
                setP(getPrefs());
                toast('Notificaciones desactivadas en este dispositivo');
              }}
            >
              Desactivar
            </button>
            {devices !== null && <span className="tiny muted">{devices} dispositivo(s) activo(s)</span>}
          </div>
        </>
      ) : (
        <button
          className="btn primary block"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await enablePush();
              setP(getPrefs());
              schedulePlanUpload(state, entities);
              toast('Notificaciones activadas');
            } catch (e) {
              toast(e instanceof Error ? e.message : 'No se pudieron activar', 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          <Icon name="bolt" /> Activar notificaciones
        </button>
      )}
    </div>
  );
}

function ThemeCard() {
  const [t, setT] = useState<Theme>(getTheme());
  return (
    <div className="card">
      <h2>Apariencia</h2>
      <Tabs
        value={t}
        onChange={(v) => {
          setT(v);
          setTheme(v);
        }}
        options={[
          { value: 'system', label: 'Automático' },
          { value: 'dark', label: 'Oscuro' },
          { value: 'light', label: 'Claro' },
        ]}
      />
    </div>
  );
}

function BackupCard() {
  const file = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'replace' | 'merge'>('merge');
  const [busy, setBusy] = useState(false);
  const onFile = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      if (data?.app !== 'igv-experience') throw new Error('No es un respaldo de IGV EXPERIENCE');
      const msg =
        mode === 'replace'
          ? `Esto BORRA todo lo actual y lo reemplaza con el respaldo (${data.events?.length ?? 0} eventos). Antes se descargará un respaldo de lo actual. ¿Continuar?`
          : `Se agregarán/actualizarán ${data.events?.length ?? 0} eventos y ${data.entities?.length ?? 0} elementos. ¿Continuar?`;
      if (!confirmAction(msg)) return;
      setBusy(true);
      if (mode === 'replace') window.open(api.backupUrl, '_blank');
      await sync();
      const res = await api.importBackup(data, mode);
      await resetAndResync();
      toast(`Respaldo importado: ${res.events} eventos, ${res.entities} elementos`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo importar', 'error');
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };
  return (
    <div className="card">
      <h2>Respaldo</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        Un archivo JSON con todos tus eventos y tu catálogo. Guárdalo de vez en cuando en un lugar seguro.
      </p>
      <a className="btn block" href={api.backupUrl} download>
        <Icon name="download" /> Exportar respaldo
      </a>
      <hr className="sep" />
      <Tabs
        value={mode}
        onChange={setMode}
        options={[
          { value: 'merge', label: 'Combinar' },
          { value: 'replace', label: 'Reemplazar todo' },
        ]}
      />
      <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <button className="btn block" disabled={busy} onClick={() => file.current?.click()}>
        <Icon name="upload" /> {busy ? 'Importando…' : 'Importar respaldo'}
      </button>
    </div>
  );
}

function EventLog() {
  const { events, state } = useGame();
  const [n, setN] = useState(20);
  const [showVoided, setShowVoided] = useState(false);
  const list = events
    .filter((e) => showVoided || !e.voidedAt)
    .sort((a, b) => (a.createdAt ?? 0) < (b.createdAt ?? 0) ? 1 : -1)
    .slice(0, n);
  const describe = (e: (typeof events)[number]) => describeEvent(e, state.settings.currency);
  return (
    <div className="card">
      <div className="card-head">
        <h2>Bitácora de eventos</h2>
        <label className="checkbox" style={{ margin: 0 }}>
          <input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} /> <span className="small">Anulados</span>
        </label>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Todo lo que haces es un evento. Si registraste algo por error, anúlalo: no se borra, solo deja de contar y todo se recalcula.
      </p>
      {list.map((e) => (
        <div key={e.id} className="item" style={e.voidedAt ? { opacity: 0.5 } : undefined}>
          <div className="grow">
            <div className="small" style={{ fontWeight: 650, textDecoration: e.voidedAt ? 'line-through' : undefined }}>
              {EVENT_LABELS[e.type as EventType] ?? e.type}
            </div>
            <div className="tiny muted ellipsis">
              {fmtDate(e.localDate, true)} {describe(e) && `· ${describe(e)}`}
            </div>
          </div>
          {e.voidedAt ? (
            <button className="btn sm ghost" onClick={() => restoreEvent(e.id)}>
              Restaurar
            </button>
          ) : (
            <button className="btn sm ghost danger" onClick={() => confirmAction('¿Anular este evento? Dejará de contar.') && voidEvent(e.id)}>
              Anular
            </button>
          )}
        </div>
      ))}
      {events.length > n && (
        <button className="btn sm ghost block" onClick={() => setN((x) => x + 40)}>
          Ver más
        </button>
      )}
    </div>
  );
}

function ConfigCard() {
  const c = GAME_CONFIG;
  return (
    <div className="card">
      <h2>Números del juego</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        Viven en <code>packages/core/src/config/game.ts</code>. Si cambias uno, todo tu historial se recalcula.
      </p>
      <table className="table">
        <tbody>
          <tr><td>Misiones</td><td className="r">chica {c.missionXp.chica} · media {c.missionXp.media} · grande {c.missionXp.grande} · épica {c.missionXp.epica}</td></tr>
          <tr><td>Racha</td><td className="r">+{c.streak.perDay}/día, máx. +{c.streak.maxPerDay}</td></tr>
          <tr><td>Descansos</td><td className="r">{c.streak.restDaysPerWeek} por semana</td></tr>
          <tr><td>Logro / Rango / Fase de reto</td><td className="r">{c.rewards.achievement} / {c.rewards.skillRank} / {c.rewards.bossPhase}</td></tr>
          <tr><td>Reto recurrente / Mapa / Lección</td><td className="r">{c.rewards.recurringBoss} / {c.rewards.discovery} / {c.rewards.lesson}</td></tr>
          <tr><td>Nivel n → n+1</td><td className="r">{c.levels.factor} × n XP</td></tr>
          <tr><td>Energía</td><td className="r">≥7 h 100 · ≥6 h 75 · menos 50</td></tr>
          <tr><td>Oro</td><td className="r">1 por cada {c.gold.xpPerGold} XP</td></tr>
          <tr><td>Misión sorpresa</td><td className="r">+{c.bounty.bonusPercent}% de bono</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function SessionCard() {
  const store = useStore();
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    api.me().then((r) => setEmail(r.email)).catch(() => {});
  }, []);
  return (
    <div className="card">
      <h2>Sesión y sincronización</h2>
      <div className="small muted">
        {email ? `Conectado como ${email}` : 'Comprobando sesión…'}
        <br />
        {store.lastSync ? `Última sincronización: ${new Date(store.lastSync).toLocaleTimeString('es-MX')}` : 'Aún sin sincronizar'}
        {store.pendingCount > 0 && ` · ${store.pendingCount} cambio(s) por subir`}
      </div>
      <button className="btn sm" style={{ marginTop: 10 }} onClick={() => sync()}>
        <Icon name="refresh" /> Sincronizar ahora
      </button>
    </div>
  );
}
