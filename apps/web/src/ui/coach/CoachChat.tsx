import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type CoachAction } from '../../data/api';
import { sync, useGame } from '../../data/store';
import { uploadSnapshotNow } from '../../lib/aiSnapshot';
import { flushActiveDictation } from '../../lib/voice';
import { useCoachAvailability } from '../../lib/voz';
import { Icon } from '../icons';
import { TextInput, toast } from '../kit';
import { CoachActionList } from '../Proposals';
import { CoachFace } from './CoachFace';

type Msg = { role: 'user' | 'assistant'; content: string; actions?: (CoachAction & { undone?: boolean })[]; sources?: { title: string; url: string }[] };

export const COACH_CHAT_SUGGESTIONS = [
  '¿Qué hago hoy?',
  'Hoy hice 3 series de 12 sentadillas con 16 kg y 3 de 10 lagartijas',
  '¿Qué ceno para llegar a mi proteína?',
  '¿Cómo voy esta semana?',
  '¿Es mejor mancuerna o barra para pecho?',
];

/** Fuentes que citó la búsqueda web: solo enlaces http(s), sin repetir y con un título corto. */
export function safeSources(list?: { title: string; url: string }[]) {
  const out: { title: string; url: string }[] = [];
  for (const s of list ?? []) {
    if (!/^https?:\/\//i.test(s.url) || out.some((o) => o.url === s.url)) continue;
    const title = (s.title || s.url).trim();
    out.push({ url: s.url, title: title.length > 60 ? `${title.slice(0, 57)}…` : title });
  }
  return out.slice(0, 6);
}

/**
 * Conversación con tu entrenador (Coach con IA en modo entrenador): sabe tu plan, registra lo que le cuentas
 * (entrenos, comidas, pasos, check-in) con "Deshacer" y puede investigar en la web cuando hace falta.
 */
export function CoachChat({ coachName, initial, suggestions = COACH_CHAT_SUGGESTIONS }: { coachName: string; initial?: string; suggestions?: string[] }) {
  const { state, entities } = useGame();
  const status = useCoachAvailability();
  const enabled = status === true;
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (msgs.length) end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [msgs, busy]);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setErr(null);
    const history = msgs.slice(-10).map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: 'user', content: question }]);
    setQ('');
    setBusy(true);
    try {
      await uploadSnapshotNow(state, entities);
      const res = await api.gmAsk({ question, history, mode: 'entrenador' });
      setMsgs((m) => [...m, { role: 'assistant', content: res.answer, actions: res.actions, sources: safeSources(res.sources) }]);
      if (res.actions?.length) await sync();
    } catch (e) {
      const done = e instanceof ApiError ? (e.body as { actions?: CoachAction[] } | undefined)?.actions : undefined;
      if (done?.length) {
        setMsgs((m) => [...m, { role: 'assistant', content: e instanceof Error ? e.message : 'Error', actions: done }]);
        await sync();
      } else setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (initial && enabled && !asked.current) {
      asked.current = true;
      void ask(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, enabled]);

  const undo = async (i: number, a: CoachAction) => {
    try {
      const r = await api.aiUndo(a.activityId);
      await sync();
      setMsgs((m) => m.map((x, j) => (j === i ? { ...x, actions: x.actions?.map((y) => (y.activityId === a.activityId ? { ...y, undone: true } : y)) } : x)));
      toast(r.kept ? 'Deshecho (respeté lo que cambiaste después)' : 'Deshecho');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error', 'error');
    }
  };

  // Solo cuando el servidor respondió que no está activo; un fallo al preguntar es "sin conexión", no falta de llave.
  if (status === false)
    return (
      <p className="small muted" style={{ margin: 0 }}>
        Para platicar con {coachName} (que registre lo que le cuentas, te arme ajustes e investigue la evidencia) activa el Coach con IA: en Cloudflare agrega el secreto <code>ANTHROPIC_API_KEY</code>. El plan, la sesión del día y los consejos de esta pantalla funcionan sin IA.
      </p>
    );
  if (status === 'sin-conexion' && !msgs.length)
    return (
      <p className="small muted" style={{ margin: 0 }}>
        Sin conexión con {coachName} por ahora: vuelve cuando tengas señal. El plan, la sesión del día y los consejos de esta pantalla funcionan sin conexión.
      </p>
    );

  return (
    <div className="coach-chat">
      {msgs.length === 0 && (
        <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
          {suggestions.map((s) => (
            <button key={s} className="btn sm" disabled={!enabled} onClick={() => ask(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="chat">
        {msgs.map((m, i) => (
          <div key={i} className={`coach-msg ${m.role}`}>
            {m.role === 'assistant' && <CoachFace mood="calma" size={28} />}
            <div className="stack" style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', minWidth: 0, flex: 1 }}>
              <div className={`bubble ${m.role === 'user' ? 'me' : 'gm'}`}>{m.content}</div>
              {!!m.sources?.length && (
                <div className="coach-sources small muted">
                  Fuentes:{' '}
                  {m.sources.map((s, k) => (
                    <span key={s.url}>
                      {k > 0 && ' · '}
                      <a href={s.url} target="_blank" rel="noopener noreferrer">
                        {s.title}
                      </a>
                    </span>
                  ))}
                </div>
              )}
              {!!m.actions?.length && <CoachActionList actions={m.actions} onUndo={(a) => undo(i, a)} />}
            </div>
          </div>
        ))}
        {busy && <div className="bubble gm muted">{coachName} está revisando tu plan…</div>}
        {err && <div className="bubble gm red">{err}</div>}
        <div ref={end} />
      </div>
      <form
        className="row"
        style={{ marginTop: 8 }}
        onSubmit={async (e) => {
          e.preventDefault();
          await flushActiveDictation();
          void ask(input.current?.value ?? q);
        }}
      >
        <TextInput ref={input} placeholder={`Cuéntale a ${coachName}…`} value={q} onChange={(e) => setQ(e.target.value)} voiceLabel="Dictar a tu coach" />
        <button className="btn primary" disabled={busy || !q.trim() || !enabled} aria-label="Enviar">
          <Icon name="sparkles" />
        </button>
      </form>
    </div>
  );
}
