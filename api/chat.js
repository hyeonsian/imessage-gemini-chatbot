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

const DEFAULT_PERSONA_PROFILE = {
  warmth: 4,
  playfulness: 3,
  directness: 3,
  curiosity: 4,
  verbosity: 2,
};

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
    personaProfile = null,
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

  const normalizedPersonaProfile = sanitizePersonaProfile(personaProfile);
  const systemPrompt = buildSystemPromptWithMemory(longTermMemoryText, normalizedPersonaProfile);

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

function sanitizePersonaProfile(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    warmth: clampPersonaValue(source.warmth, DEFAULT_PERSONA_PROFILE.warmth),
    playfulness: clampPersonaValue(source.playfulness, DEFAULT_PERSONA_PROFILE.playfulness),
    directness: clampPersonaValue(source.directness, DEFAULT_PERSONA_PROFILE.directness),
    curiosity: clampPersonaValue(source.curiosity, DEFAULT_PERSONA_PROFILE.curiosity),
    verbosity: clampPersonaValue(source.verbosity, DEFAULT_PERSONA_PROFILE.verbosity),
  };
}

function clampPersonaValue(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(5, Math.max(1, Math.round(num)));
}

function buildPersonaPromptBlock(persona) {
  const warmthText = mapScaled(persona.warmth, [
    'Keep the tone emotionally neutral and calm.',
    'Keep the tone calm with light friendliness.',
    'Use a balanced friendly tone.',
    'Use a warm and supportive tone.',
    'Be very warm, affectionate, and encouraging without sounding artificial.',
  ]);

  const playfulText = mapScaled(persona.playfulness, [
    'Stay mostly serious and straightforward.',
    'Use very light playful energy only when natural.',
    'Use occasional light playful phrasing.',
    'Be noticeably playful with friendly reactions when appropriate.',
    'Use a playful, lively texting vibe often, but keep it natural.',
  ]);

  const directnessText = mapScaled(persona.directness, [
    'Be gentle and indirect when phrasing suggestions or opinions.',
    'Lean soft and polite in phrasing.',
    'Use balanced directness.',
    'Be fairly direct and clear about your point.',
    'Be very direct and concise, but not rude.',
  ]);

  const curiosityText = mapScaled(persona.curiosity, [
    'Ask follow-up questions rarely unless needed.',
    'Ask occasional follow-up questions only when helpful.',
    'Use balanced curiosity with some follow-up questions.',
    'Show clear curiosity and ask follow-up questions fairly often.',
    'Be highly curious and often ask short, relevant follow-up questions.',
  ]);

  const verbosityText = mapScaled(persona.verbosity, [
    'Prefer extremely compact replies within the existing concise style.',
    'Keep replies short and tight.',
    'Use a balanced reply length while staying concise.',
    'Use slightly fuller replies, still concise.',
    'Use the fullest replies allowed by the existing concise style (still short, no paragraphs).',
  ]);

  return [
    'Per-chat personality settings (apply naturally):',
    `- Warmth ${persona.warmth}/5: ${warmthText}`,
    `- Playfulness ${persona.playfulness}/5: ${playfulText}`,
    `- Directness ${persona.directness}/5: ${directnessText}`,
    `- Curiosity ${persona.curiosity}/5: ${curiosityText}`,
    `- Reply length ${persona.verbosity}/5: ${verbosityText}`,
  ].join('\n');
}

function mapScaled(value, options) {
  const index = Math.min(options.length - 1, Math.max(0, (value || 1) - 1));
  return options[index];
}

function buildSystemPromptWithMemory(memoryText, personaProfile) {
  const personaBlock = buildPersonaPromptBlock(sanitizePersonaProfile(personaProfile));

  if (!memoryText) return `${DEFAULT_SYSTEM_PROMPT}\n\n${personaBlock}`;
  return `${DEFAULT_SYSTEM_PROMPT}\n\n${personaBlock}

Long-term memory about the user (use only when relevant, naturally, and do not mention this memory list explicitly):
${memoryText}`;
}
