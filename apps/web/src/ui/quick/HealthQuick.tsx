import { useMemo, useState } from 'react';
import {
  CHECKUP_CATEGORIES,
  CHECKUP_CATEGORY_NAMES,
  GAME_CONFIG,
  HEALTH_METRIC_INFO,
  classifyHealthMetric,
  healthSuggestionsFor,
  suggestionCheckupId,
  type CheckupCategory,
  type CheckupData,
  type Entity,
  type HealthMetricKind,
  type HealthSuggestionFit,
} from '@igv/core';
import { useGame } from '../../data/store';
import { activateSuggestion, checkupXpOf, logMetric, markCheckupDone, saveCheckup, type MetricInput } from '../../lib/health';
import { Chips, DateChips, Field } from '../kit';
import { Icon } from '../icons';
import '../../styles/salud.css';

type DateProps = { date: string; setDate: (d: string) => void; today: string };

/** Registro rápido de Salud ("+" → Salud): fui al médico/dentista… o una medición (presión, glucosa…). */
export function HealthQuick({ date, setDate, today, onDone }: DateProps & { onDone: () => void }) {
  const [mode, setMode] = useState<'checkup' | 'metric'>('checkup');
  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Chips
          value={mode}
          onChange={setMode}
          options={[
            { value: 'checkup', label: 'Chequeo o consulta' },
            { value: 'metric', label: 'Medición' },
          ]}
        />
      </div>
      {mode === 'checkup' ? <CheckupQuickForm date={date} setDate={setDate} today={today} onDone={onDone} /> : <MetricForm date={date} setDate={setDate} today={today} onDone={onDone} />}
    </>
  );
}

type Choice =
  | { type: 'checkup'; id: string }
  | { type: 'suggestion'; s: HealthSuggestionFit }
  | { type: 'new' };

const MONTH_OPTIONS = [
  { value: 6, label: '6 meses' },
  { value: 12, label: '1 año' },
  { value: 24, label: '2 años' },
  { value: 0, label: 'Una vez' },
];

/** Elige qué chequeo hiciste (los que ya te tocan primero), o uno nuevo, y lo registra. */
function CheckupQuickForm({ date, setDate, today, onDone }: DateProps & { onDone: () => void }) {
  const { state, list, events } = useGame();
  const all = list<CheckupData>('health', 'checkup');
  const active = all.filter((c) => c.data.active !== false);
  const rank = { atrasado: 0, pronto: 1, sin_registro: 2, al_dia: 3 } as const;
  const sorted = [...active].sort((a, b) => rank[state.health.checkups[a.id]?.status ?? 'al_dia'] - rank[state.health.checkups[b.id]?.status ?? 'al_dia']);
  const known = new Set(all.map((c) => c.data.suggestionId).filter(Boolean));
  const suggestions = healthSuggestionsFor(state.settings.birthDate, today).filter((s) => !known.has(s.id) && s.applies !== false && !all.some((c) => c.id === suggestionCheckupId(s.id)));

  const [pick, setPick] = useState<Choice | null>(sorted[0] ? { type: 'checkup', id: sorted[0].id } : suggestions[0] ? { type: 'suggestion', s: suggestions[0] } : { type: 'new' });
  const [name, setName] = useState('');
  const [category, setCategory] = useState<CheckupCategory>('consulta');
  const [every, setEvery] = useState(12);
  const [result, setResult] = useState('');

  const key = pick?.type === 'checkup' ? pick.id : pick?.type === 'suggestion' ? `s:${pick.s.id}` : 'new';
  // "Otro" con el nombre de uno que ya existe (aunque esté pausado) usa ese, no crea un duplicado.
  const sameName = pick?.type === 'new' && name.trim() ? all.find((c) => c.data.name.trim().toLocaleLowerCase('es-MX') === name.trim().toLocaleLowerCase('es-MX')) : undefined;
  const chosen = pick?.type === 'checkup' ? all.find((c) => c.id === pick.id) : sameName;
  const already = !!chosen && events.some((e) => !e.voidedAt && e.type === 'health.checkup_done' && e.localDate === date && e.payload?.checkupId === chosen.id);
  const xp = pick?.type === 'suggestion' ? GAME_CONFIG.missionXp[pick.s.size] : chosen ? checkupXpOf(chosen.data) : checkupXpOf({});
  const canSave = !!pick && !already && (pick.type !== 'new' || name.trim().length > 0);

  const save = () => {
    if (!pick || !canSave) return;
    let entity: Entity<CheckupData> | undefined;
    if (pick.type === 'checkup') entity = chosen ?? undefined;
    else if (pick.type === 'suggestion') entity = activateSuggestion(pick.s);
    else if (sameName) entity = sameName.data.active === false ? saveCheckup({ ...sameName.data, active: true }, sameName.id) : sameName;
    else entity = saveCheckup({ name: name.trim(), category, everyMonths: every, active: true });
    if (!entity) return;
    markCheckupDone(entity, date, { result });
    onDone();
  };

  const statusTone = (id: string) => {
    const st = state.health.checkups[id]?.status;
    return st === 'atrasado' || st === 'pronto' ? 'warn' : undefined;
  };

  return (
    <>
      <Field label="¿Qué hiciste?">
        <Chips
          value={key}
          onChange={(v) => {
            if (v === 'new') setPick({ type: 'new' });
            else if (v.startsWith('s:')) setPick({ type: 'suggestion', s: suggestions.find((s) => `s:${s.id}` === v)! });
            else setPick({ type: 'checkup', id: v });
          }}
          options={[
            ...sorted.map((c) => ({ value: c.id, label: c.data.name, tone: statusTone(c.id) })),
            ...suggestions.map((s) => ({ value: `s:${s.id}`, label: s.name })),
            { value: 'new', label: <><Icon name="plus" width={14} style={{ verticalAlign: -2 }} /> Otro</> },
          ]}
        />
      </Field>
      {pick?.type === 'new' && (
        <>
          <Field label="Nombre">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Consulta con el nutriólogo" maxLength={200} />
          </Field>
          {sameName && <p className="tiny muted" style={{ marginTop: -6 }}>Ya lo tienes en tus chequeos: se registra en ese.</p>}
          <Field label="Tipo">
            <Chips value={category} onChange={setCategory} options={CHECKUP_CATEGORIES.map((c) => ({ value: c, label: CHECKUP_CATEGORY_NAMES[c] }))} />
          </Field>
          <Field label="¿Cada cuánto toca?">
            <Chips value={every} onChange={setEvery} options={MONTH_OPTIONS} />
          </Field>
        </>
      )}
      <Field label="Resultado (opcional)">
        <input className="input" value={result} onChange={(e) => setResult(e.target.value)} placeholder="Todo bien, una caries, subir lentes…" maxLength={2000} />
      </Field>
      <Field label="¿Cuándo?">
        <DateChips value={date} onChange={setDate} today={today} />
      </Field>
      <button className="btn primary block" disabled={!canSave} onClick={save}>
        {already ? (
          'Ya está registrado ese día'
        ) : (
          <>
            <Icon name="check" /> Registrar · +{xp} XP
          </>
        )}
      </button>
    </>
  );
}

/** Registrar "Ya lo hice" de un chequeo concreto (lo usa la pantalla de Salud). */
export function CheckupDoneForm({ checkup, today, onDone }: { checkup: Entity<CheckupData>; today: string; onDone: () => void }) {
  const { events } = useGame();
  const [date, setDate] = useState(today);
  const [result, setResult] = useState('');
  const [note, setNote] = useState('');
  const already = events.some((e) => !e.voidedAt && e.type === 'health.checkup_done' && e.localDate === date && e.payload?.checkupId === checkup.id);
  return (
    <>
      <Field label="¿Cuándo?">
        <DateChips value={date} onChange={setDate} today={today} />
      </Field>
      <Field label="Resultado (opcional)">
        <input className="input" value={result} onChange={(e) => setResult(e.target.value)} placeholder="Todo bien, una caries, subir lentes…" maxLength={2000} />
      </Field>
      <Field label="Nota (opcional)">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Doctor, lugar, costo…" maxLength={2000} />
      </Field>
      <button
        className="btn primary block"
        disabled={already}
        onClick={() => {
          markCheckupDone(checkup, date, { result, note });
          onDone();
        }}
      >
        {already ? (
          'Ya está registrado ese día'
        ) : (
          <>
            <Icon name="check" /> Ya lo hice · +{checkupXpOf(checkup.data)} XP
          </>
        )}
      </button>
    </>
  );
}

const KIND_LABEL: Record<HealthMetricKind, string> = {
  presion: 'Presión',
  glucosa: 'Glucosa',
  colesterol: 'Colesterol',
  frecuencia_reposo: 'Pulso en reposo',
  otro: 'Otra',
};

const num = (s: string) => {
  const n = Number(s.replace(',', '.'));
  return s.trim() && Number.isFinite(n) && n > 0 ? n : null;
};

/** Medición de salud con su rango de referencia en vivo (contexto, no diagnóstico). Sin XP. */
export function MetricForm({ date, setDate, today, onDone, initialKind }: DateProps & { onDone: () => void; initialKind?: HealthMetricKind }) {
  const { state } = useGame();
  const [kind, setKind] = useState<HealthMetricKind>(initialKind ?? 'presion');
  const [v1, setV1] = useState('');
  const [v2, setV2] = useState('');
  const [label, setLabel] = useState('');
  const [unit, setUnit] = useState('');
  const [note, setNote] = useState('');
  const info = HEALTH_METRIC_INFO[kind];
  const a = num(v1);
  const b = num(v2);
  const others = useMemo(
    () =>
      Object.values(state.health.metrics)
        .filter((s) => s[0]?.kind === 'otro')
        .map((s) => ({ label: s.at(-1)!.label, unit: s.at(-1)!.unit })),
    [state.health.metrics],
  );
  const valid = a !== null && a <= 100000 && (kind !== 'presion' || (b !== null && b < a)) && (kind !== 'otro' || label.trim().length > 0);
  const reading = valid ? classifyHealthMetric(kind, a!, kind === 'presion' ? b! : undefined) : null;

  const save = () => {
    if (!valid) return;
    const m: MetricInput = { kind, value: a!, value2: kind === 'presion' ? b! : undefined, label, unit, note };
    logMetric(m, date);
    onDone();
  };

  return (
    <>
      <Field label="¿Qué mediste?">
        <Chips
          value={kind}
          onChange={(k) => {
            setKind(k);
            setV1('');
            setV2('');
          }}
          options={(Object.keys(KIND_LABEL) as HealthMetricKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
        />
      </Field>
      {kind === 'otro' && (
        <>
          <div className="grid2" style={{ gap: 10 }}>
            <Field label="Nombre">
              <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Triglicéridos" maxLength={80} />
            </Field>
            <Field label="Unidad">
              <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="mg/dL" maxLength={20} />
            </Field>
          </div>
          {others.length > 0 && (
            <div className="chips" style={{ marginTop: -4, marginBottom: 12 }}>
              {others.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  className="chip"
                  onClick={() => {
                    setLabel(o.label);
                    setUnit(o.unit);
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {kind === 'presion' ? (
        <div className="salud-pair">
          <Field label="Sistólica (alta)">
            <input className="input num" type="number" inputMode="numeric" value={v1} onChange={(e) => setV1(e.target.value)} placeholder="120" />
          </Field>
          <span>/</span>
          <Field label="Diastólica (baja)">
            <input className="input num" type="number" inputMode="numeric" value={v2} onChange={(e) => setV2(e.target.value)} placeholder="80" />
          </Field>
        </div>
      ) : (
        <Field label={`Valor${(kind === 'otro' ? unit : info.unit) ? ` (${kind === 'otro' ? unit : info.unit})` : ''}`}>
          <input className="input num" type="number" inputMode="decimal" step="any" value={v1} onChange={(e) => setV1(e.target.value)} />
        </Field>
      )}
      {reading ? (
        <div className={`salud-reading salud-level ${reading.level}`}>{reading.text}</div>
      ) : (
        kind !== 'otro' && <div className="salud-reading tiny muted">{info.reference}</div>
      )}
      <Field label="Nota (opcional)">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'glucosa' ? 'En ayunas, después de comer…' : 'Dónde, cómo te sentías…'} maxLength={2000} />
      </Field>
      <Field label="¿Cuándo?">
        <DateChips value={date} onChange={setDate} today={today} />
      </Field>
      <button className="btn primary block" disabled={!valid} onClick={save}>
        Guardar medición
      </button>
      <p className="tiny muted" style={{ marginBottom: 0 }}>
        Solo registro (no da XP). Los rangos son orientación general; no sustituyen a tu médico.
      </p>
    </>
  );
}
