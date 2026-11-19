import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ATTRIBUTE_IDS,
  ATTRIBUTE_NAMES,
  GAME_CONFIG,
  addDays,
  type AttributeId,
  type BossData,
  type Entity,
  type GameState,
  type GoalData,
  type MainQuestData,
  type MissionData,
  type MissionSize,
  type NpcData,
  type TodoData,
  type ViceData,
} from '@igv/core';
import { api, type GmParseResult, type GmProposal } from '../data/api';
import { addEvent, useGame } from '../data/store';
import { completeMission, completeQuick, saveTodo, writeLesson } from '../lib/actions';
import { fmtMoney } from '../lib/time';
import { useVoiceInput } from '../lib/voice';
import { Icon } from '../ui/icons';
import { AttrBadge, PageHeader, SizeBadge, Tabs, toast } from '../ui/kit';
import { startQuest } from '../ui/QuestMode';

type Msg = { role: 'user' | 'assistant'; content: string };

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

/** Resumen compacto de tu progreso para el Coach (se calcula en tu dispositivo). */
function buildContext(state: GameState, list: <D>(m: string, k?: string) => Entity<D>[]): string {
  const lines: string[] = [];
  const s = state.settings;
  lines.push(`Persona: ${s.name} (${s.className}). Hoy: ${state.today}.`);
  lines.push(`Nivel ${state.level.level} (${state.level.title}), ${state.level.totalXp} XP; faltan ${state.level.nextLevelXp - state.level.totalXp} XP para el siguiente nivel.`);
  lines.push(`Racha: ${state.streak.current} días (mejor ${state.streak.best}). Días de descanso disponibles esta semana: ${state.streak.restDaysLeftThisWeek}.`);
  lines.push(`Energía hoy: ${state.energy.value ?? 'sin check-in'}${state.energy.low ? ' (BAJA)' : ''}.`);
  lines.push(`Atributos: ${ATTRIBUTE_IDS.map((a) => `${ATTRIBUTE_NAMES[a]} ${state.attributes.values[a].value}`).join(', ')}.`);
  const season = state.seasons.current;
  if (season) {
    const focus = list<MainQuestData>('missions', 'main').find((q) => q.id === season.data.focusMainQuestId);
    lines.push(`Temporada ${season.data.number} "${season.data.name}", semana ${state.seasons.currentWeek} de ${GAME_CONFIG.season.weeks}. Misión en foco: ${focus ? `${focus.data.code} ${focus.data.title}` : 'ninguna'}.`);
  }
  lines.push(`Ingreso del mes: ${fmtMoney(state.money.monthIncome)} de meta ${fmtMoney(state.money.goal)}.`);
  lines.push('\nMisiones principales:');
  for (const q of list<MainQuestData>('missions', 'main')) lines.push(`- ${q.data.code} ${q.data.title}: ${q.data.goal}`);
  lines.push('\nGrandes retos:');
  for (const b of list<BossData>('bosses', 'boss')) {
    const st = state.bosses.bosses[b.id];
    const next = st?.phases.find((p) => !p.done);
    lines.push(`- ${b.data.name}: ${st?.phasesDone ?? 0}/${b.data.phases.length} fases${st?.locked ? ' (bloqueado)' : ''}${next ? `; siguiente: ${next.title}${next.progress ? ` (${next.progress.current}/${next.progress.target} ${next.progress.unit})` : ''}` : ''}`);
  }
  const pend = list<MissionData>('missions').filter((m) => ['side', 'chapter', 'event'].includes(m.kind) && !state.missions.completions[m.id]);
  lines.push('\nMisiones pendientes:');
  for (const m of pend.slice(0, 25)) lines.push(`- [${m.data.size} · ${ATTRIBUTE_NAMES[m.data.attribute]}] ${m.data.title}`);
  lines.push('\nMenú de diarias:');
  for (const m of list<MissionData>('missions', 'daily')) lines.push(`- [${m.data.size} · ${ATTRIBUTE_NAMES[m.data.attribute]}] ${m.data.title}${m.data.recovery ? ' (recuperación)' : ''}`);
  const overdue = state.npcs.generatedMissions;
  if (overdue.length) lines.push(`\nPersonas clave sin contacto: ${overdue.map((m) => m.title.replace('Escribirle a ', '')).join(', ')}.`);
  const journal = Object.values(state.seasons.journal).sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1)).slice(0, 3);
  if (journal.length) {
    lines.push('\nÚltimas entradas del diario:');
    for (const j of journal) lines.push(`- ${j.weekStart}: pasó "${j.happened}"; aprendí "${j.learned}"; sigue "${j.next}"`);
  }
  lines.push(`\nOro: ${state.gold.balance} (para premios reales de la tienda).`);
  if (state.bounty.today) lines.push(`Misión sorpresa de hoy: ${state.bounty.today.title} (${state.bounty.today.completed ? 'cumplida' : 'pendiente'}).`);
  const goals = list<GoalData>('goals', 'goal').filter((g) => !state.goals[g.id]?.completedOn);
  if (goals.length) lines.push(`Metas: ${goals.map((g) => `${g.data.title} ${state.goals[g.id]?.current ?? 0}/${g.data.target} ${g.data.unit}`).join('; ')}.`);
  const todos = list<TodoData>('planner', 'todo').filter((t) => !state.missions.completions[t.id] && t.data.date <= addDays(state.today, 7));
  if (todos.length) lines.push(`Agenda: ${todos.map((t) => `${t.data.date} ${t.data.title}`).join('; ')}.`);
  const vices = list<ViceData>('habits', 'vice');
  if (vices.length) lines.push(`Hábitos a dejar (días sin recaída): ${vices.map((v) => `${v.data.name} ${state.vices[v.id]?.current ?? 0}`).join('; ')}.`);
  const recent = [...state.xp.ledger].reverse().slice(0, 12);
  if (recent.length) lines.push(`\nXP reciente: ${recent.map((e) => `${e.date} ${e.label} +${e.amount}`).join('; ')}.`);
  return lines.join('\n');
}

const SUGGESTIONS = ['Propónme 3 misiones para hoy', '¿Qué gran reto tengo más cerca y cómo lo cierro?', 'Plan para esta semana según mi misión en foco', '¿Qué atributo estoy descuidando?'];

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
  const [sel, setSel] = useState<Set<number>>(new Set());
  const voice = useVoiceInput((t) => setText((prev) => (prev ? `${prev} ${t}` : t)));

  const missions = list<MissionData>('missions').filter((m) => ['daily', 'side', 'event', 'chapter'].includes(m.kind) && (m.kind === 'daily' || !state.missions.completions[m.id]));
  const npcs = list<NpcData>('npcs', 'npc');
  const goals = list<GoalData>('goals', 'goal').filter((g) => !state.goals[g.id]?.completedOn);
  const catalog = () =>
    [
      'Misiones (id | título | tamaño | atributo):',
      ...missions.map((m) => `${m.id} | ${m.data.title} | ${m.data.size} | ${m.data.attribute}`),
      '',
      'Personas (id | nombre):',
      ...npcs.map((n) => `${n.id} | ${n.data.name}`),
      '',
      'Metas (id | meta | unidad):',
      ...goals.map((g) => `${g.id} | ${g.data.title} | ${g.data.unit}`),
    ].join('\n');

  const parse = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.gmParse({ text: text.trim(), today: state.today, catalog: catalog() });
      setRes(r);
      setSel(new Set(r.proposals.map((_, i) => i)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  };

  const label = (p: GmProposal): { title: string; detail: string; ok: boolean } => {
    const mission = p.matchId ? missions.find((m) => m.id === p.matchId) : undefined;
    switch (p.kind) {
      case 'mission': {
        const size = mission?.data.size ?? p.size ?? 'chica';
        const attr = mission?.data.attribute ?? p.attribute ?? 'disciplina';
        return { title: mission?.data.title ?? p.title ?? 'Misión', detail: `Misión ${size} · ${ATTRIBUTE_NAMES[attr]} · +${GAME_CONFIG.missionXp[size]} XP`, ok: !!(mission || p.title) };
      }
      case 'income':
      case 'expense':
        return { title: `${p.kind === 'income' ? 'Ingreso' : 'Gasto'} ${fmtMoney(p.amount ?? 0, state.settings.currency)}`, detail: [p.concept, p.category].filter(Boolean).join(' · '), ok: (p.amount ?? 0) > 0 };
      case 'npc': {
        const n = npcs.find((x) => x.id === p.matchId);
        return { title: `Hablé con ${n?.data.name ?? '?'}`, detail: 'Interacción con una persona', ok: !!n };
      }
      case 'lesson':
        return { title: 'Lección', detail: `${p.text ?? ''} · +${GAME_CONFIG.rewards.lesson} XP`, ok: (p.text ?? '').trim().length >= 3 };
      case 'body':
        return { title: 'Cuerpo', detail: [p.weightKg ? `${p.weightKg} kg` : '', p.workout ?? ''].filter(Boolean).join(' · '), ok: !!(p.weightKg || p.workout) };
      case 'goal': {
        const g = goals.find((x) => x.id === p.matchId);
        return { title: `Meta: ${g?.data.title ?? '?'}`, detail: `+${p.amount ?? 0} ${g?.data.unit ?? ''}`, ok: !!g && (p.amount ?? 0) > 0 };
      }
      case 'rest':
        return { title: 'Día de descanso', detail: 'No rompe la racha', ok: true };
    }
  };

  const apply = () => {
    if (!res) return;
    let n = 0;
    res.proposals.forEach((p, i) => {
      if (!sel.has(i) || !label(p).ok) return;
      const date = addDays(state.today, -Math.min(6, Math.max(0, p.daysAgo || 0)));
      const opts = { localDate: date };
      const mission = p.matchId ? missions.find((m) => m.id === p.matchId) : undefined;
      if (p.kind === 'mission') {
        if (mission) completeMission(mission, date);
        else completeQuick(p.title!, p.size ?? 'chica', p.attribute ?? 'disciplina', date);
      } else if (p.kind === 'income') addEvent('income.recorded', { amount: p.amount!, concept: p.concept ?? '', category: p.category ?? undefined }, opts);
      else if (p.kind === 'expense') addEvent('expense.recorded', { amount: p.amount!, concept: p.concept ?? '', category: p.category ?? undefined }, opts);
      else if (p.kind === 'npc') addEvent('npc.interaction', { npcId: p.matchId! }, opts);
      else if (p.kind === 'lesson') writeLesson(p.text!.trim(), null, date);
      else if (p.kind === 'body') addEvent('body.logged', { weightKg: p.weightKg ?? undefined, workout: p.workout ?? undefined }, opts);
      else if (p.kind === 'goal') addEvent('goal.progress', { goalId: p.matchId!, amount: p.amount! }, opts);
      else if (p.kind === 'rest') addEvent('rest_day.marked', {}, opts);
      n++;
    });
    toast(`${n} registro(s) guardado(s)`);
    setRes(null);
    setText('');
  };

  return (
    <>
      <div className="card">
        <p className="small muted" style={{ marginTop: 0 }}>
          Escríbelo o díctalo por voz: “Hoy fui al gym, cerré una venta de $5,000 con Grupo Norte y hablé con mi mamá”. Te propongo los registros y tú confirmas.
        </p>
        <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="¿Qué hiciste hoy?" />
        <div className="row" style={{ marginTop: 8, gap: 8 }}>
          {voice.supported && (
            <button type="button" className={`btn ${voice.listening ? 'danger' : ''}`} onClick={voice.toggle} aria-label="Dictar por voz">
              <Icon name="mic" /> {voice.listening ? 'Escuchando…' : 'Dictar'}
            </button>
          )}
          <button className="btn primary grow" disabled={busy || !text.trim()} onClick={parse}>
            <Icon name="sparkles" /> {busy ? 'Leyendo…' : 'Proponer registros'}
          </button>
        </div>
        {(err || voice.error) && <p className="small red">{err || voice.error}</p>}
      </div>
      {res && (
        <div className="card">
          <div className="bubble gm" style={{ maxWidth: '100%', marginBottom: 10 }}>
            {res.reply}
          </div>
          {res.proposals.length === 0 && <div className="small muted">No encontré nada que registrar.</div>}
          {res.proposals.map((p, i) => {
            const l = label(p);
            const on = sel.has(i) && l.ok;
            return (
              <label key={i} className="item" style={{ cursor: 'pointer', opacity: l.ok ? 1 : 0.5 }}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!l.ok}
                  onChange={() =>
                    setSel((s) => {
                      const n = new Set(s);
                      if (n.has(i)) n.delete(i);
                      else n.add(i);
                      return n;
                    })
                  }
                  style={{ width: 20, height: 20, accentColor: 'var(--gold)' }}
                />
                <div className="grow">
                  <div className="item-title">{l.title}</div>
                  <div className="tiny muted">
                    {l.detail}
                    {p.daysAgo ? ` · ${p.daysAgo === 1 ? 'ayer' : `hace ${p.daysAgo} días`}` : ''}
                  </div>
                </div>
              </label>
            );
          })}
          {res.proposals.length > 0 && (
            <button className="btn primary block" style={{ marginTop: 10 }} disabled={![...sel].some((i) => res.proposals[i] && label(res.proposals[i]).ok)} onClick={apply}>
              Registrar seleccionados
            </button>
          )}
        </div>
      )}
    </>
  );
}

function Chat() {
  const { state, list } = useGame();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const end = useRef<HTMLDivElement>(null);
  const voice = useVoiceInput((t) => setQ((prev) => (prev ? `${prev} ${t}` : t)));

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, busy]);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setErr(null);
    const history = msgs.slice(-10);
    setMsgs((m) => [...m, { role: 'user', content: question }]);
    setQ('');
    setBusy(true);
    try {
      const res = await api.gmAsk({ question, context: buildContext(state, list), history });
      setMsgs((m) => [...m, { role: 'assistant', content: res.answer }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
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
              Leo tu progreso (nivel, atributos, racha, energía, grandes retos, misiones y diario) y te propongo misiones que puedes aceptar en tu Agenda o empezar al instante.
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
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
      >
        {voice.supported && (
          <button type="button" className={`btn icon ${voice.listening ? 'danger' : ''}`} onClick={voice.toggle} aria-label="Dictar pregunta">
            <Icon name="mic" />
          </button>
        )}
        <input className="input" placeholder="Pregúntale al Coach…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn primary" disabled={busy || !q.trim()} aria-label="Enviar">
          <Icon name="sparkles" />
        </button>
      </form>
    </>
  );
}
