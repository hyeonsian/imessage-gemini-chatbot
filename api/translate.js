import { callGeminiGenerateContent, extractCandidateText, getModelFromRequest, getServerApiKey } from './_gemini_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { text = '', targetLang = 'Korean', model } = req.body || {};
    const input = String(text || '').trim();
    if (!input) return res.status(400).json({ error: 'text is required' });

    const prompt = `Translate the following English text into natural, conversational ${targetLang}: "${input}"\nOnly provide the translation, no explanations.`;
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
