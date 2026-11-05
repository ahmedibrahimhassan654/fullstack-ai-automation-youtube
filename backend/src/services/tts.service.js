import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

export const VOICES = {
  en: 'en-US-AriaNeural',
  es: 'es-ES-ElviraNeural',
  fr: 'fr-FR-DeniseNeural',
  de: 'de-DE-KatjaNeural',
  it: 'it-IT-ElsaNeural',
  pt: 'pt-BR-FranciscaNeural',
  ru: 'ru-RU-SvetlanaNeural',
  ar: 'ar-SA-ZariyahNeural',
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
    .replace(/```[\\s\\S]*?```/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\\*\\*(.*?)\\*\\*/g, '$1')
    .replace(/\\*(.*?)\\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/^#{1,6}\\s*/gm, '')
    .replace(/^\\s*[-*+]\\s+/gm, '')
    .replace(/[ \\t]{2,}/g, ' ')
    .trim();

const escapeXml = (text) =>
  String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export const synthesizeSpeech = async (text, voice, options = {}) => {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const lang = String(voice || 'en-US').split('-').slice(0, 2).join('-');
  const rate = options.rate || '-8%';
  const clean = stripMarkdown(text);
  const chunks = clean.match(/.{1,2500}/gs) || [clean];
  const buffers = [];

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    const ssml =
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">` +
      `<voice name="${voice}"><prosody rate="${rate}" pitch="+0Hz">${escapeXml(trimmed)}</prosody></voice></speak>`;

    const { audioStream } = tts.rawToStream(ssml);
    const audioChunks = [];
    await new Promise((resolve, reject) => {
      audioStream.on('data', (c) => audioChunks.push(c));
      audioStream.on('end', () => resolve());
      audioStream.on('error', reject);
    });
    buffers.push(Buffer.concat(audioChunks));
  }

  if (buffers.length === 0) throw new Error('No speech could be generated');
  return Buffer.concat(buffers);
};
