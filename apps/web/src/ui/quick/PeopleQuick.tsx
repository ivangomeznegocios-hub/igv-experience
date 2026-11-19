import { ContactForm } from '../people';

/**
 * Registro rápido de "Mi gente" para la hoja "+" (reemplaza al antiguo "Hablé con…"): una o varias
 * personas, cómo fue (en persona, llamada, video, mensaje), dónde, nota y día. Escribir un nombre que no
 * existe permite agregar a la persona ahí mismo.
 */
export function PeopleQuick({ date, setDate, today, onDone }: { date: string; setDate: (d: string) => void; today: string; onDone: () => void }) {
  return <ContactForm date={date} setDate={setDate} today={today} onDone={onDone} />;
}

export default PeopleQuick;
