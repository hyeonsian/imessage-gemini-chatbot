import { callGeminiGenerateContent, extractCandidateText, getModelFromRequest, getServerApiKey } from './_gemini_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { text = '', targetLang = 'Korean', koreanSpeechLevel = 'polite', model } = req.body || {};
    const input = String(text || '').trim();
    if (!input) return res.status(400).json({ error: 'text is required' });
    const targetLangText = String(targetLang || 'Korean');
    const normalizedKoreanSpeechLevel = String(koreanSpeechLevel || 'polite').toLowerCase() === 'casual'
      ? 'casual'
      : 'polite';

    const koreanStyleInstruction = normalizedKoreanSpeechLevel === 'casual'
      ? 'Use natural Korean 반말 (casual speech). Do not use 존댓말 endings.'
      : 'Use natural Korean 존댓말 (polite speech). Do not use 반말 endings.';

    const prompt = /korean/i.test(targetLangText)
      ? `Translate the following English text into natural, conversational Korean.
${koreanStyleInstruction}
Only provide the Korean translation, no explanations.
Text: "${input}"`
      : `Translate the following English text into natural, conversational ${targetLangText}: "${input}"\nOnly provide the translation, no explanations.`;
    const data = await callGeminiGenerateContent({
      apiKey: getServerApiKey(),
      model: getModelFromRequest({ model }),
      body: {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
      },
    });

    const translation = extractCandidateText(data);
    return res.status(200).json({ translation: translation || '번역 실패 (데이터 없음)' });
  } catch (error) {
    console.error('translate api error:', error);
    return res.status(error.status || 500).json({ error: error.message || 'Translation failed' });
  }
}
