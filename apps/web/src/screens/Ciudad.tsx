import { useCallback, useState } from 'react';
import { useGame } from '../data/store';
import { startScore } from '../ui/DayRing';
import { CityActions, CityModel, DISTRICT_HELP, DistrictRow } from '../ui/CityCard';
import { PageHeader } from '../ui/kit';
import '../styles/ciudad.css';

/** Tu ciudad: la maqueta, lo que hay que hacer hoy y los siete distritos. */
export default function Ciudad() {
  const { state } = useGame();
  const [selected, setSelected] = useState<string | null>(null);
  const pick = useCallback((id: string) => {
    setSelected(id);
    document.getElementById(`distrito-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);
  const city = state.city;

  if (!city.start) {
    return (
      <>
        <PageHeader title="Tu ciudad" />
        <div className="card">
          <p className="small" style={{ marginTop: 0 }}>
            Tu ciudad empieza el día que actives tu marcador. Desde ahí, lo que hagas en tu vida real se vuelve material para construirla.
          </p>
          <button className="btn primary" onClick={() => startScore(state)}>
            Empezar desde hoy
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Tu ciudad" eyebrow={`Tamaño ${city.size} · ${city.inaugurations.length} obras inauguradas`} />
      <section className="card city-card">
        <CityModel state={state} onPick={pick} tall />
        <CityActions state={state} />
        <p className="tiny muted" style={{ margin: '10px 0 0' }}>
          Toca un lote para verlo. {DISTRICT_HELP}
        </p>
      </section>
      <div className="districts">
        {city.order.map((a) => (
          <DistrictRow key={a} d={city.districts[a]} selected={selected === a} />
        ))}
      </div>
    </>
  );
}
