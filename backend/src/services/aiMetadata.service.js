import { env } from '../config/env.js';

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

const resolveProvider = () => (env.aiProvider === 'ollama' ? 'ollama' : 'groq');

const callChatCompletion = async (messages, extra = {}) => {
  const provider = resolveProvider();

  if (provider === 'ollama') {
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
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error?.message || data?.message || `Ollama chat failed (${response.status})`;
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

  const model = extra.model || GROQ_MODEL_QUALITY;

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

export const translateTranscriptSegments = async ({ segments, targetLanguage }) => {
  const input = (segments || [])
    .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text || '').trim() }))
    .filter((s) => s.text);

  if (input.length === 0) return [];

  const output = [];
  const batches = chunkArray(input, 15);

  for (const batch of batches) {
    const safe = batch.map(({ start, end, text }) => ({ start, end, text }));
    let parsed = null;
    try {
      const content = await callChatCompletion(
        [
          {
            role: 'system',
            content:
              'You are a professional subtitle translator. Translate each segment text to the requested target language. ' +
              'For Arabic, always use Modern Standard Arabic with complete tashkeel/diacritics for correct pronunciation. ' +
              'Return ONLY valid JSON: {"segments":[{"start":number,"end":number,"text":string}]}. ' +
              'Keep start/end unchanged, keep the same number of segments, and translate naturally.',
          },
          {
            role: 'user',
            content: `Target language: ${targetLanguage}\n\nSegments:\n${JSON.stringify(safe)}`,
          },
        ],
        { temperature: 0.1, maxTokens: 3000, responseFormat: { type: 'json_object' } },
      );
      parsed = parseJson(content);
    } catch {
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
      // Fallback: keep original timing, but still remove markdown.
      output.push(...batch.map((s) => ({ ...s, text: stripMarkdown(s.text) })));
    }
  }

  return output;
};

export const generateEducationalScript = async ({ video, targetLanguage }) => {
  const translation = (video.translations || []).find((t) => t.language === targetLanguage);
  const transcript = translation?.transcript || video.transcript || '';
  const ai = video.aiMetadata || {};

  const content = await callChatCompletion(
    [
      {
        role: 'system',
        content:
          `You are an excellent educational narrator. Write a complete spoken lesson script in ${targetLanguage}. ` +
          'Use the provided video metadata and transcript. Make it clear, engaging, structured, and self-contained. ' +
          'If the target language is Arabic, write in Modern Standard Arabic with complete tashkeel/diacritics for correct pronunciation. ' +
          'Include a short hook, learning objectives, lesson explanation, key takeaways, and a quick recap. ' +
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
      temperature: 0.4,
      maxTokens: 700,
      model: resolveProvider() === 'ollama' ? env.ollamaModel : GROQ_MODEL_FAST,
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
