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

const MEMORY_PROFILE_KEYS = [
  'hobbies',
  'goals',
  'projects',
  'personalityTraits',
  'dailyRoutine',
  'preferences',
  'background',
  'notes',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    message = '',
    model,
    history,
    memorySummary = '',
    memoryProfile = null,
    customSystemPrompt = '',
  } = req.body || {};
  const input = String(message || '').trim();
  if (!input) return res.status(400).json({ error: 'message is required' });

  const apiKey = getServerApiKey();
  if (!apiKey) return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });
  const resolvedModel = getModelFromRequest({ model });

  const normalizedHistory = normalizeChatHistory(history);
  const normalizedMemoryProfile = sanitizeMemoryProfile(memoryProfile);
  const longTermMemoryText = buildLongTermMemoryText({
    memoryProfile: normalizedMemoryProfile,
    memorySummary: String(memorySummary || '').trim().slice(0, 2600),
  });

  const contents = [
    ...normalizedHistory.map((item) => ({
      role: item.role === 'ai' ? 'model' : 'user',
      parts: [{ text: item.text }],
    })),
    { role: 'user', parts: [{ text: input }] },
  ];

  const normalizedCustomSystemPrompt = String(customSystemPrompt || '').trim().slice(0, 2000);
  const systemPrompt = buildSystemPromptWithMemory(longTermMemoryText, normalizedCustomSystemPrompt);

  try {
    const data = await callGeminiGenerateContent({
      apiKey,
      model: resolvedModel,
      body: {
        contents,
        systemInstruction: {
          parts: [{ text: systemPrompt }],
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

  return normalized.slice(-16);
}

function emptyMemoryProfile() {
  return {
    hobbies: [],
    goals: [],
    projects: [],
    personalityTraits: [],
    dailyRoutine: [],
    preferences: [],
    background: [],
    notes: [],
  };
}

function sanitizeMemoryProfile(value) {
  const base = emptyMemoryProfile();
  if (!value || typeof value !== 'object') return base;

  for (const key of MEMORY_PROFILE_KEYS) {
    const source = Array.isArray(value[key]) ? value[key] : [];
    const seen = new Set();
    const items = [];
    for (const raw of source) {
      const text = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 180).trim();
      if (!text) continue;
      const normalized = text.toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      items.push(text);
      if (items.length >= 10) break;
    }
    base[key] = items;
  }

  return base;
}

function isMemoryProfileEmpty(profile) {
  const safe = sanitizeMemoryProfile(profile);
  return MEMORY_PROFILE_KEYS.every((key) => safe[key].length === 0);
}

function buildLongTermMemoryText({ memoryProfile, memorySummary }) {
  if (!isMemoryProfileEmpty(memoryProfile)) {
    const labels = {
      hobbies: 'Hobbies',
      goals: 'Goals',
      projects: 'Projects',
      personalityTraits: 'Traits',
      dailyRoutine: 'Routine',
      preferences: 'Preferences',
      background: 'Background',
      notes: 'Notes',
    };

    const lines = [];
    for (const key of MEMORY_PROFILE_KEYS) {
      const items = memoryProfile[key] || [];
      if (items.length === 0) continue;
      for (const item of items) {
        lines.push(`- [${labels[key]}] ${item}`);
      }
    }
    return lines.join('\n').slice(0, 2600).trim();
  }

  return String(memorySummary || '').trim().slice(0, 2600);
}

function buildSystemPromptWithMemory(memoryText, customSystemPrompt = '') {
  const customBlock = customSystemPrompt
    ? `\n\nAdditional per-chat style instructions from the user profile (follow these unless they conflict with safety):\n${customSystemPrompt}`
    : '';

  if (!memoryText) return `${DEFAULT_SYSTEM_PROMPT}${customBlock}`;
  return `${DEFAULT_SYSTEM_PROMPT}${customBlock}

Long-term memory about the user (use only when relevant, naturally, and do not mention this memory list explicitly):
${memoryText}`;
}
