import { readRoadsterArtifact } from '../roadster/artifact.mjs';

// Reads saved Roadster children for playback. It has no API key and cannot submit a job.
export function createReadOnlyRoadsterLab(directory) {
  return {
    status() {
      return { enabled: false, activeRunId: null, budget: null, unsettled: false };
    },
    artifact(id) {
      return readRoadsterArtifact(directory, id);
    },
    submit() {
      return Promise.reject(Error('Demo recording disables model creation'));
    },
  };
}
