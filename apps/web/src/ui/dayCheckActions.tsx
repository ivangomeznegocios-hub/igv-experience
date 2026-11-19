import { useState, type ComponentType } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { isInRoutine, weekday, type CompletionKind, type DayCheckResult, type MissionData, type TodoData, type ViceData } from '@igv/core';
import { addEvent, useGame, voidEvent } from '../data/store';
import { complete, completeMission, completeTodo } from '../lib/actions';
import { Icon } from './icons';
import { undoToast } from './kit';
import { openQuickAdd } from './QuickAdd';
import { openWorkout } from '../lib/entreno';

/**
 * Cómo se llena cada revisión de "¿Cómo fue tu día?" en la app (el qué está en core: engine/day-review.ts).
 * Para un sistema nuevo: agrega una entrada con su id (ícono + acción o llenado en línea). Ver docs/sistemas/habitos.md.
 */
export interface DayCheckActionArgs {
  date: string;
  today: string;
  navigate: NavigateFunction;
}

export interface DayCheckUi {
  icon?: string;
  /** Botón principal para llenar el hueco. `when` lo oculta en días donde no aplica. */
  action?: { label: string; run: (a: DayCheckActionArgs) => void; when?: (a: DayCheckActionArgs) => boolean };
  /** Atajo secundario (p. ej., "Fue descanso"). */
  secondary?: { label: string; run: (a: DayCheckActionArgs) => void };
  /** Llenado en línea, de un toque y sin abrir otra hoja. */
  Inline?: ComponentType<{ date: string; check: DayCheckResult }>;
}

export const DAY_CHECK_UI: Record<string, DayCheckUi> = {
  sueno: { icon: 'moon', Inline: SleepInline },
  actividad: {
    icon: 'check',
    action: { label: 'Registrar', run: ({ date }) => openQuickAdd({ mode: 'did', date }) },
    secondary: { label: 'Fue descanso', run: ({ date }) => openQuickAdd({ mode: 'rest', date }) },
  },
  rutina: { icon: 'checklist', Inline: RoutineInline },
  gastos: { icon: 'backpack', action: { label: 'Registrar gasto', run: ({ date }) => openQuickAdd({ mode: 'expense', date }) } },
  gente: { icon: 'users', action: { label: 'Registrar', run: ({ date }) => openQuickAdd({ mode: 'npc', date }) } },
  agenda: { icon: 'calendar', Inline: AgendaInline },
  plan: { icon: 'target', Inline: PlanInline },
  'habitos-dejar': { icon: 'shield', Inline: ViceInline },
  cierre: { icon: 'campfire', action: { label: 'Cerrar el día', run: () => document.getElementById('cierre')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) } },

  // Sistemas integrados después: su entrada aquí (ver docs/sistemas/habitos.md).
  entreno: { icon: 'bolt', action: { label: 'Anotar entreno', run: ({ date }) => openWorkout({ date }) } },
  tiempo: { icon: 'clock', action: { label: 'Registrar tiempo', run: ({ date }) => openQuickAdd({ mode: 'time', date }) } },
};

// ---------------------------------------------------------------------------------------------
// Llenado en línea
// ---------------------------------------------------------------------------------------------

function SleepInline({ date }: { date: string }) {
  const [custom, setCustom] = useState('');
  const log = (h: number) => {
    if (!(h >= 0 && h <= 24)) return;
    const ev = addEvent('checkin.morning', { sleepHours: h }, { localDate: date });
    undoToast(`Sueño: ${h} h`, () => voidEvent(ev.id));
  };
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      {[5, 6, 7, 8, 9].map((h) => (
        <button key={h} className="btn sm" onClick={() => log(h)}>
          {h} h
        </button>
      ))}
      <input
        className="input"
        style={{ width: 64, minHeight: 32, padding: '4px 8px' }}
        type="number"
        inputMode="decimal"
        step="0.5"
        min="0"
        max="24"
        placeholder="Otro"
        aria-label="Horas dormidas"
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
      />
      {custom !== '' && (
        <button className="btn sm primary" onClick={() => log(Number(custom))}>
          OK
        </button>
      )}
    </div>
  );
}

function InlineItem({ title, onDone }: { title: string; onDone: () => void }) {
  return (
    <div className="item">
      <button className="check" aria-label={`Completar ${title}`} onClick={onDone}>
        <Icon name="check" />
      </button>
      <div className="grow small">{title}</div>
    </div>
  );
}

function RoutineInline({ date, check }: { date: string; check: DayCheckResult }) {
  const { list } = useGame();
  const wd = weekday(date);
  const pending = list<MissionData>('missions', 'daily').filter((m) => isInRoutine(m.data, wd) && check.pending.includes(m.data.title));
  return (
    <div>
      {pending.map((m) => (
        <InlineItem key={m.id} title={m.data.title} onDone={() => completeMission(m, date)} />
      ))}
    </div>
  );
}

function AgendaInline({ date, check }: { date: string; check: DayCheckResult }) {
  const { list, state } = useGame();
  const pending = list<TodoData>('planner', 'todo').filter((t) => check.pending.includes(t.data.title) && !state.missions.completions[t.id] && t.data.date <= date);
  return (
    <div>
      {pending.map((t) => (
        <InlineItem key={t.id} title={t.data.title} onDone={() => completeTodo(t, date)} />
      ))}
    </div>
  );
}

function PlanInline({ date }: { date: string }) {
  const { state } = useGame();
  const items = (state.plans[date]?.items ?? []).filter((i) => !i.done);
  return (
    <div>
      {items.map((i) => (
        <InlineItem
          key={i.missionId}
          title={i.title}
          onDone={() => complete({ missionId: i.missionId, title: i.title, size: i.size, attribute: i.attribute, kind: i.kind as CompletionKind }, date)}
        />
      ))}
    </div>
  );
}

function ViceInline({ date }: { date: string }) {
  const { list } = useGame();
  const vices = list<ViceData>('habits', 'vice').filter((v) => v.data.startDate <= date);
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      {vices.map((v) => (
        <button
          key={v.id}
          className="btn sm"
          onClick={() => {
            const ev = addEvent('vice.relapse', { viceId: v.id }, { localDate: date });
            undoToast(`Recaída registrada: ${v.data.name}. Tu XP no cambia.`, () => voidEvent(ev.id));
          }}
        >
          Recaí: {v.data.name}
        </button>
      ))}
    </div>
  );
}
