import { ATTRIBUTE_NAMES, MISSION_SIZE_NAMES, type AttributeId, type Entity, type GameEvent, type MissionSize } from '../types';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

/** "mié 19 nov 2026" */
export function fmtDay(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  const wd = (new Date(Date.UTC(y, m - 1, day)).getUTCDay() + 6) % 7;
  return `${DAYS[wd]} ${day} ${MONTHS[m - 1]} ${y}`;
}

export function fmtMonthName(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

export function fmtMoney(n: number, currency = 'MXN'): string {
  try {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `$${Math.round(n).toLocaleString('es-MX')}`;
  }
}

export function fmtNum(n: number): string {
  return new Intl.NumberFormat('es-MX').format(Math.round(n));
}

export function sizeAttr(size: MissionSize, attribute: AttributeId | null | undefined): string {
  return `${MISSION_SIZE_NAMES[size] ?? size}${attribute ? ` · ${ATTRIBUTE_NAMES[attribute] ?? attribute}` : ''}`;
}

/** Etiquetas sobrias (sin lenguaje de fantasía) para cada tipo de evento. */
export const EVENT_TEXT: Record<string, string> = {
  'profile.attributes_rated': 'Atributos iniciales',
  'checkin.morning': 'Sueño',
  'rest_day.marked': 'Día de descanso',
  'daily.selected': 'Diaria elegida',
  'weekly.selected': 'Misión de la semana',
  'mission.completed': 'Misión',
  'lesson.written': 'Lección',
  'income.recorded': 'Ingreso',
  'expense.recorded': 'Gasto',
  'boss.phase_completed': 'Fase de gran reto',
  'boss.recurring_defeated': 'Reto recurrente superado',
  'achievement.unlocked': 'Logro',
  'skill.rank_unlocked': 'Rango de habilidad',
  'journal.weekly': 'Diario semanal',
  'season.review': 'Revisión de temporada',
  'npc.interaction': 'Contacto con persona',
  'map.status_changed': 'Mapa',
  'day.closed': 'Cierre del día',
  'bounty.drawn': 'Misión sorpresa',
  'reward.redeemed': 'Premio canjeado',
  'goal.progress': 'Avance de meta',
  'vice.relapse': 'Recaída',
  'library.finished': 'Libro o curso terminado',
  'body.logged': 'Cuerpo',
  'savings.moved': 'Ahorro',
  'plan.set': 'Plan del día',
  'challenge.started': 'Reto iniciado',
  'challenge.checked': 'Día de reto cumplido',
  'pledge.made': 'Compromiso',
  'pledge.resolved': 'Compromiso resuelto',

  // [[voz]]
  'note.captured': 'Nota',
  'note.processed': 'Nota procesada',

  // [[entreno]]

  // [[gente]]

  // [[mapa]]

  // [[habilidades]]

  // [[aprendizaje]]

  // [[salud]]

  // [[habitos]]

};

const MOODS = ['muy mal', 'mal', 'normal', 'bien', 'excelente'];

/** Describe un evento en una línea (para el historial que lee la IA). */
export function describeEvent(e: GameEvent, byId: Map<string, Entity>, currency = 'MXN'): string {
  const p = (e.payload ?? {}) as Record<string, any>;
  const name = (id: unknown) => {
    const d = byId.get(String(id))?.data as { name?: string; title?: string } | undefined;
    return d?.name ?? d?.title ?? String(id);
  };
  const label = EVENT_TEXT[e.type] ?? e.type;
  let detail = '';
  switch (e.type) {
    case 'mission.completed':
      detail = `${p.title} (${sizeAttr(p.size, p.attribute)})`;
      break;
    case 'income.recorded':
    case 'expense.recorded':
      detail = `${fmtMoney(p.amount, currency)}${p.concept ? ` · ${p.concept}` : ''}${p.category ? ` · ${p.category}` : ''}`;
      break;
    case 'checkin.morning':
      detail = `${p.sleepHours} h`;
      break;
    case 'lesson.written':
      detail = String(p.text ?? '').slice(0, 140);
      break;
    case 'npc.interaction':
      detail = `${name(p.npcId)}${p.note ? ` · ${String(p.note).slice(0, 100)}` : ''}`;
      break;
    case 'boss.phase_completed':
      detail = `${name(p.bossId)} · fase ${Number(p.phaseIndex) + 1}`;
      break;
    case 'boss.recurring_defeated':
      detail = `${name(p.bossId)}${p.note ? ` · ${String(p.note).slice(0, 100)}` : ''}`;
      break;
    case 'day.closed':
      detail = `${p.mood ? `ánimo ${MOODS[p.mood - 1]} · ` : ''}${String(p.note ?? '').slice(0, 140)}`;
      break;
    case 'bounty.drawn':
      detail = p.title;
      break;
    case 'reward.redeemed':
      detail = `${p.name} (${p.cost} de oro)`;
      break;
    case 'goal.progress':
      detail = `${name(p.goalId)} +${p.amount}`;
      break;
    case 'vice.relapse':
      detail = name(p.viceId);
      break;
    case 'library.finished':
      detail = p.title;
      break;
    case 'body.logged': {
      const girths = Object.entries(p)
        .filter(([k, v]) => k.endsWith('Cm') && typeof v === 'number')
        .map(([k, v]) => `${k.slice(0, -2)} ${v} cm`);
      detail = [p.weightKg ? `${p.weightKg} kg` : '', p.bodyFatPct ? `${p.bodyFatPct}% de grasa` : '', ...girths, p.workout ?? '', p.note ?? ''].filter(Boolean).join(' · ');
      break;
    }
    case 'savings.moved':
      detail = `${name(p.goalId)} ${fmtMoney(p.amount, currency)}`;
      break;
    case 'plan.set':
      detail = `para ${p.forDate}: ${(p.items ?? []).map((i: { title: string }) => i.title).join(', ') || '(vacío)'}`;
      break;
    case 'challenge.started':
    case 'challenge.checked':
      detail = name(p.challengeId);
      break;
    case 'pledge.made':
      detail = `${p.title} · ${p.stake} de oro · vence ${p.deadline}`;
      break;
    case 'pledge.resolved':
      detail = p.kept ? 'cumplido' : 'no cumplido';
      break;
    case 'journal.weekly':
      detail = `semana del ${p.weekStart}`;
      break;
    case 'achievement.unlocked':
      detail = name(p.achievementId);
      break;
    case 'skill.rank_unlocked':
      detail = `${name(p.skillId)} rango ${p.rank}`;
      break;
    case 'map.status_changed':
      detail = `${name(p.placeId)} → ${p.status === 'dominado' ? 'habitual' : p.status === 'descubierto' ? 'conocido' : 'por conocer'}`;
      break;

    // [[voz]]
    case 'note.captured':
      detail = `${(p.handled ?? 'pendiente') === 'pendiente' ? 'por procesar · ' : ''}"${String(p.text ?? '').slice(0, 140)}"`;
      break;
    case 'note.processed':
      detail = p.via === 'descartada' ? 'descartada' : p.via === 'local' ? 'procesada en la app' : 'procesada con IA';
      break;

    // [[entreno]]

    // [[gente]]

    // [[mapa]]

    // [[habilidades]]

    // [[aprendizaje]]

    // [[salud]]

    // [[habitos]]

  }
  return detail ? `${label}: ${detail}` : label;
}
