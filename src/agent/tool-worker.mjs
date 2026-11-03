import { loadTarget } from './target.mjs';
import { createToolDispatcher } from './tool-dispatcher.mjs';

const dispatcher = createToolDispatcher({ target: await loadTarget(), persistCheckpoint });
let activeRequestId = null;
let checkpointSequence = 0;
const acknowledgements = new Map();

// Checkpoint messages bypass the command queue: an executing command waits for
// the parent's durable acknowledgement before advancing or returning evidence.
async function persistCheckpoint() {
  if (activeRequestId === null) throw Error('No active investigation request');
  const sequence = ++checkpointSequence;
  const acknowledged = new Promise((resolve, reject) => {
    acknowledgements.set(sequence, { resolve, reject, id: activeRequestId });
  });
  process.stdout.write(JSON.stringify({
    kind: 'checkpoint', id: activeRequestId, sequence, sessionState: dispatcher.snapshot(),
  }) + '\n');
  await acknowledged;
}

async function command(request) {
  const id = request.id;
  activeRequestId = id;
  try {
    const output = await dispatcher.execute(request.name, request.args);
    const sessionState = dispatcher.snapshot();
    process.stdout.write(JSON.stringify({ id, ok: true, ...output, ...(sessionState ? { sessionState } : {}) }) + '\n');
  } catch (error) {
    const sessionState = dispatcher.snapshot();
    process.stdout.write(JSON.stringify({
      id, ok: false, error: String(error.message).slice(0, 1000), ...(sessionState ? { sessionState } : {}),
    }) + '\n');
  } finally {
    activeRequestId = null;
  }
}

let buffer = '';
let queue = Promise.resolve();
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  buffer += chunk.toString('utf8');
  if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) throw Error('Worker input limit exceeded');
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    const request = JSON.parse(line);
    if (request.kind === 'checkpoint_ack') {
      const pending = acknowledgements.get(request.sequence);
      if (!pending || pending.id !== request.id) throw Error('Invalid checkpoint acknowledgement');
      acknowledgements.delete(request.sequence);
      if (request.ok) pending.resolve();
      else pending.reject(Error('Host could not durably persist investigation checkpoint'));
      continue;
    }
    if (!Number.isSafeInteger(request.id)) throw Error('Invalid worker request identity');
    queue = queue.then(() => command(request));
  }
}
await queue;
