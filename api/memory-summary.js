import {
  callGeminiGenerateContent,
  extractCandidateText,
  getModelFromRequest,
  getServerApiKey,
  parseJsonSafely,
} from './_gemini_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { currentSummary = '', history = [], model } = req.body || {};
  const apiKey = getServerApiKey();
  if (!apiKey) return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });

  const normalizedHistory = normalizeChatHistory(history);
  const safeCurrentSummary = String(currentSummary || '').trim().slice(0, 1600);
  const resolvedModel = getModelFromRequest({ model });

  if (normalizedHistory.length === 0) {
    return res.status(200).json({ memorySummary: safeCurrentSummary });
  }

  const prompt = `You maintain a compact long-term memory summary for an English practice chat app.
Return ONLY valid JSON in this schema:
{"memorySummary":"string"}

Goal:
- Preserve stable user facts/preferences/goals that help future conversation.
- Merge new useful facts from recent chat history.
- Keep it compact and practical.

Rules:
- English only.
- 3 to 8 short bullet lines, each starting with "- ".
- Keep only durable or useful context (preferences, goals, personal background, ongoing projects, communication preferences).
- Do NOT store sensitive identifiers unless explicitly useful to the chat.
- Remove outdated or low-value temporary details.
- If nothing useful changed, return the previous summary unchanged.
- Max 700 characters.

Current memory summary:
${safeCurrentSummary || "(empty)"}

Recent chat history:
${normalizedHistory.map((m) => `${m.role.toUpperCase()}: ${m.text}`).join('\n')}`;

  try {
    const data = await callGeminiGenerateContent({
      apiKey,
      model: resolvedModel,
      body: {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 512,
          responseMimeType: 'application/json',
        },
      },
    });

    const raw = extractCandidateText(data);
    const parsed = parseJsonSafely(raw);
    const next = sanitizeMemorySummary(parsed?.memorySummary, safeCurrentSummary);
    return res.status(200).json({ memorySummary: next });
  } catch (error) {
    console.error('memory-summary api error:', error);
    return res.status(error.status || 500).json({ error: error.message || 'Memory summary failed' });
  }
}

function normalizeChatHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .map((item) => ({
      role: item?.role === 'ai' ? 'ai' : (item?.role === 'user' ? 'user' : ''),
      text: String(item?.text || '').trim(),
    }))
    .filter((item) => (item.role === 'user' || item.role === 'ai') && item.text.length > 0)
    .slice(-20);
}

function sanitizeMemorySummary(value, fallback = '') {
  const text = String(value || '').trim();
  if (!text) return String(fallback || '').trim();

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith('- ') ? line : `- ${line.replace(/^[•*-]\s*/, '')}`));

  const clipped = lines.slice(0, 8).join('\n').slice(0, 700).trim();
  return clipped || String(fallback || '').trim();
}

