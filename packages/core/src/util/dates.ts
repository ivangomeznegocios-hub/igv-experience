/** Utilidades de fecha. Todas las fechas "de día" son strings 'YYYY-MM-DD' en hora local del jugador. */

const MS_DAY = 86_400_000;

export function toLocalDate(date: Date | string | number, timeZone: string): string {
  const d = date instanceof Date ? date : new Date(date);
  // en-CA formatea como YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function isDateString(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromDayNum(dayNum(s)) === s;
}

/** Días desde 1970-01-01 (UTC) para una fecha 'YYYY-MM-DD'. */
export function dayNum(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / MS_DAY);
}

export function fromDayNum(n: number): string {
  return new Date(n * MS_DAY).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  return fromDayNum(dayNum(date) + n);
}

/** b − a en días. */
export function diffDays(a: string, b: string): number {
  return dayNum(b) - dayNum(a);
}

/** 0 = lunes … 6 = domingo */
export function weekday(date: string): number {
  // 1970-01-01 fue jueves (3 si lunes = 0)
  return (((dayNum(date) + 3) % 7) + 7) % 7;
}

/** Lunes de la semana de la fecha. */
export function weekStart(date: string): string {
  return addDays(date, -weekday(date));
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function nextMonthKey(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxDate(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

/** Último cumpleaños (o el mismo día) en o antes de `today`, y la edad en años. */
export function ageOn(birthDate: string, today: string): { years: number; lastBirthday: string } {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [ty] = today.split('-').map(Number);
  let years = ty - by;
  let lb = birthdayInYear(bm, bd, ty);
  if (lb > today) {
    years -= 1;
    lb = birthdayInYear(bm, bd, ty - 1);
  }
  return { years, lastBirthday: lb };
}

export function birthdayInYear(month: number, day: number, year: number): string {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const d = month === 2 && day === 29 && !isLeap ? 28 : day;
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Desfase (minutos) de la zona horaria respecto a UTC en un instante dado. */
function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** Instante UTC (ISO) de una fecha y hora locales ("2026-11-20", "21:00") en la zona horaria dada. */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off = tzOffsetMinutes(new Date(guess), timeZone);
  let t = guess - off * 60000;
  const off2 = tzOffsetMinutes(new Date(t), timeZone);
  if (off2 !== off) t = guess - off2 * 60000;
  return new Date(t).toISOString();
}
