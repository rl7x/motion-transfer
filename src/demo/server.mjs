import { join } from 'node:path';
import { createPreviewServer } from '../../web/server.mjs';
import { createReadOnlyRoadsterLab } from './read-only-lab.mjs';

export async function startRecordingServer(root, labDirectory = join(root, 'reports/lab/artifacts')) {
  const lab = createReadOnlyRoadsterLab(labDirectory);
  return createPreviewServer({ lab });
}

export async function assertCreationDisabled(origin) {
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  const post = path => fetch(origin + path, { method: 'POST', headers, body: '{}' });
  const [remix, investigation, roadster, labResponse, remixResponse] = await Promise.all([
    post('/api/remixes'),
    post('/api/investigations'),
    post('/api/roadster/transfers'),
    fetch(origin + '/api/lab/status'),
    fetch(origin + '/api/remixes/status'),
  ]);
  const lab = await labResponse.json();
  const remixService = await remixResponse.json();
  const result = {
    remix: remix.status,
    investigation: investigation.status,
    roadster: roadster.status,
    labEnabled: lab.enabled,
    remixEnabled: remixService.enabled,
  };
  if ([result.remix, result.investigation, result.roadster].includes(202)) {
    throw Error('Recording server accepted a creation request');
  }
  if (result.labEnabled !== false || result.remixEnabled !== false) {
    throw Error('Recording server left model creation enabled');
  }
  return result;
}
