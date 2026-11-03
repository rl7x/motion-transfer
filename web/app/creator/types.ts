export interface RemixIntent {
  unitScale: number;
  activation: string;
  direction: string;
}

export interface RemixUrls {
  play?: string;
  download?: string;
  parent?: string;
  parentDownload?: string;
  receipt?: string;
  adapter?: string;
  source?: string;
  report?: string;
  notices?: string;
}

export interface CatalogVersion {
  id: string;
  play: string;
  download?: string;
  intent: RemixIntent | null;
  summary: string | null;
  parentArtifactId: string | null;
  parentChain: string[] | null;
  controls: 'challenge' | 'native' | null;
  source?: string;
  adapter?: string;
  report?: string;
  notices?: string;
}

export interface Catalog {
  playback: boolean;
  generationConfigured: boolean;
  model: string | null;
  parents: CatalogVersion[];
  artifacts: CatalogVersion[];
}

export interface ServiceStatus {
  generationConfigured: boolean;
}

export interface RemixJob {
  id: string;
  status: string;
  parentArtifactId: string;
  artifactId: string | null;
  parentChain: string[] | null;
  error: string | null;
  urls: RemixUrls | null;
  intent: RemixIntent | null;
  summary: string | null;
}

export interface PendingRemix {
  experiment?: unknown;
  composition?: 'dash-end-shot' | 'none' | null;
  idempotencyKey: string;
  parentArtifactId: string;
  prompt: string;
  jobId: string | null;
}

export interface CreatorSession {
  sessionId: string;
  invite: string;
  adult: boolean;
  pending: PendingRemix | null;
}
