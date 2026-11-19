import { Link } from 'react-router-dom';
import { useGame } from '../data/store';
import { PageHeader } from '../ui/kit';
import { Icon } from '../ui/icons';

function Tile({ to, icon, title, sub }: { to: string; icon: string; title: string; sub: string }) {
  return (
    <Link to={to} className="menu-tile">
      <Icon name={icon} />
      <b>{title}</b>
      <span>{sub}</span>
    </Link>
  );
}

export function Progreso() {
  const { state, list } = useGame();
  const achs = list('achievements', 'achievement');
  const unlocked = achs.filter((a) => state.achievements[a.id]?.unlocked).length;
  const bosses = list('bosses', 'boss');
  const defeated = bosses.filter((b) => state.bosses.bosses[b.id]?.defeated).length;
  const skills = list('skills', 'skill');
  const ranks = skills.reduce((s, x) => s + (state.skills[x.id]?.rank ?? 0), 0);
  const season = state.seasons.current;
  return (
    <>
      <PageHeader title="Progreso" />
      <div className="menu-grid">
        <Tile to="/jefes" icon="skull" title="Jefes" sub={`${defeated} de ${bosses.length} vencidos`} />
        <Tile to="/logros" icon="trophy" title="Logros" sub={`${unlocked} de ${achs.length}`} />
        <Tile to="/habilidades" icon="shield" title="Habilidades" sub={`${ranks} de ${skills.length * 3} rangos`} />
        <Tile to="/temporadas" icon="calendar" title="Temporadas" sub={season ? `T${season.data.number} · semana ${state.seasons.currentWeek}` : 'Historia y diario'} />
      </div>
    </>
  );
}

export function Mas() {
  return (
    <>
      <PageHeader title="Mundo" />
      <div className="menu-grid">
        <Tile to="/inventario" icon="backpack" title="Inventario" sub="Dinero, herramientas y conocimientos" />
        <Tile to="/npcs" icon="users" title="NPCs y gremios" sub="Tu party, aliados y mentores" />
        <Tile to="/mapa" icon="compass" title="Mapa" sub="Lugares por descubrir" />
        <Tile to="/vida" icon="hourglass" title="Mi vida en semanas" sub="90 años × 52 semanas" />
        <Tile to="/game-master" icon="sparkles" title="Game Master" sub="IA que te propone misiones" />
        <Tile to="/ajustes" icon="settings" title="Ajustes" sub="Perfil, premios, respaldo" />
      </div>
    </>
  );
}
