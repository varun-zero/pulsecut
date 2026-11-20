import React, { useId, useMemo } from 'react';
import type { MonitorRatePoint } from '../types';
import { buildSpikeGraphGeometry } from '../lib/liveMonitor';

interface LiveSpikeGraphProps {
  history: readonly MonitorRatePoint[];
  accentColor?: string;
  spiking?: boolean;
  height?: number;
  channelLabel?: string;
}

export function LiveSpikeGraph({
  history,
  accentColor = '#38BDF8',
  spiking = false,
  height = 128,
  channelLabel = 'stream',
}: LiveSpikeGraphProps) {
  const gradientId = useId();
  const width = 460;

  const geom = useMemo(
    () => buildSpikeGraphGeometry(history, width, height),
    [history, height]
  );

  const strokeColor = spiking ? '#53FC18' : accentColor;

  return (
    <div
      data-testid="live-spike-graph"
      className="rounded-lg border border-[var(--pc-border)] bg-[var(--pc-surface-2)]/70 p-2.5"
    >
      <div className="flex items-center justify-between gap-2 mb-1.5 text-[10.5px] font-mono-tabular text-[var(--pc-muted)]">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="w-2.5 h-[2px] rounded-full inline-block"
              style={{ backgroundColor: strokeColor }}
            />
            <span className="text-[var(--pc-sub)]">Live msg/s</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 border-t border-dashed border-[var(--pc-muted)] inline-block" />
            <span>Learned baseline</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#53FC18] inline-block" />
            <span>Clip fired</span>
          </span>
        </div>
        <span>
          {geom.hasData ? `Peak ${geom.peakRate}/s · ${history.length}s window` : 'Awaiting live chat'}
        </span>
      </div>

      <svg
        role="img"
        aria-label={`Live chat spike graph for ${channelLabel}`}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full block overflow-visible"
        style={{ height }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.28" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Horizontal reference gridlines & Y ticks */}
        {geom.yTicks.map((tick) => (
          <g key={tick.value}>
            <line
              x1={32}
              x2={width - 10}
              y1={tick.y}
              y2={tick.y}
              stroke="var(--pc-border-subtle)"
              strokeWidth="1"
            />
            <text
              x={26}
              y={tick.y + 3}
              textAnchor="end"
              fill="var(--pc-muted)"
              fontSize="9.5"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              {tick.label}
            </text>
          </g>
        ))}

        {geom.hasData ? (
          <>
            {/* Filled live velocity area */}
            <path d={geom.areaPath} fill={`url(#${gradientId})`} />

            {/* Learned rolling baseline (dashed) */}
            <polyline
              fill="none"
              stroke="var(--pc-muted)"
              strokeDasharray="4 3"
              strokeWidth="1.5"
              points={geom.baselinePoints}
            />

            {/* Live chat velocity line */}
            <polyline
              fill="none"
              stroke={strokeColor}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={geom.ratePoints}
            />

            {/* Triggered clip spike markers */}
            {geom.markers.map((marker, idx) => (
              <g key={`${marker.tsMs}-${idx}`}>
                <circle
                  cx={marker.x}
                  cy={marker.y}
                  r="6"
                  fill="#53FC18"
                  fillOpacity="0.22"
                />
                <circle
                  cx={marker.x}
                  cy={marker.y}
                  r="3.5"
                  fill="#53FC18"
                  stroke="#09090B"
                  strokeWidth="1.25"
                />
              </g>
            ))}
          </>
        ) : (
          <text
            x={(width + 22) / 2}
            y={height / 2 + 2}
            textAnchor="middle"
            fill="var(--pc-muted)"
            fontSize="11"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            Connecting to chat feed — real-time msg/s curve plots automatically
          </text>
        )}
      </svg>
    </div>
  );
}
