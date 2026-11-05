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

const cleanup = (files) => {
  for (const file of files) {
    try {
      if (file && fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      // best effort
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

export const generateLessonVideo = async ({ video, language }) => {
  if (!isCloudinaryConfigured()) {
    const err = new Error('Cloudinary is not configured on the server');
    err.statusCode = 500;
    throw err;
  }

  const script = await generateEducationalScript({ video, targetLanguage: language });
  if (!script.trim()) throw new Error('Could not generate lesson script');

  const voice = VOICES[language] || VOICES.en;
  const { buffer: audioBuffer, segments: lessonSegments } = await synthesizeSpeech(script, voice);
  const audioFile = path.join(TEMP_DIR, `lesson-${video._id}-${language}-${Date.now()}.mp3`);
  const outputFile = path.join(TEMP_DIR, `lesson-video-${video._id}-${language}-${Date.now()}.mp4`);

  fs.writeFileSync(audioFile, audioBuffer);

  try {
    await runFfmpeg([
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
    ]);

    const result = await uploadFile(outputFile, {
      resource_type: 'video',
      folder: `${env.cloudinaryFolder}/lessons`,
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
      script,
      segments: lessonSegments || [],
    };
  } finally {
    cleanupFiles([audioFile, outputFile]);
  }
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
