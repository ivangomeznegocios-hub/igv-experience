import { useMemo, useState } from 'react';
import { ATTRIBUTE_NAMES, addDays, yearReview, type AttributeId, type YearReview } from '@igv/core';
import { projectAsOf, useGame } from '../data/store';
import { fmtMoney, fmtNum } from '../lib/time';
import { PageHeader, toast } from '../ui/kit';
import { BarChart } from '../ui/charts';
import { Icon } from '../ui/icons';

const M = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

/** "Mi año en review": resumen anual para guardar o compartir (imagen o PDF). */
export default function Anual() {
  const { state, events, entities } = useGame();
  const thisYear = Number(state.today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const r = useMemo(() => {
    const end = year < thisYear ? `${year}-12-31` : state.today;
    const atEnd = year < thisYear ? projectAsOf(events, entities, end) : state;
    const atStart = projectAsOf(events, entities, addDays(`${year}-01-01`, -1));
    return yearReview(atEnd, atStart, year);
  }, [year, thisYear, state, events, entities]);
  const cur = state.settings.currency;
  const topAttr = (Object.entries(r.byAttribute) as [AttributeId, number][]).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <PageHeader
        title={`Mi ${year}`}
        eyebrow="Año en review"
        right={
          <div className="row no-print" style={{ gap: 4 }}>
            <button className="btn icon ghost" onClick={() => setYear(year - 1)} aria-label="Año anterior">
              <Icon name="left" />
            </button>
            <button className="btn icon ghost" onClick={() => setYear(year + 1)} disabled={year >= thisYear} aria-label="Año siguiente">
              <Icon name="right" />
            </button>
          </div>
        }
      />
      <div className="card hero year-hero">
        <div className="eyebrow">{state.settings.name}</div>
        <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
          <div className="stat-big num gold" style={{ fontSize: 40 }}>
            {fmtNum(r.xp)}
          </div>
          <span className="muted">XP en {year}</span>
        </div>
        <div className="small muted">
          Nivel {r.levelStart} → <b style={{ color: 'var(--text)' }}>{r.levelEnd}</b>
        </div>
      </div>
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', marginBottom: 12 }}>
        {[
          ['Misiones', fmtNum(r.missions)],
          ['Días activos', fmtNum(r.activeDays)],
          ['Mejor racha', `${r.bestStreakInYear} días`],
          ['Lecciones', fmtNum(r.lessons)],
          ['Logros', fmtNum(r.achievements.length)],
          ['Fases de jefe', fmtNum(r.bossPhases.length)],
          ['Libros/cursos', fmtNum(r.booksFinished)],
          ['Metas cumplidas', fmtNum(r.goalsCompleted)],
        ].map(([k, v]) => (
          <div key={k} className="card" style={{ marginBottom: 0 }}>
            <div className="eyebrow">{k}</div>
            <div className="stat-big num" style={{ fontSize: 22 }}>
              {v}
            </div>
          </div>
        ))}
      </div>
      <div className="card">
        <h2>XP por mes</h2>
        <BarChart data={r.byMonth.map((v, i) => ({ label: M[i], value: v }))} format={fmtNum} highlightLast={false} />
      </div>
      <div className="card">
        <h2>Lo que más hiciste</h2>
        {r.topMissions.length === 0 && <div className="small muted">Sin misiones este año.</div>}
        {r.topMissions.map((t, i) => (
          <div key={t.title} className="row between small" style={{ padding: '4px 0' }}>
            <span>
              {i + 1}. {t.title}
            </span>
            <b className="num">{t.count}×</b>
          </div>
        ))}
        {topAttr.length > 0 && (
          <p className="small" style={{ marginBottom: 0 }}>
            Tu atributo del año: <b className="violet">{ATTRIBUTE_NAMES[topAttr[0][0]]}</b> (+{fmtNum(topAttr[0][1])} XP)
          </p>
        )}
      </div>
      {(r.achievements.length > 0 || r.bossPhases.length > 0) && (
        <div className="card">
          <h2>Momentos épicos</h2>
          {[...r.bossPhases, ...r.achievements].map((h, i) => (
            <div key={i} className="item" style={{ padding: '6px 0' }}>
              <Icon name={h.source === 'boss_phase' ? 'skull' : 'trophy'} width={16} className="gold" />
              <div className="grow small">{h.label}</div>
              <span className="tiny muted">{h.date.slice(5)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="card">
        <h2>Dinero</h2>
        <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <div>
            <div className="eyebrow">Ingresos</div>
            <b className="num green">{fmtMoney(r.income, cur)}</b>
          </div>
          <div>
            <div className="eyebrow">Gastos</div>
            <b className="num red">{fmtMoney(r.expense, cur)}</b>
          </div>
          <div>
            <div className="eyebrow">Balance</div>
            <b className="num">{fmtMoney(r.income - r.expense, cur)}</b>
          </div>
        </div>
      </div>
      <div className="grid2 no-print">
        <button className="btn primary" onClick={() => downloadImage(r, state.settings.name, cur).catch(() => toast('No se pudo crear la imagen', 'error'))}>
          <Icon name="download" /> Imagen
        </button>
        <button className="btn" onClick={() => window.print()}>
          <Icon name="scroll" /> PDF / imprimir
        </button>
      </div>
    </>
  );
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Dibuja una tarjeta 1080×1350 y la descarga como PNG. */
async function downloadImage(r: YearReview, name: string, cur: string) {
  const W = 1080;
  const H = 1350;
  const max = Math.max(1, ...r.byMonth);
  const bars = r.byMonth
    .map((v, i) => {
      const h = (v / max) * 220;
      const x = 90 + i * 76;
      return `<rect x="${x}" y="${1010 - h}" width="52" height="${h}" rx="8" fill="#f4b740" opacity="${v ? 1 : 0.2}"/><text x="${x + 26}" y="1045" fill="#8b97ad" font-size="22" text-anchor="middle">${M[i]}</text>`;
    })
    .join('');
  const stats: [string, string][] = [
    ['Misiones', fmtNum(r.missions)],
    ['Días activos', fmtNum(r.activeDays)],
    ['Mejor racha', `${r.bestStreakInYear}`],
    ['Logros', fmtNum(r.achievements.length)],
    ['Libros', fmtNum(r.booksFinished)],
    ['Lecciones', fmtNum(r.lessons)],
  ];
  const cells = stats
    .map(([k, v], i) => {
      const x = 90 + (i % 3) * 310;
      const y = 470 + Math.floor(i / 3) * 170;
      return `<rect x="${x}" y="${y}" width="280" height="140" rx="24" fill="#141b28" stroke="#243049"/><text x="${x + 28}" y="${y + 50}" fill="#8b97ad" font-size="24" letter-spacing="2">${esc(k.toUpperCase())}</text><text x="${x + 28}" y="${y + 112}" fill="#e8edf6" font-size="56" font-weight="800">${esc(v)}</text>`;
    })
    .join('');
  const topAttr = (Object.entries(r.byAttribute) as [AttributeId, number][]).sort((a, b) => b[1] - a[1])[0];
  const top = r.topMissions[0];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif">
  <defs><radialGradient id="g" cx="1" cy="0" r="1.2"><stop offset="0" stop-color="#8b6cf6" stop-opacity=".45"/><stop offset=".6" stop-color="#0a0e16" stop-opacity="0"/></radialGradient></defs>
  <rect width="${W}" height="${H}" fill="#0a0e16"/><rect width="${W}" height="${H}" fill="url(#g)"/>
  <text x="90" y="130" fill="#f4b740" font-size="30" font-weight="800" letter-spacing="6">IGV EXPERIENCE</text>
  <text x="90" y="220" fill="#e8edf6" font-size="72" font-weight="850">Mi ${r.year} en review</text>
  <text x="90" y="275" fill="#8b97ad" font-size="30">${esc(name)} · nivel ${r.levelStart} → ${r.levelEnd}</text>
  <text x="90" y="400" fill="#f4b740" font-size="110" font-weight="900">${esc(fmtNum(r.xp))}</text>
  <text x="${90 + fmtNum(r.xp).length * 64 + 20}" y="400" fill="#8b97ad" font-size="36">XP</text>
  ${cells}
  <text x="90" y="${780 - 2}" fill="#8b97ad" font-size="24" letter-spacing="2">XP POR MES</text>
  ${bars}
  ${topAttr ? `<text x="90" y="1130" fill="#e8edf6" font-size="32">Atributo del año: <tspan fill="#b4a1ff" font-weight="800">${esc(ATTRIBUTE_NAMES[topAttr[0]])}</tspan></text>` : ''}
  ${top ? `<text x="90" y="1185" fill="#e8edf6" font-size="32">Lo que más hice: <tspan font-weight="800">${esc(top.title)}</tspan> (${top.count}×)</text>` : ''}
  <text x="90" y="1240" fill="#e8edf6" font-size="32">Ingresos: <tspan fill="#34d399" font-weight="800">${esc(fmtMoney(r.income, cur))}</tspan></text>
  <text x="${W - 90}" y="${H - 50}" fill="#5b6780" font-size="22" text-anchor="end">Mi vida real, jugada como un RPG</text>
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
  const file = new File([blob], `mi-${r.year}-igv.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: `Mi ${r.year} en review` }).catch(() => {});
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
