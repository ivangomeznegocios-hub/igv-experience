import './helpers/env';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { TRAINING_SETTINGS_ID, project, type Entity } from '@igv/core';

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {} }));
// El store no da `getServerSnapshot` (la app nunca se renderiza en servidor): para estas pruebas, el mismo.
vi.mock('react', async (importOriginal) => {
  const real = await importOriginal<typeof import('react')>();
  const useSyncExternalStore: typeof real.useSyncExternalStore = (s, get, server) => real.useSyncExternalStore(s, get, server ?? get);
  return { ...real, useSyncExternalStore, default: { ...real, useSyncExternalStore } };
});

import { onOpenCoachSheet, type CoachSheetOptions } from '../src/lib/coach';
import Entreno from '../src/screens/Entreno';
import { attentionItems } from '../src/screens/Menus';
import Nutricion from '../src/screens/Nutricion';
import { CoachCard } from '../src/ui/coach/CoachCard';
import { CheckinSheet, MealSheet, MeasureSheet, ReadinessSheet, SetupSheet, SleepSheet, StepsSheet } from '../src/ui/coach/CoachSheets';
import { Field } from '../src/ui/kit';

const html = (el: React.ReactElement, url = '/') => renderToStaticMarkup(<MemoryRouter initialEntries={[url]}>{el}</MemoryRouter>);

describe('títulos de campo: un toque en el texto no presiona botones', () => {
  const sheets = { SetupSheet, ReadinessSheet, CheckinSheet, MealSheet, StepsSheet, SleepSheet, MeasureSheet };
  for (const [name, Sheet] of Object.entries(sheets)) {
    it(`${name}: ningún botón va dentro de un <label>`, () => {
      const out = html(<Sheet onClose={() => {}} />);
      // Un <label> no se anida en otro en estas hojas: basta ver de cada <label> a su </label>.
      const labels = out.match(/<label\b[\s\S]*?<\/label>/g) ?? [];
      for (const l of labels) expect(l, `${name}: ${l.slice(0, 120)}`).not.toMatch(/<button\b/);
      // Los grupos de botones se nombran con aria-labelledby (la hoja de sueño no tiene títulos de campo).
      if (name !== 'SleepSheet') expect(out).toMatch(/role="group" aria-labelledby="/);
    });
  }

  it('si aún queda un botón dentro de un Field, tocar su título no lo presiona (pero un input sí recibe el foco)', () => {
    const label = Field({ label: 'Peso', children: null }) as React.ReactElement<{ onClick: (e: unknown) => void }>;
    const tap = (controlTag: string, onControl = false) => {
      const currentTarget = { control: { tagName: controlTag } };
      const target = { closest: (sel: string) => (sel === 'label' ? currentTarget : onControl ? {} : null) };
      const preventDefault = vi.fn();
      label.props.onClick({ target, currentTarget, preventDefault });
      return preventDefault.mock.calls.length > 0;
    };
    expect(tap('BUTTON')).toBe(true);
    expect(tap('INPUT')).toBe(false);
    expect(tap('BUTTON', true)).toBe(false); // el toque fue en el propio botón: funciona normal
  });
});

describe('enlaces al coach', () => {
  const coachOn: Entity = { id: TRAINING_SETTINGS_ID, module: 'training', kind: 'settings', data: { where: 'gym', coach: { on: true, goal: 'salud', level: 'principiante', days: [0, 2, 4], sessionMinutes: 45, startDate: '2026-10-05' } }, sort: 0, createdAt: 0, updatedAt: 0, deletedAt: null };

  it('el aviso de check-in en "Más" abre la hoja del check-in y lleva a la pestaña Coach', () => {
    const state = project({ events: [], entities: [coachOn], today: '2026-11-21' }); // sábado, sin check-in
    const item = attentionItems(state, () => 'alguien', []).find((a) => a.text.includes('Check-in'));
    expect(item?.to).toBe('/entreno?tab=coach');
    const got: CoachSheetOptions[] = [];
    const off = onOpenCoachSheet((o) => got.push(o));
    item?.onClick?.();
    off();
    expect(got).toEqual([{ kind: 'checkin', week: '2026-11-16' }]);
  });

  it('Entrenamiento abre la pestaña que pide la URL aunque la última usada sea otra', () => {
    localStorage.setItem('igv-entreno-tab2', 'historial');
    const out = html(<Entreno />, '/entreno?tab=coach');
    expect(out).toMatch(/aria-selected="true"[^>]*>Coach</);
    // Sin ?tab= sigue recordando la última.
    expect(html(<Entreno />, '/entreno')).toMatch(/aria-selected="true"[^>]*>Historial</);
  });

  it('"Ver tu plan" de Hoy lleva a la pestaña Coach', () => {
    expect(html(<CoachCard compact />)).toContain('href="/entreno?tab=coach"');
  });
});

describe('Nutrición', () => {
  it('el botón de ícono de "Tus metas" tiene nombre para el lector de pantalla', () => {
    const out = html(<Nutricion />);
    expect(out).toMatch(/<button[^>]*aria-label="Ajustar tus metas"[^>]*title="Ajustar tus metas"|<button[^>]*title="Ajustar tus metas"[^>]*aria-label="Ajustar tus metas"/);
  });
});
