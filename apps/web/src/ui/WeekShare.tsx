import { useState } from 'react';
import { addDays, ATTRIBUTE_NAMES, GAME_CONFIG, personalRecords, weekReport, weekday, weekStart, type AttributeId, type GameEvent, type GameState } from '@igv/core';
import { useGame } from '../data/store';
import { updateSettings } from '../lib/actions';
import { fmtDate, fmtMoney, fmtNum } from '../lib/time';
import { Field, Sheet, toast } from './kit';
import { Icon } from './icons';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Semana a resumir: la actual si es domingo, si no la que acaba de terminar. */
export function shareWeekStart(today: string): string {
  return weekday(today) === 6 ? weekStart(today) : addDays(weekStart(today), -7);
}

function summary(state: GameState, events: GameEvent[], monday: string) {
  const r = weekReport(state, events, monday, GAME_CONFIG.gold.xpPerGold);
  const we = addDays(monday, 6);
  let income = 0;
  for (const e of events) if (!e.voidedAt && e.type === 'income.recorded' && e.localDate >= monday && e.localDate <= we) income += (e.payload as { amount: number }).amount;
  const workouts = state.body.entries.filter((e) => e.workout?.trim() && e.date >= monday && e.date <= we).length;
  const topAttr = Object.entries(r.byAttribute).sort((a, b) => b[1] - a[1])[0]?.[0] as AttributeId | undefined;
  const records = personalRecords(state).filter((x) => x.when && x.when >= monday && x.when <= we && x.value > 0 && x.id !== 'best_month' && x.id !== 'best_income_month');
  return { r, income, workouts, topAttr, records };
}

/** Texto plano del resumen (para WhatsApp o copiar). */
export function weekSummaryText(state: GameState, events: GameEvent[], monday: string): string {
  const { r, income, workouts, topAttr, records } = summary(state, events, monday);
  const diff = r.xp - r.xpPrev;
  const lines = [
    `Mi semana (${fmtDate(r.weekStart)} – ${fmtDate(r.weekEnd)})`,
    `• ${fmtNum(r.xp)} XP (${diff >= 0 ? '+' : ''}${fmtNum(diff)} vs la anterior)`,
    `• ${r.missions} misiones en ${r.activeDays} de 7 días`,
    workouts ? `• ${workouts} entrenamientos` : '',
    income ? `• Ingresos: ${fmtMoney(income, state.settings.currency)}` : '',
    r.bestDay ? `• Mejor día: ${fmtDate(r.bestDay.date)} (${fmtNum(r.bestDay.xp)} XP)` : '',
    topAttr ? `• Lo que más trabajé: ${ATTRIBUTE_NAMES[topAttr]}` : '',
    records.length ? `• Récords: ${records.map((x) => x.label.toLowerCase()).join(', ')}` : '',
    `• Racha: ${state.streak.current} días · Nivel ${state.level.level}`,
  ];
  return lines.filter(Boolean).join('\n');
}

async function weekImage(state: GameState, events: GameEvent[], monday: string): Promise<File> {
  const { r, income, workouts, topAttr, records } = summary(state, events, monday);
  const W = 1080;
  const H = 1350;
  const max = Math.max(...r.byDay, 1);
  const days = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  const bars = r.byDay
    .map((x, i) => {
      const h = Math.round((x / max) * 260);
      const bx = 90 + i * 132;
      return `<rect x="${bx}" y="${900 - h}" width="96" height="${Math.max(h, 4)}" rx="14" fill="${x === max && x > 0 ? '#e6a938' : '#3a4356'}"/><text x="${bx + 48}" y="945" fill="#9a968d" font-size="28" text-anchor="middle">${days[i]}</text>`;
    })
    .join('');
  const diff = r.xp - r.xpPrev;
  const stat = (x: number, y: number, big: string, small: string) =>
    `<text x="${x}" y="${y}" fill="#f0ece3" font-size="64" font-weight="800">${esc(big)}</text><text x="${x}" y="${y + 42}" fill="#9a968d" font-size="28">${esc(small)}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Plus Jakarta Sans, system-ui, sans-serif">
  <rect width="${W}" height="${H}" fill="#0b0d12"/>
  <text x="90" y="150" fill="#9a968d" font-size="30" letter-spacing="4">MI SEMANA</text>
  <text x="90" y="215" fill="#f0ece3" font-size="54" font-weight="800">${esc(fmtDate(r.weekStart))} – ${esc(fmtDate(r.weekEnd))}</text>
  <text x="90" y="370" fill="#e6a938" font-size="130" font-weight="900">${esc(fmtNum(r.xp))}</text>
  <text x="90" y="425" fill="${diff >= 0 ? '#38c172' : '#f46d34'}" font-size="34" font-weight="700">XP · ${diff >= 0 ? '+' : ''}${esc(fmtNum(diff))} vs la semana anterior</text>
  ${stat(90, 540, String(r.missions), 'misiones')}
  ${stat(420, 540, `${r.activeDays}/7`, 'días activos')}
  ${stat(720, 540, String(state.streak.current), 'días de racha')}
  ${bars}
  ${topAttr ? `<text x="90" y="1040" fill="#f0ece3" font-size="34">Lo que más trabajé: <tspan fill="#e6a938" font-weight="800">${esc(ATTRIBUTE_NAMES[topAttr])}</tspan></text>` : ''}
  ${workouts ? `<text x="90" y="1095" fill="#f0ece3" font-size="34">Entrenamientos: <tspan font-weight="800">${workouts}</tspan></text>` : ''}
  ${income ? `<text x="90" y="1150" fill="#f0ece3" font-size="34">Ingresos: <tspan fill="#38c172" font-weight="800">${esc(fmtMoney(income, state.settings.currency))}</tspan></text>` : ''}
  ${records.length ? `<text x="90" y="1205" fill="#f0ece3" font-size="34">Récords: <tspan fill="#e6a938" font-weight="800">${esc(records.map((x) => x.label.toLowerCase()).join(', '))}</tspan></text>` : ''}
  <text x="${W - 90}" y="${H - 50}" fill="#63605a" font-size="24" text-anchor="end">${esc(state.settings.name)} · Nivel ${state.level.level}</text>
</svg>`;
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = rej;
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.getContext('2d')!.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('sin imagen');
  return new File([blob], `mi-semana-${monday}.png`, { type: 'image/png' });
}

/** Tarjeta para compartir el resumen de la semana: imagen, o texto por WhatsApp a tu compañero de cuentas. */
export function WeekShareCard({ monday, compact = false }: { monday?: string; compact?: boolean }) {
  const { state, events } = useGame();
  const ws = monday ?? shareWeekStart(state.today);
  const partner = state.settings.partner;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const shareImage = async () => {
    setBusy(true);
    try {
      const file = await weekImage(state, events, ws);
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Mi semana', text: weekSummaryText(state, events, ws) }).catch(() => {});
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }
    } catch {
      toast('No se pudo crear la imagen', 'error');
    } finally {
      setBusy(false);
    }
  };

  const sendPartner = () => {
    if (!partner?.name) return setEditing(true);
    const text = `${partner.name}, así me fue esta semana:\n\n${weekSummaryText(state, events, ws)}`;
    const phone = (partner.phone ?? '').replace(/\D/g, '');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  return (
    <div className="card">
      {!compact && (
        <div className="card-head">
          <h2>Resumen de la semana</h2>
          <span className="tiny muted">
            {fmtDate(ws)} – {fmtDate(addDays(ws, 6))}
          </span>
        </div>
      )}
      {compact && (
        <div style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Tu semana está lista</h2>
          <div className="tiny muted">Compártela o mándasela a quien te pide cuentas.</div>
        </div>
      )}
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn sm primary" disabled={busy} onClick={shareImage}>
          <Icon name="upload" /> {busy ? 'Creando…' : 'Compartir imagen'}
        </button>
        <button className="btn sm" onClick={sendPartner}>
          <Icon name="chat" /> {partner?.name ? `Mandar a ${partner.name}` : 'Elegir compañero'}
        </button>
        {partner?.name && (
          <button className="btn sm ghost icon" aria-label="Cambiar compañero" onClick={() => setEditing(true)}>
            <Icon name="edit" />
          </button>
        )}
      </div>
      {editing && <PartnerSheet onClose={() => setEditing(false)} />}
    </div>
  );
}

function PartnerSheet({ onClose }: { onClose: () => void }) {
  const { state } = useGame();
  const [name, setName] = useState(state.settings.partner?.name ?? '');
  const [phone, setPhone] = useState(state.settings.partner?.phone ?? '');
  return (
    <Sheet
      open
      onClose={onClose}
      title="Compañero de cuentas"
      actions={
        <>
          {state.settings.partner && (
            <button
              className="btn ghost danger"
              onClick={() => {
                updateSettings(state.settings, { partner: undefined });
                onClose();
              }}
            >
              Quitar
            </button>
          )}
          <button
            className="btn primary"
            disabled={!name.trim()}
            onClick={() => {
              updateSettings(state.settings, { partner: { name: name.trim(), phone: phone.replace(/\D/g, '') || undefined } });
              onClose();
            }}
          >
            Guardar
          </button>
        </>
      }
    >
      <p className="small muted" style={{ marginTop: 0 }}>
        Alguien a quien le mandas tu resumen cada semana. Saber que alguien lo va a ver ayuda a cumplir.
      </p>
      <Field label="Nombre">
        <input className="input" value={name} placeholder="Ej. Carlos" onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="WhatsApp (opcional, con lada: 52…)">
        <input className="input" inputMode="tel" value={phone} placeholder="5215512345678" onChange={(e) => setPhone(e.target.value)} />
      </Field>
    </Sheet>
  );
}
