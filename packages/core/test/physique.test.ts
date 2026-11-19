import { describe, expect, it } from 'vitest';
import { firstMeasures, lerpPhysique, measureDates, measuresAsOf, physiqueAsOf, physiqueFrom, resolveCharacter, validateEvent, DEFAULT_CHARACTER } from '../src';
import { ev, run } from './helpers';

describe('complexión del personaje', () => {
  it('sin registros usa una figura promedio y marca todo como estimado', () => {
    const p = physiqueFrom({});
    expect(p.heightCm).toBe(175);
    expect(p.bmi).toBeCloseTo(24, 0);
    expect(p.estimated.height && p.estimated.weight && p.estimated.bodyFat).toBe(true);
    expect(p.estimated.girths).toHaveLength(9);
    expect(p.girths.waist).toBeGreaterThan(70);
    expect(p.girths.waist).toBeLessThan(100);
  });

  it('lo medido siempre gana sobre lo estimado', () => {
    const p = physiqueFrom({ weightKg: 82, bodyFatPct: 18, waistCm: 88.5, armCm: 37 }, { heightCm: 178 });
    expect(p.bodyFatPct).toBe(18);
    expect(p.girths.waist).toBe(88.5);
    expect(p.girths.arm).toBe(37);
    expect(p.estimated.girths).not.toContain('waist');
    expect(p.estimated.girths).toContain('chest');
    expect(p.leanKg).toBeCloseTo(67.2, 1);
  });

  it('sin % de grasa lo estima con la cintura; sin cintura, con IMC y edad', () => {
    const byWaist = physiqueFrom({ weightKg: 80, waistCm: 90 }, { heightCm: 175 });
    expect(byWaist.bodyFatPct).toBeCloseTo(64 - (20 * 175) / 90, 1);
    const young = physiqueFrom({ weightKg: 80 }, { heightCm: 175, age: 25 });
    const older = physiqueFrom({ weightKg: 80 }, { heightCm: 175, age: 45 });
    expect(older.bodyFatPct).toBeGreaterThan(young.bodyFatPct);
  });

  it('más grasa engorda la cintura; más masa magra ensancha hombros y brazos', () => {
    const lean = physiqueFrom({ weightKg: 80, bodyFatPct: 12 }, { heightCm: 175 });
    const soft = physiqueFrom({ weightKg: 80, bodyFatPct: 28 }, { heightCm: 175 });
    expect(soft.girths.waist).toBeGreaterThan(lean.girths.waist);
    expect(lean.girths.shoulders).toBeGreaterThan(soft.girths.shoulders);
    expect(lean.girths.arm).toBeGreaterThan(soft.girths.arm);
    expect(lean.muscle).toBeGreaterThan(soft.muscle);
    expect(soft.fat).toBeGreaterThan(lean.fat);
  });

  it('los índices de grasa y músculo se quedan entre 0 y 1 con datos extremos', () => {
    for (const m of [{ weightKg: 40, bodyFatPct: 3 }, { weightKg: 220, bodyFatPct: 65 }, { weightKg: 130, bodyFatPct: 6 }]) {
      const p = physiqueFrom(m, { heightCm: 170 });
      expect(p.fat).toBeGreaterThanOrEqual(0);
      expect(p.fat).toBeLessThanOrEqual(1);
      expect(p.muscle).toBeGreaterThanOrEqual(0);
      expect(p.muscle).toBeLessThanOrEqual(1);
      for (const g of Object.values(p.girths)) expect(g).toBeGreaterThan(0);
    }
  });

  it('measuresAsOf toma el último valor conocido de cada medida hasta la fecha', () => {
    const entries = [
      { date: '2026-01-01', weightKg: 90, waistCm: 100 },
      { date: '2026-03-01', weightKg: 85 },
      { date: '2026-06-01', weightKg: 80, waistCm: 90, bodyFatPct: 17 },
    ];
    expect(measuresAsOf(entries, '2025-12-31')).toEqual({});
    expect(measuresAsOf(entries, '2026-03-15')).toEqual({ weightKg: 85, waistCm: 100 });
    expect(measuresAsOf(entries, '2026-12-31')).toEqual({ weightKg: 80, waistCm: 90, bodyFatPct: 17 });
    expect(measureDates([...entries, { date: '2026-03-01', armCm: 35 }, { date: '2026-04-01' }])).toEqual(['2026-01-01', '2026-03-01', '2026-06-01']);
  });

  it('measureDates solo cuenta fechas en que una medida cambió; firstMeasures da el primer valor de cada una', () => {
    const entries = [
      { date: '2026-01-01', weightKg: 90 },
      { date: '2026-01-05', weightKg: 90 }, // mismo peso (registro de entrenamiento con el peso prellenado)
      { date: '2026-02-01', weightKg: 88, waistCm: 96 },
      { date: '2026-03-01', waistCm: 93 },
    ];
    expect(measureDates(entries)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
    expect(firstMeasures(entries)).toEqual({ weightKg: 90, waistCm: 96 });
  });

  it('un peso nuevo proyecta la cintura y la grasa viejas en vez de dejarlas fijas', () => {
    const opts = { heightCm: 175, age: 30 };
    const entries = [
      { date: '2026-01-01', weightKg: 95, waistCm: 100 },
      { date: '2026-06-01', weightKg: 80 },
    ];
    const before = physiqueAsOf(entries, '2026-01-01', opts);
    const after = physiqueAsOf(entries, '2026-06-01', opts);
    expect(before.girths.waist).toBe(100);
    expect(before.estimated.girths).not.toContain('waist');
    // Bajó 15 kg: la cintura y la grasa bajan, y no toda la pérdida se le carga a la masa magra.
    expect(after.girths.waist).toBeLessThan(95);
    expect(after.estimated.girths).toContain('waist');
    expect(after.bodyFatPct).toBeLessThan(before.bodyFatPct);
    expect(before.leanKg - after.leanKg).toBeLessThan(8);
    // Conserva tu diferencia personal contra la estimación (aquí, cintura más chica que la estimada).
    const plain = physiqueFrom({ weightKg: 80 }, opts);
    expect(after.girths.waist).toBeLessThan(plain.girths.waist);

    const withFat = [
      { date: '2026-01-01', weightKg: 85, bodyFatPct: 20 },
      { date: '2026-06-01', weightKg: 80 },
    ];
    const p = physiqueAsOf(withFat, '2026-06-01', opts);
    expect(p.bodyFatPct).toBeLessThan(20);
    expect(p.estimated.bodyFat).toBe(true);
    // Si la medida es del mismo día que el peso (o posterior), se usa tal cual.
    expect(physiqueAsOf([...withFat, { date: '2026-06-01', bodyFatPct: 18 }], '2026-06-01', opts).bodyFatPct).toBe(18);
    expect(physiqueAsOf(withFat, '2026-01-01', opts).estimated.bodyFat).toBe(false);
    // Sin registros de peso no hay con qué proyectar: se usan las medidas tal cual.
    expect(physiqueAsOf([{ date: '2026-01-01', waistCm: 90 }], '2026-06-01', opts).girths.waist).toBe(90);
  });

  it('lerpPhysique mezcla dos complexiones', () => {
    const a = physiqueFrom({ weightKg: 90, bodyFatPct: 28 }, { heightCm: 175 });
    const b = physiqueFrom({ weightKg: 78, bodyFatPct: 14 }, { heightCm: 175 });
    const mid = lerpPhysique(a, b, 0.5);
    expect(mid.weightKg).toBeCloseTo(84, 5);
    expect(mid.girths.waist).toBeCloseTo((a.girths.waist + b.girths.waist) / 2, 5);
    expect(lerpPhysique(a, b, 0).girths).toEqual(a.girths);
    expect(lerpPhysique(a, b, 2).girths).toEqual(b.girths);
  });

  it('el estado del cuerpo expone las últimas medidas y sus fechas, sin dar XP', () => {
    const s = run(
      [
        ev('body.logged', '2026-11-01', { weightKg: 84, waistCm: 92 }),
        ev('body.logged', '2026-11-10', { workout: 'Pierna' }),
        ev('body.logged', '2026-11-15', { weightKg: 82.5, bodyFatPct: 19 }),
      ],
      '2026-11-19',
    );
    expect(s.body.latest).toEqual({ weightKg: 82.5, waistCm: 92, bodyFatPct: 19 });
    expect(s.body.measureDates).toEqual(['2026-11-01', '2026-11-15']);
    expect(s.xp.total).toBe(0);
  });

  it('valida las medidas nuevas de body.logged', () => {
    const base = { id: 'abcdefgh-2', occurredAt: '2026-11-19T12:00:00.000Z', localDate: '2026-11-19', type: 'body.logged' };
    expect(validateEvent({ ...base, payload: { waistCm: 88 } }).ok).toBe(true);
    expect(validateEvent({ ...base, payload: { bodyFatPct: 18.5, chestCm: 102 } }).ok).toBe(true);
    expect(validateEvent({ ...base, payload: { bodyFatPct: 90 } }).ok).toBe(false);
    expect(validateEvent({ ...base, payload: { waistCm: -3 } }).ok).toBe(false);
    expect(validateEvent({ ...base, payload: {} }).ok).toBe(false);
  });

  it('resolveCharacter completa lo que falte con los valores por defecto', () => {
    expect(resolveCharacter(undefined)).toEqual(DEFAULT_CHARACTER);
    const c = resolveCharacter({ look: { ...DEFAULT_CHARACTER.look, hair: 'rapado' } });
    expect(c.look.hair).toBe('rapado');
    expect(c.outfit).toEqual(DEFAULT_CHARACTER.outfit);
  });
});
