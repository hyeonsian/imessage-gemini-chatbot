import {
  callGeminiGenerateContent,
  extractCandidateText,
  getModelFromRequest,
  getServerApiKey,
} from './_gemini_shared.js';

const DEFAULT_SYSTEM_PROMPT = `You are a close friend over text. Talk like a real person, not an AI.
CRITICAL: Keep your responses EXTREMELY concise (1-2 short sentences max).
ALWAYS respond ONLY in natural English.
No multiple paragraphs. No AI-style endings.
Just answer casually like a friend.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message = '', model, history } = req.body || {};
  const input = String(message || '').trim();
  if (!input) return res.status(400).json({ error: 'message is required' });

  const apiKey = getServerApiKey();
  if (!apiKey) return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });
  const resolvedModel = getModelFromRequest({ model });
  const normalizedHistory = normalizeChatHistory(history);
  const contents = [
    ...normalizedHistory.map((item) => ({
      role: item.role === 'ai' ? 'model' : 'user',
      parts: [{ text: item.text }],
    })),
    { role: 'user', parts: [{ text: input }] },
  ];

  try {
    const data = await callGeminiGenerateContent({
      apiKey,
      model: resolvedModel,
      body: {
        contents,
        systemInstruction: {
          parts: [{ text: DEFAULT_SYSTEM_PROMPT }],
        },
        generationConfig: {
          temperature: 0.8,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 512,
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      },
    });

    const reply = extractCandidateText(data);
    if (!reply) {
      return res.status(502).json({ error: 'Empty chat reply' });
    }

    return res.status(200).json({ reply });
  } catch (error) {
    console.error('chat api error:', error);
    return res.status(error.status || 500).json({ error: error.message || 'Chat failed' });
  }
}

function normalizeChatHistory(history) {
  if (!Array.isArray(history)) return [];

  const normalized = history
    .map((item) => ({
      role: item?.role === 'ai' ? 'ai' : (item?.role === 'user' ? 'user' : ''),
      text: String(item?.text || '').trim(),
    }))
    .filter((item) => (item.role === 'user' || item.role === 'ai') && item.text.length > 0);

  // Keep recent context only to control token usage/latency.
  return normalized.slice(-16);
}
