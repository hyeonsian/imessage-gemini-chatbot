import {
  buildFallbackNativeAlternatives,
  callGeminiGenerateContent,
  containsHangul,
  extractCandidateText,
  getModelFromRequest,
  getServerApiKey,
  isWeakNativeAlternativesResult,
  normalizeNativeAlternatives,
  parseJsonSafely,
  prepareNativeAlternativesSource,
} from './_gemini_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text = '', model } = req.body || {};
  const input = String(text || '').trim();
  if (!input) return res.status(400).json({ error: 'text is required' });

  const apiKey = getServerApiKey();
  if (!apiKey) return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });
  const resolvedModel = getModelFromRequest({ model });
  const hasHangul = containsHangul(input);

  const callModel = async ({ prompt, model = resolvedModel, responseMimeType = null }) => {
    const generationConfig = { temperature: 0.4, maxOutputTokens: 1024 };
    if (responseMimeType) generationConfig.responseMimeType = responseMimeType;
    const data = await callGeminiGenerateContent({
      apiKey,
      model,
      body: {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      },
    });
    return extractCandidateText(data);
  };

  let preparedSourceText = input;
  try {
    if (hasHangul) {
      preparedSourceText = await prepareNativeAlternativesSource(input, callModel, resolvedModel);
    }

    const sourceTextForGeneration = preparedSourceText || input;
    const jsonPrompt = hasHangul
      ? `You are helping a Korean learner rewrite a mixed Korean+English chat message into natural everyday English.
Return ONLY valid JSON (no markdown, no extra text) with this schema:
{"alternatives":[{"text":"string","tone":"string","nuance":"string"},{"text":"string","tone":"string","nuance":"string"},{"text":"string","tone":"string","nuance":"string"}]}
Rules:
- Understand any Korean words/phrases and rewrite the FULL message in natural English.
- Provide exactly 3 alternatives in English only.
- Keep the original intent.
- Each text must be very common spoken English used by natives daily.
- Keep wording simple (CEFR A2-B1), short, and easy to reuse.
- Do NOT repeat the original message unchanged.
- Make each option meaningfully different in tone/nuance.
- Keep each nuance short (max 12 words).
- Never prepend meta phrases like "I mean," or "A more natural way...".

Mixed message:
"${input}"

English intent to rewrite (use this as the source meaning if provided):
"${sourceTextForGeneration}"`
      : `You rewrite English learner sentences into native-sounding alternatives.
Return ONLY valid JSON (no markdown, no extra text) with this schema:
{"alternatives":[{"text":"string","tone":"string","nuance":"string"},{"text":"string","tone":"string","nuance":"string"},{"text":"string","tone":"string","nuance":"string"}]}
Rules:
- Provide exactly 3 alternatives.
- Keep the original intent.
- Each text must be very common spoken English used by natives daily.
- Keep wording simple (CEFR A2-B1), short, and easy to reuse.
- Avoid advanced vocabulary, idioms, figurative expressions, and formal business wording.
- Make each option meaningfully different in tone/nuance.
- Keep each nuance short (max 12 words).
- Do NOT repeat the original message unchanged.
- Never prepend meta phrases like "I mean," or "A more natural way...".

Sentence:
"${sourceTextForGeneration}"`;

    const rawJson = await callModel({ prompt: jsonPrompt, responseMimeType: 'application/json' });
    let normalized = normalizeNativeAlternatives(parseJsonSafely(rawJson)?.alternatives || []);
    if (normalized.length === 3 && !isWeakNativeAlternativesResult(sourceTextForGeneration, normalized)) {
      return res.status(200).json({ alternatives: normalized });
    }

    const strictRetryPrompt = `Rewrite the message into 3 natural alternatives and return ONLY JSON.
Schema:
{"alternatives":[{"text":"string","tone":"string","nuance":"string"},{"text":"string","tone":"string","nuance":"string"},{"text":"string","tone":"string","nuance":"string"}]}
Rules:
- Output English only.
- Each option must differ from the original text and from each other.
- Do not copy the source text.
- Use common everyday native chat English (A2-B1).
- Keep meaning.
- No meta phrases.
Source:
"${sourceTextForGeneration}"`;
    const retryJson = await callModel({ prompt: strictRetryPrompt, responseMimeType: 'application/json' });
    normalized = normalizeNativeAlternatives(parseJsonSafely(retryJson)?.alternatives || []);
    if (normalized.length === 3 && !isWeakNativeAlternativesResult(sourceTextForGeneration, normalized)) {
      return res.status(200).json({ alternatives: normalized });
    }

    const fallbackPrompt = `Rewrite this ${hasHangul ? 'mixed Korean+English message' : 'sentence'} into 3 very common native alternatives.
Output format (exactly 3 lines):
1) <sentence> || <tone> || <short nuance>
2) <sentence> || <tone> || <short nuance>
3) <sentence> || <tone> || <short nuance>
No extra lines.
Use easy everyday English only.
Output English only.
Do not repeat the source text unchanged.
No "I mean," or meta-intro phrases.

Sentence:
"${sourceTextForGeneration}"`;
    const rawList = await callModel({ prompt: fallbackPrompt });
    const lineItems = rawList
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^\d+\)\s*/, ''))
      .map((line) => {
        const [rewritten = '', tone = 'Natural', nuance = 'Natural phrasing'] = line.split('||').map((v) => v.trim());
        return { text: rewritten, tone, nuance };
      });
    normalized = normalizeNativeAlternatives(lineItems);
    if (normalized.length === 3 && !isWeakNativeAlternativesResult(sourceTextForGeneration, normalized)) {
      return res.status(200).json({ alternatives: normalized });
    }

    const salvagePrompt = `Rewrite the message into 3 simple native chat English options.
First, infer the intended meaning (including any Korean fragments and typos).
Then output exactly 3 lines in English only:
1) <sentence>
2) <sentence>
3) <sentence>
Rules:
- Do not copy the original text.
- Use common daily spoken English.
- Keep meaning.

Message:
"${input}"`;
    const salvageRaw = await callModel({ prompt: salvagePrompt });
    const salvageItems = salvageRaw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^\d+[.)]\s*/, ''))
      .map((line) => ({ text: line, tone: 'Natural', nuance: 'Everyday phrasing' }));
    normalized = normalizeNativeAlternatives(salvageItems);
    if (normalized.length === 3 && !isWeakNativeAlternativesResult(sourceTextForGeneration, normalized)) {
      return res.status(200).json({ alternatives: normalized });
    }

    throw new Error('Insufficient alternatives');
  } catch (error) {
    console.error('native-alternatives api error:', error);
    return res.status(200).json({ alternatives: buildFallbackNativeAlternatives(preparedSourceText || input), error: error.message || 'Fallback used' });
  }
}
