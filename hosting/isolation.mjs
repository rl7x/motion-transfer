import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { sep } from 'node:path';
import { WORKER_GID, WORKER_UID } from './constants.mjs';

const MARKER = 'HOSTING_SECRET_MARKER';

/** Fixed container environment. Host secrets are not copied. */
export const WORKER_ENV = Object.freeze([
  'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  'HOME=/tmp',
  'TMPDIR=/tmp',
  'NODE_ENV=production',
  'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
  'XDG_CACHE_HOME=/tmp',
  'XDG_CONFIG_HOME=/tmp',
]);

export const PROFILES = Object.freeze({
  probe: { memory: '96m', cpus: '0.50', pids: 32, timeoutMs: 20_000, tmp: '32m', output: 'tmpfs' },
  spin: { memory: '96m', cpus: '0.25', pids: 16, timeoutMs: 12_000, tmp: '16m', output: 'tmpfs' },
  memory: { memory: '96m', cpus: '0.50', pids: 16, timeoutMs: 20_000, tmp: '16m', output: 'tmpfs' },
  'verify-native': { memory: '1g', cpus: '1', pids: 64, timeoutMs: 120_000, tmp: '128m', output: 'bind' },
  'verify-browser': { memory: '2g', cpus: '2', pids: 256, timeoutMs: 240_000, tmp: '256m', shm: '256m', output: 'bind' },
});

export function profileFor(operation) {
  if (operation === 'probe-spin') return PROFILES.spin;
  if (operation === 'probe-memory') return PROFILES.memory;
  if (operation === 'verify-native') return PROFILES['verify-native'];
  if (operation === 'verify-browser') return PROFILES['verify-browser'];
  if (operation.startsWith('probe-')) return PROFILES.probe;
  throw Error('Unknown hosting operation');
}

export function assertOutputDir(directory) {
  let root, target;
  try {
    root = realpathSync(tmpdir());
    target = realpathSync(directory);
  } catch {
    throw Error('Worker output must stay inside the broker temp directory');
  }
  if (target !== root && !target.startsWith(root + sep)) throw Error('Worker output must stay inside the broker temp directory');
  return target;
}

/**
 * argv for `docker run` after the docker binary. The job cannot change the image,
 * command, network, or environment. Swap is capped at the memory limit.
 */
export function workerArguments({ image, name, operation, outputDir }) {
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(image)) throw Error('Invalid verifier image');
  if (!/^mt-[a-f0-9]{16}$/.test(name)) throw Error('Invalid worker name');
  const profile = profileFor(operation);
  const args = [
    'run', '-i', '--name', name, '--init',
    '--network', 'none',
    '--read-only',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true',
    '--user', `${WORKER_UID}:${WORKER_GID}`,
    '--memory', profile.memory,
    '--memory-swap', profile.memory,
    '--cpus', profile.cpus,
    '--pids-limit', String(profile.pids),
    '--ulimit', 'core=0',
    '--tmpfs', `/tmp:rw,nosuid,nodev,mode=1777,size=${profile.tmp}`,
    '--workdir', '/app',
  ];
  if (profile.shm) args.push('--shm-size', profile.shm);
  for (const entry of WORKER_ENV) args.push('--env', entry);
  if (profile.output === 'bind') {
    args.push('--mount', `type=bind,src=${assertOutputDir(outputDir)},dst=/output`);
  } else {
    args.push('--tmpfs', '/output:rw,nosuid,nodev,noexec,mode=1777,size=8m');
  }
  args.push(image);
  assertSafeArgs(args);
  return { args, timeoutMs: profile.timeoutMs, output: profile.output };
}

export function assertSafeArgs(args) {
  const text = args.join('\n');
  if (args.includes('--privileged') || text.includes('docker.sock') || text.includes('--network\nhost')
    || text.includes('--pid\nhost') || text.includes('--ipc\nhost')) {
    throw Error('Refusing an unsafe worker launch');
  }
  if (text.includes(MARKER) || text.includes('MODEL_API_KEY') || text.includes('META_API_KEY')) {
    throw Error('Refusing to place a credential in the worker launch');
  }
  if (!args.includes('--network') || args[args.indexOf('--network') + 1] !== 'none') throw Error('Worker network must be none');
  if (!args.includes('--read-only') || !args.includes('--cap-drop') || args[args.indexOf('--cap-drop') + 1] !== 'ALL') {
    throw Error('Worker must drop every capability and keep a read-only root');
  }
}
