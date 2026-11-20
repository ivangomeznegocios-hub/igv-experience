import { Link } from 'react-router-dom';
import { learningDueCount, type Entity, type LearningTopicData } from '@igv/core';
import { useGame } from '../data/store';
import { PageHeader } from '../ui/kit';
import { Icon } from '../ui/icons';

function Tile({ to, icon, title, sub, alert }: { to: string; icon: string; title: string; sub: string; alert?: boolean }) {
  return (
    <Link to={to} className={`menu-tile${alert ? ' alert' : ''}`}>
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
  const season = state.seasons.current;
  const goals = list('goals', 'goal');
  const goalsDone = goals.filter((g) => state.goals[g.id]?.completedOn).length;
  const goalsActive = goals.length - goalsDone;
  const challengesActive = Object.values(state.challenges).filter((c) => c.current).length;
  return (
    <>
      <PageHeader title="Progreso" />
      <div className="menu-grid">
        <Tile to="/jefes" icon="flag" title="Grandes retos" sub={`${defeated} de ${bosses.length} superados`} />
        <Tile to="/logros" icon="trophy" title="Logros" sub={`${unlocked} de ${achs.length}`} />
        <Tile to="/temporadas" icon="calendar" title="Temporadas" sub={season ? `T${season.data.number} · semana ${state.seasons.currentWeek}` : 'Historia y diario'} />
        <Tile to="/metas" icon="target" title="Metas" sub={`${goalsActive} activas · ${goalsDone} cumplidas`} />
        <Tile to="/retos" icon="flame" title="Retos" sub={challengesActive ? `${challengesActive} en curso` : 'Días seguidos y compromisos'} />
        <Tile to="/tienda" icon="coin" title="Tienda" sub={`${state.gold.balance} de oro`} />
      </div>
      <div className="section-title">Tu historia</div>
      <div className="menu-grid">
        <Tile to="/records" icon="up" title="Récords y datos" sub="Tú vs. tú, ritmo y patrones" />
        <Tile to="/historial" icon="calendar" title="Historial" sub="Calendario día por día" />
        <Tile to="/reporte" icon="scroll" title="Reporte semanal" sub="Tu semana en números" />
        <Tile to="/estadisticas" icon="step" title="Estadísticas" sub="XP, atributos y dinero" />
        <Tile to="/anual" icon="star" title={`Mi ${state.today.slice(0, 4)}`} sub="Año en review" />
      </div>
    </>
  );
}

interface Attention {
  to: string;
  icon: string;
  text: string;
}

/** Lo que hoy pide tu atención en cada área (máx. 4, lo más urgente primero). Solo lectura. */
function attentionItems(state: ReturnType<typeof useGame>['state'], name: (id: string) => string, learningTopics: Entity<LearningTopicData>[]): Attention[] {
  const out: Attention[] = [];
  for (const d of state.health.due.filter((x) => x.status === 'atrasado').slice(0, 1)) out.push({ to: '/salud', icon: 'salud-cross', text: `Ya te toca: ${d.name}` });
  for (const b of state.npcs.birthdays.filter((x) => x.inDays <= 3).slice(0, 1))
    out.push({ to: `/npcs/${b.npcId}`, icon: 'cake', text: b.inDays === 0 ? `Hoy cumple ${name(b.npcId)}` : `${name(b.npcId)} cumple en ${b.inDays} ${b.inDays === 1 ? 'día' : 'días'}` });
  const npcMission = state.npcs.generatedMissions[0];
  if (npcMission) out.push({ to: `/npcs/${npcMission.npcId}`, icon: 'chat', text: npcMission.title });
  const weak = state.habits.routine.filter((h) => h.dueToday && !h.doneToday && h.verdict === 'flojo');
  if (weak.length) out.push({ to: '/habitos', icon: 'checklist', text: weak.length === 1 ? `Hábito flojo hoy: ${weak[0].title}` : `${weak.length} hábitos flojos te tocan hoy` });
  const dueCards = learningDueCount(state.learning, learningTopics);
  if (dueCards) out.push({ to: '/aprendizaje', icon: 'translate', text: `${dueCards} ${dueCards === 1 ? 'tarjeta' : 'tarjetas'} por repasar` });
  return out.slice(0, 4);
}

const hours = (min: number) => (min >= 60 ? `${Math.round((min / 60) * 10) / 10} h` : `${min} min`);

export function Mas() {
  const { state, list, byId } = useGame();
  const name = (id: string) => ((byId.get(id)?.data as { name?: string } | undefined)?.name ?? 'alguien').split(' ')[0];
  const books = list('library', 'book').filter((b) => !state.library.finished[b.id] && (b.data as { status: string }).status === 'leyendo').length;
  const vices = list('habits', 'vice');
  const attention = attentionItems(state, name, list<LearningTopicData>('learning', 'topic'));
  const h = state.health;
  const hs = state.habits.summary;
  const today = state.npcs.contactedToday.length;
  const toAttend = state.npcs.generatedMissions.length;
  const learningTopics = list('learning', 'topic').length;
  const ms = state.map.summary;
  const weight = state.body.lastWeight;
  const ts = state.training.summary;
  const trainingSub = ts.sessionsThisWeek ? `${ts.sessionsThisWeek} ${ts.sessionsThisWeek === 1 ? 'sesión' : 'sesiones'} esta semana` : 'Músculos, récords y qué te falta';
  const habitParts = [hs.bien && `${hs.bien} bien`, hs.medias && `${hs.medias} a medias`, hs.flojo && `${hs.flojo} ${hs.flojo === 1 ? 'flojo' : 'flojos'}`].filter(Boolean);
  const habitsSub = habitParts.length ? habitParts.join(' · ') : state.habits.routine.length ? `${state.habits.routine.length} en tu rutina` : 'Se arman con lo que registras';
  return (
    <>
      <PageHeader title="Más" right={<Link to="/buscar" className="btn sm ghost"><Icon name="search" /> Buscar</Link>} />
      {attention.length > 0 && (
        <div className="card attention">
          <div className="eyebrow">Pide tu atención</div>
          {attention.map((a) => (
            <Link key={a.text} to={a.to} className="item attention-row">
              <Icon name={a.icon} width={18} />
              <span className="grow small">{a.text}</span>
              <Icon name="right" width={16} />
            </Link>
          ))}
        </div>
      )}

      <div className="section-title">Tu vida</div>
      <div className="menu-grid">
        <Tile to="/npcs" icon="users" title="Mi gente" sub={today ? `${today} contacto${today === 1 ? '' : 's'} hoy${toAttend ? ` · ${toAttend} por atender` : ''}` : toAttend ? `${toAttend} por atender` : 'Familia, amigos y trabajo'} alert={toAttend > 0} />
        <Tile to="/salud" icon="salud-cross" title="Salud" sub={h.score === null ? 'Chequeos y ficha médica' : `${h.score}% al día${h.due.length ? ` · ${h.due.length} te toca${h.due.length === 1 ? '' : 'n'}` : ''}`} alert={h.due.some((d) => d.status === 'atrasado')} />
        <Tile to="/cuerpo" icon="heart" title="Cuerpo" sub={weight ? `${weight.kg} kg · sueño y medidas` : 'Peso, medidas y sueño'} />
        <Tile to="/entreno" icon="bolt" title="Entrenamiento" sub={trainingSub} alert={false} />
        <Tile to="/habitos" icon="checklist" title="Hábitos" sub={habitsSub} alert={hs.flojo > 0} />
        <Tile to="/enemigos" icon="shield" title="Hábitos a dejar" sub={vices.length ? `${vices.length} bajo control` : 'Lo que quieres dejar'} />
        <Tile to="/mapa" icon="map" title="Mapa" sub={ms.known ? `${ms.known} ${ms.known === 1 ? 'lugar conocido' : 'lugares conocidos'}` : 'Lugares por conocer y tu empresa'} />
      </div>

      <div className="section-title">Crecer</div>
      <div className="menu-grid">
        <Tile to="/habilidades" icon="wrench" title="Habilidades" sub={`Lo que sabes hacer · ${list('skills', 'skill').length}`} />
        <Tile to="/aprendizaje" icon="translate" title="Aprendizaje" sub={learningTopics ? (state.learning.mastered ? `${state.learning.mastered} ${state.learning.mastered === 1 ? 'frase dominada' : 'frases dominadas'}` : 'Repasa y haz tu test') + (state.learning.streak > 1 ? ` · racha ${state.learning.streak}` : '') : 'Inglés con tests de IA'} />
        <Tile to="/biblioteca" icon="book" title="Biblioteca" sub={books ? `${books} en curso` : 'Libros y lo aprendido'} />
        <Tile to="/tiempo" icon="clock" title="Tu tiempo" sub={state.time.weekMinutes ? `${hours(state.time.weekMinutes)} esta semana` : '¿A qué le dedicas tu tiempo?'} />
      </div>

      <div className="section-title">Dinero y herramientas</div>
      <div className="menu-grid">
        <Tile to="/inventario" icon="coin" title="Dinero y recursos" sub="Dinero, presupuesto, ahorro" />
        <Tile to="/game-master" icon="sparkles" title="Coach" sub="Conversa y registra por ti" />
        <Tile to="/vida" icon="hourglass" title="Mi vida en semanas" sub="Por año calendario y por días" />
        <Tile to="/conectar-ia" icon="link" title="Conectar IA" sub="Claude, ChatGPT, Codex, Antigravity" />
        <Tile to="/ajustes" icon="settings" title="Ajustes" sub="Perfil, notificaciones, respaldo" />
      </div>
    </>
  );
}
