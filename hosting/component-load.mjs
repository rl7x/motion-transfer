import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRecoveredMotion } from '../component/load.mjs';
import { resolveComponentRef } from '../component/reference.mjs';
import { readRoadsterArtifact } from '../roadster/artifact.mjs';
import {
  ACCEPTED_ARTIFACT_ID, ACCEPTED_COMPONENT_ID, SAVED_COMPONENT_ID,
} from './component-pin.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Loads one allowlisted package from the committed tree. An unknown id does not fall back to the saved dash. */
export async function loadPinnedComponent(componentId) {
  if (componentId === SAVED_COMPONENT_ID) {
    const saved = await loadRecoveredMotion();
    if (saved.provenance.id !== SAVED_COMPONENT_ID) throw Error('Saved component pin mismatch');
    const component = await resolveComponentRef(saved);
    if (component.provenance.id !== SAVED_COMPONENT_ID || component.candidateId) throw Error('Saved component pin mismatch');
    return component;
  }
  if (componentId === ACCEPTED_COMPONENT_ID) {
    const directory = join(root, 'transfers/roadster/accepted', ACCEPTED_ARTIFACT_ID, 'published/artifacts');
    const artifact = await readRoadsterArtifact(directory, ACCEPTED_ARTIFACT_ID);
    if (artifact.componentId !== ACCEPTED_COMPONENT_ID || artifact.component?.provenance?.id !== ACCEPTED_COMPONENT_ID) {
      throw Error('Accepted component pin mismatch');
    }
    const component = await resolveComponentRef(artifact.component);
    if (component.provenance.id !== ACCEPTED_COMPONENT_ID || !component.candidateId) throw Error('Accepted component pin mismatch');
    return component;
  }
  throw Error('Component is not an allowlisted host pin');
}
