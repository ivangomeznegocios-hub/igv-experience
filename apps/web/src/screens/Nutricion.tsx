import { useMemo, useState } from 'react';
import { FOOD_IDEAS, MEAL_KIND_NAMES, MEAL_LIMIT_TAGS, MEAL_TAG_NAMES, addDays, nutritionDay } from '@igv/core';
import { useGame, voidEvent } from '../data/store';
import { logWater, openCoachSheet, undoLastWater, useCoachPlan } from '../lib/coach';
import { fmtDate, fmtWeekday } from '../lib/time';
import { BarChart } from '../ui/charts';
import { CoachFace } from '../ui/coach/CoachFace';
import { useCoachEnabled } from '../lib/voz';
import { MealForm } from '../ui/coach/CoachSheets';
import { Icon } from '../ui/icons';
import { Badge, Empty, PageHeader, Sheet, confirmAction } from '../ui/kit';
import '../styles/coach.css';

/**
 * Nutrición: lo que comes contado como hábitos (proteína en cada comida, verdura, fruta, agua, sin ultraprocesados),
 * tus metas de calorías y proteína, porciones con la mano e ideas de comida mexicana. Solo registro: no da XP.
 */
export default function Nutricion() {
  const { state } = useGame();
  const plan = useCoachPlan();
  const ai = useCoachEnabled();
  const t = plan.nutrition.targets;
  const today = plan.nutrition.today;
  const [adding, setAdding] = useState(false);
  const week = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = addDays(state.today, i - 6);
        return { label: fmtWeekday(d).slice(0, 3), value: nutritionDay(state.coach, d, t).score ?? 0 };
      }),
    [state.coach, state.today, t],
  );
  const mood = today.score === null ? 'calma' : today.score >= 80 ? 'feliz' : today.score >= 50 ? 'animo' : 'atento';
  return (
    <>
      <PageHeader
        title="Nutrición"
        eyebrow="Cuerpo"
        right={
          <button className="btn sm primary" onClick={() => setAdding(true)}>
            <Icon name="plus" /> Comida
          </button>
        }
      />

      <div className="card">
        <div className="coach-head">
          <CoachFace mood={mood} size={52} />
          <div className="grow">
            <div className="eyebrow">Hoy · {today.score === null ? 'sin registro' : `${today.score}/100`}</div>
            <div className="coach-msg-main">
              {today.score === null
                ? `¿Qué has comido hoy? Regístralo y te digo qué te falta. Meta: proteína en ${t.meals.protein} comidas, verdura en ${t.meals.veggies}, fruta y ${t.waterGlasses} vasos de agua.`
                : (today.tip ?? 'Día de comida redondo. Así se construye el cuerpo que quieres.')}
            </div>
          </div>
        </div>
        <div className="nutri-checks">
          {today.checks.map((c) => (
            <div key={c.key} className={`nutri-check ${c.done ? 'done' : ''}`}>
              <Icon name={c.done ? 'check' : 'minus'} width={14} />
              <span>
                <b>{c.label}</b> <small>{c.detail}</small>
              </span>
            </div>
          ))}
        </div>
        <div className="water-row">
          <Icon name="water" width={20} />
          <div className="water-glasses" aria-label={`${today.water} de ${t.waterGlasses} vasos`}>
            {Array.from({ length: Math.max(t.waterGlasses, today.water) }, (_, i) => (
              <i key={i} className={i < today.water ? 'on' : ''} />
            ))}
          </div>
          <button className="btn sm" onClick={() => logWater(1)} aria-label="Sumar un vaso de agua">
            +1 vaso
          </button>
          {today.water > 0 && (
            <button className="btn sm ghost icon" onClick={() => undoLastWater(state.today)} aria-label="Quitar un vaso">
              <Icon name="minus" />
            </button>
          )}
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button className="btn primary grow" onClick={() => setAdding(true)}>
            <Icon name="apple" /> ¿Qué comiste?
          </button>
          {ai && (
            <button className="btn grow" onClick={() => openCoachSheet({ kind: 'chat', ask: '¿Qué me recomiendas comer hoy para llegar a mi proteína y mis verduras?' })}>
              <Icon name="chat" /> Pregúntale
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Comidas de hoy</h2>
          <span className="tiny muted">{today.proteinG !== null ? `${today.proteinG} g de proteína${today.kcal ? ` · ${today.kcal} kcal` : ''}` : ''}</span>
        </div>
        {today.meals.length === 0 && <Empty>Aún no registras comidas hoy.</Empty>}
        {today.meals.map((m) => (
          <div key={m.eventId} className="item">
            <div className="grow">
              <div className="item-title">
                {MEAL_KIND_NAMES[m.meal]}
                {m.text ? ` · ${m.text}` : ''}
              </div>
              <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                {m.tags.map((tag) => (
                  <Badge key={tag} tone={MEAL_LIMIT_TAGS.includes(tag) ? 'flame' : 'teal'}>
                    {MEAL_TAG_NAMES[tag]}
                  </Badge>
                ))}
                {m.proteinG && <Badge>{m.proteinG} g proteína</Badge>}
                {m.kcal && <Badge>{m.kcal} kcal</Badge>}
              </div>
            </div>
            <button className="btn icon ghost danger" aria-label="Anular comida" onClick={() => confirmAction('¿Anular esta comida?') && voidEvent(m.eventId)}>
              <Icon name="trash" />
            </button>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Tus metas</h2>
          <button className="btn sm ghost" onClick={() => openCoachSheet('setup')} aria-label="Ajustar tus metas" title="Ajustar tus metas">
            <Icon name="settings" />
          </button>
        </div>
        <div className="tr-stats">
          <div className="tr-stat">
            <b>{t.kcal ? t.kcal.toLocaleString('es-MX') : '—'}</b>
            <span>kcal / día</span>
          </div>
          <div className="tr-stat">
            <b>{t.proteinG ?? '—'}</b>
            <span>g proteína</span>
          </div>
          <div className="tr-stat">
            <b>{t.waterGlasses}</b>
            <span>vasos agua</span>
          </div>
          <div className="tr-stat">
            <b>{t.fiberG}</b>
            <span>g fibra</span>
          </div>
        </div>
        {t.notes.map((n) => (
          <p key={n} className="tiny muted" style={{ margin: '8px 0 0' }}>
            {n}
          </p>
        ))}
        <div className="eyebrow" style={{ marginTop: 12 }}>
          Tu plato en cada comida (con la mano, sin báscula)
        </div>
        <div className="portions">
          <div>
            <b>{t.portions.proteina}</b>
            <span>de proteína{t.proteinPerMeal ? ` (~${t.proteinPerMeal} g)` : ''}</span>
          </div>
          <div>
            <b>{t.portions.verduras}</b>
            <span>de verdura</span>
          </div>
          <div>
            <b>{t.portions.carbos}</b>
            <span>de carbohidratos</span>
          </div>
          <div>
            <b>{t.portions.grasas}</b>
            <span>de grasas buenas</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Últimos 7 días</h2>
          <span className="tiny muted">calificación 0–100</span>
        </div>
        {week.some((d) => d.value > 0) ? <BarChart data={week} color="var(--teal)" format={(v) => `${v}/100`} /> : <Empty>Registra tus comidas y aquí verás cómo vas.</Empty>}
      </div>

      <div className="card">
        <h2>Ideas para tu plato</h2>
        {(
          [
            ['proteina', 'Proteína'],
            ['verduras', 'Verduras'],
            ['fruta', 'Fruta'],
            ['integrales', 'Carbohidratos'],
            ['grasas', 'Grasas buenas'],
          ] as const
        ).map(([k, label]) => (
          <div key={k} className="food-row">
            <b>{label}</b>
            <span className="small muted">{FOOD_IDEAS[k].join(' · ')}</span>
          </div>
        ))}
        <p className="tiny faint" style={{ marginBottom: 0 }}>
          Orientación general basada en la evidencia (proteína 1.6–2.2 g/kg, 5 porciones de verdura y fruta, agua, pocos ultraprocesados). No sustituye a un nutriólogo.
        </p>
      </div>

      <RecentDays />

      {adding && (
        <Sheet open onClose={() => setAdding(false)} title="¿Qué comiste?">
          <MealForm onDone={() => setAdding(false)} />
        </Sheet>
      )}
    </>
  );
}

function RecentDays() {
  const { state } = useGame();
  const plan = useCoachPlan();
  const days = Array.from({ length: 6 }, (_, i) => addDays(state.today, -(i + 1)))
    .map((d) => nutritionDay(state.coach, d, plan.nutrition.targets))
    .filter((d) => d.meals.length || d.water);
  if (!days.length) return null;
  return (
    <div className="card">
      <h2>Días anteriores</h2>
      {days.map((d) => (
        <div key={d.date} className="wk-item" style={{ cursor: 'default' }}>
          <div className="wk-date">
            <b>{Number(d.date.slice(8))}</b>
            <span>{fmtWeekday(d.date).slice(0, 3)}</span>
          </div>
          <div className="grow">
            <div className="item-title">
              {d.score}/100 · {d.meals.length} {d.meals.length === 1 ? 'comida' : 'comidas'} · {d.water} vasos
            </div>
            <div className="tiny muted">{d.meals.map((m) => `${MEAL_KIND_NAMES[m.meal]}${m.text ? `: ${m.text}` : ''}`).join(' · ')}</div>
            <div className="tiny faint">{fmtDate(d.date)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
