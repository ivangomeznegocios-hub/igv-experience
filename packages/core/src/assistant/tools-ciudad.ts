import { z } from 'zod';
import { CITY_DISTRICTS, cityDistrict } from '../engine/city-catalog';
import type { AssistantSnapshot } from './snapshot';
import { ToolError, makeEvent, ok, tool, type AssistantStore, type AssistantTool } from './toolkit';

/**
 * Herramientas de IA de la ciudad (sistema "ciudad"). La ciudad nunca da XP ni oro; el motor vuelve a validar
 * cada registro (si no alcanzaba o no tocaba, no cuenta), así que aquí solo se revisa para avisar claro.
 */

const zDistrito = z.enum(CITY_DISTRICTS.map((d) => d.id) as [string, ...string[]]).describe(
  `Distrito (= atributo): ${CITY_DISTRICTS.map((d) => `${d.id} = ${d.name} (${d.building})`).join(', ')}.`,
);

async function cityOf(store: AssistantStore): Promise<NonNullable<AssistantSnapshot['city']>> {
  const snap = await store.snapshot();
  if (!snap.city) throw new ToolError('Su ciudad aún no empieza: se activa con "Empezar desde hoy" en la tarjeta del día (Hoy).');
  return snap.city;
}

const BLOCKED: Record<string, string> = {
  max: 'ya está al nivel máximo',
  busy: 'ya tiene una obra en curso',
  no_crew: 'no hay equipo de obra libre (inaugura o espera a que termine otra obra)',
  materials: 'no alcanzan los materiales',
};

export function renderCity(city: NonNullable<AssistantSnapshot['city']>): string {
  const lines = [`Ciudad: tamaño ${city.size} · equipos ${city.crews.busy}/${city.crews.total} ocupados · por recoger ${city.stored}.`];
  for (const d of city.districts) {
    const work = d.work ? (d.work.ready ? ` · obra nivel ${d.work.level} LISTA para inaugurar` : ` · obra nivel ${d.work.level} termina ${d.work.readyOn}`) : '';
    const next = d.next ? ` · siguiente nivel ${d.next.level}: ${d.next.cost} materiales, ${d.next.days} d` : ' · nivel máximo';
    lines.push(`- ${d.id}: ${d.name} (${d.building}) nivel ${d.level} · ${d.materials} materiales${d.stored ? ` (+${d.stored} por recoger)` : ''}${work}${next}${d.blocked && !d.work ? ` · no se puede construir: ${BLOCKED[d.blocked] ?? d.blocked}` : ''}`);
  }
  return lines.join('\n');
}

const verCiudad = tool({
  name: 'ver_ciudad',
  title: 'Ver ciudad',
  group: 'consultar',
  writes: false,
  description: 'Su ciudad: un distrito por atributo, con nivel, materiales (1 por cada XP de ese atributo + producción), obras en curso y lo que hay por recoger.',
  input: z.object({}),
  async run(_i, store) {
    return { text: renderCity(await cityOf(store)) };
  },
});

const construir = tool({
  name: 'construir',
  title: 'Construir en la ciudad',
  group: 'registrar',
  writes: true,
  description: 'Empieza la obra del siguiente nivel en un distrito (descuenta materiales; tarda días). Úsala solo si él lo pide.',
  input: z.object({ distrito: zDistrito }),
  async run({ distrito }, store) {
    const city = await cityOf(store);
    const d = city.districts.find((x) => x.id === distrito);
    if (!d || !d.next) throw new ToolError(`${cityDistrict(distrito)?.name ?? distrito} ya está al nivel máximo.`);
    if (d.blocked) throw new ToolError(`No se puede construir en ${d.name}: ${BLOCKED[d.blocked] ?? d.blocked}. Tiene ${d.materials}, cuesta ${d.next.cost}.`);
    const ev = makeEvent(store, 'city.build_started', { districtId: d.id as never, level: d.next.level }, store.today);
    await store.addEvents([ev]);
    return ok(`Obra iniciada: ${d.building} nivel ${d.next.level} en ${d.name} (${d.next.cost} materiales, ${d.next.days} d). Registro [${ev.id}].`, `Obra: ${d.building} nivel ${d.next.level}`, { events: [ev.id] });
  },
});

const inaugurar = tool({
  name: 'inaugurar',
  title: 'Inaugurar obra',
  group: 'registrar',
  writes: true,
  description: 'Inaugura una obra terminada: el edificio sube de nivel y el equipo queda libre.',
  input: z.object({ distrito: zDistrito }),
  async run({ distrito }, store) {
    const city = await cityOf(store);
    const d = city.districts.find((x) => x.id === distrito);
    if (!d?.work) throw new ToolError(`${cityDistrict(distrito)?.name ?? distrito} no tiene obra en curso.`);
    if (!d.work.ready) throw new ToolError(`La obra de ${d.name} termina el ${d.work.readyOn}.`);
    const ev = makeEvent(store, 'city.inaugurated', { districtId: d.id as never, level: d.work.level }, store.today);
    await store.addEvents([ev]);
    return ok(`Inaugurado: ${d.building} nivel ${d.work.level} en ${d.name}. Registro [${ev.id}].`, `Inauguró ${d.building} nivel ${d.work.level}`, { events: [ev.id] });
  },
});

const recoger = tool({
  name: 'recoger_produccion',
  title: 'Recoger producción',
  group: 'registrar',
  writes: true,
  description: 'Recoge los materiales que produjeron los edificios de su ciudad (cada almacén guarda pocos días).',
  input: z.object({}),
  async run(_i, store) {
    const city = await cityOf(store);
    if (!city.stored) return { text: 'No hay nada por recoger.' };
    const ev = makeEvent(store, 'city.collected', {}, store.today);
    await store.addEvents([ev]);
    return ok(`Recogidos ${city.stored} materiales. Registro [${ev.id}].`, `Recogió ${city.stored} materiales`, { events: [ev.id] });
  },
});

export const CIUDAD_GUIDE =
  'Ciudad: un distrito por atributo; cada XP de un atributo da 1 material de su distrito. Con materiales se construye el siguiente nivel del edificio de un distrito (tarda días); al terminar hay que inaugurarlo para liberar el equipo. Cada nivel produce materiales al día (se recogen; el almacén guarda pocos días). La ciudad nunca da XP ni oro.';

export const CIUDAD_TOOLS: AssistantTool[] = [verCiudad, construir, inaugurar, recoger];
