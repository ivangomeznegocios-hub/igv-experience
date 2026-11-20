import type { Ctx, XpEntry } from '../context';
import { CITY_DISTRICTS } from '../city-catalog';
import { levelInfo } from '../levels';
import { ATTRIBUTE_IDS, type AttributeId } from '../../types';
import { addDays, diffDays } from '../../util/dates';

/**
 * Tu ciudad (sistema "ciudad", ver docs/sistemas/ciudad.md). Todo derivado de eventos; nunca da XP ni oro.
 *
 * - Materiales de un distrito = 1 por cada XP de su atributo desde `settings.scoreStart` + lo recogido − lo gastado.
 * - Una obra (`city.build_started`) cuenta solo si: es el siguiente nivel, el distrito no tiene otra obra, hay un
 *   equipo libre y alcanzaban los materiales en esa fecha (en orden cronológico, como los canjes de oro).
 * - Termina `days` después; hasta que la inauguras (`city.inaugurated`) el equipo sigue ocupado.
 * - Cada nivel produce `productionPerLevel` materiales al día desde el día siguiente a su inauguración; el
 *   almacén guarda hasta `storageDays` días. `city.collected` recoge todo lo producido.
 */

export interface CityWork {
  districtId: AttributeId;
  level: number;
  startedOn: string;
  readyOn: string;
  eventId: string;
  /** Ya terminó (falta inaugurarla). */
  ready: boolean;
  /** Días que faltan (0 si ya está lista). */
  daysLeft: number;
}

export interface CityDistrictState {
  id: AttributeId;
  name: string;
  building: string;
  level: number;
  /** Materiales disponibles hoy. */
  materials: number;
  /** Lo que tiene el almacén por recoger. */
  stored: number;
  /** Almacén lleno (ya no junta más). */
  storageFull: boolean;
  /** Producción por día con el nivel actual. */
  perDay: number;
  work: CityWork | null;
  /** Siguiente nivel (null si ya está al máximo). */
  next: { level: number; cost: number; days: number } | null;
  /** ¿Se puede empezar el siguiente nivel hoy? Si no, por qué. */
  canBuild: boolean;
  blocked: 'max' | 'busy' | 'no_crew' | 'materials' | null;
}

export interface CityInauguration {
  date: string;
  districtId: AttributeId;
  level: number;
  eventId: string;
}

export interface CityState {
  start: string | null;
  districts: Record<AttributeId, CityDistrictState>;
  /** Distritos en el orden del catálogo. */
  order: AttributeId[];
  crews: { total: number; busy: number };
  works: CityWork[];
  /** Obras terminadas por inaugurar. */
  ready: CityWork[];
  /** Total por recoger (todos los distritos). */
  stored: number;
  /** Suma de niveles (tamaño de la ciudad). */
  size: number;
  inaugurations: CityInauguration[];
  lastCollectedOn: string | null;
  /** Registros que no contaron (no alcanzaba, obra ocupada…). */
  rejected: string[];
}

type Dist = {
  level: number;
  /** Fechas en que cambió el nivel (efectivo desde el día siguiente), en orden. */
  history: { date: string; level: number }[];
  work: Omit<CityWork, 'ready' | 'daysLeft'> | null;
  spent: number;
  collected: number;
  lastCollected: string;
};

export function reduceCity(ctx: Ctx, xp: XpEntry[]): CityState {
  const cfg = ctx.cfg.city;
  const start = ctx.settings.scoreStart && ctx.settings.scoreStart <= ctx.today ? ctx.settings.scoreStart : null;
  const order = CITY_DISTRICTS.map((d) => d.id);
  if (!start) return emptyCity(ctx, order);

  // Materiales por XP: acumulado por fecha y distrito.
  const income = new Map<string, Partial<Record<AttributeId, number>>>();
  const xpByDate = new Map<string, number>();
  for (const e of xp) {
    xpByDate.set(e.date, (xpByDate.get(e.date) ?? 0) + e.amount);
    if (!e.attribute || e.date < start) continue;
    let row = income.get(e.date);
    if (!row) income.set(e.date, (row = {}));
    row[e.attribute] = (row[e.attribute] ?? 0) + e.amount;
  }
  const incomeDates = [...income.keys()].sort();
  const earned = Object.fromEntries(ATTRIBUTE_IDS.map((a) => [a, 0])) as Record<AttributeId, number>;
  let incomeIdx = 0;
  const advanceIncome = (date: string) => {
    while (incomeIdx < incomeDates.length && incomeDates[incomeIdx] <= date) {
      const row = income.get(incomeDates[incomeIdx])!;
      for (const a of ATTRIBUTE_IDS) earned[a] += row[a] ?? 0;
      incomeIdx++;
    }
  };

  // Nivel de jugador por fecha (para el segundo equipo de obra).
  const xpDates = [...xpByDate.keys()].sort();
  let xpIdx = 0;
  let xpSum = 0;
  const playerLevelAt = (date: string) => {
    while (xpIdx < xpDates.length && xpDates[xpIdx] <= date) xpSum += xpByDate.get(xpDates[xpIdx++])!;
    return levelInfo(xpSum, ctx.cfg).level;
  };
  const crewsAt = (date: string) => cfg.crews + (playerLevelAt(date) >= cfg.extraCrewAtLevel ? 1 : 0);

  const dist = Object.fromEntries(
    ATTRIBUTE_IDS.map((a) => {
      const lvl = a === cfg.startDistrict ? 1 : 0;
      return [a, { level: lvl, history: lvl ? [{ date: addDays(start, -1), level: lvl }] : [], work: null, spent: 0, collected: 0, lastCollected: start } satisfies Dist];
    }),
  ) as Record<AttributeId, Dist>;

  const levelOn = (d: Dist, day: string) => {
    let lvl = 0;
    for (const h of d.history) if (h.date < day) lvl = h.level;
    return lvl;
  };
  /** Lo que juntó el almacén de un distrito al día `day` (incluido), con tope. */
  const storedAt = (d: Dist, day: string) => {
    const days = Math.min(cfg.storageDays, Math.max(0, diffDays(d.lastCollected, day)));
    let s = 0;
    for (let k = 0; k < days; k++) s += levelOn(d, addDays(day, -k)) * cfg.productionPerLevel;
    return s;
  };
  const materials = (a: AttributeId) => earned[a] + dist[a].collected - dist[a].spent;

  const inaugurations: CityInauguration[] = [];
  const rejected: string[] = [];
  let lastCollectedOn: string | null = null;

  const types = new Set(['city.build_started', 'city.inaugurated', 'city.collected']);
  for (const ev of ctx.events) {
    if (!types.has(ev.type)) continue;
    if (ev.localDate < start) {
      rejected.push(ev.id);
      continue;
    }
    const day = ev.localDate;
    advanceIncome(day);
    if (ev.type === 'city.collected') {
      for (const a of ATTRIBUTE_IDS) {
        const d = dist[a];
        d.collected += storedAt(d, day);
        d.lastCollected = day;
      }
      lastCollectedOn = day;
      continue;
    }
    const { districtId, level } = ev.payload as { districtId: AttributeId; level: number };
    const d = dist[districtId];
    if (!d) {
      rejected.push(ev.id);
      continue;
    }
    if (ev.type === 'city.build_started') {
      const spec = cfg.levels[level - 1];
      const busy = ATTRIBUTE_IDS.filter((a) => dist[a].work).length;
      const ok = !!spec && level === d.level + 1 && !d.work && busy < crewsAt(day) && materials(districtId) >= spec.cost;
      if (!ok) {
        rejected.push(ev.id);
        continue;
      }
      d.spent += spec.cost;
      d.work = { districtId, level, startedOn: day, readyOn: addDays(day, spec.days), eventId: ev.id };
      continue;
    }
    // city.inaugurated
    if (!d.work || d.work.level !== level || d.work.readyOn > day) {
      rejected.push(ev.id);
      continue;
    }
    d.level = level;
    d.history.push({ date: day, level });
    d.work = null;
    inaugurations.push({ date: day, districtId, level, eventId: ev.id });
  }
  advanceIncome(ctx.today);

  // ---- Estado de hoy ----
  const totalCrews = crewsAt(ctx.today);
  const works: CityWork[] = [];
  for (const a of order) {
    const w = dist[a].work;
    if (w) works.push({ ...w, ready: w.readyOn <= ctx.today, daysLeft: Math.max(0, diffDays(ctx.today, w.readyOn)) });
  }
  const busy = works.length;
  const districts = {} as Record<AttributeId, CityDistrictState>;
  for (const cd of CITY_DISTRICTS) {
    const d = dist[cd.id];
    const spec = cfg.levels[d.level];
    const next = spec ? { level: d.level + 1, cost: spec.cost, days: spec.days } : null;
    const mats = materials(cd.id);
    const blocked: CityDistrictState['blocked'] = !next ? 'max' : d.work ? 'busy' : busy >= totalCrews ? 'no_crew' : mats < next.cost ? 'materials' : null;
    const perDay = d.level * cfg.productionPerLevel;
    const stored = storedAt(d, ctx.today);
    districts[cd.id] = {
      id: cd.id,
      name: cd.name,
      building: cd.building,
      level: d.level,
      materials: mats,
      stored,
      storageFull: perDay > 0 && stored >= perDay * cfg.storageDays,
      perDay,
      work: works.find((w) => w.districtId === cd.id) ?? null,
      next,
      canBuild: !blocked,
      blocked,
    };
  }
  return {
    start,
    districts,
    order,
    crews: { total: totalCrews, busy },
    works,
    ready: works.filter((w) => w.ready),
    stored: order.reduce((s, a) => s + districts[a].stored, 0),
    size: order.reduce((s, a) => s + districts[a].level, 0),
    inaugurations,
    lastCollectedOn,
    rejected,
  };
}

function emptyCity(ctx: Ctx, order: AttributeId[]): CityState {
  const cfg = ctx.cfg.city;
  const districts = {} as Record<AttributeId, CityDistrictState>;
  for (const cd of CITY_DISTRICTS) {
    const level = cd.id === cfg.startDistrict ? 1 : 0;
    const spec = cfg.levels[level];
    districts[cd.id] = {
      id: cd.id,
      name: cd.name,
      building: cd.building,
      level,
      materials: 0,
      stored: 0,
      storageFull: false,
      perDay: level * cfg.productionPerLevel,
      work: null,
      next: spec ? { level: level + 1, cost: spec.cost, days: spec.days } : null,
      canBuild: false,
      blocked: 'materials',
    };
  }
  return { start: null, districts, order, crews: { total: cfg.crews, busy: 0 }, works: [], ready: [], stored: 0, size: 1, inaugurations: [], lastCollectedOn: null, rejected: [] };
}
