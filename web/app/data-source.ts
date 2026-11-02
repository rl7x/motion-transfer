import type { GenerationMode } from './types';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

export function readGenerationMode(): GenerationMode {
  const value = window.__MOTION_TRANSFER__?.generation;
  if (value === 'public-standard' || value === 'playback-only') return value;
  return 'local';
}

/** Return a static GET payload when a release build injected this path. */
export function injectedResource(path: string): unknown {
  const resources = window.__MOTION_TRANSFER__?.resources;
  if (!resources) return undefined;
  const key = new URL(path, 'http://motion.local').pathname;
  if (!Object.prototype.hasOwnProperty.call(resources, key)) return undefined;
  const value = resources[key];
  return value === undefined ? undefined : structuredClone(value);
}

export function modelPolicy(mode: GenerationMode): string {
  if (mode === 'playback-only') return 'Saved play makes no model request.';
  if (mode === 'public-standard') return 'Creating a remix uses Standard Muse Spark.';
  return 'Saved play makes no model request. Creating a remix uses Standard Muse Spark.';
}

export function modelFailure(error: string): string {
  return /^Unsupported request\b/.test(error)
    ? `${error} No new version was saved. The playable parent stays as it is.`
    : `${error} The playable version stays as it is.`;
}

const STAGES: Record<string, string> = {
  queued: 'Queued on this server',
  generating: 'Model request',
  building: 'Building the adapter',
  testing: 'Independent checks',
  publishing: 'Saving the checked version',
  ready: 'Checked and saved',
  failed: 'Stopped before a new version',
};

export function stageLabel(status: string): string {
  return STAGES[status] ?? status;
}

export interface ShareMessage {
  text: string;
  url: string;
  copied: boolean;
  local: boolean;
}

export function describeShare(url: string, copied: boolean): ShareMessage {
  const parsed = new URL(url);
  const local = parsed.protocol === 'file:' || LOCAL_HOSTS.has(parsed.hostname);
  const text = copied
    ? local
      ? 'Local only. Not a public share link.'
      : 'Copied the playable address.'
    : local
      ? 'Clipboard unavailable. Local only, not a public share link.'
      : 'Clipboard unavailable. Select the address to copy it.';
  return { text, url, copied, local };
}
