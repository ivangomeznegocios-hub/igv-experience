import { MealForm } from '../coach/CoachSheets';

/** "¿Qué comiste?" en la hoja "+" (el día lo elige la hoja). Solo registro: no da XP. */
export default function MealQuick({ date, onDone }: { date: string; onDone: () => void }) {
  return <MealForm date={date} onDone={onDone} />;
}
