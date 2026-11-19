import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WeekShareCard } from '../ui/WeekShare';
import { ATTRIBUTE_NAMES, GAME_CONFIG, addDays, weekReport, weekStart, type AttributeId } from '@igv/core';
import { api } from '../data/api';
import { useGame } from '../data/store';
import { fmtDate, fmtNum, fmtWeekday } from '../lib/time';
import { Badge, PageHeader } from '../ui/kit';
import { BarChart } from '../ui/charts';
import { Icon } from '../ui/icons';

const DOW = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

function pct(a: number, b: number) {
  if (!b) return a ? '+∞' : '0%';
  const p = Math.round(((a - b) / b) * 100);
  return `${p >= 0 ? '+' : ''}${p}%`;
}

/** Reporte semanal, con resumen opcional del Coach. */
export default function Reporte() {
  const { state, events, list } = useGame();
  const [params, setParams] = useSearchParams();
  const ws = weekStart(params.get('semana') ?? state.today);
  const r = useMemo(() => weekReport(state, events, ws, GAME_CONFIG.gold.xpPerGold), [state, events, ws]);
  const [story, setStory] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = (d: number) => setParams({ semana: addDays(ws, 7 * d) }, { replace: true });
  const overdue = state.npcs.generatedMissions;
  const journal = state.seasons.journal[ws];

  const narrate = async () => {
    setBusy(true);
    setErr(null);
    try {
      const ctx = [
        `Semana del ${r.weekStart} al ${r.weekEnd}.`,
        `XP: ${r.xp} (semana anterior ${r.xpPrev}). Misiones: ${r.missions} (antes ${r.missionsPrev}). Días activos: ${r.activeDays}/7. Descansos: ${r.restDays}. Lecciones: ${r.lessons}.`,
        `XP por día (L-D): ${r.byDay.join(', ')}.`,
        `Por atributo: ${Object.entries(r.byAttribute).map(([a, x]) => `${ATTRIBUTE_NAMES[a as AttributeId]} ${x}`).join(', ') || 'nada'}.`,
        `Momentos clave: ${r.highlights.map((h) => `${h.label} (+${h.amount})`).join('; ') || 'ninguno'}.`,
        `Racha actual: ${state.streak.current}. Nivel ${state.level.level} (${state.level.title}).`,
        overdue.length ? `Personas olvidadas: ${overdue.map((m) => m.title.replace('Escribirle a ', '')).join(', ')}.` : '',
        journal ? `Diario: pasó "${journal.happened}"; aprendí "${journal.learned}"; sigue "${journal.next}".` : '',
        `Misiones de esa semana: ${state.xp.ledger.filter((e) => e.source === 'mission' && e.date >= r.weekStart && e.date <= r.weekEnd).map((e) => e.label).slice(0, 40).join('; ')}.`,
      ]
        .filter(Boolean)
        .join('\n');
      const res = await api.gmAsk({
        question:
          'Escribe el resumen de esta semana como un coach que me conoce (segunda persona, directo y cálido, máximo 180 palabras, con un título corto). Qué salió bien, qué faltó y un patrón que notes. Usa solo hechos reales del resumen. Cierra con una línea "Siguiente semana:" con la misión más importante para la semana que viene.',
        context: ctx,
        readOnly: true,
        history: [],
      });
      setStory(res.answer);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo escribir el resumen');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Reporte semanal" eyebrow={`${fmtDate(r.weekStart)} – ${fmtDate(r.weekEnd, true)}`} />
      <div className="row between" style={{ marginBottom: 10 }}>
        <button className="btn sm" onClick={() => go(-1)}>
          <Icon name="left" /> Anterior
        </button>
        <button className="btn sm" onClick={() => go(1)} disabled={addDays(ws, 7) > state.today}>
          Siguiente <Icon name="right" />
        </button>
      </div>
      <WeekShareCard monday={ws} />
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginBottom: 12 }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="eyebrow">XP</div>
          <div className="stat-big num gold">{fmtNum(r.xp)}</div>
          <div className={`tiny ${r.xp >= r.xpPrev ? 'green' : 'red'}`}>{pct(r.xp, r.xpPrev)} vs semana anterior</div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="eyebrow">Misiones</div>
          <div className="stat-big num">{r.missions}</div>
          <div className={`tiny ${r.missions >= r.missionsPrev ? 'green' : 'red'}`}>{pct(r.missions, r.missionsPrev)}</div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="eyebrow">Días activos</div>
          <div className="stat-big num">{r.activeDays}/7</div>
          <div className="tiny muted">
            {r.restDays} descanso(s) · {r.lessons} lección(es)
          </div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="eyebrow">Oro ganado</div>
          <div className="stat-big num gold">{r.gold}</div>
          <div className="tiny muted">mejor día: {r.bestDay ? `${fmtWeekday(r.bestDay.date)} (+${r.bestDay.xp})` : '—'}</div>
        </div>
      </div>
      <div className="card">
        <h2>XP por día</h2>
        <BarChart data={r.byDay.map((v, i) => ({ label: DOW[i], value: v }))} format={fmtNum} highlightLast={false} />
      </div>
      <div className="card">
        <h2>Atributos que entrenaste</h2>
        <div className="row wrap" style={{ gap: 6 }}>
          {Object.entries(r.byAttribute)
            .sort((a, b) => b[1] - a[1])
            .map(([a, x]) => (
              <Badge key={a} tone="violet">
                {ATTRIBUTE_NAMES[a as AttributeId]} +{x}
              </Badge>
            ))}
          {!Object.keys(r.byAttribute).length && <span className="small muted">Nada esta semana.</span>}
        </div>
        {r.highlights.length > 0 && (
          <>
            <div className="eyebrow" style={{ marginTop: 12 }}>
              Momentos clave
            </div>
            {r.highlights.map((h, i) => (
              <div key={i} className="item" style={{ padding: '6px 0' }}>
                <Icon name="star" width={16} className="gold" />
                <div className="grow small">{h.label}</div>
                <b className="gold num small">+{h.amount}</b>
              </div>
            ))}
          </>
        )}
        {overdue.length > 0 && (
          <p className="small" style={{ marginBottom: 0 }}>
            <Icon name="users" width={14} style={{ verticalAlign: -2 }} /> Tu gente te extraña: {overdue.map((m) => m.title.replace('Escribirle a ', '')).join(', ')}.
          </p>
        )}
      </div>
      <div className="card">
        <div className="card-head">
          <h2>Resumen de la semana</h2>
          <button className="btn sm violet" disabled={busy} onClick={narrate}>
            <Icon name="sparkles" /> {busy ? 'Escribiendo…' : story ? 'Otra versión' : 'Resumir'}
          </button>
        </div>
        {!story && !err && <p className="small muted">El Coach resume tu semana: qué salió bien, qué faltó y qué sigue (usa solo lo que registraste).</p>}
        {err && <p className="small red">{err}</p>}
        {story && <div className="story">{story}</div>}
        {list('seasons', 'season').length > 0 && !journal && addDays(ws, 6) <= state.today && <p className="tiny muted">Tip: escribe tu diario semanal en Temporadas para que el resumen tenga más contexto.</p>}
      </div>
    </>
  );
}
