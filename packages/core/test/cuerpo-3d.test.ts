import { describe, expect, it } from 'vitest';
import {
  EXERCISE_LIBRARY,
  GAME_CONFIG,
  MUSCLES,
  MUSCLE_IDS,
  addDays,
  compareBodies,
  compareChoices,
  everMeasured,
  formatDelta,
  muscleDetail,
  muscleLegend,
  musclePaint,
  muscleRegionAt,
  muscleStatus,
  physiqueDeltas,
  physiqueFrom,
  type BodyPart,
  type MuscleId,
  type WorkoutExercise,
} from '../src';
import { ev, run } from './helpers';

const TODAY = '2026-11-19'; // jueves

describe('antes / ahora: comparar el cuerpo entre dos fechas', () => {
  const entries = [
    { date: '2026-05-01', weightKg: 84, bodyFatPct: 22, waistCm: 92, armCm: 34 },
    { date: '2026-07-01', weightKg: 81 },
    { date: '2026-09-01', weightKg: 79, waistCm: 88, armCm: 35.5 },
    { date: '2026-11-15', weightKg: 78, bodyFatPct: 17, waistCm: 86, armCm: 35.5 },
  ];
  const opts = { heightCm: 176, age: 32 };

  it('lo medido en las dos fechas es exacto; lo que solo existe en una se marca estimado (≈)', () => {
    const c = compareBodies(entries, '2026-05-01', '2026-11-15', opts);
    const by = Object.fromEntries(c.deltas.map((d) => [d.key, d]));
    expect(by.weightKg).toMatchObject({ from: 84, to: 78, delta: -6, estimated: false });
    expect(by.waistCm).toMatchObject({ from: 92, to: 86, delta: -6, estimated: false });
    expect(by.armCm).toMatchObject({ delta: 1.5, estimated: false });
    expect(by.bodyFatPct).toMatchObject({ delta: -5, estimated: false });
    expect(by.leanKg!.estimated).toBe(false);
    // Nunca se midió el pecho: no se compara (sería la fórmula contra sí misma).
    expect(by.chestCm).toBeUndefined();
    expect(formatDelta(by.armCm!)).toBe('Brazo +1.5 cm');
    expect(formatDelta(by.waistCm!)).toBe('Cintura −6 cm');
  });

  it('una medida vieja proyectada con el peso nuevo cuenta como estimada', () => {
    // El 1 de julio solo hubo peso: la cintura de mayo se proyecta (≈) a ese día.
    const c = compareBodies(entries, '2026-05-01', '2026-07-01', opts);
    const waist = c.deltas.find((d) => d.key === 'waistCm')!;
    expect(waist.estimated).toBe(true);
    expect(waist.delta).toBeLessThan(0);
    expect(formatDelta(waist).startsWith('≈ Cintura −')).toBe(true);
    expect(c.deltas.find((d) => d.key === 'weightKg')!.estimated).toBe(false);
  });

  it('el orden de las fechas no importa y lo que no cambió no aparece', () => {
    const a = compareBodies(entries, '2026-11-15', '2026-05-01', opts);
    expect(a.from).toBe('2026-05-01');
    const same = compareBodies(entries, '2026-09-01', '2026-11-15', opts);
    expect(same.deltas.find((d) => d.key === 'armCm')).toBeUndefined();
  });

  it('everMeasured: masa magra solo si hay peso y % de grasa', () => {
    expect([...everMeasured(entries, '2026-04-01')]).toEqual([]);
    const m = everMeasured([{ date: '2026-01-01', weightKg: 80, calfCm: 38 }], TODAY);
    expect(m.has('calfCm')).toBe(true);
    expect(m.has('leanKg')).toBe(false);
    const p = physiqueFrom({ weightKg: 80 });
    expect(physiqueDeltas(p, physiqueFrom({ weightKg: 79 }), m).map((d) => d.key)).toEqual(['weightKg', 'calfCm']);
  });

  it('opciones de "antes": primer registro y hace 1/3/6/12 meses sin repetir ni caer en el último', () => {
    const dates = ['2025-10-01', '2026-02-10', '2026-06-01', '2026-08-15', '2026-10-05', '2026-10-25', '2026-11-15'];
    const c = compareChoices(dates, TODAY);
    expect(c[0]).toEqual({ id: 'inicio', label: 'Primer registro', date: '2025-10-01' });
    expect(c.map((x) => x.id)).toEqual(['inicio', 'seis', 'tres', 'mes']);
    expect(c.find((x) => x.id === 'tres')!.date).toBe('2026-08-15');
    expect(c.find((x) => x.id === 'mes')!.date).toBe('2026-10-05');
    expect(c.some((x) => x.date === '2026-11-15')).toBe(false);
    expect(compareChoices(['2026-11-01'], TODAY)).toEqual([]);
    expect(compareChoices([], TODAY)).toEqual([]);
  });
});

describe('músculos sobre el cuerpo 3D', () => {
  const sample = () => {
    const found = new Map<MuscleId, { front: number; back: number }>();
    const parts: { part: BodyPart; v: [number, number] }[] = [
      { part: 'torso', v: [0.46, 0.86] },
      { part: 'brazo', v: [0, 1] },
      { part: 'pierna', v: [0.05, 0.56] },
    ];
    for (const { part, v } of parts)
      for (let i = 0; i <= 60; i++)
        for (let j = 0; j < 48; j++)
          for (const xn of part === 'torso' ? [0.1, 0.3, 0.5, 0.7, 0.9] : [0]) {
            const vv = v[0] + ((v[1] - v[0]) * i) / 60;
            const angle = (j / 48) * Math.PI * 2;
            const m = muscleRegionAt(part, vv, angle, xn);
            if (!m) continue;
            const e = found.get(m) ?? { front: 0, back: 0 };
            if (Math.sin(angle) > 0.3) e.front++;
            if (Math.sin(angle) < -0.3) e.back++;
            found.set(m, e);
          }
    return found;
  };

  it('cada grupo muscular tiene una zona en el cuerpo, y se ve desde donde dice la biblioteca', () => {
    const found = sample();
    for (const id of MUSCLE_IDS) {
      expect(found.has(id), id).toBe(true);
      const e = found.get(id)!;
      if (MUSCLES[id].views.includes('frente')) expect(e.front, `${id} de frente`).toBeGreaterThan(0);
      if (MUSCLES[id].views.includes('espalda')) expect(e.back, `${id} de espalda`).toBeGreaterThan(0);
    }
  });

  it('puntos de referencia', () => {
    const F = Math.PI / 2;
    const B = -Math.PI / 2;
    expect(muscleRegionAt('torso', 0.74, F, 0.45)).toBe('pecho');
    expect(muscleRegionAt('torso', 0.64, F, 0.1)).toBe('abdomen');
    expect(muscleRegionAt('torso', 0.63, F, 0.7)).toBe('oblicuos');
    expect(muscleRegionAt('torso', 0.7, B, 0.8)).toBe('espalda');
    expect(muscleRegionAt('torso', 0.76, B, 0.2)).toBe('trapecio');
    expect(muscleRegionAt('torso', 0.6, B, 0.2)).toBe('lumbar');
    expect(muscleRegionAt('torso', 0.53, B, 0.5)).toBe('gluteos');
    expect(muscleRegionAt('torso', 0.9, F, 0.1)).toBeNull();
    expect(muscleRegionAt('brazo', 0.1, F)).toBe('hombro_frontal');
    expect(muscleRegionAt('brazo', 0.1, 0)).toBe('hombro_lateral');
    expect(muscleRegionAt('brazo', 0.1, B)).toBe('hombro_posterior');
    expect(muscleRegionAt('brazo', 0.38, F)).toBe('biceps');
    expect(muscleRegionAt('brazo', 0.38, B)).toBe('triceps');
    expect(muscleRegionAt('brazo', 0.7, F)).toBe('antebrazo');
    expect(muscleRegionAt('brazo', 1.1, F)).toBeNull();
    expect(muscleRegionAt('pierna', 0.42, F)).toBe('cuadriceps');
    expect(muscleRegionAt('pierna', 0.42, B)).toBe('isquios');
    expect(muscleRegionAt('pierna', 0.42, Math.PI)).toBe('aductores');
    expect(muscleRegionAt('pierna', 0.2, B)).toBe('pantorrillas');
    expect(muscleRegionAt('pierna', 0.2, F)).toBeNull();
    expect(muscleRegionAt('pierna', 0.52, B)).toBe('gluteos');
  });

  const wk = (date: string, exercises: [string, number, number, number?][], occurredAt: string) => {
    const ex: WorkoutExercise[] = exercises.map(([exerciseId, n, reps, kg]) => ({
      exerciseId,
      name: EXERCISE_LIBRARY.find((e) => e.id === exerciseId)!.name,
      sets: Array.from({ length: n }, () => (kg ? { reps, kg } : { reps })),
    }));
    return ev('workout.logged', date, { kind: 'fuerza', exercises: ex }, { occurredAt });
  };

  it('color por estado con los criterios de muscleStatus y config.training', () => {
    const s = run(
      [
        wk(addDays(TODAY, -3), [['press-banca', 5, 8, 60], ['curl-barra', 3, 10, 30]], `${addDays(TODAY, -3)}T20:00:00.000Z`),
        wk(addDays(TODAY, -1), [['press-banca', 5, 8, 60], ['sentadilla', 4, 5, 100]], `${addDays(TODAY, -1)}T20:00:00.000Z`),
      ],
      TODAY,
    );
    const st = muscleStatus(s.training.summary, `${TODAY}T20:00:00.000Z`);
    // Pecho: 10 series y entrenado hace 24 h (72 h): recuperando gana sobre "en la meta".
    expect(musclePaint(st.pecho, 'estado').tone).toBe('recuperando');
    expect(musclePaint(st.pecho, 'volumen').tone).toBe('v3');
    // Bíceps: 3 series hace 72 h (48 h): listo, bajo el mínimo de 6 → te falta.
    expect(st.biceps.state).toBe('listo');
    expect(musclePaint(st.biceps, 'estado')).toEqual({ tone: 'falta', strength: 1 });
    expect(musclePaint(st.biceps, 'recuperacion').tone).toBe('listo');
    // Nunca entrenado: te falta (más suave) en estado; sin pintar en volumen y recuperación.
    expect(musclePaint(st.pantorrillas, 'estado')).toEqual({ tone: 'falta', strength: 0.8 });
    expect(musclePaint(st.pantorrillas, 'volumen').tone).toBeNull();
    expect(musclePaint(st.pantorrillas, 'recuperacion').tone).toBeNull();
    // Recuperación: más intenso entre más reciente.
    const fresh = musclePaint(st.cuadriceps, 'recuperacion');
    expect(fresh.tone).toBe('recuperando');
    expect(fresh.strength).toBeGreaterThan(musclePaint({ ...st.cuadriceps, fatigue: 0.1 }, 'recuperacion').strength);
    // En la meta y trabajado (sin recuperación pendiente).
    expect(musclePaint({ ...st.pecho, state: 'listo' }, 'estado').tone).toBe('meta');
    expect(musclePaint({ ...st.biceps, weekSets: 7 }, 'estado').tone).toBe('efectivo');

    const d = muscleDetail(st.pecho);
    expect(d.title).toBe('Pecho');
    expect(d.status).toMatch(/^Recuperando · listo en/);
    expect(d.lines[0]).toBe('10 de 10 series esta semana (mínimo 6)');
    expect(d.lines[1]).toBe('Entrenado hace 24 h');
    expect(d.lines[2]).toBe('Recupera en 72 h (músculo grande)');
    expect(muscleDetail(st.pantorrillas).lines[1]).toBe('Sin entrenamientos registrados');
  });

  it('la leyenda usa los números de la config', () => {
    const w = GAME_CONFIG.training.weeklySets;
    expect(muscleLegend('estado').map((l) => l.tone)).toEqual(['falta', 'efectivo', 'meta', 'recuperando']);
    expect(muscleLegend('estado')[0]!.label).toContain(String(w.min));
    expect(muscleLegend('volumen')).toHaveLength(5);
    expect(muscleLegend('recuperacion')[0]!.label).toContain('48 h');
  });
});
