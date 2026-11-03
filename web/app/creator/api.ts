import type {
  Catalog,
  CatalogVersion,
  RemixIntent,
  RemixJob,
  RemixUrls,
  ServiceStatus,
} from './types';

export class CreatorRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'CreatorRequestError';
    this.status = status;
  }
}

function localPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//'))
    return undefined;
  if (value.includes('://') || value.includes('\\')) return undefined;
  return value;
}

function intent(value: unknown): RemixIntent | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.unitScale !== 'number' || !Number.isFinite(record.unitScale)) return null;
  if (typeof record.activation !== 'string' || !record.activation) return null;
  if (typeof record.direction !== 'string' || !record.direction) return null;
  return {
    unitScale: record.unitScale,
    activation: record.activation,
    direction: record.direction,
  };
}

function version(value: unknown, fallbackPlay: string | undefined): CatalogVersion | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || !/^[a-f0-9]{64}$/.test(record.id)) return null;
  const play = localPath(record.play) ?? fallbackPlay;
  if (!play) return null;
  const controls =
    record.controls === 'challenge' || record.controls === 'native' ? record.controls : null;
  const chain = Array.isArray(record.parentChain)
    ? record.parentChain.filter((item): item is string => typeof item === 'string')
    : null;
  return {
    id: record.id,
    play,
    download: localPath(record.download),
    intent: intent(record.intent),
    summary: typeof record.summary === 'string' ? record.summary : null,
    parentArtifactId: typeof record.parentArtifactId === 'string' ? record.parentArtifactId : null,
    parentChain: chain,
    controls,
    source: localPath(record.source),
    adapter: localPath(record.adapter),
    report: localPath(record.report),
    notices: localPath(record.notices),
  };
}

function urls(value: unknown): RemixUrls | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const next: RemixUrls = {};
  for (const key of [
    'play',
    'download',
    'parent',
    'parentDownload',
    'receipt',
    'adapter',
    'source',
    'report',
    'notices',
  ] as const) {
    const path = localPath(record[key]);
    if (path) next[key] = path;
  }
  return next;
}

export function parseCatalog(value: unknown): Catalog {
  if (!value || typeof value !== 'object')
    throw new CreatorRequestError(502, 'Catalog response was unreadable');
  const record = value as Record<string, unknown>;
  const parents = Array.isArray(record.parents)
    ? record.parents.flatMap((item) => {
        const parsed = version(item, undefined);
        return parsed ? [parsed] : [];
      })
    : [];
  const artifacts = Array.isArray(record.artifacts)
    ? record.artifacts.flatMap((item) => {
        const recordItem = item as Record<string, unknown> | null;
        const parsed = version(item, localPath(recordItem?.play));
        return parsed ? [parsed] : [];
      })
    : [];
  return {
    playback: record.playback === true,
    generationConfigured: record.generationConfigured === true,
    model: typeof record.model === 'string' ? record.model : null,
    parents,
    artifacts,
  };
}

export function parseStatus(value: unknown): ServiceStatus {
  if (!value || typeof value !== 'object') return { generationConfigured: false };
  return {
    generationConfigured:
      (value as { generationConfigured?: unknown }).generationConfigured === true,
  };
}

export function parseJob(value: unknown): RemixJob {
  if (!value || typeof value !== 'object')
    throw new CreatorRequestError(502, 'Remix response was unreadable');
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.status !== 'string') {
    throw new CreatorRequestError(502, 'Remix response was missing its id');
  }
  const chain = Array.isArray(record.parentChain)
    ? record.parentChain.filter((item): item is string => typeof item === 'string')
    : null;
  return {
    id: record.id,
    status: record.status,
    parentArtifactId: typeof record.parentArtifactId === 'string' ? record.parentArtifactId : '',
    artifactId: typeof record.artifactId === 'string' ? record.artifactId : null,
    parentChain: chain,
    error: typeof record.error === 'string' ? record.error : null,
    urls: urls(record.urls),
    intent: intent(record.intent),
    summary: typeof record.summary === 'string' ? record.summary : null,
    events: Array.isArray(record.events)
      ? record.events.filter(
          (event): event is { status: string; at: string } =>
            Boolean(event) &&
            typeof (event as { status?: unknown }).status === 'string' &&
            typeof (event as { at?: unknown }).at === 'string',
        )
      : undefined,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined,
    finishedAt: typeof record.finishedAt === 'string' ? record.finishedAt : null,
  };
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error.trim()) return body.error;
  } catch {
    /* The status line is the fallback. */
  }
  return `The service returned ${response.status}`;
}

async function requestJson(
  path: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, signal, cache: 'no-store' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new CreatorRequestError(0, 'The service could not be reached');
  }
  if (!response.ok) throw new CreatorRequestError(response.status, await readError(response));
  try {
    return await response.json();
  } catch {
    throw new CreatorRequestError(502, 'The service returned an unreadable response');
  }
}

export async function loadCatalog(signal?: AbortSignal): Promise<Catalog> {
  return parseCatalog(await requestJson('/api/catalog', { method: 'GET' }, signal));
}

export async function loadStatus(signal?: AbortSignal): Promise<ServiceStatus> {
  return parseStatus(await requestJson('/api/remixes/status', { method: 'GET' }, signal));
}

export async function loadJob(id: string, signal?: AbortSignal): Promise<RemixJob> {
  return parseJob(await requestJson(`/api/remixes/${id}`, { method: 'GET' }, signal));
}

export async function submitRemix(
  input: {
    invite: string;
    sessionId: string;
    idempotencyKey: string;
    parentArtifactId: string;
    prompt: string;
  },
  signal?: AbortSignal,
): Promise<RemixJob> {
  return parseJob(
    await requestJson(
      '/api/remixes',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-invite-code': input.invite,
        },
        body: JSON.stringify({
          adultConfirmed: true,
          idempotencyKey: input.idempotencyKey,
          parentArtifactId: input.parentArtifactId,
          prompt: input.prompt,
          sessionId: input.sessionId,
        }),
      },
      signal,
    ),
  );
}

export function playableAddress(path: string | undefined): string | null {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return null;
  return new URL(path, window.location.origin).href;
}
