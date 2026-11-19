import { useEffect, useMemo, useState } from 'react';
import {
  ATTRIBUTE_NAMES,
  GAME_CONFIG,
  MISSION_SIZE_NAMES,
  addDays,
  energyFromSleep,
  quickMissionId,
  type GoalData,
  type Entity,
  type VoiceContext,
  type VoiceProposal,
} from '@igv/core';
import type { CoachAction, GmProposal } from '../data/api';
import { useGame } from '../data/store';
import { fmtDate, fmtMoney } from '../lib/time';
import { applyProposal, duplicateReason, proposalReady, relDay, undoApplied, type Applied } from '../lib/voz';
import { Icon } from './icons';
import { AttrChips, Chips, DateChips, SizeChips, toast } from './kit';
import '../styles/voz.css';

/**
 * Tarjetas de propuestas de registro (lo que entendí de lo que dijiste): un toque para guardar cada una,
 * "Guardar todo" para el resto, tocar la tarjeta para corregirla y "Deshacer" después de guardar.
 * La usan "Cuéntame" (voz) y el Coach → "Registrar mi día".
 */

const ICONS: Record<VoiceProposal['kind'], string> = {
  mission: 'check',
  income: 'coin',
  expense: 'backpack',
  sleep: 'moon',
  weight: 'heart',
  rest: 'moon',
  person: 'users',
  lesson: 'feather',
  todo: 'calendar',
  goal: 'target',
};

const CHANNEL: Record<string, string> = { persona: 'En persona', llamada: 'Llamada', mensaje: 'Mensaje', videollamada: 'Videollamada' };

function describe(p: VoiceProposal, currency: string): { title: string; detail: string } {
  switch (p.kind) {
    case 'mission':
      return {
        title: p.title,
        detail: `${p.matched ? (p.missionKind === 'todo' ? 'De tu agenda' : 'Tu misión') : 'Misión rápida'} · ${MISSION_SIZE_NAMES[p.size]} · ${ATTRIBUTE_NAMES[p.attribute]} · +${GAME_CONFIG.missionXp[p.size]} XP`,
      };
    case 'income':
    case 'expense':
      return {
        title: `${p.kind === 'income' ? 'Ingreso' : 'Gasto'} ${fmtMoney(p.amount, currency)}`,
        detail: [p.concept, p.category && p.category.toLowerCase() !== p.concept.toLowerCase() ? p.category : ''].filter(Boolean).join(' · ') || 'Sin concepto',
      };
    case 'sleep':
      return { title: `Dormiste ${p.hours} h`, detail: `Energía ${energyFromSleep(p.hours, GAME_CONFIG as unknown as Parameters<typeof energyFromSleep>[1])}` };
    case 'weight':
      return { title: p.kg ? `Peso ${p.kg} kg` : 'Cuerpo', detail: p.workout ? `Entrenamiento: ${p.workout}` : 'Registro de cuerpo' };
    case 'rest':
      return { title: 'Día de descanso', detail: 'No rompe la racha' };
    case 'person':
      return { title: `Contacto con ${p.name}`, detail: [p.channel ? CHANNEL[p.channel] : '', p.note ?? ''].filter(Boolean).join(' · ') };
    case 'lesson':
      return { title: 'Lección', detail: `${p.text.slice(0, 120)}${p.text.length > 120 ? '…' : ''} · +${GAME_CONFIG.rewards.lesson} XP` };
    case 'todo':
      return { title: `Por hacer: ${p.title}`, detail: `${MISSION_SIZE_NAMES[p.size]} · ${ATTRIBUTE_NAMES[p.attribute]}` };
    case 'goal':
      return { title: `Meta: ${p.title}`, detail: `+${p.amount} ${p.unit}` };
  }
}

type Item = { p: VoiceProposal; status: 'pending' | 'saved' | 'removed'; applied?: Applied; open: boolean };

export function ProposalList({ proposals, onSaved, autoSaveLabel = 'Guardar todo' }: { proposals: VoiceProposal[]; onSaved?: (count: number) => void; autoSaveLabel?: string }) {
  const { state, events } = useGame();
  const today = state.today;
  const currency = state.settings.currency;
  const sig = proposals.map((p) => p.key).join('|');
  const [items, setItems] = useState<Item[]>(() => proposals.map((p) => ({ p, status: 'pending', open: false })));
  useEffect(() => {
    setItems(proposals.map((p) => ({ p, status: 'pending', open: false })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const patch = (i: number, f: (it: Item) => Item) => setItems((xs) => xs.map((x, j) => (j === i ? f(x) : x)));
  const savedCount = (xs: Item[]) => xs.filter((x) => x.status === 'saved').length;

  const saveOne = (i: number) => {
    const it = items[i];
    if (!it || it.status !== 'pending' || !proposalReady(it.p) || duplicateReason(it.p, state, events)) return;
    const applied = applyProposal(it.p);
    const next = items.map((x, j) => (j === i ? { ...x, status: 'saved' as const, applied, open: false } : x));
    setItems(next);
    onSaved?.(savedCount(next));
  };

  const saveAll = () => {
    let n = 0;
    const next = items.map((x) => {
      if (x.status !== 'pending' || !proposalReady(x.p) || duplicateReason(x.p, state, events)) return x;
      n++;
      return { ...x, status: 'saved' as const, applied: applyProposal(x.p), open: false };
    });
    setItems(next);
    if (n) toast(`${n} ${n === 1 ? 'registro guardado' : 'registros guardados'}`);
    onSaved?.(savedCount(next));
  };

  const undo = (i: number) => {
    const it = items[i];
    if (it?.applied) undoApplied(it.applied);
    patch(i, (x) => ({ ...x, status: 'pending', applied: undefined }));
  };

  const pendingReady = items.filter((x) => x.status === 'pending' && proposalReady(x.p) && !duplicateReason(x.p, state, events)).length;

  if (!items.length) return null;
  return (
    <div className="vz-list">
      {items.map((it, i) => {
        const { title, detail } = describe(it.p, currency);
        const dup = it.status === 'pending' ? duplicateReason(it.p, state, events) : null;
        const ready = proposalReady(it.p);
        return (
          <div key={it.p.key} className={`vz-card ${it.status} ${dup ? 'dup' : ''}`}>
            <div className="vz-row">
              <button
                type="button"
                className="vz-main"
                disabled={it.status !== 'pending'}
                aria-expanded={it.open}
                onClick={() => patch(i, (x) => ({ ...x, open: !x.open }))}
                title="Toca para corregir"
              >
                <span className={`vz-ico k-${it.p.kind}`}>
                  <Icon name={ICONS[it.p.kind]} />
                </span>
                <span className="vz-text">
                  <span className="vz-title">{title}</span>
                  <span className="vz-detail">
                    {detail} · {relDay(it.p.date, today, (d) => fmtDate(d))}
                  </span>
                  {dup && <span className="vz-warn">{dup}</span>}
                  {!ready && it.status === 'pending' && <span className="vz-warn">Falta un dato: tócala para completarla</span>}
                </span>
              </button>
              {it.status === 'saved' ? (
                <button type="button" className="btn sm ghost" onClick={() => undo(i)}>
                  Deshacer
                </button>
              ) : it.status === 'removed' ? (
                <button type="button" className="btn sm ghost" onClick={() => patch(i, (x) => ({ ...x, status: 'pending' }))}>
                  Volver
                </button>
              ) : (
                <div className="vz-actions">
                  <button type="button" className="vz-btn x" aria-label={`Quitar: ${title}`} onClick={() => patch(i, (x) => ({ ...x, status: 'removed', open: false }))}>
                    <Icon name="x" />
                  </button>
                  <button type="button" className="vz-btn ok" aria-label={`Guardar: ${title}`} disabled={!ready || !!dup} onClick={() => saveOne(i)}>
                    <Icon name="check" />
                  </button>
                </div>
              )}
            </div>
            {it.status === 'saved' && <div className="vz-saved">Guardado</div>}
            {it.open && it.status === 'pending' && <Editor p={it.p} today={today} onChange={(p) => patch(i, (x) => ({ ...x, p }))} />}
          </div>
        );
      })}
      {pendingReady > 0 && (
        <button type="button" className="btn primary block vz-saveall" onClick={saveAll}>
          <Icon name="check" /> {autoSaveLabel}
          {pendingReady > 1 ? ` (${pendingReady})` : ''}
        </button>
      )}
    </div>
  );
}

const num = (s: string) => {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/** Corregir una propuesta antes de guardarla. */
function Editor({ p, today, onChange }: { p: VoiceProposal; today: string; onChange: (p: VoiceProposal) => void }) {
  const { state } = useGame();
  const set = (patch: Record<string, unknown>) => onChange({ ...p, ...patch } as VoiceProposal);
  return (
    <div className="vz-editor">
      {p.kind === 'mission' &&
        (p.matched ? (
          <p className="tiny muted" style={{ margin: 0 }}>
            Es una misión de tu {p.missionKind === 'todo' ? 'agenda' : 'catálogo'}: se registra con su tamaño y atributo.
          </p>
        ) : (
          <>
            <input className="input" value={p.title} aria-label="Qué hiciste" onChange={(e) => set({ title: e.target.value, missionId: quickMissionId(e.target.value) })} />
            <SizeChips value={p.size} onChange={(size) => set({ size })} />
            <AttrChips value={p.attribute} onChange={(attribute) => set({ attribute })} />
          </>
        ))}
      {(p.kind === 'income' || p.kind === 'expense') && (
        <>
          <div className="vz-2">
            <input className="input" type="number" inputMode="decimal" min="0" aria-label={`Monto (${state.settings.currency})`} value={p.amount || ''} onChange={(e) => set({ amount: num(e.target.value) })} />
            <Chips
              value={p.kind}
              onChange={(kind) => set({ kind })}
              options={[
                { value: 'expense', label: 'Gasto' },
                { value: 'income', label: 'Ingreso' },
              ]}
            />
          </div>
          <input className="input" placeholder="Concepto" value={p.concept} onChange={(e) => set({ concept: e.target.value })} />
          <input className="input" placeholder="Categoría (opcional)" value={p.category ?? ''} onChange={(e) => set({ category: e.target.value || undefined })} />
        </>
      )}
      {p.kind === 'sleep' && <input className="input" type="number" inputMode="decimal" step="0.25" aria-label="Horas de sueño" value={p.hours || ''} onChange={(e) => set({ hours: num(e.target.value) })} />}
      {p.kind === 'weight' && <input className="input" type="number" inputMode="decimal" step="0.1" aria-label="Peso (kg)" value={p.kg ?? ''} onChange={(e) => set({ kg: num(e.target.value) || undefined })} />}
      {p.kind === 'goal' && <input className="input" type="number" inputMode="decimal" aria-label={`Avance (${p.unit})`} value={p.amount || ''} onChange={(e) => set({ amount: num(e.target.value) })} />}
      {p.kind === 'person' && p.alternatives.length > 0 && (
        <Chips
          value={p.npcId}
          onChange={(id) => {
            const all = [{ id: p.npcId, name: p.name }, ...p.alternatives];
            const pick = all.find((x) => x.id === id)!;
            set({ npcId: pick.id, name: pick.name, alternatives: all.filter((x) => x.id !== id) });
          }}
          options={[{ id: p.npcId, name: p.name }, ...p.alternatives].map((x) => ({ value: x.id, label: x.name }))}
        />
      )}
      {p.kind === 'lesson' && <textarea className="input" rows={3} value={p.text} onChange={(e) => set({ text: e.target.value })} />}
      {p.kind === 'todo' ? (
        <>
          <input className="input" value={p.title} aria-label="Qué vas a hacer" onChange={(e) => set({ title: e.target.value })} />
          <Chips
            value={[today, addDays(today, 1), addDays(today, 2)].includes(p.date) ? p.date : null}
            onChange={(date) => set({ date })}
            options={[
              { value: today, label: 'Hoy' },
              { value: addDays(today, 1), label: 'Mañana' },
              { value: addDays(today, 2), label: 'Pasado' },
            ]}
          />
        </>
      ) : (
        <DateChips value={p.date} onChange={(date) => set({ date })} today={today} />
      )}
    </div>
  );
}

/** Lo que el Coach hizo, con "Deshacer" en cada acción. */
export function CoachActionList({ actions, onUndo }: { actions: (CoachAction & { undone?: boolean })[]; onUndo: (a: CoachAction) => void }) {
  if (!actions.length) return null;
  return (
    <div className="coach-actions">
      {actions.map((a) => (
        <div key={a.activityId} className={`coach-action ${a.undone ? 'undone' : ''}`}>
          <Icon name="check" width={14} />
          <span className="grow">{a.summary}</span>
          {!a.undone && (
            <button className="btn sm ghost" onClick={() => onUndo(a)}>
              Deshacer
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Convierte las propuestas del Coach ("Registrar mi día") al formato de tarjetas. */
export function useGmProposals(gm: GmProposal[] | null, ctx: VoiceContext): VoiceProposal[] {
  const { list, state } = useGame();
  const goals = list<GoalData>('goals', 'goal') as Entity<GoalData>[];
  return useMemo(() => {
    if (!gm) return [];
    const out: VoiceProposal[] = [];
    gm.forEach((p, i) => {
      const key = `gm${i}`;
      const date = addDays(state.today, -Math.min(6, Math.max(0, p.daysAgo || 0)));
      const base = { key, date, source: '' };
      if (p.kind === 'mission') {
        const m = p.matchId ? ctx.missions.find((x) => x.id === p.matchId) : undefined;
        if (m) out.push({ ...base, kind: 'mission', missionId: m.id, title: m.title, size: m.size, attribute: m.attribute, missionKind: m.kind, mainQuestId: m.mainQuestId ?? null, matched: true });
        else if (p.title) {
          out.push({ ...base, kind: 'mission', missionId: quickMissionId(p.title), title: p.title, size: p.size ?? 'chica', attribute: p.attribute ?? 'disciplina', missionKind: 'quick', matched: false });
        }
      } else if (p.kind === 'income' || p.kind === 'expense') out.push({ ...base, kind: p.kind, amount: p.amount ?? 0, concept: p.concept ?? '', category: p.category ?? undefined });
      else if (p.kind === 'npc') {
        const n = ctx.people.find((x) => x.id === p.matchId);
        if (n) out.push({ ...base, kind: 'person', npcId: n.id, name: n.name, alternatives: [] });
      } else if (p.kind === 'lesson' && p.text) out.push({ ...base, kind: 'lesson', text: p.text });
      else if (p.kind === 'body' && (p.weightKg || p.workout)) out.push({ ...base, kind: 'weight', kg: p.weightKg ?? undefined, workout: p.workout ?? undefined });
      else if (p.kind === 'goal') {
        const g = goals.find((x) => x.id === p.matchId);
        if (g) out.push({ ...base, kind: 'goal', goalId: g.id, title: g.data.title, amount: p.amount ?? 0, unit: g.data.unit });
      } else if (p.kind === 'rest') out.push({ ...base, kind: 'rest' });
    });
    return out;
  }, [gm, ctx, goals, state.today]);
}
