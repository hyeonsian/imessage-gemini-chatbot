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
        try {
            const server = await this._postBackend('/api/translate', { text, targetLang, model: this.model });
            if (server?.translation) return server.translation;
        } catch (serverError) {
            console.warn('Translate backend fallback to direct call:', serverError);
        }

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
        try {
            const server = await this._postBackend('/api/grammar-feedback', { text, model: this.model });
            if (server && typeof server === 'object') {
                return {
                    hasErrors: Boolean(server.hasErrors),
                    correctedText: typeof server.correctedText === 'string' ? server.correctedText : text,
                    edits: Array.isArray(server.edits) ? server.edits : [],
                    feedback: typeof server.feedback === 'string' ? server.feedback : 'Looks good overall.',
                    feedbackPoints: Array.isArray(server.feedbackPoints) ? server.feedbackPoints : [],
                    sentenceFeedback: Array.isArray(server.sentenceFeedback) ? server.sentenceFeedback : [],
                    naturalAlternative: typeof server.naturalAlternative === 'string' ? server.naturalAlternative : '',
                    naturalReason: typeof server.naturalReason === 'string' ? server.naturalReason : '',
                    naturalRewrite: typeof server.naturalRewrite === 'string' ? server.naturalRewrite : ''
                };
            }
        } catch (serverError) {
            console.warn('Grammar backend fallback to direct call:', serverError);
        }

        if (!this.isConfigured) {
            return {
                hasErrors: false,
                correctedText: text,
                edits: [],
                feedback: 'Sounds natural for daily conversation.',
                feedbackPoints: [],
                sentenceFeedback: [],
                naturalAlternative: '',
                naturalReason: '',
                naturalRewrite: ''
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
"${text}"`;

        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.effectiveApiKey}`;
            const callModel = async (analysisPrompt) => {
                const body = {
                    contents: [{ role: 'user', parts: [{ text: analysisPrompt }] }],
                    generationConfig: {
                        temperature: 0.1,
                        maxOutputTokens: 2048,
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
                const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
                if (!raw) {
                    throw new Error('No grammar analysis returned');
                }
                return raw;
            };

            let parsed;
            try {
                parsed = this._parseJsonSafely(await callModel(prompt));
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
"${text}"`;
                parsed = this._parseJsonSafely(await callModel(retryPrompt));
                console.warn('Grammar check parse retry used:', primaryParseError);
            }
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
            const correctedTextRaw = typeof parsed?.correctedText === 'string' && parsed.correctedText.trim()
                ? parsed.correctedText.trim()
                : text;
            const feedback = typeof parsed?.feedback === 'string' && parsed.feedback.trim()
                ? parsed.feedback.trim()
                : 'Looks good overall.';
            const feedbackPointsFromModel = Array.isArray(parsed?.feedbackPoints)
                ? parsed.feedbackPoints
                    .map((item) => ({
                        part: typeof item?.part === 'string' ? item.part.trim() : '',
                        issue: typeof item?.issue === 'string' ? item.issue.trim() : '',
                        fix: typeof item?.fix === 'string' ? item.fix.trim() : ''
                    }))
                    .filter((item) => item.part && (item.issue || item.fix))
                    .slice(0, 6)
                : [];
            const feedbackPoints = feedbackPointsFromModel.length > 0
                ? feedbackPointsFromModel
                : normalizedEdits.slice(0, 6).map((edit) => ({
                    part: edit.wrong,
                    issue: edit.reason || 'Needs correction.',
                    fix: edit.right
                }));
            const correctedTextHeuristic = this._applyGrammarEditsToText(text, normalizedEdits);
            const correctedTextHeuristicWithFeedback = this._applyFeedbackPointFixes(correctedTextHeuristic, feedbackPoints);
            const correctedTextRawWithFeedback = this._applyFeedbackPointFixes(correctedTextRaw, feedbackPoints);
            const correctedCandidates = [
                correctedTextRaw,
                correctedTextRawWithFeedback,
                correctedTextHeuristic,
                correctedTextHeuristicWithFeedback
            ].filter(Boolean);
            const correctedText = this._pickBestCorrectedText(
                text,
                correctedCandidates,
                normalizedEdits,
                feedbackPoints
            );
            const naturalAlternativeRaw = typeof parsed?.naturalAlternative === 'string'
                ? parsed.naturalAlternative
                : '';
            const naturalAlternative = this._cleanAlternativeText(naturalAlternativeRaw);
            const naturalReason = typeof parsed?.naturalReason === 'string' && parsed.naturalReason.trim()
                ? parsed.naturalReason.trim()
                : '';
            const naturalRewriteRaw = typeof parsed?.naturalRewrite === 'string'
                ? parsed.naturalRewrite
                : '';
            const naturalRewrite = this._cleanAlternativeText(naturalRewriteRaw);
            const hasUsableNaturalAlternative = naturalAlternative
                && !this._isMinorSentenceDifference(text, naturalAlternative);
            const naturalRewriteFallback = naturalRewrite || (
                normalizedEdits.length > 0 && !this._isMinorSentenceDifference(text, correctedText)
                    ? correctedText
                    : ''
            );
            const hasUsableNaturalRewrite = naturalRewriteFallback
                && !this._isMinorSentenceDifference(text, naturalRewriteFallback)
                && !this._isMinorSentenceDifference(correctedText, naturalRewriteFallback);

            return {
                hasErrors,
                correctedText: hasErrors ? correctedText : text,
                edits: normalizedEdits,
                feedback,
                feedbackPoints,
                sentenceFeedback: [],
                naturalAlternative: hasUsableNaturalAlternative ? naturalAlternative : '',
                naturalReason: hasUsableNaturalAlternative ? naturalReason : '',
                naturalRewrite: hasUsableNaturalRewrite ? naturalRewriteFallback : ''
            };
        } catch (error) {
            console.error('Grammar check error:', error);
            return {
                hasErrors: false,
                correctedText: text,
                edits: [],
                feedback: 'Looks good overall.',
                feedbackPoints: [],
                sentenceFeedback: [],
                naturalAlternative: '',
                naturalReason: '',
                naturalRewrite: ''
            };
        }
    }

    async getNativeAlternatives(text) {
        try {
            const server = await this._postBackend('/api/native-alternatives', { text, model: this.model });
            if (Array.isArray(server?.alternatives)) {
                const normalized = this._normalizeNativeAlternatives(server.alternatives);
                if (normalized.length > 0) return normalized;
            }
        } catch (serverError) {
            console.warn('Native alternatives backend fallback to direct call:', serverError);
        }

        if (!this.isConfigured) {
            return this._buildFallbackNativeAlternatives(text);
        }

        const hasHangul = this._containsHangul(text);
        let preparedSourceText = String(text || '').trim();
        const jsonPrompt = hasHangul
            ? `You are helping a Korean learner rewrite a mixed Korean+English chat message into natural everyday English.
Return ONLY valid JSON (no markdown, no extra text) with this schema:
{
  "alternatives": [
    { "text": "string", "tone": "string", "nuance": "string" },
    { "text": "string", "tone": "string", "nuance": "string" },
    { "text": "string", "tone": "string", "nuance": "string" }
  ]
}
Rules:
- Understand any Korean words/phrases and rewrite the FULL message in natural English.
- Provide exactly 3 alternatives in English only.
- Keep the original intent.
- Each "text" must be very common spoken English used by natives daily.
- Keep wording simple (CEFR A2-B1), short, and easy to reuse.
- Do NOT repeat the original message unchanged.
- Make each option meaningfully different in tone/nuance.
- Keep each nuance short (max 12 words).
- Never prepend meta phrases like "I mean," or "A more natural way...".

Mixed message:
"${text}"`
            : `You rewrite English learner sentences into native-sounding alternatives.
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
- Do NOT repeat the original message unchanged.
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

            if (hasHangul) {
                const prepared = await this._prepareNativeAlternativesSource(text, callModel);
                if (prepared) {
                    preparedSourceText = prepared;
                }
            }

            const sourceTextForGeneration = preparedSourceText || String(text || '').trim();
            const sourceLabel = hasHangul ? 'Mixed message' : 'Sentence';
            const sourcePromptBlock = `${sourceLabel}:\n"${sourceTextForGeneration}"`;
            const activeJsonPrompt = hasHangul
                ? `${jsonPrompt}\n\nEnglish intent to rewrite (use this as the source meaning if provided):\n"${sourceTextForGeneration}"`
                : jsonPrompt.replace(`Sentence:\n"${text}"`, sourcePromptBlock);

            // 1st try: strict JSON response
            const rawJson = await callModel(activeJsonPrompt, 'application/json');
            const parsed = this._parseJsonSafely(rawJson);
            const normalized = this._normalizeNativeAlternatives(parsed?.alternatives || []);
            if (normalized.length === 3 && !this._isWeakNativeAlternativesResult(sourceTextForGeneration, normalized)) {
                return normalized;
            }

            // 1.5 try: stricter JSON retry if model echoed source or produced weak output
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
            const retryJson = await callModel(strictRetryPrompt, 'application/json');
            const retryParsed = this._parseJsonSafely(retryJson);
            const retryNormalized = this._normalizeNativeAlternatives(retryParsed?.alternatives || []);
            if (retryNormalized.length === 3 && !this._isWeakNativeAlternativesResult(sourceTextForGeneration, retryNormalized)) {
                return retryNormalized;
            }

            // 2nd try: robust delimiter-based plain text fallback
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
            if (lineNormalized.length === 3 && !this._isWeakNativeAlternativesResult(sourceTextForGeneration, lineNormalized)) {
                return lineNormalized;
            }

            // Final salvage: ask for plain English rewrites only (no JSON) if previous formats failed.
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
"${text}"`;
            const salvageRaw = await callModel(salvagePrompt);
            const salvageItems = salvageRaw
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => line.replace(/^\d+[.)]\s*/, ''))
                .map((line) => ({
                    text: line,
                    tone: 'Natural',
                    nuance: 'Everyday phrasing'
                }));
            const salvageNormalized = this._normalizeNativeAlternatives(salvageItems);
            if (salvageNormalized.length === 3 && !this._isWeakNativeAlternativesResult(sourceTextForGeneration, salvageNormalized)) {
                return salvageNormalized;
            }

            throw new Error('Insufficient alternatives');
        } catch (error) {
            console.error('Native alternatives error:', error);
            return this._buildFallbackNativeAlternatives(preparedSourceText || text);
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

    async _postBackend(path, payload) {
        const res = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data?.error || `HTTP ${res.status}`);
        }
        return res.json();
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
        const normalized = alternatives
            .filter((item) => item && typeof item.text === 'string')
            .map((item) => ({
                text: this._cleanAlternativeText(item.text),
                tone: typeof item.tone === 'string' && item.tone.trim() ? item.tone.trim() : 'Natural',
                nuance: typeof item.nuance === 'string' && item.nuance.trim() ? item.nuance.trim() : 'Natural phrasing'
            }))
            .filter((item) => item.text.length > 0)
            .filter((item) => !/^same as original$/i.test(item.text));

        const deduped = [];
        const seen = new Set();
        for (const item of normalized) {
            const key = this._normalizeForComparison(item.text);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            deduped.push(item);
            if (deduped.length === 3) break;
        }
        return deduped;
    }

    _buildFallbackNativeAlternatives(text) {
        const compact = (text || '').trim();
        const englishOnly = this._containsHangul(compact)
            ? compact.replace(/[\u3131-\u318E\uAC00-\uD7A3]+/g, '').replace(/\s+/g, ' ').trim()
            : compact;
        const base = englishOnly || compact || 'Could you say that again?';
        return [
            { text: base, tone: 'Neutral', nuance: 'Closest available rewrite' },
            { text: `I feel like ${base}`, tone: 'Casual', nuance: 'Casual fallback wording' },
            { text: `I think ${base}`, tone: 'Direct', nuance: 'Direct fallback wording' }
        ];
    }

    async _prepareNativeAlternativesSource(text, callModel) {
        const raw = String(text || '').trim();
        if (!raw || !this._containsHangul(raw)) return raw;

        const prompt = `Convert this mixed Korean+English chat message into ONE natural English sentence that preserves the intended meaning.
Rules:
- Output English only.
- Do not explain.
- Do not add quotes.
- Keep it simple and conversational.
- Fix obvious typos while preserving intent.

Message:
${raw}`;

        try {
            const prepared = this._cleanAlternativeText(await callModel(prompt));
            if (!prepared) return raw;
            if (this._containsHangul(prepared)) return raw;
            if (this._isMinorSentenceDifference(raw, prepared)) return raw;
            return prepared;
        } catch (error) {
            console.warn('Prepare native alternatives source error:', error);
            return raw;
        }
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
        return this._normalizeForComparison(source) === this._normalizeForComparison(target);
    }

    _normalizeForComparison(value) {
        return String(value || '')
            .trim()
            .replace(/[.!?]+$/g, '')
            .replace(/\s+/g, ' ')
            .toLowerCase();
    }

    _containsHangul(value) {
        return /[\u3131-\u318E\uAC00-\uD7A3]/.test(String(value || ''));
    }

    _correctedTextCoversEdits(sourceText, correctedText, edits) {
        const source = String(sourceText || '');
        const corrected = String(correctedText || '');
        if (!corrected.trim()) return false;
        if (!Array.isArray(edits) || edits.length === 0) return true;

        const sourceLower = source.toLowerCase();
        const correctedLower = corrected.toLowerCase();

        for (const edit of edits) {
            const wrong = String(edit?.wrong || '').trim();
            const right = String(edit?.right || '').trim();
            if (!wrong || !right) continue;

            const wrongLower = wrong.toLowerCase();
            const rightLower = right.toLowerCase();

            if (!sourceLower.includes(wrongLower)) continue;

            const wrongStillPresent = correctedLower.includes(wrongLower);
            const rightPresent = correctedLower.includes(rightLower);
            if (wrongStillPresent || !rightPresent) {
                return false;
            }
        }
        return true;
    }

    _correctedTextCoversFeedbackPoints(sourceText, correctedText, feedbackPoints) {
        const source = String(sourceText || '');
        const corrected = String(correctedText || '');
        if (!corrected.trim()) return false;
        if (!Array.isArray(feedbackPoints) || feedbackPoints.length === 0) return true;

        const sourceLower = source.toLowerCase();
        const correctedLower = corrected.toLowerCase();

        for (const point of feedbackPoints) {
            const part = String(point?.part || '').trim();
            const fix = String(point?.fix || '').trim();
            if (!part || !fix) continue;
            if (this._isMinorSentenceDifference(part, fix)) continue;

            const partLower = part.toLowerCase();
            const fixLower = fix.toLowerCase();

            if (!sourceLower.includes(partLower)) continue;

            const partStillPresent = correctedLower.includes(partLower);
            const fixPresent = correctedLower.includes(fixLower);
            if (partStillPresent || !fixPresent) {
                return false;
            }
        }

        return true;
    }

    _pickBestCorrectedText(sourceText, candidates, edits, feedbackPoints) {
        const source = String(sourceText || '');
        const unique = [];
        const seen = new Set();
        for (const candidate of candidates || []) {
            const value = String(candidate || '').trim();
            if (!value) continue;
            const key = this._normalizeForComparison(value);
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(value);
        }
        if (unique.length === 0) return source;

        let best = unique[0];
        let bestScore = Number.POSITIVE_INFINITY;
        for (const candidate of unique) {
            let score = 0;
            if (!this._correctedTextCoversEdits(source, candidate, edits)) score += 10;
            if (!this._correctedTextCoversFeedbackPoints(source, candidate, feedbackPoints)) score += 10;
            if (this._isMinorSentenceDifference(source, candidate)) score += 5;
            if (score < bestScore) {
                best = candidate;
                bestScore = score;
            }
        }
        return best;
    }

    _applyGrammarEditsToText(sourceText, edits) {
        let next = String(sourceText || '');
        if (!next || !Array.isArray(edits) || edits.length === 0) return next;

        const sortedEdits = [...edits]
            .filter((edit) => edit && typeof edit.wrong === 'string' && typeof edit.right === 'string')
            .sort((a, b) => String(b.wrong).length - String(a.wrong).length);

        for (const edit of sortedEdits) {
            const wrong = String(edit.wrong || '').trim();
            const right = String(edit.right || '').trim();
            if (!wrong || !right || wrong === right) continue;

            const escapedWrong = wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escapedWrong, 'i');
            if (regex.test(next)) {
                next = next.replace(regex, right);
            }
        }

        return next;
    }

    _applyFeedbackPointFixes(sourceText, feedbackPoints) {
        let next = String(sourceText || '');
        if (!next || !Array.isArray(feedbackPoints) || feedbackPoints.length === 0) return next;

        const sortedPoints = [...feedbackPoints]
            .filter((item) => item && typeof item.part === 'string' && typeof item.fix === 'string')
            .map((item) => ({
                part: String(item.part || '').trim(),
                fix: String(item.fix || '').trim()
            }))
            .filter((item) => item.part && item.fix && !this._isMinorSentenceDifference(item.part, item.fix))
            .sort((a, b) => b.part.length - a.part.length);

        for (const item of sortedPoints) {
            const escapedPart = item.part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escapedPart, 'i');
            if (regex.test(next)) {
                next = next.replace(regex, item.fix);
            }
        }

        return next;
    }

    _isWeakNativeAlternativesResult(sourceText, alternatives) {
        if (!Array.isArray(alternatives) || alternatives.length < 3) return true;
        const sourceNorm = this._normalizeForComparison(sourceText);
        const uniqueNorms = new Set(alternatives.map((item) => this._normalizeForComparison(item.text)));
        if (uniqueNorms.size < 3) return true;

        const sameAsSourceCount = alternatives.reduce((count, item) => (
            count + (this._normalizeForComparison(item.text) === sourceNorm ? 1 : 0)
        ), 0);
        if (sameAsSourceCount >= 1) return true;

        // If source includes Korean, require English-only outputs.
        if (this._containsHangul(sourceText)) {
            const hasHangulOutput = alternatives.some((item) => this._containsHangul(item.text));
            if (hasHangulOutput) return true;
        }

        return false;
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
