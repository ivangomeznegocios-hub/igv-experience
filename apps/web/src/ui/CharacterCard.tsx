import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { lazyScreen } from '../lib/recover';
import {
  BEARD_STYLES,
  BODY_MEASURE_LABELS,
  BOTTOM_STYLES,
  FACE_TRAITS,
  GIRTH_KEYS,
  HAIR_STYLES,
  SHOE_STYLES,
  TOP_STYLES,
  ageOn,
  compareBodies,
  compareChoices,
  formatDelta,
  lerpPhysique,
  muscleStatus,
  physiqueAsOf,
  resolveCharacter,
  type CompareChoice,
  type MeasureDelta,
  type MuscleId,
  type MusclePaintMode,
  type BeardStyle,
  type BodyMeasureKey,
  type BodyMeasures,
  type BottomStyle,
  type CharacterData,
  type CharacterLook,
  type CharacterOutfit,
  type FaceTrait,
  type Girths,
  type HairStyle,
  type Physique,
  type ShoeStyle,
  type TopStyle,
} from '@igv/core';
import { addEvent, useGame } from '../data/store';
import { updateSettings } from '../lib/actions';
import { fmtDate } from '../lib/time';
import { Chips, DateChips, Field, Tabs, toast } from './kit';
import { Icon } from './icons';
import { FrontBack, MusclePanel, useMusclePaint, useNowIso } from './MuscleBody';

const CharacterView = lazyScreen(() => import('../character/CharacterView'));
/** Al comparar antes / ahora la figura va sin ropa (la ropa holgada esconde la forma), sin pintar músculos. */
const BARE = { tints: {}, selected: null, outline: false };

type Tab = 'resumen' | 'medidas' | 'apariencia' | 'ropa';

const HAIR_LABEL: Record<HairStyle, string> = { calvo: 'Calvo', rapado: 'Rapado', corto: 'Corto', copete: 'Copete', volumen: 'Con volumen', lado: 'De lado', chino: 'Chino' };
const BEARD_LABEL: Record<BeardStyle, string> = { ninguna: 'Sin barba', sombra: 'Sombra', corta: 'Corta', completa: 'Completa', candado: 'Candado', bigote: 'Bigote' };
const TOP_LABEL: Record<TopStyle, string> = { ninguna: 'Sin playera', playera: 'Playera', 'manga-larga': 'Manga larga', camisa: 'Camisa', sudadera: 'Sudadera' };
const BOTTOM_LABEL: Record<BottomStyle, string> = { short: 'Short', jeans: 'Jeans', pantalon: 'Pantalón', jogger: 'Pants' };
const SHOE_LABEL: Record<ShoeStyle, string> = { tenis: 'Tenis', zapato: 'Zapatos' };
const FACE_LABEL: Record<FaceTrait, [string, string, string]> = {
  jaw: ['Mandíbula', 'Angosta', 'Ancha'],
  chin: ['Mentón', 'Angosto', 'Ancho'],
  fullness: ['Cara', 'Afilada', 'Llena'],
  faceLength: ['Largo de cara', 'Corta', 'Larga'],
  midFace: ['De los ojos a la nariz', 'Corto', 'Largo'],
  lowerFace: ['De la nariz al mentón', 'Corto', 'Largo'],
  cheeks: ['Pómulos', 'Suaves', 'Marcados'],
  crown: ['Altura del cráneo', 'Bajo', 'Alto'],
  forehead: ['Frente', 'Corta', 'Amplia'],
  nose: ['Nariz', 'Chica', 'Grande'],
  noseWidth: ['Ancho de nariz', 'Fina', 'Ancha'],
  brows: ['Cejas', 'Delgadas', 'Pobladas'],
  browHeight: ['Altura de cejas', 'Bajas', 'Altas'],
  eyes: ['Ojos', 'Chicos', 'Grandes'],
  eyeOpen: ['Apertura de ojos', 'Entrecerrados', 'Abiertos'],
  eyeSpacing: ['Separación de ojos', 'Juntos', 'Separados'],
  lips: ['Labios', 'Delgados', 'Gruesos'],
  mouthWidth: ['Boca', 'Chica', 'Ancha'],
  ears: ['Orejas', 'Pegadas', 'Salidas'],
};

const SKIN_TONES = ['#f3d2b8', '#e8bc98', '#d9a57e', '#c68d67', '#b0764f', '#94603f', '#75482d', '#4f2f1e'];
const HAIR_COLORS = ['#0f0c0b', '#1f1713', '#3a2618', '#5b3a22', '#8a5a2e', '#b88a4a', '#8c8c8c', '#d9d6cf'];
const EYE_COLORS = ['#2a1c14', '#3b2a1e', '#5a3d24', '#6b7a3a', '#4a6a82', '#7d8a93'];
const CLOTH_COLORS = ['#f1efe9', '#c9ccd1', '#6b7280', '#23272f', '#0f1012', '#2f4466', '#1e3a5f', '#3d5a3c', '#7a2e2e', '#b8905a', '#d9c9a8'];
const SHOE_COLORS = ['#f1efe9', '#c9ccd1', '#23272f', '#0f1012', '#3b2416', '#6b4423', '#1e3a5f', '#7a2e2e'];

const OUTFIT_PRESETS: { name: string; outfit: Partial<CharacterOutfit> }[] = [
  { name: 'Casual', outfit: { top: 'playera', topColor: '#23272f', bottom: 'jeans', bottomColor: '#2f4466', shoes: 'tenis', shoesColor: '#f1efe9' } },
  { name: 'Gym', outfit: { top: 'playera', topColor: '#6b7280', bottom: 'short', bottomColor: '#0f1012', shoes: 'tenis', shoesColor: '#23272f' } },
  { name: 'Oficina', outfit: { top: 'camisa', topColor: '#f1efe9', bottom: 'pantalon', bottomColor: '#23272f', shoes: 'zapato', shoesColor: '#3b2416' } },
  { name: 'Descanso', outfit: { top: 'sudadera', topColor: '#6b7280', bottom: 'jogger', bottomColor: '#23272f', shoes: 'tenis', shoesColor: '#f1efe9' } },
  { name: 'Sin playera', outfit: { top: 'ninguna', bottom: 'short', bottomColor: '#0f1012', shoes: 'tenis', shoesColor: '#f1efe9' } },
];

const GIRTH_OF: Record<(typeof GIRTH_KEYS)[number], keyof Girths> = {
  neckCm: 'neck',
  shouldersCm: 'shoulders',
  chestCm: 'chest',
  waistCm: 'waist',
  hipsCm: 'hips',
  armCm: 'arm',
  forearmCm: 'forearm',
  thighCm: 'thigh',
  calfCm: 'calf',
};

const num = (s: string) => {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const fix1 = (n: number) => (Math.round(n * 10) / 10).toString();

/** Personaje 3D del perfil: toma su complexión de tus medidas y su aspecto de tus ajustes. */
export function CharacterCard() {
  const { state } = useGame();
  const [tab, setTab] = useState<Tab>('resumen');
  const [view, setView] = useState<'body' | 'face'>('body');
  const [front, setFront] = useState(0);
  // Modo músculos: la figura sin ropa arriba, con los músculos de la semana pintados.
  const [musclesOn, setMusclesOn] = useState(false);
  const [paintMode, setPaintMode] = useState<MusclePaintMode>('estado');
  const [picked, setPicked] = useState<MuscleId | null>(null);
  const [side, setSide] = useState<'frente' | 'espalda'>('frente');
  const [turn, setTurn] = useState({ yaw: 0, n: 0 });
  const nowIso = useNowIso();
  const muscles = useMemo(() => muscleStatus(state.training.summary, nowIso), [state.training.summary, nowIso]);
  const paint = useMusclePaint(muscles, paintMode, picked);
  const turnTo = (s: 'frente' | 'espalda') => {
    setSide(s);
    setTurn((t) => ({ yaw: s === 'frente' ? 0 : Math.PI, n: t.n + 1 }));
  };

  // --- Apariencia y ropa: borrador local que se guarda solo, medio segundo después del último cambio ---
  const saved = useMemo(() => resolveCharacter(state.settings.character), [state.settings.character]);
  const [draft, setDraft] = useState<CharacterData | null>(null);
  const character = draft ?? saved;
  const settingsRef = useRef(state.settings);
  settingsRef.current = state.settings;
  const pending = useRef<{ timer: number; next: CharacterData } | null>(null);
  const mounted = useRef(true);
  const flush = () => {
    if (!pending.current) return;
    window.clearTimeout(pending.current.timer);
    updateSettings(settingsRef.current, { character: pending.current.next });
    pending.current = null;
    // Ya quedó guardado: se suelta el borrador para no tapar cambios que lleguen de otro dispositivo.
    if (mounted.current) setDraft(null);
  };
  const change = (next: CharacterData) => {
    setDraft(next);
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = { next, timer: window.setTimeout(flush, 500) };
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      flush();
    };
  }, []);
  const setLook = (patch: Partial<CharacterLook>) => change({ ...character, look: { ...character.look, ...patch } });
  const setOutfit = (patch: Partial<CharacterOutfit>) => change({ ...character, outfit: { ...character.outfit, ...patch } });

  // --- Complexión: de los registros de cuerpo (y, mientras escribes medidas, de lo que llevas escrito) ---
  const age = state.settings.birthDate ? ageOn(state.settings.birthDate, state.today).years : null;
  const heightCm = state.settings.heightCm;
  const entries = state.body.entries;
  const dates = state.body.measureDates;
  // `extra` = lo que estás escribiendo en Medidas: cuenta como un registro más de ese día.
  const physiqueAt = (date: string, extra: BodyMeasures = {}, h = heightCm) => physiqueAsOf(Object.keys(extra).length ? [...entries, { date, ...extra }] : entries, date, { heightCm: h, age });
  const current = useMemo(() => physiqueAt(state.today), [entries, state.today, heightCm, age]);
  const hasData = dates.length > 0 || !!heightCm;

  const [typed, setTyped] = useState<{ measures: BodyMeasures; heightCm?: number } | null>(null);
  const [evo, setEvo] = useState<number | null>(null);
  const [play, setPlay] = useState<number | null>(null);
  const evoIndex = evo === null ? dates.length - 1 : Math.min(evo, dates.length - 1);
  const first = useMemo(() => (dates.length ? physiqueAt(dates[0]!) : current), [entries, heightCm, age, current]);

  // --- Antes / ahora: silueta de una fecha anterior encima de la figura, y cuánto cambió cada medida ---
  const choices = useMemo(() => compareChoices(dates, state.today), [dates, state.today]);
  const [cmp, setCmp] = useState<string | null>(null);
  const shownDate = evo !== null && dates[evoIndex] ? dates[evoIndex]! : state.today;
  const comparison = useMemo(
    () => (dates.length >= 2 ? compareBodies(entries, cmp ?? dates[0]!, shownDate, { heightCm, age }) : null),
    [entries, cmp, shownDate, dates, heightCm, age],
  );

  const shown: Physique = useMemo(() => {
    if (tab === 'medidas' && typed) return physiqueAt(state.today, typed.measures, typed.heightCm ?? heightCm);
    if (play !== null) return lerpPhysique(first, current, play);
    if (tab === 'resumen' && evo !== null && dates[evoIndex]) return physiqueAt(dates[evoIndex]!);
    return current;
  }, [tab, typed, play, evo, evoIndex, current, first, entries, heightCm, age, state.today]);

  // Animación "ver evolución": del primer registro a hoy.
  useEffect(() => {
    if (play === null) return;
    if (play >= 1) {
      const t = window.setTimeout(() => {
        setPlay(null);
        setEvo(null);
      }, 500);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setPlay((p) => (p === null ? null : Math.min(1, p + 1 / 14))), 110);
    return () => window.clearTimeout(t);
  }, [play]);

  const selectTab = (t: Tab) => {
    setTab(t);
    setPlay(null);
    setMusclesOn(false);
    setView(t === 'apariencia' ? 'face' : 'body');
    if (t === 'apariencia') setFront((n) => n + 1);
    if (t !== 'medidas') setTyped(null);
  };

  const ringColor = useMemo(() => getComputedStyle(document.documentElement).getPropertyValue('--gold').trim() || '#e6a938', [state.settings.equipped?.skin]);
  const est = shown.estimated;
  const approx = (flag: boolean, text: string) => (flag ? `≈${text}` : text);
  const [touched, setTouched] = useState(false);
  const ghostOn = !musclesOn && tab === 'resumen' && play === null && cmp !== null && comparison !== null && comparison.from !== comparison.to;
  const ghostColor = useMemo(() => getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#808080', [ghostOn, state.settings.equipped?.skin]);
  const ghost = useMemo(() => (ghostOn && comparison ? { physique: comparison.before, color: ghostColor } : null), [ghostOn, comparison, ghostColor]);
  const frame = musclesOn ? 'musculos' : view === 'face' ? 'rostro' : 'cuerpo';
  const setFrame = (f: 'cuerpo' | 'musculos' | 'rostro') => {
    if (f === 'musculos') {
      if (tab !== 'resumen') selectTab('resumen');
      setMusclesOn(true);
      setView('body');
      setSide('frente');
      return;
    }
    if (musclesOn && side === 'espalda') turnTo('frente');
    setMusclesOn(false);
    setPicked(null);
    setView(f === 'rostro' ? 'face' : 'body');
    if (f === 'rostro') setFront((n) => n + 1);
  };

  return (
    <div className={`card character-card ${tab !== 'resumen' ? 'editing' : ''}`}>
      <div className="character-stage" onPointerDown={() => setTouched(true)}>
        <Suspense fallback={<div className="character-canvas character-loading small muted">Cargando tu personaje…</div>}>
          <CharacterView
            physique={shown}
            character={character}
            progress={state.level.progress}
            ringColor={ringColor}
            view={view}
            frontSignal={front}
            muscles={musclesOn ? paint : ghost ? BARE : null}
            onPick={setPicked}
            ghost={ghost}
            turn={turn}
          />
        </Suspense>
        <div className="character-top">
          <div>
            <div className="eyebrow">Tu personaje</div>
            <div className="small">
              <b>{state.level.title}</b> <span className="muted">· NV {state.level.level}</span>
            </div>
          </div>
          <div className="character-views" role="group" aria-label="Encuadre">
            <button className={frame === 'cuerpo' ? 'on' : ''} onClick={() => setFrame('cuerpo')}>
              Cuerpo
            </button>
            <button className={frame === 'musculos' ? 'on' : ''} onClick={() => setFrame('musculos')}>
              Músculos
            </button>
            <button className={frame === 'rostro' ? 'on' : ''} onClick={() => setFrame('rostro')}>
              Rostro
            </button>
          </div>
        </div>
        {musclesOn && <FrontBack side={side} onSide={turnTo} />}
        {!touched && !musclesOn && (
          <div className="character-hint tiny muted" aria-hidden="true">
            Desliza para girar · pellizca para acercar
          </div>
        )}
      </div>

      <div className="character-stats">
        <Stat label="Peso" value={approx(est.weight, fix1(shown.weightKg))} unit="kg" />
        <Stat label="Grasa" value={approx(est.bodyFat, fix1(shown.bodyFatPct))} unit="%" />
        <Stat label="Masa magra" value={approx(est.weight || est.bodyFat, fix1(shown.leanKg))} unit="kg" />
        <Stat label="IMC" value={approx(est.weight || est.height, fix1(shown.bmi))} />
      </div>

      {musclesOn && <MusclePanel muscles={muscles} mode={paintMode} onMode={setPaintMode} selected={picked} onSelect={setPicked} />}

      <Tabs
        value={tab}
        onChange={selectTab}
        options={[
          { value: 'resumen', label: 'Evolución' },
          { value: 'medidas', label: 'Medidas' },
          { value: 'apariencia', label: 'Apariencia' },
          { value: 'ropa', label: 'Ropa' },
        ]}
      />

      {tab === 'resumen' && (
        <Evolution
          dates={dates}
          index={evoIndex}
          playing={play !== null}
          choices={choices}
          cmp={cmp}
          onCmp={setCmp}
          deltas={comparison?.deltas ?? []}
          compareFrom={comparison?.from ?? null}
          hasData={hasData}
          onIndex={(i) => (setPlay(null), setEvo(i >= dates.length - 1 ? null : i))}
          onPlay={() => (setEvo(null), setPlay(0))}
          onMeasure={() => selectTab('medidas')}
        />
      )}
      {tab === 'medidas' && <MeasuresForm current={current} onPreview={setTyped} onSaved={() => (setEvo(null), selectTab('resumen'))} />}
      {tab === 'apariencia' && <LookForm look={character.look} setLook={setLook} />}
      {tab === 'ropa' && <OutfitForm outfit={character.outfit} setOutfit={setOutfit} />}
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div>
      <div className="tiny muted">{label}</div>
      <div className="num">
        <b>{value}</b>
        {unit && <span className="tiny muted"> {unit}</span>}
      </div>
    </div>
  );
}

function Evolution({
  dates,
  index,
  playing,
  hasData,
  choices,
  cmp,
  onCmp,
  deltas,
  compareFrom,
  onIndex,
  onPlay,
  onMeasure,
}: {
  dates: string[];
  index: number;
  playing: boolean;
  hasData: boolean;
  choices: CompareChoice[];
  /** Fecha "antes" elegida (null = sin silueta; las diferencias se cuentan desde tu primer registro). */
  cmp: string | null;
  onCmp: (d: string | null) => void;
  deltas: MeasureDelta[];
  compareFrom: string | null;
  onIndex: (i: number) => void;
  onPlay: () => void;
  onMeasure: () => void;
}) {
  if (dates.length < 2)
    return (
      <div className="character-note">
        <div className="small">
          {hasData
            ? 'Ya tomó tu complexión. Vuelve a medirte cada 2 a 4 semanas y aquí vas a ver cómo cambia tu cuerpo con el tiempo.'
            : 'Por ahora es una figura promedio. Registra tu estatura y tu peso (y si puedes, cintura y % de grasa) para que tome tu complexión real.'}
        </div>
        <button className="btn sm primary" style={{ marginTop: 10 }} onClick={onMeasure}>
          <Icon name="plus" /> Registrar medidas
        </button>
      </div>
    );
  const atStart = compareFrom !== null && index <= dates.indexOf(compareFrom) && !playing;
  const nowLabel = index >= dates.length - 1 ? 'hoy' : fmtDate(dates[index]!, true);
  const anyEstimated = deltas.some((d) => d.estimated);
  return (
    <div>
      <div className="row between" style={{ marginBottom: 4 }}>
        <b className="small">{playing ? 'Tu evolución…' : index >= dates.length - 1 ? 'Hoy' : fmtDate(dates[index]!, true)}</b>
        <button className="btn sm ghost" onClick={onPlay} disabled={playing}>
          <Icon name="play" /> Ver evolución
        </button>
      </div>
      <input type="range" min={0} max={dates.length - 1} step={1} value={index} onChange={(e) => onIndex(Number(e.target.value))} aria-label="Fecha del registro" disabled={playing} />
      <div className="bar-label">
        <span>{fmtDate(dates[0]!, true)}</span>
        <span>{dates.length} registros</span>
        <span>Hoy</span>
      </div>

      <div className="cmp-head">
        <b className="small">Antes / ahora</b>
        {cmp !== null && (
          <button className="linklike tiny" onClick={() => onCmp(null)}>
            Quitar silueta
          </button>
        )}
      </div>
      {choices.length > 0 && (
        <div className="chips cmp-chips" role="radiogroup" aria-label="Comparar contra">
          {choices.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={cmp === c.date} className={`chip ${cmp === c.date ? 'on' : ''}`} onClick={() => onCmp(cmp === c.date ? null : c.date)}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      {cmp !== null && (
        <div className="cmp-key">
          <span>
            <i className="before" />
            Contorno: antes ({fmtDate(cmp, true)})
          </span>
          <span>
            <i className="now" />
            Figura: ahora ({nowLabel})
          </span>
        </div>
      )}
      {atStart ? (
        <div className="character-deltas tiny muted">Así empezaste. Mueve la barra para ver cómo has cambiado.</div>
      ) : deltas.length ? (
        <>
          <div className="tiny muted" style={{ marginBottom: 6 }}>
            {cmp === null ? 'Desde tu primer registro' : `Desde el ${fmtDate(cmp, true)}`} hasta {nowLabel}:
          </div>
          <div className="cmp-deltas">
            {deltas.map((d) => {
              const text = formatDelta(d);
              const value = text.slice(text.indexOf(d.label) + d.label.length + 1);
              return (
                <div key={d.key} className={`cmp-delta ${d.estimated ? 'est' : ''}`} title={d.estimated ? 'Estimado: no lo mediste en las dos fechas' : `${d.from} → ${d.to} ${d.unit}`}>
                  <span>{d.label}</span>
                  <b>
                    {d.estimated ? '≈ ' : ''}
                    {value}
                  </b>
                </div>
              );
            })}
          </div>
          {anyEstimated && <div className="tiny faint" style={{ marginTop: 6 }}>≈ estimado: no lo mediste en las dos fechas (se proyecta con tu peso).</div>}
        </>
      ) : (
        <div className="character-deltas tiny muted">Mide lo mismo dos veces (peso, % de grasa o contornos con cinta) para ver aquí cuánto cambiaste.</div>
      )}
    </div>
  );
}

function MeasuresForm({ current, onPreview, onSaved }: { current: Physique; onPreview: (t: { measures: BodyMeasures; heightCm?: number } | null) => void; onSaved: () => void }) {
  const { state } = useGame();
  const [height, setHeight] = useState(state.settings.heightCm ? String(state.settings.heightCm) : '');
  const [vals, setVals] = useState<Partial<Record<BodyMeasureKey, string>>>({});
  const [date, setDate] = useState(state.today);
  const [more, setMore] = useState(false);

  const measures = useMemo(() => {
    const out: BodyMeasures = {};
    for (const [k, v] of Object.entries(vals) as [BodyMeasureKey, string][]) {
      const n = num(v ?? '');
      if (n !== undefined) out[k] = n;
    }
    return out;
  }, [vals]);
  const h = num(height);
  const heightOk = h === undefined || (h >= 120 && h <= 230);
  const heightChanged = h !== undefined && h !== state.settings.heightCm && heightOk;
  useEffect(() => {
    onPreview({ measures, heightCm: h && h >= 120 && h <= 230 ? h : undefined });
  }, [measures, h]);

  const valid = (measures.weightKg === undefined || measures.weightKg <= 500) && (measures.bodyFatPct === undefined || (measures.bodyFatPct >= 2 && measures.bodyFatPct <= 70)) && GIRTH_KEYS.every((k) => measures[k] === undefined || measures[k]! <= 300);
  const any = Object.keys(measures).length > 0;
  const input = (k: BodyMeasureKey, placeholder: string, step = '0.1') => (
    <input className="input" type="number" inputMode="decimal" step={step} min={0} value={vals[k] ?? ''} placeholder={placeholder} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))} />
  );
  const last = state.body.latest;

  return (
    <div>
      <p className="tiny muted" style={{ marginTop: 0 }}>
        Llena solo lo que hayas medido: lo demás se estima y la figura cambia mientras escribes. No da XP; es para ver tu cuerpo evolucionar.
      </p>
      <div className="grid2" style={{ gap: 10 }}>
        <Field label="Estatura (cm)">
          <input className="input" type="number" inputMode="decimal" min={120} max={230} value={height} placeholder="175" onChange={(e) => setHeight(e.target.value)} aria-invalid={!heightOk} />
          {!heightOk && <span className="tiny" style={{ color: 'var(--red)' }}>Entre 120 y 230 cm</span>}
        </Field>
        <Field label="Peso (kg)">{input('weightKg', last.weightKg ? `Último: ${last.weightKg}` : '78')}</Field>
        <Field label="Grasa corporal (%)">{input('bodyFatPct', last.bodyFatPct ? `Último: ${last.bodyFatPct}` : `≈ ${fix1(current.bodyFatPct)}`)}</Field>
        <Field label="Cintura (cm)">{input('waistCm', last.waistCm ? `Último: ${last.waistCm}` : `≈ ${fix1(current.girths.waist)}`)}</Field>
      </div>
      <button className="collapse-btn small" onClick={() => setMore((x) => !x)} aria-expanded={more} style={{ marginBottom: 10 }}>
        <Icon name={more ? 'down' : 'right'} width={16} /> Más contornos con cinta (opcional)
      </button>
      {more && (
        <>
          <div className="grid2" style={{ gap: 10 }}>
            {GIRTH_KEYS.filter((k) => k !== 'waistCm').map((k) => (
              <Field key={k} label={`${BODY_MEASURE_LABELS[k]} (cm)`}>
                {input(k, last[k] ? `Último: ${last[k]}` : `≈ ${fix1(current.girths[GIRTH_OF[k]])}`)}
              </Field>
            ))}
          </div>
          <p className="tiny muted" style={{ marginTop: 0 }}>
            Relajado y sin apretar la cinta. Cintura: a la altura del ombligo. Cadera: en lo más ancho. Brazo: a la mitad del bíceps. Hombros: el contorno completo, por fuera de los brazos.
          </p>
        </>
      )}
      <Field label="¿Cuándo te mediste?">
        <DateChips value={date} onChange={setDate} today={state.today} />
      </Field>
      <button
        className="btn primary block"
        disabled={!valid || !heightOk || (!any && !heightChanged)}
        onClick={() => {
          if (heightChanged) updateSettings(state.settings, { heightCm: h });
          if (any) addEvent('body.logged', measures, { localDate: date });
          toast('Medidas guardadas');
          onPreview(null);
          onSaved();
        }}
      >
        Guardar medidas
      </button>
    </div>
  );
}

function Swatches({ value, onChange, colors, label }: { value: string; onChange: (c: string) => void; colors: string[]; label: string }) {
  const custom = !colors.includes(value.toLowerCase());
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {colors.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={c === value.toLowerCase()} aria-label={c} className={`swatch ${c === value.toLowerCase() ? 'on' : ''}`} style={{ background: c }} onClick={() => onChange(c)} />
      ))}
      <label className={`swatch custom ${custom ? 'on' : ''}`} style={custom ? { background: value } : undefined} title="Otro color">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label}: otro color`} />
        {!custom && <Icon name="plus" width={14} />}
      </label>
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="character-group">
      <div className="tiny muted" style={{ fontWeight: 650, marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function Slider({ label, low, high, value, onChange }: { label: string; low: string; high: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="character-slider">
      <div className="row between tiny">
        <b>{label}</b>
        {value !== 0 && (
          <button className="linklike tiny" onClick={() => onChange(0)}>
            Restablecer
          </button>
        )}
      </div>
      <input type="range" min={-1} max={1} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      <div className="bar-label">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

function LookForm({ look, setLook }: { look: CharacterLook; setLook: (p: Partial<CharacterLook>) => void }) {
  const [fine, setFine] = useState(false);
  return (
    <div>
      <Group label="Tono de piel">
        <Swatches label="Tono de piel" value={look.skin} onChange={(skin) => setLook({ skin })} colors={SKIN_TONES} />
      </Group>
      <Group label="Cabello">
        <Chips value={look.hair} onChange={(hair) => setLook({ hair })} options={HAIR_STYLES.map((h) => ({ value: h, label: HAIR_LABEL[h] }))} />
        <div style={{ height: 8 }} />
        <Swatches label="Color de cabello" value={look.hairColor} onChange={(hairColor) => setLook({ hairColor })} colors={HAIR_COLORS} />
      </Group>
      <Group label="Barba">
        <Chips value={look.beard} onChange={(beard) => setLook({ beard })} options={BEARD_STYLES.map((b) => ({ value: b, label: BEARD_LABEL[b] }))} />
      </Group>
      <Group label="Ojos">
        <Swatches label="Color de ojos" value={look.eyeColor} onChange={(eyeColor) => setLook({ eyeColor })} colors={EYE_COLORS} />
        <label className="checkbox" style={{ margin: '10px 0 0' }}>
          <input type="checkbox" checked={look.glasses} onChange={(e) => setLook({ glasses: e.target.checked })} /> Lentes
        </label>
      </Group>
      <button className="collapse-btn small" onClick={() => setFine((x) => !x)} aria-expanded={fine} style={{ marginBottom: 10 }}>
        <Icon name={fine ? 'down' : 'right'} width={16} /> Rasgos y proporciones a detalle
      </button>
      {fine && (
        <>
          {FACE_TRAITS.map((t) => (
            <Slider key={t} label={FACE_LABEL[t][0]} low={FACE_LABEL[t][1]} high={FACE_LABEL[t][2]} value={look.face?.[t] ?? 0} onChange={(v) => setLook({ face: { ...look.face, [t]: v } })} />
          ))}
          <Slider label="Cabello: arriba" low="Bajo" high="Alto" value={look.hairShape?.top ?? 0} onChange={(v) => setLook({ hairShape: { ...look.hairShape, top: v } })} />
          <Slider label="Cabello: al frente" low="Plano" high="Levantado" value={look.hairShape?.front ?? 0} onChange={(v) => setLook({ hairShape: { ...look.hairShape, front: v } })} />
          <Slider label="Cabello: a los lados" low="Pegado" high="Lleno" value={look.hairShape?.sides ?? 0} onChange={(v) => setLook({ hairShape: { ...look.hairShape, sides: v } })} />
          <Slider label="Sombra de barba" low="Apenas" high="Marcada" value={look.beardTone ?? 0} onChange={(v) => setLook({ beardTone: v })} />
          <Slider label="Hombros" low="Angostos" high="Anchos" value={look.build?.shoulders ?? 0} onChange={(v) => setLook({ build: { ...look.build, shoulders: v } })} />
          <Slider label="Piernas" low="Cortas" high="Largas" value={look.build?.legs ?? 0} onChange={(v) => setLook({ build: { ...look.build, legs: v } })} />
        </>
      )}
      <p className="tiny muted" style={{ marginBottom: 0 }}>
        Para que se parezca más a ti se afinan estos mismos valores a partir de fotos tuyas (de frente, de perfil y de cuerpo completo).
      </p>
    </div>
  );
}

function OutfitForm({ outfit, setOutfit }: { outfit: CharacterOutfit; setOutfit: (p: Partial<CharacterOutfit>) => void }) {
  return (
    <div>
      <Group label="Cambio rápido">
        <div className="chips">
          {OUTFIT_PRESETS.map((p) => (
            <button key={p.name} type="button" className="chip" onClick={() => setOutfit(p.outfit)}>
              {p.name}
            </button>
          ))}
        </div>
      </Group>
      <Group label="Arriba">
        <Chips value={outfit.top} onChange={(top) => setOutfit({ top })} options={TOP_STYLES.map((t) => ({ value: t, label: TOP_LABEL[t] }))} />
        {outfit.top !== 'ninguna' && (
          <>
            <div style={{ height: 8 }} />
            <Swatches label="Color de la prenda de arriba" value={outfit.topColor} onChange={(topColor) => setOutfit({ topColor })} colors={CLOTH_COLORS} />
          </>
        )}
      </Group>
      <Group label="Abajo">
        <Chips value={outfit.bottom} onChange={(bottom) => setOutfit({ bottom })} options={BOTTOM_STYLES.map((t) => ({ value: t, label: BOTTOM_LABEL[t] }))} />
        <div style={{ height: 8 }} />
        <Swatches label="Color de la prenda de abajo" value={outfit.bottomColor} onChange={(bottomColor) => setOutfit({ bottomColor })} colors={CLOTH_COLORS} />
      </Group>
      <Group label="Calzado">
        <Chips value={outfit.shoes} onChange={(shoes) => setOutfit({ shoes })} options={SHOE_STYLES.map((t) => ({ value: t, label: SHOE_LABEL[t] }))} />
        <div style={{ height: 8 }} />
        <Swatches label="Color del calzado" value={outfit.shoesColor} onChange={(shoesColor) => setOutfit({ shoesColor })} colors={SHOE_COLORS} />
      </Group>
      <Group label="Accesorios">
        <div className="row wrap" style={{ gap: 16 }}>
          <label className="checkbox" style={{ margin: 0 }}>
            <input type="checkbox" checked={outfit.watch} onChange={(e) => setOutfit({ watch: e.target.checked })} /> Reloj
          </label>
          <label className="checkbox" style={{ margin: 0 }}>
            <input type="checkbox" checked={outfit.cap} onChange={(e) => setOutfit({ cap: e.target.checked })} /> Gorra
          </label>
        </div>
        {outfit.cap && (
          <>
            <div style={{ height: 8 }} />
            <Swatches label="Color de la gorra" value={outfit.capColor} onChange={(capColor) => setOutfit({ capColor })} colors={CLOTH_COLORS} />
          </>
        )}
      </Group>
    </div>
  );
}
