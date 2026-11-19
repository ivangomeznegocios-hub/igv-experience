import { useMemo, useState } from 'react';
import { GAME_CONFIG, lifeCellRange, lifeCellState, lifeStats, type SeasonData } from '@igv/core';
import { useGame } from '../data/store';
import { updateSettings } from '../lib/actions';
import { fmtDate, fmtNum } from '../lib/time';
import { Field, PageHeader, Sheet } from '../ui/kit';
import { Icon } from '../ui/icons';

const CELL = 10;
const GAP = 2;
const LEFT = 22;
const TOP = 14;

export default function Vida() {
  const { state } = useGame();
  const [edit, setEdit] = useState(false);
  const birth = state.settings.birthDate;
  const { list } = useGame();
  // Temporada actual; si aún no empieza ninguna, la próxima.
  const season =
    state.seasons.current ??
    list<SeasonData>('seasons', 'season')
      .filter((x) => x.data.startDate > state.today)
      .sort((a, b) => (a.data.startDate < b.data.startDate ? -1 : 1))[0] ??
    null;
  const cfg = GAME_CONFIG;

  const stats = birth ? lifeStats(birth, state.today, cfg) : null;

  const grid = useMemo(() => {
    if (!birth || !stats) return null;
    const rows = cfg.life.years;
    const cols = cfg.life.weeksPerYear;
    const cells: { x: number; y: number; cls: string; title?: string }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const st = lifeCellState(r, c, stats.current);
        let cls: string = st;
        let title: string | undefined;
        if (season && Math.abs(r - stats.current.row) <= 1) {
          const { start, end } = lifeCellRange(birth, r, c, cfg);
          if (end >= season.data.startDate && start <= season.data.endDate) {
            cls = st === 'current' ? 'current' : `season-${st}`;
            title = `${fmtDate(start, true)} – ${fmtDate(end, true)} · ${season.data.name}`;
          }
        }
        cells.push({ x: LEFT + c * (CELL + GAP), y: TOP + r * (CELL + GAP), cls, title });
      }
    }
    return { cells, w: LEFT + cols * (CELL + GAP), h: TOP + rows * (CELL + GAP) };
  }, [birth, stats?.current.row, stats?.current.col, season, cfg]);

  return (
    <>
      <PageHeader
        title="Mi vida en semanas"
        right={
          <button className="btn sm ghost" onClick={() => setEdit(true)}>
            <Icon name="edit" /> Nacimiento
          </button>
        }
      />
      {!birth || !stats || !grid ? (
        <div className="card">
          <p>Para ver tu vida en semanas necesito tu fecha de nacimiento.</p>
          <button className="btn primary" onClick={() => setEdit(true)}>
            Agregar fecha de nacimiento
          </button>
        </div>
      ) : (
        <>
          <div className="grid2" style={{ marginBottom: 12 }}>
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="eyebrow">Edad</div>
              <div className="stat-big num">{stats.ageYears}</div>
              <div className="tiny muted">años</div>
            </div>
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="eyebrow">Vivido</div>
              <div className="stat-big num gold">{stats.percentLived.toFixed(1)}%</div>
              <div className="tiny muted">de {cfg.life.years} años</div>
            </div>
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="eyebrow">Semanas vividas</div>
              <div className="stat-big num">{fmtNum(stats.weeksLived)}</div>
            </div>
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="eyebrow">Semanas restantes</div>
              <div className="stat-big num violet">{fmtNum(stats.weeksRemaining)}</div>
            </div>
          </div>
          <div className="card">
            <div className="life-wrap">
              <svg className="life-svg" viewBox={`0 0 ${grid.w} ${grid.h}`} role="img" aria-label={`Cuadrícula de ${cfg.life.years} años por ${cfg.life.weeksPerYear} semanas`}>
                <style>{`
                  .lived{fill:var(--text);opacity:.82}
                  .current{fill:var(--gold)}
                  .future{fill:none;stroke:var(--line);stroke-width:1}
                  .season-lived{fill:var(--season)}
                  .season-future{fill:color-mix(in srgb,var(--season) 30%,transparent);stroke:var(--season);stroke-width:1}
                  .lbl{fill:var(--faint);font-size:8px;font-family:inherit}
                `}</style>
                {Array.from({ length: cfg.life.years / 5 + 1 }, (_, i) => i * 5)
                  .filter((y) => y < cfg.life.years)
                  .map((y) => (
                    <text key={y} className="lbl" x={0} y={TOP + y * (CELL + GAP) + CELL - 1}>
                      {y}
                    </text>
                  ))}
                {[0, 10, 20, 30, 40, 51].map((w) => (
                  <text key={w} className="lbl" x={LEFT + w * (CELL + GAP)} y={9}>
                    {w + 1}
                  </text>
                ))}
                {grid.cells.map((c, i) => (
                  <rect key={i} className={c.cls} x={c.x + 0.5} y={c.y + 0.5} width={CELL - 1} height={CELL - 1} rx={2}>
                    {c.title && <title>{c.title}</title>}
                  </rect>
                ))}
                <rect
                  x={LEFT + stats.current.col * (CELL + GAP) - 2}
                  y={TOP + stats.current.row * (CELL + GAP) - 2}
                  width={CELL + 3}
                  height={CELL + 3}
                  rx={3}
                  fill="none"
                  stroke="var(--gold)"
                  strokeWidth={1.5}
                />
              </svg>
            </div>
            <div className="legend">
              <span>
                <i style={{ background: 'var(--text)', opacity: 0.82 }} />
                Vividas
              </span>
              <span>
                <i style={{ background: 'var(--gold)' }} />
                Semana actual
              </span>
              <span>
                <i style={{ background: 'var(--season)' }} />
                {state.seasons.current ? 'Temporada actual' : `Próxima temporada (${season?.data.name ?? '—'})`}
              </span>
              <span>
                <i style={{ border: '1px solid var(--line)' }} />
                Por vivir
              </span>
            </div>
            <div className="tiny muted" style={{ marginTop: 8 }}>
              Cada fila es un año de tu vida (de cumpleaños a cumpleaños); cada casilla, una semana. Nacimiento: {fmtDate(birth, true)}.
            </div>
          </div>
        </>
      )}
      {edit && <BirthSheet onClose={() => setEdit(false)} />}
    </>
  );
}

function BirthSheet({ onClose }: { onClose: () => void }) {
  const { state } = useGame();
  const [d, setD] = useState(state.settings.birthDate ?? '');
  return (
    <Sheet
      open
      onClose={onClose}
      title="Fecha de nacimiento"
      actions={
        <button
          className="btn primary"
          disabled={!d}
          onClick={() => {
            updateSettings(state.settings, { birthDate: d });
            onClose();
          }}
        >
          Guardar
        </button>
      }
    >
      <Field label="Fecha">
        <input className="input" type="date" max={state.today} value={d} onChange={(e) => setD(e.target.value)} />
      </Field>
    </Sheet>
  );
}
