import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import cloudinary, { isCloudinaryConfigured } from '../config/cloudinary.js';
import { env } from '../config/env.js';
import { synthesizeSpeech, VOICES } from './tts.service.js';
import {
  translateTranscriptSegments,
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

const runFfmpeg = (args) =>
  new Promise((resolve, reject) => {
    const proc = spawn(ffmpegStatic, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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

const stretchOrFitAudio = async (inputPath, outputPath, sourceDuration, targetDuration) => {
  const safeTarget = Math.max(0.1, Number(targetDuration) || 0.1);
  const safeSource = Math.max(0.05, Number(sourceDuration) || 0.05);

  if (safeSource <= safeTarget + 0.03) {
    await normalizeToWav(inputPath, outputPath);
    return safeSource;
  }

  let factor = safeSource / safeTarget;
  const filters = [];
  while (factor > 2.0) {
    filters.push('atempo=2.0');
    factor /= 2.0;
  }
  const finalFactor = Math.min(100, Math.max(1.0, factor));
  filters.push(`atempo=${finalFactor.toFixed(6)}`);

  await runFfmpeg([
    '-y',
    '-i',
    inputPath,
    '-filter:a',
    filters.join(','),
    '-t',
    safeTarget.toFixed(3),
    '-acodec',
    'pcm_s16le',
    '-ar',
    '24000',
    '-ac',
    '1',
    outputPath,
  ]);

  return safeTarget;
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

export const generateDubbedVideo = async ({ video, language }) => {
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

  const voice = VOICES[language] || VOICES.en;

  const tempFiles = [];
  const clips = [];
  let cursor = 0;

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const slotEnd =
      videoDuration > 0
        ? Math.min(segment.end, videoDuration)
        : segment.end;
    const slotDuration = Math.max(0.1, slotEnd - segment.start);

    let text = segment.text;
    const maxChars = Math.max(20, Math.floor(slotDuration * 13));
    if (text.length > maxChars * 1.15) {
      try {
        text = await condenseTranslationForDuration({
          text,
          targetLanguage: language,
          maxChars,
        });
      } catch {
        // Keep original text if condensation fails.
      }
    }
    text = String(text || '').trim() || segment.text;

    const leadingGap = segment.start - cursor;
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

    if (!text) {
      const silenceFile = path.join(
        TEMP_DIR,
        `dub-empty-${video._id}-${i}-${Date.now()}.wav`,
      );
      tempFiles.push(silenceFile);
      if (await createSilenceWav(slotDuration, silenceFile)) {
        clips.push(silenceFile);
        cursor += slotDuration;
      }
      continue;
    }

    const tts = await synthesizeSpeech(text, voice);
    if (!tts?.buffer?.length) {
      throw new Error(`TTS returned no audio for segment ${i + 1}`);
    }

    const rawTtsFile = path.join(
      TEMP_DIR,
      `dub-tts-${video._id}-${language}-${i}-${Date.now()}.mp3`,
    );
    tempFiles.push(rawTtsFile);
    fs.writeFileSync(rawTtsFile, tts.buffer);

    let sourceDuration = await getAudioDurationSeconds(rawTtsFile);
    if (!sourceDuration) {
      sourceDuration = estimateSpeechSeconds(text, language);
    }

    const fittedFile = path.join(
      TEMP_DIR,
      `dub-fit-${video._id}-${language}-${i}-${Date.now()}.wav`,
    );
    tempFiles.push(fittedFile);

    const fittedDuration = await stretchOrFitAudio(
      rawTtsFile,
      fittedFile,
      sourceDuration,
      slotDuration,
    );

    clips.push(fittedFile);
    cursor += fittedDuration > 0 ? fittedDuration : slotDuration;
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

  try {
    const args = videoDuration > 0
      ? [
          '-y',
          '-i',
          video.publicUrl,
          '-i',
          mergedAudio,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-t',
          String(videoDuration),
          outputFile,
        ]
      : [
          '-y',
          '-i',
          video.publicUrl,
          '-i',
          mergedAudio,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-shortest',
          outputFile,
        ];

    await runFfmpeg(args);

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
      voice,
    };
  } finally {
    cleanup([...tempFiles, mergedAudio, outputFile]);
  }
};
