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
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
    wordBoundaryEnabled: true,
    sentenceBoundaryEnabled: true,
  });

  const lang = String(voice || 'en-US').split('-').slice(0, 2).join('-');
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">` +
    `<voice name="${voice}"><prosody rate="${rate}" pitch="+1.5Hz">${escapeXml(chunkText)}</prosody></voice></speak>`;

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

export const synthesizeSpeech = async (text, voice, options = {}) => {
  const elevenLabsVoiceId =
    options.voiceId || options.elevenLabsVoiceId || env.elevenLabsDefaultVoiceId;
  if (elevenLabsVoiceId && env.elevenLabsApiKey) {
    return synthesizeWithElevenLabs(text, elevenLabsVoiceId, options);
  }

  const rate = options.rate || '-3%';
  const report = options.onProgress;
  const clean = stripMarkdown(text);
  const chunks = (clean.match(/.{1,4000}/gs) || [clean]).map((c) => c.trim()).filter(Boolean);

  if (chunks.length === 0) throw new Error('No speech could be generated');

  const results = [];
  const allSegments = [];
  const allWordSegments = [];
  let offset = 0;

  for (const chunk of chunks) {
    const result = await synthesizeChunk(chunk, voice, rate);
    results.push(result);
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
    if (result.chunkEnd && result.chunkEnd > 0) {
      offset += 0; // already included in segments; keep offset from last segment below
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
  return {
    buffer: finalBuffer,
    segments: finalSegments.length > 0 ? finalSegments : [{ start: 0, end: 0, text: clean }],
    wordSegments: finalWordSegments,
  };
};