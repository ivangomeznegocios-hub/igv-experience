import type { AttributeId } from '../types';

/**
 * Tu ciudad (sistema "ciudad"): un distrito por atributo. Lo que haces en la vida real produce materiales del
 * distrito de su atributo (1 por cada XP); con ellos levantas el edificio principal de cada distrito, nivel por
 * nivel. Los nombres son fijos (cambiarlos solo cambia lo que se ve; los niveles salen de los eventos).
 */
export interface CityDistrict {
  /** = atributo. */
  id: AttributeId;
  name: string;
  /** Edificio principal del distrito. */
  building: string;
  /** Material que produce (para textos: "120 de Finanzas"). */
  short: string;
}

export const CITY_DISTRICTS: readonly CityDistrict[] = [
  { id: 'disciplina', name: 'Centro', building: 'Edificio central', short: 'Disciplina' },
  { id: 'finanzas', name: 'Distrito financiero', building: 'Torre de oficinas', short: 'Finanzas' },
  { id: 'fuerza', name: 'Parque deportivo', building: 'Gimnasio', short: 'Fuerza' },
  { id: 'inteligencia', name: 'Campus', building: 'Biblioteca', short: 'Inteligencia' },
  { id: 'carisma', name: 'Plaza', building: 'Auditorio', short: 'Carisma' },
  { id: 'relaciones', name: 'Barrio', building: 'Casa', short: 'Relaciones' },
  { id: 'creatividad', name: 'Taller', building: 'Estudio', short: 'Creatividad' },
];

export function cityDistrict(id: string): CityDistrict | undefined {
  return CITY_DISTRICTS.find((d) => d.id === id);
}
