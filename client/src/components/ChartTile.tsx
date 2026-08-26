import { useEffect, useRef, useState } from 'react';
import type { ChartTile } from '../lib/types';
import type { LiveMeta } from '../ws';
import { getNumericValue, renderLabel } from '../lib/labelTemplate';

/**
 * Chart tile — no tap, no long-press; renders a sparkline of one numeric
 * LiveMeta value over a rolling window.
 *
 * Sampling: an internal 1 Hz tick reads the latest LiveMeta value; buffer
 * caps at ~90 samples (~90 s of history). Delta mode subtracts each sample
 * from the previous — the raw counter for `obs.droppedFrames` monotonically
 * climbs and doesn't chart, but its delta lights up whenever drops are
 * actually happening right now.
 *
 * Auto-scale: y-axis fits min→max across the current window unless the
 * tile config pins them (delta mode also floors at 0 so tiny noise around
 * zero doesn't fake-inflate the visible range).
 */

const CAPACITY = 90;
const TICK_MS = 1000;

export function ChartTileView({ tile, liveMeta, colorFallback }: {
  tile: ChartTile;
  liveMeta: LiveMeta;
  /** Accent color used when the tile doesn't override it. */
  colorFallback: string;
}) {
  const [samples, setSamples] = useState<number[]>([]);
  // A ref keeps the "last liveMeta" always fresh in the interval callback
  // without restarting the timer on every meta change.
  const metaRef = useRef(liveMeta);
  metaRef.current = liveMeta;
  const prevRawRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    // Reset buffer when the source or mode changes — old samples are
    // apples-to-oranges relative to the new source. Also reset the delta
    // baseline so the first post-swap sample doesn't spike.
    setSamples([]);
    prevRawRef.current = undefined;
  }, [tile.source, tile.mode]);

  useEffect(() => {
    const step = () => {
      const raw = getNumericValue(tile.source, metaRef.current);
      if (raw === undefined) {
        // No value right now — skip the sample rather than pad with 0.
        // Users can tell "nothing playing" (flat empty chart) from
        // "value is currently zero" (a real zero sample in the trace).
        return;
      }
      let value: number;
      if (tile.mode === 'delta') {
        if (prevRawRef.current === undefined) {
          prevRawRef.current = raw;
          return; // first delta sample is a baseline, not a data point
        }
        value = Math.max(0, raw - prevRawRef.current);
        prevRawRef.current = raw;
      } else {
        value = raw;
      }
      setSamples((prev) => (prev.length >= CAPACITY ? [...prev.slice(1), value] : [...prev, value]));
    };
    step();
    const id = setInterval(step, TICK_MS);
    return () => clearInterval(id);
  }, [tile.source, tile.mode]);

  const label = renderLabel(tile.label, liveMeta);
  const stroke = tile.color || tile.accentColor || colorFallback;
  const current = samples.length > 0 ? samples[samples.length - 1] : undefined;

  return (
    <div
      style={{
        background: '#0a0a0a',
        border: `1px solid ${tile.accentColor ?? '#2a2a2a'}`,
        borderRadius: 16,
        padding: 10,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minHeight: 96,
        color: '#fff',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
        <span
          style={{
            fontSize: 13,
            color: '#e5e7eb',
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {label}
        </span>
        {current !== undefined && (
          <span style={{ fontSize: 16, color: stroke, fontWeight: 700, whiteSpace: 'nowrap' }}>
            {formatValue(current)}
          </span>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 40 }}>
        <Sparkline
          values={samples}
          stroke={stroke}
          min={tile.min}
          max={tile.max}
          deltaFloorZero={tile.mode === 'delta'}
        />
      </div>
    </div>
  );
}

function Sparkline({ values, stroke, min, max, deltaFloorZero }: {
  values: number[];
  stroke: string;
  min?: number;
  max?: number;
  deltaFloorZero: boolean;
}) {
  // Draw in a fixed normalized coordinate space; the SVG scales via
  // preserveAspectRatio="none" to whatever cell size the grid gives us.
  const VW = 100;
  const VH = 30;
  const baseline = (
    <line x1={0} y1={VH - 0.5} x2={VW} y2={VH - 0.5} stroke="#1f2937" strokeWidth={0.5} />
  );
  if (values.length < 2) {
    return (
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        style={{ display: 'block' }}
      >
        {baseline}
      </svg>
    );
  }
  let lo = min !== undefined ? min : Math.min(...values);
  let hi = max !== undefined ? max : Math.max(...values);
  if (deltaFloorZero && min === undefined) lo = Math.min(0, lo);
  if (hi === lo) hi = lo + 1;
  const range = hi - lo;
  const stepX = VW / (CAPACITY - 1);
  const offset = (CAPACITY - values.length) * stepX;
  const points = values
    .map((v, i) => {
      const x = offset + i * stepX;
      const y = VH - 1 - ((v - lo) / range) * (VH - 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  const lastX = offset + (values.length - 1) * stepX;
  const lastY = VH - 1 - ((values[values.length - 1] - lo) / range) * (VH - 2);
  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      style={{ display: 'block' }}
    >
      {baseline}
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.2}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r={1.4} fill={stroke} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function formatValue(v: number): string {
  if (!Number.isFinite(v)) return '';
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(0);
  if (Math.abs(v) >= 1) return v.toFixed(1);
  return v.toFixed(2);
}
