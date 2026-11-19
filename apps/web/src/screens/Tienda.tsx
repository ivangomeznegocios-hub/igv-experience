import { useMemo, useState } from 'react';
import { GAME_CONFIG, type Entity, type ShopRewardData } from '@igv/core';
import { addEvent, deleteEntity, saveEntity, useGame, voidEvent } from '../data/store';
import { updateSettings } from '../lib/actions';
import { ARMORY_ITEMS, ownedArmoryIds, type ArmoryItem, type ArmorySlot } from '../lib/armory';
import { sfx } from '../lib/sound';
import { fmtDate, fmtNum, newId } from '../lib/time';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/icons';
import { Badge, Chips, Empty, Field, PageHeader, Sheet, Tabs, confirmAction, toast, undoToast } from '../ui/kit';

const ICONS = ['star', 'heart', 'coin', 'globe', 'book', 'moon', 'crown', 'sparkles'];
const IDEAS: ShopRewardData[] = [
  { name: 'Cena en mi restaurante favorito', cost: 60, icon: 'heart' },
  { name: 'Tarde libre de series sin culpa', cost: 25, icon: 'moon' },
  { name: 'Comprarme un libro', cost: 30, icon: 'book' },
  { name: 'Escapada de fin de semana', cost: 400, icon: 'globe' },
];

const SLOT_TITLES: Record<ArmorySlot, string> = {
  aura: 'Auras del personaje',
  emblem: 'Equipo y emblemas',
  skin: 'Atmósfera del HUD',
};

/** Tienda: premios reales y Armería cosmética del juego (se pagan con oro; nunca tocan la XP). */
export default function Tienda() {
  const { state, list } = useGame();
  const [tab, setTab] = useState<'real' | 'armory'>('real');
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
        eyebrow="Oro · Premios y Armería"
        right={
          tab === 'real' ? (
            <button className="btn sm primary" onClick={() => setEdit('new')}>
              <Icon name="plus" /> Premio
            </button>
          ) : undefined
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
          Ganas 1 de oro por cada {GAME_CONFIG.gold.xpPerGold} XP. Gastar oro en premios reales o cosméticos nunca toca tu XP ni tus niveles.
        </p>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'real', label: 'Premios reales' },
          { value: 'armory', label: 'Armería RPG' },
        ]}
      />

      {tab === 'real' ? (
        <>
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
              <h2>Historial de canjes</h2>
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
        </>
      ) : (
        <ArmorySection />
      )}

      {edit && <RewardSheet initial={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function ArmorySection() {
  const { state } = useGame();
  const owned = useMemo(() => ownedArmoryIds(state), [state]);
  const equipped = state.settings.equipped ?? {};
  const [preview, setPreview] = useState<{ aura?: string; emblem?: string } | null>(null);

  const equip = (item: ArmoryItem) => {
    const cur = equipped[item.slot];
    const nextVal = item.slot === 'skin' ? item.skinKey : cur === item.id ? undefined : item.id;
    updateSettings(state.settings, { equipped: { ...equipped, [item.slot]: nextVal } });
    sfx.coin();
    toast(nextVal ? `Equipado: ${item.name}` : `Desequipado: ${item.name}`);
  };

  const buy = (item: ArmoryItem) => {
    if (state.gold.balance < item.cost) return;
    if (!confirmAction(`¿Desbloquear "${item.name}" por ${item.cost} de oro?`)) return;
    const ev = addEvent('reward.redeemed', { rewardId: item.id, name: `Armería: ${item.name}`, cost: item.cost });
    updateSettings(state.settings, { equipped: { ...equipped, [item.slot]: item.slot === 'skin' ? item.skinKey : item.id } });
    sfx.achievement();
    undoToast(`✨ ${item.name} desbloqueado y equipado`, () => voidEvent(ev.id));
  };

  const isEquipped = (item: ArmoryItem) =>
    item.slot === 'skin' ? (equipped.skin ?? 'obsidian') === item.skinKey : equipped[item.slot] === item.id;

  return (
    <>
      <div className="card">
        <div className="row" style={{ gap: 16 }}>
          <Avatar size={84} preview={preview ?? undefined} />
          <div className="grow">
            <div className="eyebrow">Vista previa de tu personaje</div>
            <h2 style={{ margin: '2px 0 4px' }}>{state.settings.name}</h2>
            <div className="small muted">
              {preview ? 'Previsualizando cosmético…' : 'Compra y equipa auras, emblemas y atmósferas visuales con tu oro.'}
            </div>
            {preview && (
              <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => setPreview(null)}>
                Quitar vista previa
              </button>
            )}
          </div>
        </div>
      </div>

      {(['aura', 'emblem', 'skin'] as ArmorySlot[]).map((slot) => (
        <div key={slot}>
          <div className="section-title">{SLOT_TITLES[slot]}</div>
          <div className="card">
            {ARMORY_ITEMS.filter((i) => i.slot === slot).map((item) => {
              const has = owned.has(item.id);
              const eq = isEquipped(item);
              const canBuy = state.gold.balance >= item.cost;
              return (
                <div key={item.id} className="item">
                  <div className="shop-icon" style={{ color: item.accent, borderColor: item.accent }}>
                    <Icon name={item.icon} />
                  </div>
                  <div
                    className="grow"
                    style={{ cursor: slot !== 'skin' ? 'pointer' : undefined }}
                    onClick={() => slot !== 'skin' && setPreview({ [slot]: item.id })}
                  >
                    <div className="item-title">{item.name}</div>
                    <div className="tiny muted">{item.description}</div>
                    <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                      {eq && <Badge tone="green">Equipado</Badge>}
                      {has && !eq && <Badge>Desbloqueado</Badge>}
                      {!has && <Badge tone="gold">{item.cost} oro</Badge>}
                      {!has && !canBuy && <span className="tiny muted">faltan {item.cost - state.gold.balance}</span>}
                    </div>
                  </div>
                  {has ? (
                    <button className={`btn sm ${eq ? '' : 'primary'}`} onClick={() => equip(item)}>
                      {eq ? (slot === 'skin' ? 'Activo' : 'Quitar') : 'Equipar'}
                    </button>
                  ) : (
                    <button className={`btn sm ${canBuy ? 'primary' : ''}`} disabled={!canBuy} onClick={() => buy(item)}>
                      Comprar
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
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
