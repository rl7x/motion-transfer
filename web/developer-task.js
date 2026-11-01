const $ = selector => document.querySelector(selector);
try {
  const response = await fetch('/api/developer-task');
  if (!response.ok) throw Error('A verified developer export is not currently available.');
  const task = await response.json(), measurements = task.measurements;
  $('#developer-recovery').textContent = `${measurements.traceCount} saved traces · ${measurements.updates.toLocaleString()} updates · ${measurements.maxPositionError} maximum measured position error. Finite default-configuration checks.`;
  $('#developer-package').textContent = `${task.package.fileCount} files · ${(task.package.bytes / 1024).toFixed(0)} KB ZIP · component ${task.componentId.slice(0, 12)}`;
  $('#developer-package').title = `Package ${task.package.id}\nZIP SHA-256 ${task.package.sha256}`;
  $('#developer-download').href = task.package.download; $('#developer-download').hidden = false;
  $('#developer-preview').href = task.package.play; $('#developer-preview').hidden = false;
  const checked = task.verification;
  if (checked) {
    $('#developer-standalone-checks').textContent = `Saved local verification of this exact ZIP: ${checked.nodeChecks} Node checks and ${checked.browserChecks} browser scenarios passed after extraction into a fresh folder. `;
    const link = document.createElement('a'); link.href = checked.report; link.textContent = 'Inspect the standalone run ↗'; $('#developer-standalone-checks').append(link);
  } else $('#developer-standalone-checks').textContent = 'No standalone verification recording matches this exact export yet. Its included checks can be run locally.';
  const air = measurements.airborne;
  for (const [value, label] of [[`${air.ordinaryDistance} → ${air.dashDistance} px`, `Horizontal travel over ${air.ticks} updates`], [`${air.maxVerticalDifference.toExponential(1)} px`, 'Vertical difference in matched open-air traces'], [`$${measurements.recordedRecoveryCostUsd.toFixed(3)}`, 'Recorded recovery cost · export uses no API']]) {
    const item = document.createElement('div'), strong = document.createElement('strong'), text = document.createElement('span');
    strong.textContent = value; text.textContent = label; item.append(strong, text); $('#developer-measurements').append(item);
  }
  const incomplete = task.recovery.requests.filter(request => request.responseStatus === 'incomplete').length;
  const failed = task.recovery.attempts.filter(attempt => attempt.acceptancePassed === false).length;
  $('#developer-history').textContent = `${task.recovery.requests.length} saved model requests: ${incomplete} incomplete response, ${failed} candidate failing acceptance, then a focused Meta repair. That failed suite became development evidence; the repaired candidate passed a fresh acceptance seed after freezing. The original failure remains in the exported history.`;
  $('#developer-effort').textContent = `The adapter is ${measurements.adapterSourceLines} source lines; that excludes host hooks, runtime work, field mapping and evaluator construction. Human effort and developer time savings were not measured. No independent user validation or productivity improvement is claimed. Current compiled-target scope is WASM-4.`;
  $('#developer-select').addEventListener('click', async event => {
    if (!window.selectDestination) return;
    event.preventDefault();
    await window.selectDestination('jujump'); document.querySelector('.games').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
} catch (error) {
  $('#developer-package').textContent = error.message;
  $('#developer-recovery').textContent = 'See the saved recovery evidence for the available results.';
}
