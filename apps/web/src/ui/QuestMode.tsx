import { useEffect, useMemo, useState } from 'react';
import {
  ATTRIBUTE_NAMES,
  GAME_CONFIG,
  MISSION_SIZE_NAMES,
  type AttributeId,
  type Entity,
  type MissionData,
  type MissionSize,
  type TodoData,
} from '@igv/core';
import { useGame } from '../data/store';
import { completeMission, completeQuick, completeTodo } from '../lib/actions';
import { findLinkedBoss, guessQuestMinutes } from '../lib/narrator';
import { haptic, setAmbientSound, sfx, stopAmbient, type AmbientMode } from '../lib/sound';
import { BossArt, BossHpBar } from './BossArt';
import { Icon } from './icons';
import { AttrBadge, Badge } from './kit';

export interface ActiveQuestPayload {
  kind: 'mission' | 'todo' | 'quick';
  id?: string;
  title: string;
  size: MissionSize;
  attribute: AttributeId;
  mainQuestId?: string | null;
  minutes?: number;
}

interface StoredQuest extends ActiveQuestPayload {
  startedAt: number;
  elapsedBeforeMs: number;
  running: boolean;
  targetSec: number;
  mode: 'countdown' | 'stopwatch';
  steps: { id: string; text: string; done: boolean }[];
}

const STORAGE_KEY = 'igv-active-quest-v1';
const bus = new Set<(q: ActiveQuestPayload) => void>();

/** Lanza cualquier misión en Modo Combate / Enfoque desde cualquier pantalla. */
export function startQuest(q: ActiveQuestPayload) {
  sfx.questStart();
  haptic(20);
  bus.forEach((fn) => fn(q));
}

export function startMissionQuest(m: Entity<MissionData>) {
  startQuest({
    kind: 'mission',
    id: m.id,
    title: m.data.title,
    size: m.data.size,
    attribute: m.data.attribute,
    mainQuestId: m.data.mainQuestId ?? null,
    minutes: guessQuestMinutes(m.data.title, m.data.size),
  });
}

export function startTodoQuest(t: Entity<TodoData>) {
  startQuest({
    kind: 'todo',
    id: t.id,
    title: t.data.title,
    size: t.data.size,
    attribute: t.data.attribute,
    minutes: guessQuestMinutes(t.data.title, t.data.size),
  });
}

function loadStored(): StoredQuest | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredQuest;
  } catch {
    return null;
  }
}

function saveStored(q: StoredQuest | null) {
  try {
    if (q) localStorage.setItem(STORAGE_KEY, JSON.stringify(q));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // sin storage
  }
}

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/**
 * Modo Misión Activa ("Jugar durante el día"):
 * - Temporizador flexible (cuenta regresiva o cronómetro) persistente en localStorage.
 * - Muestra el jefe vinculado a la misión con su barra de HP.
 * - Sub-pasos rápidos de la sesión + sonido ambiente opcional (hoguera / lluvia).
 * - Se puede minimizar en una barra superior para consultar el resto de la app.
 */
export function QuestMode() {
  const { state, entities, byId } = useGame();
  const [quest, setQuest] = useState<StoredQuest | null>(() => loadStored());
  const [expanded, setExpanded] = useState<boolean>(false);
  const [now, setNow] = useState<number>(() => Date.now());
  const [stepInput, setStepInput] = useState('');
  const [ambient, setAmbient] = useState<AmbientMode>('off');

  useEffect(() => {
    const onStart = (payload: ActiveQuestPayload) => {
      const mins = payload.minutes ?? guessQuestMinutes(payload.title, payload.size);
      const next: StoredQuest = {
        ...payload,
        startedAt: Date.now(),
        elapsedBeforeMs: 0,
        running: true,
        targetSec: mins * 60,
        mode: 'countdown',
        steps: [],
      };
      setQuest(next);
      saveStored(next);
      setExpanded(true);
    };
    bus.add(onStart);
    return () => {
      bus.delete(onStart);
    };
  }, []);

  useEffect(() => {
    if (!quest?.running) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [quest?.running]);

  useEffect(() => () => stopAmbient(), []);

  const linkedBoss = useMemo(() => {
    if (!quest) return null;
    return findLinkedBoss(quest.id, quest.mainQuestId, entities, state);
  }, [quest, entities, state]);

  if (!quest) return null;

  const elapsedSec = Math.floor((quest.elapsedBeforeMs + (quest.running ? now - quest.startedAt : 0)) / 1000);
  const remainingSec = Math.max(0, quest.targetSec - elapsedSec);
  const displaySec = quest.mode === 'countdown' ? remainingSec : elapsedSec;
  const pct = quest.mode === 'countdown' ? Math.min(100, (elapsedSec / Math.max(quest.targetSec, 1)) * 100) : Math.min(100, ((elapsedSec % 1800) / 1800) * 100);
  const overtime = quest.mode === 'countdown' && elapsedSec >= quest.targetSec;

  const xp = GAME_CONFIG.missionXp[quest.size];
  const gold = Math.floor(xp / GAME_CONFIG.gold.xpPerGold);

  const update = (patch: Partial<StoredQuest>) => {
    setQuest((prev) => {
      if (!prev) return null;
      const next = { ...prev, ...patch };
      saveStored(next);
      return next;
    });
  };

  const toggleRun = () => {
    if (quest.running) {
      update({ running: false, elapsedBeforeMs: quest.elapsedBeforeMs + (Date.now() - quest.startedAt) });
    } else {
      update({ running: true, startedAt: Date.now() });
      setNow(Date.now());
    }
  };

  const changeMinutes = (m: number) => {
    update({ targetSec: m * 60, mode: 'countdown' });
  };

  const cancel = () => {
    stopAmbient();
    setAmbient('off');
    setQuest(null);
    saveStored(null);
    setExpanded(false);
  };

  const finish = () => {
    stopAmbient();
    setAmbient('off');
    if (quest.kind === 'mission' && quest.id) {
      const ent = byId.get(quest.id) as Entity<MissionData> | undefined;
      if (ent) completeMission(ent);
      else completeQuick(quest.title, quest.size, quest.attribute);
    } else if (quest.kind === 'todo' && quest.id) {
      const ent = byId.get(quest.id) as Entity<TodoData> | undefined;
      if (ent) completeTodo(ent);
      else completeQuick(quest.title, quest.size, quest.attribute);
    } else {
      completeQuick(quest.title, quest.size, quest.attribute);
    }
    setQuest(null);
    saveStored(null);
    setExpanded(false);
  };

  const addStep = () => {
    const t = stepInput.trim();
    if (!t) return;
    update({ steps: [...quest.steps, { id: String(Date.now()), text: t, done: false }] });
    setStepInput('');
  };

  const cycleAmbient = (m: AmbientMode) => {
    setAmbient(m);
    setAmbientSound(m);
  };

  // Barra minimizada cuando el usuario navega por la app mientras juega una misión
  if (!expanded) {
    return (
      <div className="quest-mini" role="region" aria-label="Misión en curso">
        <button className="quest-mini-main" onClick={() => setExpanded(true)}>
          <span className={`quest-dot ${quest.running ? 'live' : ''}`} />
          <div className="grow ellipsis" style={{ textAlign: 'left' }}>
            <div className="tiny muted">Misión en curso</div>
            <div className="small ellipsis" style={{ fontWeight: 700 }}>
              {quest.title}
            </div>
          </div>
          <span className="quest-mini-clock num">{fmtClock(displaySec)}</span>
        </button>
        <button className="btn sm primary" onClick={finish} aria-label="Completar misión">
          <Icon name="check" />
        </button>
      </div>
    );
  }

  const R = 82;
  const C = 2 * Math.PI * R;

  return (
    <div className="quest-overlay" role="dialog" aria-modal="true" aria-label={`Misión activa: ${quest.title}`}>
      <div className="quest-shell">
        <div className="row between" style={{ marginBottom: 14 }}>
          <button className="btn sm ghost" onClick={() => setExpanded(false)}>
            <Icon name="down" /> Minimizar
          </button>
          <span className="eyebrow" style={{ color: 'var(--gold)' }}>
            Misión Activa
          </span>
          <button className="btn sm ghost danger" onClick={cancel}>
            Salir
          </button>
        </div>

        <div className="quest-header">
          <div className="row wrap" style={{ justifyContent: 'center', gap: 6, marginBottom: 8 }}>
            <Badge tone="gold">
              {MISSION_SIZE_NAMES[quest.size]} · +{xp} XP
            </Badge>
            {gold > 0 && <Badge tone="gold">+{gold} oro</Badge>}
            <AttrBadge attr={quest.attribute} />
          </div>
          <h1 className="quest-title">{quest.title}</h1>
        </div>

        {linkedBoss && (
          <div className="quest-boss-strip">
            <BossArt bossId={linkedBoss.boss.id} size={46} />
            <div className="grow">
              <div className="tiny muted">Atacando a {linkedBoss.boss.data.name}</div>
              <BossHpBar hpPct={linkedBoss.hpRemainingPct} label={linkedBoss.phaseTitle} right={linkedBoss.currentText} />
            </div>
          </div>
        )}

        {/* Reloj circular de batalla / enfoque */}
        <div className="quest-clock-wrap">
          <svg viewBox="0 0 200 200" width={206} height={206} className="quest-ring">
            <circle cx="100" cy="100" r={R} fill="none" stroke="var(--line)" strokeWidth="8" />
            <circle
              cx="100"
              cy="100"
              r={R}
              fill="none"
              stroke={overtime ? 'var(--green)' : 'var(--gold)'}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - pct / 100)}
              transform="rotate(-90 100 100)"
              style={{ transition: 'stroke-dashoffset 0.5s linear' }}
            />
          </svg>
          <div className="quest-clock-center">
            <div className={`quest-clock num ${overtime ? 'green' : ''}`}>{fmtClock(displaySec)}</div>
            <div className="tiny muted">
              {overtime ? '¡Tiempo cumplido!' : quest.mode === 'countdown' ? (quest.running ? 'En combate…' : 'En pausa') : 'Cronómetro'}
            </div>
          </div>
        </div>

        {/* Controles del temporizador */}
        <div className="row" style={{ justifyContent: 'center', gap: 8, marginBottom: 14 }}>
          <button className="btn" onClick={toggleRun}>
            <Icon name={quest.running ? 'pause' : 'play'} />
            {quest.running ? 'Pausar' : 'Reanudar'}
          </button>
          <button
            className="btn ghost"
            onClick={() => update({ mode: quest.mode === 'countdown' ? 'stopwatch' : 'countdown' })}
            title="Cambiar entre cuenta regresiva y cronómetro"
          >
            <Icon name="clock" /> {quest.mode === 'countdown' ? 'Cronómetro' : 'Cuenta atrás'}
          </button>
        </div>

        {quest.mode === 'countdown' && (
          <div className="chips" style={{ justifyContent: 'center', marginBottom: 14 }}>
            {[15, 25, 30, 45, 60, 90].map((m) => (
              <button key={m} type="button" className={`chip ${quest.targetSec === m * 60 ? 'on' : ''}`} onClick={() => changeMinutes(m)}>
                {m} min
              </button>
            ))}
          </div>
        )}

        {/* Sonido ambiente */}
        <div className="quest-panel">
          <div className="row between" style={{ marginBottom: 8 }}>
            <span className="eyebrow">
              <Icon name="volume" width={13} style={{ verticalAlign: -2 }} /> Ambiente
            </span>
            <div className="chips">
              {(
                [
                  ['off', 'Silencio'],
                  ['fire', 'Hoguera'],
                  ['rain', 'Lluvia'],
                ] as const
              ).map(([m, label]) => (
                <button key={m} type="button" className={`chip ${ambient === m ? 'on' : ''}`} onClick={() => cycleAmbient(m)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <hr className="sep" />

          {/* Sub-pasos de la sesión */}
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Pasos de esta batalla (opcional)
          </div>
          {quest.steps.map((s) => (
            <label key={s.id} className="item" style={{ padding: '6px 0', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={s.done}
                onChange={() => update({ steps: quest.steps.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)) })}
                style={{ width: 18, height: 18, accentColor: 'var(--gold)' }}
              />
              <span className={`small grow ${s.done ? 'muted' : ''}`} style={s.done ? { textDecoration: 'line-through' } : undefined}>
                {s.text}
              </span>
            </label>
          ))}
          <form
            className="row"
            style={{ marginTop: 6 }}
            onSubmit={(e) => {
              e.preventDefault();
              addStep();
            }}
          >
            <input
              className="input"
              style={{ minHeight: 36, padding: '6px 10px' }}
              placeholder="Agregar paso rápido…"
              value={stepInput}
              onChange={(e) => setStepInput(e.target.value)}
            />
            <button className="btn sm" type="submit" disabled={!stepInput.trim()}>
              <Icon name="plus" />
            </button>
          </form>
        </div>

        <button className="btn primary block quest-finish-btn" onClick={finish}>
          <Icon name="sword" /> Completar misión (+{xp} XP · {ATTRIBUTE_NAMES[quest.attribute]})
        </button>
      </div>
    </div>
  );
}
