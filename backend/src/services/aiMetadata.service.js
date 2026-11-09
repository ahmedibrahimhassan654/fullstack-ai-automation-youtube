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

const availableProviders = () => {
  const list = [];
  if (env.groqApiKey) list.push('groq');
  if (env.geminiApiKey && String(env.aiProvider || '').toLowerCase() === 'gemini') list.push('gemini');
  if (env.deepseekApiKey) list.push('deepseek');
  list.push('ollama');
  return list;
};

const callChatCompletion = async (messages, extra = {}) => {
  const preferred = extra?.provider || resolveProvider();
  const candidates = [preferred, ...availableProviders().filter((p) => p !== preferred)];
  let lastError = null;

  for (const provider of candidates) {
    let attempts = provider === preferred ? 2 : 1;
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
  const system = `You are an expert video producer and content strategist.
Return ONLY valid JSON with these fields:
{
  "summary": "2-5 sentences summarizing the video.",
  "titles": ["3-5 catchy YouTube titles"],
  "descriptions": ["2 concise YouTube descriptions"],
  "tags": ["10-20 relevant tags"],
  "chapters": [{"time": "MM:SS", "title": "chapter title"}],
  "keyPoints": ["5-8 bullet points of the most important ideas"],
  "actionItems": ["actionable tasks mentioned or implied"],
  "decisions": ["decisions made in the content"],
  "openQuestions": ["unanswered questions raised"]
}
Chapters must use timestamps present in the transcript segments when possible; otherwise estimate them.
If a field has no items, return an empty array. Do not include markdown outside JSON.`;

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
      maxTokens: 3000,
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

const QUALITY_THRESHOLD = 8;
const MAX_TRANSLATION_ATTEMPTS = 3;

const toPair = (segment) => ({
  start: Number(segment?.start) || 0,
  end: Number(segment?.end) || 0,
  text: String(segment?.text || '').trim(),
});

const callQualityChat = async (messages, extra = {}) => {
  const provider = resolveProvider();
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
          : env.aiModelQuality || GROQ_MODEL_QUALITY;
  return callChatCompletion(messages, { ...extra, model });
};

const translateSegmentsOnce = async ({ segments, targetLanguage, highQuality = false, context = [] }) => {
  const input = (segments || []).map(toPair).filter((s) => s.text);
  if (input.length === 0) return [];

  const output = [];
  const batches = chunkArray(input, 12);

  let cursor = 0;
  for (const batch of batches) {
    const batchContext = context.slice(cursor, cursor + batch.length);
    cursor += batch.length;

    const safe = batch.map(({ start, end, text }) => ({ start, end, text }));
    let parsed = null;

    const system =
      'You are a professional subtitle translator. Translate each segment text to the requested target language. ' +
      (String(targetLanguage).toLowerCase().startsWith('ar')
        ? 'For Arabic, always use Modern Standard Arabic with complete tashkeel/diacritics for correct pronunciation. '
        : '') +
      (highQuality
        ? 'Produce a HIGH-QUALITY translation: accurate meaning, natural phrasing, correct grammar, consistent terminology, and faithful tone. Avoid literal word-by-word translation; adapt idioms naturally. '
        : '') +
      'Return ONLY valid JSON: {"segments":[{"start":number,"end":number,"text":string}]}. ' +
      'Keep start/end unchanged, keep the same number of segments, and translate naturally.';

    const userLines = [`Target language: ${targetLanguage}`, '', 'Segments (original English):', JSON.stringify(safe)];

    if (batchContext.length && batchContext.some((c) => c)) {
      userLines.push('', 'Previous low-scoring attempts to improve upon:');
      userLines.push(
        JSON.stringify(
          batch.map((s, index) => ({
            original: s.text,
            previous: batchContext[index]?.previous || '',
            previousScore: batchContext[index]?.score ?? null,
            issues: batchContext[index]?.reason || '',
            suggestions: batchContext[index]?.suggestions || [],
          })),
        ),
      );
      userLines.push(
        'Use the feedback/issues above to fix mistakes. Keep any genuinely good phrases, but improve accuracy and naturalness until the translation would score at least 8/10.',
      );
    }

    try {
      const content = await callQualityChat(
        [
          { role: 'system', content: system },
          { role: 'user', content: userLines.join('\n') },
        ],
        {
          temperature: highQuality ? 0.15 : 0.1,
          maxTokens: 3500,
          responseFormat: { type: 'json_object' },
        },
      );
      parsed = parseJson(content);
    } catch (e) {
      console.error('[translateSegmentsOnce] chat error:', e?.message);
      parsed = null;
    }

    if (parsed && Array.isArray(parsed.segments) && parsed.segments.length === batch.length) {
      output.push(
        ...parsed.segments.map((seg, index) => ({
          start: Number(seg?.start ?? batch[index].start),
          end: Number(seg?.end ?? batch[index].end),
          text: stripMarkdown(seg?.text ?? batch[index].text),
        })),
      );
    } else {
      output.push(...batch.map((s) => ({ ...s, text: stripMarkdown(s.text) })));
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
      const content = await callQualityChat(
        [
          {
            role: 'system',
            content:
              'You are a strict bilingual translation quality evaluator and editor. ' +
              'Compare each ORIGINAL (English) sentence with its TRANSLATED sentence. ' +
              'Score from 0 to 10 (decimals allowed) for: meaning accuracy, completeness, grammar, naturalness, and preservation of intent. ' +
              'A score of 8 or higher means the translation is acceptable. ' +
              'If you notice English words that were left untranslated or are understandable to a non-expert, ' +
              'suggest an equivalent word/phrase in the TARGET LANGUAGE based on the whole sentence context (not word-by-word). ' +
              'Return ONLY valid JSON: {"results":[{"index":number,"score":number,"reason":string,"suggestions":[{"english":string,"equivalent":string}]}]}. ' +
              'One result per input item, same order as given.',
          },
          {
            role: 'user',
            content:
              `Target language: ${targetLanguage}\n\nPairs:\n` +
              JSON.stringify(batch.map(({ original, translated }, i) => ({ n: i, original, translated }))),
          },
        ],
        {
          temperature: 0.0,
          maxTokens: 4000,
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
        const scoreRaw = Number(r.score);
        const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(10, scoreRaw)) : null;
        const suggestions = Array.isArray(r.suggestions)
          ? r.suggestions
              .map((s) => ({
                english: String(s?.english || '').trim(),
                equivalent: String(s?.equivalent || '').trim(),
              }))
              .filter((s) => s.english && s.equivalent)
          : [];
        results[batch[i].index] = {
          index: batch[i].index,
          score,
          reason: stripMarkdown(String(r.reason || '')),
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
}) => {
  const source = (segments || []).map(toPair).filter((s) => s.text);

  if (source.length === 0) return [];

  // 1. Initial translation.
  const initial = await translateSegmentsOnce({
    segments: source,
    targetLanguage,
    highQuality: false,
  });

  const currentSegments = source.map((s, index) => {
    const t = initial[index];
    if (t && typeof t.text === 'string' && t.text.trim()) {
      return { start: s.start, end: s.end, text: t.text.trim() };
    }
    return { start: s.start, end: s.end, text: s.text };
  });

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
  for (let attempt = 2; attempt <= MAX_TRANSLATION_ATTEMPTS; attempt += 1) {
    const lowIndices = source
      .map((_, index) => index)
      .filter((index) => {
        const score = bestScores[index];
        return score !== null && score < QUALITY_THRESHOLD;
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
            ? `${EGYPTIAN_ARABIC_RULES}\\n\\nYou are an excellent educational narrator. Write a complete spoken lesson script in Egyptian Arabic. `
            : `You are an excellent educational narrator. Write a complete spoken lesson script in ${targetLanguage}. `) +
          'Use the provided video metadata and transcript. Make it clear, engaging, structured, and self-contained, and cover the entire lesson rather than only the opening. ' +
          'Sound like a warm, human mentor: open with a hook, tell a short learning journey, use conversational phrasing, reflective questions, and gentle encouragement, and vary sentence rhythm. ' +
          'Avoid sounding like a textbook: use "we", short paragraphs, and pauses implied by punctuation. ' +
          (targetLanguage.startsWith('ar')
            ? 'Write Arabic with complete tashkeel/diacritics for pronunciation. Keep important technical English terms in English when they have no natural Arabic equivalent. '
            : '') +
          `The final spoken narration should last about ${duration} seconds, so write enough words to fill that duration. ` +
          'Include a hook, objectives, a thorough explanation, key takeaways, and a recap. ' +
          'Return plain narration text only (no markdown headings or stage directions).',
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
      provider: 'deepseek',
      fast: true,
      temperature: 0.4,
      maxTokens: 700,
    },
  );

  return stripMarkdown(content);
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
            'Use polite, engaging language and preserve technical terms appropriately. ' +
            'Return ONLY valid JSON with keys: title, description, summary, chapters, keyPoints, openQuestions, tags.',
        },
        {
          role: 'user',
          content: `Source JSON:\\n${JSON.stringify(source)}`,
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
