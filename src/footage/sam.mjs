/** SAM 3.1 video segmentation through the Meta Model API. */
export const SAM_MODEL = 'sam-3.1';
const ENDPOINT = 'https://api.meta.ai/v1/responses';
const USD_PER_FRAME = 0.20 / 1000;
const MINIMUM_FRAMES = 50;
const VIDEO_LIMIT_BYTES = 40 * 1024 * 1024;

/** Video is billed per frame, with a minimum per request. */
export const samCostUsd = frames => Math.max(frames, MINIMUM_FRAMES) * USD_PER_FRAME;

export function samRequest({ video, prompt }) {
  if (video.length > VIDEO_LIMIT_BYTES) throw Error('Clip is over the 40 MB limit; trim it first');
  return {
    model: SAM_MODEL, stream: true,
    metadata: { include_confidence: 'true', mask_encoding: 'one_bit' },
    input: [{ type: 'message', role: 'user', content: [
      { type: 'input_text', text: prompt },
      { type: 'input_video', video_url: `data:video/mp4;base64,${video.toString('base64')}` },
    ] }],
  };
}

/** Joins the streamed text of one server-sent response. */
export function textFromStream(stream) {
  let text = '', failure = null;
  for (const line of stream.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    const event = JSON.parse(data);
    if (event.type === 'response.output_text.delta') text += event.delta;
    if (event.type === 'response.failed' || event.type === 'error') failure = event.response?.error?.message ?? event.message ?? 'SAM reported a failure';
  }
  if (failure) throw Error(failure);
  return text;
}

/** Reads SAM's text into one track per object: id → frame → box, in the clip's own pixels. */
export function parseTracks(text) {
  const tracks = new Map();
  for (const part of text.split(/(?=<\d+f>)/)) {
    const marker = part.match(/^<(\d+)f>/);
    if (!marker) continue;
    const frame = Number(marker[1]);
    for (const [, id, fields] of part.slice(marker[0].length).matchAll(/(\d+)<\|box;([^|]*)\|>/g)) {
      const box = Object.fromEntries(fields.split(';').map(field => field.split('=')).map(([key, value]) => [key, Number(value)]));
      if (![box.x1, box.y1, box.x2, box.y2].every(Number.isFinite)) continue;
      if (!tracks.has(Number(id))) tracks.set(Number(id), new Map());
      tracks.get(Number(id)).set(frame, box);
    }
  }
  return tracks;
}

export async function callSam(apiKey, request, { fetchImpl = fetch, timeoutMs = 300_000 } = {}) {
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST', signal: AbortSignal.timeout(timeoutMs), redirect: 'error', body: JSON.stringify(request),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw Error(`SAM returned HTTP ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}`);
  return response.text();
}
