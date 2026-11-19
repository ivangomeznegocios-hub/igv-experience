import { GAME_CONFIG, toLocalDate } from '@igv/core';

export const TZ = GAME_CONFIG.timezone;

export function todayLocal(): string {
  return toLocalDate(new Date(), TZ);
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

export function fmtDate(d: string | null | undefined, withYear = false): string {
  if (!d) return '—';
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`;
}

export function fmtMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

export function fmtWeekday(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  const wd = (new Date(Date.UTC(y, m - 1, day)).getUTCDay() + 6) % 7;
  return DAYS[wd];
}

export function fmtMoney(n: number, currency = 'MXN'): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
}

export function fmtNum(n: number): string {
  return new Intl.NumberFormat('es-MX').format(Math.round(n));
}

export function daysAgo(n: number | null): string {
  if (n === null) return 'sin registro';
  if (n === 0) return 'hoy';
  if (n === 1) return 'ayer';
  return `hace ${n} días`;
}
