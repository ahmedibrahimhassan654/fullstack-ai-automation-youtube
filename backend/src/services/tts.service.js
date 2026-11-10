import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { env } from '../config/env.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';

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

export const EDGE_VOICE_OPTIONS = {
  en: ['en-US-JennyNeural', 'en-US-GuyNeural', 'en-US-AriaNeural', 'en-US-AndrewNeural'],
  es: ['es-ES-ElviraNeural', 'es-ES-AlvaroNeural', 'es-MX-DaliaNeural'],
  fr: ['fr-FR-DeniseNeural', 'fr-FR-HenriNeural', 'fr-CA-SylvieNeural'],
  de: ['de-DE-KatjaNeural', 'de-DE-ConradNeural', 'de-AT-IngridNeural'],
  it: ['it-IT-ElsaNeural', 'it-IT-DiegoNeural'],
  pt: ['pt-BR-FranciscaNeural', 'pt-BR-AntonioNeural', 'pt-PT-FernandaNeural'],
  ru: ['ru-RU-SvetlanaNeural', 'ru-RU-DmitryNeural'],
  ar: [
    'ar-EG-SalmaNeural',
    'ar-EG-ShakirNeural',
    'ar-SA-ZariyahNeural',
    'ar-SA-HamedNeural',
    'ar-AE-FatimaNeural',
    'ar-AE-HamdanNeural',
  ],
  hi: ['hi-IN-SwaraNeural', 'hi-IN-MadhurNeural'],
  zh: ['zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural', 'zh-CN-XiaochenNeural'],
  ja: ['ja-JP-NanamiNeural', 'ja-JP-KeitaNeural'],
  ko: ['ko-KR-SunHiNeural', 'ko-KR-InJoonNeural'],
  tr: ['tr-TR-EmelNeural', 'tr-TR-AhmetNeural'],
  nl: ['nl-NL-ColetteNeural', 'nl-NL-MaartenNeural'],
  pl: ['pl-PL-ZofiaNeural', 'pl-PL-MarekNeural'],
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

// --- Mixed script synthesis ----------------------------------------------------
// Arabic narration that mentions English technical names (ISO, Kali Linux,
// React) and numbers sounds wrong when a single Arabic voice reads all of it:
// the Arabic voice squashes the Latin names into Arabic phonetics and spells
// numbers out digit by digit. Each script run is therefore spoken by a voice
// that is native to it.

// Voice used for the English fragments inside a non-English narration. It is
// matched to the gender of the target voice so the dub keeps one speaker.
const TECHNICAL_TERM_VOICE_MAP = {
  'ar-EG-SalmaNeural': 'en-US-JennyNeural',
  'ar-EG-ShakirNeural': 'en-US-GuyNeural',
  'ar-AE-FatimaNeural': 'en-US-JennyNeural',
  'ar-AE-HamdanNeural': 'en-US-GuyNeural',
  'ar-SA-ZariyahNeural': 'en-US-JennyNeural',
  'ar-SA-HamedNeural': 'en-US-GuyNeural',
};

const DEFAULT_TECHNICAL_TERM_VOICE = 'en-US-AriaNeural';

export const technicalTermVoiceFor = (voice) =>
  TECHNICAL_TERM_VOICE_MAP[String(voice || '')] || DEFAULT_TECHNICAL_TERM_VOICE;

const ARABIC_SCRIPT_PATTERN = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LATIN_RUN_PATTERN = /[A-Za-z0-9]/;
// Letters and digits are speakable; diacritics and punctuation on their own
// are not (Edge returns empty audio for them).
const SPEAKABLE_PATTERN = /[\p{L}\p{N}]/u;

/**
 * Splits a sentence into runs of target-script text and runs of Latin text
 * (technical names, numbers). Spaces and punctuation stay with the run they
 * follow.
 */
export const splitIntoScriptRuns = (text, { minLatinLength = 2 } = {}) => {
  const value = String(text || '');
  if (!value) return [];

  const runs = [];
  let current = null;

  const push = (kind, chunk) => {
    if (!current || current.kind !== kind) {
      if (current) runs.push(current);
      current = { kind, text: chunk };
    } else {
      current.text += chunk;
    }
  };

  for (const ch of value) {
    if (ARABIC_SCRIPT_PATTERN.test(ch)) {
      push('target', ch);
    } else if (LATIN_RUN_PATTERN.test(ch)) {
      push('latin', ch);
    } else if (current) {
      current.text += ch;
    } else {
      current = { kind: 'target', text: ch };
    }
  }
  if (current) runs.push(current);

  const cleaned = runs
    .map((run) => ({ kind: run.kind, text: run.text.trim() }))
    .filter((run) => run.text);

  // A run without letters (a stray diacritic or punctuation) is not
  // speakable on its own, and a one letter Latin fragment is not worth its
  // own request. Both are glued to a neighbour.
  const isGlueable = (run) =>
    !SPEAKABLE_PATTERN.test(run.text) ||
    (run.kind === 'latin' && run.text.replace(/[^A-Za-z0-9]/g, '').length < minLatinLength);

  const merged = [];
  for (let i = 0; i < cleaned.length; i += 1) {
    const run = cleaned[i];
    if (isGlueable(run)) {
      const previous = merged[merged.length - 1];
      if (previous) {
        previous.text = `${previous.text} ${run.text}`;
        continue;
      }
      const next = cleaned[i + 1];
      if (next) {
        next.text = `${run.text} ${next.text}`;
        continue;
      }
      continue;
    }
    merged.push({ ...run });
  }

  // A stray Arabic diacritic can end up glued to a Latin name; an English
  // voice cannot pronounce it, so it is removed.
  return merged
    .map((run) => ({
      ...run,
      text: run.kind === 'latin' ? run.text.replace(/\p{M}/gu, '').trim() : run.text,
    }))
    .filter((run) => run.text);
};

const runFfmpegTrim = (args) =>
  new Promise((resolve, reject) => {
    const proc = spawn(ffmpegStatic, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(-500)}`));
    });
  });

const runFfmpegConcat = (inputFiles, outputFile) =>
  new Promise((resolve, reject) => {
    const listFile = path.join(os.tmpdir(), `concat-${Date.now()}.txt`);
    fs.writeFileSync(listFile, inputFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
    const proc = spawn(ffmpegStatic, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outputFile], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      try {
        fs.unlinkSync(listFile);
      } catch {
        // ignore
      }
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg concat failed (${code}): ${stderr.slice(-500)}`));
    });
  });

const synthesizeChunk = async (chunkText, voice, rate) => {
  // No debug output in production; keep synthesis quiet.
  const tts = new MsEdgeTTS({ connectionTimeoutMs: 30000, synthesisTimeoutMs: 120000 });
  // 96 kbit/s mono is noticeably clearer than the old 48 kbit/s stream.
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, {
    wordBoundaryEnabled: true,
    sentenceBoundaryEnabled: true,
  });

  const lang = String(voice || 'en-US').split('-').slice(0, 2).join('-');
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">` +
    `<voice name="${voice}"><prosody rate="${rate}" pitch="+0.8Hz">${escapeXml(chunkText)}</prosody></voice></speak>`;

  const { audioStream, metadataStream } = tts.rawToStream(ssml);
  const audioChunks = [];
  const metadataItems = [];

  const audioPromise = new Promise((resolve, reject) => {
    audioStream.on('data', (c) => audioChunks.push(c));
    audioStream.on('end', () => { console.log('[tts] audio end', voice, 'chunks', audioChunks.length); resolve(); });
    audioStream.on('error', (e) => { console.error('[tts] audio error', voice, e?.message); reject(e); });
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
  if (!audioChunks.length) throw new Error('Edge TTS returned empty audio');
  await new Promise((resolve) => setTimeout(resolve, 100));
  const sentenceBoundaries = metadataItems.filter((b) => b.Type === 'SentenceBoundary');
  const wordBoundaries = metadataItems.filter((b) => b.Type === 'WordBoundary');

  const segments = [];
  if (sentenceBoundaries.length > 0) {
    for (const b of sentenceBoundaries) {
      segments.push({
        start: Number((b.Data.Offset / KHz100ns).toFixed(3)),
        end: Number(((b.Data.Offset + b.Data.Duration) / KHz100ns).toFixed(3)),
        text: stripMarkdown(b.Data.text.Text),
      });
    }
  } else {
    const words = chunkText.split(/\s+/).length;
    segments.push({ start: 0, end: Math.max(1, words / 2.5), text: stripMarkdown(chunkText) });
  }

  const wordSegments = [];
  if (wordBoundaries.length > 0) {
    for (const b of wordBoundaries) {
      const text = stripMarkdown(b.Data.text.Text);
      if (!text) continue;
      wordSegments.push({
        start: Number((b.Data.Offset / KHz100ns).toFixed(3)),
        end: Number(((b.Data.Offset + b.Data.Duration) / KHz100ns).toFixed(3)),
        text,
      });
    }
  } else {
    // Fallback: at least one segment for the whole chunk.
    wordSegments.push({ start: 0, end: segments[0]?.end || 1, text: stripMarkdown(chunkText) });
  }

  const chunkEnd =
    segments.length > 0
      ? segments[segments.length - 1].end
      : (wordSegments.length > 0 ? wordSegments[wordSegments.length - 1].end : Math.max(1, chunkText.split(/\s+/).length / 2.5));

  return { buffer: Buffer.concat(audioChunks), segments, wordSegments, chunkEnd };
};

const chunkElevenLabsText = (text) =>
  (String(text || '').match(/.{1,3500}/gs) || [String(text || '')]).map((c) => c.trim()).filter(Boolean);

const alignmentToWordSegments = (alignment) => {
  const chars = alignment?.characters || [];
  const starts = alignment?.character_start_times_seconds || [];
  const ends = alignment?.character_end_times_seconds || [];
  const words = [];
  let current = null;
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (/\s/.test(ch)) {
      if (current) {
        words.push(current);
        current = null;
      }
    } else if (current) {
      current.text += ch;
      current.end = Number(ends[i] ?? current.end);
    } else {
      current = { text: ch, start: Number(starts[i] ?? 0), end: Number(ends[i] ?? 0) };
    }
  }
  if (current) words.push(current);
  return words
    .map((w) => ({
      start: Number(Math.max(0, w.start).toFixed(3)),
      end: Number(Math.max(w.start + 0.05, w.end).toFixed(3)),
      text: stripMarkdown(w.text),
    }))
    .filter((w) => w.text);
};

const alignmentToSentenceSegments = (wordSegments) => {
  const sentences = [];
  let current = [];
  for (const word of wordSegments) {
    current.push(word);
    if (/[.!?]$/.test(word.text)) {
      const start = current[0].start;
      const end = current[current.length - 1].end;
      const text = current.map((w) => w.text).join(' ').trim();
      if (text) sentences.push({ start, end, text });
      current = [];
    }
  }
  if (current.length) {
    const start = current[0].start;
    const end = current[current.length - 1].end;
    const text = current.map((w) => w.text).join(' ').trim();
    if (text) sentences.push({ start, end, text });
  }
  return sentences;
};

const synthesizeWithElevenLabs = async (text, voiceId, options = {}) => {
  if (!env.elevenLabsApiKey) {
    const err = new Error('ELEVENLABS_API_KEY is not configured');
    err.statusCode = 500;
    throw err;
  }

  const client = new (await import('elevenlabs')).ElevenLabsClient({
    apiKey: env.elevenLabsApiKey,
  });

  const modelId = options.modelId || 'eleven_multilingual_v2';
  const report = options.onProgress;
  const clean = stripMarkdown(text);
  if (!clean.trim()) throw new Error('No speech could be generated');

  const chunks = chunkElevenLabsText(clean);
  const results = [];
  const allSegments = [];
  const allWordSegments = [];
  let offset = 0;

  for (const chunk of chunks) {
    let response;
    try {
      response = await client.textToSpeech.convertWithTimestamps(voiceId, {
      text: chunk,
      model_id: modelId,
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.8,
        style: 0.35,
        use_speaker_boost: true,
      },
    });

    } catch (error) {
      const detail = error?.body?.detail;
      const message = detail?.message || error?.message || 'ElevenLabs request failed';
      const err = new Error(message);
      err.statusCode = error?.statusCode || 400;
      throw err;
    }

    if (!response) throw new Error('ElevenLabs returned no response');
    const buffer = Buffer.from(response.audio_base64 || '', 'base64');
    if (!buffer.length) throw new Error('ElevenLabs returned empty audio');

    const alignment = response.normalized_alignment || response.alignment;
    const wordSegments = alignmentToWordSegments(alignment);
    const segments = alignmentToSentenceSegments(wordSegments);
    const chunkEnd =
      wordSegments.length > 0
        ? wordSegments[wordSegments.length - 1].end
        : (segments.length > 0 ? segments[segments.length - 1].end : Math.max(1, chunk.split(/\s+/).length / 2.5));

    results.push({ buffer });
    for (const seg of segments.length ? segments : wordSegments) {
      allSegments.push({
        start: Number((seg.start + offset).toFixed(3)),
        end: Number((seg.end + offset).toFixed(3)),
        text: seg.text,
      });
    }
    for (const seg of wordSegments) {
      allWordSegments.push({
        start: Number((seg.start + offset).toFixed(3)),
        end: Number((seg.end + offset).toFixed(3)),
        text: seg.text,
      });
    }

    offset += chunkEnd || 0;
    if (report) {
      try {
        await report(Math.round((results.length / chunks.length) * 100));
      } catch {
        // ignore
      }
    }
  }

  const buffers = results.map((r) => r.buffer);
  let finalBuffer;
  if (buffers.length === 1) {
    finalBuffer = buffers[0];
  } else {
    const files = buffers.map((b, i) => path.join(os.tmpdir(), `eleven-chunk-${Date.now()}-${i}.mp3`));
    files.forEach((f, i) => fs.writeFileSync(f, buffers[i]));
    const out = path.join(os.tmpdir(), `eleven-merged-${Date.now()}.mp3`);
    try {
      await runFfmpegConcat(files, out);
      finalBuffer = fs.readFileSync(out);
    } finally {
      for (const f of [...files, out]) {
        try {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        } catch {
          // ignore
        }
      }
    }
  }

  const finalSegments = allSegments.filter((s) => s.text);
  const finalWordSegments = allWordSegments.filter((s) => s.text);
  return {
    buffer: finalBuffer,
    segments: finalSegments.length ? finalSegments : [{ start: 0, end: 0, text: clean }],
    // Keep word-level timings too; downstream can use them as subtitles.
    wordSegments: finalWordSegments,
  };
};

const synthesizeWithGoogleCloud = async (text, voiceName, options = {}) => {
  if (!env.googleTtsApiKey) {
    const err = new Error('GOOGLE_TTS_API_KEY is not configured');
    err.statusCode = 500;
    throw err;
  }
  const clean = stripMarkdown(text);
  if (!clean.trim()) throw new Error('No speech could be generated');
  const name = String(voiceName || env.googleTtsVoice || '').trim();
  if (!name) throw new Error('A Google TTS voice name is required (e.g. ar-XA-Wavenet-A)');
  const languageCode = name.split('-').slice(0, 2).join('-');
  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(env.googleTtsApiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text: clean },
      voice: { languageCode, name },
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0, pitch: 0.0 },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Google TTS failed (${res.status})`);
    err.statusCode = res.status;
    throw err;
  }
  const buffer = Buffer.from(String(data.audioContent || ''), 'base64');
  if (!buffer.length) throw new Error('Google TTS returned empty audio');
  return {
    buffer,
    segments: [{ start: 0, end: Math.max(1, clean.split(/\\s+/).length / 2.5), text: clean }],
    wordSegments: [],
  };
};

/**
 * Split text into speech-sized chunks **without ever cutting a word**.
 * Prefers sentence boundaries (works with Arabic / Hindi punctuation too),
 * then falls back to the closest space before the limit.
 */
export const splitIntoSpeechChunks = (text, maxLen = 260) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];

  // 1) break the text into sentences
  const sentences = [];
  let buffer = '';
  for (const part of clean.split(/(?<=[.!?؟۔…])\s+/)) {
    const candidate = buffer ? `${buffer} ${part}` : part;
    if (candidate.length <= maxLen) {
      buffer = candidate;
    } else {
      if (buffer) sentences.push(buffer.trim());
      buffer = part;
    }
  }
  if (buffer.trim()) sentences.push(buffer.trim());

  // 2) split any sentence that is still too long, always on a space
  const chunks = [];
  for (const sentence of sentences) {
    let rest = sentence;
    while (rest.length > maxLen) {
      let cut = rest.lastIndexOf(' ', maxLen);
      if (cut < maxLen * 0.5) {
        // no usable space: take the next space after the limit instead
        const nextSpace = rest.indexOf(' ', maxLen);
        cut = nextSpace > 0 ? nextSpace : maxLen;
      }
      chunks.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) chunks.push(rest);
  }

  return chunks.filter(Boolean);
};

const speakChunks = async (parts, voice, rate, depth = 0) => {
  const buffers = [];
  const segments = [];
  const wordSegments = [];
  let offset = 0;

  for (const part of parts) {
    const result = await synthesizeChunkRobust(part, voice, rate, depth);
    buffers.push(result.buffer);
    for (const seg of result.segments || []) {
      segments.push({
        ...seg,
        start: Number((seg.start + offset).toFixed(3)),
        end: Number((seg.end + offset).toFixed(3)),
      });
    }
    for (const seg of result.wordSegments || []) {
      wordSegments.push({
        ...seg,
        start: Number((seg.start + offset).toFixed(3)),
        end: Number((seg.end + offset).toFixed(3)),
      });
    }
    const lastEnd =
      (result.segments || []).reduce((m, s) => Math.max(m, Number(s.end) || 0), 0) ||
      (result.wordSegments || []).reduce((m, s) => Math.max(m, Number(s.end) || 0), 0) ||
      0;
    offset += lastEnd;
    // Small pause avoids Edge stream truncation on long runs.
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  return {
    buffer: buffers.length === 1 ? buffers[0] : Buffer.concat(buffers),
    segments,
    wordSegments,
    chunkEnd: offset,
  };
};

const synthesizeChunkRobust = async (chunk, voice, rate, depth = 0) => {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await synthesizeChunk(chunk, voice, rate);
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  // IMPORTANT: never switch to a different speaker mid-video (that made the
  // voice change gender/language halfway). Retry again with a shorter slice
  // of the SAME text using the SAME voice.
  const clean = stripMarkdown(chunk).trim();
  if (clean.length > 120 && depth < 4) {
    const parts = splitIntoSpeechChunks(clean, Math.max(70, Math.ceil(clean.length / 2)));
    if (parts.length > 1) {
      console.warn(
        '[tts] retrying failed chunk with the same voice in',
        parts.length,
        'shorter pieces:',
        voice,
      );
      return speakChunks(parts, voice, rate, depth + 1);
    }
  }

  throw lastError || new Error('TTS chunk failed');
};

/**
 * Speaks a sentence that mixes scripts, giving every run the voice that is
 * native to it.
 *
 * "افتح ملف ISO من Kali Linux" is spoken as Arabic with an Arabic voice and
 * the English names with an English voice, instead of the Arabic voice
 * mangling them into Arabic phonetics.
 */
export const synthesizeSpeechMixedScript = async (text, voice, options = {}) => {
  const secondaryVoice =
    options.secondaryVoice || technicalTermVoiceFor(voice);
  const runs = splitIntoScriptRuns(text);

  const hasLatin = runs.some((run) => run.kind === 'latin');
  const hasTarget = runs.some((run) => run.kind === 'target');

  if (!hasLatin || !hasTarget) {
    return synthesizeSpeech(text, voice, { ...options, mixedScript: false });
  }

  const pcmParts = [];
  const buffers = [];
  const segments = [];
  const wordSegments = [];
  let offset = 0;

  for (const run of runs) {
    // A run without letters or digits cannot be spoken (Edge returns empty
    // audio for a stray diacritic), so it is skipped instead of failing the
    // whole sentence.
    if (!SPEAKABLE_PATTERN.test(run.text)) continue;

    const runVoice = run.kind === 'latin' ? secondaryVoice : voice;

    let result = null;
    try {
      result = await synthesizeSpeech(run.text, runVoice, {
        ...options,
        mixedScript: false,
      });
    } catch (error) {
      console.warn('[tts] mixed script run failed, skipping:', error?.message);
      continue;
    }
    if (!result?.buffer?.length) continue;

    // Raw PCM is concatenated byte for byte; the WAV wrapper is added once
    // at the end.
    const pcm = result.pcm || (await decodeToPcm(result.buffer));
    if (pcm?.length) pcmParts.push(pcm);
    else buffers.push(result.buffer);

    for (const seg of result.segments || []) {
      segments.push({
        ...seg,
        start: Number((Number(seg.start || 0) + offset).toFixed(3)),
        end: Number((Number(seg.end || 0) + offset).toFixed(3)),
      });
    }
    for (const seg of result.wordSegments || []) {
      wordSegments.push({
        ...seg,
        start: Number((Number(seg.start || 0) + offset).toFixed(3)),
        end: Number((Number(seg.end || 0) + offset).toFixed(3)),
      });
    }

    const lastEnd =
      (result.segments || []).reduce((m, s) => Math.max(m, Number(s.end) || 0), 0) ||
      (result.wordSegments || []).reduce((m, s) => Math.max(m, Number(s.end) || 0), 0) ||
      0;
    offset += lastEnd;
  }

  let finalBuffer;
  if (pcmParts.length > 0) {
    finalBuffer = pcmToWav(Buffer.concat(pcmParts));
  } else if (buffers.length === 1) {
    finalBuffer = buffers[0];
  } else {
    finalBuffer = Buffer.concat(buffers);
  }

  return {
    buffer: finalBuffer,
    pcm: pcmParts.length > 0 ? Buffer.concat(pcmParts) : null,
    segments,
    wordSegments,
    chunkEnd: offset,
  };
};

/**
 * Wraps raw 16 bit PCM in a WAV container.
 *
 * The pipeline works with raw PCM internally because raw samples can be
 * concatenated byte for byte, while WAV files cannot (every file carries its
 * own header).
 */
const pcmToWav = (pcm, sampleRate = 24000, channels = 1, bitsPerSample = 16) => {
  const data = pcm || Buffer.alloc(0);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE((sampleRate * channels * bitsPerSample) / 8, 28);
  header.writeUInt16LE((channels * bitsPerSample) / 8, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
};

/**
 * Cuts the silent padding Edge TTS puts around every request.
 *
 * The word boundaries tell us exactly where the speech is: the request starts
 * ~0.1s in and ends ~0.95s before the audio does. Cutting with `atrim` on
 * those known boundaries is precise, unlike a level threshold which would
 * also chew into quiet speech.
 *
 * A sentence with internal pauses kept its ~1s of trailing silence, which
 * inflated every measured duration, forced the whole dub into a heavier tempo
 * compression and left audible gaps between the sentences.
 */
const trimToSpeechSpan = async (buffer, startSeconds, endSeconds) => {
  if (!buffer?.length) return null;

  const safeStart = Math.max(0, Number(startSeconds) - 0.05);
  const safeEnd = Math.max(safeStart + 0.05, Number(endSeconds) + 0.1);

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const inputPath = path.join(os.tmpdir(), `tts-trim-in-${stamp}.mp3`);
  const outputPath = path.join(os.tmpdir(), `tts-trim-out-${stamp}.pcm`);

  try {
    fs.writeFileSync(inputPath, buffer);
    await runFfmpegTrim([
      '-y',
      '-i',
      inputPath,
      '-af',
      `atrim=start=${safeStart.toFixed(3)}:end=${safeEnd.toFixed(3)},asetpts=PTS-STARTPTS`,
      '-f',
      's16le',
      '-ar',
      '24000',
      '-ac',
      '1',
      outputPath,
    ]);

    if (!fs.existsSync(outputPath)) return null;
    const pcm = fs.readFileSync(outputPath);
    return pcm.length ? pcm : null;
  } catch (error) {
    console.warn('[tts] speech trim failed, keeping original audio:', error?.message);
    return null;
  } finally {
    for (const file of [inputPath, outputPath]) {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch {
        // ignore
      }
    }
  }
};

/** Decodes any audio buffer to raw 16 bit PCM. */
const decodeToPcm = async (buffer) => {
  if (!buffer?.length) return null;
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const inputPath = path.join(os.tmpdir(), `tts-dec-in-${stamp}.mp3`);
  const outputPath = path.join(os.tmpdir(), `tts-dec-out-${stamp}.pcm`);
  try {
    fs.writeFileSync(inputPath, buffer);
    await runFfmpegTrim([
      '-y',
      '-i',
      inputPath,
      '-f',
      's16le',
      '-ar',
      '24000',
      '-ac',
      '1',
      outputPath,
    ]);
    if (!fs.existsSync(outputPath)) return null;
    const pcm = fs.readFileSync(outputPath);
    return pcm.length ? pcm : null;
  } catch {
    return null;
  } finally {
    for (const file of [inputPath, outputPath]) {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch {
        // ignore
      }
    }
  }
};

export const synthesizeSpeech = async (text, voice, options = {}) => {
  const elevenLabsVoiceId =
    options.voiceId || options.elevenLabsVoiceId || env.elevenLabsDefaultVoiceId;

  // When the caller selected a specific Edge speaker we must use exactly that
  // speaker. Otherwise a leftover ElevenLabs/Google voice from .env would be
  // used instead and the dub would not sound like the chosen voice.
  const provider = options.provider;
  const looksLikeEdgeVoice = /^[a-z]{2,3}-[A-Z]{2,4}-[A-Za-z]+Neural$/.test(String(voice || ''));
  const forceEdge =
    provider === 'edge' ||
    options.forceEdge === true ||
    (provider !== 'elevenlabs' && provider !== 'google' && looksLikeEdgeVoice);

  // Mixed script narration: English technical names and numbers inside an
  // Arabic sentence are spoken by an English voice.
  if (forceEdge && options.mixedScript === true) {
    return synthesizeSpeechMixedScript(text, voice, options);
  }

  if (!forceEdge && elevenLabsVoiceId && env.elevenLabsApiKey) {
    try {
      return await synthesizeWithElevenLabs(text, elevenLabsVoiceId, options);
    } catch (error) {
      const message = String(error?.message || '');
      // Do not stop the whole lesson if an optional paid voice is out of credits.
      console.warn('[tts] ElevenLabs failed; trying Google Cloud TTS:', message);
    }
  }

  const googleVoice = String(options.googleVoice || env.googleTtsVoice || '').trim();
  if (!forceEdge && googleVoice && env.googleTtsApiKey) {
    try {
      return await synthesizeWithGoogleCloud(text, googleVoice, options);
    } catch (error) {
      console.warn('[tts] Google Cloud TTS failed; falling back to free Edge TTS:', error?.message || error);
    }
  }

  const rate = options.rate || '-3%';
  const report = options.onProgress;
  const clean = stripMarkdown(text);
  const chunks = splitIntoSpeechChunks(clean, 260).filter(Boolean);

  if (chunks.length === 0) throw new Error('No speech could be generated');

  const results = [];
  const allSegments = [];
  const allWordSegments = [];
  let offset = 0;

  for (const chunk of chunks) {
    const result = await synthesizeChunkRobust(chunk, voice, rate);
    results.push(result);
    // Small pause helps avoid Edge TTS stream truncation on longer runs.
    await new Promise((resolve) => setTimeout(resolve, 350));
    for (const seg of result.segments) {
      allSegments.push({
        start: Number((seg.start + offset).toFixed(3)),
        end: Number((seg.end + offset).toFixed(3)),
        text: seg.text,
      });
    }
    for (const seg of result.wordSegments || []) {
      allWordSegments.push({
        start: Number((seg.start + offset).toFixed(3)),
        end: Number((seg.end + offset).toFixed(3)),
        text: seg.text,
      });
    }
    if (allSegments.length > 0) {
      offset = allSegments[allSegments.length - 1].end;
    } else if (allWordSegments.length > 0) {
      offset = allWordSegments[allWordSegments.length - 1].end;
    }
    if (report) {
      try {
        await report(Math.round((results.length / chunks.length) * 100));
      } catch {
        // ignore
      }
    }
  }

  const buffers = results.map((r) => r.buffer);
  let finalBuffer;
  if (buffers.length === 1) {
    finalBuffer = buffers[0];
  } else {
    const files = buffers.map((b, i) => path.join(os.tmpdir(), `tts-chunk-${Date.now()}-${i}.mp3`));
    files.forEach((f, i) => fs.writeFileSync(f, buffers[i]));
    const out = path.join(os.tmpdir(), `tts-merged-${Date.now()}.mp3`);
    try {
      await runFfmpegConcat(files, out);
      finalBuffer = fs.readFileSync(out);
    } finally {
      for (const f of [...files, out]) {
        try {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        } catch {
          // ignore
        }
      }
    }
  }

  const finalSegments = allSegments.filter((s) => s.text);
  const finalWordSegments = allWordSegments.filter((s) => s.text);

  // Cut the padding Edge adds around every request, using the word
  // boundaries it reported so no speech is touched.
  let finalOut = finalBuffer;
  let pcm = null;
  let shift = 0;
  if (finalWordSegments.length > 0) {
    const first = Math.min(...finalWordSegments.map((s) => Number(s.start) || 0));
    const last = Math.max(...finalWordSegments.map((s) => Number(s.end) || 0));
    if (last > first) {
      const trimmed = await trimToSpeechSpan(finalBuffer, first, last);
      if (trimmed) {
        pcm = trimmed;
        finalOut = pcmToWav(trimmed);
        shift = first;
      }
    }
  }

  const shifted = (segments) =>
    segments.map((seg) => ({
      ...seg,
      start: Number(Math.max(0, Number(seg.start || 0) - shift).toFixed(3)),
      end: Number(Math.max(0, Number(seg.end || 0) - shift).toFixed(3)),
    }));

  return {
    buffer: finalOut,
    pcm,
    segments:
      shifted(finalSegments).length > 0
        ? shifted(finalSegments)
        : [{ start: 0, end: 0, text: clean }],
    wordSegments: shifted(finalWordSegments),
  };
};