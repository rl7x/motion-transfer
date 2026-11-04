import { MetaChip } from './meta-chip';
import { PixelSprite } from './pixel-sprite';
import type { SpriteMood, SpriteName } from './pixel-sprite';

export interface JobEvent {
  status: string;
  at: string;
}
interface TrackJob {
  status: string;
  events?: JobEvent[] | null;
  createdAt: string;
  finishedAt: string | null;
  error?: string | null;
}

type StationId = 'queued' | 'reconstructing' | 'spark' | 'verify' | 'publish';
export type StationState = 'todo' | 'active' | 'done' | 'failed';
export interface Station {
  id: StationId;
  label: string;
  detail: string;
  sprite: SpriteName;
  state: StationState;
  ms: number;
  visits: number;
}

const STATION_OF: Record<string, StationId> = {
  queued: 'queued',
  reconstructing: 'reconstructing',
  pending: 'spark',
  repairing: 'spark',
  responded: 'spark',
  verifying: 'verify',
  publishing: 'publish',
};
const FAILED = new Set(['failed', 'unsupported', 'cancelled', 'unsuccessful']);
const TERMINAL = new Set(['ready', ...FAILED]);

/**
 * Turn the coordinator's `{status, at}` events into pipeline stations with measured durations.
 * Without events (older jobs or fixtures) the current status alone places the active station.
 */
export function stationsFromEvents(job: TrackJob, experiment: boolean, now: number): Station[] {
  const order: StationId[] = experiment
    ? ['queued', 'reconstructing', 'spark', 'verify', 'publish']
    : ['queued', 'spark', 'verify', 'publish'];
  const ms = new Map<StationId, number>();
  const visits = new Map<StationId, number>();
  const events =
    job.events && job.events.length > 0
      ? job.events.filter((event) => event.status !== 'cancel-requested')
      : [{ status: job.status, at: job.createdAt }];
  const end = Date.parse(job.finishedAt ?? '') || now;
  let last: StationId | null = null;
  events.forEach((event, index) => {
    const station = STATION_OF[event.status];
    if (!station) return;
    const start = Date.parse(event.at);
    const stop = Date.parse(events[index + 1]?.at ?? '') || end;
    if (Number.isFinite(start)) ms.set(station, (ms.get(station) ?? 0) + Math.max(0, stop - start));
    if (event.status !== 'responded') visits.set(station, (visits.get(station) ?? 0) + 1);
    last = station;
  });
  const terminal = TERMINAL.has(job.status);
  const current = STATION_OF[job.status] ?? last ?? 'queued';
  const reached = order.indexOf(current);
  const repairs = Math.max(0, (visits.get('spark') ?? 0) - 1);
  return order.map((id, index) => {
    let state: StationState = index < reached ? 'done' : index === reached ? 'active' : 'todo';
    if (terminal) {
      if (job.status === 'ready') state = 'done';
      else if (job.status === 'unsuccessful') state = id === 'verify' ? 'failed' : 'done';
      else state = index < reached ? 'done' : index === reached ? 'failed' : 'todo';
    }
    const base = {
      id,
      state,
      ms: ms.get(id) ?? 0,
      visits: visits.get(id) ?? 0,
    };
    switch (id) {
      case 'queued':
        return {
          ...base,
          label: 'Admitted',
          detail: 'One job at a time · spend reserved',
          sprite: 'courier' as const,
        };
      case 'reconstructing':
        return {
          ...base,
          label: 'Rebuild checkpoint',
          detail: 'Replay the frozen moment in the worker',
          sprite: 'sandbox' as const,
        };
      case 'spark':
        return {
          ...base,
          label: repairs > 0 ? `Muse Spark · repair ×${repairs}` : 'Muse Spark writes',
          detail:
            repairs > 0
              ? 'Rewrote the adapter from verifier feedback'
              : 'Adapter source, mapping and summary in one tool call',
          sprite: 'spark' as const,
        };
      case 'verify':
        return {
          ...base,
          label: 'Sandbox verifies',
          detail: 'Native sim · swept collisions · exact frame',
          sprite: 'verifier' as const,
        };
      default:
        return {
          ...base,
          label: 'Saved to the library',
          detail: 'Immutable, replayable without inference',
          sprite: 'librarian' as const,
        };
    }
  });
}

const seconds = (ms: number) => (ms / 1000).toFixed(1) + ' s';

function moodOf(station: Station, status: string): SpriteMood | undefined {
  if (station.state === 'failed') return 'droop';
  if (status === 'ready' && station.id === 'publish') return 'victory';
  return undefined;
}

export function PipelineTrack({
  job,
  experiment,
  now,
}: {
  job: TrackJob;
  experiment: boolean;
  now: number;
}) {
  const stations = stationsFromEvents(job, experiment, now);
  const failed = FAILED.has(job.status);
  return (
    <div className="track">
      <ol className="track__stations">
        {stations.map((station) => (
          <li key={station.id} className={`track__station is-${station.state}`}>
            <span className="track__sprite">
              <PixelSprite
                name={station.sprite}
                size={44}
                working={station.state === 'active'}
                still={station.state === 'todo'}
                mood={moodOf(station, job.status)}
              />
            </span>
            <span className="track__label">
              {station.id === 'spark' ? <MetaChip /> : null}
              <strong>{station.label}</strong>
              <small>{station.detail}</small>
            </span>
            <span className="track__time">
              {station.state === 'todo' ? '—' : seconds(station.ms)}
            </span>
          </li>
        ))}
      </ol>
      {failed ? (
        <p className="track__outcome is-failed">
          {job.status === 'unsuccessful'
            ? 'Goal unsatisfied. The comparison is saved as a diagnostic.'
            : 'Stopped before a new version.'}{' '}
          Parent kept — nothing lost.
        </p>
      ) : job.status === 'ready' ? (
        <p className="track__outcome is-ready">Verified and saved. It is playable now.</p>
      ) : null}
    </div>
  );
}
