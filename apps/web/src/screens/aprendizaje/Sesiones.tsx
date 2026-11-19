import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  GAME_CONFIG,
  learningErrorKey,
  learningSimilarity,
  learningWordDiff,
  normalizeLearningText,
  type Entity,
  type LearningItemData,
  type LearningResult,
  type LearningTopicData,
  type LearningTopicState,
} from '@igv/core';
import { addEvent, saveEntity, useGame, voidEvent } from '../../data/store';
import { AuthError } from '../../data/api';
import { learnApi, type GradeResponse, type LearnTopicInput, type QuizQuestion } from '../../data/aprendizajeApi';
import { speak, speakSupported, useListen } from '../../lib/vozIdioma';
import { haptic, sfx } from '../../lib/sound';
import { newId } from '../../lib/time';
import { Bar, undoToast } from '../../ui/kit';
import { Icon } from '../../ui/icons';

export type SessionKind = 'tarjetas' | 'test' | 'voz';

const L = GAME_CONFIG.learning;
const SESSION_XP = GAME_CONFIG.missionXp[L.sessionSize];

export const isLanguage = (t: Entity<LearningTopicData>) => t.data.topicKind === 'idioma';
export const voiceLang = (t: Entity<LearningTopicData>) => (isLanguage(t) ? t.data.lang || 'en-US' : 'es-MX');
const langName = (t: Entity<LearningTopicData>) => (isLanguage(t) ? (/^en/i.test(voiceLang(t)) ? 'inglés' : t.data.name.toLowerCase()) : 'tus palabras');

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function useTopicItems(topicId: string) {
  const { list } = useGame();
  const items = list<LearningItemData>('learning', 'item').filter((i) => i.data.topicId === topicId);
  return { items, byId: new Map(items.map((i) => [i.id, i])) };
}

/** Marco de pantalla completa para una sesión. */
function Shell({ title, progress, count, onClose, children }: { title: string; progress?: number; count?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div className="lrn-session" role="dialog" aria-modal="true" aria-label={title}>
      <div className="lrn-session-inner">
        <div className="lrn-session-top">
          <button className="btn icon ghost" onClick={onClose} aria-label="Cerrar">
            <Icon name="x" />
          </button>
          <div className="grow">{progress !== undefined ? <Bar value={progress} max={1} tone="teal" size="sm" /> : <b>{title}</b>}</div>
          {count && <span className="lrn-count">{count}</span>}
        </div>
        {children}
      </div>
    </div>
  );
}

function SpeakBtn({ text, lang, label }: { text: string; lang: string; label?: string }) {
  if (!speakSupported()) return null;
  return (
    <button type="button" className={`btn ${label ? 'sm' : 'icon'} ghost`} onClick={() => speak(text, lang)} aria-label={`Escuchar: ${text}`}>
      <Icon name="volume" /> {label}
    </button>
  );
}

function XpNote({ hadSession }: { hadSession: boolean }) {
  return hadSession ? <p className="tiny muted lrn-center">La XP de práctica de hoy ya contaba. Lo que repasas sí mueve tus tarjetas.</p> : <p className="small lrn-center" style={{ color: 'var(--gold)' }}>+{SESSION_XP} XP por tu práctica de hoy</p>;
}

// =============================================================================================
// Tarjetas (repaso espaciado)
// =============================================================================================

/** Nuevas que todavía caben hoy (máximo `newPerSession` al día). */
export const newLeftToday = (st: LearningTopicState | undefined) => Math.min(st?.fresh.length ?? 0, Math.max(0, L.newPerSession - (st?.newToday ?? 0)));

function cardQueue(st: LearningTopicState | undefined, mode: 'due' | 'new' | 'hard' | 'all', allIds: string[]): string[] {
  if (!st) return mode === 'all' ? shuffle(allIds).slice(0, 20) : [];
  if (mode === 'due') return [...st.due, ...st.fresh.slice(0, newLeftToday(st))];
  if (mode === 'new') return st.fresh.slice(0, L.newPerSession);
  if (mode === 'hard') return shuffle([...st.struggling, ...st.learning]).slice(0, 15);
  return shuffle(allIds).slice(0, 20);
}

export function TarjetasSession({ topic, onClose }: { topic: Entity<LearningTopicData>; onClose: () => void }) {
  const { state } = useGame();
  const { items, byId } = useTopicItems(topic.id);
  const st0 = useRef(state.learning.topics[topic.id]).current;
  const hadSession = useRef(!!st0?.sessionToday).current;
  const [queue, setQueue] = useState<string[]>(() => cardQueue(st0, 'due', []).filter((id) => byId.has(id)));
  const [idx, setIdx] = useState(0);
  const [shown, setShown] = useState(false);
  const [front, setFront] = useState<'meaning' | 'text'>(isLanguage(topic) ? 'meaning' : 'text');
  const [done, setDone] = useState<{ itemId: string; result: LearningResult; eventId: string }[]>([]);
  const saved = useRef(false);
  const lang = voiceLang(topic);

  const practice = (mode: 'new' | 'hard' | 'all') => {
    const ids = items.map((i) => i.id);
    const q = cardQueue(st0, mode, ids).filter((id) => byId.has(id));
    setQueue(q.length ? q : cardQueue(st0, 'all', ids));
  };
  const finished = queue.length > 0 && idx >= queue.length;
  const save = useCallback(() => {
    if (saved.current || !done.length) return;
    saved.current = true;
    addEvent('learning.test_taken', { topicId: topic.id, source: 'tarjetas', score: done.filter((d) => d.result === 'bien').length, total: done.length, errors: [] });
  }, [done, topic.id]);
  useEffect(() => {
    if (finished) save();
  }, [finished, save]);
  const close = () => {
    save();
    onClose();
  };

  const grade = (result: LearningResult) => {
    const itemId = queue[idx];
    const ev = addEvent('learning.reviewed', { itemId, result });
    setDone((d) => [...d, { itemId, result, eventId: ev.id }]);
    if (result === 'bien') sfx.coin();
    haptic(result === 'mal' ? [20, 40, 20] : 12);
    setShown(false);
    setIdx((i) => i + 1);
  };
  const undo = () => {
    const last = done.at(-1);
    if (!last || saved.current) return;
    voidEvent(last.eventId);
    sfx.undo();
    setDone((d) => d.slice(0, -1));
    setIdx((i) => Math.max(0, i - 1));
    setShown(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (finished || !queue.length) return;
      if (!shown && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setShown(true);
      } else if (shown && ['1', '2', '3'].includes(e.key)) grade((['mal', 'dude', 'bien'] as const)[Number(e.key) - 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!queue.length)
    return (
      <Shell title="Repasar tarjetas" onClose={close}>
        <div className="lrn-card">
          <Icon name="check" width={34} style={{ margin: '0 auto', color: 'var(--green)' }} />
          <div className="lrn-front">{items.length ? 'Nada pendiente por hoy' : 'Todavía no tienes frases'}</div>
          <p className="small muted">{items.length ? 'Tus tarjetas están al día. Si quieres seguir: aprende nuevas o practica las difíciles (practicar antes de tiempo no adelanta su repaso).' : 'Agrega frases desde la pantalla del tema para empezar a repasar.'}</p>
        </div>
        <div className="lrn-bottom">
          {items.length > 0 && (
            <>
              {(st0?.fresh.length ?? 0) > 0 && (
                <button className="btn" onClick={() => practice('new')}>
                  <Icon name="plus" /> {Math.min(L.newPerSession, st0?.fresh.length ?? 0)} nuevas más
                </button>
              )}
              <button className="btn" onClick={() => practice('hard')}>
                <Icon name="flame" /> Difíciles
              </button>
              <button className="btn" onClick={() => practice('all')}>
                <Icon name="refresh" /> Al azar
              </button>
            </>
          )}
          {!items.length && (
            <button className="btn primary" onClick={close}>
              Volver
            </button>
          )}
        </div>
      </Shell>
    );

  if (finished) {
    const n = (r: LearningResult) => done.filter((d) => d.result === r).length;
    return (
      <Shell title="Sesión terminada" onClose={close}>
        <div className="lrn-card">
          <div className="eyebrow">Sesión terminada</div>
          <div className="lrn-score">
            <b>
              {n('bien')}/{done.length}
            </b>
            <div className="pct">bien a la primera</div>
          </div>
          <div className="row" style={{ justifyContent: 'center', gap: 14 }}>
            <span className="small" style={{ color: 'var(--green)' }}>{n('bien')} bien</span>
            <span className="small" style={{ color: 'var(--gold)' }}>{n('dude')} dudé</span>
            <span className="small" style={{ color: 'var(--red)' }}>{n('mal')} mal</span>
          </div>
          <XpNote hadSession={hadSession} />
          <p className="tiny muted">Las que fallaste vuelven mañana; las que sabes, cada vez más espaciadas.</p>
        </div>
        <div className="lrn-bottom">
          <button className="btn primary" onClick={onClose}>
            Listo
          </button>
        </div>
      </Shell>
    );
  }

  const it = byId.get(queue[idx]);
  if (!it) {
    // La borraron a media sesión: saltarla.
    setTimeout(() => setIdx((i) => i + 1));
    return null;
  }
  const q = front === 'meaning' ? it.data.meaning || it.data.text : it.data.text;
  const a = front === 'meaning' ? it.data.text : it.data.meaning;
  const card = state.learning.cards[it.id];
  return (
    <Shell title="Repasar tarjetas" progress={idx / queue.length} count={`${idx + 1} / ${queue.length}`} onClose={close}>
      <div className="lrn-card" onClick={() => !shown && setShown(true)}>
        <div className="eyebrow">{!card || card.status === 'nuevo' ? 'Nueva' : front === 'meaning' ? `¿Cómo se dice en ${langName(topic)}?` : '¿Qué significa?'}</div>
        <div className="lrn-front">{q}</div>
        {shown ? (
          <>
            <div className="lrn-back">{a || '—'}</div>
            {it.data.example && <div className="lrn-example">{it.data.example}</div>}
            {isLanguage(topic) && (
              <div>
                <SpeakBtn text={it.data.text} lang={lang} label="Escuchar" />
              </div>
            )}
          </>
        ) : (
          <p className="small muted">Dilo en voz alta o piénsalo, y luego toca para ver la respuesta.</p>
        )}
      </div>
      {shown ? (
        <div className="lrn-grade">
          <button className="btn mal" onClick={() => grade('mal')}>
            Mal <small>vuelve mañana</small>
          </button>
          <button className="btn dude" onClick={() => grade('dude')}>
            Dudé <small>se queda</small>
          </button>
          <button className="btn bien" onClick={() => grade('bien')}>
            Bien <small>sube</small>
          </button>
        </div>
      ) : (
        <div className="lrn-bottom">
          <button className="btn primary" onClick={() => setShown(true)}>
            Mostrar respuesta
          </button>
        </div>
      )}
      <div className="row between" style={{ marginTop: 10 }}>
        <button className="btn sm ghost" onClick={() => setFront((f) => (f === 'meaning' ? 'text' : 'meaning'))}>
          <Icon name="refresh" /> {front === 'meaning' ? 'Ver primero la frase' : 'Ver primero el significado'}
        </button>
        {done.length > 0 && (
          <button className="btn sm ghost" onClick={undo}>
            Deshacer
          </button>
        )}
      </div>
    </Shell>
  );
}

// =============================================================================================
// Práctica en voz alta
// =============================================================================================

interface VoiceTry {
  said: string;
  sim: number;
}
const verdictOf = (sim: number) => (sim >= L.voicePass ? 'ok' : sim >= L.voiceClose ? 'close' : 'miss');

export function VozSession({ topic, onClose }: { topic: Entity<LearningTopicData>; onClose: () => void }) {
  const { state } = useGame();
  const { byId } = useTopicItems(topic.id);
  const lang = voiceLang(topic);
  const st0 = useRef(state.learning.topics[topic.id]).current;
  const hadSession = useRef(!!st0?.sessionToday).current;
  const queue = useMemo(() => {
    const order = st0 ? [...st0.struggling, ...st0.due, ...shuffle(st0.learning), ...st0.fresh, ...shuffle(st0.known)] : [];
    return [...new Set(order)].filter((id) => {
      const d = byId.get(id)?.data;
      return d && d.itemType !== 'concepto' && d.meaning?.trim();
    }).slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [idx, setIdx] = useState(0);
  const [attempt, setAttempt] = useState<VoiceTry | null>(null);
  const [first, setFirst] = useState<Record<string, VoiceTry & { expected: string; meaning: string }>>({});
  const [typed, setTyped] = useState('');
  const saved = useRef(false);
  const itemId = queue[idx];
  const it = itemId ? byId.get(itemId) : undefined;

  const evaluate = (said: string) => {
    if (!it) return;
    const sim = learningSimilarity(it.data.text, said);
    const t = { said, sim };
    setAttempt(t);
    const v = verdictOf(sim);
    if (v === 'ok') sfx.coin();
    haptic(v === 'ok' ? 12 : [20, 40, 20]);
    if (!first[it.id]) {
      setFirst((f) => ({ ...f, [it.id]: { ...t, expected: it.data.text, meaning: it.data.meaning } }));
      addEvent('learning.reviewed', { itemId: it.id, result: v === 'ok' ? 'bien' : v === 'close' ? 'dude' : 'mal' });
    }
  };
  const mic = useListen(lang, evaluate);

  const finished = queue.length > 0 && idx >= queue.length;
  const save = useCallback(() => {
    const tries = Object.values(first);
    if (saved.current || !tries.length) return;
    saved.current = true;
    const misses = tries.filter((t) => t.sim < L.voicePass);
    addEvent('learning.test_taken', {
      topicId: topic.id,
      source: 'voz',
      score: tries.length - misses.length,
      total: tries.length,
      errors: misses.slice(0, 50).map((t) => ({
        tag: t.sim >= L.voiceClose ? 'pronunciación' : 'vocabulario',
        prompt: `Di en ${langName(topic)}: ${t.meaning}`.slice(0, 500),
        answer: (t.said || '(no la dijo)').slice(0, 500),
        correction: t.expected.slice(0, 500),
      })),
    });
  }, [first, topic]);
  useEffect(() => {
    if (finished) save();
  }, [finished, save]);
  const close = () => {
    mic.stop();
    save();
    onClose();
  };
  const next = () => {
    mic.stop();
    setAttempt(null);
    setTyped('');
    setIdx((i) => i + 1);
  };
  const skip = () => {
    if (it && !first[it.id]) {
      setFirst((f) => ({ ...f, [it.id]: { said: '', sim: 0, expected: it.data.text, meaning: it.data.meaning } }));
      addEvent('learning.reviewed', { itemId: it.id, result: 'mal' });
    }
    setAttempt({ said: '', sim: 0 });
  };

  if (!queue.length)
    return (
      <Shell title="Practicar en voz alta" onClose={close}>
        <div className="lrn-card">
          <div className="lrn-front">Agrega frases para practicar</div>
          <p className="small muted">Aquí ves una frase en español y la dices en {langName(topic)}. Necesitas frases con su significado.</p>
        </div>
        <div className="lrn-bottom">
          <button className="btn primary" onClick={close}>
            Volver
          </button>
        </div>
      </Shell>
    );

  if (finished) {
    const tries = Object.values(first);
    const ok = tries.filter((t) => t.sim >= L.voicePass).length;
    return (
      <Shell title="Práctica terminada" onClose={close}>
        <div className="lrn-card" style={{ justifyContent: 'flex-start' }}>
          <div className="eyebrow">Práctica en voz alta</div>
          <div className="lrn-score">
            <b>
              {ok}/{tries.length}
            </b>
            <div className="pct">bien a la primera</div>
          </div>
          <XpNote hadSession={hadSession} />
          <div style={{ textAlign: 'left' }}>
            {tries.map((t, i) => (
              <div key={i} className={`lrn-result ${t.sim >= L.voicePass ? 'ok' : 'bad'}`}>
                <div className="lrn-result-head">
                  <Icon name={t.sim >= L.voicePass ? 'check' : 'x'} />
                  <div className="grow small">
                    <b>{t.expected}</b>
                    <div className="tiny muted">{t.said ? `Dijiste: "${t.said}" · ${Math.round(t.sim * 100)}%` : 'No la dijiste'}</div>
                  </div>
                  <SpeakBtn text={t.expected} lang={lang} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="lrn-bottom">
          <button className="btn primary" onClick={onClose}>
            Listo
          </button>
        </div>
      </Shell>
    );
  }

  if (!it) {
    setTimeout(next);
    return null;
  }
  const v = attempt ? verdictOf(attempt.sim) : null;
  return (
    <Shell title="Practicar en voz alta" progress={idx / queue.length} count={`${idx + 1} / ${queue.length}`} onClose={close}>
      <div className="lrn-card">
        <div className="eyebrow">Dilo en {langName(topic)}</div>
        <div className="lrn-front">{it.data.meaning}</div>
        {attempt ? (
          <>
            <div className={`lrn-verdict ${v}`}>
              {v === 'ok' ? '¡Bien dicho!' : v === 'close' ? 'Casi' : attempt.said ? 'Otra vez' : 'Así se dice'} {attempt.said && <span className="num small">{Math.round(attempt.sim * 100)}%</span>}
            </div>
            {attempt.said && (
              <div className="lrn-diff" aria-label="Comparación palabra por palabra">
                {learningWordDiff(it.data.text, attempt.said).map((p, i) => (
                  <span key={i} className={p.op} title={p.op === 'missing' ? 'Te faltó' : p.op === 'extra' ? 'De más' : undefined}>
                    {p.word}
                  </span>
                ))}
              </div>
            )}
            <div className="lrn-back">{it.data.text}</div>
            <div>
              <SpeakBtn text={it.data.text} lang={lang} label="Escuchar" />
            </div>
          </>
        ) : mic.supported ? (
          <>
            <button className={`lrn-mic ${mic.listening ? 'on' : ''}`} onClick={mic.toggle} aria-label={mic.listening ? 'Detener' : 'Hablar'}>
              <Icon name={mic.listening ? 'stop' : 'mic'} />
            </button>
            <div className="lrn-interim">{mic.listening ? mic.interim || 'Te escucho…' : 'Toca y dilo'}</div>
          </>
        ) : (
          <form
            className="lrn-quick"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed.trim()) evaluate(typed.trim());
            }}
          >
            <input className="input" lang={lang} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Tu navegador no reconoce voz: escríbela" autoCapitalize="off" />
            <button className="btn primary" disabled={!typed.trim()}>
              Comprobar
            </button>
          </form>
        )}
        {mic.error && <p className="small" style={{ color: 'var(--red)' }}>{mic.error}</p>}
      </div>
      <div className="lrn-bottom">
        {attempt ? (
          <>
            {mic.supported && (
              <button
                className="btn"
                onClick={() => {
                  setAttempt(null);
                  mic.start();
                }}
              >
                <Icon name="mic" /> Repetir
              </button>
            )}
            <button className="btn primary" onClick={next}>
              Siguiente
            </button>
          </>
        ) : (
          <button className="btn ghost" onClick={skip}>
            No me la sé
          </button>
        )}
      </div>
      {attempt && first[it.id] && first[it.id].said !== attempt.said && (
        <p className="tiny muted lrn-center">Cuenta tu primer intento ({Math.round(first[it.id].sim * 100)}%); repetir es para practicar.</p>
      )}
    </Shell>
  );
}

// =============================================================================================
// Test con IA
// =============================================================================================

const FOCUS = [
  { value: '', label: 'Mixto' },
  { value: 'negociación', label: 'Negociación' },
  { value: 'juntas y llamadas', label: 'Juntas' },
  { value: 'presentaciones', label: 'Presentaciones' },
  { value: 'small talk profesional', label: 'Small talk' },
  { value: 'mis errores frecuentes', label: 'Mis errores' },
];
const TYPE_NAMES: Record<string, string> = { traducir: 'Traducir', completar: 'Completar', opcion: 'Elegir', corregir: 'Corregir', responder: 'Responder' };

export function topicInput(t: Entity<LearningTopicData>): LearnTopicInput {
  return { name: t.data.name, kind: t.data.topicKind, level: t.data.level ?? null, goal: t.data.goal ?? null };
}

function errorMessage(e: unknown): string {
  if (e instanceof AuthError) return 'Tu sesión expiró. Recarga la app para entrar de nuevo.';
  if (e instanceof Error && e.message && !/fetch|network|load failed/i.test(e.message)) return e.message;
  return 'Sin conexión: los tests con IA necesitan internet. Mientras, practica con tarjetas o en voz alta.';
}

type Step = { s: 'setup' } | { s: 'loading' } | { s: 'answer'; title: string; qs: QuizQuestion[] } | { s: 'grading'; title: string; qs: QuizQuestion[] } | { s: 'results'; title: string; qs: QuizQuestion[]; r: GradeResponse; eventId: string } | { s: 'error'; msg: string; back: Step };

export function TestSession({ topic, onClose }: { topic: Entity<LearningTopicData>; onClose: () => void }) {
  const { state } = useGame();
  const { items } = useTopicItems(topic.id);
  const st0 = useRef(state.learning.topics[topic.id]).current;
  const hadSession = useRef(!!st0?.sessionToday).current;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [count, setCount] = useState(6);
  const [focus, setFocus] = useState('');
  const [step, setStep] = useState<Step>({ s: 'setup' });
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<Set<string>>(new Set());
  const lang = voiceLang(topic);

  useEffect(() => {
    learnApi
      .status()
      .then((s) => setEnabled(s.enabled))
      .catch(() => setEnabled(null));
  }, []);

  const textOf = (id: string) => items.find((i) => i.id === id)?.data.text;
  const start = async () => {
    setStep({ s: 'loading' });
    try {
      const pick = (ids: string[] = []) => ids.map(textOf).filter((x): x is string => !!x).slice(0, 40);
      const quiz = await learnApi.quiz({
        topic: topicInput(topic),
        count,
        focus: focus || null,
        known: pick(shuffle(st0?.known ?? [])),
        learning: pick([...(st0?.struggling ?? []), ...shuffle(st0?.learning ?? [])]),
        errors: (st0?.errors ?? [])
          .filter((e) => !e.improving)
          .slice(0, 15)
          .map((e) => ({ tag: e.tag, answer: e.answer.slice(0, 200), correction: e.correction.slice(0, 200), count: e.count })),
      });
      setAnswers({});
      setIdx(0);
      sfx.questStart();
      setStep({ s: 'answer', title: quiz.title, qs: quiz.questions });
    } catch (e) {
      setStep({ s: 'error', msg: errorMessage(e), back: { s: 'setup' } });
    }
  };

  const grade = async (title: string, qs: QuizQuestion[]) => {
    setStep({ s: 'grading', title, qs });
    try {
      const r = await learnApi.grade({
        topic: topicInput(topic),
        questions: qs.map((q) => ({ ...q, answer: (answers[q.id] ?? '').slice(0, 600) })),
        knownErrors: (st0?.errors ?? []).slice(0, 20).map((e) => ({ tag: e.tag.slice(0, 40), correction: e.correction.slice(0, 200) })),
        existing: items.map((i) => i.data.text.slice(0, 200)).slice(0, 150),
      });
      const ev = addEvent('learning.test_taken', { topicId: topic.id, source: 'ia', score: r.score, total: r.total, level: r.estimatedLevel ?? undefined, errors: r.errors.slice(0, 50) });
      if (r.score === r.total) sfx.perfectDay();
      else sfx.xp(SESSION_XP);
      undoToast(`Test guardado: ${r.score}/${r.total}`, () => voidEvent(ev.id));
      setStep({ s: 'results', title, qs, r, eventId: ev.id });
    } catch (e) {
      setStep({ s: 'error', msg: errorMessage(e), back: { s: 'answer', title, qs } });
    }
  };

  const addSuggestion = (s: GradeResponse['suggestions'][number]) => {
    const k = normalizeLearningText(s.text);
    if (added.has(k) || items.some((i) => normalizeLearningText(i.data.text) === k)) return;
    saveEntity<LearningItemData>({
      id: `li-${newId().replace(/-/g, '').slice(0, 10)}`,
      module: 'learning',
      kind: 'item',
      data: { topicId: topic.id, itemType: 'frase', text: s.text.trim(), meaning: s.meaning.trim(), example: s.example?.trim() || undefined, tags: s.tags.slice(0, 6), origin: 'test' },
    });
    setAdded((a) => new Set(a).add(k));
  };

  // ---------- Pasos ----------
  if (step.s === 'setup')
    return (
      <Shell title="Test con IA" onClose={onClose}>
        <div className="card">
          <div className="eyebrow">Test con IA · {topic.data.name}</div>
          <h2 style={{ marginTop: 6 }}>Mide cómo vas</h2>
          <p className="small muted">
            Preguntas a tu nivel{topic.data.level ? ` (${topic.data.level})` : ''}: traducir, completar, elegir, corregir y responder en situaciones de trabajo. Contestas escribiendo o hablando, y la IA te califica y te dice qué corregir.
            {st0?.errors.some((e) => e.repeated && !e.improving) ? ' Incluye tus errores frecuentes para ver si ya los dejaste.' : ''}
          </p>
          <div className="field">
            <span>Preguntas</span>
            <div className="chips">
              {[5, 6, 8, 10].map((n) => (
                <button key={n} type="button" className={`chip ${count === n ? 'on' : ''}`} onClick={() => setCount(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          {isLanguage(topic) && (
            <div className="field">
              <span>Enfoque</span>
              <div className="chips">
                {FOCUS.filter((f) => f.value !== 'mis errores frecuentes' || st0?.errors.length).map((f) => (
                  <button key={f.label} type="button" className={`chip ${focus === f.value ? 'on' : ''}`} onClick={() => setFocus(f.value)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {enabled === false && (
            <p className="small" style={{ color: 'var(--flame)' }}>
              La IA no está activada en el servidor (falta ANTHROPIC_API_KEY). Mientras, practica con tarjetas o en voz alta.
            </p>
          )}
          <p className="tiny muted">{hadSession ? 'Ya practicaste hoy: este test mide tu avance (la XP del día ya contó).' : `Tu primera práctica de hoy da +${SESSION_XP} XP.`}</p>
        </div>
        <div className="lrn-bottom">
          <button className="btn primary" disabled={enabled === false} onClick={start}>
            <Icon name="sparkles" /> Empezar test
          </button>
        </div>
      </Shell>
    );

  if (step.s === 'loading' || step.s === 'grading')
    return (
      <Shell title="Test con IA" onClose={onClose}>
        <div className="lrn-center">
          <div className="lrn-spinner" aria-hidden />
          <p className="small muted">{step.s === 'loading' ? 'Armando tu test…' : 'Calificando tus respuestas…'}</p>
        </div>
      </Shell>
    );

  if (step.s === 'error')
    return (
      <Shell title="Test con IA" onClose={onClose}>
        <div className="card">
          <p className="small">{step.msg}</p>
        </div>
        <div className="lrn-bottom">
          <button className="btn" onClick={onClose}>
            Salir
          </button>
          <button className="btn primary" onClick={() => (step.back.s === 'answer' ? grade(step.back.title, step.back.qs) : setStep(step.back))}>
            Reintentar
          </button>
        </div>
      </Shell>
    );

  if (step.s === 'answer') {
    const q = step.qs[Math.min(idx, step.qs.length - 1)];
    const last = idx >= step.qs.length - 1;
    const answered = step.qs.filter((x) => (answers[x.id] ?? '').trim()).length;
    return (
      <Shell title={step.title} progress={idx / step.qs.length} count={`${idx + 1} / ${step.qs.length}`} onClose={() => (answered === 0 || window.confirm('¿Salir del test? Tus respuestas no se guardan.')) && onClose()}>
        <div className="card">
          <div className="lrn-q-type">
            {TYPE_NAMES[q.type] ?? q.type} · {q.instruction}
          </div>
          <div className="lrn-q-prompt" lang={q.type === 'traducir' || !isLanguage(topic) ? 'es' : lang}>
            {q.prompt}
          </div>
          {q.type === 'opcion' && q.options?.length ? (
            <div className="lrn-options" role="radiogroup">
              {q.options.map((o) => (
                <button key={o} type="button" role="radio" aria-checked={answers[q.id] === o} className={`lrn-option ${answers[q.id] === o ? 'on' : ''}`} onClick={() => setAnswers((a) => ({ ...a, [q.id]: o }))}>
                  {o}
                </button>
              ))}
            </div>
          ) : (
            <AnswerBox key={q.id} value={answers[q.id] ?? ''} lang={lang} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
          )}
        </div>
        <div className="lrn-bottom">
          {idx > 0 && (
            <button className="btn" onClick={() => setIdx((i) => i - 1)}>
              Anterior
            </button>
          )}
          {last ? (
            <button className="btn primary" onClick={() => grade(step.title, step.qs)}>
              <Icon name="check" /> Calificar ({answered}/{step.qs.length})
            </button>
          ) : (
            <button className="btn primary" onClick={() => setIdx((i) => i + 1)}>
              {(answers[q.id] ?? '').trim() ? 'Siguiente' : 'Saltar'}
            </button>
          )}
        </div>
      </Shell>
    );
  }

  // Resultados
  const { r, qs } = step;
  const pct = Math.round((r.score / Math.max(1, r.total)) * 100);
  const prevKeys = new Map((st0?.errors ?? []).map((e) => [e.key, e]));
  const prev = st0?.tests.filter((t) => t.source === 'ia').at(-1);
  return (
    <Shell title="Resultado" onClose={onClose}>
      <div className="card">
        <div className="eyebrow">{step.title}</div>
        <div className="lrn-score">
          <b>
            {r.score}/{r.total}
          </b>
          <div className="pct">
            {pct}%{prev ? ` · antes ${prev.pct}%` : ''}
            {r.estimatedLevel ? ` · nivel estimado ${r.estimatedLevel}` : ''}
          </div>
        </div>
        {r.feedback && <p className="small" style={{ textAlign: 'center' }}>{r.feedback}</p>}
        <XpNote hadSession={hadSession} />
      </div>
      <div className="card">
        {qs.map((q) => {
          const g = r.results.find((x) => x.id === q.id);
          const ok = !!g?.correct;
          const rep = !ok && g?.tag && g.fix ? prevKeys.get(learningErrorKey(g.tag, g.fix)) : undefined;
          return (
            <div key={q.id} className={`lrn-result ${ok ? 'ok' : 'bad'}`}>
              <div className="lrn-result-head">
                <Icon name={ok ? 'check' : 'x'} />
                <div className="grow small">
                  <span className="muted">{q.instruction}:</span> {q.prompt}
                </div>
              </div>
              <div className="lrn-result-body">
                <span className="mine">Tú: {(answers[q.id] ?? '').trim() || '(en blanco)'}</span>
                {!ok && g?.corrected && (
                  <span className="fix">
                    {g.corrected} {isLanguage(topic) && <SpeakBtn text={g.corrected} lang={lang} />}
                  </span>
                )}
                {!ok && g?.explanation && <span className="muted">{g.explanation}</span>}
                {rep && <span style={{ color: 'var(--flame)', fontWeight: 700 }}>Error repetido: van {rep.count + 1} veces</span>}
              </div>
            </div>
          );
        })}
      </div>
      {r.suggestions.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Agregar a tus frases</h2>
            {r.suggestions.some((s) => !added.has(normalizeLearningText(s.text))) && (
              <button className="btn sm" onClick={() => r.suggestions.forEach(addSuggestion)}>
                Todas
              </button>
            )}
          </div>
          {r.suggestions.map((s) => {
            const isAdded = added.has(normalizeLearningText(s.text));
            return (
              <div key={s.text} className="lrn-sug">
                <div className="grow">
                  <div className="lrn-item-text">{s.text}</div>
                  <div className="lrn-item-meaning">{s.meaning}</div>
                </div>
                <button className="btn sm" disabled={isAdded} onClick={() => addSuggestion(s)} aria-label={`Agregar ${s.text}`}>
                  {isAdded ? <Icon name="check" /> : <Icon name="plus" />}
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="lrn-bottom">
        <button className="btn primary" onClick={onClose}>
          Listo
        </button>
      </div>
    </Shell>
  );
}

/** Respuesta escrita o dictada (en el idioma que aprendes). */
function AnswerBox({ value, lang, onChange }: { value: string; lang: string; onChange: (v: string) => void }) {
  const ref = useRef(value);
  ref.current = value;
  const mic = useListen(lang, (t) => onChange(ref.current.trim() ? `${ref.current.trim()} ${t}` : t));
  return (
    <>
      <div className="lrn-answer">
        <textarea className="input" lang={lang} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Escribe o dicta tu respuesta" autoCapitalize="sentences" autoCorrect="off" spellCheck={false} />
        {mic.supported && (
          <button type="button" className={`btn icon lrn-mic-sm ${mic.listening ? 'on' : ''}`} onClick={mic.toggle} aria-label={mic.listening ? 'Detener dictado' : 'Dictar respuesta'}>
            <Icon name={mic.listening ? 'stop' : 'mic'} />
          </button>
        )}
      </div>
      {mic.listening && <div className="lrn-interim">{mic.interim || 'Te escucho…'}</div>}
      {mic.error && <p className="small" style={{ color: 'var(--red)' }}>{mic.error}</p>}
    </>
  );
}
