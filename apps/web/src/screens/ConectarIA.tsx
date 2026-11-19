import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { describeAssistantTools, type ToolGroup } from '@igv/core';
import { api, type AiAccess, type AiActivityItem, type AiStatus } from '../data/api';
import { sync } from '../data/store';
import { Icon } from '../ui/icons';
import { Badge, Collapse, Empty, PageHeader, Tabs, confirmAction, toast } from '../ui/kit';

type Client = 'claude' | 'claude-code' | 'codex' | 'antigravity' | 'otros';

const KEY_PLACEHOLDER = 'TU_LLAVE';

function copy(text: string, what = 'Copiado') {
  navigator.clipboard
    ?.writeText(text)
    .then(() => toast(what))
    .catch(() => toast('No pude copiar; selecciónalo y cópialo a mano', 'error'));
}

function ago(ms: number | null): string {
  if (!ms) return 'nunca';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}

function Code({ text, label }: { text: string; label?: string }) {
  return (
    <div className="code-block">
      <pre>{text}</pre>
      <button className="btn sm ghost" onClick={() => copy(text, label ?? 'Copiado')}>
        Copiar
      </button>
    </div>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="steps">{children}</ol>;
}

/** Instrucciones para cada asistente, con la URL (y la llave recién creada, si hay) ya puestas. */
function HowTo({ client, url, token }: { client: Client; url: string; token: string | null }) {
  const key = token ?? KEY_PLACEHOLDER;
  const needKey = !token && (
    <p className="tiny muted">
      Crea una llave abajo en <b>Llaves de acceso</b>: aparecerá aquí ya puesta.
    </p>
  );
  switch (client) {
    case 'claude':
      return (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>
            Funciona en claude.ai, la app de escritorio y la del celular (se configura una vez y aparece en todas).
          </p>
          <Steps>
            <li>
              En Claude abre <b>Configuración → Conectores</b> y toca <b>Agregar conector personalizado</b>.
            </li>
            <li>
              Nombre: <b>IGV EXPERIENCE</b>. URL del servidor:
              <Code text={url} label="URL copiada" />
            </li>
            <li>
              Toca <b>Conectar</b>. Se abre esta app: si te pide el código de Cloudflare, es el que llega a tu correo. Revisa que diga “Claude” y toca <b>Permitir</b>.
            </li>
            <li>En un chat, activa IGV EXPERIENCE en el menú de herramientas y pídele “¿cómo voy hoy?” o “registra que fui al gym”.</li>
          </Steps>
          <p className="tiny muted">En planes de equipo, solo el dueño de la organización puede agregar conectores personalizados.</p>
        </>
      );
    case 'claude-code':
      return (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>
            Con inicio de sesión (recomendado): agrega el servidor y luego, dentro de Claude Code, escribe <code>/mcp</code> → igv → <b>Authenticate</b>.
          </p>
          <Code text={`claude mcp add --transport http --scope user igv ${url}`} />
          <p className="small muted">O con una llave (sin abrir el navegador):</p>
          <Code text={`claude mcp add --transport http --scope user igv ${url} --header "Authorization: Bearer ${key}"`} />
          {needKey}
        </>
      );
    case 'codex':
      return (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>
            Con inicio de sesión: agrega el servidor y luego inicia sesión (se abre esta app para que toques <b>Permitir</b>).
          </p>
          <Code text={`codex mcp add igv --url ${url}\ncodex mcp login igv`} />
          <p className="small muted">
            O con una llave: en <code>~/.codex/config.toml</code> agrega
          </p>
          <Code text={`[mcp_servers.igv]\nurl = "${url}"\nbearer_token_env_var = "IGV_MCP_TOKEN"`} />
          <p className="small muted">y en tu terminal (o en tu perfil de shell):</p>
          <Code text={`export IGV_MCP_TOKEN="${key}"`} />
          {needKey}
        </>
      );
    case 'antigravity':
      return (
        <>
          <Steps>
            <li>
              En el panel del agente, toca <b>⋯ → MCP Servers → Manage MCP Servers → View raw config</b>.
            </li>
            <li>
              Agrega <b>igv</b> dentro de <code>mcpServers</code> y guarda:
              <Code text={JSON.stringify({ mcpServers: { igv: { serverUrl: url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)} />
            </li>
            <li>Recarga los servidores y pídele al agente “usa igv para ver mi panorama”.</li>
          </Steps>
          {needKey}
        </>
      );
    case 'otros':
      return (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>
            Cualquier asistente compatible con MCP por HTTP (ChatGPT en modo desarrollador, Cursor, Windsurf, VS Code…):
          </p>
          <ul className="steps">
            <li>
              URL: <Code text={url} label="URL copiada" />
            </li>
            <li>
              Autenticación: <b>OAuth</b> (se registra solo y te pide <b>Permitir</b> en esta app) o el encabezado <code>Authorization: Bearer {key}</code>.
            </li>
          </ul>
          {needKey}
        </>
      );
  }
}

const GROUPS: { id: ToolGroup; title: string }[] = [
  { id: 'consultar', title: 'Consultar' },
  { id: 'registrar', title: 'Registrar por ti' },
  { id: 'organizar', title: 'Organizar tu catálogo' },
];

export default function ConectarIA() {
  const [st, setSt] = useState<AiStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [client, setClient] = useState<Client>('claude');
  const [newKey, setNewKey] = useState<{ id: string; name: string; token: string } | null>(null);
  const [keyName, setKeyName] = useState('');
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<AiActivityItem[] | null>(null);

  const reload = useCallback(() => {
    api
      .aiStatus()
      .then((s) => {
        setSt(s);
        setErr(null);
      })
      .catch((e: Error) => setErr(e.message));
    api
      .aiActivity()
      .then((r) => setActivity(r.items))
      .catch(() => setActivity([]));
  }, []);
  useEffect(reload, [reload]);

  const setWrites = async (allowWrites: boolean) => {
    if (!st) return;
    setSt({ ...st, allowWrites });
    try {
      await api.aiSettings(allowWrites);
      toast(allowWrites ? 'La IA puede registrar por ti' : 'La IA solo puede consultar');
    } catch (e) {
      setSt({ ...st });
      toast(e instanceof Error ? e.message : 'Error', 'error');
    }
  };

  const createKey = async () => {
    const name = keyName.trim() || (client === 'codex' ? 'Codex' : client === 'antigravity' ? 'Antigravity' : client === 'claude-code' ? 'Claude Code' : 'Mi asistente');
    setBusy(true);
    try {
      const r = await api.aiCreateKey(name);
      setNewKey({ id: r.key.id, name, token: r.token });
      setKeyName('');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error', 'error');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (a: AiAccess, kind: 'key' | 'connection') => {
    if (!confirmAction(kind === 'key' ? `¿Revocar la llave "${a.name}"? Lo que la use deja de funcionar al instante.` : `¿Desconectar "${a.name}"? Tendrás que volver a conectarla para usarla.`)) return;
    try {
      if (kind === 'key') await api.aiRevokeKey(a.id);
      else await api.aiRevokeConnection(a.id);
      if (newKey?.id === a.id) setNewKey(null);
      toast(kind === 'key' ? 'Llave revocada' : 'Desconectada');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error', 'error');
    }
  };

  const undo = async (item: AiActivityItem) => {
    try {
      await api.aiUndo(item.id);
      await sync();
      toast('Deshecho');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error', 'error');
    }
  };

  const tools = describeAssistantTools();
  const url = st?.mcpUrl ?? null;

  return (
    <>
      <PageHeader title="Conectar IA" eyebrow="MCP · tu app en tu chat" />
      {err && (
        <div className="card">
          <p className="small red" style={{ margin: 0 }}>
            No pude cargar la configuración: {err}
          </p>
        </div>
      )}

      <div className="card">
        <h2>Tu app dentro de tu asistente de IA</h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          Conecta Claude, ChatGPT, Codex o Antigravity para que vean tu progreso y registren cosas por ti desde el chat: “marca que entrené”, “anota un gasto de $350 en comida”, “agéndame llamar al contador el viernes”, “¿cómo voy esta semana?”.
        </p>
        {url ? (
          <>
            <div className="tiny muted" style={{ marginBottom: 4 }}>
              URL del servidor MCP
            </div>
            <Code text={url} label="URL copiada" />
          </>
        ) : st ? (
          <p className="small muted">
            No pude deducir la URL del servidor MCP (¿usas un dominio propio?). Define la variable <code>MCP_URL</code> en la app y <code>APP_URL</code> en el Worker <code>igv-experience-mcp</code>.
          </p>
        ) : (
          <p className="small muted">Cargando…</p>
        )}
      </div>

      {url && (
        <div className="card">
          <h2>Cómo conectar</h2>
          <Tabs
            value={client}
            onChange={setClient}
            options={[
              { value: 'claude', label: 'Claude' },
              { value: 'claude-code', label: 'Claude Code' },
              { value: 'codex', label: 'Codex' },
              { value: 'antigravity', label: 'Antigravity' },
              { value: 'otros', label: 'Otros' },
            ]}
          />
          <HowTo client={client} url={url} token={newKey?.token ?? null} />
        </div>
      )}

      {st && (
        <div className="card">
          <h2>Permisos</h2>
          <label className="checkbox" style={{ marginBottom: 0, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={st.allowWrites} onChange={(e) => setWrites(e.target.checked)} />
            <span>
              La IA puede registrar y organizar por mí
              <span className="tiny muted" style={{ display: 'block' }}>
                {st.allowWrites ? 'Todo lo que haga queda abajo en Actividad, con “Deshacer”.' : 'Solo lectura: puede consultar tu progreso pero no cambiar nada.'}
              </span>
            </span>
          </label>
        </div>
      )}

      {st && (
        <div className="card">
          <div className="card-head">
            <h2>Llaves de acceso</h2>
            <Badge>{st.keys.length}</Badge>
          </div>
          <p className="small muted" style={{ marginTop: 0 }}>
            Para Codex, Antigravity o Claude Code sin iniciar sesión. Una llave por asistente; si una se filtra, revócala.
          </p>
          {newKey && (
            <div className="secret-box">
              <div className="small">
                <b>Llave “{newKey.name}”.</b> Cópiala ahora: por seguridad no se vuelve a mostrar.
              </div>
              <Code text={newKey.token} label="Llave copiada" />
            </div>
          )}
          {st.keys.map((k) => (
            <div key={k.id} className="item">
              <Icon name="lock" width={18} />
              <div className="grow">
                <div className="item-title">{k.name}</div>
                <div className="tiny muted">
                  Creada {ago(k.createdAt)} · último uso {ago(k.lastUsedAt)}
                </div>
              </div>
              <button className="btn sm ghost" onClick={() => revoke(k, 'key')}>
                Revocar
              </button>
            </div>
          ))}
          <div className="row" style={{ marginTop: 10 }}>
            <input className="input" placeholder="Nombre (p. ej. Codex en mi laptop)" value={keyName} maxLength={60} onChange={(e) => setKeyName(e.target.value)} />
            <button className="btn primary" disabled={busy} onClick={createKey}>
              <Icon name="plus" /> Crear
            </button>
          </div>
        </div>
      )}

      {st && (
        <div className="card">
          <div className="card-head">
            <h2>Apps conectadas</h2>
            <Badge>{st.connections.length}</Badge>
          </div>
          {st.connections.length === 0 && <p className="small muted" style={{ margin: 0 }}>Aún no conectas ninguna con inicio de sesión (Claude, ChatGPT, Codex…).</p>}
          {st.connections.map((cn) => (
            <div key={cn.id} className="item">
              <Icon name="link" width={18} />
              <div className="grow">
                <div className="item-title">{cn.name}</div>
                <div className="tiny muted">
                  Conectada {ago(cn.createdAt)} · último uso {ago(cn.lastUsedAt)}
                </div>
              </div>
              <button className="btn sm ghost" onClick={() => revoke(cn, 'connection')}>
                Desconectar
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>Actividad de la IA</h2>
          <button className="btn sm ghost" onClick={reload} aria-label="Actualizar">
            <Icon name="refresh" width={16} />
          </button>
        </div>
        {activity === null ? (
          <p className="small muted" style={{ margin: 0 }}>Cargando…</p>
        ) : activity.length === 0 ? (
          <Empty>Cuando una IA (o el Coach) registre algo por ti, aparecerá aquí.</Empty>
        ) : (
          activity.map((a) => (
            <div key={a.id} className={`item ${a.undoneAt ? 'done' : ''}`}>
              <div className="grow">
                <div className="item-title small">{a.summary}</div>
                <div className="tiny muted">
                  {a.source} · {ago(a.at)}
                  {a.undoneAt ? ' · deshecho' : ''}
                </div>
              </div>
              {a.undoable && (
                <button className="btn sm ghost" onClick={() => undo(a)}>
                  Deshacer
                </button>
              )}
            </div>
          ))
        )}
      </div>

      <Collapse title={`Qué puede hacer (${tools.length} funciones)`}>
        {GROUPS.map((g) => (
          <div key={g.id}>
            <div className="section-title" style={{ marginTop: 6 }}>
              {g.title}
            </div>
            {tools
              .filter((t) => t.group === g.id)
              .map((t) => (
                <div key={t.name} className="item" style={{ alignItems: 'flex-start' }}>
                  <div className="grow">
                    <div className="item-title small">
                      {t.title} <code className="tiny muted">{t.name}</code>
                    </div>
                    <div className="tiny muted">{t.description}</div>
                  </div>
                </div>
              ))}
          </div>
        ))}
      </Collapse>

      <p className="tiny muted" style={{ textAlign: 'center' }}>
        ¿Prefieres hablar con la IA aquí mismo? Usa el <Link to="/game-master">Coach</Link>: ahora también registra por ti.
      </p>
    </>
  );
}
