const stripTags = (text) =>
  String(text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const parseTimestamp = (value) => {
  // Supports SRT (00:00:01,234) and VTT (00:00:01.234).
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  let millis = match[4];
  if (millis.length === 1) millis += '00';
  else if (millis.length === 2) millis += '0';
  const ms = Number(millis.padEnd(3, '0').slice(0, 3));
  return hours * 3600 + minutes * 60 + seconds + ms / 1000;
};

export const parseSrt = (text) => {
  const input = String(text || '').replace(/^\uFEFF/, '');
  const lines = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const segments = [];

  let i = 0;
  while (i < lines.length) {
    // Skip blank lines.
    while (i < lines.length && !lines[i].trim()) i += 1;
    if (i >= lines.length) break;

    // Optional cue index line.
    if (/^\d+$/.test(lines[i].trim())) i += 1;

    const timingLine = lines[i]?.trim() || '';
    const timingMatch = timingLine.match(/(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/);
    if (!timingMatch) {
      // Not a cue header; advance to avoid infinite loops.
      i += 1;
      continue;
    }

    const start = parseTimestamp(timingMatch[1]);
    const end = parseTimestamp(timingMatch[2]);
    i += 1;

    const textLines = [];
    while (i < lines.length && lines[i].trim() !== '') {
      textLines.push(lines[i]);
      i += 1;
    }
    const cueText = stripTags(textLines.join(' '));
    if (cueText && start !== null && end !== null) {
      segments.push({
        start: Number(start.toFixed(3)),
        end: Number(Math.max(end, start + 0.05).toFixed(3)),
        text: cueText,
      });
    }
  }

  // Fallback for plain text SRT without cues.
  if (segments.length === 0) {
    const plain = input.trim();
    if (plain) {
      return { text: plain, segments: [{ start: 0, end: 0, text: stripTags(plain) }] };
    }
  }

  const transcript = segments.map((s) => s.text).join(' ').trim();
  return { text: transcript, segments };
};

export const parseSubtitle = (text, filename = '') => {
  const lower = String(filename || '').toLowerCase();
  if (lower.endsWith('.vtt')) {
    // VTT is structurally compatible enough for our simple parser after header removal.
    return parseSrt(String(text || '').replace(/^WEBVTT.*$/m, ''));
  }
  return parseSrt(text);
};
