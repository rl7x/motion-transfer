// Evidence records use stable logical names from before the repository reorganization.
// Resolve those names at the filesystem boundary; never rewrite a recorded manifest.
const sourceDirectories = new Set([
  'agent', 'benchmark', 'campaign', 'component', 'demo', 'evaluator', 'experiment',
  'hosting', 'integration', 'lab', 'mcp', 'parallaxia', 'release', 'remix',
  'roadster', 'runtime', 'transfer',
]);
const assetDirectories = new Set(['components', 'experiments', 'recipients', 'targets', 'transfers']);
const recordings = [
  'benchmark/recordings', 'benchmark/fidelity-recordings', 'benchmark/remix-recordings',
  'integration/recordings', 'lab/recordings',
];

export function repositoryPath(logicalPath) {
  if (logicalPath.startsWith('/') || logicalPath.includes('\\') || logicalPath.split('/').includes('..')) {
    throw Error('Expected a repository-relative input path');
  }
  if (/^recipients\/[^/]+\/load\.mjs$/.test(logicalPath)) return 'src/' + logicalPath;
  const directory = logicalPath.split('/')[0];
  if (assetDirectories.has(directory) || recordings.some(path => logicalPath === path || logicalPath.startsWith(path + '/'))) {
    return 'assets/' + logicalPath;
  }
  return sourceDirectories.has(directory) ? 'src/' + logicalPath : logicalPath;
}

export function repositoryUrl(logicalPath) {
  return new URL(repositoryPath(logicalPath), new URL('../', import.meta.url));
}
