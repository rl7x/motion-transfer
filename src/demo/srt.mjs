export function formatTimestamp(seconds) {
  const whole = Math.round(seconds * 1000);
  const millis = whole % 1000;
  const total = Math.floor(whole / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const secs = total % 60;
  const pad = value => String(value).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${String(millis).padStart(3, '0')}`;
}

export function buildSrt(segments) {
  const cues = [];
  for (const segment of segments) {
    const texts = segment.cues?.length ? segment.cues : (segment.lower ?? []);
    const slice = segment.seconds / texts.length;
    texts.forEach((text, index) => {
      cues.push({
        start: segment.start + slice * index,
        end: segment.start + slice * (index + 1),
        text,
      });
    });
  }
  return cues.map((cue, index) => (
    `${index + 1}\n${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}\n${cue.text}\n`
  )).join('\n') + '\n';
}
