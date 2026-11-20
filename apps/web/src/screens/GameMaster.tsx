import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type AttributeId, type GoalData, type MissionSize } from '@igv/core';
import { api, ApiError, type CoachAction, type GmParseResult } from '../data/api';
import { sync, useGame } from '../data/store';
import { uploadSnapshotNow } from '../lib/aiSnapshot';
import { saveTodo } from '../lib/actions';
import { flushActiveDictation } from '../lib/voice';
import { useVoiceContext } from '../lib/voz';
import { Icon } from '../ui/icons';
import { AttrBadge, PageHeader, SizeBadge, Tabs, TextArea, TextInput, toast } from '../ui/kit';
import { CoachActionList, ProposalList, useGmProposals } from '../ui/Proposals';
import { startQuest } from '../ui/QuestMode';

type Msg = { role: 'user' | 'assistant'; content: string; actions?: (CoachAction & { undone?: boolean })[] };

interface ParsedQuestOffer {
  title: string;
  reason: string;
  size: MissionSize;
  attribute: AttributeId;
}

function normStr(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** Detecta misiones propuestas en el formato `• [Tamaño · Atributo] Título: razón` dentro de las respuestas del Coach. */
function extractQuestOffers(text: string): ParsedQuestOffer[] {
  const out: ParsedQuestOffer[] = [];
  const sizeMap: Record<string, MissionSize> = { chica: 'chica', media: 'media', grande: 'grande', epica: 'epica' };
  const attrMap: Record<string, AttributeId> = {
    fuerza: 'fuerza',
    'fuerza fisica': 'fuerza',
    inteligencia: 'inteligencia',
    carisma: 'carisma',
    finanzas: 'finanzas',
    disciplina: 'disciplina',
    relaciones: 'relaciones',
    creatividad: 'creatividad',
  };
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const m = line.match(/^(?:[•\-*–]|\d+\.)\s*\[([^\]·|/-]+)[·|/-]([^\]]+)\]\s*(.+)$/);
    if (!m) continue;
    const size = sizeMap[normStr(m[1])];
    const attribute = attrMap[normStr(m[2])];
    if (!size || !attribute) continue;
    const rest = m[3].replace(/\*\*/g, '').trim();
    const sep = rest.indexOf(':');
    const title = (sep > 0 ? rest.slice(0, sep) : rest).trim();
    const reason = sep > 0 ? rest.slice(sep + 1).trim() : '';
    if (title.length >= 2) out.push({ title, reason, size, attribute });
  }
  return out;
}

const SUGGESTIONS = ['Propónme 3 misiones para hoy', 'Registra que hoy entrené y leí', 'Arma mis 3 de mañana', '¿Qué gran reto tengo más cerca y cómo lo cierro?', '¿Qué atributo estoy descuidando?'];

export default function GameMaster() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('modo') === 'registrar' ? 'registrar' : 'chat';
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    api.gmStatus().then((s) => setEnabled(s.enabled)).catch(() => setEnabled(false));
  }, []);
  return (
    <>
      <PageHeader title="Coach" eyebrow="Coach con IA · opcional" />
      {enabled === false && (
        <div className="card">
          <h2>Activa el Coach</h2>
          <p className="small muted">
            Usa la API de Claude con tu propia clave. En el panel de Cloudflare: Workers &amp; Pages → igv-experience → Settings → Variables and Secrets → agrega el secreto <code>ANTHROPIC_API_KEY</code>. Los pasos completos están en el README.
          </p>
        </div>
      )}
      {enabled && (
        <>
          <Tabs
            value={tab}
            onChange={(t) => setParams(t === 'registrar' ? { modo: 'registrar' } : {}, { replace: true })}
            options={[
              { value: 'chat', label: 'Conversar' },
              { value: 'registrar', label: 'Registrar mi día' },
            ]}
          />
          {tab === 'chat' ? <Chat /> : <Registrar />}
        </>
      )}
    </>
  );
}

/** Cuéntale tu día en texto o voz: el Coach propone registros y tú confirmas con un toque. */
function Registrar() {
  const { state, list } = useGame();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<GmParseResult | null>(null);
  // Cada lectura monta una lista nueva: sus claves son posicionales (gm0, gm1…) y con el mismo número de
  // propuestas la lista anterior se quedaría con sus tarjetas viejas.
  const [parseId, setParseId] = useState(0);
  // Copia síncrona del texto: lo último que dictaste llega durante `flushActiveDictation()`, antes del siguiente render.
  const textRef = useRef(text);
  const ctx = useVoiceContext();
  const proposals = useGmProposals(res?.proposals ?? null, ctx);

  const goals = list<GoalData>('goals', 'goal').filter((g) => !state.goals[g.id]?.completedOn);
  const catalog = () =>
    [
      'Misiones (id | título | tamaño | atributo):',
      ...ctx.missions.map((m) => `${m.id} | ${m.title} | ${m.size} | ${m.attribute}`),
      '',
      'Personas (id | nombre):',
      ...ctx.people.map((n) => `${n.id} | ${n.name}${n.role ? ` (${n.role})` : ''}`),
      '',
      'Metas (id | meta | unidad):',
      ...goals.map((g) => `${g.id} | ${g.data.title} | ${g.data.unit}`),
    ].join('\n');

  const parse = async () => {
    await flushActiveDictation();
    const t = textRef.current.trim();
    if (!t || busy) return;
    setBusy(true);
    setErr(null);
    try {
      setRes(await api.gmParse({ text: t, today: state.today, catalog: catalog() }));
      setParseId((n) => n + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card">
        <p className="small muted" style={{ marginTop: 0 }}>
          Escríbelo o díctalo por voz: “Hoy fui al gym, cerré una venta de $5,000 con Grupo Norte y hablé con mi mamá”. Te propongo los registros y tú confirmas.
        </p>
        <TextArea
          rows={4}
          value={text}
          onChange={(e) => {
            textRef.current = e.target.value;
            setText(e.target.value);
          }}
          placeholder="¿Qué hiciste hoy?"
        />
        <div className="row" style={{ marginTop: 8, gap: 8 }}>
          <button className="btn primary grow" disabled={busy || !text.trim()} onClick={parse}>
            <Icon name="sparkles" /> {busy ? 'Leyendo…' : 'Proponer registros'}
          </button>
        </div>
        {err && <p className="small red">{err}</p>}
      </div>
      {res && (
        <div className="card">
          <div className="bubble gm" style={{ maxWidth: '100%', marginBottom: 10 }}>
            {res.reply}
          </div>
          {proposals.length === 0 && <div className="small muted">No encontré nada que registrar.</div>}
          <ProposalList
            key={parseId}
            proposals={proposals}
            onSaved={(n) => {
              if (n > 0) {
                textRef.current = '';
                setText('');
              }
            }}
          />
        </div>
      )}
    </>
  );
}

function Chat() {
  const { state, entities } = useGame();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, busy]);

  const ask = async (question: string) => {
    void flushActiveDictation();
    if (!question.trim() || busy) return;
    setErr(null);
    const history = msgs.slice(-10).map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: 'user', content: question }]);
    setQ('');
    setBusy(true);
    try {
      // Sube la foto del estado (si cambió) para que el servidor no tenga que recalcularla.
      await uploadSnapshotNow(state, entities);
      const res = await api.gmAsk({ question, history });
      setMsgs((m) => [...m, { role: 'assistant', content: res.answer, actions: res.actions }]);
      if (res.actions?.length) await sync();
    } catch (e) {
      // Si el Coach alcanzó a registrar algo antes de fallar, se muestra con su "Deshacer".
      const done = e instanceof ApiError ? (e.body as { actions?: CoachAction[] } | undefined)?.actions : undefined;
      if (done?.length) {
        setMsgs((m) => [...m, { role: 'assistant', content: e instanceof Error ? e.message : 'Error', actions: done }]);
        await sync();
        return;
      }
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  };

  const undoAction = async (msgIndex: number, action: CoachAction) => {
    try {
      const r = await api.aiUndo(action.activityId);
      await sync();
      setMsgs((m) => m.map((x, i) => (i === msgIndex ? { ...x, actions: x.actions?.map((a) => (a.activityId === action.activityId ? { ...a, undone: true } : a)) } : x)));
      toast(r.kept ? 'Deshecho (respeté lo que cambiaste después)' : 'Deshecho');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error', 'error');
    }
  };

  const acceptOffer = (key: string, offer: ParsedQuestOffer) => {
    saveTodo({ title: offer.title, size: offer.size, attribute: offer.attribute, date: state.today, notes: offer.reason || undefined });
    setAccepted((s) => new Set(s).add(key));
    toast(`✓ Misión agregada a tu Agenda de hoy: "${offer.title}"`);
  };

  return (
    <>
      <div className="card">
        {msgs.length === 0 && (
          <>
            <p className="small muted" style={{ marginTop: 0 }}>
              Leo tu progreso (nivel, atributos, racha, energía, grandes retos, misiones y diario), te propongo misiones y también puedo hacer cosas por ti: registrar lo que hiciste, gastos, metas o tu agenda. Todo lo que haga se puede deshacer.
            </p>
            <div className="row wrap" style={{ gap: 6 }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} className="btn sm" onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="chat">
          {msgs.map((m, i) => {
            const offers = m.role === 'assistant' ? extractQuestOffers(m.content) : [];
            return (
              <div key={i} className="stack" style={{ alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', display: 'flex', flexDirection: 'column' }}>
                <div className={`bubble ${m.role === 'user' ? 'me' : 'gm'}`}>{m.content}</div>
                {!!m.actions?.length && <CoachActionList actions={m.actions} onUndo={(a) => undoAction(i, a)} />}
                {offers.length > 0 && (
                  <div className="gm-offers">
                    {offers.map((o, j) => {
                      const key = `${i}-${j}`;
                      const ok = accepted.has(key);
                      return (
                        <div key={key} className="gm-offer">
                          <div className="grow">
                            <div className="item-title small">{o.title}</div>
                            <div className="row wrap" style={{ gap: 4, marginTop: 3 }}>
                              <SizeBadge size={o.size} />
                              <AttrBadge attr={o.attribute} />
                            </div>
                          </div>
                          <div className="row" style={{ gap: 4 }}>
                            <button
                              className="btn icon sm play-btn"
                              title="Empezar ahora"
                              aria-label={`Empezar ${o.title}`}
                              onClick={() => startQuest({ kind: 'quick', title: o.title, size: o.size, attribute: o.attribute })}
                            >
                              <Icon name="play" />
                            </button>
                            <button className={`btn sm ${ok ? '' : 'primary'}`} disabled={ok} onClick={() => acceptOffer(key, o)}>
                              {ok ? '✓ Aceptada' : '+ Aceptar'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {busy && <div className="bubble gm muted">El Coach está revisando tu progreso…</div>}
          {err && <div className="bubble gm red">{err}</div>}
          <div ref={end} />
        </div>
      </div>
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          // Si estabas dictando, espera las últimas palabras (llegan al campo) antes de preguntar.
          await flushActiveDictation();
          ask(input.current?.value ?? q);
        }}
      >
        <TextInput ref={input} placeholder="Pregúntale al Coach…" value={q} onChange={(e) => setQ(e.target.value)} voiceLabel="Dictar pregunta" />
        <button className="btn primary" disabled={busy || !q.trim()} aria-label="Enviar">
          <Icon name="sparkles" />
        </button>
      </form>
    </>
  );
}
