const data = JSON.parse(document.getElementById('motion-data').textContent);
const basePath = new URL('.', location.href).pathname;
data.basePath = basePath;
data.generation = 'playback-only';
window.__MOTION_TRANSFER__ = data;

function rewrite(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return value;
  if (value === basePath || value.startsWith(basePath)) return value;
  return basePath.replace(/\/$/, '') + value;
}

for (const name of ['pushState', 'replaceState']) {
  const original = history[name];
  history[name] = function (state, title, url) {
    return original.call(this, state, title, typeof url === 'string' ? rewrite(url) : url);
  };
}

const fetchImpl = window.fetch.bind(window);
window.fetch = (input, init) => {
  if (typeof input === 'string') return fetchImpl(rewrite(input), init);
  if (input instanceof URL) return fetchImpl(new URL(rewrite(input.pathname + input.search + input.hash), location.origin), init);
  return fetchImpl(input, init);
};

const assign = (prototype, property) => {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
  if (!descriptor?.set) return;
  Object.defineProperty(prototype, property, {
    configurable: true,
    get: descriptor.get,
    set(value) { descriptor.set.call(this, rewrite(value)); },
  });
};
assign(HTMLIFrameElement.prototype, 'src');
assign(HTMLAnchorElement.prototype, 'href');
const setAttribute = Element.prototype.setAttribute;
Element.prototype.setAttribute = function (name, value) {
  if ((name === 'src' || name === 'href') && typeof value === 'string') value = rewrite(value);
  return setAttribute.call(this, name, value);
};
