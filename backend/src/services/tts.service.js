import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

export const VOICES = {
  en: 'en-US-AriaNeural',
  es: 'es-ES-ElviraNeural',
  fr: 'fr-FR-DeniseNeural',
  de: 'de-DE-KatjaNeural',
  it: 'it-IT-ElsaNeural',
  pt: 'pt-BR-FranciscaNeural',
  ru: 'ru-RU-SvetlanaNeural',
  ar: 'ar-EG-SalmaNeural',
  hi: 'hi-IN-SwaraNeural',
  zh: 'zh-CN-XiaoxiaoNeural',
  ja: 'ja-JP-NanamiNeural',
  ko: 'ko-KR-SunHiNeural',
  tr: 'tr-TR-EmelNeural',
  nl: 'nl-NL-ColetteNeural',
  pl: 'pl-PL-ZofiaNeural',
};

const stripMarkdown = (text) =>
  String(text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

const escapeXml = (text) =>
  String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const KHz100ns = 10000000;

export const synthesizeSpeech = async (text, voice, options = {}) => {
  const report = options.onProgress;
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
    wordBoundaryEnabled: true,
    sentenceBoundaryEnabled: true,
  });

  const lang = String(voice || 'en-US').split('-').slice(0, 2).join('-');
  const rate = options.rate || '0%';
  const clean = stripMarkdown(text);
  const chunks = clean.match(/.{1,2500}/gs) || [clean];
  const buffers = [];
  const rawBoundaries = [];
  let completedChunks = 0;

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    const ssml =
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">` +
      `<voice name="${voice}"><prosody rate="${rate}" pitch="+0Hz">${escapeXml(trimmed)}</prosody></voice></speak>`;

    const { audioStream, metadataStream } = tts.rawToStream(ssml);

    const audioChunks = [];
    const metadataItems = [];

    const audioPromise = new Promise((resolve, reject) => {
      audioStream.on('data', (c) => audioChunks.push(c));
      audioStream.on('end', () => resolve());
      audioStream.on('error', reject);
    });

    if (metadataStream) {
      metadataStream.on('data', (chunk) => {
        try {
          const json = JSON.parse(chunk.toString());
          metadataItems.push(...(json.Metadata || []));
        } catch {
          // ignore malformed chunks
        }
      });
      metadataStream.on('error', () => {});
    }

    await audioPromise;
    // Give trailing metadata a short chance to arrive.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const items = metadataItems;
    buffers.push(Buffer.concat(audioChunks));
    rawBoundaries.push(...items);
    completedChunks += 1;
    try {
      await options.onProgress?.(Math.round((completedChunks / Math.max(chunks.length, 1)) * 100));
    } catch {
      // ignore
    }
  }

  if (buffers.length === 0) throw new Error('No speech could be generated');

  // Prefer sentence boundaries (cleaner chunks). Fall back to word boundaries grouped by
  // punctuation, and finally to a single segment if no metadata was returned.
  const sentenceBoundaries = rawBoundaries.filter((b) => b.Type === 'SentenceBoundary');
  const wordBoundaries = rawBoundaries.filter((b) => b.Type === 'WordBoundary');

  let segments = [];
  if (sentenceBoundaries.length > 0) {
    segments = sentenceBoundaries.map((b) => ({
      start: Number((b.Data.Offset / KHz100ns).toFixed(3)),
      end: Number(((b.Data.Offset + b.Data.Duration) / KHz100ns).toFixed(3)),
      text: stripMarkdown(b.Data.text.Text),
    }));
  } else if (wordBoundaries.length > 0) {
    // Group words into ~12-word phrases for readable highlighting.
    const groups = [];
    let current = [];
    for (const wb of wordBoundaries) {
      current.push(wb);
      const word = wb.Data.text.Text;
      if (current.length >= 12 || /[.!?،؟。]/.test(word)) {
        groups.push(current);
        current = [];
      }
    }
    if (current.length > 0) groups.push(current);
    segments = groups.map((group) => ({
      start: Number((group[0].Data.Offset / KHz100ns).toFixed(3)),
      end: Number(
        ((group[group.length - 1].Data.Offset + group[group.length - 1].Data.Duration) / KHz100ns).toFixed(3),
      ),
      text: stripMarkdown(group.map((w) => w.Data.text.Text).join(' ')),
    }));
  } else {
    segments = [{ start: 0, end: 0, text: clean }];
  }

  return { buffer: Buffer.concat(buffers), segments };
};
