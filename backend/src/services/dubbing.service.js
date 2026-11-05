import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import cloudinary, { isCloudinaryConfigured } from '../config/cloudinary.js';
import { env } from '../config/env.js';
import { synthesizeSpeech, VOICES } from './tts.service.js';

const TEMP_DIR = os.tmpdir();

const writeTemp = (name, buffer) => {
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

export const generateDubbedVideo = async ({ video, language }) => {
  if (!isCloudinaryConfigured()) {
    const err = new Error('Cloudinary is not configured on the server');
    err.statusCode = 500;
    throw err;
  }

  const translation = (video.translations || []).find((t) => t.language === language);
  const sourceText = translation?.transcript || video.transcript || '';
  if (!sourceText.trim()) {
    const err = new Error('No transcript available for dubbing');
    err.statusCode = 400;
    throw err;
  }

  const voice = VOICES[language] || VOICES.en;
  const { buffer: audioBuffer } = await synthesizeSpeech(sourceText, voice);
  const audioFile = writeTemp(`dub-${video._id}-${language}-${Date.now()}.mp3`, audioBuffer);

  const outputFile = path.join(TEMP_DIR, `dubbed-${video._id}-${language}-${Date.now()}.mp4`);

  const duration = Number(video.durationSeconds) || 0;
  const args =
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
      durationSeconds: Math.round(result.duration || video.durationSeconds || 0),
      voice,
    };
  } finally {
    cleanup([audioFile, outputFile]);
  }
};
