import { env } from '../config/env.js';

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

export const transcribeAudio = async ({ buffer, filename, mimeType, language }) => {
  if (!env.groqApiKey) {
    const err = new Error('GROQ_API_KEY is not configured');
    err.statusCode = 500;
    throw err;
  }

  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType || 'application/octet-stream' });
  form.append('file', blob, filename || 'audio.mp4');
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