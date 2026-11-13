import dotenv from 'dotenv';

dotenv.config();

const required = (key) => {
  const value = process.env[key];
  if (!value) {
    // Only warn in development; hard fail in production for critical keys.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    console.warn(`[env] Missing environment variable: ${key}`);
  }
  return value;
};

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai_youtube_automation',
  jwtSecret: process.env.JWT_SECRET || 'dev_secret_change_me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
  groqApiKey: process.env.GROQ_API_KEY || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiBaseUrl:
    process.env.GEMINI_BASE_URL ||
    'https://generativelanguage.googleapis.com/v1beta/openai',
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  deepseekBaseUrl:
    process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  crowllmApiKey: process.env.CROWLLM_API_KEY || '',
  crowllmBaseUrl:
    process.env.CROWLLM_BASE_URL || 'https://crowllm.com/v1',
  crowllmModel: process.env.CROWLLM_MODEL || '',
  googleTtsApiKey: process.env.GOOGLE_TTS_API_KEY || '',
  googleTtsVoice: process.env.GOOGLE_TTS_VOICE || '',
  // AI provider selection: 'groq' (default) or 'ollama'
  aiProvider: (process.env.AI_PROVIDER || 'groq').toLowerCase(),
  aiModelFast: process.env.AI_MODEL_FAST || 'qwen/qwen3.8-27b',
  aiModelQuality: process.env.AI_MODEL_QUALITY || 'openai/gpt-oss-120b',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  ollamaApiKey: process.env.OLLAMA_API_KEY || '',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3.2',
  youtubeClientId: process.env.YOUTUBE_CLIENT_ID || '',
  youtubeClientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
  youtubeRedirectUri:
    process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:5000/api/auth/youtube/callback',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  stripePriceIdPro: process.env.STRIPE_PRICE_ID_PRO || '',
  stripePriceIdEnterprise: process.env.STRIPE_PRICE_ID_ENTERPRISE || '',
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY || '',
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET || '',
  cloudinaryFolder: process.env.CLOUDINARY_FOLDER || 'ai-youtube-automation',
  // 'cloudinary' (default), 'local', or 'auto' (try cloudinary then local on limits)
  storageProvider: (process.env.STORAGE_PROVIDER || 'auto').toLowerCase(),
  serverUrl: process.env.SERVER_URL || process.env.API_URL || '',
  backgroundMusicUrl: process.env.BACKGROUND_MUSIC_URL || '',
  elevenLabsApiKey: String(process.env.ELEVENLABS_API_KEY || '').trim().split(/\s+/)[0],
  elevenLabsDefaultVoiceId: String(process.env.ELEVENLABS_VOICE_ID || '').trim().split(/\s+/)[0],
};

export const validateEnv = () => {
  required('MONGODB_URI');
  // Add more required checks as modules come online.
};
