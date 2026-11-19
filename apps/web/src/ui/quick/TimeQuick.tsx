import { useMemo, useState } from 'react';
import { TIME_AREA_NAMES, fmtHoursMinutes, type SkillData, type TimeArea } from '@igv/core';
import { addEvent, useGame, voidEvent } from '../../data/store';
import { startTimer, useTimer } from '../../lib/timeTimer';
import { Chips, DateChips, Field, undoToast } from '../kit';
import { Icon } from '../icons';
import { AREA_HINT, AreaChips } from '../habilidades/shared';

const DURATIONS = [15, 30, 60, 120, 240, 480];

/**
 * Registro rápido de tiempo ("Tiempo" en el "+"): área, cuánto, habilidad opcional y nota. También puede
 * arrancar el cronómetro. El tiempo NO da XP (es solo registro).
 */
export function TimeQuick({
  date,
  setDate,
  today,
  onDone,
  initialArea,
  initialSkillId,
}: {
  date: string;
  setDate: (d: string) => void;
  today: string;
  onDone: () => void;
  initialArea?: TimeArea;
  initialSkillId?: string | null;
}) {
  const { list, state } = useGame();
  const timer = useTimer();
  const skills = list<SkillData>('skills', 'skill');
  const [area, setArea] = useState<TimeArea | null>(initialArea ?? null);
  const [hours, setHours] = useState('');
  const [mins, setMins] = useState('');
  const [skillId, setSkillId] = useState<string>(initialSkillId ?? '');
  const [note, setNote] = useState('');
  const [start, setStart] = useState('');
  const minutes = Math.round((Number(hours) || 0) * 60 + (Number(mins) || 0));
  const preset = DURATIONS.includes(minutes) ? minutes : null;
  const setPreset = (m: number) => {
    setHours(m >= 60 ? String(Math.floor(m / 60)) : '');
    setMins(m % 60 ? String(m % 60) : '');
  };
  // Notas recientes de esa área para repetir con un toque ("Oficina").
  const recentNotes = useMemo(() => {
    if (!area) return [];
    const seen = new Set<string>();
    for (const t of [...state.time.entries].reverse()) {
      if (t.area !== area || !t.note.trim()) continue;
      seen.add(t.note.trim());
      if (seen.size >= 5) break;
    }
    return [...seen];
  }, [area, state.time.entries]);
  const valid = !!area && minutes >= 1 && minutes <= 1440;
  const canTimer = !!area && date === today && !timer;

  const save = () => {
    if (!area || !valid) return;
    const ev = addEvent(
      'time.logged',
      { minutes, area, skillId: skillId || null, note: note.trim() || undefined, start: start || undefined },
      { localDate: date },
    );
    undoToast(`${fmtHoursMinutes(minutes)} de ${TIME_AREA_NAMES[area].toLowerCase()} registradas`, () => voidEvent(ev.id));
    onDone();
  };

  return (
    <>
      <Field label="¿En qué?">
        <AreaChips value={area} onChange={setArea} />
      </Field>
      <Field label="¿Cuánto tiempo?">
        <Chips value={preset} onChange={setPreset} options={DURATIONS.map((m) => ({ value: m, label: fmtHoursMinutes(m) }))} />
      </Field>
      <div className="grid2" style={{ gap: 10, marginTop: -4 }}>
        <Field label="Horas">
          <input className="input" type="number" inputMode="decimal" min={0} max={24} step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Minutos">
          <input className="input" type="number" inputMode="numeric" min={0} max={59} value={mins} onChange={(e) => setMins(e.target.value)} placeholder="0" />
        </Field>
      </div>
      {skills.length > 0 && (
        <Field label="Practicando una habilidad (opcional)">
          <select className="input" value={skillId} onChange={(e) => setSkillId(e.target.value)}>
            <option value="">— Ninguna —</option>
            {skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.data.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Nota (opcional)">
        <input className="input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder={area ? AREA_HINT[area] : 'Qué hiciste'} />
      </Field>
      {recentNotes.length > 0 && (
        <div style={{ marginTop: -4, marginBottom: 12 }}>
          <Chips value={note} onChange={setNote} options={recentNotes.map((n) => ({ value: n, label: n }))} />
        </div>
      )}
      <Field label="¿Cuándo?">
        <DateChips value={date} onChange={setDate} today={today} />
      </Field>
      <Field label="Hora de inicio (opcional, para la línea del día)">
        <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
      </Field>
      <button className="btn primary block" disabled={!valid} onClick={save}>
        {valid ? `Guardar ${fmtHoursMinutes(minutes)}` : 'Guardar'}
      </button>
      {canTimer && (
        <button
          className="btn block"
          style={{ marginTop: 8 }}
          onClick={() => {
            startTimer({ area: area!, skillId: skillId || null, note: note.trim() });
            onDone();
          }}
        >
          <Icon name="play" /> Mejor iniciar cronómetro
        </button>
      )}
      <p className="tiny muted" style={{ marginBottom: 0 }}>
        El tiempo no da XP (la XP es por resultados, no por horas): sirve para ver a qué le dedicas tu vida.
      </p>
    </>
  );
}

export default TimeQuick;
