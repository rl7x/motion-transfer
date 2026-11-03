import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connect } from 'node:net';
import { pathToFileURL } from 'node:url';
import { createRecoveryProtocol } from '../agent/recovery-protocol.mjs';
import { appendJsonLine, createTurnAuthority } from './control.mjs';

const waitMs = Number(process.env.MOTION_MCP_TURN_WAIT_MS ?? 5_000);

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function toolError(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

async function waitForTurn(authority) {
  const deadline = Date.now() + (Number.isFinite(waitMs) && waitMs >= 0 ? waitMs : 5_000);
  while (!authority.hasTurn()) {
    if (Date.now() >= deadline) throw Error('No trusted model turn has been observed');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

function connectGrants(authority, socketPath, log) {
  const socket = connect(socketPath);
  socket.on('error', () => {});
  let buffer = '';
  socket.on('data', chunk => {
    buffer = appendJsonLine(buffer, chunk, {
      onLine(line) {
        try {
          const message = JSON.parse(line);
          if (Number.isSafeInteger(message.turn)) authority.grant(message.turn);
        } catch { /* a malformed grant is not a model turn */ }
      },
      onOverflow() { log.write('grant line exceeded bound\n'); },
    });
  });
  return socket;
}

export async function serveMotionMcp({ input = process.stdin, journalDir = process.env.MOTION_MCP_JOURNAL } = {}) {
  if (!journalDir) throw Error('MOTION_MCP_JOURNAL is required');
  await mkdir(journalDir, { recursive: true });
  const log = createWriteStream(join(journalDir, 'server.log'), { flags: 'a' });
  const authority = createTurnAuthority();
  const grants = process.env.MOTION_MCP_TURN_SOCKET ? connectGrants(authority, process.env.MOTION_MCP_TURN_SOCKET, log) : null;
  const protocol = createRecoveryProtocol();
  let host = null;
  const ensureHost = async () => {
    if (host) return host;
    const { createMotionHost } = await import('./host.mjs');
    host = await createMotionHost({ directory: journalDir, protocol, authority });
    await host.persist();
    await writeFile(join(journalDir, 'started'), 'ready\n');
    return host;
  };
  let chain = Promise.resolve();
  let buffer = '';
  const handle = async line => {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); }
    catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
      return;
    }
    if (message.method === 'notifications/initialized' || !Object.hasOwn(message, 'id')) return;
    if (typeof message.method !== 'string') {
      send({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32600, message: 'Invalid Request' } });
      return;
    }
    try {
      if (message.method === 'initialize') {
        send({ jsonrpc: '2.0', id: message.id, result: {
          protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'motion-transfer', version: '0.1.0' },
        } });
        return;
      }
      if (message.method === 'tools/list') {
        const current = await ensureHost();
        send({ jsonrpc: '2.0', id: message.id, result: { tools: current.listTools() } });
        return;
      }
      if (message.method === 'tools/call') {
        const params = message.params;
        if (!params || typeof params !== 'object' || Array.isArray(params) || typeof params.name !== 'string' || params.name.length === 0) {
          send({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Invalid params' } });
          return;
        }
        let args;
        try {
          args = typeof params.arguments === 'string' ? JSON.parse(params.arguments) : params.arguments ?? {};
        } catch {
          send({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Invalid params' } });
          return;
        }
        if (!args || typeof args !== 'object' || Array.isArray(args)) {
          send({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Invalid params' } });
          return;
        }
        await waitForTurn(authority);
        const current = await ensureHost();
        const outcome = await current.call(message.params?.name, args);
        send({ jsonrpc: '2.0', id: message.id, result: outcome.mcp });
        return;
      }
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Unknown method' } });
    } catch (error) {
      log.write(String(error.message) + '\n');
      if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, result: toolError(error.message) });
    }
  };
  input.setEncoding('utf8');
  input.on('data', chunk => {
    buffer = appendJsonLine(buffer, chunk, {
      onLine(line) { chain = chain.then(() => handle(line)); },
      onOverflow() {
        log.write('JSON-RPC line exceeded bound\n');
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      },
    });
  });
  await new Promise(resolve => input.on('end', resolve));
  await chain;
  grants?.end();
  if (host) await host.close();
  log.end();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  serveMotionMcp().catch(error => {
    process.stderr.write(String(error.message) + '\n');
    process.exit(1);
  });
}
