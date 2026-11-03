import { createRoot } from 'react-dom/client';
import { ExperimentResults, type ExperimentReceipt } from './motion-experiment';
const root = document.getElementById('export-root');
const data = document.getElementById('experiment-data');
if (!root || !data) throw Error('Exported replay data is missing');
const receipt = JSON.parse(data.textContent ?? 'null') as ExperimentReceipt;
createRoot(root).render(
  <main>
    <h1>Saved PARALLAXIA experiment</h1>
    <p>
      This archive reuses a verified result. Playing either branch makes no model request. Both
      games start from the recorded checkpoint with native collisions and unchanged native controls.
    </p>
    <ExperimentResults
      receipt={receipt}
      parentPlay="parent.html"
      candidatePlay="play.html"
      download="experiment.json"
    />
  </main>,
);
