import type { ReactNode } from 'react';

/** Gráficas SVG mínimas, con los colores del tema. */

export function BarChart({
  data,
  height = 140,
  color = 'var(--gold)',
  format = (n: number) => String(Math.round(n)),
  highlightLast = true,
}: {
  data: { label: string; value: number; value2?: number }[];
  height?: number;
  color?: string;
  format?: (n: number) => string;
  highlightLast?: boolean;
}) {
  const W = 320;
  const H = height;
  const pad = { t: 14, b: 18, l: 4, r: 4 };
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.value2 ?? 0)));
  const n = data.length || 1;
  const slot = (W - pad.l - pad.r) / n;
  const two = data.some((d) => d.value2 !== undefined);
  const bw = Math.max(2, slot * (two ? 0.36 : 0.66));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const labelEvery = Math.ceil(n / 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img">
      <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--line)" />
      {data.map((d, i) => {
        const x = pad.l + i * slot + (slot - (two ? bw * 2 + 2 : bw)) / 2;
        const last = highlightLast && i === n - 1;
        return (
          <g key={i}>
            <rect x={x} y={y(d.value)} width={bw} height={Math.max(0, H - pad.b - y(d.value))} rx={2} fill={color} opacity={last ? 1 : 0.7}>
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </rect>
            {two && (
              <rect x={x + bw + 2} y={y(d.value2 ?? 0)} width={bw} height={Math.max(0, H - pad.b - y(d.value2 ?? 0))} rx={2} fill="var(--red)" opacity={0.75}>
                <title>{`${d.label}: ${format(d.value2 ?? 0)}`}</title>
              </rect>
            )}
            {i % labelEvery === 0 && (
              <text x={pad.l + i * slot + slot / 2} y={H - 5} textAnchor="middle" className="chart-lbl">
                {d.label}
              </text>
            )}
          </g>
        );
      })}
      <text x={W - pad.r} y={10} textAnchor="end" className="chart-lbl">
        máx {format(max)}
      </text>
    </svg>
  );
}

export function LineChart({ points, height = 130, color = 'var(--teal)', format = (n: number) => n.toFixed(1) }: { points: { label: string; value: number }[]; height?: number; color?: string; format?: (n: number) => string }) {
  const W = 320;
  const H = height;
  const pad = { t: 14, b: 18, l: 6, r: 6 };
  if (points.length < 2) return <div className="small muted">Registra al menos dos datos para ver la gráfica.</div>;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / (points.length - 1);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - min) / span);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img">
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.value)} r={2.5} fill={color}>
          <title>{`${p.label}: ${format(p.value)}`}</title>
        </circle>
      ))}
      <text x={pad.l} y={10} className="chart-lbl">
        {format(max)}
      </text>
      <text x={pad.l} y={H - 5} className="chart-lbl">
        {points[0].label}
      </text>
      <text x={W - pad.r} y={H - 5} textAnchor="end" className="chart-lbl">
        {points.at(-1)!.label} · {format(points.at(-1)!.value)}
      </text>
    </svg>
  );
}

export function Radar({ axes, series, max = 100 }: { axes: string[]; series: { values: number[]; color: string; label: ReactNode }[]; max?: number }) {
  const S = 260;
  const c = S / 2;
  const R = c - 46;
  const pt = (i: number, v: number) => {
    const a = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
    return [c + Math.cos(a) * R * (v / max), c + Math.sin(a) * R * (v / max)];
  };
  return (
    <>
      <svg viewBox={`0 0 ${S} ${S}`} className="chart radar" role="img">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <polygon key={f} points={axes.map((_, i) => pt(i, max * f).join(',')).join(' ')} fill="none" stroke="var(--line)" />
        ))}
        {axes.map((a, i) => {
          const [x, y] = pt(i, max * 1.18);
          const [lx, ly] = pt(i, max);
          return (
            <g key={a}>
              <line x1={c} y1={c} x2={lx} y2={ly} stroke="var(--line)" />
              <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="chart-lbl">
                {a}
              </text>
            </g>
          );
        })}
        {series.map((s, k) => (
          <polygon key={k} points={s.values.map((v, i) => pt(i, v).join(',')).join(' ')} fill={s.color} fillOpacity={k === series.length - 1 ? 0.28 : 0.1} stroke={s.color} strokeWidth={2} />
        ))}
      </svg>
      <div className="legend" style={{ justifyContent: 'center' }}>
        {series.map((s, k) => (
          <span key={k}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </>
  );
}
