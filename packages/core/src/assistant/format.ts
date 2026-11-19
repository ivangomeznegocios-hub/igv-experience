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
  'workout.logged': 'Entrenamiento',

  // [[gente]]

  // [[mapa]]
  'place.visited': 'Visita',

  // [[habilidades]]
  'time.logged': 'Tiempo',
  'library.progress': 'Avance de lectura',
  'library.note': 'Lo que aprendí',

  // [[aprendizaje]]
  'learning.reviewed': 'Repaso de tarjeta',
  'learning.test_taken': 'Test de aprendizaje',

  // [[salud]]
  'health.checkup_done': 'Chequeo de salud',
  'health.metric': 'Medición de salud',

  // [[habitos]]
  'day.check_skipped': 'Nada que registrar',

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
    case 'npc.interaction': {
      const channel: Record<string, string> = { persona: 'en persona', llamada: 'llamada', mensaje: 'mensaje', videollamada: 'videollamada' };
      detail = `${name(p.npcId)}${p.channel && channel[p.channel] ? ` (${channel[p.channel]})` : ''}${p.placeId ? ` en ${name(p.placeId)}` : ''}${p.note ? ` · ${String(p.note).slice(0, 100)}` : ''}`;
      break;
    }
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
    case 'workout.logged': {
      const ex = Array.isArray(p.exercises) ? (p.exercises as { name: string; sets?: unknown[] }[]) : [];
      detail = [p.title ?? p.kind, p.where ?? '', p.minutes ? `${p.minutes} min` : '', ex.length ? ex.map((x) => `${x.name} ${(x.sets ?? []).length}×`).join(', ') : ''].filter(Boolean).join(' · ');
      break;
    }

    // [[gente]]

    // [[mapa]]
    case 'place.visited': {
      const who: Record<string, string> = { solo: 'solo', pareja: 'en pareja', familia: 'en familia', amigos: 'con amigos', trabajo: 'por trabajo', otro: 'con alguien más' };
      const people = Array.isArray(p.npcIds) && p.npcIds.length ? ` (${p.npcIds.map(name).join(', ')})` : '';
      detail = `${name(p.placeId)} · ${who[p.company] ?? p.company}${people}${p.rating ? ` · ${p.rating}/5` : ''}${p.note ? ` · ${String(p.note).slice(0, 100)}` : ''}`;
      break;
    }

    // [[habilidades]]
    case 'time.logged': {
      const m = Math.round(Number(p.minutes) || 0);
      const dur = m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
      detail = [`${dur} de ${p.area}`, p.skillId ? `habilidad ${name(p.skillId)}` : '', p.start ? `desde ${p.start}` : '', p.note ? String(p.note).slice(0, 100) : ''].filter(Boolean).join(' · ');
      break;
    }
    case 'library.progress':
      detail = `${name(p.bookId)} · ${typeof p.percent === 'number' ? `${p.percent}%` : `página ${p.page}`}`;
      break;
    case 'library.note':
      detail = `${byId.has(String(p.bookId)) ? name(p.bookId) : (p.title ?? p.bookId)} · ${String(p.text ?? '').slice(0, 140)}`;
      break;

    // [[aprendizaje]]
    case 'learning.reviewed': {
      const it = byId.get(String(p.itemId))?.data as { text?: string } | undefined;
      detail = `${it?.text ? `"${String(it.text).slice(0, 80)}"` : p.itemId} · ${p.result === 'bien' ? 'bien' : p.result === 'dude' ? 'dudé' : 'mal'}`;
      break;
    }
    case 'learning.test_taken': {
      const src = p.source === 'voz' ? 'en voz alta' : p.source === 'tarjetas' ? 'tarjetas' : 'con IA';
      const errs = Array.isArray(p.errors) ? p.errors.length : 0;
      detail = `${name(p.topicId)} · ${p.score}/${p.total} ${src}${p.level ? ` · nivel ${p.level}` : ''}${errs ? ` · ${errs} ${errs === 1 ? 'error' : 'errores'}` : ''}`;
      break;
    }

    // [[salud]]
    case 'health.checkup_done':
      detail = [p.name ?? name(p.checkupId), p.result ? String(p.result).slice(0, 100) : '', p.note ? String(p.note).slice(0, 100) : ''].filter(Boolean).join(' · ');
      break;
    case 'health.metric': {
      const names: Record<string, [string, string]> = { presion: ['Presión', 'mmHg'], glucosa: ['Glucosa', 'mg/dL'], colesterol: ['Colesterol', 'mg/dL'], frecuencia_reposo: ['Pulso en reposo', 'lpm'] };
      const [label, unit] = names[p.kind] ?? [p.label ?? 'Medición', p.unit ?? ''];
      detail = `${label} ${p.kind === 'presion' && p.value2 !== undefined ? `${p.value}/${p.value2}` : p.value}${unit ? ` ${unit}` : ''}${p.note ? ` · ${String(p.note).slice(0, 100)}` : ''}`;
      break;
    }

    // [[habitos]]
    case 'day.check_skipped':
      detail = String(p.label ?? p.checkId);
      break;

  }
  return detail ? `${label}: ${detail}` : label;
}
