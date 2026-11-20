import { useMemo, useState } from 'react';
import {
  CEFR_LEVELS,
  GAME_CONFIG,
  LEARNING_ITEM_TYPES,
  LEARNING_TEST_SOURCE_NAMES,
  LEARNING_TOPIC_KIND_NAMES,
  LEARNING_TOPIC_KINDS,
  LEARNING_VOICE_LANGS,
  englishStarterItems,
  inferLearningLang,
  normalizeLearningText,
  parseLearningLine,
  type Entity,
  type LearningError,
  type LearningItemData,
  type LearningTest,
  type LearningTopicData,
  type LearningTopicState,
} from '@igv/core';
import { deleteEntity, saveEntity, useGame } from '../data/store';
import { sfx } from '../lib/sound';
import { fmtDate, newId } from '../lib/time';
import { speak, speakSupported } from '../lib/vozIdioma';
import { AttrChips, Badge, Bar, Collapse, Field, PageHeader, Sheet, Tabs, confirmAction, toast, undoToast } from '../ui/kit';
import { Icon } from '../ui/icons';
import { TarjetasSession, TestSession, VozSession, isLanguage, langName, newLeftToday, voiceLang, type SessionKind } from './aprendizaje/Sesiones';
import '../styles/aprendizaje.css';

const L = GAME_CONFIG.learning;
const SESSION_XP = GAME_CONFIG.missionXp[L.sessionSize];
const PREF_KEY = 'igv.aprendizaje.tema';
const ITEM_TAGS = ['negociación', 'juntas', 'presentaciones', 'small talk', 'negocios', 'vocabulario', 'gramática', 'phrasal verbs', 'pronunciación'];
const ITEM_TYPE_NAMES: Record<string, string> = { frase: 'Frase', palabra: 'Palabra', concepto: 'Concepto' };
/** Nombre de un idioma de voz para los chips ("fr-FR" → "Francés"); un código fuera de la lista se muestra tal cual. */
const voiceLabel = (code: string) => {
  const n = LEARNING_VOICE_LANGS.find((l) => l.code === code)?.name;
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : code;
};
const isEnglish = (t: Entity<LearningTopicData>) => isLanguage(t) && /^(ingles|english)\b/.test(normalizeLearningText(t.data.name));

function readPref(): string | null {
  try {
    return localStorage.getItem(PREF_KEY);
  } catch {
    return null;
  }
}
function writePref(id: string) {
  try {
    localStorage.setItem(PREF_KEY, id);
  } catch {
    // sin almacenamiento local
  }
}

const itemId = () => `li-${newId().replace(/-/g, '').slice(0, 10)}`;

/** Aprendizaje: idiomas y temas. Lo que sabes decir, lo que te cuesta, los errores que repites y tus tests. */
export default function Aprendizaje() {
  const { state, list } = useGame();
  const topics = list<LearningTopicData>('learning', 'topic');
  const active = topics.filter((t) => !t.data.archived);
  const archived = topics.filter((t) => t.data.archived);
  const [sel, setSel] = useState<string | null>(readPref);
  const [session, setSession] = useState<SessionKind | null>(null);
  const [topicSheet, setTopicSheet] = useState<Entity<LearningTopicData> | 'new' | null>(null);
  const topic = active.find((t) => t.id === sel) ?? active[0];
  const pick = (id: string) => {
    setSel(id);
    writePref(id);
  };

  return (
    <>
      <PageHeader
        title="Aprendizaje"
        eyebrow="Idiomas y temas"
        right={
          <button className="btn sm ghost" onClick={() => setTopicSheet('new')}>
            <Icon name="plus" /> Tema
          </button>
        }
      />
      {active.length > 1 && (
        <Tabs value={topic?.id ?? ''} onChange={pick} options={active.map((t) => ({ value: t.id, label: t.data.name }))} />
      )}
      {topic ? <TopicHub topic={topic} st={state.learning.topics[topic.id]} onSession={setSession} onEdit={() => setTopicSheet(topic)} /> : <Onboarding onOther={() => setTopicSheet('new')} onCreated={pick} />}
      {archived.length > 0 && (
        <p className="tiny muted" style={{ textAlign: 'center' }}>
          Archivados:{' '}
          {archived.map((t, i) => (
            <span key={t.id}>
              {i > 0 && ' · '}
              <button className="btn sm ghost" onClick={() => saveEntity({ ...t, data: { ...t.data, archived: false } })}>
                {t.data.name} (reactivar)
              </button>
            </span>
          ))}
        </p>
      )}
      {topic && session === 'tarjetas' && <TarjetasSession topic={topic} onClose={() => setSession(null)} />}
      {topic && session === 'test' && <TestSession topic={topic} onClose={() => setSession(null)} />}
      {topic && session === 'voz' && <VozSession topic={topic} onClose={() => setSession(null)} />}
      {topicSheet && <TopicSheet topic={topicSheet === 'new' ? null : topicSheet} existing={topics} onClose={() => setTopicSheet(null)} onSaved={pick} />}
    </>
  );
}

// =============================================================================================
// Primer uso
// =============================================================================================

function Onboarding({ onOther, onCreated }: { onOther: () => void; onCreated: (id: string) => void }) {
  const [level, setLevel] = useState<string>('B1');
  const [starter, setStarter] = useState(true);
  const start = () => {
    const id = `lt-${newId().replace(/-/g, '').slice(0, 8)}`;
    saveEntity<LearningTopicData>({ id, module: 'learning', kind: 'topic', data: { name: 'Inglés', topicKind: 'idioma', level, goal: 'Hablar, negociar y presentar en inglés', lang: 'en-US' } });
    if (starter) for (const e of englishStarterItems(id)) saveEntity(e);
    sfx.questStart();
    onCreated(id);
  };
  return (
    <div className="card lrn-hero">
      <h2>Mide cómo va tu inglés</h2>
      <p className="small muted">
        Ve lo que ya sabes decir, lo que te cuesta y los errores que repites. Practica con tarjetas (repaso espaciado), en voz alta o con un test de IA que te califica. Cada día que practicas suma {SESSION_XP} XP.
      </p>
      <Field label="¿Qué nivel crees que tienes hoy?">
        <div className="chips">
          {CEFR_LEVELS.map((l) => (
            <button key={l} type="button" className={`chip ${level === l ? 'on' : ''}`} onClick={() => setLevel(l)}>
              {l}
            </button>
          ))}
        </div>
      </Field>
      <p className="tiny muted" style={{ marginTop: -6 }}>
        A1–A2 básico · B1–B2 te defiendes en juntas · C1–C2 negocias con soltura. El test con IA te dirá si estás arriba o abajo.
      </p>
      <label className="row small" style={{ gap: 8, margin: '10px 0 14px' }}>
        <input type="checkbox" checked={starter} onChange={(e) => setStarter(e.target.checked)} />
        Empezar con 32 frases útiles de negocios (negociación, juntas, presentaciones y small talk)
      </label>
      <div className="row wrap">
        <button className="btn primary grow" onClick={start}>
          Empezar con Inglés
        </button>
        <button className="btn ghost" onClick={onOther}>
          Otro tema
        </button>
      </div>
    </div>
  );
}

// =============================================================================================
// Tema
// =============================================================================================

type ListTab = 'struggling' | 'learning' | 'known' | 'fresh';

function TopicHub({ topic, st, onSession, onEdit }: { topic: Entity<LearningTopicData>; st: LearningTopicState | undefined; onSession: (k: SessionKind) => void; onEdit: () => void }) {
  const { state, list } = useGame();
  const items = list<LearningItemData>('learning', 'item').filter((i) => i.data.topicId === topic.id);
  const [listTab, setListTab] = useState<ListTab>('struggling');
  const [openN, setOpenN] = useState(0);
  const [editing, setEditing] = useState<Entity<LearningItemData> | Partial<LearningItemData> | null>(null);
  const lg = state.learning;
  const c = st?.counts ?? { total: 0, nuevo: 0, aprendiendo: 0, teCuesta: 0, loSe: 0 };
  const due = st?.due.length ?? 0;
  const freshToday = newLeftToday(st);
  const lang = isLanguage(topic);
  const next = lg.nextMilestone;
  const prevMilestone = [...L.masteryMilestones].reverse().find((m) => m <= lg.masteredEver) ?? 0;
  const show = (tab: ListTab) => {
    setListTab(tab);
    setOpenN((n) => n + 1);
    setTimeout(() => document.getElementById('lrn-frases')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  };

  return (
    <>
      <div className="card lrn-hero">
        <div className="lrn-head">
          <div className="lrn-level" title="Tu nivel (autoevaluado)">
            <b>{topic.data.level || '—'}</b>
            <span>Nivel</span>
          </div>
          <div className="grow">
            <div className="lrn-name">{topic.data.name}</div>
            <div className="tiny muted ellipsis">
              {st?.estimatedLevel && st.estimatedLevel !== topic.data.level ? `La IA te ve en ${st.estimatedLevel} · ` : ''}
              {topic.data.goal || LEARNING_TOPIC_KIND_NAMES[topic.data.topicKind]}
            </div>
          </div>
          <div className={`lrn-streak ${st?.streak ? '' : 'off'}`} title={`Días seguidos practicando (mejor: ${st?.bestStreak ?? 0})`}>
            <Icon name="flame" /> {st?.streak ?? 0}
          </div>
          <button className="btn icon ghost" onClick={onEdit} aria-label="Editar tema">
            <Icon name="settings" />
          </button>
        </div>
        <div className="lrn-tiles">
          <button className="lrn-tile known" onClick={() => show('known')}>
            <b>{c.loSe}</b>
            <span>{lang ? 'Ya lo dices' : 'Lo sabes'}</span>
          </button>
          <button className="lrn-tile" onClick={() => show('learning')}>
            <b>{c.aprendiendo + c.nuevo}</b>
            <span>Aprendiendo</span>
          </button>
          <button className="lrn-tile hard" onClick={() => show('struggling')}>
            <b>{c.teCuesta}</b>
            <span>Te cuesta</span>
          </button>
        </div>
        <div style={{ marginTop: 12 }}>
          <Bar
            value={lg.masteredEver - prevMilestone}
            max={(next ?? lg.masteredEver) - prevMilestone || 1}
            tone="teal"
            size="sm"
            label={
              next ? (
                <span className="tiny">
                  Dominadas: <b className="num">{lg.masteredEver}</b> de {next} · al llegar, +{L.masteryXp} XP
                </span>
              ) : (
                <span className="tiny">Dominadas: {lg.masteredEver}. Todos los hitos cumplidos.</span>
              )
            }
          />
        </div>
        <div className={`lrn-today ${st?.sessionToday ? 'done' : ''}`}>
          <Icon name={st?.sessionToday ? 'check' : 'bolt'} />
          {st?.sessionToday ? 'Ya practicaste hoy.' : `Tu primera práctica de hoy da +${SESSION_XP} XP.`}
        </div>
      </div>

      <div className="lrn-actions">
        <button className="btn primary wide" onClick={() => onSession('tarjetas')}>
          <Icon name="refresh" />
          <span className="lrn-btn-text">
            Repasar tarjetas
            <small>{due + freshToday ? [due ? `${due} por repasar` : '', freshToday ? `${freshToday} nuevas` : ''].filter(Boolean).join(' + ') : 'Al día: práctica libre'}</small>
          </span>
        </button>
        <button className="btn" onClick={() => onSession('test')}>
          <Icon name="sparkles" /> Test con IA
        </button>
        {lang ? (
          <button className="btn" onClick={() => onSession('voz')}>
            <Icon name="mic" /> En voz alta
          </button>
        ) : (
          <button className="btn" onClick={() => setEditing({ topicId: topic.id, itemType: 'concepto', text: '', meaning: '', tags: [] })}>
            <Icon name="plus" /> Concepto
          </button>
        )}
      </div>

      <QuickAdd topic={topic} items={items} onNeedsMeaning={(text) => setEditing({ topicId: topic.id, itemType: 'frase', text, meaning: '', tags: [] })} />

      <ErrorsCard errors={st?.errors ?? []} />
      <ResultsCard tests={st?.tests ?? []} st={st} />

      <div id="lrn-frases">
        <Collapse key={openN} defaultOpen={openN > 0} title={`Tus ${lang ? 'frases' : 'conceptos'} (${c.total})`}>
          <Tabs
            value={listTab}
            onChange={setListTab}
            options={[
              { value: 'struggling', label: `Te cuesta ${c.teCuesta}` },
              { value: 'learning', label: `Aprendiendo ${c.aprendiendo}` },
              { value: 'known', label: `Lo sabes ${c.loSe}` },
              { value: 'fresh', label: `Nuevas ${c.nuevo}` },
            ]}
          />
          <ItemList ids={st?.[listTab] ?? (listTab === 'fresh' ? items.map((i) => i.id) : [])} items={items} topic={topic} onOpen={setEditing} tab={listTab} />
        </Collapse>
      </div>

      {editing && <ItemSheet topic={topic} value={editing} items={items} onClose={() => setEditing(null)} />}
    </>
  );
}

function QuickAdd({ topic, items, onNeedsMeaning }: { topic: Entity<LearningTopicData>; items: Entity<LearningItemData>[]; onNeedsMeaning: (text: string) => void }) {
  const [line, setLine] = useState('');
  const starter = useMemo(() => (isEnglish(topic) ? englishStarterItems(topic.id, items) : []), [topic, items]);
  const add = () => {
    const { text, meaning } = parseLearningLine(line);
    if (!text) return;
    if (items.some((i) => normalizeLearningText(i.data.text) === normalizeLearningText(text))) {
      toast('Esa ya la tienes en tu lista.');
      return;
    }
    if (!meaning) {
      onNeedsMeaning(text);
      setLine('');
      return;
    }
    const e = saveEntity<LearningItemData>({ id: itemId(), module: 'learning', kind: 'item', data: { topicId: topic.id, itemType: 'frase', text, meaning, tags: [], origin: 'manual' } });
    setLine('');
    undoToast(`Agregada: ${text}`, () => deleteEntity(e.id));
  };
  const addStarter = () => {
    const added = starter.map((e) => saveEntity(e));
    sfx.coin();
    undoToast(`${added.length} frases de negocios agregadas`, () => added.forEach((e) => deleteEntity(e.id)));
  };
  return (
    <div className="card">
      <form
        className="lrn-quick"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          className="input"
          value={line}
          onChange={(e) => setLine(e.target.value)}
          placeholder={isLanguage(topic) ? 'Frase = significado' : 'Concepto = qué es'}
          aria-label="Agregar en una línea"
          autoCapitalize="off"
        />
        <button className="btn primary" disabled={!line.trim()} aria-label="Agregar">
          <Icon name="plus" />
        </button>
      </form>
      <div className="tiny muted" style={{ marginTop: 6 }}>
        {isLanguage(topic) ? 'Ej. "I’ll follow up by email = Te doy seguimiento por correo". Entra como nueva a tus tarjetas.' : 'Ej. "EBITDA = utilidad antes de intereses, impuestos, depreciación y amortización".'}
      </div>
      {starter.length > 0 && (
        <button className="btn sm" style={{ marginTop: 10 }} onClick={addStarter}>
          <Icon name="book" /> Agregar {starter.length} frases de negocios (opcional)
        </button>
      )}
    </div>
  );
}

function ErrorsCard({ errors }: { errors: LearningError[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const repeated = errors.filter((e) => e.repeated);
  const recent = errors.filter((e) => !e.repeated).sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1)).slice(0, 3);
  if (!errors.length) return null;
  const row = (e: LearningError) => (
    <div key={e.key} className="lrn-err" onClick={() => setOpen((o) => (o === e.key ? null : e.key))}>
      <div className="lrn-err-line">
        <div className="lrn-err-fix">
          {e.answer && !e.answer.startsWith('(') && normalizeLearningText(e.answer) !== normalizeLearningText(e.correction) && (
            <>
              <s>{e.answer.length > 60 ? `${e.answer.slice(0, 59)}…` : e.answer}</s> →{' '}
            </>
          )}
          <b>{e.correction}</b>
        </div>
        {e.repeated && (e.improving ? <Badge tone="green">Mejorando</Badge> : <Badge tone="red">{e.count}×</Badge>)}
      </div>
      <div className="tiny muted">
        {e.tag} · última vez {fmtDate(e.lastSeen)}
        {e.improving ? ` · no aparece en tus últimos ${e.testsSince} tests` : ''}
      </div>
      {open === e.key && (
        <div className="lrn-err-more">
          {e.explanation && <div>{e.explanation}</div>}
          <div>Pregunta: {e.prompt}</div>
        </div>
      )}
    </div>
  );
  return (
    <div className="card">
      <div className="card-head">
        <h2>Errores que repites</h2>
        {repeated.some((e) => !e.improving) && (
          <Badge tone="flame">
            {repeated.filter((e) => !e.improving).length} {repeated.filter((e) => !e.improving).length === 1 ? 'activo' : 'activos'}
          </Badge>
        )}
      </div>
      {repeated.length ? repeated.slice(0, 8).map(row) : <p className="small muted">Todavía no repites ningún error. Cada test lo vuelve a medir.</p>}
      {recent.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 12 }}>
            Recientes
          </div>
          {recent.map(row)}
        </>
      )}
    </div>
  );
}

function ScoreChart({ tests }: { tests: LearningTest[] }) {
  const data = tests.slice(-12);
  const W = 320;
  const H = 120;
  const pad = { t: 12, b: 18, l: 24, r: 4 };
  const slot = (W - pad.l - pad.r) / Math.max(data.length, 1);
  const bw = Math.min(22, Math.max(6, slot - 4));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / 100);
  const base = H - pad.b;
  const every = Math.ceil(data.length / 6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="lrn-chart" role="img" aria-label={`Calificaciones de tus últimos ${data.length} tests`}>
      {[50, 100].map((g) => (
        <g key={g}>
          <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} />
          <text x={pad.l - 4} y={y(g) + 3} textAnchor="end">
            {g}
          </text>
        </g>
      ))}
      <line x1={pad.l} x2={W - pad.r} y1={base} y2={base} stroke="var(--line)" />
      {data.map((t, i) => {
        const x = pad.l + i * slot + (slot - bw) / 2;
        const h = Math.max(2, base - y(t.pct));
        const r = Math.min(4, bw / 2, h);
        // Barra con las esquinas de arriba redondeadas, anclada a la base.
        const d = `M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + bw - r} Q${x + bw},${base - h} ${x + bw},${base - h + r} V${base} Z`;
        const last = i === data.length - 1;
        return (
          <g key={t.eventId}>
            <title>{`${fmtDate(t.date)} · ${LEARNING_TEST_SOURCE_NAMES[t.source]}: ${t.score}/${t.total} (${t.pct}%)${t.level ? ` · ${t.level}` : ''}`}</title>
            <rect className="hit" x={pad.l + i * slot} y={pad.t} width={slot} height={base - pad.t} />
            <path className={`col ${last ? 'last' : ''}`} d={d} />
            {last && (
              <text x={x + bw / 2} y={base - h - 4} textAnchor="middle" style={{ fill: 'var(--text)', fontWeight: 700 }}>
                {t.pct}%
              </text>
            )}
            {i % every === 0 && (
              <text x={x + bw / 2} y={H - 5} textAnchor="middle">
                {fmtDate(t.date)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function ResultsCard({ tests, st }: { tests: LearningTest[]; st: LearningTopicState | undefined }) {
  if (!tests.length) return null;
  // Los tests con IA miden tu nivel; si todavía no hay, se muestran todas las sesiones (tarjetas y voz).
  const ia = tests.filter((t) => t.source === 'ia');
  const shown = ia.length ? ia : tests;
  const first = shown[0];
  const last = shown.at(-1)!;
  const best = Math.max(...shown.map((t) => t.pct));
  const n = (s: 'tarjetas' | 'voz') => tests.filter((t) => t.source === s).length;
  const others = [n('tarjetas') ? `${n('tarjetas')} de tarjetas` : '', n('voz') ? `${n('voz')} en voz alta` : ''].filter(Boolean).join(' y ');
  return (
    <div className="card">
      <div className="card-head">
        <h2>{ia.length ? 'Tus tests con IA' : 'Tus sesiones'}</h2>
        <span className="tiny muted">{shown.length}</span>
      </div>
      {shown.length >= 2 ? <ScoreChart tests={shown} /> : <p className="small muted">Con dos {ia.length ? 'tests' : 'sesiones'} o más verás tu curva aquí.</p>}
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
        <div className="stat-tile">
          <span>Último</span>
          <b className="num">{last.pct}%</b>
        </div>
        <div className="stat-tile">
          <span>Mejor</span>
          <b className="num">{best}%</b>
        </div>
        <div className="stat-tile">
          <span>Nivel IA</span>
          <b className="num">{st?.estimatedLevel ?? '—'}</b>
        </div>
      </div>
      <p className="tiny muted" style={{ marginTop: 8 }}>
        {shown.length >= 2 ? `Empezaste en ${first.pct}% (${fmtDate(first.date, true)}) y el último fue ${last.pct}%.` : ''}
        {ia.length && others ? ` Además: ${others}.` : ''}
      </p>
    </div>
  );
}

function ItemList({ ids, items, topic, onOpen, tab }: { ids: string[]; items: Entity<LearningItemData>[]; topic: Entity<LearningTopicData>; onOpen: (e: Entity<LearningItemData>) => void; tab: ListTab }) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const shown = ids.map((id) => byId.get(id)).filter((x): x is Entity<LearningItemData> => !!x);
  const [limit, setLimit] = useState(40);
  if (!shown.length)
    return (
      <p className="small muted">
        {tab === 'struggling' ? 'Nada te está costando ahora. Bien.' : tab === 'known' ? 'Aún nada en "Lo sé": llega con repasos espaciados (unos 7 días).' : tab === 'fresh' ? 'No hay nuevas.' : 'Nada aquí todavía.'}
      </p>
    );
  const dot = tab === 'known' ? 'lo_se' : tab === 'struggling' ? 'hard' : tab === 'learning' ? 'aprendiendo' : '';
  return (
    <>
      {shown.slice(0, limit).map((i) => (
        <div key={i.id} className="lrn-item">
          <span className={`lrn-dot ${dot}`} />
          <div className="lrn-item-main" onClick={() => onOpen(i)}>
            <div className="lrn-item-text">{i.data.text}</div>
            {i.data.meaning && <div className="lrn-item-meaning">{i.data.meaning}</div>}
          </div>
          {isLanguage(topic) && speakSupported() && (
            <button className="btn icon ghost" onClick={() => speak(i.data.text, voiceLang(topic))} aria-label={`Escuchar ${i.data.text}`}>
              <Icon name="volume" />
            </button>
          )}
        </div>
      ))}
      {shown.length > limit && (
        <button className="btn sm ghost block" onClick={() => setLimit((l) => l + 60)}>
          Ver más ({shown.length - limit})
        </button>
      )}
    </>
  );
}

// =============================================================================================
// Hojas: frase y tema
// =============================================================================================

function ItemSheet({ topic, value, items, onClose }: { topic: Entity<LearningTopicData>; value: Entity<LearningItemData> | Partial<LearningItemData>; items: Entity<LearningItemData>[]; onClose: () => void }) {
  const { state } = useGame();
  const existing = 'id' in value && 'module' in value ? (value as Entity<LearningItemData>) : null;
  const init: LearningItemData = existing
    ? existing.data
    : { topicId: topic.id, itemType: 'frase', text: '', meaning: '', tags: [], origin: 'manual', ...(value as Partial<LearningItemData>) };
  const [d, setD] = useState<LearningItemData>({ ...init, tags: [...(init.tags ?? [])] });
  const card = existing ? state.learning.cards[existing.id] : undefined;
  const lang = isLanguage(topic);
  const dup = items.find((i) => i.id !== existing?.id && normalizeLearningText(i.data.text) === normalizeLearningText(d.text));
  const valid = d.text.trim() && d.meaning.trim() && !dup;
  const save = () => {
    const data: LearningItemData = { ...d, text: d.text.trim(), meaning: d.meaning.trim(), example: d.example?.trim() || undefined };
    saveEntity<LearningItemData>({ id: existing?.id ?? itemId(), module: 'learning', kind: 'item', data, sort: existing?.sort });
    onClose();
  };
  const remove = () => {
    if (!existing || !confirmAction('¿Borrar esta frase? Su historial de repasos se conserva.')) return;
    deleteEntity(existing.id);
    undoToast('Frase borrada', () => saveEntity(existing));
    onClose();
  };
  const toggleTag = (t: string) => setD((x) => ({ ...x, tags: x.tags.includes(t) ? x.tags.filter((y) => y !== t) : [...x.tags, t].slice(0, 6) }));
  const status = !card || card.status === 'nuevo' ? 'Nueva' : card.status === 'lo_se' ? 'Lo sabes' : card.struggling ? 'Te cuesta' : 'Aprendiendo';
  return (
    <Sheet
      open
      onClose={onClose}
      title={existing ? 'Editar' : lang ? 'Nueva frase' : 'Nuevo concepto'}
      actions={
        <>
          {existing && (
            <button className="btn danger" onClick={remove}>
              <Icon name="trash" />
            </button>
          )}
          <button className="btn primary" disabled={!valid} onClick={save}>
            Guardar
          </button>
        </>
      }
    >
      {existing && (
        <p className="tiny muted" style={{ marginTop: -6 }}>
          {status}
          {card && card.status !== 'nuevo' ? ` · ${card.reviews} repasos · ${card.due && card.due > state.today ? `siguiente ${fmtDate(card.due)}` : 'toca repasar'}` : ''}
        </p>
      )}
      <Field label={lang ? `En ${langName(topic)}` : 'Concepto'}>
        <input className="input" value={d.text} maxLength={300} lang={lang ? voiceLang(topic) : 'es'} autoCapitalize="off" onChange={(e) => setD({ ...d, text: e.target.value })} />
      </Field>
      {dup && <p className="small" style={{ color: 'var(--flame)', marginTop: -6 }}>Ya la tienes: "{dup.data.text}".</p>}
      <Field label={lang ? 'Qué significa (español)' : 'Qué es / cómo lo explicarías'}>
        <input className="input" value={d.meaning} onChange={(e) => setD({ ...d, meaning: e.target.value })} />
      </Field>
      <Field label="Ejemplo (opcional)">
        <input className="input" value={d.example ?? ''} lang={lang ? voiceLang(topic) : 'es'} onChange={(e) => setD({ ...d, example: e.target.value })} />
      </Field>
      <Field label="Tipo">
        <div className="chips">
          {LEARNING_ITEM_TYPES.map((t) => (
            <button key={t} type="button" className={`chip ${d.itemType === t ? 'on' : ''}`} onClick={() => setD({ ...d, itemType: t })}>
              {ITEM_TYPE_NAMES[t]}
            </button>
          ))}
        </div>
      </Field>
      {lang && (
        <Field label="Etiquetas">
          <div className="chips">
            {[...new Set([...ITEM_TAGS, ...d.tags])].map((t) => (
              <button key={t} type="button" className={`chip ${d.tags.includes(t) ? 'on' : ''}`} onClick={() => toggleTag(t)}>
                {t}
              </button>
            ))}
          </div>
        </Field>
      )}
    </Sheet>
  );
}

function TopicSheet({ topic, existing, onClose, onSaved }: { topic: Entity<LearningTopicData> | null; existing: Entity<LearningTopicData>[]; onClose: () => void; onSaved: (id: string) => void }) {
  // Sin idioma de voz de entrada: se deduce del nombre ("Francés" → francés) hasta que eliges uno.
  const [d, setD] = useState<LearningTopicData>(topic?.data ?? { name: '', topicKind: 'idioma', level: null, goal: '' });
  const voice = d.lang || inferLearningLang(d.name) || 'en-US';
  const dup = existing.find((t) => t.id !== topic?.id && normalizeLearningText(t.data.name) === normalizeLearningText(d.name));
  const save = () => {
    const id = topic?.id ?? `lt-${newId().replace(/-/g, '').slice(0, 8)}`;
    const data: LearningTopicData = {
      ...d,
      name: d.name.trim(),
      goal: d.goal?.trim() || undefined,
      lang: d.topicKind === 'idioma' ? voice : undefined,
      level: d.level?.trim() || null,
    };
    saveEntity<LearningTopicData>({ id, module: 'learning', kind: 'topic', data, sort: topic?.sort });
    onSaved(id);
    onClose();
  };
  const archive = () => {
    if (!topic || !confirmAction(`¿Archivar "${topic.data.name}"? Se oculta; su XP, frases y tests se conservan.`)) return;
    saveEntity({ ...topic, data: { ...topic.data, archived: true } });
    undoToast('Tema archivado', () => saveEntity(topic));
    onClose();
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={topic ? 'Editar tema' : 'Nuevo tema'}
      actions={
        <>
          {topic && (
            <button className="btn ghost" onClick={archive}>
              Archivar
            </button>
          )}
          <button className="btn primary" disabled={!d.name.trim() || !!dup} onClick={save}>
            Guardar
          </button>
        </>
      }
    >
      <Field label="Nombre">
        <input className="input" value={d.name} maxLength={80} placeholder="Ej. Inglés, Francés, Finanzas corporativas" onChange={(e) => setD({ ...d, name: e.target.value })} />
      </Field>
      {dup && <p className="small" style={{ color: 'var(--flame)', marginTop: -6 }}>Ya tienes un tema con ese nombre.</p>}
      <Field label="Tipo">
        <div className="chips">
          {LEARNING_TOPIC_KINDS.map((k) => (
            <button key={k} type="button" className={`chip ${d.topicKind === k ? 'on' : ''}`} onClick={() => setD({ ...d, topicKind: k, level: k === 'idioma' && d.level && !(CEFR_LEVELS as readonly string[]).includes(d.level) ? null : d.level })}>
              {LEARNING_TOPIC_KIND_NAMES[k]}
            </button>
          ))}
        </div>
      </Field>
      <Field label={d.topicKind === 'idioma' ? 'Tu nivel (autoevaluado)' : 'Tu nivel (opcional)'}>
        {d.topicKind === 'idioma' ? (
          <div className="chips">
            {CEFR_LEVELS.map((l) => (
              <button key={l} type="button" className={`chip ${d.level === l ? 'on' : ''}`} onClick={() => setD({ ...d, level: d.level === l ? null : l })}>
                {l}
              </button>
            ))}
          </div>
        ) : (
          <input className="input" value={d.level ?? ''} maxLength={12} placeholder="Básico, intermedio…" onChange={(e) => setD({ ...d, level: e.target.value })} />
        )}
      </Field>
      {d.topicKind === 'idioma' && (
        <Field label="Voz (para escuchar y practicar en voz alta)">
          <div className="chips">
            {[...LEARNING_VOICE_LANGS.map((l) => l.code as string), ...(LEARNING_VOICE_LANGS.some((l) => l.code === voice) ? [] : [voice])].map((code) => (
              <button key={code} type="button" className={`chip ${voice === code ? 'on' : ''}`} onClick={() => setD({ ...d, lang: code })}>
                {voiceLabel(code)}
              </button>
            ))}
          </div>
        </Field>
      )}
      <Field label="¿Para qué lo aprendes?">
        <input className="input" value={d.goal ?? ''} maxLength={300} placeholder="Ej. Negociar y presentar en inglés" onChange={(e) => setD({ ...d, goal: e.target.value })} />
      </Field>
      <Field label="La XP de practicar suma a">
        <AttrChips value={d.attribute ?? (L.attribute as 'inteligencia')} onChange={(attribute) => setD({ ...d, attribute })} />
      </Field>
    </Sheet>
  );
}
