import {
  callGeminiGenerateContent,
  extractCandidateText,
  getModelFromRequest,
  getServerApiKey,
  parseJsonSafely,
} from './_gemini_shared.js';

const MEMORY_SUMMARY_INPUT_MAX_CHARS = 2600;
const MEMORY_SUMMARY_OUTPUT_MAX_CHARS = 1400;
const MEMORY_SUMMARY_MAX_LINES = 12;
const MEMORY_PROFILE_MAX_ITEMS_PER_FIELD = 8;
const MEMORY_PROFILE_MAX_ITEM_CHARS = 180;

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

  const { currentSummary = '', currentMemoryProfile = null, history = [], model } = req.body || {};
  const apiKey = getServerApiKey();
  if (!apiKey) return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });

  const normalizedHistory = normalizeChatHistory(history);
  const safeCurrentSummary = String(currentSummary || '').trim().slice(0, MEMORY_SUMMARY_INPUT_MAX_CHARS);
  const legacyProfile = profileFromLegacySummary(safeCurrentSummary);
  const safeCurrentProfile = rebalanceMemoryProfile(mergeMemoryProfiles(
    sanitizeMemoryProfile(currentMemoryProfile),
    legacyProfile
  ));
  const resolvedModel = getModelFromRequest({ model });

  if (normalizedHistory.length === 0) {
    const memoryProfile = rebalanceMemoryProfile(safeCurrentProfile);
    return res.status(200).json({
      hasNewMemory: false,
      memoryProfile,
      memorySummary: buildMemorySummary(memoryProfile) || safeCurrentSummary,
    });
  }

  const prompt = `You maintain structured long-term memory for an English practice chat app.
Return ONLY valid JSON in this exact schema:
{
  "hasNewMemory": boolean,
  "memoryProfile": {
    "hobbies": ["string"],
    "goals": ["string"],
    "projects": ["string"],
    "personalityTraits": ["string"],
    "dailyRoutine": ["string"],
    "preferences": ["string"],
    "background": ["string"],
    "notes": ["string"]
  }
}

Goal:
- Preserve stable user facts/preferences/goals that help future conversation.
- Merge new useful facts from recent chat history into the correct field.
- Keep wording concise and stable across updates.

Rules:
- English only.
- Arrays only. No nested objects.
- Keep each item short (ideally under 16 words).
- Prioritize durable info: hobbies, goals, current projects, background, communication preferences, routine.
- Do NOT store low-value temporary details.
- Merge duplicates and keep one best phrasing.
- Preserve existing item wording/order when still valid; only change when there is new info or a correction.
- If nothing useful changed, set hasNewMemory=false and return the current memoryProfile unchanged.
- Max ${MEMORY_PROFILE_MAX_ITEMS_PER_FIELD} items per field.

Current memory profile:
${JSON.stringify(safeCurrentProfile, null, 2)}

Recent chat history:
${normalizedHistory.map((m) => `${m.role.toUpperCase()}: ${m.text}`).join('\n')}`;

  try {
    const callModel = async ({ text, jsonMode = false }) => {
      const data = await callGeminiGenerateContent({
        apiKey,
        model: resolvedModel,
        body: {
          contents: [{ role: 'user', parts: [{ text }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 1024,
            ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
          },
        },
      });
      return extractCandidateText(data);
    };

    let nextProfile = safeCurrentProfile;
    let hasNewMemory = false;

    try {
      const rawJson = await callModel({ text: prompt, jsonMode: true });
      const parsed = parseJsonSafely(rawJson);
      const parsedProfile = sanitizeMemoryProfile(parsed?.memoryProfile);
      const parsedHasNewMemory = Boolean(parsed?.hasNewMemory);

      if (parsedHasNewMemory) {
        nextProfile = isMemoryProfileEmpty(parsedProfile)
          ? safeCurrentProfile
          : rebalanceMemoryProfile(mergeMemoryProfiles(parsedProfile, safeCurrentProfile));
        hasNewMemory = !memoryProfilesEqual(nextProfile, safeCurrentProfile);
      } else {
        nextProfile = safeCurrentProfile;
        hasNewMemory = false;
      }
    } catch (parseError) {
      // Fallback to plain bullet summary and map bullets into notes field.
      const fallbackPrompt = `Update this long-term user memory using recent chat.
Output ONLY plain text bullets (no JSON).
Rules:
- English only
- 3 to ${MEMORY_SUMMARY_MAX_LINES} bullet lines, each starting with "- "
- Prioritize hobbies, goals, projects, background, preferences, routine
- Keep wording stable
- Max ${MEMORY_SUMMARY_OUTPUT_MAX_CHARS} characters

Current memory summary:
${buildMemorySummary(safeCurrentProfile) || safeCurrentSummary || '(empty)'}

Recent chat:
${normalizedHistory.map((m) => `${m.role.toUpperCase()}: ${m.text}`).join('\n')}`;
      const rawFallback = await callModel({ text: fallbackPrompt, jsonMode: false });
      const fallbackSummary = sanitizeMemorySummary(rawFallback, buildMemorySummary(safeCurrentProfile));
      const fallbackProfile = rebalanceMemoryProfile(
        mergeMemoryProfiles(safeCurrentProfile, profileFromLegacySummary(fallbackSummary))
      );
      nextProfile = fallbackProfile;
      hasNewMemory = !memoryProfilesEqual(nextProfile, safeCurrentProfile);
      console.warn('memory-summary structured parse fallback used:', parseError?.message || parseError);
    }

    const memoryProfile = rebalanceMemoryProfile(sanitizeMemoryProfile(nextProfile));
    const memorySummary = buildMemorySummary(memoryProfile);

    return res.status(200).json({
      hasNewMemory,
      memoryProfile,
      memorySummary,
    });
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
  const source = value && typeof value === 'object' ? value : {};

  for (const key of MEMORY_PROFILE_KEYS) {
    base[key] = normalizeStringArray(source[key]);
  }

  return base;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  const items = [];
  for (const raw of value) {
    const text = String(raw || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^\[(hobby|hobbies|goal|goals|project|projects|trait|traits|personality|routine|daily routine|preference|preferences|background|note|notes)\]\s*/i, '')
      .replace(/^[-•*]\s*/, '')
      .slice(0, MEMORY_PROFILE_MAX_ITEM_CHARS)
      .trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(text);
    if (items.length >= MEMORY_PROFILE_MAX_ITEMS_PER_FIELD) break;
  }
  return items;
}

function mergeMemoryProfiles(primary, secondary) {
  const a = sanitizeMemoryProfile(primary);
  const b = sanitizeMemoryProfile(secondary);
  const merged = emptyMemoryProfile();

  for (const key of MEMORY_PROFILE_KEYS) {
    const seen = new Set();
    const items = [];
    for (const candidate of [...a[key], ...b[key]]) {
      const norm = candidate.toLowerCase();
      if (seen.has(norm)) continue;
      seen.add(norm);
      items.push(candidate);
      if (items.length >= MEMORY_PROFILE_MAX_ITEMS_PER_FIELD) break;
    }
    merged[key] = items;
  }

  return merged;
}

function isMemoryProfileEmpty(profile) {
  const safe = sanitizeMemoryProfile(profile);
  return MEMORY_PROFILE_KEYS.every((key) => safe[key].length === 0);
}

function memoryProfilesEqual(a, b) {
  const left = sanitizeMemoryProfile(a);
  const right = sanitizeMemoryProfile(b);
  return MEMORY_PROFILE_KEYS.every((key) => JSON.stringify(left[key]) === JSON.stringify(right[key]));
}

function profileFromLegacySummary(summary) {
  const text = String(summary || '').trim();
  if (!text) return emptyMemoryProfile();

  const bullets = sanitizeMemorySummary(text)
    .split('\n')
    .map((line) => line.replace(/^-\s*/, '').trim())
    .filter(Boolean);

  if (bullets.length === 0) return emptyMemoryProfile();

  const seeded = {
    ...emptyMemoryProfile(),
    notes: normalizeStringArray(bullets),
  };
  return rebalanceMemoryProfile(seeded);
}

function rebalanceMemoryProfile(profile) {
  const safe = sanitizeMemoryProfile(profile);
  const next = emptyMemoryProfile();

  // Keep explicit fields first.
  for (const key of MEMORY_PROFILE_KEYS) {
    if (key === 'notes') continue;
    next[key] = [...safe[key]];
  }

  const remainingNotes = [];
  for (const note of safe.notes) {
    const tagged = parseTaggedMemoryItem(note);
    if (tagged) {
      pushUnique(next[tagged.key], tagged.text);
      continue;
    }

    const guessedKey = classifyMemoryItem(note);
    if (guessedKey && guessedKey !== 'notes') {
      pushUnique(next[guessedKey], note);
    } else {
      remainingNotes.push(note);
    }
  }

  next.notes = normalizeStringArray(remainingNotes);

  // Normalize and cap all arrays after redistribution.
  for (const key of MEMORY_PROFILE_KEYS) {
    next[key] = normalizeStringArray(next[key]);
  }
  return next;
}

function parseTaggedMemoryItem(value) {
  const text = String(value || '').trim();
  const match = text.match(/^\[(.+?)\]\s*(.+)$/);
  if (!match) return null;

  const rawLabel = match[1].trim().toLowerCase();
  const payload = match[2].trim();
  if (!payload) return null;

  const labelMap = {
    hobby: 'hobbies',
    hobbies: 'hobbies',
    goal: 'goals',
    goals: 'goals',
    project: 'projects',
    projects: 'projects',
    trait: 'personalityTraits',
    traits: 'personalityTraits',
    personality: 'personalityTraits',
    routine: 'dailyRoutine',
    'daily routine': 'dailyRoutine',
    preference: 'preferences',
    preferences: 'preferences',
    background: 'background',
    note: 'notes',
    notes: 'notes',
  };

  const key = labelMap[rawLabel];
  if (!key) return null;
  return { key, text: payload };
}

function classifyMemoryItem(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return 'notes';

  if (/(like|enjoy|favorite|into)\b.*\b(music|rock|lo-?fi|reading|books|games?|movies?|coffee)/.test(text)) return 'hobbies';
  if (/\b(goal|want to|trying to|hope to|aim to|improve|learn)\b/.test(text)) return 'goals';
  if (/\b(building|working on|develop|project|app|startup)\b/.test(text)) return 'projects';
  if (/\bprefer|likes? .*feedback|concise feedback|short answers?|direct answers?\b/.test(text)) return 'preferences';
  if (/\busually|every day|daily|at night|in the morning|routine|often\b/.test(text)) return 'dailyRoutine';
  if (/\bmajor|majored|college|university|job|work as|background|computer science\b/.test(text)) return 'background';
  if (/\b(nervous|confident|introvert|extrovert|shy|curious|patient)\b/.test(text)) return 'personalityTraits';

  return 'notes';
}

function pushUnique(target, item) {
  const text = String(item || '').trim();
  if (!text) return;
  if (target.some((existing) => existing.toLowerCase() === text.toLowerCase())) return;
  target.push(text);
}

function buildMemorySummary(profile) {
  const safe = sanitizeMemoryProfile(profile);
  const sectionLabels = {
    hobbies: 'Hobby',
    goals: 'Goal',
    projects: 'Project',
    personalityTraits: 'Trait',
    dailyRoutine: 'Routine',
    preferences: 'Preference',
    background: 'Background',
    notes: 'Note',
  };

  const bullets = [];
  for (const key of MEMORY_PROFILE_KEYS) {
    for (const item of safe[key]) {
      bullets.push(`- [${sectionLabels[key]}] ${item}`);
    }
  }

  const clipped = clipBulletLines(bullets, {
    maxLines: MEMORY_SUMMARY_MAX_LINES,
    maxChars: MEMORY_SUMMARY_OUTPUT_MAX_CHARS,
  });
  return sanitizeMemorySummary(clipped, '');
}

function sanitizeMemorySummary(value, fallback = '') {
  const text = String(value || '').trim();
  if (!text) return String(fallback || '').trim();

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith('- ') ? line : `- ${line.replace(/^[•*-]\s*/, '')}`));

  const cleanedLines = removeDanglingTrailingBullets(lines);
  const clipped = clipBulletLines(cleanedLines, {
    maxLines: MEMORY_SUMMARY_MAX_LINES,
    maxChars: MEMORY_SUMMARY_OUTPUT_MAX_CHARS,
  });
  const cleanedClipped = sanitizeClippedBullets(clipped);
  return cleanedClipped || String(fallback || '').trim();
}

function clipBulletLines(lines, { maxLines, maxChars }) {
  const limitedLines = (Array.isArray(lines) ? lines : []).slice(0, maxLines);
  const kept = [];
  let used = 0;

  for (const line of limitedLines) {
    const candidate = String(line || '').trim();
    if (!candidate) continue;
    const separatorCost = kept.length > 0 ? 1 : 0;
    const nextCost = separatorCost + candidate.length;
    if (used + nextCost <= maxChars) {
      kept.push(candidate);
      used += nextCost;
      continue;
    }
    break;
  }

  if (kept.length === 0 && limitedLines.length > 0) {
    const first = String(limitedLines[0] || '').trim();
    const hard = first.slice(0, Math.max(0, maxChars));
    const soft = hard.replace(/\s+\S*$/, '').trim();
    return (soft || hard).trim();
  }

  return kept.join('\n').trim();
}

function removeDanglingTrailingBullets(lines) {
  const next = [...(Array.isArray(lines) ? lines : [])];
  while (next.length > 0 && isLikelyDanglingBullet(next[next.length - 1])) {
    next.pop();
  }
  return next;
}

function sanitizeClippedBullets(text) {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const cleaned = removeDanglingTrailingBullets(lines);
  return cleaned.join('\n').trim();
}

function isLikelyDanglingBullet(line) {
  const raw = String(line || '').trim();
  if (!raw) return true;
  const content = raw.replace(/^[-•*]\s*/, '').trim();
  if (!content) return true;
  if (content.length <= 4) return true;
  if (/^[A-Za-z]+$/.test(content) && content.length < 12) return true;
  return false;
}
