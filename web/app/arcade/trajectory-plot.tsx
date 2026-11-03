interface Frame {
  tick: number;
  x: number;
  y: number;
  lives?: number;
  dash?: boolean;
}
interface Branch {
  frames: Frame[];
  reachedTick: number | null;
  lostLife: boolean;
}
interface PlotReceipt {
  scenario: { target: { minX: number; maxX: number }; horizonTicks: number };
  original: Branch;
  candidate: Branch;
  interventionTick: number;
}

const W = 640;
const H = 220;
const PAD = { left: 46, right: 18, top: 22, bottom: 34 };
const COLORS = {
  ground: '#0b0b14',
  grid: '#262a45',
  text: '#9aa0c3',
  original: '#36e2ff',
  candidate: '#c6f432',
  target: '#c6f432',
  intervention: '#ff3dbe',
  life: '#ff5d6c',
};

/**
 * Ship x-position over the experiment horizon for both branches, with the fixed target band.
 * Inline SVG attributes only: the exported replay page renders this without the site stylesheet.
 */
export function TrajectoryPlot({ receipt }: { receipt: PlotReceipt }) {
  const original = Array.isArray(receipt.original?.frames) ? receipt.original.frames : [];
  const candidate = Array.isArray(receipt.candidate?.frames) ? receipt.candidate.frames : [];
  if (original.length === 0 && candidate.length === 0) return null;
  const horizon = receipt.scenario?.horizonTicks || 120;
  const target = receipt.scenario?.target;
  const xs = [...original, ...candidate].map((frame) => frame.x).filter(Number.isFinite);
  const targetOnField =
    target && Math.abs(target.minX) <= 30 && Math.abs(target.maxX) <= 30 ? target : null;
  let low = Math.min(-7, ...xs, targetOnField?.minX ?? 0) - 1;
  let high = Math.max(7, ...xs, targetOnField?.maxX ?? 0) + 1;
  if (high - low < 4) {
    low -= 2;
    high += 2;
  }
  const px = (tick: number) => PAD.left + (tick / horizon) * (W - PAD.left - PAD.right);
  const py = (x: number) => PAD.top + ((high - x) / (high - low)) * (H - PAD.top - PAD.bottom);
  const path = (frames: Frame[]) =>
    frames.map((frame) => `${px(frame.tick).toFixed(1)},${py(frame.x).toFixed(1)}`).join(' ');
  const dashFrames = candidate.filter((frame) => frame.dash);
  const lifeLost = (frames: Frame[]) =>
    frames.filter(
      (frame, index) =>
        index > 0 &&
        typeof frame.lives === 'number' &&
        typeof frames[index - 1].lives === 'number' &&
        frame.lives < (frames[index - 1].lives as number),
    );
  const describe = (name: string, branch: Branch) =>
    `${name} ${branch.reachedTick === null ? 'never enters the target' : `enters the target at tick ${branch.reachedTick}`}${branch.lostLife ? ' and loses a life' : ''}`;
  const summary = `Ship x-position over ${horizon} ticks. ${describe('Original', receipt.original)}. ${describe('Candidate', receipt.candidate)}.`;
  return (
    <figure className="trajectory" style={{ margin: '16px 0', maxWidth: '760px' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Ship trajectories for the original and candidate branches"
        style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
      >
        <rect x="0" y="0" width={W} height={H} rx="10" fill={COLORS.ground} />
        {[0, 0.25, 0.5, 0.75, 1].map((step) => (
          <g key={step}>
            <line
              x1={px(horizon * step)}
              x2={px(horizon * step)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke={COLORS.grid}
              strokeWidth="1"
            />
            <text
              x={px(horizon * step)}
              y={H - PAD.bottom + 16}
              fill={COLORS.text}
              fontSize="11"
              fontFamily="ui-monospace, Menlo, monospace"
              textAnchor="middle"
            >
              {Math.round(horizon * step)}
            </text>
          </g>
        ))}
        {[low + 1, 0, high - 1].map((value) => (
          <text
            key={value}
            x={PAD.left - 8}
            y={py(value) + 4}
            fill={COLORS.text}
            fontSize="11"
            fontFamily="ui-monospace, Menlo, monospace"
            textAnchor="end"
          >
            {Number(value.toFixed(1))}
          </text>
        ))}
        {targetOnField ? (
          <rect
            x={PAD.left}
            width={W - PAD.left - PAD.right}
            y={py(targetOnField.maxX)}
            height={Math.max(2, py(targetOnField.minX) - py(targetOnField.maxX))}
            fill={COLORS.target}
            fillOpacity="0.14"
            stroke={COLORS.target}
            strokeDasharray="4 4"
          />
        ) : (
          <text
            x={W - PAD.right}
            y={PAD.top - 6}
            fill={COLORS.target}
            fontSize="11"
            fontFamily="ui-monospace, Menlo, monospace"
            textAnchor="end"
          >
            target X {target?.minX}–{target?.maxX} is off the field ↑
          </text>
        )}
        {receipt.interventionTick >= 0 ? (
          <g>
            <line
              x1={px(receipt.interventionTick)}
              x2={px(receipt.interventionTick)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke={COLORS.intervention}
              strokeDasharray="3 3"
            />
            <text
              x={px(receipt.interventionTick) - 4}
              y={PAD.top + 10}
              fill={COLORS.intervention}
              fontSize="11"
              fontFamily="ui-monospace, Menlo, monospace"
              textAnchor="end"
            >
              Meta’s dash tick {receipt.interventionTick}
            </text>
          </g>
        ) : null}
        <polyline
          points={path(candidate)}
          fill="none"
          stroke={COLORS.candidate}
          strokeWidth="2.5"
        />
        <polyline
          points={path(original)}
          fill="none"
          stroke={COLORS.original}
          strokeWidth="2"
          strokeDasharray="5 4"
          strokeOpacity="0.85"
        />
        {dashFrames.map((frame, index) => (
          <rect
            key={frame.tick}
            x={px(frame.tick) - 3}
            y={py(frame.x) - 3}
            width="6"
            height="6"
            fill={index % 2 ? COLORS.original : COLORS.candidate}
            fillOpacity={0.35 + (0.65 * (index + 1)) / dashFrames.length}
          />
        ))}
        {[...lifeLost(original), ...lifeLost(candidate)].map((frame, index) => (
          <text
            key={`${frame.tick}:${index}`}
            x={px(frame.tick)}
            y={py(frame.x) + 4}
            fill={COLORS.life}
            fontSize="13"
            textAnchor="middle"
          >
            ✕
          </text>
        ))}
        <text
          x={PAD.left}
          y={14}
          fill={COLORS.text}
          fontSize="11"
          fontFamily="ui-monospace, Menlo, monospace"
        >
          ship x · tick →{'   '}
          <tspan fill={COLORS.original}>- - original</tspan>
          {'   '}
          <tspan fill={COLORS.candidate}>━ candidate</tspan>
          {'   '}
          <tspan fill={COLORS.target}>▒ target</tspan>
        </text>
      </svg>
      <figcaption style={{ fontSize: '12px', opacity: 0.8, marginTop: '6px' }}>
        {summary}
      </figcaption>
    </figure>
  );
}
