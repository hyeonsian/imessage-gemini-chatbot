import {
  applyFeedbackPointFixes,
  applyGrammarEditsToText,
  callGeminiGenerateContent,
  cleanAlternativeText,
  extractCandidateText,
  getModelFromRequest,
  getServerApiKey,
  isMinorGrammarEdit,
  isMinorSentenceDifference,
  parseJsonSafely,
  pickBestCorrectedText,
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

  const prompt = `You are an English writing coach for language learners.
Analyze the user's sentence and return ONLY valid JSON (no markdown, no extra text) in this exact schema:
{
  "hasErrors": boolean,
  "correctedText": "string",
  "edits": [
    {
      "wrong": "string",
      "right": "string",
      "reason": "short string"
    }
  ],
  "feedback": "string",
  "feedbackPoints": [
    {
      "part": "string",
      "issue": "string",
      "fix": "string"
    }
  ],
  "naturalRewrite": "string",
  "naturalAlternative": "string",
  "naturalReason": "short string"
}
Rules:
- correctedText must be the full corrected sentence.
- If there is no grammar issue, set hasErrors=false and edits=[].
- Keep the original meaning and tone.
- Give overall native-speaker feedback in "feedback" (1-2 short sentences, practical).
- In "feedbackPoints", point out specific parts across the whole text (typos, grammar, word choice, awkward phrasing).
- Each feedbackPoints item should reference the actual problematic part in "part".
- Include spelling/typo fixes explicitly (example: "leven" -> "level") when present.
- Keep "fix" short and concrete.
- "naturalRewrite" must be a full rewrite of the whole user text in natural everyday English.
- If the text is already natural enough, set naturalRewrite="".
- If the sentence is already natural enough, set naturalAlternative="" and naturalReason="".
- If a more natural everyday phrasing exists, set naturalAlternative to ONE short, common expression.
- naturalAlternative must be easy everyday English (CEFR A2-B1), avoid idioms/jargon.
- Do NOT flag capitalization-only changes.
- Do NOT flag missing/extra sentence-ending punctuation (., !, ?).
- Never prepend meta phrases like "I mean," or "A more natural way...".

Sentence:
"${input}"`;

  const callModel = async (analysisPrompt) => {
    const data = await callGeminiGenerateContent({
      apiKey,
      model: resolvedModel,
      body: {
        contents: [{ role: 'user', parts: [{ text: analysisPrompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
        },
      },
    });
    const raw = extractCandidateText(data);
    if (!raw) throw new Error('No grammar analysis returned');
    return raw;
  };

  try {
    let parsed;
    try {
      parsed = parseJsonSafely(await callModel(prompt));
    } catch (primaryParseError) {
      const retryPrompt = `Return ONLY valid JSON. No markdown. No explanation.
Schema:
{"hasErrors":boolean,"correctedText":"string","edits":[{"wrong":"string","right":"string","reason":"string"}],"feedback":"string","feedbackPoints":[{"part":"string","issue":"string","fix":"string"}],"naturalRewrite":"string","naturalAlternative":"string","naturalReason":"string"}
Rules:
- Find grammar mistakes, spelling/typos, awkward phrasing, and word choice issues.
- Explicitly include typo corrections (example: leven -> level).
- feedbackPoints must quote the problematic text in "part".
- naturalRewrite rewrites the whole text naturally in everyday English.
- Ignore capitalization-only and final punctuation-only issues.
Text:
"${input}"`;
      parsed = parseJsonSafely(await callModel(retryPrompt));
      console.warn('Grammar check parse retry used:', primaryParseError);
    }

    const normalizedEdits = (Array.isArray(parsed?.edits) ? parsed.edits : [])
      .filter((edit) => edit && typeof edit.wrong === 'string' && typeof edit.right === 'string')
      .map((edit) => ({
        wrong: edit.wrong.trim(),
        right: edit.right.trim(),
        reason: typeof edit.reason === 'string' ? edit.reason.trim() : '',
      }))
      .filter((edit) => !isMinorGrammarEdit(edit.wrong, edit.right));

    const feedbackPointsFromModel = Array.isArray(parsed?.feedbackPoints)
      ? parsed.feedbackPoints
        .map((item) => ({
          part: typeof item?.part === 'string' ? item.part.trim() : '',
          issue: typeof item?.issue === 'string' ? item.issue.trim() : '',
          fix: typeof item?.fix === 'string' ? item.fix.trim() : '',
        }))
        .filter((item) => item.part && (item.issue || item.fix))
        .slice(0, 6)
      : [];

    const feedbackPoints = feedbackPointsFromModel.length > 0
      ? feedbackPointsFromModel
      : normalizedEdits.slice(0, 6).map((edit) => ({
        part: edit.wrong,
        issue: edit.reason || 'Needs correction.',
        fix: edit.right,
      }));

    const correctedTextRaw = typeof parsed?.correctedText === 'string' && parsed.correctedText.trim()
      ? parsed.correctedText.trim()
      : input;
    const correctedHeuristic = applyGrammarEditsToText(input, normalizedEdits);
    const correctedHeuristicWithFeedback = applyFeedbackPointFixes(correctedHeuristic, feedbackPoints);
    const correctedRawWithFeedback = applyFeedbackPointFixes(correctedTextRaw, feedbackPoints);
    const correctedText = pickBestCorrectedText(
      input,
      [correctedTextRaw, correctedRawWithFeedback, correctedHeuristic, correctedHeuristicWithFeedback],
      normalizedEdits,
      feedbackPoints
    );

    const feedback = typeof parsed?.feedback === 'string' && parsed.feedback.trim()
      ? parsed.feedback.trim()
      : 'Looks good overall.';
    const naturalAlternative = cleanAlternativeText(typeof parsed?.naturalAlternative === 'string' ? parsed.naturalAlternative : '');
    const naturalReason = typeof parsed?.naturalReason === 'string' && parsed.naturalReason.trim() ? parsed.naturalReason.trim() : '';
    const naturalRewriteRaw = cleanAlternativeText(typeof parsed?.naturalRewrite === 'string' ? parsed.naturalRewrite : '');
    const naturalRewriteFallback = naturalRewriteRaw || (normalizedEdits.length > 0 && !isMinorSentenceDifference(input, correctedText) ? correctedText : '');

    const hasUsableNaturalAlternative = naturalAlternative && !isMinorSentenceDifference(input, naturalAlternative);
    const hasUsableNaturalRewrite = naturalRewriteFallback
      && !isMinorSentenceDifference(input, naturalRewriteFallback)
      && !isMinorSentenceDifference(correctedText, naturalRewriteFallback);

    return res.status(200).json({
      hasErrors: Boolean(parsed?.hasErrors) && normalizedEdits.length > 0,
      correctedText: (Boolean(parsed?.hasErrors) && normalizedEdits.length > 0) ? correctedText : input,
      edits: normalizedEdits,
      feedback,
      feedbackPoints,
      sentenceFeedback: [],
      naturalAlternative: hasUsableNaturalAlternative ? naturalAlternative : '',
      naturalReason: hasUsableNaturalAlternative ? naturalReason : '',
      naturalRewrite: hasUsableNaturalRewrite ? naturalRewriteFallback : '',
    });
  } catch (error) {
    console.error('grammar-feedback api error:', error);
    return res.status(error.status || 500).json({
      hasErrors: false,
      correctedText: input,
      edits: [],
      feedback: 'Looks good overall.',
      feedbackPoints: [],
      sentenceFeedback: [],
      naturalAlternative: '',
      naturalReason: '',
      naturalRewrite: '',
      error: error.message || 'Grammar feedback failed',
    });
  }
}
