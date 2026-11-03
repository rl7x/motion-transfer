export type DestinationId = 'roadster' | 'paku-paku' | 'jujump';
export interface Intent {
  unitScale: number;
  activation: 'held' | 'press';
  direction: 'facing' | 'opposite';
}
export interface Artifact {
  id: string;
  componentId: string;
  parentArtifactId?: string | null;
  intent: Intent;
  summary?: string;
  conformanceChecks: number;
  browserChecks: number;
  model?: string;
  estimatedCostUsd?: number;
  estimatedGenerationCostUsd?: number;
}
export interface Destination {
  id: DestinationId;
  name: string;
  kind: string;
  componentId: string;
  before: string;
  after: string;
  artifactId: string;
  aspect: number;
  keeps: string;
  carries: string;
  control: string;
  action: string;
  dashKey?: string;
  liveEdits: string[];
  report: string;
  source: string;
  author: string;
}
export interface Ability {
  id: string;
  name: string;
}
export interface Budget {
  limitUsd: number;
  spentUsd: number;
  reservedUsd: number;
  remainingUsd: number;
}
export interface ServiceStatus {
  enabled: boolean;
  activeRunId: string | null;
  budget: Budget | null;
  unsettled?: boolean;
}
export interface MotionState {
  core?: { cooldown: number; remaining?: number };
  state?: { core?: { cooldown: number } };
  output?: { ownsMotion: boolean; events: string[] };
  dashHeld?: boolean;
}
export interface PlayerSnapshot {
  status: string;
  isReplaying?: boolean;
  motion?: MotionState;
}
export interface RoadsterSnapshot {
  car: {
    mode: string;
    airTime: number;
    heightAboveGround: number;
    position: { x: number; y: number; z: number };
  };
  motion: { output: { ownsMotion: boolean; events: string[] } };
}
export type PlayerWindow = Window & {
  KeyboardEvent: typeof KeyboardEvent;
  pakuReady?: boolean;
  jujumpReady?: boolean;
  roadsterReady?: boolean;
  pakuSnapshot?: () => PlayerSnapshot;
  jujumpSnapshot?: () => PlayerSnapshot;
  roadsterStart?: () => void;
  roadsterGuideStart: () => void;
  roadsterGuideRecord: (count: number) => { controls: unknown; state: RoadsterSnapshot };
  __game?: { realtime: (visible: boolean) => void };
};
export interface GuidedState {
  phase: string;
  activeUpdates?: number;
  measuredMeters?: number;
  trace?: unknown[];
  error?: string;
}
export type GenerationMode = 'local' | 'public-standard' | 'playback-only';
/** Static playback injects GET payloads here. Missing keys still use the network. */
export interface MotionDataSource {
  generation?: GenerationMode;
  publicOrigin?: string | null;
  basePath?: string;
  /** `saved` for the default playback copy. `accepted` only after a validated accepted-roadster delivery. */
  recovery?: 'saved' | 'accepted';
  /** Root-absolute path of the standalone JUJUMP comparison, when this copy bundles it. */
  jujumpComparison?: string;
  resources?: Record<string, unknown>;
}
declare global {
  interface Window {
    __MOTION_TRANSFER__?: MotionDataSource;
    currentDestination?: DestinationId;
    currentArtifact?: Artifact | null;
    currentRoadsterArtifact?: Artifact | null;
    savedRoadsterId?: string;
    selectDestination?: (id: DestinationId) => Promise<void>;
    openRoadsterArtifact?: (id: string) => Promise<void>;
    guidedRunning?: boolean;
    guidedState?: GuidedState;
  }
}
export interface JobEvent {
  sequence?: number;
  status: string;
  at?: string;
}
export interface Job<T = InvestigationReport> {
  id: string;
  status: string;
  origin?: string;
  error?: string | null;
  report?: T;
  events: JobEvent[];
  artifactId?: string;
  task?: RecoveryTask;
}
export interface RecoveryTask {
  request: string;
  status: string;
  origin: 'meta' | 'local-verification';
  sessionId: string | null;
  candidateId: string | null;
  milestones: { id: string; label: string; complete: boolean }[];
  development?: {
    attempt: number;
    passed: boolean;
    checks: number;
    passedChecks: number;
    error: string | null;
    firstFailure: {
      name: string;
      tick: number;
      buttons: number;
      expected: DevelopmentObservation;
      actual: DevelopmentObservation;
    } | null;
  }[];
  integration: {
    id: string;
    componentId: string;
    packageId: string;
    archiveBytes: number;
    fileCount: number;
  } | null;
  measurements: {
    modelRequests: number;
    estimatedCostUsd: number;
    reservedCostUsd: number;
    recoveryElapsedMs: number | null;
    taskElapsedMs: number | null;
    developmentAttempts: number;
    acceptanceTraces: number;
    acceptanceUpdates: number;
    humanElapsedMinutes: number | null;
    manualTimeSavedMinutes: number | null;
  };
  humanAssistance: string[];
  assistanceScope: string;
  error: string | null;
}
export interface DevelopmentObservation {
  position: { x: number; y: number };
  ownsMotion: boolean;
  events: string[];
  timers?: { cooldown: number; remaining: number };
}
export interface NormalizedMotion {
  dx: number;
  dy: number;
  cooldown: number;
  remaining: number;
  events: string[];
}
export interface MemoryEdit {
  address: number;
  type: string;
  previousValue: number | string;
  newValue: number | string;
  frame?: number;
  hypothesis?: string;
}
export interface Capture {
  evidenceId: string;
  branchId: string;
  frame: number;
  dataUrl: string;
  reason?: string;
  stage?: string;
}
export interface Measurement {
  checkpoint?: string;
  observationId?: string;
  frame: number;
  motion?: { position: { x: number; y: number }; remaining: number; cooldown: number };
}
export interface ToolCall {
  callId: string;
  name: string;
  ok: boolean;
  error?: string;
  experimentId?: string;
  args?: Record<string, unknown> & {
    hypothesis?: string;
    claim?: string;
    functionIndex?: number;
    startLine?: number;
  };
  result?: Measurement & {
    checkpoints?: Measurement[];
    checkpointId?: string;
    evidenceId?: string;
    observationId?: string;
  };
}
export interface ProgramOperation {
  index: number;
  name: string;
  status: string;
  error?: string;
  result?: { experimentId?: string; artifactRef?: { id: string }; checkpointId?: string };
}
export interface ExperimentProgram {
  id: string;
  artifactId?: string;
  status: string;
  hypothesis: string;
  source: string;
  sourceSha256: string;
  language: string;
  error?: string;
  operations: ProgramOperation[];
}
export interface Branch {
  id: string;
  experimental: boolean;
  parentCheckpointId?: string;
  verification: { frame: number; memoryHash: string };
  actions: {
    kind: string;
    edits?: MemoryEdit[];
    address?: number;
    type?: string;
    previousValue?: number | string;
    newValue?: number | string;
    frame?: number;
    hypothesis?: string;
  }[];
}
export interface Finding {
  id: string;
  status: string;
  confidence: string;
  claim?: string;
  hypothesis?: string;
  inferredName?: string;
  functionIndex?: number;
  evidenceIds: string[];
}
export interface Comparison {
  comparisonId: string;
  controlBranchId: string;
  experimentalBranchId: string;
  hypothesis: string;
  scope?: string;
  firstBehaviorDivergence?: { elapsedFrame: number };
  normalizedTrace: {
    elapsedFrame: number;
    control: NormalizedMotion | null;
    experimental: NormalizedMotion | null;
  }[];
}
export interface ExperimentPayload {
  kind: string;
  id?: string;
  experimentId?: string;
  status?: string;
  hypothesis?: string;
  checkpoint?: { id: string; verification: { frame: number } };
  branches?: { control: string; intervention: string };
  edits?: MemoryEdit[];
  captures?: Capture[];
  frameCount?: number;
  initialEditDifference?: { edits: MemoryEdit[]; frame: number };
  sessionId?: string;
  starting?: { frame: number };
  identicalStartingConditions?: boolean;
  firstBehavioralDivergence?: { elapsedFrame: number };
  firstTimerDifference?: number;
  firstRenderingDifference?: number;
  inputs?: unknown;
  final?: unknown;
  normalization?: string;
  error?: string;
  firstBehaviorDivergence?: { elapsedFrame: number };
  summary?: string;
  scope?: string;
  trace?: {
    elapsedFrame: number;
    control: { normalized: NormalizedMotion | null };
    intervention: { normalized: NormalizedMotion | null };
  }[];
}
export interface Candidate {
  attempt: number;
  candidateId: string;
  sourceSha256: string;
  candidate: { source: string };
  frozenAt?: string;
  timerFields?: unknown;
  acceptance?: unknown;
  development: {
    passed: boolean;
    error?: string;
    results?: { name: string; firstDivergence?: { tick: number } }[];
  };
}
export interface InvestigationReport {
  model?: string;
  origin?: string;
  startedAt?: string;
  finishedAt?: string;
  estimatedCostUsd?: number;
  requests?: unknown[];
  conclusion?: string;
  toolCalls?: ToolCall[];
  turns?: { messages: { phase: string; text: string }[] }[];
  session?: {
    id: string;
    identity: { cartridgeSha256: string };
    branches: Branch[];
    comparisons: Comparison[];
    findings?: Finding[];
    annotations?: Finding[];
    captures?: Capture[];
    experimentWorkbench?: {
      programs: ExperimentProgram[];
      artifacts: { id: string; payload: ExperimentPayload }[];
    };
    recovery?: { attempts: Candidate[]; acceptedAttempt?: number };
  };
}
