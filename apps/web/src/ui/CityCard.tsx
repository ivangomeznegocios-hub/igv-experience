import { Suspense, useMemo, useState } from 'react';
import { lazyScreen } from '../lib/recover';
import { Link } from 'react-router-dom';
import { GAME_CONFIG, type CityDistrictState, type GameState } from '@igv/core';
import { useGame } from '../data/store';
import { BLOCKED_TEXT, collect, inaugurate, startBuild } from '../lib/city';
import { fmtDate } from '../lib/time';
import { Icon } from './icons';
import '../styles/ciudad.css';

const CityView = lazyScreen(() => import('../city/CityView'));

function useCityModel(state: GameState) {
  return useMemo(
    () => state.city.order.map((a) => ({ id: a, level: state.city.districts[a].level, work: state.city.districts[a].work ? { level: state.city.districts[a].work!.level, ready: state.city.districts[a].work!.ready } : null })),
    [state.city],
  );
}

/** La maqueta (con respaldo sin WebGL: una línea por distrito). */
export function CityModel({ state, onPick, tall }: { state: GameState; onPick?: (id: string) => void; tall?: boolean }) {
  const model = useCityModel(state);
  const [flat, setFlat] = useState(false);
  const label = `Tu ciudad: ${state.city.order.map((a) => `${state.city.districts[a].name} nivel ${state.city.districts[a].level}`).join(', ')}`;
  if (flat) return null;
  return (
    <div className={`city-stage ${tall ? 'tall' : ''}`}>
      <Suspense fallback={<div className="city-canvas" />}>
        <CityView districts={model} onPick={onPick} onFail={() => setFlat(true)} label={label} />
      </Suspense>
    </div>
  );
}

/** Obras en curso, almacén y equipo: lo que se hace hoy en la ciudad. */
export function CityActions({ state }: { state: GameState }) {
  const city = state.city;
  const ready = city.ready.map((w) => city.districts[w.districtId]);
  const inProgress = city.works.filter((w) => !w.ready);
  return (
    <div className="city-actions">
      {ready.map((d) => (
        <button key={d.id} className="btn primary" onClick={() => inaugurate(d)}>
          <Icon name="building" /> Inaugurar {d.building} {d.work?.level}
        </button>
      ))}
      {city.stored > 0 && (
        <button className="btn" onClick={() => collect(state)}>
          <Icon name="download" /> Recoger {city.stored}
        </button>
      )}
      {inProgress.map((w) => (
        <span key={w.districtId} className="city-chip">
          {city.districts[w.districtId].building} {w.level} · {w.daysLeft === 1 ? 'mañana' : `en ${w.daysLeft} días`}
        </span>
      ))}
      <span className="city-chip muted">
        Equipo {city.crews.total - city.crews.busy > 0 ? `libre (${city.crews.total - city.crews.busy}/${city.crews.total})` : 'ocupado'}
      </span>
    </div>
  );
}

/** Tarjeta de la mesa: maqueta + lo que hay que hacer hoy. */
export function CityCard() {
  const { state } = useGame();
  if (!state.city.start) return null;
  return (
    <section className="card city-card" aria-label="Tu ciudad">
      <div className="card-head">
        <div>
          <h2>Tu ciudad</h2>
          <div className="tiny muted">Tamaño {state.city.size} · cada XP da materiales a su distrito</div>
        </div>
        <Link to="/ciudad" className="btn sm ghost">
          Ver ciudad
        </Link>
      </div>
      <CityModel state={state} />
      <CityActions state={state} />
    </section>
  );
}

/** Un distrito: nivel, materiales, obra y el botón para construir. */
export function DistrictRow({ d, selected }: { d: CityDistrictState; selected?: boolean }) {
  const next = d.next;
  const pct = next ? Math.min(100, Math.round((d.materials / next.cost) * 100)) : 100;
  return (
    <div id={`distrito-${d.id}`} className={`district ${selected ? 'selected' : ''} ${d.level === 0 ? 'is-empty' : ''}`}>
      <div className="district-head">
        <div>
          <div className="district-name">{d.name}</div>
          <div className="tiny muted">
            {d.level === 0 ? 'Lote vacío' : `${d.building} · nivel ${d.level}`}
            {d.perDay > 0 && ` · produce ${d.perDay}/día`}
          </div>
        </div>
        <div className="district-mats num">
          {d.materials}
          {d.stored > 0 && <small> +{d.stored}</small>}
        </div>
      </div>
      {d.work ? (
        <div className="district-work">
          {d.work.ready ? (
            <button className="btn sm primary" onClick={() => inaugurate(d)}>
              Inaugurar nivel {d.work.level}
            </button>
          ) : (
            <span className="small">
              Obra del nivel {d.work.level} · lista el {fmtDate(d.work.readyOn, true)}
            </span>
          )}
        </div>
      ) : next ? (
        <div className="district-next">
          <div className="district-bar" aria-hidden="true">
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="row between" style={{ gap: 8 }}>
            <span className="tiny muted num">
              {d.level === 0 ? 'Fundar' : `Nivel ${next.level}`}: {next.cost} · {next.days} {next.days === 1 ? 'día' : 'días'}
            </span>
            <button className={`btn sm ${d.canBuild ? 'primary' : ''}`} disabled={!d.canBuild} onClick={() => startBuild(d)}>
              {d.canBuild ? (d.level === 0 ? 'Fundar' : 'Construir') : d.blocked ? BLOCKED_TEXT[d.blocked] : 'Construir'}
            </button>
          </div>
        </div>
      ) : (
        <div className="tiny gold">Nivel máximo</div>
      )}
    </div>
  );
}

export const DISTRICT_HELP = `Cada cosa que haces da materiales al distrito de su atributo (1 por cada XP). Las obras tardan de 1 a ${GAME_CONFIG.city.levels.at(-1)!.days} días y hay que inaugurarlas. Los almacenes guardan ${GAME_CONFIG.city.storageDays} días de producción.`;

