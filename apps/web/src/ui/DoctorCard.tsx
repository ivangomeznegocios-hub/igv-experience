import { Link } from 'react-router-dom';
import { useGame } from '../data/store';
import { fmtDate } from '../lib/time';
import { Icon } from './icons';

/**
 * Aviso en Hoy de tu médico IA: su revisión nueva ("Tu médico te quiere decir algo", arriba de todo) o, si ya la
 * viste, lo más importante que te pidió y sigue pendiente (con los avisos del día). No aparece si no hay nada.
 */
export function DoctorCard({ only }: { only: 'nueva' | 'pendiente' }) {
  const { state } = useGame();
  const h = state.health;
  const c = h.consults[0];
  if (!c) return null;
  const unseen = h.unseenConsultId === c.id;
  const urgent = h.pendingActions.find((a) => a.priority === 'alta');
  // La revisión nueva va hasta arriba de Hoy; lo pendiente importante, con los avisos del día.
  if (only === 'nueva' ? !unseen : unseen || !urgent) return null;
  return (
    <Link to="/salud?tab=medico" className={`card salud-doctor-teaser hoy-doctor ${c.status} ${unseen ? 'unseen' : ''}`} style={{ textDecoration: 'none' }}>
      <div className="salud-doctor-ico">
        <Icon name="salud-stethoscope" />
      </div>
      <div className="grow" style={{ textAlign: 'left', minWidth: 0 }}>
        <div className="eyebrow">{unseen ? 'Tu médico te quiere decir algo' : 'Pendiente de tu médico'}</div>
        <b>{unseen ? c.title : urgent!.text}</b>
        <div className="tiny muted">
          {unseen ? `Revisión del ${fmtDate(c.date)}${h.pendingActions.length ? ` · ${h.pendingActions.length} ${h.pendingActions.length === 1 ? 'cosa por hacer' : 'cosas por hacer'}` : ''}` : urgent!.why || 'Prioridad alta'}
        </div>
      </div>
      <Icon name="right" width={18} />
    </Link>
  );
}
