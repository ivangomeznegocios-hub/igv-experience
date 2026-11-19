import { VisitForm } from '../mapa/forms';

/**
 * "Fui a…" para la hoja de registro rápido (+): elige el lugar (tuyo, emblemático de Jalisco o nuevo), con
 * quién fuiste y qué personas. La primera visita a un lugar da XP una vez.
 */
export function VisitQuick({ date, setDate, today, onDone }: { date: string; setDate: (d: string) => void; today: string; onDone: () => void }) {
  return <VisitForm date={date} setDate={setDate} today={today} onDone={onDone} />;
}

export default VisitQuick;
