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
  const goals = list('goals', 'goal');
  const goalsDone = goals.filter((g) => state.goals[g.id]?.completedOn).length;
  const goalsActive = goals.length - goalsDone;
  return (
    <>
      <PageHeader title="Progreso" />
      <div className="menu-grid">
        <Tile to="/jefes" icon="skull" title="Jefes" sub={`${defeated} de ${bosses.length} vencidos`} />
        <Tile to="/logros" icon="trophy" title="Logros" sub={`${unlocked} de ${achs.length}`} />
        <Tile to="/habilidades" icon="shield" title="Habilidades" sub={`${ranks} de ${skills.length * 3} rangos`} />
        <Tile to="/temporadas" icon="calendar" title="Temporadas" sub={season ? `T${season.data.number} · semana ${state.seasons.currentWeek}` : 'Historia y diario'} />
        <Tile to="/metas" icon="target" title="Metas" sub={`${goalsActive} activas · ${goalsDone} cumplidas`} />
        <Tile to="/tienda" icon="coin" title="Tienda" sub={`${state.gold.balance} de oro`} />
      </div>
      <div className="section-title">Tu historia</div>
      <div className="menu-grid">
        <Tile to="/historial" icon="calendar" title="Historial" sub="Calendario día por día" />
        <Tile to="/reporte" icon="scroll" title="Reporte semanal" sub="Tu semana en batalla" />
        <Tile to="/estadisticas" icon="step" title="Estadísticas" sub="XP, atributos y dinero" />
        <Tile to="/anual" icon="star" title={`Mi ${state.today.slice(0, 4)}`} sub="Año en review" />
      </div>
    </>
  );
}

export function Mas() {
  const { state, list } = useGame();
  const books = list('library', 'book').filter((b) => !state.library.finished[b.id] && (b.data as { status: string }).status === 'leyendo').length;
  const vices = list('habits', 'vice');
  return (
    <>
      <PageHeader title="Mundo" right={<Link to="/buscar" className="btn sm ghost"><Icon name="compass" /> Buscar</Link>} />
      <div className="menu-grid">
        <Tile to="/inventario" icon="backpack" title="Inventario" sub="Dinero, presupuesto, ahorro" />
        <Tile to="/npcs" icon="users" title="NPCs y gremios" sub="Tu party, aliados y mentores" />
        <Tile to="/mapa" icon="compass" title="Mapa" sub="Lugares por descubrir" />
        <Tile to="/vida" icon="hourglass" title="Mi vida en semanas" sub="Por año calendario y por días" />
        <Tile to="/biblioteca" icon="book" title="Biblioteca" sub={books ? `${books} en curso` : 'Libros y cursos'} />
        <Tile to="/cuerpo" icon="heart" title="Cuerpo" sub="Peso, entrenos y sueño" />
        <Tile to="/enemigos" icon="skull" title="Enemigos" sub={vices.length ? `${vices.length} a raya` : 'Malos hábitos'} />
        <Tile to="/game-master" icon="sparkles" title="Game Master" sub="Misiones y registro por texto" />
        <Tile to="/ajustes" icon="settings" title="Ajustes" sub="Perfil, notificaciones, respaldo" />
      </div>
    </>
  );
}
