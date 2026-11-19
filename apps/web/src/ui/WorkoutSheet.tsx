import { useEffect, useState } from 'react';
import { useStore } from '../data/store';
import { onOpenWorkout, type OpenWorkoutOptions } from '../lib/entreno';
import { fmtDate } from '../lib/time';
import { Sheet } from './kit';
import { WorkoutForm } from './quick/WorkoutQuick';

/**
 * Hoja global para registrar un entrenamiento. Se abre desde cualquier pantalla con `openWorkout()`
 * (lib/entreno.ts), opcionalmente con un borrador (rutina, "repetir", sesión sugerida) y una fecha.
 */
export default function WorkoutSheetHost() {
  const { today } = useStore();
  const [open, setOpen] = useState<(OpenWorkoutOptions & { n: number }) | null>(null);
  const [date, setDate] = useState(today);
  useEffect(
    () =>
      onOpenWorkout((o) => {
        setDate(o.date ?? today);
        setOpen((prev) => ({ ...o, n: (prev?.n ?? 0) + 1 }));
      }),
    [today],
  );
  if (!open) return null;
  return (
    <Sheet open onClose={() => setOpen(null)} title={`Entrenamiento${date !== today ? ` · ${fmtDate(date, true)}` : ''}`}>
      <WorkoutForm key={open.n} initial={open.draft} date={date} setDate={setDate} today={today} onDone={() => setOpen(null)} />
    </Sheet>
  );
}
