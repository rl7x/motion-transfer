/** A public playable URL exists only after an origin is configured. */
export function normalizePublicOrigin(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw Error('Public origin must be a URL string');
  let url;
  try { url = new URL(value); }
  catch { throw Error('Public origin must be an absolute URL'); }
  if (url.username || url.password || url.search || url.hash) throw Error('Public origin must be an origin and path');
  if (url.protocol !== 'https:') throw Error('A configured public origin must use https');
  const path = url.pathname.endsWith('/') ? url.pathname : url.pathname + '/';
  return url.origin + path;
}

export function shareDecision(publicOrigin, relativePath) {
  const origin = normalizePublicOrigin(publicOrigin);
  if (!origin) return { configured: false, text: 'A public link is not configured.' };
  if (typeof relativePath !== 'string' || !relativePath || relativePath.startsWith('/')
    || relativePath.startsWith('//') || /^[a-z]+:/i.test(relativePath)
    || relativePath.split('/').includes('..') || relativePath.split('/').includes('.')) {
    throw Error('Share paths stay inside the configured public origin');
  }
  return { configured: true, text: 'Public playable link', url: new URL(relativePath, origin).href };
}
