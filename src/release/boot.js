const data = JSON.parse(document.getElementById('motion-data').textContent);
const basePath = new URL('.', location.href).pathname;
data.basePath = basePath.endsWith('/') ? basePath : basePath + '/';
data.generation = 'playback-only';
if (data.recovery !== 'accepted') data.recovery = 'saved';
window.__MOTION_TRANSFER__ = data;
