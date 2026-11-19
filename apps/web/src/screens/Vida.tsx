import { useCallback, useMemo, useState } from 'react';
import {
  CALENDAR_MAX_WEEKS,
  DAY_HEAT_STEPS,
  GAME_CONFIG,
  WEEK_HEAT_STEPS,
  addDays,
  calendarCellState,
  calendarYearWeeks,
  diffDays,
  heatLevel,
  lifeCellRange,
  lifeCellState,
  lifeEndDate,
  lifeStats,
  weekday,
  xpByDate,
  type Entity,
  type MilestoneData,
  type SeasonData,
} from '@igv/core';
import { deleteEntity, saveEntity, useGame } from '../data/store';
import { updateSettings } from '../lib/actions';
import { fmtDate, fmtNum, fmtWeekday, newId } from '../lib/time';
import { Badge, Chips, Field, PageHeader, Sheet, Tabs, confirmAction } from '../ui/kit';
import { Icon } from '../ui/icons';
import { DaySheet } from '../ui/DaySheet';

const CELL = 10;
const GAP = 2;
const TOP = 16;
const MONTHS = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTHS_LONG = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DAY_LETTERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const MILESTONE_ICONS = ['star', 'flag', 'heart', 'globe', 'crown', 'book', 'home', 'trophy'];

type Mode = 'calendar' | 'birthday';
type Range = { start: string; end: string };

function readMode(): Mode {
  try {
    return (localStorage.getItem('igv-life-mode') as Mode) || 'calendar';
  } catch {
    return 'calendar';
  }
}

/** Datos compartidos por las vistas: XP por día, temporada a resaltar e hitos. */
function useLifeData() {
  const { state, list } = useGame();
  const xpDay = useMemo(() => xpByDate(state.xp.ledger), [state.xp.ledger]);
  const firstData = state.xp.ledger[0]?.date ?? null;
  const season =
    state.seasons.current ??
    list<SeasonData>('seasons', 'season')
      .filter((x) => x.data.startDate > state.today)
      .sort((a, b) => (a.data.startDate < b.data.startDate ? -1 : 1))[0] ??
    null;
  const milestones = useMemo(() => list<MilestoneData>('life', 'milestone').sort((a, b) => (a.data.date < b.data.date ? -1 : 1)), [list]);
  const rangeXp = useCallback(
    (r: Range) => {
      if (!firstData || r.end < firstData) return 0;
      let s = 0;
      for (let d = r.start < firstData ? firstData : r.start; d <= r.end; d = addDays(d, 1)) s += xpDay.get(d) ?? 0;
      return s;
    },
    [xpDay, firstData],
  );
  return { xpDay, firstData, season, milestones, rangeXp };
}

export default function Vida() {
  const { state } = useGame();
  const [edit, setEdit] = useState(false);
  const [mode, setModeState] = useState<Mode>(readMode);
  const [year, setYear] = useState<number | null>(null);
  const [week, setWeek] = useState<Range | null>(null);
  const [milestone, setMilestone] = useState<Entity<MilestoneData> | 'new' | null>(null);
  const birth = state.settings.birthDate;
  const stats = birth ? lifeStats(birth, state.today, GAME_CONFIG) : null;
  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem('igv-life-mode', m);
    } catch {
      // sin almacenamiento
    }
  };

  return (
    <>
      <PageHeader
        title={year ? `Mi año ${year}` : 'Mi vida en semanas'}
        right={
          year ? (
            <button className="btn sm ghost" onClick={() => setYear(null)}>
              <Icon name="left" /> Vida
            </button>
          ) : (
            <button className="btn sm ghost" onClick={() => setEdit(true)}>
              <Icon name="edit" /> Nacimiento
            </button>
          )
        }
      />
      {!birth || !stats ? (
        <div className="card">
          <p>Para ver tu vida en semanas necesito tu fecha de nacimiento.</p>
          <button className="btn primary" onClick={() => setEdit(true)}>
            Agregar fecha de nacimiento
          </button>
        </div>
      ) : year ? (
        <YearView year={year} birth={birth} onYear={setYear} />
      ) : (
        <>
          <LifeStatsCards birth={birth} />
          <Tabs
            value={mode}
            onChange={setMode}
            options={[
              { value: 'calendar', label: 'Por año calendario' },
              { value: 'birthday', label: 'Por cumpleaños' },
            ]}
          />
          {mode === 'calendar' ? <CalendarGrid birth={birth} onWeek={setWeek} onYear={setYear} /> : <BirthdayGrid birth={birth} onWeek={setWeek} />}
          <MilestonesCard onEdit={setMilestone} />
        </>
      )}
      {week && <WeekSheet range={week} onClose={() => setWeek(null)} onYear={(y) => (setWeek(null), setYear(y))} />}
      {milestone && <MilestoneSheet initial={milestone === 'new' ? null : milestone} onClose={() => setMilestone(null)} />}
      {edit && <BirthSheet onClose={() => setEdit(false)} />}
    </>
  );
}

function LifeStatsCards({ birth }: { birth: string }) {
  const { state } = useGame();
  const stats = lifeStats(birth, state.today, GAME_CONFIG);
  const y = Number(state.today.slice(0, 4));
  const weeksLeftYear = calendarYearWeeks(y).filter((w) => w.start > state.today).length;
  const daysLeftYear = diffDays(state.today, `${y}-12-31`);
  return (
    <div className="grid2" style={{ marginBottom: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
      <div className="card" style={{ marginBottom: 0 }}>
        <div className="eyebrow">Edad</div>
        <div className="stat-big num">{stats.ageYears}</div>
        <div className="tiny muted">{stats.percentLived.toFixed(1)}% de {GAME_CONFIG.life.years} años</div>
      </div>
      <div className="card" style={{ marginBottom: 0 }}>
        <div className="eyebrow">Semanas vividas</div>
        <div className="stat-big num">{fmtNum(stats.weeksLived)}</div>
        <div className="tiny muted">quedan {fmtNum(stats.weeksRemaining)}</div>
      </div>
      <div className="card" style={{ marginBottom: 0 }}>
        <div className="eyebrow">Quedan en {y}</div>
        <div className="stat-big num violet">{weeksLeftYear}</div>
        <div className="tiny muted">semanas · {daysLeftYear} días</div>
      </div>
    </div>
  );
}

const GRID_STYLE = `
  .lived{fill:var(--text);opacity:.8}
  .current{fill:var(--gold)}
  .future{fill:none;stroke:var(--line);stroke-width:1}
  .h1{fill:color-mix(in srgb,var(--green) 35%,var(--card-2))}
  .h2{fill:color-mix(in srgb,var(--green) 60%,var(--card-2))}
  .h3{fill:color-mix(in srgb,var(--green) 82%,var(--card-2))}
  .h4{fill:var(--green)}
  .season-lived{fill:var(--season)}
  .season-future{fill:color-mix(in srgb,var(--season) 30%,transparent);stroke:var(--season);stroke-width:1}
  .ms{fill:none;stroke:var(--gold);stroke-width:1.6}
  .lbl{fill:var(--faint);font-size:8px;font-family:inherit}
  .lbl.now{fill:var(--gold);font-weight:700}
  .hit{fill:transparent;cursor:pointer}
`;

function CalendarGrid({ birth, onWeek, onYear }: { birth: string; onWeek: (r: Range) => void; onYear: (y: number) => void }) {
  const { state } = useGame();
  const { season, milestones, rangeXp } = useLifeData();
  const LEFT = 30;
  const end = lifeEndDate(birth, GAME_CONFIG);
  const by = Number(birth.slice(0, 4));
  const ey = Number(end.slice(0, 4));
  const ty = Number(state.today.slice(0, 4));
  const grid = useMemo(() => {
    const cells: { x: number; y: number; cls: string; title: string; range: Range; ms: boolean }[] = [];
    for (let year = by; year <= ey; year++) {
      const r = year - by;
      calendarYearWeeks(year).forEach((w, c) => {
        const st = calendarCellState(w, birth, state.today, end);
        if (st === 'before' || st === 'after') return;
        let cls: string = st;
        let title = `${fmtDate(w.start, true)} – ${fmtDate(w.end, true)}`;
        if (st === 'lived') {
          const h = heatLevel(rangeXp(w), WEEK_HEAT_STEPS);
          if (h) cls = `h${h}`;
        }
        if (season && w.end >= season.data.startDate && w.start <= season.data.endDate && st !== 'current') {
          cls = st === 'future' ? 'season-future' : 'season-lived';
          title += ` · ${season.data.name}`;
        }
        const ms = milestones.filter((m) => m.data.date >= w.start && m.data.date <= w.end);
        if (ms.length) title += ` · ${ms.map((m) => m.data.title).join(', ')}`;
        cells.push({ x: LEFT + c * (CELL + GAP), y: TOP + r * (CELL + GAP), cls, title, range: { start: w.start, end: w.end }, ms: ms.length > 0 });
      });
    }
    return { cells, w: LEFT + CALENDAR_MAX_WEEKS * (CELL + GAP), h: TOP + (ey - by + 1) * (CELL + GAP) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [birth, by, ey, end, state.today, season, milestones, rangeXp]);
  // Columna aproximada en la que empieza cada mes (con el año en curso como referencia).
  const monthCols = useMemo(() => {
    const weeks = calendarYearWeeks(ty);
    return MONTHS.map((m, i) => {
      const first = `${ty}-${String(i + 1).padStart(2, '0')}-01`;
      return { m, c: weeks.findIndex((w) => w.start <= first && first <= w.end) };
    });
  }, [ty]);

  return (
    <div className="card">
      <div className="life-wrap">
        <svg className="life-svg" viewBox={`0 0 ${grid.w} ${grid.h}`} role="img" aria-label="Tu vida por año calendario: cada fila es un año y cada casilla una semana de lunes a domingo">
          <style>{GRID_STYLE}</style>
          {monthCols.map(({ m, c }, i) => (
            <text key={i} className="lbl" x={LEFT + c * (CELL + GAP)} y={10}>
              {m}
            </text>
          ))}
          {Array.from({ length: ey - by + 1 }, (_, r) => by + r)
            .filter((y) => y === by || y % 5 === 0 || y === ty)
            .map((y) => (
              <text key={y} className={`lbl ${y === ty ? 'now' : ''}`} x={0} y={TOP + (y - by) * (CELL + GAP) + CELL - 1} onClick={() => onYear(y)} style={{ cursor: 'pointer' }}>
                {y}
              </text>
            ))}
          {grid.cells.map((c, i) => (
            <g key={i} onClick={() => onWeek(c.range)}>
              <rect className={c.cls} x={c.x + 0.5} y={c.y + 0.5} width={CELL - 1} height={CELL - 1} rx={2}>
                <title>{c.title}</title>
              </rect>
              {c.ms && <rect className="ms" x={c.x - 0.5} y={c.y - 0.5} width={CELL + 1} height={CELL + 1} rx={3} />}
              <rect className="hit" x={c.x} y={c.y} width={CELL} height={CELL} />
            </g>
          ))}
        </svg>
      </div>
      <Legend />
      <div className="tiny muted" style={{ marginTop: 8 }}>
        Cada fila es un año calendario (enero a diciembre) y cada casilla una semana de lunes a domingo. Toca una semana para ver sus 7 días, o un año para verlo completo.
      </div>
      <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
        {[ty - 1, ty, ty + 1].map((y) => (
          <button key={y} className="btn sm" onClick={() => onYear(y)}>
            Ver {y}
          </button>
        ))}
      </div>
    </div>
  );
}

function Legend() {
  const { state } = useGame();
  const { season } = useLifeData();
  return (
    <div className="legend">
      <span>
        <i style={{ background: 'var(--text)', opacity: 0.8 }} />
        Vividas
      </span>
      <span>
        <i style={{ background: 'var(--green)' }} />
        Con XP (más intenso = más XP)
      </span>
      <span>
        <i style={{ background: 'var(--gold)' }} />
        Semana actual
      </span>
      {season && (
        <span>
          <i style={{ background: 'var(--season)' }} />
          {state.seasons.current ? 'Temporada actual' : `Próxima temporada (${season.data.name})`}
        </span>
      )}
      <span>
        <i style={{ border: '1.5px solid var(--gold)' }} />
        Hito
      </span>
      <span>
        <i style={{ border: '1px solid var(--line)' }} />
        Por vivir
      </span>
    </div>
  );
}

function BirthdayGrid({ birth, onWeek }: { birth: string; onWeek: (r: Range) => void }) {
  const { state } = useGame();
  const { season, milestones, rangeXp } = useLifeData();
  const LEFT = 22;
  const cfg = GAME_CONFIG;
  const stats = lifeStats(birth, state.today, cfg);
  const grid = useMemo(() => {
    const cells: { x: number; y: number; cls: string; title: string; range: Range; ms: boolean }[] = [];
    for (let r = 0; r < cfg.life.years; r++) {
      for (let c = 0; c < cfg.life.weeksPerYear; c++) {
        const st = lifeCellState(r, c, stats.current);
        const range = lifeCellRange(birth, r, c, cfg);
        let cls: string = st;
        let title = `${fmtDate(range.start, true)} – ${fmtDate(range.end, true)}`;
        if (st === 'lived') {
          const h = heatLevel(rangeXp(range), WEEK_HEAT_STEPS);
          if (h) cls = `h${h}`;
        }
        if (season && range.end >= season.data.startDate && range.start <= season.data.endDate && st !== 'current') {
          cls = st === 'future' ? 'season-future' : 'season-lived';
          title += ` · ${season.data.name}`;
        }
        const ms = milestones.filter((m) => m.data.date >= range.start && m.data.date <= range.end);
        if (ms.length) title += ` · ${ms.map((m) => m.data.title).join(', ')}`;
        cells.push({ x: LEFT + c * (CELL + GAP), y: TOP + r * (CELL + GAP), cls, title, range, ms: ms.length > 0 });
      }
    }
    return { cells, w: LEFT + cfg.life.weeksPerYear * (CELL + GAP), h: TOP + cfg.life.years * (CELL + GAP) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [birth, stats.current.row, stats.current.col, season, milestones, rangeXp]);
  return (
    <div className="card">
      <div className="life-wrap">
        <svg className="life-svg" viewBox={`0 0 ${grid.w} ${grid.h}`} role="img" aria-label={`Cuadrícula de ${cfg.life.years} años por ${cfg.life.weeksPerYear} semanas, de cumpleaños a cumpleaños`}>
          <style>{GRID_STYLE}</style>
          {Array.from({ length: cfg.life.years / 5 + 1 }, (_, i) => i * 5)
            .filter((y) => y < cfg.life.years)
            .map((y) => (
              <text key={y} className="lbl" x={0} y={TOP + y * (CELL + GAP) + CELL - 1}>
                {y}
              </text>
            ))}
          {[0, 10, 20, 30, 40, 51].map((w) => (
            <text key={w} className="lbl" x={LEFT + w * (CELL + GAP)} y={10}>
              {w + 1}
            </text>
          ))}
          {grid.cells.map((c, i) => (
            <g key={i} onClick={() => onWeek(c.range)}>
              <rect className={c.cls} x={c.x + 0.5} y={c.y + 0.5} width={CELL - 1} height={CELL - 1} rx={2}>
                <title>{c.title}</title>
              </rect>
              {c.ms && <rect className="ms" x={c.x - 0.5} y={c.y - 0.5} width={CELL + 1} height={CELL + 1} rx={3} />}
              <rect className="hit" x={c.x} y={c.y} width={CELL} height={CELL} />
            </g>
          ))}
        </svg>
      </div>
      <Legend />
      <div className="tiny muted" style={{ marginTop: 8 }}>
        Cada fila es un año de tu vida (de cumpleaños a cumpleaños); cada casilla, una semana. Nacimiento: {fmtDate(birth, true)}.
      </div>
    </div>
  );
}

/** Zoom a un año: cada semana es un rectángulo dividido en sus 7 días. */
function YearView({ year, birth, onYear }: { year: number; birth: string; onYear: (y: number) => void }) {
  const { state } = useGame();
  const { xpDay, milestones } = useLifeData();
  const [day, setDay] = useState<string | null>(null);
  const weeks = calendarYearWeeks(year);
  const end = lifeEndDate(birth, GAME_CONFIG);
  const yearXp = [...xpDay.entries()].filter(([d]) => d.startsWith(String(year))).reduce((s, [, x]) => s + x, 0);
  const activeDays = [...xpDay.entries()].filter(([d, x]) => d.startsWith(String(year)) && x > 0).length;
  const lived = weeks.filter((w) => w.end < state.today).length;
  let lastMonth = -1;
  return (
    <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <button className="btn sm" onClick={() => onYear(year - 1)}>
          <Icon name="left" /> {year - 1}
        </button>
        <div className="small muted">
          {lived}/{weeks.length} semanas · +{fmtNum(yearXp)} XP · {activeDays} días activos
        </div>
        <button className="btn sm" onClick={() => onYear(year + 1)}>
          {year + 1} <Icon name="right" />
        </button>
      </div>
      <div className="card year-view">
        <div className="yw-row yw-head">
          <span />
          <div className="yw-days">
            {DAY_LETTERS.map((l, i) => (
              <span key={i}>{l}</span>
            ))}
          </div>
          <span />
        </div>
        {weeks.map((w, wi) => {
          const days = Array.from({ length: 7 }, (_, i) => addDays(w.monday, i));
          const m = Number(w.start.slice(5, 7)) - 1;
          const showMonth = m !== lastMonth;
          lastMonth = m;
          const wxp = days.filter((d) => d >= w.start && d <= w.end).reduce((s, d) => s + (xpDay.get(d) ?? 0), 0);
          const isCurrent = w.start <= state.today && state.today <= w.end;
          const ms = milestones.filter((x) => x.data.date >= w.start && x.data.date <= w.end);
          return (
            <div key={wi}>
              {showMonth && <div className="yw-month">{MONTHS_LONG[m]}</div>}
              <div className={`yw-row ${isCurrent ? 'current' : ''}`}>
                <span className="yw-label">S{wi + 1}</span>
                <div className="yw-days">
                  {days.map((d) => {
                    const out = d < w.start || d > w.end;
                    const before = d < birth || d > end;
                    const future = d > state.today;
                    const h = heatLevel(xpDay.get(d) ?? 0, DAY_HEAT_STEPS);
                    const cls = out ? 'out' : before ? 'none' : d === state.today ? 'today' : future ? 'future' : h ? `h${h}` : 'lived';
                    const hasMs = ms.some((x) => x.data.date === d);
                    return (
                      <button key={d} className={`yw-day ${cls} ${hasMs ? 'ms' : ''}`} disabled={out || before} onClick={() => setDay(d)} title={`${fmtWeekday(d)} ${fmtDate(d, true)}${xpDay.get(d) ? ` · +${xpDay.get(d)} XP` : ''}`}>
                        {out ? '' : Number(d.slice(8))}
                      </button>
                    );
                  })}
                </div>
                <span className="yw-xp num">{wxp > 0 ? `+${wxp}` : ''}</span>
              </div>
            </div>
          );
        })}
        <div className="legend">
          <span>
            <i style={{ background: 'var(--card-2)', border: '1px solid var(--line)' }} />
            Sin XP
          </span>
          <span>
            <i style={{ background: 'color-mix(in srgb,var(--green) 45%,var(--card-2))' }} />
            Poca XP
          </span>
          <span>
            <i style={{ background: 'var(--green)' }} />
            Mucha XP
          </span>
          <span>
            <i style={{ background: 'var(--gold)' }} />
            Hoy
          </span>
        </div>
      </div>
      {day && <DaySheet date={day} onClose={() => setDay(null)} onNav={setDay} />}
    </>
  );
}

/** Una semana: sus 7 días con XP, misiones, descanso y ánimo. */
function WeekSheet({ range, onClose, onYear }: { range: Range; onClose: () => void; onYear: (y: number) => void }) {
  const { state, events } = useGame();
  const { xpDay, milestones } = useLifeData();
  const [day, setDay] = useState<string | null>(null);
  const days: string[] = [];
  for (let d = range.start; d <= range.end; d = addDays(d, 1)) days.push(d);
  const rest = new Set(events.filter((e) => !e.voidedAt && e.type === 'rest_day.marked').map((e) => e.localDate));
  const missionsBy = new Map<string, number>();
  for (const e of state.xp.ledger) if (e.source === 'mission') missionsBy.set(e.date, (missionsBy.get(e.date) ?? 0) + 1);
  const total = days.reduce((s, d) => s + (xpDay.get(d) ?? 0), 0);
  const ms = milestones.filter((m) => m.data.date >= range.start && m.data.date <= range.end);
  const MOODS = ['😫', '😕', '😐', '🙂', '🔥'];
  if (day) return <DaySheet date={day} onClose={() => setDay(null)} />;
  return (
    <Sheet open onClose={onClose} title={`Semana del ${fmtDate(range.start)} al ${fmtDate(range.end, true)}`}>
      <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
        <Badge tone="gold">+{fmtNum(total)} XP</Badge>
        {ms.map((m) => (
          <Badge key={m.id} tone="gold">
            <Icon name={m.data.icon ?? 'star'} width={12} /> {m.data.title}
          </Badge>
        ))}
      </div>
      <div className="week-days">
        {days.map((d) => {
          const x = xpDay.get(d) ?? 0;
          const future = d > state.today;
          const h = heatLevel(x, DAY_HEAT_STEPS);
          const mood = state.dayClosures[d]?.mood;
          return (
            <button key={d} className={`week-day ${future ? 'future' : h ? `h${h}` : ''} ${d === state.today ? 'today' : ''}`} onClick={() => setDay(d)}>
              <span className="wd-name">{DAY_LETTERS[weekday(d)]}</span>
              <b>{Number(d.slice(8))}</b>
              <span className="wd-xp num">{future ? '' : x ? `+${x}` : rest.has(d) ? '💤' : '·'}</span>
              <span className="wd-meta">{missionsBy.get(d) ? `${missionsBy.get(d)} ✓` : ''}{mood ? ` ${MOODS[mood - 1]}` : ''}</span>
            </button>
          );
        })}
      </div>
      <p className="tiny muted">Toca un día para ver qué hiciste, corregir o registrar algo en ese día.</p>
      <button className="btn block" onClick={() => onYear(Number(range.start.slice(0, 4)))}>
        <Icon name="calendar" /> Ver el año {range.start.slice(0, 4)} completo
      </button>
    </Sheet>
  );
}

function MilestonesCard({ onEdit }: { onEdit: (m: Entity<MilestoneData> | 'new') => void }) {
  const { milestones } = useLifeData();
  return (
    <div className="card">
      <div className="card-head">
        <h2>Hitos de vida</h2>
        <button className="btn sm ghost" onClick={() => onEdit('new')}>
          <Icon name="plus" /> Hito
        </button>
      </div>
      {milestones.length === 0 && <div className="small muted">Marca semanas importantes: mudanzas, tu empresa, viajes, nacimientos… Se ven con un borde dorado en la cuadrícula.</div>}
      {milestones.map((m) => (
        <div key={m.id} className="item" style={{ cursor: 'pointer' }} onClick={() => onEdit(m)}>
          <Icon name={m.data.icon ?? 'star'} width={20} className="gold" />
          <div className="grow">
            <div className="item-title">{m.data.title}</div>
            <div className="tiny muted">{fmtDate(m.data.date, true)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MilestoneSheet({ initial, onClose }: { initial: Entity<MilestoneData> | null; onClose: () => void }) {
  const { state } = useGame();
  const [d, setD] = useState<MilestoneData>(initial?.data ?? { title: '', date: state.today, icon: 'star' });
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Editar hito' : 'Nuevo hito'}
      actions={
        <>
          {initial && (
            <button className="btn ghost danger" onClick={() => confirmAction('¿Borrar este hito?') && (deleteEntity(initial.id), onClose())}>
              Borrar
            </button>
          )}
          <button
            className="btn primary"
            disabled={!d.title.trim() || !d.date}
            onClick={() => {
              saveEntity({ id: initial?.id ?? `ms-${newId().slice(0, 8)}`, module: 'life', kind: 'milestone', data: { ...d, title: d.title.trim() } });
              onClose();
            }}
          >
            Guardar
          </button>
        </>
      }
    >
      <Field label="¿Qué pasó?">
        <input className="input" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="Fundé mi empresa, me mudé a…" />
      </Field>
      <Field label="Fecha">
        <input className="input" type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} />
      </Field>
      <Field label="Ícono">
        <Chips value={d.icon ?? 'star'} onChange={(icon) => setD({ ...d, icon })} options={MILESTONE_ICONS.map((i) => ({ value: i, label: <Icon name={i} width={18} /> }))} />
      </Field>
    </Sheet>
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
