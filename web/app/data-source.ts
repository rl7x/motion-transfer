import type { GenerationMode } from './types';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

export function readGenerationMode(): GenerationMode {
  const value = window.__MOTION_TRANSFER__?.generation;
  if (value === 'public-standard' || value === 'playback-only') return value;
  return 'local';
}

export function readRecovery(): 'saved' | 'accepted' {
  return window.__MOTION_TRANSFER__?.recovery === 'accepted' ? 'accepted' : 'saved';
}

/** Standalone comparison bundled with an accepted playback copy. Absent on the saved copy. */
export function readJujumpComparison(): string | null {
  const value = window.__MOTION_TRANSFER__?.jujumpComparison;
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : null;
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

/** Empty when the page is served at the host root. A release boot script sets the nested prefix. */
export function configuredBasePath(): string {
  const raw = window.__MOTION_TRANSFER__?.basePath;
  if (typeof raw !== 'string' || raw === '' || raw === '/') return '';
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  return path.endsWith('/') ? path : `${path}/`;
}

/** Prefix a root-absolute app path. Relative, hash-only, and protocol-relative values stay unchanged. */
export function appPath(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) return value;
  const hashAt = value.indexOf('#');
  const hash = hashAt === -1 ? '' : value.slice(hashAt);
  const before = hashAt === -1 ? value : value.slice(0, hashAt);
  const base = configuredBasePath();
  if (!base) return value;
  const prefix = base.slice(0, -1);
  if (before === prefix || before.startsWith(base)) return value;
  return prefix + before + hash;
}

/** Strip a configured prefix so existing `/play/:id` and `/roadster/play/:id` checks stay the same. */
export function logicalPathname(pathname = location.pathname): string {
  const base = configuredBasePath();
  if (!base) return pathname;
  if (pathname === base || `${pathname}/` === base) return '/';
  if (pathname.startsWith(base)) return pathname.slice(base.length - 1);
  return pathname;
}

export function shareAddress(path: string): { url: string; unconfigured: boolean } {
  const configured = window.__MOTION_TRANSFER__?.publicOrigin;
  if (typeof configured === 'string' && configured.length > 0) {
    return { url: new URL(path.replace(/^\/+/, ''), configured).href, unconfigured: false };
  }
  const local = location.protocol === 'file:' || LOCAL_HOSTS.has(location.hostname);
  if (!local) return { url: '', unconfigured: true };
  return { url: new URL(appPath(path), location.origin).href, unconfigured: false };
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
