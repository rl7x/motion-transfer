import { readGenerationMode } from '../data-source';
import { useResource } from '../hooks/use-resource';
import { useTransfer } from '../transfer-context';
import { linkHref } from '../links';
import { JsonDetails } from './shared';
interface Comparison {
  passed: boolean;
  activationTicks: number[];
  lanes: {
    name: string;
    frames: { tick: number; cumulativeSourcePixels: number; pixels: number }[];
  }[];
  airborne: { transfer: { p: { y: number } }[] };
}
interface Flight {
  name: string;
  passed: boolean;
  requestedMeters: number;
  before: { y: number }[];
  after: { y: number }[];
}
export function TransferExplanation() {
  const { destination, artifact } = useTransfer(),
    car = destination?.id === 'roadster';
  const playback = readGenerationMode() === 'playback-only';
  return (
    <section className="transfer-explanation" aria-label="What changes with the transfer">
      <div>
        <p className="eyebrow">WHAT CARRIES OVER</p>
        <p id="carries-over">
          {artifact?.parentArtifactId
            ? `The same controller, with this child’s ${60 * artifact.intent.unitScale}-${car ? 'meter' : 'pixel'} ${artifact.intent.direction === 'opposite' ? 'backward' : 'forward'} dash mapping.`
            : (destination?.carries ?? 'The recovered dash.')}
        </p>
      </div>
      <div>
        <p className="eyebrow">WHAT STAYS WITH THE RECIPIENT</p>
        <p id="recipient-keeps">{destination?.keeps ?? 'Its own rules and world.'}</p>
      </div>
      <div>
        <p className="eyebrow">THE COMPONENT STAYS THE SAME</p>
        <p>Different adapters. One unchanged dash.</p>
        {playback && destination?.report ? (
          <a href={linkHref(destination.report)}>Bundled transfer report ↓</a>
        ) : (
          <a href="#comparison-details">Compare the recorded behavior ↓</a>
        )}
      </div>
    </section>
  );
}
export function Proof() {
  const { data, error } = useResource<Comparison>('/evidence/transfer-comparison.json');
  const { data: roadster } = useResource<{ passed: boolean; browser: { results: Flight[] } }>(
    '/roadster/report.json',
  );
  const { destination, artifact } = useTransfer();
  const flight = roadster?.browser.results.find(
    (item) => item.name === 'airborne-dash-retains-vertical-and-rotation',
  );
  const colors = ['#e8e2ce', '#c3ed89', '#90c7e8', '#c5a8ec'];
  const report =
    destination?.id === 'roadster'
      ? `/roadster/artifacts/${artifact?.id}/report.json`
      : artifact?.parentArtifactId
        ? `/artifacts/${artifact.id}/report.json`
        : destination?.report;
  return (
    <section className="proof-section" aria-labelledby="proof-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">EVIDENCE / BEHAVIOR THAT SURVIVES THE MOVE</p>
          <h2 id="proof-heading">Same burst. Same recharge. Different rules around it.</h2>
        </div>
      </div>
      <p className="proof-intro">
        Recorded inputs show measured movement and matching dash timing.
      </p>
      <details>
        <summary>What about the feel of the dash?</summary>
        <p>
          The donor leaves a short chain of old poses behind its moving character. Roadster
          translates that into fading car afterimages, plus a human-authored visual hold of about 50
          milliseconds before the rendered car catches up. Actual movement, gravity and component
          timers keep advancing. Reduced-motion settings disable the hold and trail. This
          presentation is separate from the frozen Meta-recovered motion component.
        </p>
        <p>
          <a href={linkHref('/roadster/presentation.json')}>
            Actual donor presentation observations ↗
          </a>
        </p>
      </details>
      <div id="trace-comparison" className="trace-comparison" aria-live="polite">
        {data?.passed ? (
          <>
            <svg
              viewBox="0 0 1000 260"
              role="img"
              aria-label="Actual dash-only travel over 100 logical updates, normalized to donor pixels. All four executions match."
            >
              <title>One frozen controller across four actual executions</title>
              {data.lanes.map((lane, index) => {
                const top = 16 + index * 57,
                  baseline = top + 36;
                return (
                  <g key={lane.name}>
                    <text
                      x={14}
                      y={top + 18}
                      fill={colors[index]}
                      fontSize={12}
                      fontFamily="monospace"
                    >
                      {lane.name}
                    </text>
                    <line x1={195} y1={baseline} x2={920} y2={baseline} stroke="#34432e" />
                    {data.activationTicks.map((tick) => (
                      <line
                        key={tick}
                        x1={195 + ((tick - 1) / 99) * 725}
                        y1={top}
                        x2={195 + ((tick - 1) / 99) * 725}
                        y2={baseline}
                        stroke="#405236"
                        strokeDasharray="2 4"
                      />
                    ))}
                    <polyline
                      points={lane.frames
                        .map(
                          (frame) =>
                            `${195 + ((frame.tick - 1) / 99) * 725},${baseline - (frame.cumulativeSourcePixels / 180) * 30}`,
                        )
                        .join(' ')}
                      fill="none"
                      stroke={colors[index]}
                      strokeWidth={2}
                    />
                    <text x={932} y={top + 18} fill={colors[index]} fontSize={11}>
                      {lane.frames.reduce((sum, f) => sum + f.pixels, 0)}px
                    </text>
                  </g>
                );
              })}
              {[1, 33, 66, 100].map((tick) => (
                <text
                  key={tick}
                  x={195 + ((tick - 1) / 99) * 725}
                  y={252}
                  fill="#a4b397"
                  fontSize={10}
                  textAnchor={tick === 100 ? 'end' : 'start'}
                >
                  {tick === 1 ? 'tick 1' : tick}
                </text>
              ))}
            </svg>
            <div className="trace-metrics">
              {[
                'Every dash: 60 → 30 recipient pixels',
                'Active: 8 updates',
                'Recharge: 25 updates',
              ].map((text) => (
                <span key={text}>{text}</span>
              ))}
            </div>
            <p className="trace-caption">
              Actual dash-only travel over 100 updates. Curves use donor-equivalent units; totals at
              right use each game&apos;s own pixels. Dashed lines mark activation. Controlled
              free-space fixtures; see scope below.
            </p>
          </>
        ) : (
          (error ?? 'Loading the measured comparison…')
        )}
        {roadster?.passed && flight?.passed && (
          <div className="airborne-result">
            <h3>The same controller in a different runtime</h3>
            <p>
              Roadster: {Math.abs(flight.requestedMeters)} meters requested over eight active
              updates. Matched free-flight traces have maximum vertical-position difference{' '}
              {Math.max(
                ...flight.after.map((point, i) => Math.abs(point.y - flight.before[i].y)),
              ).toExponential(1)}{' '}
              meters. Native gravity and rotation continue. The simulation runs at 240 Hz; the
              unchanged controller runs at 60 Hz.
            </p>
            <JsonDetails label="Actual before/after positions and event ticks" value={flight} />
          </div>
        )}
      </div>
      <details id="comparison-details">
        <summary>How to read this comparison</summary>
        <p>
          Controlled free-space inputs hold dash from tick 11. The graphs count dash travel only,
          excluding ordinary movement. Recipient distances are divided by their documented 0.5 scale
          so timing and displacement can be compared in donor units. Position fixtures keep the
          recipients alive; collisions and ordinary play have separate checks.
        </p>
        <div id="airborne-comparison">
          {data && (
            <p className="airborne-result">
              Gravity stays with JUJUMP: during the same eight updates, the dash moves 30 horizontal
              pixels while ordinary motion moves 8. Both fall from screen y=
              {data.airborne.transfer[0].p.y.toFixed(2)} to y=
              {data.airborne.transfer.at(-1)!.p.y.toFixed(2)} with matching vertical velocity.
              Camera scrolling is retained. These are matched open-air fixtures; platform landing is
              tested separately.
            </p>
          )}
        </div>
        <p>
          <a href={linkHref('/evidence/transfer-comparison.json')}>
            Download the actual comparison traces ↗
          </a>{' '}
          ·{' '}
          <a id="artifact-checks" href={linkHref(report)}>
            Current destination report ↗
          </a>
        </p>
      </details>
    </section>
  );
}
