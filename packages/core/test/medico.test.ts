import { describe, expect, it } from 'vitest';
import {
  HEALTH_DOCTOR_ID,
  buildHealthDossier,
  classifyAgainstRange,
  classifyHealthMetric,
  doctorReviewDue,
  healthDataGaps,
  healthFileScore,
  memoryAssistantStore,
  metricKindFromName,
  nextDoctorReview,
  project,
  recordValueToMetric,
  resolveMetricKind,
  runAssistantTool,
  validateEvent,
  type Entity,
  type GameEvent,
  type HealthConsultData,
  type HealthRecordData,
} from '../src';
import { ev, run, seed } from './helpers';

const TODAY = '2026-11-19';

const record = (id: string, data: Partial<HealthRecordData>, createdAt = 1): Entity<HealthRecordData> => ({
  id,
  module: 'health',
  kind: 'record',
  sort: 0,
  createdAt,
  data: { title: id, type: 'laboratorio', date: TODAY, files: [], ...data },
});
const consult = (id: string, data: Partial<HealthConsultData>, createdAt = 1): Entity<HealthConsultData> => ({
  id,
  module: 'health',
  kind: 'consult',
  sort: 0,
  createdAt,
  data: { date: TODAY, kind: 'auto', title: id, message: 'Hola', status: 'bien', highlights: [], actions: [], missing: [], ...data },
});
const settingsWith = (extra: Record<string, unknown>) => seed.map((e) => (e.id === 'settings' ? { ...e, data: { ...e.data, ...extra } } : e));

describe('médico IA: mediciones de laboratorio', () => {
  it('rangos de referencia de los valores de laboratorio', () => {
    expect(classifyHealthMetric('trigliceridos', 120)?.level).toBe('ok');
    expect(classifyHealthMetric('trigliceridos', 210)?.level).toBe('alto');
    expect(classifyHealthMetric('hdl', 38)?.level).toBe('bajo');
    expect(classifyHealthMetric('ldl', 145)?.level).toBe('atencion');
    expect(classifyHealthMetric('hba1c', 5.9)?.text).toContain('prediabetes');
    expect(classifyHealthMetric('hba1c', 6.7)?.level).toBe('alto');
    expect(classifyHealthMetric('vitamina_d', 18)?.level).toBe('bajo');
    expect(classifyHealthMetric('saturacion', 89)?.text).toContain('atención médica hoy');
    expect(classifyHealthMetric('tsh', 2.1)?.level).toBe('ok');
  });

  it('reconoce nombres de laboratorio sin confundir los parecidos', () => {
    expect(metricKindFromName('Colesterol HDL')).toBe('hdl');
    expect(metricKindFromName('Colesterol LDL (calculado)')).toBe('ldl');
    expect(metricKindFromName('Colesterol no HDL')).toBeNull();
    expect(metricKindFromName('Colesterol total')).toBe('colesterol');
    expect(metricKindFromName('Hemoglobina glucosilada A1c')).toBe('hba1c');
    expect(metricKindFromName('HbA1c')).toBe('hba1c');
    expect(metricKindFromName('Hemoglobina')).toBe('hemoglobina');
    expect(metricKindFromName('Hemoglobina corpuscular media')).toBeNull();
    expect(metricKindFromName('Glucosa')).toBe('glucosa');
    expect(metricKindFromName('Glucosa en orina')).toBeNull();
    expect(metricKindFromName('Ácido úrico')).toBe('acido_urico');
    expect(metricKindFromName('Triglicéridos')).toBe('trigliceridos');
    expect(metricKindFromName('TSH')).toBe('tsh');
    expect(metricKindFromName('Vitamina D 25-OH')).toBe('vitamina_d');
    expect(metricKindFromName('Gamma GT')).toBeNull();
  });

  it('una "otra" con nombre conocido se agrupa solo si la unidad coincide', () => {
    expect(resolveMetricKind('otro', 'Triglicéridos', 'mg/dL')).toBe('trigliceridos');
    expect(resolveMetricKind('otro', 'Triglicéridos', '')).toBe('trigliceridos');
    expect(resolveMetricKind('otro', 'Glucosa', 'mmol/L')).toBe('otro');
    expect(resolveMetricKind('otro', 'TSH', 'µUI/mL')).toBe('tsh');
    expect(resolveMetricKind('glucosa', 'lo que sea', 'mmol/L')).toBe('glucosa');
  });

  it('valores de un estudio → mediciones', () => {
    expect(recordValueToMetric({ name: 'Colesterol HDL', value: 38, unit: 'mg/dL', low: 40 })).toEqual({ kind: 'hdl', value: 38, refLow: 40, refHigh: undefined });
    expect(recordValueToMetric({ name: 'Gamma GT', value: 31, unit: 'U/L', low: 8, high: 61 })).toEqual({ kind: 'otro', value: 31, unit: 'U/L', label: 'Gamma GT', refLow: 8, refHigh: 61 });
    expect(recordValueToMetric({ name: 'Glucosa', value: 5.2, unit: 'mmol/L' })).toMatchObject({ kind: 'otro', label: 'Glucosa', unit: 'mmol/L' });
    expect(recordValueToMetric({ name: 'Presión arterial', kind: 'presion', value: 120, value2: 80 })).toEqual({ kind: 'presion', value: 120, value2: 80 });
    expect(recordValueToMetric({ name: 'Presión arterial', kind: 'presion', value: 120 })).toBeNull();
    expect(recordValueToMetric({ name: 'Examen de orina', text: 'Normal' })).toBeNull();
    // Rango al revés: se descarta el rango, no el valor.
    expect(recordValueToMetric({ name: 'Gamma GT', value: 31, unit: 'U/L', low: 61, high: 8 })).toEqual({ kind: 'otro', value: 31, unit: 'U/L', label: 'Gamma GT' });
  });

  it('una medición "otra" con rango del estudio se ubica contra ese rango', () => {
    expect(classifyAgainstRange(70, 8, 61)?.level).toBe('alto');
    expect(classifyAgainstRange(5, 8, 61)?.level).toBe('bajo');
    expect(classifyAgainstRange(30, 8, 61)?.level).toBe('ok');
    expect(classifyAgainstRange(30)).toBeNull();
    const s = run([ev('health.metric', TODAY, { kind: 'otro', label: 'Gamma GT', unit: 'U/L', value: 70, refLow: 8, refHigh: 61, recordId: 'hrec-1' })], TODAY);
    const m = s.health.metrics['otro:gamma-gt'][0];
    expect(m).toMatchObject({ level: 'alto', ref: '8–61', recordId: 'hrec-1' });
  });

  it('valida los eventos nuevos', () => {
    const base = { id: 'ev-12345678', type: 'health.metric', occurredAt: '2026-11-19T12:00:00.000Z', localDate: TODAY };
    expect(validateEvent({ ...base, payload: { kind: 'hba1c', value: 5.4 } }).ok).toBe(true);
    expect(validateEvent({ ...base, payload: { kind: 'otro', label: 'GGT', value: 30, refLow: 61, refHigh: 8 } }).ok).toBe(false);
    expect(validateEvent({ ...base, payload: { kind: 'inventado', value: 1 } }).ok).toBe(false);
  });
});

describe('médico IA: estudios, revisiones y expediente', () => {
  it('estudios del más reciente al más antiguo, con lo gastado y los valores fuera de rango', () => {
    const entities = [
      ...seed,
      record('hrec-a', { date: '2025-06-01', cost: 300 }),
      record('hrec-b', { date: '2026-10-01', cost: 650, ai: { readAt: '', summary: 'x', findings: [], recommendations: [], values: [{ name: 'TG', value: 210, flag: 'alto' }, { name: 'G', value: 90 }] } }),
      record('hrec-c', { date: '2026-11-10', cost: null }),
    ];
    const h = run([], TODAY, { entities }).health;
    expect(h.records.map((r) => r.id)).toEqual(['hrec-c', 'hrec-b', 'hrec-a']);
    expect(h.records[1].flagged).toBe(1);
    expect(h.spendThisYear).toBe(650);
    expect(h.spendTotal).toBe(950);
  });

  it('la última revisión: sin ver, acciones pendientes y siguiente fecha según la frecuencia', () => {
    const entities = [
      ...seed,
      consult('c-old', { date: '2026-11-01', seenAt: '2026-11-01T10:00:00Z' }),
      consult('c-new', {
        date: '2026-11-12',
        actions: [
          { id: 'a1', text: 'Laboratorios', type: 'estudio', priority: 'alta' },
          { id: 'a2', text: 'Dormir', type: 'habito', priority: 'baja', doneAt: '2026-11-13' },
          { id: 'a3', text: 'Presión', type: 'medicion', priority: 'media', dismissedAt: '2026-11-13' },
        ],
      }),
    ];
    let h = run([], TODAY, { entities }).health;
    expect(h.consults[0].id).toBe('c-new');
    expect(h.unseenConsultId).toBe('c-new');
    expect(h.pendingActions.map((a) => a.id)).toEqual(['a1']);
    expect(h.nextReview).toBe('2026-11-19'); // semanal por defecto
    const monthly = [...entities, { id: HEALTH_DOCTOR_ID, module: 'health', kind: 'doctor', sort: 0, data: { cadence: 'mensual' } }];
    h = run([], TODAY, { entities: monthly }).health;
    expect(h.nextReview).toBe('2026-12-12');
    expect(h.doctor.cadence).toBe('mensual');
  });

  it('cuándo toca la revisión automática', () => {
    expect(doctorReviewDue(null, 'semanal', TODAY)).toBe(false); // la primera se pide a mano
    expect(doctorReviewDue('2026-11-12', 'semanal', TODAY)).toBe(true);
    expect(doctorReviewDue('2026-11-13', 'semanal', TODAY)).toBe(false);
    expect(doctorReviewDue('2026-10-01', 'manual', TODAY)).toBe(false);
    expect(nextDoctorReview('2026-11-01', 'quincenal')).toBe('2026-11-15');
  });

  it('datos que faltan: vacío al inicio, completo con lo básico', () => {
    const empty = healthDataGaps(run([], TODAY));
    expect(empty.find((g) => g.id === 'laboratorios')?.done).toBe(false);
    expect(healthFileScore(empty)).toBeLessThan(30);
    const entities = [
      ...settingsWith({ birthDate: '1991-04-12', heightCm: 176 }),
      record('hrec-lab', { date: '2026-09-01' }),
      { id: 'health-profile', module: 'health', kind: 'profile', sort: 0, data: { bloodType: 'O+' } },
      { id: HEALTH_DOCTOR_ID, module: 'health', kind: 'doctor', sort: 0, data: { familyHistory: 'Papá con diabetes' } },
      { id: 'chk-dental', module: 'health', kind: 'checkup', sort: 0, data: { name: 'Dental', category: 'dental', everyMonths: 6, active: true } },
    ];
    const events: GameEvent[] = [
      ev('body.logged', '2026-11-10', { weightKg: 84, waistCm: 92 }),
      ev('health.metric', '2026-10-01', { kind: 'presion', value: 124, value2: 79 }),
      ev('checkin.morning', '2026-11-18', { sleepHours: 7 }),
      ev('workout.logged', '2026-11-17', { kind: 'fuerza', title: 'Pierna', minutes: 50, exercises: [] }),
    ];
    const gaps = healthDataGaps(run(events, TODAY, { entities }));
    expect(gaps.filter((g) => !g.done).map((g) => g.id)).toEqual([]);
    expect(healthFileScore(gaps)).toBe(100);
  });

  it('el expediente junta todo, marca lo nuevo desde la última revisión y respeta el tamaño', () => {
    const entities = [
      ...settingsWith({ birthDate: '1991-04-12', heightCm: 176, name: 'Iván' }),
      record('hrec-lab', { title: 'Química sanguínea', date: '2026-11-15', place: 'Lab Centro', ai: { readAt: '', summary: 'Triglicéridos altos.', findings: ['TG 210'], recommendations: [], values: [{ name: 'Triglicéridos', value: 210, unit: 'mg/dL', ref: '< 150', flag: 'alto' }] } }),
      consult('c-1', { date: '2026-11-10', title: 'Arranque', actions: [{ id: 'a1', text: 'Hazte laboratorios', type: 'estudio', priority: 'alta', doneAt: '2026-11-15' }] }),
      { id: HEALTH_DOCTOR_ID, module: 'health', kind: 'doctor', sort: 0, data: { familyHistory: 'Papá con diabetes', goals: 'Bajar grasa' } },
    ];
    const events = [ev('body.logged', '2026-08-01', { weightKg: 87 }), ev('body.logged', '2026-11-16', { weightKg: 84.2, waistCm: 92 }), ev('health.metric', '2026-11-15', { kind: 'trigliceridos', value: 210, recordId: 'hrec-lab' })];
    const state = run(events, TODAY, { entities });
    const text = buildHealthDossier(state, entities);
    expect(text).toContain('Expediente de salud de Iván');
    expect(text).toContain('35 años');
    expect(text).toContain('IMC 27.2');
    expect(text).toContain('Papá con diabetes');
    expect(text).toContain('Química sanguínea');
    expect(text).toContain('Fuera de rango: Triglicéridos: 210 mg/dL (ref. < 150) [ALTO]');
    expect(text).toMatch(/Triglicéridos \(laboratorio\): 210 mg\/dL el 2026-11-15 \(alto: platícalo con tu médico\) NUEVO/);
    expect(text).toContain('HECHO: Hazte laboratorios');
    const short = buildHealthDossier(state, entities, { maxChars: 500 });
    expect(short.length).toBeLessThanOrEqual(500);
    expect(short).toContain('se recortó');
  });

  it('estudios, revisiones y antecedentes no dan XP ni la quitan', () => {
    const base = run([ev('mission.completed', TODAY, { missionId: 'm', title: 'm', size: 'media', attribute: 'fuerza', kind: 'quick' })], TODAY);
    const entities = [...seed, record('hrec-1', { cost: 500 }), consult('c-1', {}), { id: HEALTH_DOCTOR_ID, module: 'health', kind: 'doctor', sort: 0, data: { goals: 'x' } }];
    const more = run([ev('mission.completed', TODAY, { missionId: 'm', title: 'm', size: 'media', attribute: 'fuerza', kind: 'quick' }), ev('health.metric', TODAY, { kind: 'hdl', value: 50, recordId: 'hrec-1' })], TODAY, { entities });
    expect(more.xp.total).toBe(base.xp.total);
  });
});

describe('médico IA: herramientas', () => {
  const mk = (events: GameEvent[] = [], entities: Entity[] = seed) => memoryAssistantStore({ events, entities, today: TODAY });
  const call = (store: ReturnType<typeof mk>, name: string, input: unknown = {}) => runAssistantTool(name, input, store, { allowWrites: true });

  it('registrar_estudio guarda el estudio y sus valores como mediciones enlazadas', async () => {
    const store = mk();
    const r = await call(store, 'registrar_estudio', {
      titulo: 'Perfil de lípidos',
      tipo: 'laboratorio',
      fecha: '2026-11-15',
      lugar: 'Lab Centro',
      costo: 450,
      resumen: 'Triglicéridos altos.',
      valores: [
        { nombre: 'Triglicéridos', valor: 210, unidad: 'mg/dL', ref_max: 150, fuera_de_rango: 'alto' },
        { nombre: 'Colesterol HDL', valor: 45, unidad: 'mg/dL' },
        { nombre: 'Gamma GT', valor: 31, unidad: 'U/L', ref_min: 8, ref_max: 61 },
        { nombre: 'Orina', texto: 'Normal' },
      ],
    });
    expect(r.isError).toBeFalsy();
    expect(r.refs?.events).toHaveLength(3);
    expect(r.text).toContain('Fuera de rango');
    const s = project({ events: store.allEvents(), entities: store.allEntities(), today: TODAY });
    expect(s.health.records).toHaveLength(1);
    expect(s.health.records[0]).toMatchObject({ title: 'Perfil de lípidos', cost: 450, date: '2026-11-15', flagged: 1 });
    expect(s.health.metrics.trigliceridos[0]).toMatchObject({ value: 210, date: '2026-11-15', recordId: s.health.records[0].id });
    expect(s.health.metrics['otro:gamma-gt'][0].level).toBe('ok');
    expect(s.xp.total).toBe(0);
  });

  it('guardar_antecedentes cambia solo lo que manda; ver_salud lo muestra con estudios y la última revisión', async () => {
    const store = mk([], [...seed, consult('c-1', { title: 'Falta tu perfil de lípidos', actions: [{ id: 'a1', text: 'Hazte laboratorios', type: 'estudio', priority: 'alta' }] })]);
    await call(store, 'guardar_antecedentes', { antecedentes_familiares: 'Papá con diabetes', frecuencia_revision: 'mensual' });
    await call(store, 'guardar_antecedentes', { metas: 'Bajar grasa' });
    const doc = store.allEntities().find((e) => e.id === HEALTH_DOCTOR_ID)!;
    expect(doc.data).toEqual({ familyHistory: 'Papá con diabetes', cadence: 'mensual', goals: 'Bajar grasa' });
    await call(store, 'registrar_estudio', { titulo: 'Química sanguínea', tipo: 'laboratorio', resumen: 'Todo en rango.' });
    const v = await call(store, 'ver_salud');
    expect(v.text).toContain('Química sanguínea');
    expect(v.text).toContain('Su médico IA');
    expect(v.text).toContain('Hazte laboratorios (prioridad alta)');
    expect(v.text).toContain('Papá con diabetes');
  });
});
