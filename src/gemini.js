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

export class GeminiAPI {
    constructor() {
        this.envApiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
        this.apiKey = localStorage.getItem('gemini_api_key') || '';
        this.model = localStorage.getItem('gemini_model') || 'gemini-1.5-flash';
        this.systemPrompt = localStorage.getItem('gemini_system_prompt') ||
            "You are a close friend over text. Talk like a real person, not an AI. CRITICAL: Keep your responses EXTREMELY concise (1-2 short sentences max). Never use multiple paragraphs. No philosophical fluff, no long-winded jokes, no AI-style 'how can I help you' endings. Just answer the question or chat casually like a busy friend.";
        this.conversationHistory = [];
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
        this.model = model;
        localStorage.setItem('gemini_model', model);
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
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.effectiveApiKey}`;

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

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            const error = new Error(errorData?.error?.message || `HTTP ${res.status}`);
            error.status = res.status;
            throw error;
        }

        return res.json();
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
