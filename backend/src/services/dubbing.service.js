import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import { env } from '../config/env.js';
import { resolveSourcePath, storeFile, isLocalStorage } from './storage.service.js';
import { repairTranslationSegments } from './technicalTerms.service.js';
import { synthesizeSpeech, VOICES } from './tts.service.js';
import {
  translateTranscriptSegments,
  findUntranslatedSegments,
  condenseTranslationForDuration,
} from './aiMetadata.service.js';

const TEMP_DIR = os.tmpdir();

const writeTempFile = (name, buffer) => {
  const file = path.join(TEMP_DIR, name);
  fs.writeFileSync(file, buffer);
  return file;
};

const cleanup = (files) => {
  for (const file of files) {
    try {
      if (file && fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      // best-effort cleanup
    }
  }
};

const runFfmpeg = (args, options = {}) =>
  new Promise((resolve, reject) => {
    const proc = spawn(ffmpegStatic, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: options.cwd || undefined,
    });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(-800)}`));
    });
  });

const formatSrtTime = (seconds) => {
  const total = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  const millis = Math.round((total - Math.floor(total)) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
};

const toSrt = (segments) =>
  segments
    .map((segment, index) => {
      const start = formatSrtTime(segment.start);
      const end = formatSrtTime(Math.max(segment.end, segment.start + 0.4));
      const text = String(segment.text || '').replace(/\r\n?/g, '\n').trim();
      return `${index + 1}\n${start} --> ${end}\n${text}\n`;
    })
    .join('\n');

// Yellow subtitles, compact and readable: current spoken phrase in 1-2 short
// lines near the bottom without covering the screen.
const SUBTITLE_STYLE =
  "FontName=Arial,FontSize=20,Bold=1,PrimaryColour=&H0000FFFF,OutlineColour=&H00000000,BackColour=&H80000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=20,MarginL=60,MarginR=60,Alignment=2,WrapStyle=2";

// Arabic diacritics (tashkeel) overlap badly in burned-in subtitles and add
// nothing for reading, so they are removed from the subtitle text only. The
// spoken text keeps them for a correct TTS pronunciation.
const stripArabicTashkeel = (text = '') =>
  String(text || '').replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '');

const getAudioDurationSeconds = async (filePath) => {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegStatic, ['-hide_banner', '-i', filePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('close', () => {
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (match) {
        resolve(
          Number(match[1]) * 3600 +
            Number(match[2]) * 60 +
            Number(match[3]),
        );
      } else {
        resolve(0);
      }
    });
    proc.on('error', () => resolve(0));
  });
};

const estimateSpeechSeconds = (text, language) => {
  const rates = { ar: 12, en: 14, default: 13 };
  const rate = rates[language] || rates.default;
  return Math.max(0.5, String(text || '').trim().length / rate);
};

const wrapSubtitleText = (text, maxCharsPerLine = 34, maxLines = 2) => {
  // Keep display text as-is except whitespace normalization and wrapping.
  // (Do not strip Arabic tashkeel globally here; callers may rely on original text.)
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const words = clean.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      // If a single word is very long, hard-wrap it.
      if (word.length > maxCharsPerLine) {
        let rest = word;
        while (rest.length > maxCharsPerLine && lines.length < maxLines) {
          lines.push(rest.slice(0, maxCharsPerLine));
          rest = rest.slice(maxCharsPerLine);
        }
        line = rest;
      } else {
        line = word;
      }
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  return lines.slice(0, maxLines).join('\n');
};

const splitTextForSubtitles = (text, maxChunkChars = 70) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxChunkChars) return [clean];
  // Prefer splitting at sentence/phrase boundaries, then by words.
  const parts = clean
    .split(/(?<=[.!?ØŸØŒ,Ø›:])\s+|\s+[â€“â€”-]\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const units = parts.length > 1 ? parts : clean.split(/\s+/);
  const chunks = [];
  let current = '';
  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };
  for (const unit of units) {
    if (!unit) continue;
    const candidate = current ? `${current} ${unit}` : unit;
    if (candidate.length <= maxChunkChars) {
      current = candidate;
      continue;
    }
    if (current) pushCurrent();
    if (unit.length <= maxChunkChars) {
      current = unit;
    } else {
      // Hard-split very long units by words.
      const words = unit.split(/\s+/);
      let buf = '';
      for (const w of words) {
        const cand = buf ? `${buf} ${w}` : w;
        if (cand.length <= maxChunkChars) buf = cand;
        else {
          if (buf) chunks.push(buf.trim());
          buf = w.length > maxChunkChars ? w.slice(0, maxChunkChars) : w;
          if (w.length > maxChunkChars) {
            chunks.push(buf);
            buf = w.slice(maxChunkChars);
          }
        }
      }
      current = buf;
    }
  }
  pushCurrent();
  return chunks.length ? chunks : [clean];
};

const buildBurnSubtitleCues = (block, startAt, fittedDuration, videoDuration) => {
  const blockStart = Math.max(0, Number(startAt) || 0);
  const naturalEnd = blockStart + Math.max(0.4, Number(fittedDuration) || 0);
  const blockEnd = videoDuration > 0 ? Math.min(naturalEnd, videoDuration) : naturalEnd;
  const duration = Math.max(0.4, blockEnd - blockStart);

  // Prefer preserving original segment texts/timing proportions (from reference
  // SRT/transcript segments) when available, so subtitles stay closer to the
  // source cues instead of being arbitrarily re-chunked.
  const items = Array.isArray(block?.items) ? block.items.filter((it) => String(it?.text || '').trim()) : [];
  if (items.length > 0) {
    const sourceStart = Math.min(...items.map((it) => Number(it.start) || 0));
    const sourceEnd = Math.max(...items.map((it) => Math.max(Number(it.end) || 0, (Number(it.start) || 0) + 0.01)));
    const sourceSpan = Math.max(0.01, sourceEnd - sourceStart);
    const cues = [];
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i];
      const relStart = Math.max(0, Math.min(1, ((Number(it.start) || 0) - sourceStart) / sourceSpan));
      const relEnd = Math.max(relStart + 0.01, Math.min(1, ((Number(it.end) || 0) - sourceStart) / sourceSpan));
      let start = blockStart + duration * relStart;
      let end = blockStart + duration * (i === items.length - 1 ? 1 : relEnd);
      end = Math.max(start + 0.25, Math.min(blockEnd, end));
      start = Math.min(start, end - 0.2);
      const text = wrapSubtitleText(String(it.text || '').trim()) || String(it.text || '').trim();
      if (!text) continue;
      cues.push({ start, end, text });
    }
    if (cues.length) {
      cues[0].start = blockStart;
      cues[cues.length - 1].end = blockEnd;
      for (let i = 1; i < cues.length; i += 1) {
        if (cues[i].start < cues[i - 1].end) cues[i].start = cues[i - 1].end;
        if (cues[i].end <= cues[i].start) cues[i].end = Math.min(blockEnd, cues[i].start + 0.25);
      }
      cues[cues.length - 1].end = Math.max(cues[cues.length - 1].end, blockEnd);
      return cues;
    }
  }

  const text = String(block?.text || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];

  const chunks = splitTextForSubtitles(text, 70);
  if (chunks.length <= 1) {
    return [{ start: blockStart, end: blockEnd, text: wrapSubtitleText(text) || text }];
  }

  const weights = chunks.map((c) => Math.max(1, c.replace(/\s+/g, '').length));
  const total = weights.reduce((a, b) => a + b, 0) || chunks.length;
  let cursor = blockStart;
  const cues = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const isLast = i === chunks.length - 1;
    const end = isLast
      ? blockEnd
      : Math.min(blockEnd, cursor + duration * (weights[i] / total));
    const safeEnd = Math.max(cursor + 0.25, end);
    cues.push({ start: cursor, end: safeEnd, text: wrapSubtitleText(chunks[i]) || chunks[i] });
    cursor = safeEnd;
  }
  if (cues.length) cues[cues.length - 1].end = Math.max(cues[cues.length - 1].end, blockEnd);
  return cues;
};

const createSilenceWav = async (durationSeconds, filePath) => {
  if (durationSeconds <= 0.02) return false;
  await runFfmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=24000:cl=mono',
    '-t',
    durationSeconds.toFixed(3),
    '-acodec',
    'pcm_s16le',
    '-ar',
    '24000',
    '-ac',
    '1',
    filePath,
  ]);
  return fs.existsSync(filePath);
};

const normalizeToWav = async (inputPath, outputPath) => {
  await runFfmpeg([
    '-y',
    '-i',
    inputPath,
    '-acodec',
    'pcm_s16le',
    '-ar',
    '24000',
    '-ac',
    '1',
    outputPath,
  ]);
};

export const getTranslationSegments = async (video, language, onProgress = null) => {
  const originalLanguage = video.originalLanguage || video.transcriptLanguage || 'en';
  const toSegment = (s) => ({
    start: Number(s.start) || 0,
    end: Number(s.end) || 0,
    text: String(s.text || '').trim(),
    spokenText: String(s.spokenText || s.text || '').trim(),
  });

  if (String(language).toLowerCase() === String(originalLanguage).toLowerCase()) {
    return (video.transcriptSegments || []).map(toSegment);
  }

  const existing = (video.translations || []).find(
    (t) => String(t.language).toLowerCase() === String(language).toLowerCase(),
  );
  if (existing?.segments?.length) {
    // Stored translations were produced before the technical-term glossary
    // existed, so they can still say "erminal" or "gues edition". Repairing
    // them here fixes an already saved dub without another model call.
    const segments = repairTranslationSegments({
      segments: existing.segments,
      sourceSegments: video.transcriptSegments || [],
      targetLanguage: language,
    }).map(toSegment);

    // A stored translation can be stale, or it can have been saved while the
    // AI provider was rate limited and still contain the source language.
    // Dubbing it would speak English with a foreign voice, so it is verified
    // first and re-translated when it is not really in the target language.
    const untranslated = findUntranslatedSegments({
      segments,
      targetLanguage: language,
      sourceSegments: video.transcriptSegments || [],
      sourceLanguage: originalLanguage,
    });

    // A translation without a spoken version would read the English technical
    // names with the Arabic voice, so it is regenerated as well.
    const missingSpoken = segments.filter(
      (s) => !String(s.spokenText || '').trim(),
    ).length;

    if (untranslated.length === 0 && missingSpoken === 0) {
      return segments;
    }
    console.warn(
      `[dubbing] stored translation for ${language} needs regenerating (${untranslated.length} untranslated, ${missingSpoken} without a spoken version) - re-translating`,
    );
  }

  if (Array.isArray(video.transcriptSegments) && video.transcriptSegments.length) {
    const translated = await translateTranscriptSegments({
      segments: video.transcriptSegments,
      targetLanguage: language,
      originalLanguage,
      onProgress,
    });

    const untranslated = findUntranslatedSegments({
      segments: translated,
      targetLanguage: language,
      sourceSegments: video.transcriptSegments || [],
      sourceLanguage: originalLanguage,
    });
    if (untranslated.length > 0) {
      const err = new Error(
        `Translation to ${language} is incomplete: ${untranslated.length} of ${translated.length} segments are still in ${originalLanguage}. The AI provider is most likely rate limited - please try again.`,
      );
      err.code = 'TRANSLATION_FAILED';
      err.statusCode = 502;
      throw err;
    }

    return translated.map(toSegment);
  }

  return [];
};


const normalizeSegmentTiming = (segments, totalDuration) => {
  const normalized = (segments || [])
    .map((segment) => ({
      start: Math.max(0, Number(segment?.start) || 0),
      end: Math.max(Number(segment?.end) || 0, (Number(segment?.start) || 0) + 0.1),
      text: String(segment?.text || '').trim(),
    }))
    .filter((segment) => segment.text)
    .sort((a, b) => a.start - b.start);

  if (normalized.length === 0) return normalized;

  if (totalDuration > 0) {
    // Keep the final cue visible through the end of the source video so the
    // subtitles never finish while the video is still playing.
    normalized[normalized.length - 1].end = Math.max(
      normalized[normalized.length - 1].end,
      totalDuration,
    );
    let cursor = 0;
    for (const segment of normalized) {
      if (segment.start < cursor) segment.start = cursor;
      if (segment.end <= segment.start) segment.end = segment.start + 0.1;
      cursor = segment.end;
    }
  }

  return normalized;
};

// Arabic and other non-latin languages need noticeably longer than English
// for the same content. Keep tempo close to natural and fit speech to the
// original (SRT/reference) segment timing as much as possible to avoid drift.
const DUB_AUDIO_LEAD_OFFSET = Number(process.env.DUB_AUDIO_LEAD_OFFSET) || 0.5;
const MAX_TEMPO = 1.3;
const MIN_TEMPO = 0.85;
const MAX_SLOT_TEMPO = 1.45;

/**
 * Merge subtitle cues into whole sentences.
 *
 * Dubbing cue-by-cue forces every short cue to fit its own ~2s slot, which is
 * what produced the 2x speed-ups and the mid-word cuts. Speaking whole
 * sentences and letting them use the surrounding pauses sounds natural.
 */
export const mergeCuesIntoSentences = (segments, videoDuration) => {
  const blocks = [];
  let current = null;

  for (const segment of segments) {
    const spoken = String(segment.spokenText || segment.text || '').trim();
    if (!current) {
      current = {
        start: segment.start,
        end: segment.end,
        texts: [segment.text],
        spoken: [spoken],
      };
      continue;
    }
    const gap = segment.start - current.end;
    const combined = `${current.texts.join(" ")} ${segment.text}`.replace(/\s+/g, " ");
    const endsSentence = /[.!?ØŸÛ”â€¦]["'â€â€™)\]]?\s*$/.test(current.texts[current.texts.length - 1]);
    if (gap <= 0.9 && combined.length <= 320 && !endsSentence) {
      current.end = segment.end;
      current.texts.push(segment.text);
      current.spoken.push(spoken);
    } else {
      blocks.push(current);
      current = {
        start: segment.start,
        end: segment.end,
        texts: [segment.text],
        spoken: [spoken],
      };
    }
  }
  if (current) blocks.push(current);

  return blocks
    .map((block, index) => ({
      start: block.start,
      end: block.end,
      nextStart:
        index + 1 < blocks.length
          ? blocks[index + 1].start
          : Math.max(block.end, videoDuration || block.end),
      // The subtitles keep the English technical names in Latin script, the
      // narration reads them the way an Arabic speaker pronounces them.
      text: block.texts.join(" ").replace(/\s+/g, " ").trim(),
      spokenText: block.spoken.join(" ").replace(/\s+/g, " ").trim(),
    }))
    .filter((block) => block.text);
};

/**
 * Applies a single tempo factor to a clip.
 *
 * The whole dub uses one uniform tempo (see `planDubTiming`) instead of
 * speeding every sentence up individually, which is what made some sentences
 * sound rushed while others stayed natural.
 */
const applyTempo = async (inputPath, outputPath, tempo) => {
  if (tempo > 1.02 || tempo < 0.98) {
    await runFfmpeg([
      '-y',
      '-i',
      inputPath,
      '-filter:a',
      `atempo=${tempo.toFixed(4)}`,
      '-acodec',
      'pcm_s16le',
      '-ar',
      '24000',
      '-ac',
      '1',
      outputPath,
    ]);
  } else {
    await normalizeToWav(inputPath, outputPath);
  }
  return (await getAudioDurationSeconds(outputPath)) || 0;
};

/**
 * Works out the single tempo that lets the whole narration fit the video.
 *
 * The target language is usually longer than the English source (Arabic needs
 * ~1.3x the time for the same content), so the dub has to be compressed to
 * stay in sync. Compressing it once, uniformly, keeps the voice natural -
 * per-sentence clamping produced a rushed voice on some lines and a slow one
 * on others.
 */
export const planDubTiming = ({ totalSpeechSeconds, videoDuration }) => {
  const totalSpeech = Math.max(0, Number(totalSpeechSeconds) || 0);
  const available = Math.max(0, Number(videoDuration) || 0);

  if (!totalSpeech || !available) return 1;

  const required = totalSpeech / available;
  if (required <= 1.02) return 1;

  return Math.min(MAX_TEMPO, required);
};

export const generateDubbedVideo = async ({ video, language, voice = null, elevenLabsVoiceId = null, onProgress = null }) => {
  // Local storage is used for dub output (Cloudinary uploads disabled).

  const videoDuration = Math.max(0, Number(video.durationSeconds) || 0);
  const reportProgress = async (value) => {
    if (!onProgress) return;
    try {
      await onProgress(value);
    } catch (progressError) {
      if (progressError?.code === 'DUB_CANCELLED') throw progressError;
    }
  };

  const segments = normalizeSegmentTiming(
    (await getTranslationSegments(video, language, async (ratio) => {
      // Translating the transcript is the slowest part of a dub, so it gets
      // its own slice of the progress bar instead of looking stuck.
      await reportProgress(Math.min(35, 10 + Math.round(ratio * 25)));
    })).map((s) => ({
      start: Math.max(0, Number(s.start) || 0),
      end: Math.max(Number(s.end) || 0, (Number(s.start) || 0) + 0.1),
      text: String(s.text || '').trim(),
    })),
    videoDuration,
  )
    .filter((s) => s.text)
    .sort((a, b) => a.start - b.start);

  if (segments.length === 0) {
    const err = new Error('No timed transcript segments available for dubbing');
    err.statusCode = 400;
    throw err;
  }

  const selectedVoice = voice || VOICES[language] || VOICES.en;
  // Detect the provider of the chosen voice so the comparison below only
  // tries providers that actually match it. An Edge voice name always ends in
  // "Neural"; a Google voice name looks like "ar-XA-Wavenet-A"; anything else
  // is treated as an ElevenLabs voice id.
  const looksLikeEdgeVoice = /^[a-z]{2,3}-[A-Z]{2,4}-[A-Za-z]+Neural$/.test(String(selectedVoice));
  const looksLikeGoogleVoice =
    !looksLikeEdgeVoice &&
    /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(String(selectedVoice));

  // One voice for the whole dub. Mixing providers per sentence produced an
  // incoherent narration that did not match the video. The provider is chosen
  // once, from the voice the user picked, and used for every sentence.
  const providerForDub = looksLikeEdgeVoice
    ? 'edge'
    : looksLikeGoogleVoice
      ? 'google'
      : env.elevenLabsApiKey && env.elevenLabsDefaultVoiceId
        ? 'elevenlabs'
        : env.googleTtsApiKey && env.googleTtsVoice
          ? 'google'
          : 'edge';
  const voiceForDub =
    providerForDub === 'edge'
      ? (looksLikeEdgeVoice ? selectedVoice : (VOICES[language] || VOICES.en))
      : providerForDub === 'google'
        ? (looksLikeGoogleVoice ? selectedVoice : env.googleTtsVoice)
        : env.elevenLabsDefaultVoiceId;

  const blocks = mergeCuesIntoSentences(segments, videoDuration);

  const tempFiles = [];
  const clips = [];
  const burnSegments = [];
  const prepared = [];

  // Phase 1 - speak every sentence at natural speed and measure it.
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];

    if (videoDuration > 0 && block.start >= videoDuration) break;

    // The narration uses the spoken version for TTS; subtitles keep the display text.
    let spokenText = String(block.spokenText || block.text || '').trim();

    // Per-block fitting: if this sentence's natural speech is longer than
    // its slot on the timeline, condense the spoken text (never the subtitle
    // text) so the sentence finishes inside its slot instead of being cut
    // mid-word by the global -t. Condensing is per-block (not per-cue) so
    // the voice stays natural - a single uniform tempo is still applied
    // afterwards to the whole narration.
    const slotEnd = Number(block.nextStart) > block.start
      ? Number(block.nextStart)
      : (videoDuration > 0 ? videoDuration : block.end);
    const slot = Math.max(0.4, slotEnd - block.start);

    const synthesize = async (text) => {
      const candidates = [];

      if (providerForDub === 'edge') {
        try {
        const tts = await synthesizeSpeech(text, selectedVoice, {
          provider: 'edge',
          rate: '+2%',
          mixedScript: false,
        });
        if (tts?.buffer?.length) {
          const f = path.join(
            TEMP_DIR,
            `dub-tts-${video._id}-${language}-${i}-${Date.now()}.mp3`,
          );
          tempFiles.push(f);
          fs.writeFileSync(f, tts.buffer);
          let d = await getAudioDurationSeconds(f);
          if (!d) d = estimateSpeechSeconds(text, language);
          candidates.push({ provider: 'edge', file: f, duration: d });
        }
      } catch (error) {
        console.warn('[dubbing] Edge TTS failed for sentence', i + 1, error?.message);
      }
      } // end if (looksLikeEdgeVoice)

      // Second opinion: ElevenLabs, when configured, so the two voices can be
      // compared and the better fit kept (target >= 95% intelligibility).
      if (providerForDub === 'elevenlabs' && env.elevenLabsApiKey && env.elevenLabsDefaultVoiceId) {
        try {
          const tts = await synthesizeSpeech(
            text,
            env.elevenLabsDefaultVoiceId,
            { provider: 'elevenlabs', voiceId: env.elevenLabsDefaultVoiceId },
          );
          if (tts?.buffer?.length) {
            const f = path.join(
              TEMP_DIR,
              `dub-tts-${video._id}-${language}-${i}-${Date.now()}-el.mp3`,
            );
            tempFiles.push(f);
            fs.writeFileSync(f, tts.buffer);
            let d = await getAudioDurationSeconds(f);
            if (!d) d = estimateSpeechSeconds(text, language);
            candidates.push({ provider: 'elevenlabs', file: f, duration: d });
          }
        } catch (error) {
          console.warn('[dubbing] ElevenLabs TTS failed for sentence', i + 1, error?.message);
        }
      }

      // Third option: Google Cloud TTS (when configured). Use the user's
      // selected Google voice if it is one, otherwise the env default, but only
      // when it matches the language being dubbed.
      const googleVoiceToTry = looksLikeGoogleVoice
        ? selectedVoice
        : env.googleTtsVoice;
      if (
        providerForDub === 'google' &&
        env.googleTtsApiKey &&
        googleVoiceToTry &&
        String(googleVoiceToTry).toLowerCase().startsWith(String(language || '').toLowerCase().split('-')[0])
      ) {
        try {
          const tts = await synthesizeSpeech(
            text,
            googleVoiceToTry,
            { provider: 'google', googleVoice: googleVoiceToTry },
          );
          if (tts?.buffer?.length) {
            const f = path.join(
              TEMP_DIR,
              `dub-tts-${video._id}-${language}-${i}-${Date.now()}-gcp.mp3`,
            );
            tempFiles.push(f);
            fs.writeFileSync(f, tts.buffer);
            let d = await getAudioDurationSeconds(f);
            if (!d) d = estimateSpeechSeconds(text, language);
            candidates.push({ provider: 'google', file: f, duration: d });
          }
        } catch (error) {
          console.warn('[dubbing] Google TTS failed for sentence', i + 1, error?.message);
        }
      }

      // Single voice for the whole dub: return the (only) candidate.
      if (candidates.length === 0) return null;
      const chosen = candidates[0];
      return { file: chosen.file, duration: chosen.duration };
    };

    let synth = await synthesize(spokenText);
    if (!synth) throw new Error(`TTS returned no audio for sentence ${i + 1}`);

    // Condensing via AI sometimes produced incomprehensible text, so it is
    // disabled. Overflow is handled by the uniform tempo (MAX_TEMPO) instead.
    prepared.push({ block, index: i, rawFile: synth.file, duration: synth.duration, spokenText });

    await reportProgress(
      Math.min(60, 35 + Math.round(((i + 1) / blocks.length) * 25)),
    );
  }

  if (prepared.length === 0) {
    throw new Error('Audio timeline assembly produced no clips');
  }

  // Phase 2/3 - per-block timing: fit each sentence into its own slot so audio
  // stays aligned with the original (SRT/reference) segment timing and does not
  // drift. Short sentences may be stretched slightly; long ones are compressed.
  const totalSpeech = prepared.reduce((sum, item) => sum + item.duration, 0);
  const videoFitTempo = planDubTiming({ totalSpeechSeconds: totalSpeech, videoDuration });
  if (videoFitTempo > 1.02) {
    console.log(
      `[dubbing] estimated overall compression ${videoFitTempo.toFixed(3)}x to fit ${videoDuration}s (per-slot timing applied)`,
    );
  }

  let cursor = 0;

  for (let i = 0; i < prepared.length; i += 1) {
    const { block, index, rawFile, duration } = prepared[i];

    const naturalEnd = Number(block.nextStart) > block.start
      ? Number(block.nextStart)
      : (videoDuration > 0 ? videoDuration : block.end);
    // Prefer the original segment start; if previous audio overflowed, continue
    // from cursor to avoid overlap (small local drift is better than overlap).
    const startAt = Math.max(block.start, cursor);
    const slotEnd = Math.max(startAt + 0.25, videoDuration > 0 ? Math.min(naturalEnd, videoDuration) : naturalEnd);
    const slotDuration = Math.max(0.3, slotEnd - startAt);

    const leadingGap = startAt - cursor;
    if (leadingGap > 0.02) {
      const silenceFile = path.join(
        TEMP_DIR,
        `dub-silence-${video._id}-${index}-${Date.now()}.wav`,
      );
      tempFiles.push(silenceFile);
      if (await createSilenceWav(leadingGap, silenceFile)) {
        clips.push(silenceFile);
        cursor += leadingGap;
      }
    }

    const rawDur = Number(duration) || (await getAudioDurationSeconds(rawFile)) || estimateSpeechSeconds(block.spokenText || block.text || '', language);
    let tempo = rawDur / slotDuration;
    if (!Number.isFinite(tempo) || tempo <= 0) tempo = 1;
    tempo = Math.min(MAX_SLOT_TEMPO, Math.max(MIN_TEMPO, tempo));
    // If it still won't fit at max tempo, keep max tempo (may overflow slightly)
    // rather than speeding up to unintelligible levels.
    const fittedFile = path.join(
      TEMP_DIR,
      `dub-fit-${video._id}-${language}-${index}-${Date.now()}.wav`,
    );
    tempFiles.push(fittedFile);

    const fittedDuration = await applyTempo(rawFile, fittedFile, tempo);

    clips.push(fittedFile);
    const cues = buildBurnSubtitleCues(block, startAt, fittedDuration, videoDuration);
    for (const cue of cues) {
      burnSegments.push({
        start: Number(cue.start.toFixed(3)),
        end: Number(cue.end.toFixed(3)),
        text: cue.text,
      });
    }
    cursor += fittedDuration > 0 ? fittedDuration : Math.max(0.4, block.end - block.start);

    if (onProgress) {
      try {
        await onProgress(Math.min(90, 60 + Math.round(((i + 1) / prepared.length) * 30)));
      } catch (progressError) {
        // A cancellation must stop the dub; other progress errors are harmless.
        if (progressError?.code === 'DUB_CANCELLED') throw progressError;
      }
    }
  }

  if (videoDuration > cursor + 0.02) {
    const trailingFile = path.join(
      TEMP_DIR,
      `dub-tail-${video._id}-${Date.now()}.wav`,
    );
    tempFiles.push(trailingFile);
    if (await createSilenceWav(videoDuration - cursor, trailingFile)) {
      clips.push(trailingFile);
      cursor = videoDuration;
    }
  }

  if (clips.length === 0) {
    throw new Error('Audio timeline assembly produced no clips');
  }

  const listFile = path.join(TEMP_DIR, `dub-concat-${video._id}-${Date.now()}.txt`);
  tempFiles.push(listFile);
  fs.writeFileSync(
    listFile,
    clips
      .map((file) => `file '${file.replace(/'/g, "'\''")}'`)
      .join('\n'),
  );

  const mergedAudio = path.join(
    TEMP_DIR,
    `dub-merged-${video._id}-${language}-${Date.now()}.wav`,
  );
  tempFiles.push(mergedAudio);

  await runFfmpeg([
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listFile,
    '-c',
    'copy',
    mergedAudio,
  ]);

  const outputFile = path.join(
    TEMP_DIR,
    `dubbed-${video._id}-${language}-${Date.now()}.mp4`,
  );
  tempFiles.push(outputFile);

  // Burn the translated subtitles into the dub so the video is self-contained.
  let subtitleFile = null;
  if (burnSegments.length > 0) {
    subtitleFile = path.join(
      TEMP_DIR,
      `dub-subs-${video._id}-${language}-${Date.now()}.srt`,
    );
    tempFiles.push(subtitleFile);
    fs.writeFileSync(subtitleFile, toSrt(burnSegments), 'utf8');
  }

  const videoArgs = subtitleFile
    ? [
        '-vf',
        `subtitles=${path.basename(subtitleFile)}:force_style='${SUBTITLE_STYLE}'`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
      ]
    : ['-c:v', 'copy'];

  try {
    // Fade the narration out over the last 0.6s so the dub ends smoothly
    // instead of being cut mid-word. The video keeps its original length.
    const fadeStart = Math.max(0, (videoDuration || 0) - 0.6);
    const audioFilter =
      videoDuration > 0
        ? `afade=t=out:st=${fadeStart.toFixed(3)}:d=0.6`
        : null;

    const sourceInput = resolveSourcePath(video) || video.publicUrl;
    const args = [
      '-y',
      '-i',
      sourceInput,
      '-i',
      mergedAudio,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      ...videoArgs,
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      ...(audioFilter ? ['-af', audioFilter] : []),
      '-movflags',
      '+faststart',
      ...(videoDuration > 0
        ? ['-t', String(videoDuration)]
        : ['-shortest']),
      outputFile,
    ];

    await runFfmpeg(args, { cwd: TEMP_DIR });

    const result = await storeFile({
      filePath: outputFile,
      subdir: 'dubs',
      originalName: path.basename(outputFile),
      mimeType: 'video/mp4',
      // If the source is local (Cloudinary limit/quota case), keep outputs local too.
      preferLocal: env.storageProvider === 'local' || isLocalStorage(video),
      cloudinaryOptions: {
        resource_type: 'video',
        folder: `${env.cloudinaryFolder}/dubs`,
        use_filename: true,
        unique_filename: true,
        overwrite: false,
      },
    });

    return {
      language,
      url: result.url,
      storagePath: result.storagePath,
      storageProvider: result.provider,
      durationSeconds: Math.round(result.duration || result.raw?.duration || videoDuration || 0),
      voice: selectedVoice,
      subtitlesBurned: Boolean(subtitleFile),
      segments: burnSegments,
    };
  } finally {
    cleanup([...tempFiles, mergedAudio, outputFile]);
  }
};
