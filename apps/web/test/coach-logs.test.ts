import './helpers/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { project, validateEvent, type GameEvent } from '@igv/core';

// El store guarda en IndexedDB: en Node, en memoria.
vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {} }));
// Los avisos se espían para poder tocar su "Deshacer".
vi.mock('../src/ui/kit', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/ui/kit')>()), toast: vi.fn(), undoToast: vi.fn() }));

import { addEvent, getEvents, restoreEvent } from '../src/data/store';
import { logCheckin, logMeal, logReadiness, logWater, undoLastWater } from '../src/lib/coach';
import { todayLocal } from '../src/lib/time';
import { appendToField, toast, undoToast } from '../src/ui/kit';

const today = todayLocal();
const waterOn = (d: string) => project({ events: getEvents(), entities: [], today: d }).coach.water[d] ?? 0;
const lastOf = (type: string): GameEvent | undefined => getEvents().filter((e) => e.type === type).at(-1);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date() });
  vi.mocked(toast).mockClear();
  vi.mocked(undoToast).mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});
const tick = () => vi.setSystemTime(Date.now() + 1000);

describe('agua: el botón "−" (Quitar un vaso)', () => {
  it('quita un solo vaso aunque el último registro traiga varios (p. ej. "tomé 2 litros" desde la IA)', () => {
    addEvent('water.logged', { glasses: 8 }, { localDate: today });
    tick();
    logWater(1);
    tick();
    expect(waterOn(today)).toBe(9);
    undoLastWater(today);
    tick();
    expect(waterOn(today)).toBe(8);
    undoLastWater(today);
    tick();
    expect(waterOn(today)).toBe(7);
    undoLastWater(today);
    tick();
    expect(waterOn(today)).toBe(6);
  });

  it('siempre ofrece "Deshacer", que deja el día como estaba', () => {
    const d = '2026-01-04';
    addEvent('water.logged', { glasses: 8 }, { localDate: d });
    tick();
    undoLastWater(d);
    tick();
    expect(waterOn(d)).toBe(7);
    const call = vi.mocked(undoToast).mock.calls.at(-1);
    expect(call, 'el aviso debe traer "Deshacer"').toBeTruthy();
    call![1]();
    tick();
    expect(waterOn(d)).toBe(8);
    // Y el siguiente "−" vuelve a quitar uno solo.
    undoLastWater(d);
    expect(waterOn(d)).toBe(7);
  });

  it('"Deshacer" de un aviso viejo regresa solo su vaso aunque otro "−" ya bajó el reemplazo', () => {
    // La IA registró 8 vasos; dos "−" seguidos dejan 6 y hay dos avisos con "Deshacer" a la vez.
    const d = '2026-01-06';
    addEvent('water.logged', { glasses: 8 }, { localDate: d });
    tick();
    undoLastWater(d);
    tick();
    const undoFirst = vi.mocked(undoToast).mock.calls.at(-1)![1];
    undoLastWater(d);
    tick();
    const undoSecond = vi.mocked(undoToast).mock.calls.at(-1)![1];
    expect(waterOn(d)).toBe(6);
    // El aviso más viejo se toca primero (queda arriba): regresa un vaso, no los 8 originales.
    undoFirst();
    tick();
    expect(waterOn(d)).toBe(7);
    undoSecond();
    tick();
    expect(waterOn(d)).toBe(8);
    // Y en el orden normal (el más reciente primero) también vuelve al total original.
    undoLastWater(d);
    tick();
    const a = vi.mocked(undoToast).mock.calls.at(-1)![1];
    undoLastWater(d);
    tick();
    const b = vi.mocked(undoToast).mock.calls.at(-1)![1];
    expect(waterOn(d)).toBe(6);
    b();
    tick();
    expect(waterOn(d)).toBe(7);
    a();
    tick();
    expect(waterOn(d)).toBe(8);
  });

  it('"Deshacer" no regresa nada si el registro ya se restauró por otro lado', () => {
    const d = '2026-01-07';
    const ev = logWater(1, d)!;
    tick();
    undoLastWater(d);
    tick();
    restoreEvent(ev.id); // p. ej. "Restaurar" en la hoja del día
    tick();
    expect(waterOn(d)).toBe(1);
    vi.mocked(undoToast).mock.calls.at(-1)![1]();
    expect(waterOn(d)).toBe(1);
  });

  it('con un solo vaso lo anula y "Deshacer" lo regresa', () => {
    const d = '2026-01-05';
    logWater(1, d);
    tick();
    undoLastWater(d);
    expect(waterOn(d)).toBe(0);
    vi.mocked(undoToast).mock.calls.at(-1)![1]();
    expect(waterOn(d)).toBe(1);
  });
});

describe('textos largos (el dictado se salta maxLength): nunca se manda algo que el servidor rechace', () => {
  const long = (n: number) => 'Hoy entrené pierna y comí bien. '.repeat(Math.ceil(n / 32)).slice(0, n);

  it('check-in: "¿Qué salió bien?" y "¿Qué te costó?" se recortan a lo que acepta el servidor', () => {
    logCheckin({ weekStart: '2026-11-16', effort: 3, energy: 3, mood: 3, pain: [], wins: long(1300), struggles: long(1349) });
    const ev = lastOf('coach.checkin')!;
    expect(validateEvent(ev).ok).toBe(true);
    expect((ev.payload as { struggles: string }).struggles.length).toBeLessThanOrEqual(1000);
  });

  it('comida y nota de "¿Cómo te sientes?" se recortan a 500', () => {
    logMeal({ meal: 'comida', text: long(700), tags: ['proteina'] });
    expect(validateEvent(lastOf('meal.logged')).ok).toBe(true);
    logReadiness({ energy: 4, soreness: 1, pain: [], note: long(800) });
    expect(validateEvent(lastOf('coach.readiness')).ok).toBe(true);
  });

  it('si aun así no pasaría la validación, no se guarda nada y se avisa', () => {
    const n = getEvents().length;
    const ev = logMeal({ meal: 'cena', text: '   ', tags: [] });
    expect(ev).toBeNull();
    expect(getEvents().length).toBe(n);
    expect(vi.mocked(toast).mock.calls.at(-1)?.[1]).toBe('error');
  });

  it('el micrófono respeta el maxLength del campo', () => {
    const g = globalThis as Record<string, unknown>;
    class FakeInput {
      value = '';
      maxLength = -1;
      dispatchEvent() {
        return true;
      }
    }
    class FakeArea extends FakeInput {
      scrollTop = 0;
      scrollHeight = 0;
    }
    g.HTMLInputElement = FakeInput;
    g.HTMLTextAreaElement = FakeArea;
    g.Event = class {
      constructor(public type: string) {}
    };
    const area = new FakeArea();
    area.maxLength = 1000;
    area.value = long(990);
    appendToField(area as unknown as HTMLTextAreaElement, long(400));
    expect(area.value.length).toBe(1000);
    const free = new FakeInput();
    appendToField(free as unknown as HTMLInputElement, long(1500));
    expect(free.value.length).toBeGreaterThan(1000);
  });
});
