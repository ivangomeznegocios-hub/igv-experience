import type { Entity, AttributeId } from '../types';
import { GAME_CONFIG } from '../config/game';

/** Guía para la calificación inicial de atributos: cómo se ve un 30 y un 70. */
export const ATTRIBUTE_GUIDE: Record<AttributeId, { at30: string; at70: string }> = {
  fuerza: { at30: 'Actividad ocasional, energía irregular.', at70: 'Entreno 4 veces por semana, energía estable.' },
  inteligencia: { at30: 'Aprendo solo cuando hace falta.', at70: 'Estudio cada semana y aplico lo aprendido.' },
  carisma: { at30: 'Me cuesta pedir la venta.', at70: 'Cierro reuniones y presento con soltura.' },
  finanzas: { at30: 'Ingresos irregulares, sin colchón.', at70: 'Ingresos estables que cubren gastos y ahorro cada mes.' },
  disciplina: { at30: 'Arranco fuerte y abandono.', at70: 'Cumplo 8 de cada 10 compromisos.' },
  relaciones: { at30: 'Poco tiempo de calidad, red dormida.', at70: 'Tiempo de calidad cada semana y red activa.' },
  creatividad: { at30: 'Consumo más de lo que creo.', at70: 'Lanzo algo nuevo cada mes.' },
};

let order = 0;
function e<D>(id: string, module: string, kind: string, data: D): Entity<D> {
  return { id, module, kind, data, sort: order++, createdAt: 0, updatedAt: 0, deletedAt: null };
}

/** Datos iniciales precargados (todos editables en la app). IDs fijos para que el sembrado sea idempotente. */
export function seedEntities(): Entity[] {
  order = 0;
  return [
    e('settings', 'profile', 'settings', {
      name: 'Iván Gómez Vera',
      className: 'Estratega-Constructor',
      birthDate: null,
      monthlyGoal: GAME_CONFIG.defaultMonthlyGoal,
      currency: 'MXN',
      levelRewards: {},
    }),

    // ---------- Misiones principales ----------
    e('mq-01', 'missions', 'main', { code: '01', title: 'Independencia financiera', goal: 'Ingresos que cubran 100,000 MXN al mes de forma estable.', attribute: 'finanzas' }),
    e('mq-02', 'missions', 'main', { code: '02', title: 'Construir un imperio empresarial', goal: 'Un imperio de 100 millones al año.', attribute: 'carisma' }),
    e('mq-03', 'missions', 'main', { code: '03', title: 'Construir una gran familia', goal: 'Presencia real y constante con mi familia.', attribute: 'relaciones' }),
    e('mq-04', 'missions', 'main', { code: '04', title: 'Evolución física', goal: 'Un cuerpo fuerte y con energía estable.', attribute: 'fuerza' }),
    e('mq-05', 'missions', 'main', { code: '05', title: 'Expansión del mundo', goal: 'Hablar, negociar y presentar en inglés.', attribute: 'inteligencia' }),

    // ---------- Capítulo 1 de cada misión principal ----------
    e('ch-01-1', 'missions', 'chapter', { title: 'Ingresos que cubran 100,000 MXN al mes de forma estable', number: 1, size: 'epica', attribute: 'finanzas', mainQuestId: 'mq-01' }),
    e('ch-02-1', 'missions', 'chapter', { title: 'Decidir el primer motor de ingresos y cerrar los primeros 3 clientes', number: 1, size: 'epica', attribute: 'carisma', mainQuestId: 'mq-02' }),
    e('ch-03-1', 'missions', 'chapter', { title: 'Un bloque fijo cada semana con mi hijo, sin teléfono', number: 1, size: 'epica', attribute: 'relaciones', mainQuestId: 'mq-03' }),
    e('ch-04-1', 'missions', 'chapter', { title: 'Entrenar 3 veces por semana', number: 1, size: 'epica', attribute: 'fuerza', mainQuestId: 'mq-04' }),
    e('ch-05-1', 'missions', 'chapter', { title: 'Inglés 3 horas a la semana y una conversación de 30 minutos', number: 1, size: 'epica', attribute: 'inteligencia', mainQuestId: 'mq-05' }),

    // ---------- Secundarias ----------
    e('side-bot-whatsapp', 'missions', 'side', { title: 'Bot de WhatsApp para leads', size: 'grande', attribute: 'inteligencia', mainQuestId: 'mq-02' }),
    e('side-marca-personal', 'missions', 'side', { title: 'Marca personal (TikTok y Facebook)', size: 'grande', attribute: 'creatividad', mainQuestId: 'mq-02' }),
    e('side-cerebro-central', 'missions', 'side', { title: 'Cerebro central de Punto Empresarios', size: 'grande', attribute: 'inteligencia', mainQuestId: 'mq-02' }),
    e('side-colaboracion', 'missions', 'side', { title: 'Colaboración por ingresos extra', size: 'grande', attribute: 'finanzas', mainQuestId: 'mq-01' }),

    // ---------- Menú de diarias ----------
    e('daily-prospectos', 'missions', 'daily', { title: 'Contactar 5 prospectos', size: 'media', attribute: 'carisma', category: 'trabajo', mainQuestId: 'mq-01' }),
    e('daily-foco', 'missions', 'daily', { title: '90 min en la misión en foco', size: 'media', attribute: 'disciplina', category: 'trabajo' }),
    e('daily-entrenar', 'missions', 'daily', { title: 'Entrenar 30 min', size: 'chica', attribute: 'fuerza', category: 'cuerpo', mainQuestId: 'mq-04' }),
    e('daily-caminar', 'missions', 'daily', { title: 'Caminar o estirar 20 min', size: 'chica', attribute: 'fuerza', category: 'cuerpo', recovery: true }),
    e('daily-ingles', 'missions', 'daily', { title: '30 min de inglés', size: 'chica', attribute: 'inteligencia', category: 'libre', mainQuestId: 'mq-05' }),
    e('daily-hijo', 'missions', 'daily', { title: 'Tiempo de calidad con mi hijo', size: 'media', attribute: 'relaciones', category: 'libre', mainQuestId: 'mq-03' }),
    e('daily-leer', 'missions', 'daily', { title: 'Leer 20 páginas', size: 'chica', attribute: 'inteligencia', category: 'libre', recovery: true }),

    // ---------- Jefes de misión ----------
    e('boss-dragon', 'bosses', 'boss', {
      name: 'El Dragón Financiero',
      description: 'Guarda la puerta de la independencia financiera.',
      mainQuestId: 'mq-01',
      phases: [
        { title: 'Un mes de 50,000 MXN', metric: { type: 'month_income', amount: 50_000 } },
        { title: 'Un mes de 100,000 MXN', metric: { type: 'month_income', amount: 100_000 } },
        { title: 'Tres meses seguidos con 100,000 MXN o más', metric: { type: 'consecutive_months_income', amount: 100_000, months: 3 } },
      ],
    }),
    e('boss-imperio', 'bosses', 'boss', {
      name: 'El Imperio',
      description: '100 millones al año en 5 años. Bloqueado hasta vencer al Dragón.',
      mainQuestId: 'mq-02',
      lockedUntilBossId: 'boss-dragon',
      phases: [{ title: '100 millones al año', metric: { type: 'manual' } }],
    }),
    e('boss-ausente', 'bosses', 'boss', {
      name: 'El Ausente',
      description: 'Se vence con tiempo de calidad con mi hijo cada semana, sin teléfono.',
      mainQuestId: 'mq-03',
      phases: [4, 8, 13].map((w) => ({
        title: `${w} semanas seguidas`,
        metric: { type: 'weekly_streak', missionIds: ['daily-hijo'], perWeek: 1, weeks: w },
      })),
    }),
    e('boss-sedentario', 'bosses', 'boss', {
      name: 'El Sedentario',
      description: 'Se vence entrenando 3 veces por semana.',
      mainQuestId: 'mq-04',
      phases: [4, 8, 13].map((w) => ({
        title: `${w} semanas seguidas`,
        metric: { type: 'weekly_streak', missionIds: ['daily-entrenar'], perWeek: 3, weeks: w },
      })),
    }),
    e('boss-torre', 'bosses', 'boss', {
      name: 'La Torre del Inglés',
      description: 'Cada piso es un reto real en inglés.',
      mainQuestId: 'mq-05',
      phases: [
        { title: 'Conversación de 30 minutos', metric: { type: 'manual' } },
        { title: 'Reunión de negocios en inglés', metric: { type: 'manual' } },
        { title: 'Presentación en inglés', metric: { type: 'manual' } },
      ],
    }),

    // ---------- Jefes recurrentes ----------
    e('rb-paralisis', 'bosses', 'recurring', { name: 'La Parálisis', description: 'Aparece cuando una decisión se queda dando vueltas.', defeatCondition: 'Una decisión por escrito en menos de 48 h.', attribute: 'disciplina' }),
    e('rb-perfeccionista', 'bosses', 'recurring', { name: 'El Perfeccionista', description: 'Aparece cuando algo "todavía no está listo".', defeatCondition: 'Entregar al 70 %.', attribute: 'creatividad' }),

    // ---------- Habilidades ----------
    e('skill-ventas', 'skills', 'skill', { name: 'Ventas y negociación', attribute: 'carisma', ranks: ['10 conversaciones de venta', '5 clientes cerrados', 'Un sistema que vende sin mí'] }),
    e('skill-liderazgo', 'skills', 'skill', { name: 'Liderazgo', attribute: 'disciplina', ranks: ['Coordinar un proyecto con otra persona', 'Un equipo de 3 o más con procesos claros', 'Algo que funciona sin que yo esté'] }),
    e('skill-finanzas', 'skills', 'skill', { name: 'Finanzas personales', attribute: 'finanzas', ranks: ['Registrar ingresos y gastos un mes completo', '3 meses seguidos cubriendo gastos y ahorrando', 'Patrimonio que genera ingreso'] }),
    e('skill-tecnologia', 'skills', 'skill', { name: 'Tecnología e IA', attribute: 'inteligencia', ranks: ['Una automatización funcionando', 'Un sistema que usa un cliente real', 'Un producto de software con clientes pagando'] }),
    e('skill-ingles', 'skills', 'skill', { name: 'Inglés', attribute: 'inteligencia', ranks: ['Una conversación de 30 minutos', 'Una reunión de negocios en inglés', 'Presentar y vender en inglés (C1)'] }),
    e('skill-comunicacion', 'skills', 'skill', { name: 'Comunicación pública', attribute: 'carisma', ranks: ['10 videos publicados', 'Hablar ante 50 personas o más', 'Una audiencia que me busca'] }),

    // ---------- Logros ----------
    e('ach-primer-paso', 'achievements', 'achievement', { name: 'Primer paso', description: 'Completa tu primera misión.', icon: 'step', condition: { type: 'missions_completed', count: 1 } }),
    e('ach-constante', 'achievements', 'achievement', { name: 'Constante', description: '7 días de racha.', icon: 'flame', condition: { type: 'streak', days: 7 } }),
    e('ach-imparable', 'achievements', 'achievement', { name: 'Imparable', description: '30 días de racha.', icon: 'bolt', condition: { type: 'streak', days: 30 } }),
    e('ach-primer-cliente', 'achievements', 'achievement', { name: 'Primer cliente', description: 'Cierra tu primer cliente.', icon: 'handshake', condition: { type: 'manual' } }),
    e('ach-primer-feedback', 'achievements', 'achievement', { name: 'Primer feedback real', description: 'Recibe feedback real de un cliente o usuario.', icon: 'chat', condition: { type: 'manual' } }),
    e('ach-al-70', 'achievements', 'achievement', { name: 'Al 70 %', description: '5 entregas al 70 % (vence 5 veces al Perfeccionista).', icon: 'target', condition: { type: 'recurring_defeats', bossId: 'rb-perfeccionista', count: 5 } }),
    e('ach-fracaso-util', 'achievements', 'achievement', { name: 'Fracaso útil', description: 'Escribe 5 lecciones.', icon: 'scroll', condition: { type: 'lessons', count: 5 } }),
    e('ach-padre-presente', 'achievements', 'achievement', { name: 'Padre presente', description: '4 semanas seguidas con tiempo de calidad con tu hijo.', icon: 'heart', condition: { type: 'boss_phase', bossId: 'boss-ausente', phase: 0 } }),
    e('ach-hablo-ingles', 'achievements', 'achievement', { name: 'Hablo inglés', description: 'Una conversación de 30 minutos en inglés.', icon: 'globe', condition: { type: 'boss_phase', bossId: 'boss-torre', phase: 0 } }),
    e('ach-mes-cubierto', 'achievements', 'achievement', { name: 'Mes cubierto', description: 'Un mes con ingresos iguales o mayores a tu meta.', icon: 'coin', condition: { type: 'month_income_goal' } }),
    e('ach-explorador', 'achievements', 'achievement', { name: 'Explorador', description: '5 descubrimientos en el mapa.', icon: 'compass', condition: { type: 'discoveries', count: 5 } }),
    e('ach-temporada-completa', 'achievements', 'achievement', { name: 'Temporada completa', description: 'Cierra una temporada con su revisión final.', icon: 'crown', condition: { type: 'season_completed' } }),

    // ---------- Temporadas ----------
    e('season-1', 'seasons', 'season', { number: 1, name: 'El regreso', startDate: '2026-11-23', endDate: '2027-02-21', focusMainQuestId: 'mq-01' }),
  ];
}
