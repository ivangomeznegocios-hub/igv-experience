import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { buildVoiceContext, parseDictation, type DictationResult, type PendingNote } from '@igv/core';
import { api, type CoachAction } from '../data/api';
import { sync, useGame, voidEvent } from '../data/store';
import { haptic } from '../lib/sound';
import { fmtDate } from '../lib/time';
import { Dictation, appendSpeech, useDictation, voiceSupported } from '../lib/voice';
import { CoachUnavailable, captureNote, isOnline, markNote, relDay, sendDictationToCoach, useCoachEnabled, useVoiceContext } from '../lib/voz';
import { Icon } from './icons';
import { Sheet, toast, undoToast } from './kit';
import { CoachActionList, ProposalList } from './Proposals';
import '../styles/voz.css';

/**
 * "Hablar": botón de micrófono global (arriba del "+") y hoja "Cuéntame".
 * Por qué un botón aparte y no mantener presionado el "+": se descubre solo, es un toque (no hay que aprender un
 * gesto), no choca con el toque normal del "+" y queda en la misma zona del pulgar. El dictado arranca dentro del
 * mismo toque (los navegadores lo exigen para usar el micrófono), así que basta con tocar y hablar.
 *
 * Al guardar: siempre se guarda lo que dijiste tal cual (`note.captured`). Con Coach y conexión, el Coach lo
 * registra solo (con "Deshacer"); si no, se analiza aquí mismo y se muestran propuestas de un toque. Lo que quedó
 * sin procesar aparece en "Notas por procesar".
 */

const shared = new Dictation();
type Opts = { listen?: boolean; text?: string };
const bus = new Set<(o: Opts) => void>();

/** Abre "Cuéntame" desde cualquier pantalla. Con `listen`, empieza a escuchar (llámalo dentro de un toque). */
export function openCuentame(o: Opts = {}) {
  if (o.listen && voiceSupported()) {
    shared.start();
    haptic(12);
  }
  bus.forEach((f) => f(o));
}

/** Botón global de micrófono + hoja "Cuéntame". Se monta una vez en App.tsx. */
export function Hablar() {
  const [open, setOpen] = useState<Opts | null>(null);
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    const f = (o: Opts) => setOpen({ ...o });
    bus.add(f);
    return () => {
      bus.delete(f);
    };
  }, []);

  // Acceso directo de la app instalada: /?accion=hablar
  useEffect(() => {
    if (params.get('accion') === 'hablar') {
      setOpen({});
      params.delete('accion');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  // Mismo criterio que el "+": en el Coach estorba (ahí ya hay dictado).
  const hide = pathname.startsWith('/game-master');
  return (
    <>
      {!hide && (
        <button className="vz-fab" aria-label="Hablar: cuéntame lo que hiciste" title="Hablar" onClick={() => openCuentame({ listen: true })}>
          <Icon name="mic" />
        </button>
      )}
      {open && (
        <CuentameSheet
          initial={open}
          onClose={() => {
            shared.abort();
            setOpen(null);
          }}
        />
      )}
    </>
  );
}

type View =
  | { kind: 'input' }
  | { kind: 'working' }
  | { kind: 'coach'; answer: string; actions: (CoachAction & { undone?: boolean })[] }
  | { kind: 'local'; result: DictationResult; noteId: string; reason: string | null; asOf: string; pending: boolean; uncertain?: boolean };

function CuentameSheet({ initial, onClose }: { initial: Opts; onClose: () => void }) {
  const { state, entities, events } = useGame();
  const coach = useCoachEnabled();
  const [text, setText] = useState(initial.text ?? '');
  // Copia síncrona del texto: cada `setText` la actualiza en el mismo momento (ver el dictado y `save`).
  const textRef = useRef(text);
  const [usedVoice, setUsedVoice] = useState(!!initial.listen);
  const [view, setView] = useState<View>({ kind: 'input' });
  const ctxToday = useVoiceContext();
  const voice = useDictation((t) => {
    setUsedVoice(true);
    // El ref se actualiza aquí mismo (no hasta el siguiente render): `save()` lo lee justo después de `flush()`,
    // y lo último que dijiste puede llegar en ese momento.
    textRef.current = appendSpeech(textRef.current, t);
    setText(textRef.current);
  }, shared);
  const supported = voiceSupported();

  const coachUsable = coach === true && isOnline();
  const status = coachUsable ? 'Lo registra el Coach por ti.' : coach === false ? 'Lo registro aquí y te muestro qué entendí.' : 'Sin conexión: lo registro aquí y la nota queda guardada.';

  /** Procesa un texto: con el Coach si se puede; si no, aquí mismo. */
  const process = async (raw: string, note: { id: string; date: string } | null, source: 'voz' | 'texto') => {
    const t = raw.trim();
    if (!t) return;
    const date = note?.date ?? state.today;
    // Una nota vieja se entiende relativa a su día ("ayer" = el día anterior a la nota).
    const ctx = date === state.today ? ctxToday : buildVoiceContext(events, entities, date);
    if (coachUsable) {
      const n = note ?? { id: captureNote(t, source, 'pendiente').id, date };
      setView({ kind: 'working' });
      try {
        const res = await sendDictationToCoach(t, ctx, state, entities, date);
        markNote(n.id, 'coach');
        setView({ kind: 'coach', answer: res.answer, actions: res.actions });
        return;
      } catch (e) {
        const err = e as CoachUnavailable;
        if (err.partial?.length) {
          // Alcanzó a registrar algo: se muestra con su "Deshacer" y la nota queda pendiente para revisarla.
          setView({ kind: 'coach', answer: `${err.message}\nLo de abajo sí quedó. Tu nota sigue en "Notas por procesar".`, actions: err.partial });
          return;
        }
        // Si no se pudo revisar qué alcanzó a hacer, se avisa y no se ofrece "Guardar todo" (para no duplicar).
        const reason = err.uncertain
          ? `No pude hablar con el Coach (${err.message}). Puede que ya haya registrado parte: revisa tu día antes de guardar. Esto entendí:`
          : `No pude hablar con el Coach (${err.message}). Te propongo esto:`;
        setView({ kind: 'local', result: parseDictation(t, ctx), noteId: n.id, reason, asOf: date, pending: true, uncertain: err.uncertain });
        return;
      }
    }
    // Sin Coach: si nunca habrá Coach, la nota queda resuelta aquí; si solo falta conexión, queda pendiente.
    const handled = note ? 'pendiente' : coach === false ? 'local' : 'pendiente';
    const n = note ?? { id: captureNote(t, source, handled).id, date };
    setView({ kind: 'local', result: parseDictation(t, ctx), noteId: n.id, reason: null, asOf: date, pending: handled === 'pendiente' });
  };

  const save = async () => {
    if (voice.listening) await voice.flush();
    const t = textRef.current.trim();
    if (!t) return;
    await process(t, null, usedVoice ? 'voz' : 'texto');
  };

  const reset = () => {
    textRef.current = '';
    setText('');
    setUsedVoice(false);
    setView({ kind: 'input' });
  };

  const undoCoach = async (a: CoachAction) => {
    try {
      const r = await api.aiUndo(a.activityId);
      await sync();
      setView((v) => (v.kind === 'coach' ? { ...v, actions: v.actions.map((x) => (x.activityId === a.activityId ? { ...x, undone: true } : x)) } : v));
      toast(r.kept ? 'Deshecho (respeté lo que cambiaste después)' : 'Deshecho');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No pude deshacer', 'error');
    }
  };

  return (
    <Sheet open onClose={onClose} title="Cuéntame">
      {view.kind === 'input' && (
        <>
          {supported ? (
            <div className="vz-mic-wrap">
              <button
                type="button"
                className={`vz-mic ${voice.listening ? 'on' : ''}`}
                aria-label={voice.listening ? 'Terminar de hablar' : 'Hablar'}
                aria-pressed={voice.listening}
                onClick={() => {
                  if (!voice.listening) haptic(12);
                  voice.toggle();
                }}
              >
                <Icon name={voice.listening ? 'stop' : 'mic'} />
              </button>
              <div className="vz-mic-label">{voice.listening ? 'Te escucho… toca para terminar' : text ? 'Toca para seguir hablando' : 'Toca y cuéntame qué hiciste'}</div>
            </div>
          ) : (
            <p className="small muted" style={{ marginTop: 0 }}>
              Este navegador no tiene dictado: usa el micrófono de tu teclado o escribe.
            </p>
          )}
          <textarea
            className="input vz-text-input"
            rows={4}
            value={text}
            onChange={(e) => {
              textRef.current = e.target.value;
              setText(e.target.value);
            }}
            placeholder="Ej.: “Fui al gym, gasté 200 en comida y hablé con mi mamá”"
            aria-label="Lo que dijiste (puedes corregirlo)"
            autoFocus={!supported}
          />
          {voice.interim && <div className="vz-interim">{voice.interim}…</div>}
          {voice.error && <p className="small red">{voice.error}</p>}
          <button type="button" className="btn primary block vz-save" disabled={!text.trim() && !voice.interim} onClick={save}>
            <Icon name="check" /> Guardar
          </button>
          <p className="tiny muted vz-status">
            {status} Lo que dices se guarda siempre, tal cual.
          </p>
          <PendingNotes
            onProcess={(n) => {
              shared.abort();
              void process(n.text, { id: n.id, date: n.date }, n.source);
            }}
          />
        </>
      )}

      {view.kind === 'working' && (
        <div className="vz-working">
          <span className="vz-spinner" aria-hidden="true" />
          Registrando con el Coach…
        </div>
      )}

      {view.kind === 'coach' && (
        <>
          <div className="bubble gm vz-answer">{view.answer}</div>
          <CoachActionList actions={view.actions} onUndo={undoCoach} />
          {!view.actions.length && <p className="small muted">No registré nada. Tu nota quedó guardada.</p>}
          <Footer onMore={reset} onClose={onClose} />
        </>
      )}

      {view.kind === 'local' && (
        <LocalResult
          view={view}
          onSaved={(count) => {
            // Guardar algo de una nota pendiente la da por procesada (las demás ya nacieron resueltas).
            if (count > 0 && view.pending && !savedNotes.has(view.noteId)) {
              savedNotes.add(view.noteId);
              markNote(view.noteId, 'local');
            }
          }}
          onMore={reset}
          onClose={onClose}
        />
      )}
    </Sheet>
  );
}

/** Notas ya marcadas como procesadas en esta sesión (para no repetir el evento). */
const savedNotes = new Set<string>();

function LocalResult({ view, onSaved, onMore, onClose }: { view: Extract<View, { kind: 'local' }>; onSaved: (count: number) => void; onMore: () => void; onClose: () => void }) {
  const { state } = useGame();
  const { result } = view;
  return (
    <>
      {view.reason && <p className="small muted" style={{ marginTop: 0 }}>{view.reason}</p>}
      {view.asOf !== state.today && <p className="tiny muted">Nota del {fmtDate(view.asOf)}: las fechas son relativas a ese día.</p>}
      {result.proposals.length > 0 ? (
        <>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Esto entendí · un toque para guardar
          </div>
          <ProposalList proposals={result.proposals} onSaved={onSaved} saveAll={!view.uncertain} />
        </>
      ) : (
        <p className="small">No encontré nada que registrar.</p>
      )}
      {result.unknown.length > 0 && (
        <div className="vz-unknown">
          <div className="eyebrow">No entendí</div>
          {result.unknown.map((u, i) => (
            <div key={i} className="vz-unknown-item">
              “{u}”
            </div>
          ))}
          <p className="tiny muted" style={{ marginBottom: 0 }}>
            Queda en tu nota. Puedes registrarlo con el + o pedírselo al Coach.
          </p>
        </div>
      )}
      <Footer onMore={onMore} onClose={onClose} />
    </>
  );
}

function Footer({ onMore, onClose }: { onMore: () => void; onClose: () => void }) {
  return (
    <div className="row" style={{ gap: 8, marginTop: 12 }}>
      <button type="button" className="btn grow" onClick={onMore}>
        <Icon name="mic" /> Contar más
      </button>
      <button type="button" className="btn primary grow" onClick={onClose}>
        Listo
      </button>
    </div>
  );
}

/** "Notas por procesar": lo que dijiste sin conexión o sin Coach y aún no se registra. */
function PendingNotes({ onProcess }: { onProcess: (n: PendingNote) => void }) {
  const { state } = useGame();
  const notes = state.notes?.pending ?? [];
  const [open, setOpen] = useState(notes.length <= 3);
  if (!notes.length) return null;
  return (
    <div className="vz-notes">
      <button type="button" className="vz-notes-head" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
        <Icon name={open ? 'down' : 'right'} width={16} />
        Notas por procesar <span className="badge">{notes.length}</span>
      </button>
      {open && notes.map((n) => (
        <div key={n.id} className="vz-note">
          <div className="vz-note-text">“{n.text}”</div>
          <div className="row between" style={{ gap: 6, marginTop: 6 }}>
            <span className="tiny muted">{relDay(n.date, state.today, (d) => fmtDate(d))}</span>
            <div className="row" style={{ gap: 6 }}>
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => {
                  const ev = markNote(n.id, 'descartada');
                  undoToast('Nota descartada', () => voidEvent(ev.id));
                }}
              >
                Descartar
              </button>
              <button type="button" className="btn sm" onClick={() => onProcess(n)}>
                <Icon name="sparkles" /> Procesar
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
