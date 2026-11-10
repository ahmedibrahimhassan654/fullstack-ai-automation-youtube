import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import cloudinary, { isCloudinaryConfigured } from '../config/cloudinary.js';
import { env } from '../config/env.js';
import { synthesizeSpeech, VOICES } from './tts.service.js';
import { translateTranscriptSegments } from './aiMetadata.service.js';

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
      return `${index + 1}\n${start} --> ${end}\n${segment.text}\n`;
    })
    .join('\n');

// White text on a soft black box: readable on any footage.
const SUBTITLE_STYLE =
  "FontName=Arial,FontSize=18,PrimaryColour=&H00FFFFFF,BackColour=&H8C000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=30,Alignment=2";

const uploadFile = (filePath, options) =>
  new Promise((resolve, reject) => {
    cloudinary.uploader.upload(filePath, options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
  });

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

const getTranslationSegments = async (video, language) => {
  const originalLanguage = video.originalLanguage || video.transcriptLanguage || 'en';
  if (String(language).toLowerCase() === String(originalLanguage).toLowerCase()) {
    return (video.transcriptSegments || []).map((s) => ({
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
      text: String(s.text || '').trim(),
    }));
  }

  const existing = (video.translations || []).find(
    (t) => String(t.language).toLowerCase() === String(language).toLowerCase(),
  );
  if (existing?.segments?.length) {
    return existing.segments.map((s) => ({
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
      text: String(s.text || '').trim(),
    }));
  }

  if (Array.isArray(video.transcriptSegments) && video.transcriptSegments.length) {
    const translated = await translateTranscriptSegments({
      segments: video.transcriptSegments,
      targetLanguage: language,
      originalLanguage,
    });
    return translated.map((s) => ({
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
      text: String(s.text || '').trim(),
    }));
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

const MAX_TEMPO = 1.6;

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
    if (!current) {
      current = { start: segment.start, end: segment.end, texts: [segment.text] };
      continue;
    }
    const gap = segment.start - current.end;
    const combined = `${current.texts.join(" ")} ${segment.text}`.replace(/\s+/g, " ");
    const endsSentence = /[.!?؟۔…]["'”’)\]]?\s*$/.test(current.texts[current.texts.length - 1]);
    if (gap <= 0.9 && combined.length <= 320 && !endsSentence) {
      current.end = segment.end;
      current.texts.push(segment.text);
    } else {
      blocks.push(current);
      current = { start: segment.start, end: segment.end, texts: [segment.text] };
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
      text: block.texts.join(" ").replace(/\s+/g, " ").trim(),
    }))
    .filter((block) => block.text);
};

/**
 * Converts the spoken clip so that it fits the available window.
 * Never truncates audio (truncation was what cut words in the middle) -
 * if it still does not fit after MAX_TEMPO it is allowed to overflow into the
 * next pause, which keeps every word audible.
 */
const fitSpeechToWindow = async (inputPath, outputPath, sourceDuration, windowSeconds) => {
  const safeWindow = Math.max(0.5, Number(windowSeconds) || 0.5);
  const safeSource = Math.max(0.05, Number(sourceDuration) || 0.05);
  const ratio = safeSource / safeWindow;

  if (ratio <= 1.02) {
    await normalizeToWav(inputPath, outputPath);
    return safeSource;
  }

  const tempo = Math.min(MAX_TEMPO, ratio);
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

  const actual = await getAudioDurationSeconds(outputPath);
  return actual || safeSource / tempo;
};

export const generateDubbedVideo = async ({ video, language, voice = null, elevenLabsVoiceId = null, onProgress = null }) => {
  if (!isCloudinaryConfigured()) {
    const err = new Error('Cloudinary is not configured on the server');
    err.statusCode = 500;
    throw err;
  }

  const videoDuration = Math.max(0, Number(video.durationSeconds) || 0);
  const segments = normalizeSegmentTiming(
    (await getTranslationSegments(video, language)).map((s) => ({
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
  // A chosen Edge speaker must be used verbatim, even if an ElevenLabs /
  // Google voice is configured in the environment.
  const useEdge = /^[a-z]{2,3}-[A-Z]{2,4}-[A-Za-z]+Neural$/.test(String(selectedVoice));
  const ttsOptions = useEdge
    ? { provider: 'edge' }
    : { provider: 'elevenlabs', voiceId: elevenLabsVoiceId };

  const blocks = mergeCuesIntoSentences(segments, videoDuration);

  const tempFiles = [];
  const clips = [];
  const burnSegments = [];
  let cursor = 0;

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];

    if (videoDuration > 0 && block.start >= videoDuration) {
      cursor = videoDuration;
      break;
    }

    // If the previous sentence overflowed we simply continue from the cursor
    // instead of cutting the audio short.
    const startAt = Math.max(block.start, cursor);
    const leadingGap = startAt - cursor;
    if (leadingGap > 0.02) {
      const silenceFile = path.join(
        TEMP_DIR,
        `dub-silence-${video._id}-${i}-${Date.now()}.wav`,
      );
      tempFiles.push(silenceFile);
      if (await createSilenceWav(leadingGap, silenceFile)) {
        clips.push(silenceFile);
        cursor += leadingGap;
      }
    }

    const nextStart = Math.min(
      block.nextStart > startAt ? block.nextStart : videoDuration || block.end,
      videoDuration || Number.POSITIVE_INFINITY,
    );
    const window = Math.max(0.8, nextStart - startAt);

    const tts = await synthesizeSpeech(block.text, selectedVoice, ttsOptions);
    if (!tts?.buffer?.length) {
      throw new Error(`TTS returned no audio for sentence ${i + 1}`);
    }

    const rawTtsFile = path.join(
      TEMP_DIR,
      `dub-tts-${video._id}-${language}-${i}-${Date.now()}.mp3`,
    );
    tempFiles.push(rawTtsFile);
    fs.writeFileSync(rawTtsFile, tts.buffer);

    let sourceDuration = await getAudioDurationSeconds(rawTtsFile);
    if (!sourceDuration) {
      sourceDuration = estimateSpeechSeconds(block.text, language);
    }

    const fittedFile = path.join(
      TEMP_DIR,
      `dub-fit-${video._id}-${language}-${i}-${Date.now()}.wav`,
    );
    tempFiles.push(fittedFile);

    const fittedDuration = await fitSpeechToWindow(
      rawTtsFile,
      fittedFile,
      sourceDuration,
      window,
    );

    clips.push(fittedFile);
    burnSegments.push({
      start: Number(startAt.toFixed(3)),
      end: Number(
        Math.max(
          startAt + 0.6,
          videoDuration > 0 ? Math.min(startAt + fittedDuration, videoDuration) : startAt + fittedDuration,
        ).toFixed(3),
      ),
      text: block.text,
    });
    cursor += fittedDuration > 0 ? fittedDuration : window;

    if (onProgress) {
      try {
        await onProgress(Math.min(90, 10 + Math.round(((i + 1) / blocks.length) * 80)));
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
        // Only the file name is passed (ffmpeg runs inside TEMP_DIR), which
        // avoids Windows drive-letter escaping problems in the filter string.
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
    const args = [
      '-y',
      '-i',
      video.publicUrl,
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
      '-movflags',
      '+faststart',
      ...(videoDuration > 0
        ? ['-t', String(videoDuration)]
        : ['-shortest']),
      outputFile,
    ];

    await runFfmpeg(args, { cwd: TEMP_DIR });

    const result = await uploadFile(outputFile, {
      resource_type: 'video',
      folder: `${env.cloudinaryFolder}/dubs`,
      use_filename: true,
      unique_filename: true,
      overwrite: false,
    });

    return {
      language,
      url: result.secure_url,
      storagePath: result.public_id,
      durationSeconds: Math.round(result.duration || videoDuration || 0),
      voice: selectedVoice,
      subtitlesBurned: Boolean(subtitleFile),
      segments: burnSegments,
    };
  } finally {
    cleanup([...tempFiles, mergedAudio, outputFile]);
  }
};
