import './helpers/env';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRAINING_SETTINGS_ID, addDays, type CoachSettings, type GameEvent } from '@igv/core';

// Fecha fija (miércoles 18 de noviembre de 2026, 12:00 en CDMX): el plan del coach depende del día.
const NOW = vi.hoisted(() => {
  const now = new Date('2026-11-18T18:00:00.000Z');
  vi.useFakeTimers({ toFake: ['Date'], now });
  return now;
});

vi.mock('react', async (importOriginal) => {
  const real = await importOriginal<typeof import('react')>();
  const { fakeHooks } = await import('./helpers/fake-react');
  return { ...real, ...fakeHooks, default: { ...real, ...fakeHooks } };
});
vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {} }));
vi.mock('../src/ui/kit', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/ui/kit')>()), toast: vi.fn(), undoToast: vi.fn() }));
vi.mock('../src/lib/sound', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/sound')>();
  return { ...real, sfx: { ...real.sfx, coin: vi.fn(), restDone: vi.fn() }, unlockAudio: vi.fn() };
});

import { server } from './helpers/env';
import { find, findAll, render, renderHook, text } from './helpers/fake-react';
import { addEvent, getEvents, saveEntity, useGame } from '../src/data/store';
import { applySwap, useCoachPlan } from '../src/lib/coach';
import { sfx, unlockAudio } from '../src/lib/sound';
import { CoachCard } from '../src/ui/coach/CoachCard';
import { CoachChat, safeSources } from '../src/ui/coach/CoachChat';
import { MeasureSheet, StepsSheet } from '../src/ui/coach/CoachSheets';
import { SwapSheet } from '../src/ui/coach/CoachTab';
import { RestTimer } from '../src/ui/coach/RestTimer';
import { DateChips, toast } from '../src/ui/kit';
import { Stepper } from '../src/ui/quick/WorkoutQuick';

const TODAY = '2026-11-18';
/** Deja correr las promesas pendientes (respuestas de fetch). */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
const lastOf = (type: string): GameEvent | undefined => getEvents().filter((e) => e.type === type && !e.voidedAt).at(-1);
const stepper = (out: unknown, label: string) => find(out, (el) => el.type === Stepper && el.props.label === label);
const button = (out: unknown, label: string) => find(out, (el) => el.type === 'button' && text(el).includes(label));
const state = () => renderHook(() => useGame().state).value;

function setCoach(coach: CoachSettings, where: 'gym' | 'casa') {
  saveEntity({ id: TRAINING_SETTINGS_ID, module: 'training', kind: 'settings', data: { where, coach }, sort: 0 });
}

beforeEach(() => {
  vi.mocked(toast).mockClear();
});
afterAll(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------------------------

describe('Coach con IA: un fallo al preguntar /api/gm/status no lo apaga para toda la sesión', () => {
  it('sin conexión dice "Sin conexión" (no pide configurar la llave) y al volver la señal vuelve a preguntar', async () => {
    server.routes = {};
    const chat = render(CoachChat, { coachName: 'Coach' });
    await settle();
    expect(text(chat.out)).not.toContain('ANTHROPIC_API_KEY');
    expect(text(chat.out)).toContain('Sin conexión');
    chat.unmount();

    server.routes = { '/gm/status': () => ({ enabled: true }) };
    const card = render(CoachCard, { compact: true });
    await settle();
    expect(findAll(card.out, (el) => el.type === 'button' && text(el).includes('Pregúntale'))).toHaveLength(1);
    card.unmount();
  });

  it('el mensaje de configurar la llave solo sale si el servidor dice que no está activa', async () => {
    vi.setSystemTime(Date.now() + 11 * 60_000); // pasó la caché de 10 min
    server.routes = { '/gm/status': () => ({ enabled: false }) };
    const chat = render(CoachChat, { coachName: 'Coach' });
    await settle();
    expect(text(chat.out)).toContain('ANTHROPIC_API_KEY');
    chat.unmount();
    vi.setSystemTime(NOW);
  });
});

// ---------------------------------------------------------------------------------------------

describe('Cronómetro de descanso', () => {
  it('un "¡Va!" viejo no detiene el descanso nuevo, y suena con el audio compartido (iOS)', () => {
    vi.useRealTimers();
    vi.useFakeTimers({ now: NOW });
    try {
      const r = render(RestTimer, { seconds: 3 });
      const btn = () => find(r.out, (el) => el.type === 'button');
      btn().props.onClick();
      expect(unlockAudio).toHaveBeenCalled(); // el audio se desbloquea en el toque
      vi.advanceTimersByTime(3250);
      expect(text(btn())).toContain('¡Va!');
      expect(sfx.restDone).toHaveBeenCalledTimes(1);
      btn().props.onClick(); // lo quita
      btn().props.onClick(); // arranca el siguiente descanso
      vi.advanceTimersByTime(1600); // aquí vencía el temporizador viejo
      expect(text(btn())).toMatch(/0:0[12]/);
      vi.advanceTimersByTime(1700);
      expect(text(btn())).toContain('¡Va!');
      expect(sfx.restDone).toHaveBeenCalledTimes(2);
      r.unmount();
      expect(vi.getTimerCount()).toBe(0); // al desmontar no queda nada programado
    } finally {
      vi.useRealTimers();
      vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe('Hoja de pasos', () => {
  it('al elegir otro día muestra los pasos de ese día (no los de hoy)', () => {
    const y = addDays(TODAY, -1);
    addEvent('steps.logged', { steps: 9000 }, { localDate: y });
    addEvent('steps.logged', { steps: 2500 }, { localDate: TODAY });
    const r = render(StepsSheet, { onClose: () => {} });
    expect(stepper(r.out, 'pasos').props.value).toBe(2500);
    find(r.out, (el) => el.type === DateChips).props.onChange(y);
    expect(stepper(r.out, 'pasos').props.value).toBe(9000);
    // Un día sin registro: vacío y sin poder guardar.
    find(r.out, (el) => el.type === DateChips).props.onChange(addDays(TODAY, -2));
    expect(stepper(r.out, 'pasos').props.value).toBeUndefined();
    expect(button(r.out, 'Guardar').props.disabled).toBe(true);
    r.unmount();
  });

  it('si ya escribiste el número, cambiar de día no lo borra', () => {
    const r = render(StepsSheet, { onClose: () => {} });
    stepper(r.out, 'pasos').props.onChange(7000);
    find(r.out, (el) => el.type === DateChips).props.onChange(addDays(TODAY, -1));
    expect(stepper(r.out, 'pasos').props.value).toBe(7000);
    r.unmount();
  });
});

// ---------------------------------------------------------------------------------------------

describe('Hoja de medidas', () => {
  it('peso y cintura empiezan vacíos ("Último: X") y solo se guarda lo que mediste hoy', () => {
    addEvent('body.logged', { weightKg: 88, waistCm: 95 }, { localDate: '2026-09-20' });
    addEvent('body.logged', { weightKg: 84 }, { localDate: '2026-11-11' });
    const r = render(MeasureSheet, { onClose: () => {} });
    expect(stepper(r.out, 'peso').props.value).toBeUndefined();
    expect(stepper(r.out, 'cintura').props.value).toBeUndefined();
    expect(stepper(r.out, 'peso').props.placeholder).toBe('Último: 84');
    expect(stepper(r.out, 'cintura').props.placeholder).toBe('Último: 95');
    expect(button(r.out, 'Guardar medidas').props.disabled).toBe(true);
    stepper(r.out, 'peso').props.onChange(83);
    button(r.out, 'Guardar medidas').props.onClick();
    expect(lastOf('body.logged')?.payload).toEqual({ weightKg: 83 });
    r.unmount();
  });

  it('los botones − / + parten del último valor', () => {
    const onChange = vi.fn();
    const out = Stepper({ value: undefined, base: 84, onChange, step: 0.1, label: 'peso', unit: 'kg' });
    find(out, (el) => el.type === 'button' && el.props['aria-label'] === 'Menos peso').props.onClick();
    expect(onChange).toHaveBeenLastCalledWith(83.9);
  });
});

// ---------------------------------------------------------------------------------------------

describe('Cambiar ejercicio de la sesión de hoy', () => {
  const configs: [CoachSettings, 'gym' | 'casa'][] = [
    [{ on: true, goal: 'salud', level: 'principiante', days: [0, 2, 4], sessionMinutes: 90, startDate: '2026-11-16' }, 'casa'],
    [{ on: true, goal: 'salud', level: 'sedentario', days: [0, 2, 4], sessionMinutes: 90, startDate: '2026-08-03' }, 'casa'],
    [{ on: true, goal: 'salud', level: 'intermedio', days: [0, 2, 4], sessionMinutes: 120, startDate: '2026-11-16' }, 'gym'],
  ];

  it('no ofrece ejercicios que ya usa otro ejercicio de la sesión', () => {
    for (const [coach, where] of configs) {
      setCoach(coach, where);
      const session = renderHook(() => useCoachPlan()).value.today.session;
      expect(session.exercises.length).toBeGreaterThan(1);
      for (const e of session.exercises) {
        const taken = new Set(session.exercises.filter((x) => x !== e).map((x) => x.exerciseId));
        const r = render(SwapSheet, { e, session, onClose: () => {} });
        const offered = findAll(r.out, (el) => el.type === 'button' && String(el.props.className).includes('wk-item')).map((el) => String(el.key));
        for (const id of offered) expect(taken.has(id), `${coach.level}/${where} ${e.slot}: ${id} ya está en la sesión`).toBe(false);
        r.unmount();
      }
    }
  });

  it('solo dice "ahora X" (y guarda) si la sesión de hoy de verdad cambia', () => {
    setCoach(configs[0][0], configs[0][1]);
    const session = renderHook(() => useCoachPlan()).value.today.session;
    const [first, second] = session.exercises;
    const before = state().training.settings.coach?.swaps;
    // Un ejercicio que ya usa un patrón anterior: el plan ignoraría el cambio.
    expect(applySwap(state(), second.slot, first.exerciseId, NOW.toISOString())).toBe(false);
    expect(state().training.settings.coach?.swaps).toEqual(before);

    const e = session.exercises.find((x) => {
      const r = render(SwapSheet, { e: x, session, onClose: () => {} });
      const n = findAll(r.out, (el) => String(el.props.className).includes('wk-item')).length;
      r.unmount();
      return n > 0;
    })!;
    const r = render(SwapSheet, { e, session, onClose: () => {} });
    const opt = findAll(r.out, (el) => el.type === 'button' && String(el.props.className).includes('wk-item'))[0];
    opt.props.onClick();
    expect(vi.mocked(toast).mock.calls.at(-1)?.[0]).toBe(`${e.slotLabel}: ahora ${text(opt)}`);
    const after = renderHook(() => useCoachPlan()).value.today.session.exercises.find((x) => x.slot === e.slot);
    expect(after?.exerciseId).toBe(String(opt.key));
    r.unmount();
  });
});

describe('fuentes de la búsqueda web en el chat del coach', () => {
  it('solo enlaces http(s), sin repetir, con título corto y máximo 6', () => {
    const long = 'Guía de actividad física para adultos de la Organización Mundial de la Salud, edición completa';
    const out = safeSources([
      { title: 'OMS', url: 'https://www.who.int/a' },
      { title: 'Otra vez', url: 'https://www.who.int/a' },
      { title: 'Peligro', url: 'javascript:alert(1)' },
      { title: '', url: 'http://example.org/x' },
      { title: long, url: 'https://example.org/largo' },
      ...Array.from({ length: 8 }, (_, i) => ({ title: `F${i}`, url: `https://f.example/${i}` })),
    ]);
    expect(out[0]).toEqual({ title: 'OMS', url: 'https://www.who.int/a' });
    expect(out.map((s) => s.url)).not.toContain('javascript:alert(1)');
    expect(out[1]).toEqual({ title: 'http://example.org/x', url: 'http://example.org/x' });
    expect(out[2].title.length).toBeLessThanOrEqual(58);
    expect(out[2].title.endsWith('…')).toBe(true);
    expect(out).toHaveLength(6);
    expect(safeSources(undefined)).toEqual([]);
  });
});
