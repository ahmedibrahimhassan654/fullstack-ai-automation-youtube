import { env } from '../config/env.js';

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
  if (p === 'ollama' || p === 'gemini' || p === 'deepseek') return p;
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
    }),
    signal: AbortSignal.timeout(300000),
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

const callChatCompletionOnce = async (messages, extra = {}) => {
  const provider = extra?.provider || resolveProvider();

  if (provider === 'ollama') {
    return callOllamaCompletionOnce(messages, extra);
  }

  if (provider === 'deepseek') {
    return callDeepSeekCompletionOnce(messages, extra);
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

const availableProviders = () => {
  const list = [];
  const preferred = resolveProvider();
  if (env.groqApiKey && !disabledProviders.has('groq')) list.push('groq');
  // Gemini is a real fallback whenever the key exists - it gives the
  // translation a second engine when Groq hits its rate limit.
  if (env.geminiApiKey && !disabledProviders.has('gemini')) list.push('gemini');
  if (env.deepseekApiKey && !disabledProviders.has('deepseek')) list.push('deepseek');
  // Ollama is opt-in (AI_PROVIDER=ollama). Including it by default only added
  // a failing round trip to every rate limited call.
  if (preferred === 'ollama' && !disabledProviders.has('ollama')) list.push('ollama');
  return list;
};

const callChatCompletion = async (messages, extra = {}) => {
  const preferred = extra?.provider || resolveProvider();
  const all = availableProviders();
  const candidates = [
    ...(disabledProviders.has(preferred) ? [] : [preferred]),
    ...all.filter((p) => p !== preferred),
  ];
  let lastError = null;

  for (const provider of candidates) {
    if (disabledProviders.has(provider)) continue;
    // A rate limited provider needs more patience than a hard failure: the
    // provider tells us how long to wait, and waiting is what makes the
    // translation succeed instead of falling back to the source language.
    let attempts = provider === preferred ? 4 : 2;
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
        if (!retryable || attempt === attempts - 1) break;
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
  const text = String(content || '').trim();
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
  "openQuestions": ["unanswered questions raised"]
}

Strictly enforce:
- Verify every command, configuration, version, and code concept mentioned; correct obvious transcript typos without changing technical meaning.
- Never use placeholders or outdated syntax.
- Include sequential chapter titles based on real transcript timestamps.
- Descriptions should be concise, practical, and include what the viewer will do, learn, and troubleshoot.
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
        provider: 'groq',
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
export const isTargetLanguageText = (text, targetLanguage, sourceText = '', sourceLanguage = '') => {
  const value = String(text || '').trim();
  if (!value) return false;

  const target = languageBase(targetLanguage);
  const source = languageBase(sourceLanguage);
  if (source && source === target) return true;

  const letters = countMatches(value, LETTER_PATTERN);
  if (letters === 0) return true; // numbers and symbols only

  const scriptPattern = TARGET_SCRIPT_PATTERNS[target];
  if (scriptPattern) {
    const targetChars = countMatches(value, scriptPattern);
    const sourceValue = String(sourceText || '').trim();
    const sourceTargetChars = countMatches(sourceValue, scriptPattern);

    // The translation has to carry more of the target script than the source
    // did. "إلى Kali Linux" gains Arabic characters and passes, while the
    // untranslated "Have already downloaded the ISO file" does not.
    if (targetChars > sourceTargetChars) return true;

    if (targetChars === 0 && sourceTargetChars === 0) {
      // Neither side uses the target script. That is only acceptable for a
      // short label such as a product name ("Kali Linux"), never for a
      // sentence that should have been translated.
      return sourceValue.split(/\s+/).filter(Boolean).length <= 2;
    }

    return false;
  }

  const sourceValue = String(sourceText || '').trim();
  if (!sourceValue) return true;
  if (normalizeForCompare(value) === normalizeForCompare(sourceValue)) {
    // Unchanged: acceptable for a short technical term, not for a sentence.
    return sourceValue.split(/\s+/).filter(Boolean).length <= 2;
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

const QUALITY_THRESHOLD = 8;
const MAX_TRANSLATION_ATTEMPTS = 3;

const toPair = (segment) => ({
  start: Number(segment?.start) || 0,
  end: Number(segment?.end) || 0,
  text: String(segment?.text || '').trim(),
});

const callQualityChat = async (messages, extra = {}) => {
  const provider = resolveProvider();
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
          : extra.fast
            ? env.aiModelFast || GROQ_MODEL_FAST
            : env.aiModelQuality || GROQ_MODEL_QUALITY;
  return callChatCompletion(messages, { ...extra, model });
};

const buildTranslationMessages = ({ batch, targetLanguage, highQuality, context = [] }) => {
  const system =
    'You are a professional subtitle translator. Translate each segment text to the requested target language. ' +
    'IMPORTANT: never translate technical terms, product names, framework/library names, API names, CLI commands, file paths or code identifiers. Keep them exactly as written in clear English/Latin script (for example React, Node.js, Express, MongoDB, API, Docker, npm install, GitHub) and keep them inside the translated sentence. ' +
    (String(targetLanguage).toLowerCase().startsWith('ar')
      ? 'For Arabic, always use Modern Standard Arabic with complete tashkeel/diacritics for correct pronunciation. '
      : '') +
    (highQuality
      ? 'Produce a HIGH-QUALITY translation: accurate meaning, natural phrasing, correct grammar, consistent terminology, and faithful tone. Avoid literal word-by-word translation; adapt idioms naturally. '
      : '') +
    'Return ONLY valid JSON: {"segments":["translated text 1","translated text 2"]}. ' +
    'Return exactly ' +
    batch.length +
    ' strings, in the same order as the input segments, and translate each one.';

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
const translateBatchOnce = async ({ batch, targetLanguage, highQuality, context = [] }) => {
  const messages = buildTranslationMessages({ batch, targetLanguage, highQuality, context });
  let content = '';
  try {
    content = highQuality
      ? await callQualityChat(messages, {
          temperature: 0.15,
          maxTokens: 3500,
          responseFormat: { type: 'json_object' },
        })
      : await callQualityChat(messages, {
          fast: true,
          temperature: 0.1,
          maxTokens: 3500,
          responseFormat: { type: 'json_object' },
        });
  } catch (e) {
    console.error('[translateSegmentsOnce] chat error:', e?.message);
    return null;
  }

  const parsed = parseJson(content);
  const rawSegments = parsed?.segments;
  if (!Array.isArray(rawSegments) || rawSegments.length !== batch.length) {
    console.warn(
      '[translateSegmentsOnce] batch rejected: expected',
      batch.length,
      'segments, got',
      rawSegments?.length ?? 'none',
    );
    return null;
  }

  // Accept both the compact array of strings and the verbose object format.
  const translated = rawSegments.map((seg, index) => ({
    start: batch[index].start,
    end: batch[index].end,
    text: stripMarkdown(
      typeof seg === 'string' ? seg : typeof seg?.text === 'string' ? seg.text : '',
    ),
  }));

  const wrongLanguage = translated.find(
    (seg, index) =>
      !seg.text || !isTargetLanguageText(seg.text, targetLanguage, batch[index].text),
  );
  if (wrongLanguage) {
    console.warn(
      '[translateSegmentsOnce] batch rejected: segment',
      wrongLanguage.text?.slice(0, 60) || '(empty)',
      'is not in the target language',
    );
    return null;
  }

  return translated;
};

/**
 * Translates a batch, halving it whenever a batch fails so that one bad
 * batch cannot poison the whole transcript.
 */
const translateBatchResilient = async ({ batch, targetLanguage, highQuality, context = [] }) => {
  const translated = await translateBatchOnce({ batch, targetLanguage, highQuality, context });
  if (translated) return translated;

  if (batch.length === 1) {
    const err = new Error(
      `Could not translate a segment into ${targetLanguage}: "${String(batch[0].text).slice(0, 80)}"`,
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
  });
  const tail = await translateBatchResilient({
    batch: batch.slice(mid),
    targetLanguage,
    highQuality,
    context: context.slice(mid),
  });
  return [...head, ...tail];
};

const translateSegmentsOnce = async ({ segments, targetLanguage, highQuality = false, context = [], onProgress = null }) => {
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
  const source = (segments || []).map(toPair).filter((s) => s.text);

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

  // Fast mode: skip evaluation-driven retries and return the initial translation.
  if (fast) {
    return source.map((s, index) => ({
      start: s.start,
      end: s.end,
      text: currentSegments[index].text,
      sourceText: s.text,
      originalLanguage: originalLanguage || 'en',
      targetLanguage,
      qualityScore: null,
      qualityStatus: 'unknown',
      qualityReason: '',
      translationAttempts: 1,
      wordSuggestions: [],
    }));
  }

  // 2. Evaluate against original English.
  const pairs = source.map((s, index) => ({
    original: s.text,
    translated: currentSegments[index].text,
  }));
  let evaluations = await evaluateTranslationSegments({ pairs, targetLanguage });

  const attempts = source.map(() => 1);
  const bestScores = evaluations.map((e) =>
    e && typeof e.score === 'number' ? e.score : null,
  );


  // 3. Retry low-scoring segments with a high-quality pass.
  //
  // Arabic segments without tashkeel are retried as well: the diacritics are
  // what let the neural voice pronounce the words correctly, and the bulk
  // (fast) model does not add them consistently.
  const needsTashkeel = String(targetLanguage || '').toLowerCase().startsWith('ar');
  for (let attempt = 2; attempt <= MAX_TRANSLATION_ATTEMPTS; attempt += 1) {
    const lowIndices = source
      .map((_, index) => index)
      .filter((index) => {
        const score = bestScores[index];
        const lowScore = score !== null && score < QUALITY_THRESHOLD;
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

  // 4. Final evaluation for missing scores.
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
    return {
      start: s.start,
      end: s.end,
      text: currentSegments[index].text,
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
            ? 'Use grammatically correct Modern Standard Arabic, tashkeel where pronunciation matters, and handle technical English terms by writing an Arabic explanation followed by the English term in parentheses on first use, for example "الاختراق (Hacking)", "المحاكاة (Simulation)", "التصدّي (Mitigation)". '
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
      provider: 'groq',
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
    if (condensed && condensed.length <= limit * 1.2) return condensed;
  } catch {
    // fall through to trimmed original
  }

  // Hard fallback: truncate without breaking the last whole word.
  const sliced = clean.slice(0, limit);
  const lastSpace = sliced.lastIndexOf(' ');
  return (lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced).trim();
};
