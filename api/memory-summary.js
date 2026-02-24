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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { currentSummary = '', history = [], model } = req.body || {};
  const apiKey = getServerApiKey();
  if (!apiKey) return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });

  const normalizedHistory = normalizeChatHistory(history);
  const safeCurrentSummary = String(currentSummary || '').trim().slice(0, MEMORY_SUMMARY_INPUT_MAX_CHARS);
  const resolvedModel = getModelFromRequest({ model });

  if (normalizedHistory.length === 0) {
    return res.status(200).json({ memorySummary: safeCurrentSummary });
  }

  const prompt = `You maintain a compact long-term memory summary for an English practice chat app.
Return ONLY valid JSON in this schema:
{"hasNewMemory":boolean,"memorySummary":"string"}

Goal:
- Preserve stable user facts/preferences/goals that help future conversation.
- Merge new useful facts from recent chat history.
- Keep it compact and practical.

Rules:
- English only.
- 3 to 12 short bullet lines, each starting with "- ".
- Prioritize remembering: preferences, goals, current projects, background, and reply-style preferences.
- Keep only durable or useful context (preferences, goals, personal background, ongoing projects, communication preferences).
- Do NOT store sensitive identifiers unless explicitly useful to the chat.
- Remove outdated or low-value temporary details.
- Merge duplicates and rewrite overlapping bullets into one clearer bullet.
- Preserve existing bullet wording/order when still valid; only change bullets when there is new information or a clear correction.
- Prefer complete bullets over long bullets.
- If nothing useful changed, set hasNewMemory=false and return the previous summary EXACTLY unchanged in memorySummary.
- Max ${MEMORY_SUMMARY_OUTPUT_MAX_CHARS} characters.

Current memory summary:
${safeCurrentSummary || "(empty)"}

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
            maxOutputTokens: 768,
            ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
          },
        },
      });
      return extractCandidateText(data);
    };

    const rawJson = await callModel({ text: prompt, jsonMode: true });
    let next = '';

    try {
      const parsed = parseJsonSafely(rawJson);
      const hasNewMemory = Boolean(parsed?.hasNewMemory);
      if (!hasNewMemory && safeCurrentSummary) {
        next = safeCurrentSummary;
      } else {
        next = sanitizeMemorySummary(parsed?.memorySummary, safeCurrentSummary);
      }
    } catch (parseError) {
      // Some model variants return partial JSON or plain bullets despite JSON mode.
      next = sanitizeMemorySummary(extractMemorySummaryText(rawJson), '');
      if (!next) {
        const fallbackPrompt = `Update this long-term user memory summary using the recent chat.
Output ONLY the updated memory summary as plain text bullets (no JSON).
Rules:
- English only
- 3 to 12 bullet lines, each starting with "- "
- Prioritize preferences, goals, projects, background, and reply style
- Merge duplicates
- Max ${MEMORY_SUMMARY_OUTPUT_MAX_CHARS} characters

Current summary:
${safeCurrentSummary || "(empty)"}

Recent chat:
${normalizedHistory.map((m) => `${m.role.toUpperCase()}: ${m.text}`).join('\n')}`;
        const rawFallback = await callModel({ text: fallbackPrompt, jsonMode: false });
        next = sanitizeMemorySummary(rawFallback, safeCurrentSummary);
      }
      console.warn('memory-summary parse fallback used:', parseError?.message || parseError);
    }

    return res.status(200).json({ memorySummary: next || safeCurrentSummary });
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

  const cleanedLines = removeDanglingTrailingBullets(lines);
  const clipped = clipBulletLines(cleanedLines, {
    maxLines: MEMORY_SUMMARY_MAX_LINES,
    maxChars: MEMORY_SUMMARY_OUTPUT_MAX_CHARS,
  });
  const cleanedClipped = sanitizeClippedBullets(clipped);
  return cleanedClipped || String(fallback || '').trim();
}

function extractMemorySummaryText(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';

  // If plain bullets already, use as-is.
  if (text.startsWith('- ')) return text;

  // Try to recover partial JSON like: {"memorySummary":"- ... (truncated)
  const keyIndex = text.search(/"memorySummary"\s*:\s*"/i);
  if (keyIndex !== -1) {
    const afterKey = text.slice(keyIndex);
    const quoteStart = afterKey.indexOf('"', afterKey.indexOf(':'));
    if (quoteStart !== -1) {
      let valuePortion = afterKey.slice(quoteStart + 1);
      valuePortion = valuePortion
        .replace(/"\s*[,}]\s*$/s, '')
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .trim();
      if (valuePortion) return valuePortion;
    }
  }

  // If the model wrapped bullets in code fences or extra prose, recover bullet lines only.
  const bulletLines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-•*]\s+/.test(line));
  if (bulletLines.length > 0) {
    return bulletLines.join('\n');
  }

  // Last resort: return raw text and let sanitizer normalize lines.
  return text;
}

function clipBulletLines(lines, { maxLines, maxChars }) {
  const limitedLines = (Array.isArray(lines) ? lines : []).slice(0, maxLines);
  const kept = [];
  let used = 0;

  for (const line of limitedLines) {
    const candidate = String(line || '').trim();
    if (!candidate) continue;
    const separatorCost = kept.length > 0 ? 1 : 0; // newline
    const nextCost = separatorCost + candidate.length;
    if (used + nextCost <= maxChars) {
      kept.push(candidate);
      used += nextCost;
      continue;
    }
    break;
  }

  // Fallback if one bullet is too long: trim to a word boundary instead of slicing mid-buffer.
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
  const content = raw.replace(/^-\s*/, '').trim();
  if (!content) return true;

  // Common partial/truncated cases from model outputs (e.g., "-", "Currently", "Enjo")
  if (content.length <= 4) return true;
  if (/^[A-Za-z]+$/.test(content) && content.length < 12) return true;

  return false;
}
