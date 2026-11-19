import { useState } from 'react';
import { GAME_CONFIG, type Entity, type ShopRewardData } from '@igv/core';
import { addEvent, deleteEntity, saveEntity, useGame, voidEvent } from '../data/store';
import { fmtDate, fmtNum, newId } from '../lib/time';
import { sfx } from '../lib/sound';
import { Badge, Chips, Empty, Field, PageHeader, Sheet, confirmAction, undoToast } from '../ui/kit';
import { Icon } from '../ui/icons';

const ICONS = ['star', 'heart', 'coin', 'globe', 'book', 'moon', 'crown', 'sparkles'];
const IDEAS: ShopRewardData[] = [
  { name: 'Cena en mi restaurante favorito', cost: 60, icon: 'heart' },
  { name: 'Tarde libre de series sin culpa', cost: 25, icon: 'moon' },
  { name: 'Comprarme un libro', cost: 30, icon: 'book' },
  { name: 'Escapada de fin de semana', cost: 400, icon: 'globe' },
];

/** Tienda de premios reales: se pagan con oro (nunca con XP). */
export default function Tienda() {
  const { state, list } = useGame();
  const rewards = list<ShopRewardData>('shop', 'reward').sort((a, b) => a.data.cost - b.data.cost);
  const [edit, setEdit] = useState<Entity<ShopRewardData> | 'new' | null>(null);
  const g = state.gold;
  const redeem = (r: Entity<ShopRewardData>) => {
    if (g.balance < r.data.cost) return;
    if (!confirmAction(`¿Canjear "${r.data.name}" por ${r.data.cost} de oro? Tu XP no cambia.`)) return;
    const ev = addEvent('reward.redeemed', { rewardId: r.id, name: r.data.name, cost: r.data.cost });
    sfx.coin();
    undoToast(`🎁 ${r.data.name}: ¡disfrútalo!`, () => voidEvent(ev.id));
  };
  return (
    <>
      <PageHeader
        title="Tienda"
        eyebrow="Premios reales"
        right={
          <button className="btn sm primary" onClick={() => setEdit('new')}>
            <Icon name="plus" /> Premio
          </button>
        }
      />
      <div className="card hero">
        <div className="row">
          <div className="gold-coin">
            <Icon name="coin" />
          </div>
          <div className="grow">
            <div className="eyebrow">Tu oro</div>
            <div className="stat-big num gold">{fmtNum(g.balance)}</div>
            <div className="tiny muted">
              Ganado {fmtNum(g.earned)} · gastado {fmtNum(g.spent)} · hoy +{g.earnedToday}
            </div>
          </div>
        </div>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          Ganas 1 de oro por cada {GAME_CONFIG.gold.xpPerGold} XP. El oro es aparte: canjear premios nunca te quita XP ni niveles.
        </p>
      </div>
      <div className="card">
        {rewards.length === 0 && (
          <>
            <Empty>Define premios reales que te quieras ganar.</Empty>
            <div className="row wrap" style={{ gap: 6 }}>
              {IDEAS.map((i) => (
                <button key={i.name} className="btn sm" onClick={() => saveEntity({ id: `rw-${newId().slice(0, 8)}`, module: 'shop', kind: 'reward', data: i })}>
                  <Icon name="plus" /> {i.name} ({i.cost})
                </button>
              ))}
            </div>
          </>
        )}
        {rewards.map((r) => {
          const can = g.balance >= r.data.cost;
          const times = g.redemptions.filter((x) => x.rewardId === r.id && x.valid).length;
          return (
            <div key={r.id} className="item">
              <div className="shop-icon">
                <Icon name={r.data.icon ?? 'star'} />
              </div>
              <div className="grow" onClick={() => setEdit(r)} style={{ cursor: 'pointer' }}>
                <div className="item-title">{r.data.name}</div>
                <div className="row wrap" style={{ gap: 4, marginTop: 3 }}>
                  <Badge tone="gold">{r.data.cost} oro</Badge>
                  {times > 0 && <Badge>{times}× canjeado</Badge>}
                  {!can && <span className="tiny muted">faltan {r.data.cost - g.balance}</span>}
                </div>
              </div>
              <button className={`btn sm ${can ? 'primary' : ''}`} disabled={!can} onClick={() => redeem(r)}>
                Canjear
              </button>
            </div>
          );
        })}
      </div>
      {g.redemptions.length > 0 && (
        <div className="card">
          <h2>Historial</h2>
          {[...g.redemptions].reverse().map((x) => (
            <div key={x.eventId} className="item" style={{ padding: '6px 0', opacity: x.valid ? 1 : 0.5 }}>
              <div className="grow small">
                {x.name}
                <div className="tiny muted">
                  {fmtDate(x.date, true)}
                  {!x.valid && ' · no alcanzaba el oro (no cuenta)'}
                </div>
              </div>
              <b className="num gold small">−{x.cost}</b>
            </div>
          ))}
        </div>
      )}
      {edit && <RewardSheet initial={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function RewardSheet({ initial, onClose }: { initial: Entity<ShopRewardData> | null; onClose: () => void }) {
  const [d, setD] = useState<ShopRewardData>(initial?.data ?? { name: '', cost: 50, icon: 'star' });
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Editar premio' : 'Nuevo premio'}
      actions={
        <>
          {initial && (
            <button className="btn ghost danger" onClick={() => confirmAction('¿Borrar este premio?') && (deleteEntity(initial.id), onClose())}>
              Borrar
            </button>
          )}
          <button
            className="btn primary"
            disabled={!d.name.trim() || !(d.cost > 0)}
            onClick={() => {
              saveEntity({ id: initial?.id ?? `rw-${newId().slice(0, 8)}`, module: 'shop', kind: 'reward', data: { ...d, name: d.name.trim(), cost: Math.round(d.cost) } });
              onClose();
            }}
          >
            Guardar
          </button>
        </>
      }
    >
      <Field label="Premio">
        <input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
      </Field>
      <Field label="Costo (oro)">
        <input className="input" type="number" min={1} value={d.cost} onChange={(e) => setD({ ...d, cost: Number(e.target.value) })} />
      </Field>
      <div style={{ marginTop: -4, marginBottom: 12 }}>
        <Chips value={d.cost} onChange={(cost) => setD({ ...d, cost })} options={[10, 25, 50, 100, 250, 500].map((c) => ({ value: c, label: String(c) }))} />
      </div>
      <Field label="Ícono">
        <Chips value={d.icon ?? 'star'} onChange={(icon) => setD({ ...d, icon })} options={ICONS.map((i) => ({ value: i, label: <Icon name={i} width={18} /> }))} />
      </Field>
      <p className="tiny muted">Referencia: una misión media da 30 XP = 3 de oro; una grande, 10 de oro.</p>
    </Sheet>
  );
}
