import type { Entity, LearningItemData } from '../types';
import { normalizeLearningText } from '../engine/learning-text';

/**
 * Paquete inicial opcional para el tema Inglés: frases útiles de negocios (negociación, juntas, presentaciones y
 * small talk). Solo se agrega si él lo elige. Ids fijos por tema: agregarlo dos veces no duplica.
 */
export const ENGLISH_STARTER_PACK: { text: string; meaning: string; example?: string; tags: string[] }[] = [
  // Negociación
  { text: "What's your best offer?", meaning: '¿Cuál es tu mejor oferta?', tags: ['negociación'] },
  { text: "That's a bit higher than we expected.", meaning: 'Es un poco más alto de lo que esperábamos.', tags: ['negociación'] },
  { text: 'Is there any flexibility on the price?', meaning: '¿Hay flexibilidad en el precio?', tags: ['negociación'] },
  { text: 'We could meet you halfway.', meaning: 'Podríamos llegar a un punto medio.', tags: ['negociación'] },
  { text: 'Let me get back to you on that.', meaning: 'Déjame confirmarte eso después.', tags: ['negociación', 'phrasal verbs'] },
  { text: "That's a deal breaker for us.", meaning: 'Eso no lo podemos aceptar (rompe el trato).', tags: ['negociación'] },
  {
    text: 'If you can commit to a year, we can lower the price.',
    meaning: 'Si te comprometes a un año, podemos bajar el precio.',
    example: 'If you can pay upfront, we can include the setup for free.',
    tags: ['negociación', 'gramática'],
  },
  { text: 'We need some time to think it over.', meaning: 'Necesitamos tiempo para pensarlo.', tags: ['negociación', 'phrasal verbs'] },
  { text: 'What would it take to close the deal today?', meaning: '¿Qué haría falta para cerrar el trato hoy?', tags: ['negociación'] },
  { text: "Let's put it in writing.", meaning: 'Pongámoslo por escrito.', tags: ['negociación'] },
  // Juntas
  { text: "Let's get started.", meaning: 'Empecemos.', tags: ['juntas'] },
  { text: 'Could you walk me through the numbers?', meaning: '¿Me explicas los números paso a paso?', tags: ['juntas', 'phrasal verbs'] },
  { text: "Sorry to interrupt, but I'd like to add something.", meaning: 'Perdón que interrumpa, pero me gustaría agregar algo.', tags: ['juntas'] },
  { text: "Let's circle back to this later.", meaning: 'Retomemos esto más tarde.', tags: ['juntas', 'phrasal verbs'] },
  { text: 'What are the next steps?', meaning: '¿Cuáles son los siguientes pasos?', tags: ['juntas'] },
  { text: 'Can we set up a follow-up call?', meaning: '¿Podemos agendar una llamada de seguimiento?', tags: ['juntas', 'phrasal verbs'] },
  { text: "Just to make sure we're on the same page…", meaning: 'Solo para asegurarnos de que estamos de acuerdo…', tags: ['juntas'] },
  { text: "I'll follow up by email.", meaning: 'Te doy seguimiento por correo.', tags: ['juntas', 'phrasal verbs'] },
  // Presentaciones
  { text: "Today I'm going to walk you through our plan.", meaning: 'Hoy les voy a explicar nuestro plan paso a paso.', tags: ['presentaciones'] },
  { text: 'Let me give you some context.', meaning: 'Déjenme darles algo de contexto.', tags: ['presentaciones'] },
  { text: 'As you can see on this slide…', meaning: 'Como pueden ver en esta diapositiva…', tags: ['presentaciones'] },
  { text: 'The key takeaway is…', meaning: 'La idea principal es…', tags: ['presentaciones'] },
  { text: "That's a great question.", meaning: 'Es una muy buena pregunta.', tags: ['presentaciones'] },
  { text: 'To sum up…', meaning: 'En resumen…', tags: ['presentaciones'] },
  { text: 'We came up with a simpler solution.', meaning: 'Se nos ocurrió una solución más sencilla.', tags: ['presentaciones', 'phrasal verbs'] },
  // Small talk
  { text: "How's business going?", meaning: '¿Cómo va el negocio?', tags: ['small talk'] },
  { text: 'What do you do for a living?', meaning: '¿A qué te dedicas?', tags: ['small talk'] },
  { text: 'How was your trip?', meaning: '¿Qué tal tu viaje?', tags: ['small talk'] },
  { text: "I've heard a lot about you.", meaning: 'He oído mucho de ti.', tags: ['small talk', 'tiempos verbales'] },
  { text: 'It was great meeting you.', meaning: 'Fue un gusto conocerte.', tags: ['small talk'] },
  { text: "Let's keep in touch.", meaning: 'Sigamos en contacto.', tags: ['small talk'] },
  { text: "We're looking forward to working with you.", meaning: 'Nos entusiasma trabajar con ustedes.', tags: ['small talk', 'negocios'] },
];

/**
 * Elementos del paquete inicial para un tema, sin los que ya existen (misma frase normalizada o mismo id).
 * Ids fijos (`<tema>-ini-01`…): agregarlo dos veces no duplica.
 */
export function englishStarterItems(topicId: string, existing: Entity<LearningItemData>[] = []): Entity<LearningItemData>[] {
  const have = new Set(existing.filter((e) => e.data.topicId === topicId).map((e) => normalizeLearningText(e.data.text)));
  const ids = new Set(existing.map((e) => e.id));
  const base = Date.now();
  return ENGLISH_STARTER_PACK.map((p, i) => ({
    id: `${topicId}-ini-${String(i + 1).padStart(2, '0')}`.slice(0, 80),
    module: 'learning',
    kind: 'item',
    sort: base + i,
    data: { topicId, itemType: 'frase' as const, text: p.text, meaning: p.meaning, example: p.example, tags: p.tags, origin: 'inicial' as const },
  })).filter((e) => !ids.has(e.id) && !have.has(normalizeLearningText(e.data.text)));
}
