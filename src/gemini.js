// Gemini API integration module
// Supports Gemini 2.0 Flash, 2.5 Pro, and 2.0 Flash Lite

const DEMO_RESPONSES = [
    "안녕하세요! 무엇을 도와드릴까요? 😊",
    "좋은 질문이네요! 알려드릴게요.",
    "흥미로운 주제예요. 좀 더 자세히 이야기해볼까요?",
    "네, 이해했어요. 다른 궁금한 점이 있나요?",
    "그건 조금 복잡한 문제인데요, 하나씩 살펴볼까요? 🤔",
    "맞아요! 그 부분에 대해 더 설명해드릴게요.",
    "재미있는 대화네요! 계속해주세요 ✨",
    "도움이 필요하시면 언제든 말씀해주세요!",
    "이 부분은 제가 잘 아는 영역이에요. 자세히 알려드릴게요!",
    "좋은 아이디어예요! 실현 가능한 방법을 생각해볼게요 💡",
];

const DEFAULT_MODEL = 'gemini-3-flash-preview';
const LEGACY_MODEL_MAP = {
    'gemini-1.5-flash': DEFAULT_MODEL,
    'gemini-1.5-pro': 'gemini-3-pro-preview',
};
const FALLBACK_MODELS = [
    'gemini-3-flash-preview',
    'gemini-3-pro-preview',
];

export class GeminiAPI {
    constructor() {
        this.envApiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
        this.apiKey = localStorage.getItem('gemini_api_key') || '';
        const savedModel = localStorage.getItem('gemini_model') || DEFAULT_MODEL;
        this.model = LEGACY_MODEL_MAP[savedModel] || savedModel;
        this.systemPrompt = localStorage.getItem('gemini_system_prompt') ||
            "You are a close friend over text. Talk like a real person, not an AI. CRITICAL: Keep your responses EXTREMELY concise (1-2 short sentences max). ALWAYS respond ONLY in natural English. Never use multiple paragraphs. No philosophical fluff, no long-winded jokes, no AI-style 'how can I help you' endings. Just answer the question or chat casually like a busy friend.";
        this.conversationHistory = [];

        if (this.model !== savedModel) {
            localStorage.setItem('gemini_model', this.model);
        }
    }

    async translate(text, targetLang = 'Korean') {
        if (!this.isConfigured) return "번역 데모: " + text;
        const prompt = `Translate the following English text into natural, conversational ${targetLang}: "${text}"\nOnly provide the translation, no explanations.`;
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.effectiveApiKey}`;
            const body = {
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
            };
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "번역 실패 (데이터 없음)";
        } catch (e) {
            console.error('Translation error:', e);
            return "번역 오류 (연결 실패)";
        }
    }

    async checkGrammar(text) {
        if (!this.isConfigured) {
            return {
                hasErrors: false,
                correctedText: text,
                edits: [],
                feedback: 'Sounds natural for daily conversation.',
                sentenceFeedback: this._normalizeSentenceFeedback([], text, 'Sounds natural for daily conversation.', '', ''),
                naturalAlternative: '',
                naturalReason: ''
            };
        }

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
  "sentenceFeedback": [
    {
      "sentence": "string",
      "feedback": "string",
      "suggested": "string",
      "why": "short string"
    }
  ],
  "naturalAlternative": "string",
  "naturalReason": "short string"
}
Rules:
- correctedText must be the full corrected sentence.
- If there is no grammar issue, set hasErrors=false and edits=[].
- Keep the original meaning and tone.
- Give short native-speaker feedback in "feedback" (max 14 words).
- Provide sentence-by-sentence feedback in "sentenceFeedback" (one item per sentence).
- Each sentence feedback should be practical and specific (8-24 words).
- If a sentence already sounds natural, keep "suggested" as "" for that sentence.
- If improved phrasing is needed, set "suggested" to a short everyday rewrite.
- If the sentence is already natural enough, set naturalAlternative="" and naturalReason="".
- If a more natural everyday phrasing exists, set naturalAlternative to ONE short, common expression.
- naturalAlternative must be easy everyday English (CEFR A2-B1), avoid idioms/jargon.
- Do NOT flag capitalization-only changes.
- Do NOT flag missing/extra sentence-ending punctuation (., !, ?).
- Never prepend meta phrases like "I mean," or "A more natural way...".

Sentence:
"${text}"`;

        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.effectiveApiKey}`;
            const body = {
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
            };

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const data = await res.json();
            const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (!raw) {
                throw new Error('No grammar analysis returned');
            }

            const parsed = this._parseJsonSafely(raw);
            const edits = Array.isArray(parsed?.edits) ? parsed.edits : [];
            const normalizedEdits = edits
                .filter((edit) => edit && typeof edit.wrong === 'string' && typeof edit.right === 'string')
                .map((edit) => ({
                    wrong: edit.wrong.trim(),
                    right: edit.right.trim(),
                    reason: typeof edit.reason === 'string' ? edit.reason.trim() : ''
                }))
                .filter((edit) => !this._isMinorGrammarEdit(edit.wrong, edit.right));

            const hasErrors = Boolean(parsed?.hasErrors) && normalizedEdits.length > 0;
            const correctedText = typeof parsed?.correctedText === 'string' && parsed.correctedText.trim()
                ? parsed.correctedText.trim()
                : text;
            const feedback = typeof parsed?.feedback === 'string' && parsed.feedback.trim()
                ? parsed.feedback.trim()
                : 'Looks good overall.';
            const naturalAlternativeRaw = typeof parsed?.naturalAlternative === 'string'
                ? parsed.naturalAlternative
                : '';
            const naturalAlternative = this._cleanAlternativeText(naturalAlternativeRaw);
            const naturalReason = typeof parsed?.naturalReason === 'string' && parsed.naturalReason.trim()
                ? parsed.naturalReason.trim()
                : '';
            const hasUsableNaturalAlternative = naturalAlternative
                && !this._isMinorSentenceDifference(text, naturalAlternative);
            const sentenceFeedback = this._normalizeSentenceFeedback(
                parsed?.sentenceFeedback,
                text,
                feedback,
                naturalAlternative,
                naturalReason
            );
            const enhancedSentenceFeedback = this._hasWeakSentenceFeedback(sentenceFeedback)
                ? await this._requestDetailedSentenceFeedback(text, normalizedEdits, correctedText)
                : sentenceFeedback;

            return {
                hasErrors,
                correctedText: hasErrors ? correctedText : text,
                edits: normalizedEdits,
                feedback,
                sentenceFeedback: enhancedSentenceFeedback,
                naturalAlternative: hasUsableNaturalAlternative ? naturalAlternative : '',
                naturalReason: hasUsableNaturalAlternative ? naturalReason : ''
            };
        } catch (error) {
            console.error('Grammar check error:', error);
            return {
                hasErrors: false,
                correctedText: text,
                edits: [],
                feedback: 'Looks good overall.',
                sentenceFeedback: this._normalizeSentenceFeedback([], text, 'Looks good overall.', '', ''),
                naturalAlternative: '',
                naturalReason: ''
            };
        }
    }

    async getNativeAlternatives(text) {
        if (!this.isConfigured) {
            return this._buildFallbackNativeAlternatives(text);
        }

        const jsonPrompt = `You rewrite English learner sentences into native-sounding alternatives.
Return ONLY valid JSON (no markdown, no extra text) with this schema:
{
  "alternatives": [
    { "text": "string", "tone": "string", "nuance": "string" },
    { "text": "string", "tone": "string", "nuance": "string" },
    { "text": "string", "tone": "string", "nuance": "string" }
  ]
}
Rules:
- Provide exactly 3 alternatives.
- Keep the original intent.
- Each "text" must be very common spoken English used by natives daily.
- Keep wording simple (CEFR A2-B1), short, and easy to reuse.
- Avoid advanced vocabulary, idioms, figurative expressions, and formal business wording.
- Make each option meaningfully different in tone/nuance.
- Keep each nuance short (max 12 words).
- Never prepend meta phrases like "I mean," or "A more natural way...".

Sentence:
"${text}"`;

        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.effectiveApiKey}`;
            const callModel = async (prompt, responseMimeType = null) => {
                const generationConfig = {
                    temperature: 0.4,
                    maxOutputTokens: 1024
                };
                if (responseMimeType) {
                    generationConfig.responseMimeType = responseMimeType;
                }

                const body = {
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig
                };

                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });

                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }

                const data = await res.json();
                return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
            };

            // 1st try: strict JSON response
            const rawJson = await callModel(jsonPrompt, 'application/json');
            const parsed = this._parseJsonSafely(rawJson);
            const normalized = this._normalizeNativeAlternatives(parsed?.alternatives || []);
            if (normalized.length === 3) {
                return normalized;
            }

            // 2nd try: robust delimiter-based plain text fallback
            const fallbackPrompt = `Rewrite this sentence into 3 very common native alternatives.
Output format (exactly 3 lines):
1) <sentence> || <tone> || <short nuance>
2) <sentence> || <tone> || <short nuance>
3) <sentence> || <tone> || <short nuance>
No extra lines.
Use easy everyday English only. No "I mean," or meta-intro phrases.

Sentence:
"${text}"`;
            const rawList = await callModel(fallbackPrompt);
            const lineItems = rawList
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => line.replace(/^\d+\)\s*/, ''))
                .map((line) => {
                    const [rewritten = '', tone = 'Natural', nuance = 'Natural phrasing'] = line.split('||').map((v) => v.trim());
                    return { text: rewritten, tone, nuance };
                });

            const lineNormalized = this._normalizeNativeAlternatives(lineItems);
            if (lineNormalized.length === 3) {
                return lineNormalized;
            }

            throw new Error('Insufficient alternatives');
        } catch (error) {
            console.error('Native alternatives error:', error);
            return this._buildFallbackNativeAlternatives(text);
        }
    }

    get isConfigured() {
        return this.envApiKey.length > 0 || this.apiKey.length > 0;
    }

    get effectiveApiKey() {
        return this.envApiKey || this.apiKey;
    }

    setApiKey(key) {
        this.apiKey = key;
        localStorage.setItem('gemini_api_key', key);
    }

    setModel(model) {
        this.model = LEGACY_MODEL_MAP[model] || model;
        localStorage.setItem('gemini_model', this.model);
    }

    setSystemPrompt(prompt) {
        this.systemPrompt = prompt;
        localStorage.setItem('gemini_system_prompt', prompt);
    }

    addToHistory(role, text) {
        this.conversationHistory.push({
            role: role,
            parts: [{ text }]
        });
        // Keep last 20 exchanges to avoid token limits
        if (this.conversationHistory.length > 40) {
            this.conversationHistory = this.conversationHistory.slice(-40);
        }
    }

    clearHistory() {
        this.conversationHistory = [];
    }

    async sendMessage(userMessage) {
        this.addToHistory('user', userMessage);

        if (!this.isConfigured) {
            return this._getDemoResponse();
        }

        try {
            const response = await this._callAPI();
            const text = this._extractText(response);
            this.addToHistory('model', text);
            return text;
        } catch (error) {
            console.error('Gemini API Error:', error);

            // Remove the last user message from history on error
            this.conversationHistory.pop();

            if (error.message.includes('API_KEY_INVALID') || error.status === 400) {
                throw new Error('API 키가 유효하지 않습니다. 설정에서 확인해주세요.');
            } else if (error.message.includes('QUOTA') || error.status === 429) {
                throw new Error('API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.');
            } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                throw new Error('네트워크 연결을 확인해주세요.');
            }
            throw new Error(`오류가 발생했습니다: ${error.message}`);
        }
    }

    async _callAPI() {
        const tryModels = [this.model, ...FALLBACK_MODELS.filter((m) => m !== this.model)];
        let lastError = null;

        for (const model of tryModels) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.effectiveApiKey}`;
            const body = {
                contents: this.conversationHistory,
                systemInstruction: {
                    parts: [{ text: this.systemPrompt }]
                },
                generationConfig: {
                    temperature: 0.8,
                    topP: 0.95,
                    topK: 40,
                    maxOutputTokens: 2048,
                },
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
                ]
            };

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (res.ok) {
                if (this.model !== model) {
                    this.model = model;
                    localStorage.setItem('gemini_model', model);
                }
                return res.json();
            }

            const errorData = await res.json().catch(() => ({}));
            const error = new Error(errorData?.error?.message || `HTTP ${res.status}`);
            error.status = res.status;
            lastError = error;

            const canRetryWithNextModel =
                res.status === 404 ||
                /not found|not supported|unknown model/i.test(error.message || '');

            if (!canRetryWithNextModel) {
                throw error;
            }
        }

        throw lastError || new Error('모델 호출에 실패했습니다.');
    }

    _extractText(response) {
        const candidate = response?.candidates?.[0];
        if (!candidate) {
            throw new Error('응답을 생성하지 못했습니다.');
        }

        if (candidate.finishReason === 'SAFETY') {
            return '⚠️ 안전 정책에 의해 응답이 차단되었습니다. 다른 주제로 대화해볼까요?';
        }

        const text = candidate?.content?.parts?.[0]?.text;
        if (!text) {
            throw new Error('빈 응답이 반환되었습니다.');
        }
        return text;
    }

    _parseJsonSafely(text) {
        const direct = text.trim();
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

    _normalizeNativeAlternatives(alternatives) {
        return alternatives
            .filter((item) => item && typeof item.text === 'string')
            .map((item) => ({
                text: this._cleanAlternativeText(item.text),
                tone: typeof item.tone === 'string' && item.tone.trim() ? item.tone.trim() : 'Natural',
                nuance: typeof item.nuance === 'string' && item.nuance.trim() ? item.nuance.trim() : 'Natural phrasing'
            }))
            .filter((item) => item.text.length > 0)
            .slice(0, 3);
    }

    _buildFallbackNativeAlternatives(text) {
        const compact = (text || '').trim();
        return [
            { text: compact, tone: 'Neutral', nuance: 'Original expression' },
            { text: compact, tone: 'Casual', nuance: 'Friendly everyday tone' },
            { text: compact, tone: 'Polite', nuance: 'Softer and more polite tone' }
        ];
    }

    _isMinorGrammarEdit(wrong, right) {
        if (!wrong || !right) return false;
        if (wrong === right) return false;

        const stripEndPunctuation = (value) =>
            value.trim().replace(/[.!?]+$/g, '').trim();

        const wrongCore = stripEndPunctuation(wrong);
        const rightCore = stripEndPunctuation(right);

        // Ignore edits that are only casing differences and/or sentence-ending punctuation.
        return wrongCore.toLowerCase() === rightCore.toLowerCase();
    }

    _cleanAlternativeText(value) {
        if (typeof value !== 'string') return '';
        const cleaned = value
            .trim()
            .replace(/^"(.*)"$/s, '$1')
            .replace(/^(i mean[,:]?\s*)/i, '')
            .replace(/^(a more natural way(?: to say this)? is[,:]?\s*)/i, '')
            .replace(/^(more naturally[,:]?\s*)/i, '')
            .trim();
        return cleaned;
    }

    _isMinorSentenceDifference(source, target) {
        const normalize = (value) => String(value || '')
            .trim()
            .replace(/[.!?]+$/g, '')
            .replace(/\s+/g, ' ')
            .toLowerCase();
        return normalize(source) === normalize(target);
    }

    _splitIntoSentences(text) {
        const value = String(text || '').trim();
        if (!value) return [];
        return value
            .split(/(?<=[.!?])\s+|\n+/)
            .map((sentence) => sentence.trim())
            .filter(Boolean);
    }

    _normalizeSentenceFeedback(items, sourceText, fallbackFeedback = '', fallbackSuggested = '', fallbackWhy = '') {
        const sourceSentences = this._splitIntoSentences(sourceText);
        const baseFeedback = (fallbackFeedback || 'Looks good overall.').trim();
        const normalizedFromModel = Array.isArray(items)
            ? items
                .map((item) => ({
                    sentence: typeof item?.sentence === 'string' ? item.sentence.trim() : '',
                    feedback: typeof item?.feedback === 'string' ? item.feedback.trim() : '',
                    suggested: this._cleanAlternativeText(typeof item?.suggested === 'string' ? item.suggested : ''),
                    why: typeof item?.why === 'string' ? item.why.trim() : '',
                }))
                .filter((item) => item.sentence && item.feedback)
            : [];

        if (normalizedFromModel.length > 0) {
            return normalizedFromModel.slice(0, 6).map((item) => ({
                ...item,
                suggested: item.suggested && this._isMinorSentenceDifference(item.sentence, item.suggested) ? '' : item.suggested,
            }));
        }

        if (sourceSentences.length === 0) {
            return [{
                sentence: String(sourceText || '').trim(),
                feedback: baseFeedback,
                suggested: '',
                why: '',
            }];
        }

        return sourceSentences.slice(0, 6).map((sentence, index) =>
            this._buildLocalSentenceFeedback(sentence, index, baseFeedback, fallbackSuggested, fallbackWhy)
        );
    }

    _hasWeakSentenceFeedback(entries) {
        if (!Array.isArray(entries) || entries.length === 0) return true;

        const weakPattern = /(looks good overall|clear meaning|keep this sentence as is)/i;
        const weakCount = entries.reduce((count, item) => {
            const feedback = String(item?.feedback || '');
            const suggested = String(item?.suggested || '').trim();
            const why = String(item?.why || '').trim();
            const isWeak = weakPattern.test(feedback) && !suggested && !why;
            return count + (isWeak ? 1 : 0);
        }, 0);

        return weakCount >= Math.max(1, Math.ceil(entries.length * 0.6));
    }

    async _requestDetailedSentenceFeedback(sourceText, edits, correctedText) {
        const sentences = this._splitIntoSentences(sourceText);
        if (sentences.length === 0 || !this.isConfigured) {
            return this._normalizeSentenceFeedback([], sourceText, 'Looks good overall.', '', '');
        }

        const prompt = `You are a meticulous native English coach.
Analyze EACH sentence and return ONLY valid JSON:
{
  "sentenceFeedback": [
    {
      "sentence": "string",
      "feedback": "string",
      "suggested": "string",
      "why": "short string"
    }
  ]
}
Rules:
- Provide one item for each sentence in order.
- Check grammar, typo risk, word choice, and natural spoken flow.
- Be concrete and specific. Avoid generic praise.
- "feedback" should be 12-28 words.
- If sentence is already fine, keep "suggested" as "" and explain what works well.
- If improved phrasing is needed, "suggested" must use common everyday English.
- Do not mention capitalization-only or final punctuation-only issues.
- Never prepend meta phrases like "I mean,".

Original text:
"${sourceText}"

Known edits from first pass:
${JSON.stringify(edits).slice(0, 1800)}

Corrected text:
"${correctedText}"`;

        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.effectiveApiKey}`;
            const body = {
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: 1024,
                    responseMimeType: 'application/json'
                }
            };

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const data = await res.json();
            const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
            const parsed = this._parseJsonSafely(raw);
            return this._normalizeSentenceFeedback(parsed?.sentenceFeedback, sourceText, 'Detailed review complete.', '', '');
        } catch (error) {
            console.error('Detailed sentence feedback error:', error);
            return this._normalizeSentenceFeedback([], sourceText, 'Looks good overall.', '', '');
        }
    }

    _buildLocalSentenceFeedback(sentence, index, baseFeedback = '', fallbackSuggested = '', fallbackWhy = '') {
        const trimmed = String(sentence || '').trim();
        const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
        const hasQuestion = /\?$/.test(trimmed);
        const hasContraction = /\b(\w+'\w+)\b/.test(trimmed);

        let feedback = baseFeedback || 'The message is understandable and mostly natural.';
        if (index > 0) {
            if (wordCount >= 16) {
                feedback = 'The meaning is clear, but this sentence is long. Splitting it can sound more natural in chat.';
            } else if (hasQuestion) {
                feedback = 'This question is clear. Check word order and helper verbs to keep it natural and easy to follow.';
            } else if (!hasContraction && wordCount >= 6) {
                feedback = 'This sentence is clear. A contraction might make it sound more like everyday native texting.';
            } else {
                feedback = 'The sentence is clear and natural. Word choice works well for casual everyday conversation.';
            }
        }

        return {
            sentence: trimmed,
            feedback,
            suggested: index === 0 ? this._cleanAlternativeText(fallbackSuggested || '') : '',
            why: index === 0 ? String(fallbackWhy || '').trim() : '',
        };
    }

    _getDemoResponse() {
        const delay = 800 + Math.random() * 1200;
        return new Promise(resolve => {
            setTimeout(() => {
                const idx = Math.floor(Math.random() * DEMO_RESPONSES.length);
                const response = DEMO_RESPONSES[idx];
                this.addToHistory('model', response);
                resolve(response);
            }, delay);
        });
    }
}
