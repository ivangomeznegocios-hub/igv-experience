import { useEffect, useRef, useState } from 'react';
import { ATTRIBUTE_IDS, ATTRIBUTE_NAMES, GAME_CONFIG, type BossData, type Entity, type GameState, type MainQuestData, type MissionData } from '@igv/core';
import { api } from '../data/api';
import { useGame } from '../data/store';
import { fmtMoney } from '../lib/time';
import { PageHeader } from '../ui/kit';
import { Icon } from '../ui/icons';

type Msg = { role: 'user' | 'assistant'; content: string };

/** Resumen compacto del estado del juego para el Game Master (se calcula en tu dispositivo). */
function buildContext(state: GameState, list: <D>(m: string, k?: string) => Entity<D>[]): string {
  const lines: string[] = [];
  const s = state.settings;
  lines.push(`Jugador: ${s.name} (${s.className}). Hoy: ${state.today}.`);
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
  lines.push('\nJefes:');
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
  if (overdue.length) lines.push(`\nNPC clave sin contacto: ${overdue.map((m) => m.title.replace('Escribirle a ', '')).join(', ')}.`);
  const journal = Object.values(state.seasons.journal).sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1)).slice(0, 3);
  if (journal.length) {
    lines.push('\nÚltimas entradas del diario:');
    for (const j of journal) lines.push(`- ${j.weekStart}: pasó "${j.happened}"; aprendí "${j.learned}"; sigue "${j.next}"`);
  }
  const recent = [...state.xp.ledger].reverse().slice(0, 12);
  if (recent.length) lines.push(`\nXP reciente: ${recent.map((e) => `${e.date} ${e.label} +${e.amount}`).join('; ')}.`);
  return lines.join('\n');
}

const SUGGESTIONS = ['Propónme 3 misiones para hoy', '¿Qué jefe estoy más cerca de vencer y cómo lo remato?', 'Plan para esta semana según mi misión en foco', '¿Qué atributo estoy descuidando?'];

export default function GameMaster() {
  const { state, list } = useGame();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.gmStatus().then((s) => setEnabled(s.enabled)).catch(() => setEnabled(false));
  }, []);
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

  return (
    <>
      <PageHeader title="Game Master" eyebrow="IA · opcional" />
      {enabled === false && (
        <div className="card">
          <h2>Activa el Game Master</h2>
          <p className="small muted">
            Usa la API de Claude con tu propia clave. En el panel de Cloudflare: Workers &amp; Pages → igv-experience → Settings → Variables and Secrets → agrega el secreto <code>ANTHROPIC_API_KEY</code>. Los pasos completos están en el README.
          </p>
        </div>
      )}
      {enabled && (
        <>
          <div className="card">
            {msgs.length === 0 && (
              <>
                <p className="small muted" style={{ marginTop: 0 }}>
                  Leo tu progreso (nivel, atributos, racha, energía, jefes, misiones y diario) y te propongo misiones. Lo que propongo no se registra solo: tú decides qué crear.
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
              {msgs.map((m, i) => (
                <div key={i} className={`bubble ${m.role === 'user' ? 'me' : 'gm'}`}>
                  {m.content}
                </div>
              ))}
              {busy && <div className="bubble gm muted">El Game Master está pensando…</div>}
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
            <input className="input" placeholder="Pregúntale al Game Master…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn violet" disabled={busy || !q.trim()} aria-label="Enviar">
              <Icon name="sparkles" />
            </button>
          </form>
        </>
      )}
    </>
  );
}
