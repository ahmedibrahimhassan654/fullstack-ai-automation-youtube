import { env } from '../config/env.js';

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

const ensureGroq = () => {
  if (!env.groqApiKey) {
    const err = new Error('GROQ_API_KEY is not configured');
    err.statusCode = 500;
    throw err;
  }
};

const callGroq = async (messages, extra = {}) => {
  ensureGroq();

  const response = await fetch(GROQ_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.groqApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
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

  const content = await callGroq(
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
    summary: String(parsed.summary || '').trim(),
    titles: Array.isArray(parsed.titles) ? parsed.titles.map(String) : [],
    descriptions: Array.isArray(parsed.descriptions) ? parsed.descriptions.map(String) : [],
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
    chapters: Array.isArray(parsed.chapters)
      ? parsed.chapters
          .map((c) => ({ time: String(c?.time || '00:00'), title: String(c?.title || '').trim() }))
          .filter((c) => c.title)
      : [],
    keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map(String) : [],
    actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.map(String) : [],
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions.map(String) : [],
    openQuestions: Array.isArray(parsed.openQuestions) ? parsed.openQuestions.map(String) : [],
    model: MODEL,
  };
};

export const answerQuestion = async ({ transcript, question }) => {
  if (!transcript) {
    const err = new Error('No transcript available for this video');
    err.statusCode = 400;
    throw err;
  }

  const context = trim(transcript, 24000);

  const content = await callGroq(
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
