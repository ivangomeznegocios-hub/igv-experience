import type { GameConfigInput } from '../../config/game';
import {
  PEOPLE_CIRCLES,
  PERSON_ROLES,
  type AttributeId,
  type ContactChannel,
  type MissionSize,
  type NpcData,
  type NpcType,
  type PeopleCircle,
  type PersonRole,
  type RelationTrack,
  type RoleGroup,
} from '../../types';
import { addDays, birthdayInYear, diffDays, isDateString, maxDate, monthKey, toLocalDate, weekStart } from '../../util/dates';
import type { Ctx } from '../context';
import { entitiesOf } from '../context';
import type { MissionsState } from './missions';

/**
 * Mi gente: relaciones de toda una vida.
 * - Contactos = `npc.interaction` + misiones con `npcId` ("Escribirle a X", por mensaje) + `place.visited`
 *   con `npcIds` (en persona, en ese lugar). Varios contactos el mismo día con la misma persona = un día.
 * - Nivel de cercanía 1–5: se GANA al cumplir requisitos acumulados (días con contacto, días en persona,
 *   semanas y meses distintos; config `gente.levels`). Nunca baja con el tiempo; da XP una vez por nivel.
 *   El nivel que se muestra es max(punto de partida, nivel ganado).
 * - Temperatura (cálida / tibia / fría): días sin contacto contra la frecuencia esperada. Esta sí baja.
 */

// ---------------------------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------------------------

export type Temperature = 'calida' | 'tibia' | 'fria';
export const TEMPERATURE_NAMES: Record<Temperature, string> = { calida: 'Cálida', tibia: 'Tibia', fria: 'Fría' };

export type ContactSource = 'interaction' | 'mission' | 'place';

export interface PeopleContact {
  npcId: string;
  date: string;
  /** null = sin especificar (registros viejos). */
  channel: ContactChannel | null;
  inPerson: boolean;
  placeId: string | null;
  source: ContactSource;
  eventId: string;
  note?: string;
}

export interface RelationCounts {
  /** Días distintos con contacto. */
  days: number;
  /** Días distintos con contacto en persona. */
  inPerson: number;
  /** Semanas (lunes–domingo) distintas con contacto. */
  weeks: number;
  /** Meses distintos con contacto. */
  months: number;
}

export type GateKey = keyof RelationCounts;
export const GATE_KEYS: GateKey[] = ['days', 'inPerson', 'weeks', 'months'];

export interface RelationGate extends RelationCounts {
  level: number;
  xp: number;
}

export interface GateGap {
  key: GateKey;
  have: number;
  need: number;
  missing: number;
}

export interface NextLevel {
  level: number;
  name: string;
  gaps: GateGap[];
  /** 0–1: promedio de lo cumplido en cada requisito. */
  progress: number;
  /** "Te faltan 2 convivencias en persona para Amiga". */
  hint: string;
}

export interface UpcomingBirthday {
  npcId: string;
  date: string;
  inDays: number;
  /** Años que cumple (si se sabe el año de nacimiento). */
  turns: number | null;
}

export interface NpcState {
  lastInteraction: string | null;
  daysSince: number | null;
  overdue: boolean;
  /** Contactos registrados (cada registro cuenta). */
  interactions: number;

  circle: PeopleCircle;
  role: string | null;
  roleGroup: RoleGroup | null;
  track: RelationTrack;
  /** Nivel que se muestra: max(punto de partida, nivel ganado). */
  level: number;
  /** Nivel ganado con contactos (el que da XP). */
  earnedLevel: number;
  levelName: string;
  /** Día en que se ganó cada nivel (2–5). */
  levelDates: Record<number, string>;
  counts: RelationCounts;
  next: NextLevel | null;
  /** Frecuencia esperada en días (0 = sin meta). */
  cadenceDays: number;
  temperature: Temperature | null;
  trend: 'sube' | 'baja' | 'estable';
  /** Días con contacto en la ventana reciente y en la anterior (config `gente.trendDays`). */
  recent: number;
  previous: number;
  byChannel: Record<ContactChannel | 'otro', number>;
  /** Lugares donde han convivido (días), de más a menos. */
  places: { placeId: string; days: number }[];
  firstContact: string | null;
  /** Desde cuándo se conocen: `metOn` (puede ser solo el año) o, si falta, el primer contacto o el alta de la ficha. */
  knownSince: string | null;
  birthday: UpcomingBirthday | null;
  /** Orden en "Familia" (pareja, hijos, padres, hermanos, abuelos, resto). */
  priority: number;
}

export interface GeneratedMission {
  id: string;
  title: string;
  size: MissionSize;
  attribute: AttributeId;
  kind: 'npc';
  npcId: string;
}

export interface PeriodCount {
  /** Lunes de la semana (YYYY-MM-DD) o mes (YYYY-MM). */
  key: string;
  /** Contactos contados por persona y día. */
  contacts: number;
  /** Personas distintas. */
  people: number;
}

export interface LevelUp {
  npcId: string;
  level: number;
  date: string;
  xp: number;
}

export interface NpcsState {
  npcs: Record<string, NpcState>;
  generatedMissions: GeneratedMission[];
  /** Todos los contactos válidos, en orden cronológico. */
  contacts: PeopleContact[];
  /** Personas del catálogo con contacto hoy (orden del primer registro). */
  contactedToday: string[];
  /** Últimas 12 semanas y 12 meses (la última es la actual). */
  weeks: PeriodCount[];
  months: PeriodCount[];
  /** Personas por círculo. */
  byCircle: Record<PeopleCircle, number>;
  /** Por lugar: con quién has estado ahí (días), de más a menos. */
  places: Record<string, { npcId: string; days: number }[]>;
  /** Cumpleaños en los próximos `gente.birthdayWindowDays` días (incluye hoy). */
  birthdays: UpcomingBirthday[];
  /** Niveles ganados, en orden cronológico. */
  levelUps: LevelUp[];
}

// ---------------------------------------------------------------------------------------------
// Reglas puras
// ---------------------------------------------------------------------------------------------

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const ROLES_BY_LENGTH = [...PERSON_ROLES].sort((a, b) => b.label.length - a.label.length);
/** Otras formas de decir un rol sugerido (ya normalizadas: minúsculas, sin acentos). */
const ROLE_ALIASES: [string, string][] = [
  ['companera de trabajo', 'Colega'],
  ['companero de trabajo', 'Colega'],
  ['prometida', 'Novia'],
  ['prometido', 'Novio'],
  ['madre', 'Mamá'],
  ['padre', 'Papá'],
];

/** Reconoce un rol escrito a mano ("amiga de la prepa" → Amiga). */
export function roleInfo(role: string | null | undefined): PersonRole | null {
  if (!role) return null;
  const r = norm(role);
  if (!r) return null;
  for (const [alias, label] of ROLE_ALIASES) {
    if (r === alias || r.startsWith(`${alias} `)) return PERSON_ROLES.find((p) => p.label === label) ?? null;
  }
  for (const p of ROLES_BY_LENGTH) {
    const l = norm(p.label);
    if (r === l || r.startsWith(`${l} `)) return p;
  }
  return null;
}

const LEGACY_CIRCLE: Record<NpcType, PeopleCircle> = { party: 'amigos', aliado: 'amigos', mentor: 'trabajo', cliente: 'clientes', rival: 'conocidos' };
const LEGACY_ROLE: Partial<Record<NpcType, string>> = { mentor: 'Mentor', cliente: 'Cliente', rival: 'Rival' };

/** Círculo de una persona (las fichas viejas sin círculo se deducen de su tipo). */
export function circleOf(d: Partial<NpcData>): PeopleCircle {
  if (d.circle && (PEOPLE_CIRCLES as readonly string[]).includes(d.circle)) return d.circle;
  const r = roleInfo(d.role);
  if (r) return r.circle;
  return (d.npcType && LEGACY_CIRCLE[d.npcType]) || 'conocidos';
}

export function roleOf(d: Partial<NpcData>): string | null {
  const r = d.role?.trim();
  if (r) return r;
  return (d.npcType && LEGACY_ROLE[d.npcType]) || null;
}

/** Tipo de la primera versión que corresponde a un círculo/rol (para que las versiones anteriores sigan leyendo la ficha). */
export function legacyNpcType(circle: PeopleCircle, role?: string | null): NpcType {
  const g = roleInfo(role)?.group;
  if (g === 'mentor') return 'mentor';
  if (role && norm(role) === 'rival') return 'rival';
  if (circle === 'clientes') return 'cliente';
  if (circle === 'familia' || circle === 'pareja' || g === 'mejorAmigo') return 'party';
  return 'aliado';
}

export function relationTrack(circle: PeopleCircle): RelationTrack {
  if (circle === 'familia' || circle === 'pareja') return 'familia';
  if (circle === 'trabajo' || circle === 'clientes') return 'profesional';
  return 'social';
}

/** Nombres de nivel [masculino, femenino] por escalera. */
export const RELATION_LEVEL_NAMES: Record<RelationTrack, readonly (readonly [string, string])[]> = {
  familia: [
    ['En contacto', 'En contacto'],
    ['Presente', 'Presente'],
    ['Cercano', 'Cercana'],
    ['Unido', 'Unida'],
    ['Incondicional', 'Incondicional'],
  ],
  social: [
    ['Conocido', 'Conocida'],
    ['Compa', 'Compa'],
    ['Amigo', 'Amiga'],
    ['Amigo cercano', 'Amiga cercana'],
    ['Círculo íntimo', 'Círculo íntimo'],
  ],
  profesional: [
    ['Conocido', 'Conocida'],
    ['Contacto', 'Contacto'],
    ['Colaborador', 'Colaboradora'],
    ['De confianza', 'De confianza'],
    ['Aliado clave', 'Aliada clave'],
  ],
};

export const MAX_RELATION_LEVEL = 5;

export function relationLevelName(track: RelationTrack, level: number, fem = false): string {
  const names = RELATION_LEVEL_NAMES[track];
  const l = Math.max(1, Math.min(names.length, Math.floor(level)));
  return names[l - 1][fem ? 1 : 0];
}

/** Nombre del nivel para una ficha concreta (escalera por círculo, género por rol). */
export function levelNameFor(d: Partial<NpcData>, level: number): string {
  return relationLevelName(relationTrack(circleOf(d)), level, !!roleInfo(roleOf(d))?.fem);
}

/** Requisitos de cada nivel, ordenados. */
export function relationGates(cfg: GameConfigInput): RelationGate[] {
  return [...cfg.gente.levels].map((g) => ({ ...g })).sort((a, b) => a.level - b.level);
}

/** Nivel ganado con ciertos conteos (los niveles se ganan en orden). */
export function levelFromCounts(c: RelationCounts, cfg: GameConfigInput): number {
  let level = 1;
  for (const g of relationGates(cfg)) {
    if (g.level !== level + 1 || !GATE_KEYS.every((k) => c[k] >= g[k])) break;
    level = g.level;
  }
  return level;
}

export function gateGaps(c: RelationCounts, gate: RelationCounts): GateGap[] {
  return GATE_KEYS.map((key) => ({ key, have: c[key], need: gate[key], missing: Math.max(0, gate[key] - c[key]) }));
}

export function gateProgress(gaps: GateGap[]): number {
  const parts = gaps.filter((g) => g.need > 0);
  if (!parts.length) return 1;
  return parts.reduce((s, g) => s + Math.min(1, g.have / g.need), 0) / parts.length;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Lo que falta, en palabras: "2 días de contacto, 1 convivencia en persona y 1 semana más". */
export function gapsText(gaps: GateGap[]): string {
  const parts = gaps
    .filter((g) => g.missing > 0)
    .map((g) => {
      switch (g.key) {
        case 'days':
          return plural(g.missing, 'día de contacto', 'días de contacto');
        case 'inPerson':
          return plural(g.missing, 'convivencia en persona', 'convivencias en persona');
        case 'weeks':
          return plural(g.missing, 'semana más', 'semanas más');
        case 'months':
          return plural(g.missing, 'mes más', 'meses más');
      }
    });
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}`;
}

export function nextLevelInfo(c: RelationCounts, level: number, d: Partial<NpcData>, cfg: GameConfigInput): NextLevel | null {
  const gate = relationGates(cfg).find((g) => g.level === level + 1);
  if (!gate) return null;
  const gaps = gateGaps(c, gate);
  const name = levelNameFor(d, gate.level);
  const missing = gapsText(gaps);
  const open = gaps.filter((g) => g.missing > 0);
  return {
    level: gate.level,
    name,
    gaps,
    progress: gateProgress(gaps),
    hint: missing ? `Te ${open.length === 1 && open[0].missing === 1 ? 'falta' : 'faltan'} ${missing} para ${name}` : `Listo para ${name}`,
  };
}

/**
 * Frecuencia esperada (días). La elegida en la ficha gana; si no, la del rol o la del círculo. Una persona
 * clave sin frecuencia elegida espera contacto al menos cada `npc.keyContactDays` días. 0 = sin meta.
 */
export function cadenceFor(d: Partial<NpcData>, cfg: GameConfigInput): number {
  if (typeof d.cadenceDays === 'number' && d.cadenceDays >= 0) return Math.floor(d.cadenceDays);
  const g = roleInfo(roleOf(d))?.group;
  const byRole = g ? (cfg.gente.roleCadence as Record<string, number>)[g] : undefined;
  const auto = typeof byRole === 'number' ? byRole : ((cfg.gente.circleCadence as Record<string, number>)[circleOf(d)] ?? 0);
  if (!d.key) return auto;
  const cap = cfg.npc.keyContactDays;
  return auto > 0 ? Math.min(auto, cap) : cap;
}

/** Tendencia: ¿más o menos días con contacto que en la ventana anterior? */
export function trendFor(recent: number, previous: number, cfg: GameConfigInput): 'sube' | 'baja' | 'estable' {
  const { trendMinChange: min, trendRatio: ratio } = cfg.gente;
  if (recent - previous >= min && recent >= previous * ratio) return 'sube';
  if (previous - recent >= min && previous >= recent * ratio) return 'baja';
  return 'estable';
}

/** Temperatura según días sin contacto y frecuencia esperada (sin meta → null). */
export function temperatureFor(daysSince: number | null, cadence: number, cfg: GameConfigInput): Temperature | null {
  if (daysSince === null || !(cadence > 0)) return null;
  if (daysSince <= Math.ceil(cadence * cfg.gente.warmFactor)) return 'calida';
  if (daysSince <= Math.ceil(cadence * cfg.gente.coolFactor)) return 'tibia';
  return 'fria';
}

/** Cumpleaños válido: 'MM-DD' o 'YYYY-MM-DD'. */
export function parseBirthday(b: string | null | undefined): { month: number; day: number; year: number | null } | null {
  if (!b) return null;
  const m = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(b.trim());
  if (!m) return null;
  const year = m[1] ? Number(m[1]) : null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!isDateString(`${year ?? 2000}-${m[2]}-${m[3]}`)) return null;
  return { month, day, year };
}

export function isValidBirthday(b: string): boolean {
  return parseBirthday(b) !== null;
}

/** Próximo cumpleaños (hoy cuenta). */
export function nextBirthday(npcId: string, b: string | null | undefined, today: string): UpcomingBirthday | null {
  const p = parseBirthday(b);
  if (!p) return null;
  const y = Number(today.slice(0, 4));
  let date = birthdayInYear(p.month, p.day, y);
  if (date < today) date = birthdayInYear(p.month, p.day, y + 1);
  const turns = p.year ? Number(date.slice(0, 4)) - p.year : null;
  return { npcId, date, inDays: diffDays(today, date), turns: turns !== null && turns >= 0 ? turns : null };
}

/** 'YYYY', 'YYYY-MM' o 'YYYY-MM-DD' (no en el futuro). */
export function isValidMetOn(s: string): boolean {
  if (/^\d{4}$/.test(s)) return Number(s) >= 1900;
  if (/^\d{4}-\d{2}$/.test(s)) return isDateString(`${s}-01`);
  return isDateString(s);
}

/** "11 años", "8 meses", "12 días" desde una fecha (que puede ser solo año o año-mes). */
export function knownForText(since: string | null | undefined, today: string): string | null {
  if (!since) return null;
  const date = /^\d{4}$/.test(since) ? `${since}-07-01` : /^\d{4}-\d{2}$/.test(since) ? `${since}-15` : since;
  if (!isDateString(date)) return null;
  const days = diffDays(date, today);
  if (days < 0) return null;
  if (/^\d{4}$/.test(since)) {
    const years = Number(today.slice(0, 4)) - Number(since);
    return years <= 0 ? 'este año' : plural(years, 'año', 'años');
  }
  if (days >= 365) return plural(Math.floor(days / 365.25), 'año', 'años');
  if (days >= 60) return plural(Math.floor(days / 30.44), 'mes', 'meses');
  return plural(days, 'día', 'días');
}

const PRIORITY: Partial<Record<RoleGroup, number>> = { pareja: 0, hijo: 1, padres: 2, hermano: 3, abuelo: 4, familia: 5 };

/** Orden en el bloque "Familia": pareja, hijos, padres, hermanos, abuelos, resto de la familia, demás. */
export function familyPriority(d: Partial<NpcData>): number {
  const g = roleInfo(roleOf(d))?.group;
  if (g && PRIORITY[g] !== undefined) return PRIORITY[g]!;
  const c = circleOf(d);
  return c === 'pareja' ? 0 : c === 'familia' ? 6 : 9;
}

/** Contactos de Mi gente que aporta un evento (ninguno si no es de Mi gente). */
export function contactsOf(ev: { id: string; type: string; localDate: string; payload: any }): PeopleContact[] {
  const p = ev.payload ?? {};
  switch (ev.type) {
    case 'npc.interaction': {
      if (!p.npcId) return [];
      const channel: ContactChannel | null = p.channel ?? null;
      const placeId: string | null = p.placeId ?? null;
      return [{ npcId: p.npcId, date: ev.localDate, channel, inPerson: channel === 'persona' || (!channel && !!placeId), placeId, source: 'interaction', eventId: ev.id, ...(p.note ? { note: p.note } : {}) }];
    }
    case 'mission.completed':
      return p.npcId ? [{ npcId: p.npcId, date: ev.localDate, channel: 'mensaje', inPerson: false, placeId: null, source: 'mission', eventId: ev.id }] : [];
    case 'place.visited': {
      const ids: string[] = Array.isArray(p.npcIds) ? [...new Set<string>(p.npcIds.filter((x: unknown) => typeof x === 'string' && x))] : [];
      return ids.map((npcId) => ({ npcId, date: ev.localDate, channel: 'persona' as const, inPerson: true, placeId: p.placeId ?? null, source: 'place' as const, eventId: ev.id, ...(p.note ? { note: p.note } : {}) }));
    }
    default:
      return [];
  }
}

/** Tipos de evento que cuentan como contacto con alguien. */
export const PEOPLE_CONTACT_TYPES = ['npc.interaction', 'mission.completed', 'place.visited'] as const;
const CONTACT_TYPES = new Set<string>(PEOPLE_CONTACT_TYPES);

interface Agg {
  days: Set<string>;
  inPerson: Set<string>;
  weeks: Set<string>;
  months: Set<string>;
  count: number;
  first: string;
  last: string;
  byChannel: Record<ContactChannel | 'otro', number>;
  places: Map<string, Set<string>>;
  earned: number;
  levelDates: Record<number, string>;
}

const countsOf = (a: Agg | undefined): RelationCounts => ({ days: a?.days.size ?? 0, inPerson: a?.inPerson.size ?? 0, weeks: a?.weeks.size ?? 0, months: a?.months.size ?? 0 });

// ---------------------------------------------------------------------------------------------
// Reductor
// ---------------------------------------------------------------------------------------------

export function reducePeople(ctx: Ctx, missions: MissionsState): NpcsState {
  const cfg = ctx.cfg;
  const gates = relationGates(cfg);
  const attribute = cfg.gente.attribute as AttributeId;
  const contacts: PeopleContact[] = [];
  const aggs = new Map<string, Agg>();
  const levelUps: LevelUp[] = [];

  // ctx.events ya viene en orden cronológico: el nivel se gana el día en que se cumplen los requisitos.
  for (const ev of ctx.events) {
    if (!CONTACT_TYPES.has(ev.type)) continue;
    for (const c of contactsOf(ev)) {
      contacts.push(c);
      let a = aggs.get(c.npcId);
      if (!a) {
        a = {
          days: new Set(),
          inPerson: new Set(),
          weeks: new Set(),
          months: new Set(),
          count: 0,
          first: c.date,
          last: c.date,
          byChannel: { persona: 0, llamada: 0, videollamada: 0, mensaje: 0, otro: 0 },
          places: new Map(),
          earned: 1,
          levelDates: {},
        };
        aggs.set(c.npcId, a);
      }
      a.count++;
      a.last = maxDate(a.last, c.date)!;
      a.days.add(c.date);
      if (c.inPerson) a.inPerson.add(c.date);
      a.weeks.add(weekStart(c.date));
      a.months.add(monthKey(c.date));
      a.byChannel[c.channel ?? 'otro']++;
      if (c.placeId) {
        if (!a.places.has(c.placeId)) a.places.set(c.placeId, new Set());
        a.places.get(c.placeId)!.add(c.date);
      }
      // ¿Alcanzó el siguiente nivel? (en orden; se puede ganar más de uno el mismo día)
      const counts = countsOf(a);
      for (const g of gates) {
        if (g.level !== a.earned + 1) continue;
        if (!GATE_KEYS.every((k) => counts[k] >= g[k])) break;
        a.earned = g.level;
        a.levelDates[g.level] = c.date;
        levelUps.push({ npcId: c.npcId, level: g.level, date: c.date, xp: g.xp });
        const ent = ctx.entityById.get(c.npcId);
        const data = ent && ent.module === 'npcs' ? (ent.data as Partial<NpcData>) : null;
        ctx.addXp({
          date: c.date,
          amount: g.xp,
          source: 'relationship',
          label: data?.name ? `Cercanía con ${data.name}: ${levelNameFor(data, g.level)}` : `Cercanía: nivel ${g.level}`,
          attribute,
          eventId: c.eventId,
          refId: c.npcId,
        });
      }
    }
  }

  const npcs: Record<string, NpcState> = {};
  const generatedMissions: GeneratedMission[] = [];
  const byCircle = Object.fromEntries(PEOPLE_CIRCLES.map((c) => [c, 0])) as Record<PeopleCircle, number>;
  const birthdays: UpcomingBirthday[] = [];
  const trendDays = Math.max(1, cfg.gente.trendDays);
  const recentFrom = addDays(ctx.today, -(trendDays - 1));
  const prevFrom = addDays(ctx.today, -(2 * trendDays - 1));
  const people = entitiesOf<NpcData>(ctx, 'npcs', 'npc');
  const inCatalog = new Set(people.map((p) => p.id));

  for (const ent of people) {
    const d = ent.data ?? ({} as NpcData);
    const a = aggs.get(ent.id);
    const created = ent.createdAt ? toLocalDate(ent.createdAt, cfg.timezone) : null;
    const lastInteraction = maxDate(a?.last ?? null, d.lastContact ?? null) ?? null;
    const ref = lastInteraction ?? created;
    const daysSince = ref ? Math.max(0, diffDays(ref, ctx.today)) : null;
    const circle = circleOf(d);
    const role = roleOf(d);
    const info = roleInfo(role);
    const track = relationTrack(circle);
    const cadenceDays = cadenceFor(d, cfg);
    const temperature = temperatureFor(lastInteraction ? daysSince : null, cadenceDays, cfg);
    // Persona clave: aviso a los N días (config npc.keyContactDays) o antes, si ya se enfrió según su frecuencia.
    const overdue = !!d.key && daysSince !== null && (daysSince >= cfg.npc.keyContactDays || (temperature === 'fria' && daysSince > 0));
    const earned = a?.earned ?? 1;
    const start = Math.max(1, Math.min(MAX_RELATION_LEVEL, Math.floor(Number(d.startLevel) || 1)));
    const level = Math.max(start, earned);
    const counts = countsOf(a);
    let recent = 0;
    let previous = 0;
    for (const day of a?.days ?? []) {
      if (day >= recentFrom && day <= ctx.today) recent++;
      else if (day >= prevFrom && day < recentFrom) previous++;
    }
    const trend = trendFor(recent, previous, cfg);
    const birthday = nextBirthday(ent.id, d.birthday, ctx.today);
    if (birthday && birthday.inDays <= cfg.gente.birthdayWindowDays) birthdays.push(birthday);
    byCircle[circle]++;

    npcs[ent.id] = {
      lastInteraction,
      daysSince,
      overdue,
      interactions: a?.count ?? 0,
      circle,
      role,
      roleGroup: info?.group ?? null,
      track,
      level,
      earnedLevel: earned,
      levelName: relationLevelName(track, level, !!info?.fem),
      levelDates: { ...(a?.levelDates ?? {}) },
      counts,
      next: nextLevelInfo(counts, level, d, cfg),
      cadenceDays,
      temperature,
      trend,
      recent,
      previous,
      byChannel: { ...(a?.byChannel ?? { persona: 0, llamada: 0, videollamada: 0, mensaje: 0, otro: 0 }) },
      places: [...(a?.places ?? new Map<string, Set<string>>())].map(([placeId, s]) => ({ placeId, days: s.size })).sort((x, y) => y.days - x.days),
      firstContact: a?.first ?? null,
      knownSince: (d.metOn && isValidMetOn(d.metOn) ? d.metOn : null) ?? a?.first ?? created,
      birthday,
      priority: familyPriority(d),
    };

    const missionId = `npc-${ent.id}`;
    if (overdue || missions.completions[missionId]?.lastDate === ctx.today) {
      generatedMissions.push({
        id: missionId,
        title: `Escribirle a ${d.name}`,
        size: cfg.npc.contactMissionSize as MissionSize,
        attribute: cfg.defaultAttributes.npcContact as AttributeId,
        kind: 'npc',
        npcId: ent.id,
      });
    }
  }
  birthdays.sort((x, y) => x.inDays - y.inDays);

  // Hoy, semanas, meses y lugares (solo personas del catálogo).
  const contactedToday: string[] = [];
  const weekKeys = Array.from({ length: 12 }, (_, i) => weekStart(addDays(ctx.today, -7 * (11 - i))));
  const monthKeys: string[] = [];
  {
    let [y, m] = ctx.today.split('-').map(Number);
    for (let i = 0; i < 12; i++) {
      monthKeys.unshift(`${y}-${String(m).padStart(2, '0')}`);
      m--;
      if (m === 0) {
        m = 12;
        y--;
      }
    }
  }
  const weekSets = new Map(weekKeys.map((k) => [k, { pd: new Set<string>(), people: new Set<string>() }]));
  const monthSets = new Map(monthKeys.map((k) => [k, { pd: new Set<string>(), people: new Set<string>() }]));
  const placeSets = new Map<string, Map<string, Set<string>>>();
  for (const c of contacts) {
    if (!inCatalog.has(c.npcId)) continue;
    if (c.date === ctx.today && !contactedToday.includes(c.npcId)) contactedToday.push(c.npcId);
    const w = weekSets.get(weekStart(c.date));
    if (w) {
      w.pd.add(`${c.npcId}|${c.date}`);
      w.people.add(c.npcId);
    }
    const mo = monthSets.get(monthKey(c.date));
    if (mo) {
      mo.pd.add(`${c.npcId}|${c.date}`);
      mo.people.add(c.npcId);
    }
    if (c.placeId) {
      if (!placeSets.has(c.placeId)) placeSets.set(c.placeId, new Map());
      const byPerson = placeSets.get(c.placeId)!;
      if (!byPerson.has(c.npcId)) byPerson.set(c.npcId, new Set());
      byPerson.get(c.npcId)!.add(c.date);
    }
  }
  const places: NpcsState['places'] = {};
  for (const [placeId, byPerson] of placeSets) {
    places[placeId] = [...byPerson].map(([npcId, s]) => ({ npcId, days: s.size })).sort((x, y) => y.days - x.days);
  }

  return {
    npcs,
    generatedMissions,
    contacts,
    contactedToday,
    weeks: weekKeys.map((key) => ({ key, contacts: weekSets.get(key)!.pd.size, people: weekSets.get(key)!.people.size })),
    months: monthKeys.map((key) => ({ key, contacts: monthSets.get(key)!.pd.size, people: monthSets.get(key)!.people.size })),
    byCircle,
    places,
    birthdays,
    levelUps,
  };
}

/** Personas con más días de contacto en los últimos N días (para "con quién más convives"). */
export function mostSeen(state: NpcsState, today: string, days = 90, limit = 5): { npcId: string; days: number }[] {
  const from = addDays(today, -(days - 1));
  const seen = new Map<string, Set<string>>();
  for (const c of state.contacts) {
    if (c.date < from || c.date > today || !state.npcs[c.npcId]) continue;
    if (!seen.has(c.npcId)) seen.set(c.npcId, new Set());
    seen.get(c.npcId)!.add(c.date);
  }
  const last = (id: string) => state.npcs[id]?.lastInteraction ?? '';
  return [...seen]
    .map(([npcId, s]) => ({ npcId, days: s.size }))
    .sort((a, b) => b.days - a.days || (last(a.npcId) < last(b.npcId) ? 1 : last(a.npcId) > last(b.npcId) ? -1 : 0))
    .slice(0, limit);
}

/**
 * Resumen de la relación con UNA persona a partir de sus contactos (mismas reglas que el reductor; lo usan
 * las herramientas de IA, que no proyectan todo el juego). `contacts` en orden cronológico.
 */
export function relationSummary(contacts: PeopleContact[], cfg: GameConfigInput): { counts: RelationCounts; earnedLevel: number; levelDates: Record<number, string> } {
  const days = new Set<string>();
  const inPerson = new Set<string>();
  const weeks = new Set<string>();
  const months = new Set<string>();
  const levelDates: Record<number, string> = {};
  let earned = 1;
  const gates = relationGates(cfg);
  for (const c of [...contacts].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    days.add(c.date);
    if (c.inPerson) inPerson.add(c.date);
    weeks.add(weekStart(c.date));
    months.add(monthKey(c.date));
    const counts = { days: days.size, inPerson: inPerson.size, weeks: weeks.size, months: months.size };
    for (const g of gates) {
      if (g.level !== earned + 1) continue;
      if (!GATE_KEYS.every((k) => counts[k] >= g[k])) break;
      earned = g.level;
      levelDates[g.level] = c.date;
    }
  }
  return { counts: { days: days.size, inPerson: inPerson.size, weeks: weeks.size, months: months.size }, earnedLevel: earned, levelDates };
}
