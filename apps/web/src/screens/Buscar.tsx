import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EVENT_LABELS, type EventType } from '@igv/core';
import { useGame } from '../data/store';
import { fmtDate } from '../lib/time';
import { Empty, PageHeader, useAutoFocus } from '../ui/kit';
import { Icon } from '../ui/icons';
import { DaySheet, describeEvent } from '../ui/DaySheet';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Dónde vive cada tipo de elemento del catálogo. */
const ROUTES: Record<string, { label: string; to: string; icon: string }> = {
  'missions/main': { label: 'Misión principal', to: '/misiones?tab=main', icon: 'target' },
  'missions/chapter': { label: 'Capítulo', to: '/misiones?tab=main', icon: 'target' },
  'missions/side': { label: 'Secundaria', to: '/misiones?tab=side', icon: 'target' },
  'missions/daily': { label: 'Diaria', to: '/misiones?tab=daily', icon: 'target' },
  'missions/event': { label: 'Evento', to: '/misiones?tab=event', icon: 'target' },
  'planner/todo': { label: 'Agenda', to: '/misiones?tab=agenda', icon: 'calendar' },
  'bosses/boss': { label: 'Gran reto', to: '/jefes', icon: 'flag' },
  'bosses/recurring': { label: 'Reto recurrente', to: '/jefes', icon: 'flag' },
  'achievements/achievement': { label: 'Logro', to: '/logros', icon: 'trophy' },
  'skills/skill': { label: 'Habilidad', to: '/habilidades', icon: 'shield' },
  'seasons/season': { label: 'Temporada', to: '/temporadas', icon: 'calendar' },
  'inventory/tool': { label: 'Herramienta', to: '/inventario', icon: 'wrench' },
  'inventory/knowledge': { label: 'Conocimiento', to: '/inventario', icon: 'book' },
  'npcs/npc': { label: 'Persona', to: '/npcs', icon: 'users' },
  'npcs/guild': { label: 'Círculo', to: '/npcs', icon: 'users' },
  'map/place': { label: 'Lugar', to: '/mapa', icon: 'compass' },
  'shop/reward': { label: 'Premio', to: '/tienda', icon: 'coin' },
  'goals/goal': { label: 'Meta', to: '/metas', icon: 'target' },
  'habits/vice': { label: 'Hábito a dejar', to: '/enemigos', icon: 'shield' },
  'finance/savings': { label: 'Ahorro', to: '/inventario', icon: 'coin' },
  'library/book': { label: 'Biblioteca', to: '/biblioteca', icon: 'book' },
  'life/milestone': { label: 'Hito', to: '/vida', icon: 'star' },
};

export default function Buscar() {
  const { entities, events, state, byId } = useGame();
  const [q, setQ] = useState('');
  const [day, setDay] = useState<string | null>(null);
  const ref = useAutoFocus<HTMLInputElement>();
  const navigate = useNavigate();
  const needle = norm(q.trim());
  const results = useMemo(() => {
    if (needle.length < 2) return { ents: [], evs: [] };
    const ents = entities
      .filter((e) => ROUTES[`${e.module}/${e.kind}`])
      .map((e) => {
        const d = e.data as Record<string, unknown>;
        const title = String(d.title ?? d.name ?? '');
        const text = norm([title, d.notes, d.goal, d.description, d.author, d.code].filter(Boolean).join(' '));
        return { e, title, hit: text.includes(needle) };
      })
      .filter((x) => x.hit && x.title)
      .slice(0, 40);
    const evs = events
      .filter((e) => !e.voidedAt)
      .map((e) => ({ e, text: describeEvent(e, state.settings.currency, byId), raw: norm(JSON.stringify(e.payload ?? {})) }))
      .filter((x) => x.raw.includes(needle))
      .sort((a, b) => (a.e.localDate < b.e.localDate ? 1 : -1))
      .slice(0, 60);
    return { ents, evs };
  }, [needle, entities, events, byId, state.settings.currency]);
  return (
    <>
      <PageHeader title="Buscar" />
      <div className="search-box">
        <Icon name="compass" width={18} />
        <input ref={ref} className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Misiones, personas, lecciones, gastos, notas…" />
      </div>
      {needle.length >= 2 && results.ents.length === 0 && results.evs.length === 0 && <Empty>Sin resultados para “{q}”.</Empty>}
      {results.ents.length > 0 && (
        <div className="card">
          <h2>En tu catálogo</h2>
          {results.ents.map(({ e, title }) => {
            const r = ROUTES[`${e.module}/${e.kind}`];
            return (
              <button key={e.id} className="item search-hit" onClick={() => navigate(r.to)}>
                <Icon name={r.icon} width={18} className="gold" />
                <div className="grow" style={{ textAlign: 'left' }}>
                  <div className="item-title">{title}</div>
                  <div className="tiny muted">{r.label}</div>
                </div>
                <Icon name="right" width={16} />
              </button>
            );
          })}
        </div>
      )}
      {results.evs.length > 0 && (
        <div className="card">
          <h2>En tu historial</h2>
          {results.evs.map(({ e, text }) => (
            <button key={e.id} className="item search-hit" onClick={() => setDay(e.localDate)}>
              <div className="grow" style={{ textAlign: 'left' }}>
                <div className="small" style={{ fontWeight: 650 }}>
                  {EVENT_LABELS[e.type as EventType] ?? e.type}
                </div>
                <div className="tiny muted ellipsis">
                  {fmtDate(e.localDate, true)} · {text}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {day && <DaySheet date={day} onClose={() => setDay(null)} onNav={setDay} />}
    </>
  );
}
