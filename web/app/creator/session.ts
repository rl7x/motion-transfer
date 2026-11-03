import type { CreatorSession } from './types';

const KEY = 'motion-creator-session';

let memory: CreatorSession | null = null;
let durable = true;

function emptySession(): CreatorSession {
  return { sessionId: crypto.randomUUID(), invite: '', adult: false, pending: null };
}

function remember(session: CreatorSession): CreatorSession {
  memory = session;
  return session;
}

function parsedSession(value: Partial<CreatorSession>): CreatorSession | null {
  if (typeof value.sessionId !== 'string' || !value.sessionId) return null;
  return {
    sessionId: value.sessionId,
    invite: typeof value.invite === 'string' ? value.invite : '',
    adult: value.adult === true,
    pending:
      value.pending &&
      typeof value.pending.idempotencyKey === 'string' &&
      typeof value.pending.parentArtifactId === 'string' &&
      typeof value.pending.prompt === 'string'
        ? {
            idempotencyKey: value.pending.idempotencyKey,
            parentArtifactId: value.pending.parentArtifactId,
            prompt: value.pending.prompt,
            jobId: typeof value.pending.jobId === 'string' ? value.pending.jobId : null,
          }
        : null,
  };
}

export function readSession(): CreatorSession {
  if (!durable && memory) return memory;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return memory ?? remember(emptySession());
    return remember(parsedSession(JSON.parse(raw) as Partial<CreatorSession>) ?? emptySession());
  } catch {
    durable = false;
    return memory ?? remember(emptySession());
  }
}

export function writeSession(session: CreatorSession): void {
  memory = session;
  if (!durable) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    durable = false;
  }
}
