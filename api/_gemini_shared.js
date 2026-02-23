const DEFAULT_MODEL = 'gemini-3-flash-preview';

export function getServerApiKey() {
  return process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
}

export function getModelFromRequest(reqBody = {}) {
  const model = String(reqBody?.model || DEFAULT_MODEL).trim();
  return model || DEFAULT_MODEL;
}

export async function callGeminiGenerateContent({ model = DEFAULT_MODEL, body, apiKey }) {
  const key = apiKey || getServerApiKey();
  if (!key) {
    const err = new Error('Missing Gemini API key');
    err.status = 500;
    throw err;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function extractCandidateText(data) {
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

export function parseJsonSafely(text) {
  const direct = String(text || '').trim();
  try {
    return JSON.parse(direct);
  } catch (_) {
    const withoutFence = direct
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    try {
      return JSON.parse(withoutFence);
    } catch (_) {
      const start = withoutFence.indexOf('{');
      const end = withoutFence.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        return JSON.parse(withoutFence.slice(start, end + 1));
      }
      throw new Error('Invalid JSON payload');
    }
  }
}

export function normalizeForComparison(value) {
  return String(value || '')
    .trim()
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function isMinorSentenceDifference(source, target) {
  return normalizeForComparison(source) === normalizeForComparison(target);
}

export function containsHangul(value) {
  return /[\u3131-\u318E\uAC00-\uD7A3]/.test(String(value || ''));
}

export function cleanAlternativeText(value) {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .replace(/^"(.*)"$/s, '$1')
    .replace(/^(i mean[,:]?\s*)/i, '')
    .replace(/^(a more natural way(?: to say this)? is[,:]?\s*)/i, '')
    .replace(/^(more naturally[,:]?\s*)/i, '')
    .trim();
}

export function isMinorGrammarEdit(wrong, right) {
  if (!wrong || !right) return false;
  if (wrong === right) return false;
  const stripEndPunctuation = (value) => value.trim().replace(/[.!?]+$/g, '').trim();
  return stripEndPunctuation(wrong).toLowerCase() === stripEndPunctuation(right).toLowerCase();
}

export function correctedTextCoversEdits(sourceText, correctedText, edits) {
  const source = String(sourceText || '').toLowerCase();
  const corrected = String(correctedText || '').toLowerCase();
  if (!corrected.trim()) return false;
  for (const edit of Array.isArray(edits) ? edits : []) {
    const wrong = String(edit?.wrong || '').trim().toLowerCase();
    const right = String(edit?.right || '').trim().toLowerCase();
    if (!wrong || !right) continue;
    if (!source.includes(wrong)) continue;
    if (corrected.includes(wrong) || !corrected.includes(right)) return false;
  }
  return true;
}

export function correctedTextCoversFeedbackPoints(sourceText, correctedText, feedbackPoints) {
  const source = String(sourceText || '').toLowerCase();
  const corrected = String(correctedText || '').toLowerCase();
  if (!corrected.trim()) return false;
  for (const point of Array.isArray(feedbackPoints) ? feedbackPoints : []) {
    const part = String(point?.part || '').trim();
    const fix = String(point?.fix || '').trim();
    if (!part || !fix) continue;
    if (isMinorSentenceDifference(part, fix)) continue;
    const p = part.toLowerCase();
    const f = fix.toLowerCase();
    if (!source.includes(p)) continue;
    if (corrected.includes(p) || !corrected.includes(f)) return false;
  }
  return true;
}

export function applyGrammarEditsToText(sourceText, edits) {
  let next = String(sourceText || '');
  const sorted = [...(Array.isArray(edits) ? edits : [])]
    .filter((e) => e && typeof e.wrong === 'string' && typeof e.right === 'string')
    .sort((a, b) => String(b.wrong).length - String(a.wrong).length);
  for (const edit of sorted) {
    const wrong = String(edit.wrong || '').trim();
    const right = String(edit.right || '').trim();
    if (!wrong || !right || wrong === right) continue;
    const escaped = wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    if (regex.test(next)) next = next.replace(regex, right);
  }
  return next;
}

export function applyFeedbackPointFixes(sourceText, feedbackPoints) {
  let next = String(sourceText || '');
  const sorted = [...(Array.isArray(feedbackPoints) ? feedbackPoints : [])]
    .map((item) => ({ part: String(item?.part || '').trim(), fix: String(item?.fix || '').trim() }))
    .filter((item) => item.part && item.fix && !isMinorSentenceDifference(item.part, item.fix))
    .sort((a, b) => b.part.length - a.part.length);
  for (const item of sorted) {
    const escaped = item.part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    if (regex.test(next)) next = next.replace(regex, item.fix);
  }
  return next;
}

export function pickBestCorrectedText(sourceText, candidates, edits, feedbackPoints) {
  const source = String(sourceText || '');
  const unique = [];
  const seen = new Set();
  for (const candidate of candidates || []) {
    const value = String(candidate || '').trim();
    if (!value) continue;
    const key = normalizeForComparison(value);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  if (unique.length === 0) return source;

  let best = unique[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of unique) {
    let score = 0;
    if (!correctedTextCoversEdits(source, candidate, edits)) score += 10;
    if (!correctedTextCoversFeedbackPoints(source, candidate, feedbackPoints)) score += 10;
    if (isMinorSentenceDifference(source, candidate)) score += 5;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

export function normalizeNativeAlternatives(alternatives) {
  const normalized = (Array.isArray(alternatives) ? alternatives : [])
    .filter((item) => item && typeof item.text === 'string')
    .map((item) => ({
      text: cleanAlternativeText(item.text),
      tone: typeof item.tone === 'string' && item.tone.trim() ? item.tone.trim() : 'Natural',
      nuance: typeof item.nuance === 'string' && item.nuance.trim() ? item.nuance.trim() : 'Natural phrasing',
    }))
    .filter((item) => item.text.length > 0)
    .filter((item) => !/^same as original$/i.test(item.text));

  const deduped = [];
  const seen = new Set();
  for (const item of normalized) {
    const key = normalizeForComparison(item.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length === 3) break;
  }
  return deduped;
}

export function isWeakNativeAlternativesResult(sourceText, alternatives) {
  if (!Array.isArray(alternatives) || alternatives.length < 3) return true;
  const sourceNorm = normalizeForComparison(sourceText);
  const uniqueNorms = new Set(alternatives.map((i) => normalizeForComparison(i.text)));
  if (uniqueNorms.size < 3) return true;
  if (alternatives.some((i) => normalizeForComparison(i.text) === sourceNorm)) return true;
  if (containsHangul(sourceText) && alternatives.some((i) => containsHangul(i.text))) return true;
  return false;
}

export function buildFallbackNativeAlternatives(text) {
  const compact = String(text || '').trim();
  const englishOnly = containsHangul(compact)
    ? compact.replace(/[\u3131-\u318E\uAC00-\uD7A3]+/g, '').replace(/\s+/g, ' ').trim()
    : compact;
  const base = englishOnly || compact || 'Could you say that again?';
  return [
    { text: base, tone: 'Neutral', nuance: 'Closest available rewrite' },
    { text: `I feel like ${base}`, tone: 'Casual', nuance: 'Casual fallback wording' },
    { text: `I think ${base}`, tone: 'Direct', nuance: 'Direct fallback wording' },
  ];
}

export async function prepareNativeAlternativesSource(text, callModel, model) {
  const raw = String(text || '').trim();
  if (!raw || !containsHangul(raw)) return raw;
  const prompt = `Convert this mixed Korean+English chat message into ONE natural English sentence that preserves the intended meaning.\nRules:\n- Output English only.\n- Do not explain.\n- Do not add quotes.\n- Keep it simple and conversational.\n- Fix obvious typos while preserving intent.\n\nMessage:\n${raw}`;
  try {
    const prepared = cleanAlternativeText(await callModel({ prompt, model }));
    if (!prepared || containsHangul(prepared) || isMinorSentenceDifference(raw, prepared)) return raw;
    return prepared;
  } catch {
    return raw;
  }
}
