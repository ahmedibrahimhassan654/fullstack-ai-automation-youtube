import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import cloudinary, { isCloudinaryConfigured } from '../config/cloudinary.js';
import { env } from '../config/env.js';
import { generateEducationalScript } from './aiMetadata.service.js';
import { synthesizeSpeech, VOICES } from './tts.service.js';

const TEMP_DIR = os.tmpdir();

const toVtt = (segments) => {
  const format = (value) => {
    const total = Math.max(0, value || 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = Math.floor(total % 60);
    const millis = Math.floor((total - Math.floor(total)) * 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
  };
  let out = 'WEBVTT\\n\\n';
  (segments || []).forEach((segment, index) => {
    if (!segment?.text) return;
    const start = format(segment.start);
    const end = format(Math.max(segment.end, segment.start + 0.2));
    out += `${index + 1}\\n${start} --> ${end}\\n${segment.text}\\n\\n`;
  });
  return out;
};

function cleanupFiles(files) {
  for (const file of files) {
    try {
      if (file && fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      // best effort
    }
  }
}

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
      else reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(-500)}`));
    });
  });

const uploadFile = (filePath, options) =>
  new Promise((resolve, reject) => {
    cloudinary.uploader.upload(filePath, options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
  });

export const generateLessonVideo = async ({ video, language, onProgress }) => {
  const report = async (value) => {
    try {
      await onProgress?.(value);
    } catch {
      // ignore progress update failures
    }
  };

  if (!isCloudinaryConfigured()) {
    const err = new Error('Cloudinary is not configured on the server');
    err.statusCode = 500;
    throw err;
  }

  await report(15);
  const script = await generateEducationalScript({ video, targetLanguage: language });
  if (!script.trim()) throw new Error('Could not generate lesson script');
  await report(30);

  const voice = VOICES[language] || VOICES.en;
  const { buffer: audioBuffer, segments: lessonSegments, wordSegments: lessonWordSegments } = await synthesizeSpeech(script, voice, {
    onProgress: async (value) => {
      await onProgress?.(30 + Math.round(value * 0.2));
    },
  });
  await report(50);

  const audioFile = path.join(TEMP_DIR, `lesson-${video._id}-${language}-${Date.now()}.mp3`);
  const outputFile = path.join(TEMP_DIR, `lesson-video-${video._id}-${language}-${Date.now()}.mp4`);
  let subtitleFile = null;
  fs.writeFileSync(audioFile, audioBuffer);
  await report(58);

  const duration = Number(video.durationSeconds) || 0;
  const ffmpegArgs =
    duration > 0
      ? [
          '-y',
          '-i',
          video.publicUrl,
          '-i',
          audioFile,
          '-filter_complex',
          `[1:a]apad=whole_dur=${duration}[a]`,
          '-map',
          '0:v:0',
          '-map',
          '[a]',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-t',
          String(duration),
          outputFile,
        ]
      : [
          '-y',
          '-i',
          video.publicUrl,
          '-i',
          audioFile,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-shortest',
          outputFile,
        ];

  try {
    await report(65);
    await runFfmpeg(ffmpegArgs);
    await report(82);

    const result = await uploadFile(outputFile, {
      resource_type: 'video',
      folder: `${env.cloudinaryFolder}/lessons`,
      use_filename: true,
      unique_filename: true,
      overwrite: false,
    });
    await report(92);

    const subtitleSegments = (lessonWordSegments && lessonWordSegments.length ? lessonWordSegments : lessonSegments) || [];
    const subtitleContent = toVtt(subtitleSegments);
    subtitleFile = path.join(TEMP_DIR, `lesson-${video._id}-${language}-${Date.now()}.vtt`);
    fs.writeFileSync(subtitleFile, subtitleContent);
    let subtitlesUrl = null;
    try {
      const subtitleUpload = await uploadFile(subtitleFile, {
        resource_type: 'raw',
        folder: `${env.cloudinaryFolder}/lessons`,
        use_filename: true,
        unique_filename: true,
        overwrite: false,
      });
      subtitlesUrl = subtitleUpload.secure_url;
    } catch (subtitleError) {
      // Subtitle upload is optional; never fail the whole lesson because of it.
      console.error('[lessonVideo] subtitle upload failed:', subtitleError?.message);
    }
    await report(95);

    return {
      language,
      url: result.secure_url,
      storagePath: result.public_id,
      durationSeconds: Math.round(result.duration || video.durationSeconds || 0),
      voice,
      script,
      segments: lessonSegments || [],
      subtitlesUrl,
    };
  } finally {
    cleanupFiles([audioFile, outputFile, subtitleFile]);
  }
};