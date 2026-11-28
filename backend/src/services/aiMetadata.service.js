import { env } from '../config/env.js';
import {
  normalizeTechnicalSource,
  repairTechnicalTerms,
} from './technicalTerms.service.js';

const EGYPTIAN_ARABIC_RULES = `You are an expert AI Audio Translation & Transcription Agent specializing in Egyptian Arabic. Follow these core principles: deliver authentic modern Egyptian Arabic (اللهجة المصرية); maintain Arabic grammar, pronouns, verb conjugations and gender agreement; identify technical English terms without natural Arabic translations and keep them in English when needed; adapt speech patterns into clear, natural, well-structured text while preserving educational intent.`;

const stripMarkdown = (text) =>
  String(text || '')
    .replace(/```[\\s\\S]*?```/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\\*\\*(.*?)\\*\\*/g, '$1')
    .replace(/\\*(.*?)\\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/^#{1,6}\\s*/gm, '')
    .replace(/^\\s*[-*+]\\s+/gm, '')
    .replace(/\\n{3,}/g, '\\n\\n')
    .replace(/[ \\t]{2,}/g, ' ')
    .trim();

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL_QUALITY = env.aiModelQuality || 'openai/gpt-oss-120b';
const GROQ_MODEL_FAST = env.aiModelFast || 'openai/gpt-oss-20b';

// gpt-oss models are reasoning models: they spend thousands of tokens on
// hidden reasoning before answering, which is what exhausted the rate limit.
const isReasoningModel = (model) => /gpt-oss/i.test(String(model || ''));

const resolveProvider = () => {
  const p = String(env.aiProvider || 'groq').toLowerCase();
  if (p === 'ollama' || p === 'gemini' || p === 'deepseek' || p === 'crowllm') return p;
  return 'groq';
};

const callOllamaCompletionOnce = async (messages, extra = {}) => {
  const baseUrl = env.ollamaBaseUrl.replace(/\/$/, '');
  const url = `${baseUrl}/v1/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (env.ollamaApiKey) headers.Authorization = `Bearer ${env.ollamaApiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: extra.model || env.ollamaModel,
      messages,
      temperature: extra.temperature ?? 0.2,
      max_tokens: extra.maxTokens ?? 2048,
      ...(extra.responseFormat ? { response_format: extra.responseFormat } : {}),
    }),
    // A local model is slower than the hosted ones, so it gets more time.
    signal: AbortSignal.timeout(900000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `Ollama chat failed (${response.status})`;
    const err = new Error(message);
    err.statusCode = response.status;
    throw err;
  }
  return data?.choices?.[0]?.message?.content || '';
};

const callDeepSeekCompletionOnce = async (messages, extra = {}) => {
  if (!env.deepseekApiKey) {
    const err = new Error('DEEPSEEK_API_KEY is not configured');
    err.statusCode = 500;
    throw err;
  }
  const defaultModel =
    String(env.aiModelQuality || '').toLowerCase().includes('deepseek')
      ? env.aiModelQuality
      : 'deepseek-chat';
  const model = extra.model || defaultModel;

  const response = await fetch(`${env.deepseekBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.deepseekApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: extra.temperature ?? 0.2,
      max_tokens: extra.maxTokens ?? 2048,
      response_format: extra.responseFormat,
    }),
    signal: AbortSignal.timeout(300000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `DeepSeek chat failed (${response.status})`;
    const err = new Error(message);
    err.statusCode = response.status;
    throw err;
  }
  return data?.choices?.[0]?.message?.content || '';
};

const callCrowllmCompletionOnce = async (messages, extra = {}) => {
  if (!env.crowllmApiKey) {
    const err = new Error('CROWLLM_API_KEY is not configured');
    err.statusCode = 500;
    throw err;
  }
  const model =
    extra.model ||
    env.crowllmModel ||
    (extra.fast ? 'gpt-4o-mini:free' : 'qwen-3.6-plus:free');

  const response = await fetch(
    `${String(env.crowllmBaseUrl || 'https://crowllm.com/v1').replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.crowllmApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: extra.temperature ?? 0.2,
        max_tokens: extra.maxTokens ?? 2048,
        ...(extra.responseFormat ? { response_format: extra.responseFormat } : {}),
      }),
      signal: AbortSignal.timeout(300000),
    },
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data?.error?.message || data?.message || `CrowLLM chat failed (${response.status})`;
    const err = new Error(message);
    err.statusCode = response.status;
    throw err;
  }
  return data?.choices?.[0]?.message?.content || '';
};

const callChatCompletionOnce = async (messages, extra = {}) => {
  const provider = extra?.provider || resolveProvider();

  if (provider === 'ollama') {
    return callOllamaCompletionOnce(messages, extra);
  }

  if (provider === 'deepseek') {
    return callDeepSeekCompletionOnce(messages, extra);
  }

  if (provider === 'crowllm') {
    return callCrowllmCompletionOnce(messages, extra);
  }

  if (provider === 'gemini') {
    if (!env.geminiApiKey) {
      const err = new Error('GEMINI_API_KEY is not configured');
      err.statusCode = 500;
      throw err;
    }
    const defaultGeminiModel =
      String(env.aiModelQuality || '').toLowerCase().includes('gemini')
        ? env.aiModelQuality
        : 'gemini-3.5-flash-lite';
    const model = extra.model || defaultGeminiModel;
    const response = await fetch(
      `${env.geminiBaseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.geminiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: extra.temperature ?? 0.2,
          max_tokens: extra.maxTokens ?? 2048,
          response_format: extra.responseFormat,
        }),
        signal: AbortSignal.timeout(300000),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        data?.error?.message || data?.message || `Gemini chat failed (${response.status})`;
      const err = new Error(message);
      err.statusCode = response.status;
      throw err;
    }
    return data?.choices?.[0]?.message?.content || '';
  }

  if (!env.groqApiKey) {
    const err = new Error('GROQ_API_KEY is not configured');
    err.statusCode = 500;
    throw err;
  }

  const model = extra.model || (extra.fast ? GROQ_MODEL_FAST : GROQ_MODEL_QUALITY);

  const response = await fetch(GROQ_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.groqApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: extra.temperature ?? 0.2,
      max_tokens: extra.maxTokens ?? 2048,
      response_format: extra.responseFormat,
      // gpt-oss burns thousands of reasoning tokens per call. On the free
      // 8k tokens-per-minute tier that starves the translation and the
      // remaining batches silently fall back to the source language.
      ...(isReasoningModel(model) ? { reasoning_effort: 'low' } : {}),
    }),
    signal: AbortSignal.timeout(300000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `Groq chat failed (${response.status})`;
    const err = new Error(message);
    err.statusCode = response.status;
    throw err;
  }

  return data?.choices?.[0]?.message?.content || '';
};

const retryDelayMs = (error, attempt) => {
  const message = String(error?.message || '');
  const match = message.match(/try again in ([0-9.]+)\s*s/i);
  if (match) {
    const seconds = Number(match[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000) + 1000;
    }
  }
  // Exponential backoff that is generous enough for provider TPM resets.
  return Math.min(60000, 5000 * (attempt + 1));
};

const disabledProviders = new Set();

// A provider that just refused with a rate limit is skipped for a while
// instead of being retried on every single call. Without this, one exhausted
// daily quota delayed every batch by minutes.
const providerCooldown = new Map();

const isProviderCoolingDown = (provider) => {
  const until = providerCooldown.get(provider);
  if (!until) return false;
  if (Date.now() >= until) {
    providerCooldown.delete(provider);
    return false;
  }
  return true;
};

const coolDownProvider = (provider, error) => {
  const message = String(error?.message || '');
  const match = message.match(/try again in ([0-9.]+)\s*(ms|s|m|h)/i);
  let waitMs = 10 * 60 * 1000;
  if (match) {
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    const factor = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60000 : 3600000;
    waitMs = value * factor;
  }
  // Never skip a provider for less than a minute, and never for more than a
  // quarter of an hour.
  const capped = Math.min(Math.max(waitMs, 60 * 1000), 15 * 60 * 1000);
  providerCooldown.set(provider, Date.now() + capped);
  console.warn(
    `[ai] ${provider} is rate limited, skipping it for ${Math.round(capped / 1000)}s`,
  );
};

let ollamaAvailable = null;
let ollamaCheckedAt = 0;

/**
 * Checks whether a local Ollama server is running.
 *
 * The answer is cached for a few minutes so the check does not slow down
 * every single call.
 */
const isOllamaRunning = async () => {
  const now = Date.now();
  if (ollamaAvailable !== null && now - ollamaCheckedAt < 5 * 60 * 1000) {
    return ollamaAvailable;
  }
  ollamaCheckedAt = now;
  try {
    const res = await fetch(
      `${String(env.ollamaBaseUrl || '').replace(/\/$/, '')}/api/tags`,
      { signal: AbortSignal.timeout(1500) },
    );
    ollamaAvailable = res.ok;
  } catch {
    ollamaAvailable = false;
  }
  return ollamaAvailable;
};

const availableProviders = async () => {
  const list = [];
  const preferred = resolveProvider();
  if (env.groqApiKey && !disabledProviders.has('groq') && !isProviderCoolingDown('groq')) {
    list.push('groq');
  }
  // Gemini is a real fallback whenever the key exists - it gives the
  // translation a second engine when Groq hits its rate limit.
  if (
    env.geminiApiKey &&
    !disabledProviders.has('gemini') &&
    !isProviderCoolingDown('gemini')
  ) {
    list.push('gemini');
  }
  if (
    env.deepseekApiKey &&
    !disabledProviders.has('deepseek') &&
    !isProviderCoolingDown('deepseek')
  ) {
    list.push('deepseek');
  }
  if (
    env.crowllmApiKey &&
    !disabledProviders.has('crowllm') &&
    !isProviderCoolingDown('crowllm')
  ) {
    list.push('crowllm');
  }
  // A local Ollama server is the last resort: it is slower than the hosted
  // providers but it has no quota at all, so a dub can always finish.
  if (!disabledProviders.has('ollama') && (await isOllamaRunning())) {
    list.push('ollama');
  }
  return list;
};

const callChatCompletion = async (messages, extra = {}) => {
  const preferred = extra?.provider || resolveProvider();
  const all = await availableProviders();
  const candidates = [
    ...(disabledProviders.has(preferred) ? [] : [preferred]),
    ...all.filter((p) => p !== preferred),
  ];
  let lastError = null;

  for (const provider of candidates) {
    if (disabledProviders.has(provider)) continue;
    if (provider !== preferred && isProviderCoolingDown(provider)) continue;
    // A rate limited provider needs more patience than a hard failure: the
    // provider tells us how long to wait, and waiting is what makes the
    // translation succeed instead of falling back to the source language.
    let attempts = provider === preferred ? 3 : 2;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await callChatCompletionOnce(messages, {
          ...extra,
          provider,
          model: extra?.provider === provider ? extra?.model : undefined,
        });
      } catch (error) {
        lastError = error;
        const message = String(error?.message || '');
        const status = Number(error?.statusCode || 0);
        console.error('[ai] provider failed:', provider, status, message);
        if (status === 402 || /insufficient balance|credits remaining/i.test(message)) {
          disabledProviders.add(provider);
          console.warn('[ai] provider disabled for this run:', provider);
        }
        const retryable =
          status === 429 ||
          status >= 500 ||
          /over capacity|rate limit|timeout|temporarily unavailable/i.test(message);
        if (!retryable) break;
        if (attempt === attempts - 1) break;
        // The last attempt of the preferred provider sets the cooldown, so the
        // next call goes straight to a provider that still has quota.
        if (provider === preferred && attempts > 1 && attempt === attempts - 2) {
          coolDownProvider(provider, error);
        }
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelayMs(error, attempt)),
        );
      }
    }
  }
  throw lastError;
};


const trim = (text, limit = 12000) => {
  if (!text) return '';
  if (text.length <= limit) return text;
  // Keep both the start and end so conclusions aren't dropped.
  const head = Math.floor(limit * 0.65);
  const tail = limit - head;
  return `${text.slice(0, head)}\n\n[... transcript truncated for analysis ...]\n\n${text.slice(-tail)}`;
};

const parseJson = (content) => {
  let text = String(content || '').trim();
  // DeepSeek reasoner (and similar) emit a reasoning block before the answer.
  // Strip it so it cannot confuse the JSON extraction.
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  text = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
  text = text.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '').trim();
  // Strip markdown fences if present.
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Find the first JSON object substring.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
    return null;
  }
};

export const analyzeTranscript = async ({ transcript, title, originalLanguage = 'en' }) => {
  const system = `You are a Senior Technical Curriculum Developer and Video Production Agent for an Arabic technical YouTube channel ("Udemy بالعربي").

Analyze the transcript and return ONLY valid JSON with these fields:
{
  "summary": "2-4 sentences summarizing the practical takeaway.",
  "titles": ["3-5 clear technical YouTube titles with accurate terminology"],
  "descriptions": ["2 concise YouTube descriptions"],
  "tags": ["10-20 relevant tags"],
  "chapters": [{"time": "MM:SS", "title": "chapter title"}],
  "keyPoints": ["5-8 practical key points that a viewer can apply"],
  "actionItems": ["actionable tasks mentioned or implied"],
  "decisions": ["decisions made in the content"],
  "openQuestions": ["3 clear, separate questions a viewer might ask after watching, each a single well-formed question ending with a question mark"]
}

Strictly enforce:
- Verify every command, configuration, version, and code concept mentioned; correct obvious transcript typos without changing technical meaning.
- Never use placeholders or outdated syntax.
- Include sequential chapter titles based on real transcript timestamps.
- Descriptions should be concise, practical, and include what the viewer will do, learn, and troubleshoot.
- openQuestions: generate exactly 3 separate, well-formed questions in the target language, each ending with a question mark. Do not merge multiple questions into one. Each question must be clear and answerable by viewers.
- If a field has no items, return an empty array. Do not include markdown outside JSON.`;

  const content = await callChatCompletion(
    [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `Title: ${title || 'Untitled video'}\nLanguage: ${originalLanguage}\n\nTranscript:\n${trim(transcript)}`,
      },
    ],
    {
        responseFormat: { type: 'json_object' },
        provider: resolveProvider(),
        model: env.aiProvider === 'deepseek' ? 'deepseek-chat' : undefined,
        maxTokens: 2200,
    }
  );

  const parsed = parseJson(content);
  if (!parsed) {
    throw new Error('AI analysis did not return valid JSON');
  }

  return {
    summary: stripMarkdown(parsed.summary),
    titles: Array.isArray(parsed.titles) ? parsed.titles.map((v) => stripMarkdown(v)) : [],
    descriptions: Array.isArray(parsed.descriptions) ? parsed.descriptions.map((v) => stripMarkdown(v)) : [],
    tags: Array.isArray(parsed.tags) ? parsed.tags.map((v) => stripMarkdown(v)) : [],
    chapters: Array.isArray(parsed.chapters)
      ? parsed.chapters
          .map((c) => ({ time: String(c?.time || '00:00'), title: stripMarkdown(c?.title) }))
          .filter((c) => c.title)
      : [],
    keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map((v) => stripMarkdown(v)) : [],
    actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.map((v) => stripMarkdown(v)) : [],
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions.map((v) => stripMarkdown(v)) : [],
    openQuestions: Array.isArray(parsed.openQuestions) ? parsed.openQuestions.map((v) => stripMarkdown(v)) : [],
    model: resolveProvider() === 'ollama' ? (env.ollamaModel || env.aiModelQuality) : (env.aiModelQuality || GROQ_MODEL_QUALITY),
  };
};

const chunkArray = (items, size) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

// --- Target language detection ------------------------------------------------
// A translation that is still in the source language must never reach the TTS
// engine: dubbing English text with an Arabic voice is what produced the
// "bad english" audio, so every translation is verified before it is used.
const TARGET_SCRIPT_PATTERNS = {
  ar: /[\u0600-\u06FF]/g,
  fa: /[\u0600-\u06FF]/g,
  ur: /[\u0600-\u06FF]/g,
  ps: /[\u0600-\u06FF]/g,
  he: /[\u0590-\u05FF]/g,
  ru: /[\u0400-\u04FF]/g,
  uk: /[\u0400-\u04FF]/g,
  bg: /[\u0400-\u04FF]/g,
  hi: /[\u0900-\u097F]/g,
  mr: /[\u0900-\u097F]/g,
  bn: /[\u0980-\u09FF]/g,
  th: /[\u0E00-\u0E7F]/g,
  zh: /[\u3400-\u9FFF]/g,
  ja: /[\u3040-\u30FF\u3400-\u9FFF]/g,
  ko: /[\uAC00-\uD7AF\u1100-\u11FF]/g,
  el: /[\u0370-\u03FF]/g,
};

const LETTER_PATTERN = /\p{L}/gu;
const LATIN_LETTER_PATTERN = /[A-Za-z]/g;
const TASHKEEL_PATTERN = /[\u064B-\u0652]/g;
const ARABIC_LETTER_PATTERN = /[\u0600-\u06FF]/g;

/**
 * True when the text carries Arabic diacritics. Without tashkeel the neural
 * voice mispronounces ambiguous words, which is what made the dub sound
 * unnatural.
 */
export const hasTashkeel = (text) => countMatches(text, TASHKEEL_PATTERN) > 0;

const hasArabicLetters = (text) => countMatches(text, ARABIC_LETTER_PATTERN) > 0;

const countMatches = (text, pattern) => (String(text || '').match(pattern) || []).length;

const normalizeForCompare = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

const languageBase = (value) => String(value || '').toLowerCase().split(/[-_]/)[0];

/**
 * True when `text` is genuinely written in the target language.
 *
 * - Non-latin targets (ar, ru, zh, ...) must contain a real share of the
 *   target script. Latin technical terms inside the sentence are tolerated,
 *   but an English sentence is rejected.
 * - Latin-script targets are accepted when the text changed. A segment that is
 *   still identical to the source is only accepted when it is a short
 *   technical term rather than a whole sentence.
 */
const isTechnicalLiteral = (text = '') => {
  const v = String(text || '').trim();
  if (!v) return false;
  // Commands, shell/code snippets, paths, URLs, filenames, flags, etc. These
  // often cannot/should not be translated into the target script and may be
  // kept as-is by the model (or TTS should read them literally).
  if (/https?:\/\/|www\.|[A-Za-z]:[\\/]|\.{1,2}[\\/]/.test(v)) return true;
  if (/[`|<>$]/.test(v)) return true;
  if (/(^|\s)(sudo|apt|apt-get|dnf|yum|pacman|brew|pip3?|npm|npx|pnpm|yarn|git|docker|kubectl|chmod|chown|chgrp|cd|ls|cat|echo|grep|sed|awk|curl|wget|ssh|scp|tar|zip|unzip|make|python3?|node|java|bash|sh|zsh|powershell|pwsh|ifconfig|ipconfig|macchanger|netdiscover|nmap|airmon-ng|aircrack-ng|wireshark|tcpdump)\b/i.test(v)) return true;
  if (/(^|\s)--?[A-Za-z][\w-]*/.test(v)) return true;
  if (/\b[\w.-]+\.(?:run|sh|bash|zsh|ps1|bat|cmd|exe|msi|deb|rpm|AppImage|iso|img|tar|gz|zip|7z|py|js|ts|go|rs|c|cpp|h|java|kt|rb|php|pl|sql|conf|cfg|ini|yaml|yml|json|md|txt)\b/i.test(v)) return true;
  if (/[\\/][\w.-]+/.test(v)) return true;
  // Mostly symbols/digits/dots/colons (identifiers, IPs, versions) with few letters.
  const letters = (v.match(/[A-Za-z]/g) || []).length;
  const nonSpace = v.replace(/\s+/g, '').length;
  if (nonSpace > 0 && letters / nonSpace < 0.45 && /[0-9./:_-]/.test(v)) return true;
  // Spelled-out commands/identifiers (e.g. "macchanger -r eth0", "S E T H 0",
  // interface names) are often kept in Latin script and should not block dubbing.
  const tokens = v.split(/\s+/).filter(Boolean);
  const hasDigit = /\d/.test(v);
  const singleLetterTokens = tokens.filter((t) => /^[A-Za-z]$/.test(t)).length;
  const shortCodeTokens = tokens.filter((t) => /^[A-Za-z0-9_.:-]{1,4}$/.test(t)).length;
  if (tokens.length > 0 && (singleLetterTokens >= 2 || (hasDigit && shortCodeTokens >= 2))) return true;
  const latinOnly = /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]+$/u.test(v);
  if (latinOnly && hasDigit && tokens.length <= 8) return true;
  return false;
};

export const isTargetLanguageText = (text, targetLanguage, sourceText = '', sourceLanguage = '') => {
  const value = String(text || '').trim();
  if (!value) return false;

  const target = languageBase(targetLanguage);
  const source = languageBase(sourceLanguage);
  if (source && source === target) return true;

  const letters = countMatches(value, LETTER_PATTERN);
  if (letters === 0) return true; // numbers and symbols only

  const scriptPattern = TARGET_SCRIPT_PATTERNS[target];
  const sourceValue = String(sourceText || '').trim();
  if (scriptPattern) {
    const targetChars = countMatches(value, scriptPattern);
    const sourceTargetChars = countMatches(sourceValue, scriptPattern);

    // Written in the target script: a translation.
    if (targetChars > 0) return true;

    // The source was in the target script but the translation is not: the
    // segment was mangled or dropped.
    if (sourceTargetChars > 0) return false;

    // Neither side uses the target script. Accept short labels (product names)
    // and technical literals/commands that are legitimately kept as-is.
    if (sourceValue.split(/\s+/).filter(Boolean).length <= 2) return true;
    if (isTechnicalLiteral(sourceValue) || isTechnicalLiteral(value)) return true;
    return false;
  }

  if (!sourceValue) return true;
  if (normalizeForCompare(value) === normalizeForCompare(sourceValue)) {
    // Unchanged: acceptable for a short technical term or a technical literal
    // (command, path, URL, code) that should remain as-is.
    if (sourceValue.split(/\s+/).filter(Boolean).length <= 2) return true;
    if (isTechnicalLiteral(sourceValue) || isTechnicalLiteral(value)) return true;
    return false;
  }
  return true;
};

/**
 * Lists the segments of a translation that are still in the source language.
 */
export const findUntranslatedSegments = ({
  segments,
  targetLanguage,
  sourceSegments = [],
  sourceLanguage = '',
}) => {
  const untranslated = [];
  (segments || []).forEach((segment, index) => {
    const source = sourceSegments?.[index]?.text || segment?.sourceText || '';
    if (!isTargetLanguageText(segment?.text, targetLanguage, source, sourceLanguage)) {
      untranslated.push({ index, text: String(segment?.text || '').slice(0, 120) });
    }
  });
  return untranslated;
};

const QUALITY_THRESHOLD = 9.5; // target >= 95% match
const MAX_TRANSLATION_ATTEMPTS = 5;

// --- Arabic number words -------------------------------------------------------
// Numbers must be spoken as Arabic words, not read out digit by digit. This
// is the fallback for anything the model leaves as digits in the spoken
// version.
const ARABIC_ONES = [
  'صفر',
  'واحد',
  'اثنان',
  'ثلاثة',
  'أربعة',
  'خمسة',
  'ستة',
  'سبعة',
  'ثمانية',
  'تسعة',
];

const ARABIC_TEENS = [
  'عشرة',
  'أحد عشر',
  'اثنا عشر',
  'ثلاثة عشر',
  'أربعة عشر',
  'خمسة عشر',
  'ستة عشر',
  'سبعة عشر',
  'ثمانية عشر',
  'تسعة عشر',
];

const ARABIC_TENS = [
  '',
  '',
  'عشرون',
  'ثلاثون',
  'أربعون',
  'خمسون',
  'ستون',
  'سبعون',
  'ثمانون',
  'تسعون',
];

const ARABIC_HUNDREDS = [
  '',
  'مائة',
  'مائتان',
  'ثلاثمائة',
  'أربعمائة',
  'خمسمائة',
  'ستمائة',
  'سبعمائة',
  'ثمانمائة',
  'تسعمائة',
];

export const spellArabicNumber = (value) => {
  const cleaned = String(value ?? '').replace(/[^\d.]/g, '');
  const parsed = Number.parseFloat(cleaned);
  const n = Math.floor(Math.abs(Number.isFinite(parsed) ? parsed : 0));
  if (!Number.isFinite(n)) return '';
  if (n === 0) return ARABIC_ONES[0];
  if (n < 10) return ARABIC_ONES[n];
  if (n < 20) return ARABIC_TEENS[n - 10];
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return ones === 0
      ? ARABIC_TENS[tens]
      : `${ARABIC_ONES[ones]} و${ARABIC_TENS[tens]}`;
  }
  if (n < 1000) {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    return rest === 0
      ? ARABIC_HUNDREDS[hundreds]
      : `${ARABIC_HUNDREDS[hundreds]} و${spellArabicNumber(rest)}`;
  }
  if (n < 10000) {
    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    const head =
      thousands === 1
        ? 'ألف'
        : thousands === 2
          ? 'ألفان'
          : `${ARABIC_ONES[thousands]} آلاف`;
    return rest === 0 ? head : `${head} و${spellArabicNumber(rest)}`;
  }
  return String(n);
};

/**
 * Turns the digits of a sentence into Arabic words.
 *
 * Digits that belong to a Latin identifier (ISO9000, Node18) are left alone.
 */
export const spellOutNumbersInArabic = (text) =>
  String(text || '').replace(
    // A hyphen right after the number glues two words together ("64-bit"); it
    // is consumed so the voice says the number and the unit separately.
    /(?<![\p{L}\d])\d+(?:[.,]\d+)*(?:[-\u2011])?/gu,
    (match) => {
      const hadHyphen = /[-\u2011]$/.test(match);
      const cleaned = match.replace(/[-\u2011]$/, '');
      const [intPart, ...decParts] = cleaned.split(/[.,]/);
      const head = spellArabicNumber(intPart);
      const words = decParts.length
        ? `${head} فاصلة ${decParts
            .join('')
            .split('')
            .map((d) => ARABIC_ONES[Number(d)])
            .join(' ')}`
        : head;
      // The hyphen is replaced by a space so the voice says the number and
      // the unit as two words.
      return hadHyphen ? `${words} ` : words;
    },
  );

const toPair = (segment) => ({
  start: Number(segment?.start) || 0,
  end: Number(segment?.end) || 0,
  text: String(segment?.text || '').trim(),
});

const callQualityChat = async (messages, extra = {}) => {
  const provider = extra?.provider || resolveProvider();
  // The bulk translation runs on the fast model: it is far cheaper per batch,
  // which keeps the whole transcript inside the rate limit budget.
  const model =
    provider === 'ollama'
      ? env.ollamaModel
      : provider === 'gemini'
        ? String(env.aiModelQuality || '').toLowerCase().includes('gemini')
          ? env.aiModelQuality
          : 'gemini-3.5-flash-lite'
        : provider === 'deepseek'
          ? String(env.aiModelQuality || '').toLowerCase().includes('deepseek')
            ? env.aiModelQuality
            : 'deepseek-chat'
          : provider === 'crowllm'
            ? extra.fast
              ? env.crowllmModel || 'gpt-4o-mini:free'
              : env.crowllmModel || 'qwen-3.6-plus:free'
            : extra.fast
              ? env.aiModelFast || GROQ_MODEL_FAST
              : env.aiModelQuality || GROQ_MODEL_QUALITY;
  return callChatCompletion(messages, { ...extra, model });
};

const buildTranslationMessages = ({ batch, targetLanguage, highQuality, context = [] }) => {
  const system =
    'You are a professional subtitle translator and dubbing script translator. Translate each segment text to the requested target language. ' +
    'IMPORTANT: never translate technical terms, product names, website names, framework/library names, API names, CLI commands, file paths or code identifiers. Keep them exactly as written in clear English/Latin script (for example OpenVPN, VPNBook, UDP, IP address, YouTube, myip.com, sudo, killall, cd, ls, pwd, whoami, Ctrl+Shift+C, Ctrl+Shift+V, npm install, GitHub) and keep them inside the translated sentence. ' +
    'TECHNICAL TERMS MUST BE COPIED CHARACTER FOR CHARACTER from the source: same letters, same order, same casing, no missing or extra letter, no merged or split words. Linux commands and flags must remain correct commands (cd means change directory, ls, pwd, whoami, sudo, killall, apt, etc.). ' +
    'Remove meaningless filler words and hesitations from the translated output (for example yeah, yep, um, uh, oh, okay, good to go) unless they carry essential meaning; do not add filler words. ' +
    'GRAMMAR AND MEANING: use correct tense, mood, gender, number, person and pronoun agreement in the target language, matching the source intent and timing/context (e.g. install/instalar/instalación in the correct form). Translate process-control phrases accurately (e.g. "kill the process/terminal operation" means stop/terminate it), while keeping command names unchanged. ' +
    'Keep the meaning faithful and the phrasing natural and clear for dubbing; preserve timing suitability and avoid unnecessary wordiness. Each translated segment must be clear and pronounceable. ' +
    (String(targetLanguage).toLowerCase().startsWith('ar')
      ? 'For Arabic, always use clear, understandable, and grammatically correct Modern Standard Arabic (فصحى) with complete tashkeel/diacritics for correct pronunciation. Keep the phrasing natural and suitable for spoken dubbing while maintaining proper Arabic grammar. '
      : '') +
    (highQuality
      ? 'Produce a HIGH-QUALITY translation: accurate meaning, natural phrasing, correct grammar, consistent terminology, and faithful tone. Avoid literal word-by-word translation; adapt idioms naturally. '
      : '') +
    'Return ONLY valid JSON: {"segments":["translated text 1","translated text 2"]}. ' +
    'Return exactly ' +
    batch.length +
    ' strings, in the same order as the input segments, and translate naturally.';

  const userLines = [`Target language: ${targetLanguage}`, '', 'Segments (original English):', JSON.stringify(batch)];

  if (context.length && context.some((c) => c)) {
    userLines.push('', 'Previous low-scoring attempts to improve upon:');
    userLines.push(
      JSON.stringify(
        batch.map((s, index) => ({
          original: s.text,
          previous: context[index]?.previous || '',
          previousScore: context[index]?.score ?? null,
          issues: context[index]?.reason || '',
          suggestions: context[index]?.suggestions || [],
        })),
      ),
    );
    userLines.push(
      'Use the feedback/issues above to fix mistakes. Keep any genuinely good phrases, but improve accuracy and naturalness until the translation would score at least 8/10.',
    );
  }

  return [
    { role: 'system', content: system },
    { role: 'user', content: userLines.join('\n') },
  ];
};

/**
 * One attempt at translating a batch. Returns null when the batch could not be
 * translated - it never falls back to the source text, because a silent
 * fallback is what made the dub speak English with an Arabic voice.
 */
/**
 * Rewrites the translated sentences that contain technical names or numbers
 * into the form that is spoken aloud.
 *
 * The subtitles keep "Kali Linux" and "ISO" in Latin script so the reader can
 * recognise them, but the narration reads "كالي لينكس" and "إيزو" with the
 * same Arabic voice. Switching to an English voice for those words interrupts
 * the lesson, so they are transliterated instead.
 *
 * Only the sentences that actually contain a technical name or a number are
 * sent, which keeps this pass far cheaper than translating everything twice.
 */
const generateSpokenVersions = async ({ segments, targetLanguage, strict = false }) => {
  const input = (segments || [])
    .map((segment, position) => ({
      // The caller passes the index it knows the segment by; fall back to the
      // position when it does not.
      index: Number.isInteger(segment?.index) ? segment.index : position,
      start: Number(segment?.start) || 0,
      end: Number(segment?.end) || 0,
      text: String(segment?.text || '').trim(),
    }))
    .filter((segment) => segment.text);

  const spoken = new Map();
  if (input.length === 0) return spoken;

  // The way a technical name is written for speech depends on the script of
  // the target language: an Arabic dub says "كالي لينكس", a Spanish dub keeps
  // "Kali Linux" because that is how it is pronounced there.
  const target = languageBase(targetLanguage);
  const usesLatinScript = !TARGET_SCRIPT_PATTERNS[target];

  const languageName =
    {
      ar: 'Arabic',
      es: 'Spanish',
      fr: 'French',
      de: 'German',
      it: 'Italian',
      pt: 'Portuguese',
      ru: 'Russian',
      hi: 'Hindi',
      zh: 'Chinese',
      ja: 'Japanese',
      ko: 'Korean',
      tr: 'Turkish',
      nl: 'Dutch',
      pl: 'Polish',
      en: 'English',
    }[target] || targetLanguage;

  const numberExamples = {
    ar: '"64" becomes "أربعة وستون", "23.1" becomes "ثلاثة وعشرون فاصلة واحد"',
    es: '"64" becomes "sesenta y cuatro", "23.1" becomes "veintitrés coma uno"',
    fr: '"64" becomes "soixante-quatre", "23.1" becomes "vingt-trois virgule un"',
    de: '"64" becomes "vierundsechzig", "23.1" becomes "dreiundzwanzig Komma eins"',
    it: '"64" becomes "sessantaquattro", "23.1" becomes "ventitré virgola uno"',
    pt: '"64" becomes "sessenta e quatro", "23.1" becomes "vinte e três vírgula um"',
    ru: '"64" becomes "шестьдесят четыре", "23.1" becomes "двадцать три запятая один"',
    tr: '"64" becomes "altmış dört", "23.1" becomes "yirmi üç virgül bir"',
    nl: '"64" becomes "vierenzestig", "23.1" becomes "drieëntwintig komma een"',
    pl: '"64" becomes "sześćdziesiąt cztery", "23.1" becomes "dwadzieścia trzy przecinek jeden"',
    en: '"64" becomes "sixty-four", "23.1" becomes "twenty-three point one"',
  }[target] || '"64" and "23.1" written as words';

  const numberRule = usesLatinScript
    ? 'Keep every number EXACTLY as it appears in the input, do not convert it and do not change its value: the ' +
      languageName +
      ' voice reads the digits the way a native speaker says them. '
    : 'Write every number clearly for a ' +
      languageName +
      ' speaker (' +
      numberExamples +
      ') when helpful for pronunciation, without changing its value. ';

  const termRule =
    'Keep every technical name, product name, tool name, command, file/path, acronym and code identifier EXACTLY as written in English/Latin script (for example OpenVPN, sudo, UDP, Kali Linux, apt, /etc/hosts). ' +
    'Do not transliterate these terms into ' +
    languageName +
    ' script and do not replace them with paraphrases; keep them in the sentence so the TTS voice can pronounce them in English clearly. ';

  const system =
    'You prepare ' +
    languageName +
    ' subtitles for narration. For each ' +
    languageName +
    ' sentence given to you, return the SAME sentence rewritten for SPEAKING ALOUD in ' +
    languageName +
    '. ' +
    termRule +
    numberRule +
    'Keep the meaning and the tone identical, and use natural, professional ' +
    languageName +
    ' with correct grammar and correct number agreement. ' +
    'Return ONLY valid JSON: {"segments":["spoken sentence 1","spoken sentence 2"]}. ' +
    'Return exactly ' +
    input.length +
    ' strings, in the same order as the input sentences.';

  const batches = chunkArray(input, 10);
  for (const batch of batches) {
    let content = '';
    try {
      content = await callQualityChat(
        [
          { role: 'system', content: system },
          {
            role: 'user',
            content:
              `Target language: ${targetLanguage}\n\nSentences:\n` +
              JSON.stringify(batch.map((s) => ({ start: s.start, end: s.end, text: s.text }))),
          },
        ],
        {
          fast: true,
          temperature: 0.1,
          maxTokens: 5000,
          responseFormat: { type: 'json_object' },
        },
      );
    } catch (error) {
      console.error('[generateSpokenVersions] chat error:', error?.message);
      continue;
    }

    const parsed = parseJson(content);
    const list = parsed?.segments;
    if (!Array.isArray(list) || list.length !== batch.length) {
      console.warn(
        '[generateSpokenVersions] rejected batch: expected',
        batch.length,
        'got',
        list?.length ?? 'none',
      );
      continue;
    }

    batch.forEach((segment, i) => {
      const value = String(
        typeof list[i] === 'string' ? list[i] : list[i]?.text ?? '',
      ).trim();
      if (value) spoken.set(segment.index, value);
    });
  }

  return spoken;
};

/**
 * Refines the spoken (TTS) text for clarity and meaning in the target language,
 * so the dubbed voice sounds natural and understandable.
 */
const refineSpokenForVoice = async ({ segments, targetLanguage }) => {
  const input = (segments || [])
    .map((segment, position) => ({
      index: Number.isInteger(segment?.index) ? segment.index : position,
      text: String(segment?.spokenText || segment?.text || '').trim(),
      original: String(segment?.sourceText || segment?.original || '').trim(),
    }))
    .filter((s) => s.text);
  const out = new Map();
  if (!input.length) return out;

  const target = languageBase(targetLanguage);
  const languageName = { ar: 'Arabic', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', ru: 'Russian', hi: 'Hindi', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', tr: 'Turkish', nl: 'Dutch', pl: 'Polish', en: 'English' }[target] || targetLanguage;
  const system =
    `You are a voice/dubbing script editor for ${languageName}. ` +
    `Given each sentence and its original meaning, rewrite it as ONE clear, natural spoken sentence for TTS in ${languageName} ` +
    `so pronunciation, meaning, and flow are easy to understand. Keep the meaning faithful to the original. ` +
    `Use correct grammar and natural phrasing; keep correct gender, number and pronoun agreement; for Arabic add/keep full tashkeel where helpful for pronunciation. ` +
    `Keep every technical name, tool, command, path, acronym and code identifier in clear English/Latin script exactly as written (e.g. OpenVPN, sudo, UDP, Kali Linux): do not transliterate them into ${languageName} script and do not paraphrase them. ` +
    `Return ONLY valid JSON: {"segments":["spoken sentence 1", ...]} in the same order and same count (${input.length}).`;

  const batches = chunkArray(input, 10);
  for (const batch of batches) {
    try {
      const content = await callQualityChat(
        [
          { role: 'system', content: system },
          { role: 'user', content: `Target: ${targetLanguage}\n` + JSON.stringify(batch.map(b => ({ original: b.original, text: b.text }))) },
        ],
        { fast: true, temperature: 0.15, maxTokens: 4000, responseFormat: { type: 'json_object' } },
      );
      const parsed = parseJson(content);
      const list = parsed?.segments;
      if (Array.isArray(list) && list.length === batch.length) {
        batch.forEach((seg, i) => {
          const raw = String(typeof list[i] === 'string' ? list[i] : list[i]?.text || '').trim();
          if (!raw) return;
          // The refinement pass can rewrite a technical term, so the glossary
          // is applied once more to keep the pronunciation exact.
          const repaired = repairTechnicalTerms({
            text: raw,
            spokenText: raw,
            sourceText: seg.original,
            targetLanguage,
          });
          const v = String(repaired.spokenText || raw).replace(/\s+/g, ' ').trim();
          if (v) out.set(seg.index, v);
        });
      }
    } catch (e) {
      console.error('[refineSpokenForVoice] error:', e?.message);
    }
  }
  return out;
};

const translateBatchOnce = async ({ batch, targetLanguage, highQuality, context = [], provider = null }) => {
  const messages = buildTranslationMessages({ batch, targetLanguage, highQuality, context });
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let content = '';
    try {
      content = highQuality
        ? await callQualityChat(messages, {
            temperature: attempt === 0 ? 0.15 : 0.05,
            maxTokens: 8000,
            responseFormat: { type: 'json_object' },
            provider,
          })
        : await callQualityChat(messages, {
            fast: true,
            temperature: attempt === 0 ? 0.1 : 0.05,
            maxTokens: 8000,
            responseFormat: { type: 'json_object' },
            provider,
          });
    } catch (e) {
      console.error('[translateSegmentsOnce] chat error:', e?.message);
      if (attempt === maxAttempts - 1) return null;
      continue;
    }

    const parsed = parseJson(content);
    const rawSegments = parsed?.segments;
    if (!Array.isArray(rawSegments) || rawSegments.length !== batch.length) {
      console.warn(
        '[translateSegmentsOnce] batch rejected: expected',
        batch.length,
        'segments, got',
        rawSegments?.length ?? 'none',
        `(attempt ${attempt + 1}/${maxAttempts})`,
      );
      if (attempt === maxAttempts - 1) return null;
      continue;
    }

    // Accept the compact array of strings as well as an object array.
    const translated = rawSegments.map((seg, index) => ({
      start: batch[index].start,
      end: batch[index].end,
      text: stripMarkdown(
        typeof seg === 'string' ? seg : String(seg?.t ?? seg?.text ?? ''),
      ),
    }));

    // The model still occasionally drops a letter from a technical term
    // ("erminal", "gues edition"). The glossary repair is deterministic, so it
    // runs on every segment before the translation is accepted.
    translated.forEach((seg, index) => {
      seg.text = repairTechnicalTerms({
        text: seg.text,
        sourceText: batch[index].text,
        targetLanguage,
      }).text;
    });

    const wrongLanguage = translated.find(
      (seg, index) =>
        !seg.text || !isTargetLanguageText(seg.text, targetLanguage, batch[index].text),
    );
    if (wrongLanguage) {
      console.warn(
        '[translateSegmentsOnce] batch rejected: segment',
        wrongLanguage.text?.slice(0, 60) || '(empty)',
        'is not in the target language',
        `(attempt ${attempt + 1}/${maxAttempts})`,
      );
      if (attempt === maxAttempts - 1) return null;
      continue;
    }

    return translated;
  }

  return null;
};

/**
 * Translates a batch, halving it whenever a batch fails so that one bad
 * batch cannot poison the whole transcript.
 */
const translateBatchResilient = async ({ batch, targetLanguage, highQuality, context = [], provider = null }) => {
  const translated = await translateBatchOnce({ batch, targetLanguage, highQuality, context, provider });
  if (translated) return translated;

  if (batch.length === 1) {
    const sourceText = String(batch[0].text || '').trim();
    const target = languageBase(targetLanguage);
    const scriptPattern = TARGET_SCRIPT_PATTERNS[target];
    const targetCharsInSource = scriptPattern ? countMatches(sourceText, scriptPattern) : 0;

    // Last-chance: a very explicit single-sentence translation prompt. This
    // recovers segments where the batch-format response was malformed/empty.
    if (sourceText && !isTechnicalLiteral(sourceText)) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const simple = await callQualityChat(
            [
              {
                role: 'system',
                content:
                  `Translate the user's sentence into ${targetLanguage}. Return ONLY valid JSON: {"text":"..."} . ` +
                  'Keep technical terms, product names, commands, file paths and code identifiers in English/Latin script. ' +
                  (target.startsWith('ar')
                    ? 'For Arabic, use clear, grammatically correct Modern Standard Arabic (فصحى) with complete tashkeel/diacritics. '
                    : '') +
                  'Do not return empty text. Do not return the source unchanged unless it is already in the target language.',
              },
              { role: 'user', content: sourceText },
            ],
            {
              highQuality: true,
              temperature: attempt === 0 ? 0.2 : 0.05,
              maxTokens: 1200,
              responseFormat: { type: 'json_object' },
              provider,
            },
          );
          const parsed = parseJson(simple);
          const candidate = stripMarkdown(String(parsed?.text ?? parsed?.translation ?? parsed?.translated ?? '')).trim();
          if (candidate) {
            const repaired = repairTechnicalTerms({
              text: candidate,
              sourceText,
              targetLanguage,
            }).text;
            if (repaired && isTargetLanguageText(repaired, targetLanguage, sourceText)) {
              return [{ start: batch[0].start, end: batch[0].end, text: repaired }];
            }
            console.warn(
              '[translateSegmentsOnce] single-segment retry rejected:',
              repaired?.slice(0, 60) || '(empty)',
              `(attempt ${attempt + 1}/2)`,
            );
          }
        } catch (e) {
          console.warn('[translateSegmentsOnce] single-segment retry error:', e?.message);
        }
      }
    }

    const looksTechnicalOrUntranslatable =
      !sourceText ||
      targetCharsInSource > 0 ||
      isTechnicalLiteral(sourceText);
    if (looksTechnicalOrUntranslatable) {
      console.warn(
        '[translateSegmentsOnce] using source text for untranslatable segment:',
        sourceText.slice(0, 80),
      );
      return [
        {
          start: batch[0].start,
          end: batch[0].end,
          text: sourceText,
        },
      ];
    }
    const err = new Error(
      `Could not translate a segment into ${targetLanguage}: "${sourceText.slice(0, 80)}"`,
    );
    err.code = 'TRANSLATION_FAILED';
    err.statusCode = 502;
    throw err;
  }

  const mid = Math.ceil(batch.length / 2);
  const head = await translateBatchResilient({
    batch: batch.slice(0, mid),
    targetLanguage,
    highQuality,
    context: context.slice(0, mid),
    provider,
  });
  const tail = await translateBatchResilient({
    batch: batch.slice(mid),
    targetLanguage,
    highQuality,
    context: context.slice(mid),
    provider,
  });
  return [...head, ...tail];
};

const translateSegmentsOnce = async ({
  segments,
  targetLanguage,
  highQuality = false,
  context = [],
  onProgress = null,
  provider = null,
}) => {
  const input = (segments || []).map(toPair).filter((s) => s.text);
  if (input.length === 0) return [];

  const output = [];
  const batches = chunkArray(input, 12);

  let cursor = 0;
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const batchContext = context.slice(cursor, cursor + batch.length);
    cursor += batch.length;

    const safe = batch.map(({ start, end, text }) => ({ start, end, text }));
    output.push(
      ...(await translateBatchResilient({
        batch: safe,
        targetLanguage,
        highQuality,
        context: batchContext,
        provider,
      })),
    );

    if (typeof onProgress === 'function') {
      try {
        onProgress((batchIndex + 1) / batches.length);
      } catch {
        // progress reporting must never break the translation
      }
    }
  }

  return output;
};

export const evaluateTranslationSegments = async ({ pairs, targetLanguage }) => {
  const input = (pairs || [])
    .map((p, index) => ({
      index,
      original: String(p?.original || '').trim(),
      translated: String(p?.translated || '').trim(),
    }))
    .filter((p) => p.original);

  if (input.length === 0) return [];

  const results = new Array(input.length).fill(null).map((_, i) => ({
    index: i,
    score: null,
    reason: '',
    suggestions: [],
  }));

  const batches = chunkArray(input, 8);
  for (const batch of batches) {
    let parsed = null;
    try {
      // The evaluation is advisory (it only decides what to retry), so it runs
      // on the fast model. Scoring with the reasoning model burned the whole
      // rate limit budget and slowed the dub down to a crawl.
      const content = await callQualityChat(
        [
          {
            role: 'system',
            content:
              'You are a strict bilingual translation quality evaluator and editor. ' +
              'Compare each ORIGINAL (English) sentence with its TRANSLATED sentence. ' +
              'Score from 0 to 10 (decimals allowed) for: meaning accuracy, completeness, grammar, naturalness, and preservation of intent. ' +
              'Penalise heavily (maximum 5) when a technical term, product name, command or code identifier is misspelled, shortened, merged with another word or missing its first/last letter. ' +
              'Also penalise wrong grammatical gender, number or pronoun agreement. ' +
              'A score of 8 or higher means the translation is acceptable. ' +
              'If you notice English words that were left untranslated, suggest an equivalent phrase in the TARGET LANGUAGE based on the whole sentence context (not word-by-word). ' +
              'Return ONLY valid JSON: {"results":[{"i":number,"s":number,"r":string,"w":[{"e":string,"x":string}]}]}. ' +
              'One result per input item, same order as given. Keep "r" under 12 words and only include "w" suggestions when the score is below 8.',
          },
          {
            role: 'user',
            content:
              `Target language: ${targetLanguage}\n\nPairs:\n` +
              JSON.stringify(batch.map(({ original, translated }, i) => ({ n: i, original, translated }))),
          },
        ],
        {
          fast: true,
          temperature: 0.0,
          maxTokens: 2000,
          responseFormat: { type: 'json_object' },
        },
      );
      parsed = parseJson(content);
    } catch {
      parsed = null;
    }

    if (parsed && Array.isArray(parsed.results) && parsed.results.length === batch.length) {
      for (let i = 0; i < batch.length; i += 1) {
        const r = parsed.results[i] || {};
        const scoreRaw = Number(r.s ?? r.score);
        const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(10, scoreRaw)) : null;
        const suggestions = Array.isArray(r.w ?? r.suggestions)
          ? (r.w ?? r.suggestions)
              .map((s) => ({
                english: String(s?.e ?? s?.english ?? '').trim(),
                equivalent: String(s?.x ?? s?.equivalent ?? '').trim(),
              }))
              .filter((s) => s.english && s.equivalent)
          : [];
        results[batch[i].index] = {
          index: batch[i].index,
          score,
          reason: stripMarkdown(String(r.r ?? r.reason ?? '')),
          suggestions,
        };
      }
    }
  }

  return results;
};

export const translateTranscriptSegments = async ({
  segments,
  targetLanguage,
  originalLanguage = 'en',
  fast = false,
  onProgress = null,
}) => {
  // The transcript itself contains speech-to-text mistakes in technical names
  // ("guest edition CD image" instead of "Guest Additions CD image"). Fixing
  // them here means the translation, the subtitles and the narration are all
  // built from the real term.
  const source = (segments || [])
    .map(toPair)
    .map((segment) => ({ ...segment, text: normalizeTechnicalSource(segment.text) }))
    .filter((s) => s.text);

  if (source.length === 0) return [];

  // Nothing to translate when the target matches the source language. Calling
  // the model here only burns rate limit and can return the source unchanged.
  if (
    languageBase(targetLanguage) &&
    languageBase(targetLanguage) === languageBase(originalLanguage)
  ) {
    return source.map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text,
      spokenText: s.text,
      sourceText: s.text,
      originalLanguage: originalLanguage || 'en',
      targetLanguage,
      qualityScore: null,
      qualityStatus: 'unknown',
      qualityReason: '',
      translationAttempts: 0,
      wordSuggestions: [],
    }));
  }

  // 1. Initial translation.
  const initial = await translateSegmentsOnce({
    segments: source,
    targetLanguage,
    highQuality: false,
    onProgress,
  });

  const currentSegments = source.map((s, index) => {
    const t = initial[index];
    if (t && typeof t.text === 'string' && t.text.trim()) {
      return { start: s.start, end: s.end, text: t.text.trim() };
    }
    return { start: s.start, end: s.end, text: s.text };
  });

  // 2. Evaluate against original English.
  //
  // Fast mode skips the evaluation and the retries, but still produces the
  // spoken version, so it is not returned early.
  let evaluations = [];
  if (!fast) {
    const pairs = source.map((s, index) => ({
      original: s.text,
      translated: currentSegments[index].text,
    }));
    evaluations = await evaluateTranslationSegments({ pairs, targetLanguage });
  }

  const attempts = source.map(() => 1);
  const bestScores = evaluations.map((e) =>
    e && typeof e.score === 'number' ? e.score : null,
  );

  // Cross-model (quality-model) second opinion: translate the same source with
  // the high-quality model (e.g. deepseek-reasoner) and keep the per-segment
  // version that scores higher against the original. This is what lifts the
  // match above 95% instead of trusting a single model/pass.
  if (!fast && env.aiModelQuality && env.aiModelQuality !== env.aiModelFast) {
    try {
      const qualityTranslated = await translateSegmentsOnce({
        segments: source,
        targetLanguage,
        highQuality: true,
      });
      const qualityPairs = source.map((s, index) => ({
        original: s.text,
        translated:
          qualityTranslated[index] && qualityTranslated[index].text
            ? qualityTranslated[index].text
            : currentSegments[index].text,
      }));
      const qualityEvals = await evaluateTranslationSegments({
        pairs: qualityPairs,
        targetLanguage,
      });
      qualityTranslated.forEach((seg, index) => {
        if (!seg || !seg.text) return;
        const qualityScore =
          qualityEvals[index] && typeof qualityEvals[index].score === 'number'
            ? qualityEvals[index].score
            : null;
        const currentScore = bestScores[index];
        if (qualityScore !== null && (currentScore === null || qualityScore > currentScore)) {
          currentSegments[index] = {
            start: source[index].start,
            end: source[index].end,
            text: String(seg.text).trim(),
            spokenText: '',
          };
          if (qualityEvals[index]) evaluations[index] = qualityEvals[index];
          bestScores[index] = qualityScore;
          attempts[index] = 1;
        }
      });
    } catch (error) {
      console.warn('[translate] quality-model second-opinion pass failed:', error?.message);
    }
  }


  // 3. Iterative refinement: compare original vs translated, get edit
  // suggestions from the evaluator, and retry until each segment reaches
  // >= 95% match (score 9.5/10) or attempts are exhausted, always keeping
  // the best-scoring version.
  const needsTashkeel = String(targetLanguage || '').toLowerCase().startsWith('ar');
  for (let attempt = 2; attempt <= MAX_TRANSLATION_ATTEMPTS; attempt += 1) {
    const lowIndices = source
      .map((_, index) => index)
      .filter((index) => {
        const score = bestScores[index];
        const lowScore = score === null || score < QUALITY_THRESHOLD;
        const missingTashkeel =
          needsTashkeel &&
          hasArabicLetters(currentSegments[index].text) &&
          !hasTashkeel(currentSegments[index].text);
        return lowScore || missingTashkeel;
      });

    if (lowIndices.length === 0) break;

    const lowSegments = lowIndices.map((index) => source[index]);
    const lowContext = lowIndices.map((index) => ({
      previous: currentSegments[index].text,
      score: bestScores[index],
      reason: evaluations[index]?.reason || '',
      suggestions: evaluations[index]?.suggestions || [],
    }));

    const retried = await translateSegmentsOnce({
      segments: lowSegments,
      targetLanguage,
      highQuality: true,
      context: lowContext,
    });

    const retriedEvalInput = lowIndices.map((index, localIndex) => ({
      original: source[index].text,
      translated:
        retried[localIndex] && retried[localIndex].text
          ? retried[localIndex].text
          : currentSegments[index].text,
    }));
    const retriedEval = await evaluateTranslationSegments({
      pairs: retriedEvalInput,
      targetLanguage,
    });

    lowIndices.forEach((index, localIndex) => {
      const candSegment = retried[localIndex];
      const candEval = retriedEval[localIndex];
      const candScore =
        candEval && typeof candEval.score === 'number' ? candEval.score : null;
      const prevScore = bestScores[index];

      const shouldReplace =
        candSegment &&
        candSegment.text &&
        (prevScore === null ||
          candSegment.text !== currentSegments[index].text ||
          (candScore !== null &&
            (prevScore === null || candScore > prevScore)));

      if (shouldReplace) {
        currentSegments[index] = {
          start: source[index].start,
          end: source[index].end,
          text: String(candSegment.text).trim(),
          // The spoken version was built from the previous wording, so it is
          // rebuilt whenever the translation changes.
          spokenText: '',
        };
        evaluations[index] = {
          index,
          score: candScore,
          reason: candEval?.reason || evaluations[index]?.reason || '',
          suggestions:
            candEval?.suggestions?.length
              ? candEval.suggestions
              : evaluations[index]?.suggestions || [],
        };
        bestScores[index] = candScore !== null ? candScore : bestScores[index];
        attempts[index] = attempt;
      } else if (bestScores[index] !== null && bestScores[index] < QUALITY_THRESHOLD) {
        attempts[index] = attempt;
      }
    });
  }

  // 4. Spoken version for the narration.
  //
  // The subtitles keep the English technical names in Latin script so the
  // reader recognises them, while the narration reads them the way the
  // target language pronounces them. Only the sentences that contain a
  // technical name or a number are rewritten, which keeps this pass cheap.
  // It runs after the retries so it works from the final wording.
  const withSpoken = Boolean(TARGET_SCRIPT_PATTERNS[languageBase(targetLanguage)]);
  // Only Arabic has a deterministic number speller here. The other scripts
  // are spelled out by the model, in their own language.
  const isArabicTarget = languageBase(targetLanguage) === 'ar';
  if (withSpoken) {
    const needsSpoken = currentSegments
      .map((segment, index) => ({ ...segment, index }))
      .filter((segment) => /[A-Za-z0-9]/.test(segment.text));

    if (needsSpoken.length > 0) {
      const spoken = await generateSpokenVersions({
        segments: needsSpoken,
        targetLanguage,
      });
      needsSpoken.forEach((segment) => {
        const value = spoken.get(segment.index);
        if (value) currentSegments[segment.index].spokenText = value;
      });

      // Keep English technical terms/commands in Latin script for spoken text so
      // TTS can pronounce them clearly in English (same voice). Do not force a
      // "no Latin letters" rewrite that would transliterate terms away.
      console.log(
        `[translate] spoken version generated for ${spoken.size}/${needsSpoken.length} segment(s) with technical names`,
      );
    }
  }

  // Every segment gets a spoken version: the ones without technical names
  // simply reuse the subtitle text with the numbers spelled out.
  currentSegments.forEach((segment) => {
    const spoken = String(segment.spokenText || segment.text || '').trim();
    segment.spokenText = isArabicTarget ? spellOutNumbersInArabic(spoken) : spoken;
  });

  // Refine spoken text for voice clarity/meaning in the target language (best
  // effort) so dubbing sounds natural and clear.
  if (!fast) {
    try {
      const refined = await refineSpokenForVoice({
        segments: currentSegments.map((s, i) => ({
          index: i,
          spokenText: s.spokenText,
          text: s.text,
          sourceText: source[i]?.text || '',
        })),
        targetLanguage,
      });
      refined.forEach((value, index) => {
        if (value && currentSegments[index]) currentSegments[index].spokenText = value;
      });
    } catch (e) {
      console.error('[translate] spoken refinement failed:', e?.message);
    }
  }

  // 5. Final evaluation for missing scores.
  const needsFinalEval = source
    .map((_, index) => index)
    .filter((index) => evaluations[index] == null || evaluations[index].score == null);

  if (needsFinalEval.length) {
    const finalEvalInput = needsFinalEval.map((index) => ({
      original: source[index].text,
      translated: currentSegments[index].text,
    }));
    const finalEval = await evaluateTranslationSegments({
      pairs: finalEvalInput,
      targetLanguage,
    });
    needsFinalEval.forEach((index, localIndex) => {
      evaluations[index] = {
        index,
        score: finalEval[localIndex]?.score ?? null,
        reason: finalEval[localIndex]?.reason || '',
        suggestions: finalEval[localIndex]?.suggestions || [],
      };
      const sc = finalEval[localIndex]?.score;
      if (typeof sc === 'number') bestScores[index] = sc;
    });
  }

  // 5. Assemble output.
  return source.map((s, index) => {
    const ev = evaluations[index] || {};
    const score = typeof ev.score === 'number' ? ev.score : null;
    const spokenText = String(
      currentSegments[index].spokenText || currentSegments[index].text,
    ).trim();

    // Last deterministic pass: whatever the model produced, the technical
    // terms in the subtitle and in the narration are exactly right. This also
    // repairs segments that were never sent to the spoken-version pass.
    const repaired = repairTechnicalTerms({
      text: currentSegments[index].text,
      spokenText,
      sourceText: s.text,
      targetLanguage,
    });

    return {
      start: s.start,
      end: s.end,
      text: repaired.text,
      spokenText: isArabicTarget
        ? spellOutNumbersInArabic(repaired.spokenText)
        : repaired.spokenText,
      sourceText: s.text,
      originalLanguage: originalLanguage || 'en',
      targetLanguage,
      qualityScore: score,
      qualityStatus:
        score === null ? 'unknown' : score >= QUALITY_THRESHOLD ? 'passed' : 'failed',
      qualityReason: ev.reason || '',
      translationAttempts: attempts[index] || 1,
      wordSuggestions: Array.isArray(ev.suggestions) ? ev.suggestions : [],
    };
  });
};
export const generateEducationalScript = async ({ video, targetLanguage }) => {
  const translation = (video.translations || []).find((t) => t.language === targetLanguage);
  const transcript = translation?.transcript || video.transcript || '';
  const ai = video.aiMetadata || {};
  const duration = Math.max(1, Number(video.durationSeconds) || 120);

  const content = await callChatCompletion(
    [
      {
        role: 'system',
        content:
          (targetLanguage.startsWith('ar')
            ? `${EGYPTIAN_ARABIC_RULES}\n\nYou are a Senior Technical Curriculum Developer and Video Narration Agent for an Arabic technical YouTube channel ("Udemy بالعربي"). `
            : `You are a Senior Technical Curriculum Developer and Video Narration Agent for a technical YouTube channel. Write the lesson in ${targetLanguage}. `) +
          'Generate the final spoken narration only. Strictly enforce these production standards: ' +
          '1) Accurate and practical technical instructions: verify every command, configuration, version, and code concept before using it; never use placeholders or outdated syntax; provide sequential numbered steps and beginner troubleshooting callouts where useful. ' +
          '2) Natural voiceover flow for TTS: write conversational active sentences, break breathless clauses into short dynamic statements, and pace naturally for spoken delivery. ' +
          (targetLanguage.startsWith('ar')
            ? 'Use clear, understandable, and grammatically correct Modern Standard Arabic (فصحى), with tashkeel/diacritics where pronunciation matters. Handle technical English terms by writing an Arabic explanation followed by the English term in parentheses on first use when helpful, for example "الاختراق (Hacking)", "المحاكاة (Simulation)", "التصدّي (Mitigation)", while keeping commands/code identifiers in English. '
            : '') +
          'Break explanations into sequential, numbered steps that a viewer can replicate directly on screen. Provide practical setup/troubleshooting callouts where useful. ' +
          `The final spoken narration must last no more than ${duration} seconds. Use at most ${Math.max(300, Math.floor(duration * 9))} characters total, including spaces and punctuation. ` +
          'Include a hook, objectives, a thorough explanation, key takeaways, and a recap. ' +
          'Return plain narration text only. No markdown, no headings, no labels, no JSON, no timestamps, no debug text.',
      },
      {
        role: 'user',
        content: [
          `Title: ${video.title || 'Untitled lesson'}`,
          `Summary: ${ai.summary || 'N/A'}`,
          `Key points: ${Array.isArray(ai.keyPoints) ? ai.keyPoints.join('; ') : 'N/A'}`,
          `Action items: ${Array.isArray(ai.actionItems) ? ai.actionItems.join('; ') : 'N/A'}`,
          `Chapters: ${Array.isArray(ai.chapters) ? ai.chapters.map((c) => `${c.time} ${c.title}`).join('; ') : 'N/A'}`,
          `Transcript (${targetLanguage}): ${trim(transcript, 12000)}`,
        ].join('\\n'),
      },
    ],
    {
      provider: resolveProvider(),
      fast: true,
      temperature: 0.4,
      maxTokens: 700,
    },
  );

  let normalizedContent = String(content || '').trim();
  const targetChars = Math.max(500, Number(duration) > 0 ? Math.floor(duration * 12) : 1200);
  if (normalizedContent.length > targetChars) {
    let cut = normalizedContent.lastIndexOf('. ', targetChars);
    if (cut < targetChars * 0.5) cut = normalizedContent.lastIndexOf(' ', targetChars);
    if (cut > 0) normalizedContent = normalizedContent.slice(0, cut + 1).trim();
  }

  return stripMarkdown(normalizedContent);
};

export const answerQuestion = async ({ transcript, question }) => {
  if (!transcript) {
    const err = new Error('No transcript available for this video');
    err.statusCode = 400;
    throw err;
  }

  const context = trim(transcript, 24000);

  const content = await callChatCompletion(
    [
      {
        role: 'system',
        content:
          'You are an assistant that answers questions about a video transcript. ' +
          'Answer only from the transcript. If the answer is not in the transcript, say you could not find it.',
      },
      {
        role: 'user',
        content: `Transcript (partial):\n${context}\n\nQuestion: ${question}`,
      },
    ],
    { temperature: 0.3, maxTokens: 1200 }
  );

  return String(content || '').trim();
};


export const translatePublishMetadata = async ({ metadata, targetLanguage, originalLanguage = 'en' }) => {
  const meta = metadata && typeof metadata === 'object' ? metadata : {};
  if (!targetLanguage || String(targetLanguage).toLowerCase().startsWith(String(originalLanguage || 'en').toLowerCase())) {
    return meta;
  }

  const source = {
    title: String(meta?.titles?.[0] || meta?.title || '').trim(),
    description: String(meta?.descriptions?.[0] || meta?.description || '').trim(),
    summary: String(meta?.summary || '').trim(),
    chapters: Array.isArray(meta?.chapters) ? meta.chapters.map((c) => String(c?.title || '').trim()) : [],
    keyPoints: Array.isArray(meta?.keyPoints) ? meta.keyPoints.map((v) => String(v || '').trim()) : [],
    openQuestions: Array.isArray(meta?.openQuestions) ? meta.openQuestions.map((v) => String(v || '').trim()) : [],
    tags: Array.isArray(meta?.tags) ? meta.tags.map((v) => String(v || '').trim()) : [],
  };

  try {
    const content = await callChatCompletion(
      [
        {
          role: 'system',
          content:
            `You are a professional translator and copywriter. Translate every value of the provided JSON into ${targetLanguage}. ` +
            'Keep the exact same JSON structure and array lengths. ' +
            'Make the title and description natural, fluent, and easy to read. ' +
            'Never translate technical terms, product names, framework/library names, API names, CLI commands, file paths or code identifiers: keep them exactly as written in clear English/Latin script (for example React, Node.js, Express, MongoDB, API, Docker, npm install, GitHub) inside the translated sentence. ' +
            'Return ONLY valid JSON with keys: title, description, summary, chapters, keyPoints, openQuestions, tags.',
        },
        {
          role: 'user',
          content: `Source JSON:\n${JSON.stringify(source)}`,
        },
      ],
      {
        temperature: 0.2,
        maxTokens: 4000,
        responseFormat: { type: 'json_object' },
      },
    );

    const parsed = parseJson(content);
    if (parsed && typeof parsed === 'object') {
      const chapters = Array.isArray(parsed.chapters)
        ? (meta.chapters || []).map((chapter, index) => ({
            ...chapter,
            title: String(parsed.chapters[index] || chapter?.title || '').trim() || chapter?.title,
          }))
        : meta.chapters || [];
      const tags = Array.isArray(parsed.tags) && parsed.tags.length ? parsed.tags.map(String) : meta.tags || [];
      return {
        ...meta,
        titles: parsed.title ? [String(parsed.title).trim()] : meta.titles || [],
        descriptions: parsed.description ? [String(parsed.description).trim()] : meta.descriptions || [],
        summary: parsed.summary ? String(parsed.summary).trim() : meta.summary || '',
        chapters,
        keyPoints: Array.isArray(parsed.keyPoints) && parsed.keyPoints.length ? parsed.keyPoints.map(String) : meta.keyPoints || [],
        openQuestions: Array.isArray(parsed.openQuestions) && parsed.openQuestions.length
          ? parsed.openQuestions.map(String)
          : meta.openQuestions || [],
        tags,
      };
    }
  } catch (error) {
    console.error("[translatePublishMetadata] error:", error?.message || error);
    // Fall back to original metadata.
  }

  return meta;
};

export const condenseTranslationForDuration = async ({ text, targetLanguage, maxChars }) => {
  const clean = stripMarkdown(text);
  if (!clean) return '';
  const limit = Math.max(20, Number(maxChars) || clean.length);
  if (clean.length <= limit) return clean;

  try {
    const content = await callChatCompletion(
      [
        {
          role: 'system',
          content:
            `You are an expert subtitle editor. Condense the translated subtitle text into at most ${limit} characters ` +
            `for the target language ${targetLanguage}, while preserving the core meaning and any critical action keywords. ` +
            'Return the condensed text only.',
        },
        { role: 'user', content: clean },
      ],
      { temperature: 0.1, maxTokens: 512 },
    );
    const condensed = stripMarkdown(content);
    if (condensed && condensed.length >= limit * 0.5 && condensed.length <= limit * 1.2) return condensed;
  } catch {
    // fall through to trimmed original
  }

  // Hard fallback: truncate without breaking the last whole word.
  const sliced = clean.slice(0, limit);
  const lastSpace = sliced.lastIndexOf(' ');
  return (lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced).trim();
};

export const improvePublishSeo = async ({ metadata, targetLanguage = 'en', context = {} }) => {
  const meta = metadata && typeof metadata === 'object' ? metadata : {};
  const lang = String(targetLanguage || 'en').split('-')[0];
  const source = {
    currentTitle: String(context.currentTitle || meta?.titles?.[0] || '').trim(),
    titles: Array.isArray(meta?.titles) ? meta.titles.map((v) => String(v || '').trim()).filter(Boolean) : [],
    descriptions: Array.isArray(meta?.descriptions) ? meta.descriptions.map((v) => String(v || '').trim()).filter(Boolean) : [],
    summary: String(meta?.summary || '').trim(),
    chapters: Array.isArray(meta?.chapters) ? meta.chapters.map((c) => ({ time: c?.time || '00:00', title: String(c?.title || '').trim() })) : [],
    keyPoints: Array.isArray(meta?.keyPoints) ? meta.keyPoints.map((v) => String(v || '').trim()).filter(Boolean) : [],
    openQuestions: Array.isArray(meta?.openQuestions) ? meta.openQuestions.map((v) => String(v || '').trim()).filter(Boolean) : [],
    tags: Array.isArray(meta?.tags) ? meta.tags.map((v) => String(v || '').trim()).filter(Boolean) : [],
    videoTitle: String(context.videoTitle || '').trim(),
    courseTitle: String(context.courseTitle || '').trim(),
    lessonNumber: context.lessonNumber ?? null,
  };

  const content = await callChatCompletion(
    [
      {
        role: 'system',
        content:
          `You are a YouTube SEO and educational copywriting expert. Improve publish metadata in ${targetLanguage} (${lang}) using the provided AI-generated lesson data. ` +
          'Goals: maximize clarity and discoverability while staying accurate to the lesson. ' +
          'Keep technical terms, product names, CLI commands, file paths, and code identifiers in their correct original/English form when appropriate. ' +
          'Return ONLY valid JSON with keys: title, description, tags, hashtags, openQuestions, keyPoints. ' +
          'Rules: ' +
          'title: one compelling, keyword-rich YouTube title (30-65 chars when possible), include lesson number if provided and relevant. ' +
          'description: a well-structured YouTube description in plain text with: a strong 1-2 line hook/summary, "What you will learn" bullets from key points, chapters/timestamps section if chapters exist (format "00:00 - Title"), a short CTA to like/share/subscribe, and 3-8 relevant hashtags at the very end on a new line. Do not invent facts. ' +
          'tags: 8-15 relevant tags/keywords (no #). ' +
          'hashtags: 3-8 hashtags (with #). ' +
          'openQuestions: exactly 3 engaging questions viewers can answer in comments, each ending with "?". ' +
          'keyPoints: 3-6 concise key learning points.',
      },
      {
        role: 'user',
        content:
          `Lesson context (JSON):\n${JSON.stringify(source)}\n\n` +
          'Produce the best SEO-optimized publish metadata based on this data.',
      },
    ],
    {
      temperature: 0.4,
      maxTokens: 4500,
      responseFormat: { type: 'json_object' },
    },
  );

  const parsed = parseJson(content) || {};
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.map((v) => stripMarkdown(String(v || '')).replace(/^#+/, '').trim()).filter(Boolean)
    : source.tags;
  const hashtags = Array.isArray(parsed.hashtags)
    ? parsed.hashtags.map((v) => {
        const t = stripMarkdown(String(v || '')).trim().replace(/^#+/, '').replace(/\s+/g, '');
        return t ? `#${t}` : '';
      }).filter(Boolean)
    : [];
  let description = stripMarkdown(String(parsed.description || '')).trim();
  if (description && hashtags.length && !/#\w/.test(description)) {
    description = `${description}\n\n${hashtags.join(' ')}`.trim();
  }
  const openQuestions = Array.isArray(parsed.openQuestions) && parsed.openQuestions.length
    ? parsed.openQuestions.map((v) => stripMarkdown(String(v || '')).trim()).filter(Boolean).slice(0, 3)
    : source.openQuestions.slice(0, 3);
  const keyPoints = Array.isArray(parsed.keyPoints) && parsed.keyPoints.length
    ? parsed.keyPoints.map((v) => stripMarkdown(String(v || '')).trim()).filter(Boolean).slice(0, 8)
    : source.keyPoints;

  return {
    title: stripMarkdown(String(parsed.title || '')).trim() || source.currentTitle || source.titles[0] || '',
    description: description || source.descriptions[0] || source.summary || '',
    tags,
    hashtags,
    openQuestions,
    keyPoints,
  };
};

export const generateYouTubeSeoPackage = async ({
  metadata,
  targetLanguage = 'ar',
  context = {},
}) => {
  const meta = metadata && typeof metadata === 'object' ? metadata : {};
  const lang = String(targetLanguage || 'ar').split('-')[0] || 'ar';
  const source = {
    videoTitle: String(context.videoTitle || '').trim(),
    courseTitle: String(context.courseTitle || '').trim(),
    playlistTitle: String(context.playlistTitle || context.courseTitle || '').trim(),
    lessonNumber: context.lessonNumber ?? null,
    nextLessonTopic: String(context.nextLessonTopic || '').trim(),
    summary: String(meta?.summary || '').trim(),
    titles: Array.isArray(meta?.titles) ? meta.titles.map((v) => String(v || '').trim()).filter(Boolean) : [],
    descriptions: Array.isArray(meta?.descriptions) ? meta.descriptions.map((v) => String(v || '').trim()).filter(Boolean) : [],
    tags: Array.isArray(meta?.tags) ? meta.tags.map((v) => String(v || '').trim()).filter(Boolean) : [],
    chapters: Array.isArray(meta?.chapters)
      ? meta.chapters.map((c) => ({ time: String(c?.time || '00:00').trim(), title: String(c?.title || '').trim() })).filter((c) => c.title)
      : [],
    keyPoints: Array.isArray(meta?.keyPoints) ? meta.keyPoints.map((v) => String(v || '').trim()).filter(Boolean) : [],
    openQuestions: Array.isArray(meta?.openQuestions) ? meta.openQuestions.map((v) => String(v || '').trim()).filter(Boolean) : [],
    transcriptSnippet: String(context.transcriptSnippet || '').trim().slice(0, 3500),
  };

  const system = [
    'أنت محرك أتمتة متخصص في تحسين محركات البحث على YouTube (YouTube SEO) وصياغة البيانات الوصفية (Metadata) للدورات التقنية المدبلجة إلى اللغة العربية.',
    'مهمتك هي استلام بيانات الدرس الأصلي وتوليد بيانات وصفية محسّنة بالكامل بصيغة JSON صالحة ومباشرة للربط مع YouTube Data API v3.',
    'الأهداف: رفع CTR، زيادة مدة المشاهدة وساعات المشاهدة، وربط الدروس داخل قوائم التشغيل لتحويل المشاهد إلى مشترك.',
    'قيود صارمة:',
    '- الفيديو الأصلي ثابت ومدبلج كما هو؛ لا تفترض مقدمة إضافية أو تعديل مونتاجي.',
    '- أخرج JSON فقط بدون أي نص خارج كائن JSON.',
    '- snippet.title: بحد أقصى 100 حرف (يفضل 55-65)، يركز على الأداة والمهمة العملية دون أرقام دروس جامدة في البداية.',
    '- snippet.description: بحد أقصى 5000 حرف، يبدأ بسطرين جذابين غنيين بالكلمات المفتاحية، ثم شرح مختصر، ثم الفصول الزمنية (00:00)، ثم دعوة للاشتراك ومتابعة قائمة التشغيل. استخدم \\n للأسطر الجديدة.',
    '- snippet.tags: 12-15 عنصرًا، إجمالي الأحرف أقل من 500، تجمع بين المصطلحات العربية والإنجليزية التقنية.',
    '- snippet.categoryId: "27" أو "28".',
    '- snippet.defaultLanguage و snippet.defaultAudioLanguage: "ar".',
    '- اكتب أسماء الأدوات والبروتوكولات والأنظمة بالإنجليزية بدقة كما يبحث عنها المستخدم العربي (مثل Kali Linux, OpenVPN, Tor Browser, Aircrack-ng, VirtualBox, WPA2/WPA3, Nmap, WhatWeb).',
    '- إذا لم تتوفر توقيتات دقيقة، أنشئ فصولًا زمنية تقديرية منطقية تبدأ بـ 00:00 بناءً على تسلسل الشرح، ولا تخترع تفاصيل غير موجودة.',
    'أعد JSON بنفس المخطط والمفاتيح التالية بالضبط:',
    '{"youtube_video_resource":{"snippet":{"title":"","description":"","tags":[],"categoryId":"27","defaultLanguage":"ar","defaultAudioLanguage":"ar"}},"ab_test_titles":{"search_focused":"","problem_solving":"","series_balanced":""},"thumbnail_generation":{"arabic_overlay_text":"","visual_elements":[],"color_mood":""},"playlist_and_retention":{"recommended_playlist_title":"","suggested_next_video_topic":""},"pinned_comment":{"text":""}}',
  ].join('\n');

  const content = await callChatCompletion(
    [
      { role: 'system', content: system },
      {
        role: 'user',
        content:
          `بيانات الدرس (JSON):\n${JSON.stringify(source)}\n\n` +
          `اللغة المستهدفة: ${targetLanguage} (${lang}).\n` +
          'ولّد كائن JSON النهائي المحسّن للنشر على YouTube وفق المخطط المطلوب.',
      },
    ],
    {
      temperature: 0.4,
      maxTokens: 5000,
      responseFormat: { type: 'json_object' },
    },
  );

  const parsed = parseJson(content) || {};
  const snippet = parsed?.youtube_video_resource?.snippet || parsed?.snippet || {};
  const ab = parsed?.ab_test_titles || {};
  const thumb = parsed?.thumbnail_generation || {};
  const pr = parsed?.playlist_and_retention || {};
  const pinned = parsed?.pinned_comment || {};

  const tags = Array.isArray(snippet.tags)
    ? snippet.tags.map((v) => stripMarkdown(String(v || '')).trim()).filter(Boolean).slice(0, 15)
    : source.tags.slice(0, 15);
  const totalTagChars = tags.join(',').length;
  const safeTags = totalTagChars <= 500 ? tags : tags.slice(0, 12);

  const title = stripMarkdown(String(snippet.title || '')).trim().slice(0, 100) || source.titles[0] || source.videoTitle || '';
  const description = String(snippet.description || '').replace(/\r\n/g, '\n').trim().slice(0, 5000);
  const categoryId = ['27', '28'].includes(String(snippet.categoryId || '')) ? String(snippet.categoryId) : '27';

  return {
    youtube_video_resource: {
      snippet: {
        title,
        description,
        tags: safeTags,
        categoryId,
        defaultLanguage: 'ar',
        defaultAudioLanguage: 'ar',
      },
    },
    ab_test_titles: {
      search_focused: stripMarkdown(String(ab.search_focused || '')).trim(),
      problem_solving: stripMarkdown(String(ab.problem_solving || '')).trim(),
      series_balanced: stripMarkdown(String(ab.series_balanced || '')).trim(),
    },
    thumbnail_generation: {
      arabic_overlay_text: stripMarkdown(String(thumb.arabic_overlay_text || '')).trim(),
      visual_elements: Array.isArray(thumb.visual_elements)
        ? thumb.visual_elements.map((v) => stripMarkdown(String(v || '')).trim()).filter(Boolean).slice(0, 6)
        : [],
      color_mood: stripMarkdown(String(thumb.color_mood || '')).trim(),
    },
    playlist_and_retention: {
      recommended_playlist_title: stripMarkdown(String(pr.recommended_playlist_title || source.playlistTitle || source.courseTitle || '')).trim(),
      suggested_next_video_topic: stripMarkdown(String(pr.suggested_next_video_topic || source.nextLessonTopic || '')).trim(),
    },
    pinned_comment: {
      text: String(pinned.text || '').replace(/\r\n/g, '\n').trim(),
    },
  };
};
