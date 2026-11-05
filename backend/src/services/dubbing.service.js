import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import ffmpegStatic from 'ffmpeg-static';
import cloudinary, { isCloudinaryConfigured } from '../config/cloudinary.js';
import { env } from '../config/env.js';

const VOICES = {
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

const synthesizeSpeech = async (text, voice) => {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  // Edge TTS can handle long text, but chunk to reduce timeout risk.
  const chunks = text.match(/.{1,3000}/gs) || [text];
  const buffers = [];

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const { audioStream } = tts.toStream(trimmed);
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
  const audioBuffer = await synthesizeSpeech(sourceText, voice);
  const audioFile = writeTemp(`dub-${video._id}-${language}-${Date.now()}.mp3`, audioBuffer);

  const outputFile = path.join(TEMP_DIR, `dubbed-${video._id}-${language}-${Date.now()}.mp4`);

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
