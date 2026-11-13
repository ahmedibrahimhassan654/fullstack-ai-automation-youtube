import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import { env } from '../config/env.js';

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MAX_DIRECT_BYTES = 24 * 1024 * 1024; // keep under common Whisper upload limits

const runFfmpeg = (args) =>
  new Promise((resolve, reject) => {
    const proc = spawn(ffmpegStatic, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg audio extract failed (${code}): ${stderr.slice(-500)}`));
    });
    proc.on('error', reject);
  });

const extractAudioBuffer = async ({ buffer, inputPath, originalName }) => {
  // For large videos (or when we have a local path), extract a compressed mono
  // mp3 so Groq Whisper accepts it (avoids 413 Request Entity Too Large).
  const tmpIn = inputPath || path.join(os.tmpdir(), `transcribe-in-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(originalName || '.mp4') || '.mp4'}`);
  const tmpOut = path.join(os.tmpdir(), `transcribe-out-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);
  let wroteTempIn = false;
  try {
    if (!inputPath) {
      await fs.promises.writeFile(tmpIn, buffer);
      wroteTempIn = true;
    }
    await runFfmpeg([
      '-y',
      '-i', tmpIn,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-b:a', '64k',
      tmpOut,
    ]);
    const out = await fs.promises.readFile(tmpOut);
    return { buffer: out, filename: 'audio.mp3', mimeType: 'audio/mpeg' };
  } finally {
    try { if (wroteTempIn && fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn); } catch {}
    try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch {}
  }
};

export const transcribeAudio = async ({ buffer, filename, mimeType, language, inputPath }) => {
  if (!env.groqApiKey) {
    const err = new Error('GROQ_API_KEY is not configured');
    err.statusCode = 500;
    throw err;
  }

  let sendBuffer = buffer;
  let sendName = filename || 'audio.mp4';
  let sendMime = mimeType || 'application/octet-stream';

  const shouldExtract =
    Boolean(inputPath) ||
    !buffer ||
    buffer.length > MAX_DIRECT_BYTES ||
    /video\//i.test(mimeType || '') ||
    /\.(mp4|mov|mkv|avi|webm)$/i.test(filename || '');

  if (shouldExtract) {
    try {
      const extracted = await extractAudioBuffer({ buffer, inputPath, originalName: filename });
      sendBuffer = extracted.buffer;
      sendName = extracted.filename;
      sendMime = extracted.mimeType;
    } catch (e) {
      // If extraction fails, fall back to original buffer (may still work for small files).
      if (!sendBuffer) throw e;
    }
  }

  const form = new FormData();
  const blob = new Blob([sendBuffer], { type: sendMime });
  form.append('file', blob, sendName);
  form.append('model', 'whisper-large-v3');
  form.append('response_format', 'verbose_json');
  if (language) form.append('language', language);

  const res = await fetch(GROQ_TRANSCRIPTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.groqApiKey}`,
    },
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || data?.message || `Groq Whisper failed (${res.status})`;
    const err = new Error(message);
    err.statusCode = res.status;
    throw err;
  }

  return {
    text: data.text || '',
    language: data.language || language || 'en',
    segments: data.segments || [],
  };
};