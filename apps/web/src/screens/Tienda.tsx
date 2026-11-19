import { useMemo, useState } from 'react';
import { GAME_CONFIG, type Entity, type ShopRewardData } from '@igv/core';
import { addEvent, deleteEntity, saveEntity, useGame, voidEvent } from '../data/store';
import { updateSettings } from '../lib/actions';
import { THEMES, getTheme, ownedThemeIds, retiredPurchases, type ThemeItem } from '../lib/themes';
import { sfx } from '../lib/sound';
import { fmtDate, fmtNum, newId } from '../lib/time';
import { Icon } from '../ui/icons';
import { Badge, Chips, Empty, Field, PageHeader, Sheet, Tabs, confirmAction, toast, undoToast } from '../ui/kit';

const ICONS = ['star', 'heart', 'coin', 'globe', 'book', 'moon', 'crown', 'sparkles'];
const IDEAS: ShopRewardData[] = [
  { name: 'Cena en mi restaurante favorito', cost: 60, icon: 'heart' },
  { name: 'Tarde libre de series sin culpa', cost: 25, icon: 'moon' },
  { name: 'Comprarme un libro', cost: 30, icon: 'book' },
  { name: 'Escapada de fin de semana', cost: 400, icon: 'globe' },
];

/** Tienda: premios reales y estilos de la app (se pagan con oro; nunca tocan la XP). */
export default function Tienda() {
  const { state, list } = useGame();
  const [tab, setTab] = useState<'real' | 'style'>('real');
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
        eyebrow="Oro · Premios y estilo"
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
          Ganas 1 de oro por cada {GAME_CONFIG.gold.xpPerGold} XP. Gastar oro en premios o estilos nunca toca tu XP ni tus niveles.
        </p>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'real', label: 'Premios reales' },
          { value: 'style', label: 'Estilo de la app' },
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
        <StyleSection />
      )}

      {edit && <RewardSheet initial={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function StyleSection() {
  const { state } = useGame();
  const owned = useMemo(() => ownedThemeIds(state), [state]);
  const equipped = state.settings.equipped ?? {};
  const active = getTheme(equipped.skin).key;
  const retired = retiredPurchases(state);
  const refundable = retired.reduce((sum, r) => sum + r.cost, 0);

  const apply = (t: ThemeItem) => {
    updateSettings(state.settings, { equipped: { skin: t.key } });
    toast(`Estilo: ${t.name}`);
  };

  const buy = (t: ThemeItem) => {
    if (state.gold.balance < t.cost) return;
    if (!confirmAction(`¿Desbloquear el estilo "${t.name}" por ${t.cost} de oro?`)) return;
    const prev = active;
    const ev = addEvent('reward.redeemed', { rewardId: t.id, name: `Estilo: ${t.name}`, cost: t.cost });
    updateSettings(state.settings, { equipped: { skin: t.key } });
    sfx.coin();
    undoToast(`Estilo ${t.name} desbloqueado`, () => {
      voidEvent(ev.id);
      updateSettings(state.settings, { equipped: { skin: prev } });
    });
  };

  const refund = () => {
    if (!confirmAction(`¿Recuperar ${refundable} de oro de auras y emblemas que ya no existen?`)) return;
    for (const r of retired) voidEvent(r.eventId);
    updateSettings(state.settings, { equipped: { skin: equipped.skin } });
    toast(`+${refundable} de oro de vuelta`);
  };

  return (
    <>
      {retired.length > 0 && (
        <div className="card">
          <div className="row">
            <div className="grow small">
              Las auras y emblemas del avatar se retiraron. Gastaste <b className="gold">{refundable} de oro</b> en ellos.
            </div>
            <button className="btn sm primary" onClick={refund}>
              Recuperar
            </button>
          </div>
        </div>
      )}
      <div className="card">
        <p className="small muted" style={{ marginTop: 0 }}>
          Cambia los colores de toda la app. Funciona con el tema claro y el oscuro.
        </p>
        {THEMES.map((t) => {
          const has = owned.has(t.id);
          const on = active === t.key;
          const canBuy = state.gold.balance >= t.cost;
          return (
            <div key={t.id} className="item">
              <div className="theme-swatch" aria-hidden="true">
                {t.swatch.map((c) => (
                  <span key={c} style={{ background: c }} />
                ))}
              </div>
              <div className="grow">
                <div className="item-title">{t.name}</div>
                <div className="tiny muted">{t.description}</div>
                <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                  {on && <Badge tone="green">En uso</Badge>}
                  {!has && <Badge tone="gold">{t.cost} oro</Badge>}
                  {!has && !canBuy && <span className="tiny muted">faltan {t.cost - state.gold.balance}</span>}
                </div>
              </div>
              {has ? (
                <button className={`btn sm ${on ? '' : 'primary'}`} disabled={on} onClick={() => apply(t)}>
                  {on ? 'Activo' : 'Usar'}
                </button>
              ) : (
                <button className={`btn sm ${canBuy ? 'primary' : ''}`} disabled={!canBuy} onClick={() => buy(t)}>
                  Desbloquear
                </button>
              )}
            </div>
          );
        })}
      </div>
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
