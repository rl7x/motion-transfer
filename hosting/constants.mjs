import { fileURLToPath } from 'node:url';

/** Node and Playwright pins for the verifier image. Playwright matches package-lock.json. */
export const NODE_IMAGE = 'node:22-bookworm';
export const COORDINATOR_IMAGE = 'node:22-bookworm-slim';
export const PLAYWRIGHT_VERSION = '1.64.1';
export const VERIFIER_IMAGE = 'motion-transfer-verifier:local';
export const COORDINATOR_TAG = 'motion-transfer-coordinator:local';

/** Public creation uses Standard Muse Spark. Contributor mode is not a public-traffic model. */
export const PUBLIC_MODEL = 'muse-spark-1.3';
export const PUBLIC_RESERVE_USD = 15;
export const REMIX_MAX_COST_USD = 7;

export const SESSION_JOB_LIMIT = 2;
export const GLOBAL_ACTIVE_LIMIT = 1;
export const BODY_LIMIT = 4096;
export const PROMPT_LIMIT = 1000;
export const JOB_LIMIT = 256 * 1024;
export const STDOUT_LIMIT = 64 * 1024;
export const FRAME_LIMIT = 8 * 1024 * 1024;
export const SOURCE_LIMIT = 16 * 1024;

export const WORKER_UID = 10001;
export const WORKER_GID = 10001;

/** Eventual paid wrappers reuse this ledger. This release does not reserve against it. */
export const SHARED_PHASE_DIRECTORY = fileURLToPath(new URL('../reports/motion-transfer-phase/', import.meta.url));

export const SHARED_LEDGER_CONFIRMATION = 'charge-shared-public-reserve';

/** Operator confirmation for a later hosted-generation process. This build does not turn it on. */
export const HOSTING_GENERATION_CONFIRMATION = 'enable-hosted-standard-generation';
export const PROVIDER_DEADLINE_MS = 180_000;
