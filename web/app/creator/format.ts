import type { RemixIntent } from './types';

export function meters(unitScale: number): string {
  return `${Number((unitScale * 60).toFixed(2))} m`;
}

export function activationLabel(value: string): string {
  if (value === 'press') return 'Fresh press';
  if (value === 'held') return 'Hold to repeat';
  return value;
}

export function directionLabel(value: string): string {
  if (value === 'opposite') return 'Backward';
  if (value === 'facing') return 'Forward along the stunt';
  return value;
}

export function intentLines(intent: RemixIntent | null): {
  distance: string;
  direction: string;
  activation: string;
} | null {
  if (!intent) return null;
  return {
    distance: meters(intent.unitScale),
    direction: directionLabel(intent.direction),
    activation: activationLabel(intent.activation),
  };
}

const TERMINAL = new Set(['ready', 'failed', 'unsupported']);

export function terminalStatus(status: string): boolean {
  return TERMINAL.has(status);
}

export function statusText(status: string): string {
  if (status === 'queued') return 'Queued. No version is published yet.';
  if (status === 'generating') return 'Generating. No version is published yet.';
  if (status === 'verifying') return 'Checking the remix. No version is published yet.';
  if (status === 'ready') return 'Published version.';
  if (status === 'failed' || status === 'unsupported') {
    return 'Not published. The parent version was not changed.';
  }
  return 'Working. No version is published yet.';
}
