const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
const GEMINI_TTS_VOICE = process.env.GEMINI_TTS_VOICE || 'Kore';
const DEFAULT_SAMPLE_RATE = 24000;

function parseSampleRate(mimeType = '') {
  const match = String(mimeType).match(/rate=(\d+)/i);
  const parsed = match ? Number(match[1]) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SAMPLE_RATE;
}

function pcmToWavBuffer(pcmBuffer, sampleRate = DEFAULT_SAMPLE_RATE) {
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Gemini API key is not configured on server' });
  }

  const text = String(req.body?.text || '').trim();
  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }

  const voiceName = String(req.body?.voiceName || GEMINI_TTS_VOICE).trim() || GEMINI_TTS_VOICE;
  const styleInstruction = String(req.body?.style || '').trim();
  const prompt = styleInstruction
    ? `${styleInstruction}\n\n${text}`
    : `Read this naturally like a friendly native English speaker in a casual chat:\n${text}`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }],
        }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName,
              },
            },
          },
        },
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error?.message || `HTTP ${response.status}`;
      return res.status(response.status).json({ error: message });
    }

    const part = data?.candidates?.[0]?.content?.parts?.[0];
    const base64Audio = part?.inlineData?.data;
    if (!base64Audio) {
      return res.status(502).json({ error: 'No audio returned from Gemini TTS' });
    }

    const mimeType = part?.inlineData?.mimeType || '';
    const sampleRate = parseSampleRate(mimeType);
    const pcmBuffer = Buffer.from(base64Audio, 'base64');
    const wavBuffer = pcmToWavBuffer(pcmBuffer, sampleRate);

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(wavBuffer);
  } catch (error) {
    console.error('TTS API error:', error);
    return res.status(500).json({ error: error.message || 'TTS generation failed' });
  }
}
