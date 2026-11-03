import { auditDirectory } from '../release/audit.mjs';
import { createStaticReleaseServer } from '../release/static-server.mjs';

const HELP = `Usage: node scripts/serve-release.mjs --root <directory> [--port 4173] [--base-path /]

Serve an audited static release on 127.0.0.1. This is local review, not deployment.

Accepted bundle:
node scripts/serve-release.mjs --root reports/release-accepted --port 4173 --base-path /motion-transfer/
`;

function option(name) {
  const flag = '--' + name;
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw Error('Missing value for ' + flag);
  return value;
}

if (process.argv.includes('--help')) {
  console.log(HELP);
  process.exit(0);
}
if (process.argv.some(arg => arg === '--host' || arg.startsWith('--host='))) {
  throw Error('serve-release binds 127.0.0.1 only');
}
const root = option('root');
if (!root) {
  console.error(HELP);
  process.exit(1);
}
const portText = option('port') ?? '4173';
const basePath = option('base-path') ?? '/';
const port = Number(portText);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid port');
await auditDirectory(root);
const server = await createStaticReleaseServer({ root, basePath, host: '127.0.0.1', port });
console.log(server.origin);
const stopped = new Promise(resolve => {
  process.once('SIGINT', resolve);
  process.once('SIGTERM', resolve);
});
await stopped;
await server.close();
