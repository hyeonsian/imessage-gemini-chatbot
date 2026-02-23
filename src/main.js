import './style.css';
import { GeminiAPI } from './gemini.js';

// ===========================
// App State
// ===========================
// Initialize core modules
const gemini = new GeminiAPI();

// Force-update old prompt to new concise prompt for existing users
const oldDefaultPrompt1 = 'You are a friendly and helpful AI English tutor. ALWAYS respond ONLY in natural, conversational English. Never use Korean in your responses unless specifically asked to translate a word.';
const oldDefaultPrompt2 = "You are a close friend and a helpful English tutor. Talk like a real person, not an AI. Keep your responses VERY concise (usually 1-2 sentences). Be casual and friendly. Use natural, conversational English only. Don't be wordy or give long-winded explanations unless specifically asked.";
const newStrictPrompt = "You are a close friend over text. Talk like a real person, not an AI. CRITICAL: Keep your responses EXTREMELY concise (1-2 short sentences max). ALWAYS respond ONLY in natural English. Never use multiple paragraphs. No philosophical fluff, no long-winded jokes, no AI-style 'how can I help you' endings. Just answer the question or chat casually like a busy friend.";

const currentPrompt = localStorage.getItem('gemini_system_prompt');
if (currentPrompt === oldDefaultPrompt1 || currentPrompt === oldDefaultPrompt2) {
  localStorage.setItem('gemini_system_prompt', newStrictPrompt);
  gemini.setSystemPrompt(newStrictPrompt);
}

// State
let messages = JSON.parse(localStorage.getItem('chat_messages') || '[]');
let isProcessing = false;
let hasMessageIdChanges = false;
let nativeSheetRequestId = 0;
let nativeSheetRefs = null;
let openNativeSwipeRow = null;
let aiSpeechState = {
  audio: null,
  button: null,
  objectUrl: '',
  loading: false,
  requestId: 0,
};
const aiTtsCache = {
  blobs: new Map(),
  inflight: new Map(),
};
let backSwipeState = {
  tracking: false,
  active: false,
  startX: 0,
  startY: 0,
  deltaX: 0,
};
let chatSearchState = {
  query: '',
  matches: [],
  activeIndex: -1,
  visible: false,
};
let dictionaryFilterState = {
  grammar: true,
  native: true,
};

// ===========================
// DOM Elements
// ===========================
const chatMessages = document.getElementById('chatMessages');
const appRoot = document.getElementById('app');
const chatSearchBar = document.getElementById('chatSearchBar');
const searchToggleBtn = document.getElementById('searchToggleBtn');
const chatSearchInput = document.getElementById('chatSearchInput');
const chatSearchCount = document.getElementById('chatSearchCount');
const chatSearchPrevBtn = document.getElementById('chatSearchPrevBtn');
const chatSearchNextBtn = document.getElementById('chatSearchNextBtn');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const modalClose = document.getElementById('modalClose');
const modelSelect = document.getElementById('modelSelect');
const saveSettings = document.getElementById('saveSettings');
const clearChat = document.getElementById('clearChat');
const clearBtn = document.getElementById('clearBtn');
const conversationListView = document.getElementById('conversationListView');
const conversationList = document.getElementById('conversationList');
const dictionaryView = document.getElementById('dictionaryView');
const dictionaryPageList = document.getElementById('dictionaryPageList');
const dictionaryBackBtn = document.getElementById('dictionaryBackBtn');
const dictionaryBtn = document.getElementById('dictionaryBtn');
const contactName = document.getElementById('contactName');
const contactStatus = document.getElementById('contactStatus');
const enableNotifications = document.getElementById('enableNotifications');
const testPushBtn = document.getElementById('testPushBtn');
const voiceBtn = document.getElementById('voiceBtn');
const splash = document.getElementById('splash');

// Profile Modal Elements
const headerProfile = document.getElementById('headerProfile');
const profileModal = document.getElementById('profileModal');
const profileClose = document.getElementById('profileClose');
const profileEditBtn = document.getElementById('profileEditBtn');
const aiNameInput = document.getElementById('aiNameInput');
const profileSystemPrompt = document.getElementById('profileSystemPrompt');
const voicePresetSelect = document.getElementById('voicePresetSelect');
const testVoicePresetBtn = document.getElementById('testVoicePresetBtn');
const changeAvatarBtn = document.getElementById('changeAvatarBtn');
const avatarInput = document.getElementById('avatarInput');
const headerAvatar = document.getElementById('headerAvatar');
const profileAvatarLarge = document.getElementById('profileAvatarLarge');

let isEditingProfile = false;

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;
const DEFAULT_TTS_VOICE_PRESET = 'Kore';
const AI_TTS_STYLE_PROMPT = 'Speak in natural, warm, conversational American English with human-like intonation.';
const TTS_CACHE_LIMIT = 8;

// Speech Recognition Setup
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'en-US'; // Optimized for English learning
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    messageInput.value += (messageInput.value ? ' ' : '') + transcript;
    updateSendButton();
    inputAreaHeightAdjust();
  };

  recognition.onend = () => {
    voiceBtn.classList.remove('recording');
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    voiceBtn.classList.remove('recording');
    showToast('음성 인식 중 오류가 발생했습니다.');
  };
}

// ===========================
// Initialize
// ===========================
function init() {
  ensureMessageIds();
  if (hasMessageIdChanges) saveMessages();
  ensureNativeAlternativesSheet();
  renderConversationList();
  renderDictionaryPage();
  updateDictionaryButtonBadge();
  closeConversationList();
  closeDictionaryPage();

  renderMessages();
  loadSettings();
  setupEventListeners();
  setChatSearchVisible(false);
  setupBackSwipeGesture();
  updateStatus();
  updateAIProfileUI();
  registerServiceWorker();

  if (messages.length === 0) {
    showWelcomeMessage();
  }

  // Hide Splash Screen
  setTimeout(() => {
    if (splash) splash.classList.add('hidden');
  }, 1500);

  // Listen for messages from Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'PUSH_MESSAGE') {
        const { text, time } = event.data;
        const aiMsg = { id: generateMessageId(), role: 'ai', text, time };
        messages.push(aiMsg);
        appendMessageBubble('ai', text, time, true, null, messages.length - 1);
        saveMessages();
        scrollToBottom();
      }
    });
  }
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('Service Worker registered with scope:', registration.scope);
    } catch (error) {
      console.error('Service Worker registration failed:', error);
    }
  }
}

function showWelcomeMessage() {
  const welcome = document.createElement('div');
  welcome.className = 'welcome-msg';
  welcome.id = 'welcomeMsg';
  welcome.innerHTML = `
  <div class="emoji">✦</div>
    <h2>AI Assistant</h2>
    <p>${gemini.isConfigured
      ? 'English Learning Mode.<br>Send a message to start practicing!'
      : '설정이 필요합니다.<br>관리자에게 문의하거나 Vercel 환경 변수를 확인해주세요.'
    }</p>
`;
  chatMessages.appendChild(welcome);
}

function updateStatus() {
  if (gemini.isConfigured) {
    contactStatus.textContent = `${getModelName(gemini.model)} `;
  } else {
    contactStatus.textContent = '데모 모드';
  }
}

function updateAIProfileUI() {
  const aiName = localStorage.getItem('ai_name') || 'AI Assistant';
  const aiAvatar = localStorage.getItem('ai_avatar') || '✦';
  const ttsVoicePreset = localStorage.getItem('gemini_tts_voice_preset') || DEFAULT_TTS_VOICE_PRESET;

  contactName.textContent = aiName;
  aiNameInput.value = aiName;

  // Update header avatar
  if (aiAvatar.startsWith('data:image')) {
    headerAvatar.style.backgroundImage = `url(${aiAvatar})`;
    headerAvatar.textContent = '';
  } else {
    headerAvatar.style.backgroundImage = 'none';
    headerAvatar.textContent = aiAvatar;
  }

  // Update modal avatar
  if (aiAvatar.startsWith('data:image')) {
    profileAvatarLarge.style.backgroundImage = `url(${aiAvatar})`;
    profileAvatarLarge.textContent = '';
  } else {
    profileAvatarLarge.style.backgroundImage = 'none';
    profileAvatarLarge.textContent = aiAvatar;
  }

  profileSystemPrompt.value = gemini.systemPrompt;
  if (voicePresetSelect) {
    const hasOption = Array.from(voicePresetSelect.options).some((opt) => opt.value === ttsVoicePreset);
    voicePresetSelect.value = hasOption ? ttsVoicePreset : DEFAULT_TTS_VOICE_PRESET;
  }
}

function getModelName(model) {
  const names = {
    'gemini-3-flash-preview': 'Gemini 3 Flash',
    'gemini-3-pro-preview': 'Gemini 3 Pro',
  };
  return names[model] || model;
}

// ===========================
// Message Rendering
// ===========================
function renderMessages() {
  stopAiSpeech();
  // Keep date divider
  chatMessages.innerHTML = '<div class="date-divider"><span>오늘</span></div>';

  messages.forEach((msg, index) => {
    appendMessageBubble(msg.role, msg.text, msg.time, false, msg.translation || null, index);
  });

  refreshChatSearchResults();
  scrollToBottom();
}

function appendMessageBubble(role, text, time, animate = true, translation = null, messageIndex = null) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${role === 'user' ? 'sent' : 'received'} `;
  if (!animate) msgDiv.style.animation = 'none';

  const bubbleRow = document.createElement('div');
  bubbleRow.className = 'message-bubble-row';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = formatMessage(text);
  if (messageIndex !== null) {
    bubble.dataset.messageIndex = String(messageIndex);
  }

  // Add click listener for AI messages to translate
  if (role === 'ai') {
    bubble.dataset.original = text;
    bubble.dataset.translated = translation || '';

    bubble.addEventListener('click', async () => {
      // Toggle transition with blur
      bubble.classList.add('translating');

      setTimeout(async () => {
        const isTranslated = bubble.classList.contains('is-translated');

        if (isTranslated) {
          // Restore to English
          bubble.innerHTML = formatMessage(bubble.dataset.original);
          bubble.classList.remove('is-translated');
        } else {
          // Show translation
          let translatedText = bubble.dataset.translated;
          if (!translatedText) {
            // Fallback if pre-translation failed or wasn't ready
            translatedText = await gemini.translate(bubble.dataset.original);
            bubble.dataset.translated = translatedText;
          }
          bubble.innerHTML = formatMessage(translatedText);
          bubble.classList.add('is-translated');
        }

        bubble.classList.remove('translating');
        refreshChatSearchResults();
      }, 400); // Match CSS transition timing
    });
  }

  // Add click listener for user messages to check grammar
  if (role === 'user') {
    bubble.dataset.original = text;

    const messageData = messageIndex !== null ? messages[messageIndex] : null;
    setupUserBubbleNativeSwipeAction(msgDiv, bubble, {
      sourceSentAt: messageData?.sentAt || messageData?.createdAt || null,
    });
    if (messageData?.grammarReview) {
      bubble.dataset.review = JSON.stringify(messageData.grammarReview);
    }
    if (messageData?.grammarReview?.checked && !messageData?.grammarReview?.hasErrors) {
      bubble.classList.add('grammar-ok');
      appendGrammarOkIndicator(bubble);
    }

    bubble.addEventListener('click', async () => {
      bubble.classList.add('translating');

      setTimeout(async () => {
        const isReviewed = bubble.classList.contains('is-reviewed');
        const index = Number(bubble.dataset.messageIndex);
        const msg = Number.isNaN(index) ? null : messages[index];

        if (isReviewed) {
          bubble.innerHTML = formatMessage(bubble.dataset.original);
          bubble.classList.remove('is-reviewed');
          bubble.classList.remove('has-grammar-errors');
          bubble.classList.remove('grammar-ok');
          bubble.classList.remove('translating');
          refreshChatSearchResults();
          return;
        }

        let review = null;
        if (bubble.dataset.review) {
          try {
            review = JSON.parse(bubble.dataset.review);
          } catch (_) {
            review = null;
          }
        }

        if (isLegacyOrWeakGrammarReview(review)) {
          review = null;
          delete bubble.dataset.review;
        }

        if (!review) {
          review = await gemini.checkGrammar(bubble.dataset.original);
          if (msg) {
            msg.grammarReview = { ...review, checked: true };
            saveMessages();
          }
          bubble.dataset.review = JSON.stringify(review);
        } else if (msg && !msg.grammarReview?.checked) {
          msg.grammarReview = { ...review, checked: true };
          saveMessages();
        }

	        review = normalizeGrammarReviewForDisplay(review, bubble.dataset.original || '');
	        bubble.dataset.review = JSON.stringify(review);
	        if (msg) {
	          msg.grammarReview = { ...review, checked: true };
	          saveMessages();
	        }

	        bubble.innerHTML = formatGrammarReview(review, bubble.dataset.original || '');
        bubble.classList.add('is-reviewed');
        removeGrammarOkIndicator(bubble);

        if (review.hasErrors) {
          bubble.classList.add('has-grammar-errors');
          bubble.classList.remove('grammar-ok');
          attachGrammarSaveButton(bubble, review, bubble.dataset.original, msg?.sentAt || msg?.createdAt || null);
        } else {
          bubble.classList.remove('has-grammar-errors');
          bubble.classList.add('grammar-ok');
        }

        bubble.classList.remove('translating');
        refreshChatSearchResults();
      }, 400);
    });
  }

  const timeEl = document.createElement('div');
  timeEl.className = 'message-time';
  timeEl.textContent = time || formatTime(new Date());

  bubbleRow.appendChild(bubble);
  if (role === 'ai') {
    attachAiSpeechButton(bubbleRow, bubble);
    if (animate) {
      preloadAiMessageTts(text);
    }
  }
  msgDiv.appendChild(bubbleRow);
  msgDiv.appendChild(timeEl);
  chatMessages.appendChild(msgDiv);

  refreshChatSearchResults();
  if (animate) scrollToBottom();
}

function clearChatSearchHighlights() {
  chatMessages?.querySelectorAll('mark.chat-search-hit').forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
    parent.normalize();
  });
  chatMessages?.querySelectorAll('.bubble.search-match, .bubble.search-match-active').forEach((bubble) => {
    bubble.classList.remove('search-match');
    bubble.classList.remove('search-match-active');
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightQueryInBubble(bubble, rawQuery) {
  if (!bubble || !rawQuery) return;
  const query = rawQuery.trim();
  if (!query) return;

  const matcher = new RegExp(escapeRegExp(query), 'gi');
  const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parentEl = node.parentElement;
      if (!parentEl) return NodeFilter.FILTER_REJECT;
      if (parentEl.closest('button')) return NodeFilter.FILTER_REJECT;
      if (parentEl.closest('mark.chat-search-hit')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    textNodes.push(node);
  }

  textNodes.forEach((textNode) => {
    const text = textNode.nodeValue || '';
    matcher.lastIndex = 0;
    if (!matcher.test(text)) return;
    matcher.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    while ((match = matcher.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (start > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, start)));
      }
      const mark = document.createElement('mark');
      mark.className = 'chat-search-hit';
      mark.textContent = text.slice(start, end);
      frag.appendChild(mark);
      lastIndex = end;
      if (match.index === matcher.lastIndex) matcher.lastIndex += 1;
    }
    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    textNode.parentNode?.replaceChild(frag, textNode);
  });
}

function updateChatSearchUi() {
  const total = chatSearchState.matches.length;
  const current = total > 0 ? chatSearchState.activeIndex + 1 : 0;
  if (chatSearchCount) {
    chatSearchCount.textContent = `${current}/${total}`;
  }
  if (chatSearchPrevBtn) chatSearchPrevBtn.disabled = total === 0;
  if (chatSearchNextBtn) chatSearchNextBtn.disabled = total === 0;
}

function focusChatSearchMatch(index, { scroll = true } = {}) {
  if (!chatSearchState.matches.length) {
    chatSearchState.activeIndex = -1;
    updateChatSearchUi();
    return;
  }

  const nextIndex = ((index % chatSearchState.matches.length) + chatSearchState.matches.length) % chatSearchState.matches.length;
  chatSearchState.activeIndex = nextIndex;

  chatSearchState.matches.forEach((bubble, i) => {
    bubble.classList.toggle('search-match-active', i === nextIndex);
    bubble.classList.toggle('search-match', i !== nextIndex);
  });

  if (scroll) {
    chatSearchState.matches[nextIndex].scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    });
  }
  updateChatSearchUi();
}

function refreshChatSearchResults() {
  if (!chatMessages) return;
  const query = String(chatSearchState.query || '').trim().toLowerCase();

  clearChatSearchHighlights();
  chatSearchState.matches = [];
  chatSearchState.activeIndex = -1;

  if (!query) {
    updateChatSearchUi();
    return;
  }

  const bubbles = Array.from(chatMessages.querySelectorAll('.message .bubble'));
  chatSearchState.matches = bubbles.filter((bubble) => {
    const hit = bubble.textContent?.toLowerCase().includes(query);
    if (hit) {
      highlightQueryInBubble(bubble, chatSearchState.query);
    }
    return hit;
  });

  if (chatSearchState.matches.length > 0) {
    focusChatSearchMatch(0, { scroll: false });
  } else {
    updateChatSearchUi();
  }
}

function moveChatSearchResult(direction) {
  if (!chatSearchState.matches.length) return;
  const baseIndex = chatSearchState.activeIndex >= 0 ? chatSearchState.activeIndex : 0;
  focusChatSearchMatch(baseIndex + direction);
}

function setChatSearchVisible(visible) {
  chatSearchState.visible = visible;
  if (chatSearchBar) chatSearchBar.hidden = !visible;
  if (searchToggleBtn) searchToggleBtn.setAttribute('aria-pressed', visible ? 'true' : 'false');
  if (!visible) {
    chatSearchState.query = '';
    if (chatSearchInput) chatSearchInput.value = '';
    refreshChatSearchResults();
    return;
  }
  if (chatSearchInput) {
    requestAnimationFrame(() => chatSearchInput.focus());
  }
  refreshChatSearchResults();
}

function formatMessage(text) {
  // Simple markdown-to-html (paragraphs, bold,-lists)
  return text
    .replace(/\r\n|\r|\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\- (.*)/gm, '• $1');
}

function formatOriginalMessageWithHighlights(originalMessage, review) {
  const source = String(originalMessage || '');
  if (!source) return '';

  const candidates = [];
  const feedbackPoints = Array.isArray(review?.feedbackPoints) ? review.feedbackPoints : [];
  const edits = Array.isArray(review?.edits) ? review.edits : [];

  feedbackPoints.forEach((item) => {
    const part = String(item?.part || '').trim();
    if (part) candidates.push(part);
  });
  edits.forEach((edit) => {
    const wrong = String(edit?.wrong || '').trim();
    if (wrong) candidates.push(wrong);
  });

  const unique = [];
  const seen = new Set();
  for (const item of candidates) {
    const key = item.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  if (unique.length === 0) {
    return escapeHtml(source).replace(/\r\n|\r|\n/g, '<br>');
  }

  const ranges = [];
  const lowered = source.toLowerCase();
  unique
    .sort((a, b) => b.length - a.length)
    .forEach((part) => {
      const idx = lowered.indexOf(part.toLowerCase());
      if (idx < 0) return;
      const end = idx + part.length;
      const overlaps = ranges.some((r) => !(end <= r.start || idx >= r.end));
      if (overlaps) return;
      ranges.push({ start: idx, end });
    });

  if (ranges.length === 0) {
    return escapeHtml(source).replace(/\r\n|\r|\n/g, '<br>');
  }

  ranges.sort((a, b) => a.start - b.start);
  let cursor = 0;
  let html = '';
  for (const range of ranges) {
    if (cursor < range.start) {
      html += escapeHtml(source.slice(cursor, range.start));
    }
    html += `<span class="grammar-original-highlight">${escapeHtml(source.slice(range.start, range.end))}</span>`;
    cursor = range.end;
  }
  if (cursor < source.length) {
    html += escapeHtml(source.slice(cursor));
  }
  return html.replace(/\r\n|\r|\n/g, '<br>');
}

function normalizeReviewTextKey(value) {
  return String(value || '')
    .trim()
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function applySingleReplacement(text, from, to) {
  const source = String(text || '');
  const wrong = String(from || '').trim();
  const right = String(to || '').trim();
  if (!source || !wrong || !right || normalizeReviewTextKey(wrong) === normalizeReviewTextKey(right)) return source;
  const regex = new RegExp(escapeRegExp(wrong), 'i');
  return regex.test(source) ? source.replace(regex, right) : source;
}

function applyReviewFixesToText(text, review) {
  let next = String(text || '');
  if (!next) return next;

  const edits = Array.isArray(review?.edits) ? review.edits : [];
  const feedbackPoints = Array.isArray(review?.feedbackPoints) ? review.feedbackPoints : [];
  const replacements = [];

  edits.forEach((edit) => {
    const wrong = String(edit?.wrong || '').trim();
    const right = String(edit?.right || '').trim();
    if (wrong && right) replacements.push({ from: wrong, to: right });
  });

  feedbackPoints.forEach((item) => {
    const part = String(item?.part || '').trim();
    const fix = String(item?.fix || '').trim();
    if (part && fix) replacements.push({ from: part, to: fix });
  });

  replacements
    .sort((a, b) => b.from.length - a.from.length)
    .forEach((rep) => {
      next = applySingleReplacement(next, rep.from, rep.to);
    });

  return next;
}

function reviewCorrectedTextCoverageScore(originalMessage, candidate, review) {
  const source = String(originalMessage || '');
  const target = String(candidate || '');
  if (!target.trim()) return Number.POSITIVE_INFINITY;

  let score = 0;
  const checks = [];
  const edits = Array.isArray(review?.edits) ? review.edits : [];
  const feedbackPoints = Array.isArray(review?.feedbackPoints) ? review.feedbackPoints : [];

  edits.forEach((edit) => checks.push({ from: edit?.wrong, to: edit?.right }));
  feedbackPoints.forEach((item) => checks.push({ from: item?.part, to: item?.fix }));

  const srcLower = source.toLowerCase();
  const tgtLower = target.toLowerCase();

  for (const check of checks) {
    const from = String(check?.from || '').trim();
    const to = String(check?.to || '').trim();
    if (!from || !to) continue;
    if (normalizeReviewTextKey(from) === normalizeReviewTextKey(to)) continue;

    const fromLower = from.toLowerCase();
    const toLower = to.toLowerCase();
    if (!srcLower.includes(fromLower)) continue;

    if (tgtLower.includes(fromLower)) score += 10;
    if (!tgtLower.includes(toLower)) score += 10;
  }

  if (normalizeReviewTextKey(source) === normalizeReviewTextKey(target)) score += 5;
  return score;
}

function normalizeGrammarReviewForDisplay(review, originalMessage = '') {
  if (!review || typeof review !== 'object') return review;

  const original = String(originalMessage || '');
  const rawCorrected = String(review.correctedText || original);
  const fromCorrected = applyReviewFixesToText(rawCorrected, review);
  const fromOriginal = applyReviewFixesToText(original, review);
  const candidates = [rawCorrected, fromCorrected, fromOriginal];

  let best = rawCorrected;
  let bestScore = reviewCorrectedTextCoverageScore(original, rawCorrected, review);
  for (const candidate of candidates) {
    const score = reviewCorrectedTextCoverageScore(original, candidate, review);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return {
    ...review,
    correctedText: best
  };
}

function formatGrammarReview(review, originalMessage = '') {
  const normalizedReview = normalizeGrammarReviewForDisplay(review, originalMessage);
  const originalHtml = formatOriginalMessageWithHighlights(originalMessage, review);
  const corrected = escapeHtml(normalizedReview.correctedText || '');
  const edits = Array.isArray(normalizedReview.edits) ? normalizedReview.edits : [];
  const feedback = escapeHtml(normalizedReview.feedback || 'Looks good overall.');
  const feedbackPoints = Array.isArray(normalizedReview.feedbackPoints) ? normalizedReview.feedbackPoints : [];
  const sentenceFeedback = Array.isArray(normalizedReview.sentenceFeedback) ? normalizedReview.sentenceFeedback : [];
  const naturalAlternative = escapeHtml(normalizedReview.naturalAlternative || '');
  const naturalReason = escapeHtml(normalizedReview.naturalReason || '');
  const naturalRewrite = escapeHtml(normalizedReview.naturalRewrite || '');

  const feedbackPointsHtml = feedbackPoints.length > 0
    ? `
      <div class="grammar-feedback-text">${feedback}</div>
      <div class="grammar-points">
        ${feedbackPoints.map((item) => {
          const partRaw = String(item?.part || '').trim();
          const issueRaw = String(item?.issue || '').trim();
          const fixRaw = String(item?.fix || '').trim();
          const matchedEdit = edits.find((edit) => {
            const wrong = String(edit?.wrong || '').trim();
            return normalizeReviewTextKey(wrong) && normalizeReviewTextKey(wrong) === normalizeReviewTextKey(partRaw);
          });
          const detailReasonRaw = String(matchedEdit?.reason || '').trim();
          const part = escapeHtml(partRaw);
          const issue = escapeHtml(issueRaw);
          const fix = escapeHtml(fixRaw || String(matchedEdit?.right || ''));
          const detailReason = escapeHtml(detailReasonRaw);
          return `
            <div class="grammar-point-item">
              <div class="grammar-point-part">${part}</div>
              ${issue ? `<div class="grammar-point-issue">${issue}</div>` : ''}
              ${fix ? `
                <div class="grammar-point-edit-row">
                  <span class="grammar-wrong">${part}</span>
                  <span class="grammar-arrow">→</span>
                  <span class="grammar-right"><strong>${fix}</strong></span>
                </div>
              ` : ''}
              ${detailReason && normalizeReviewTextKey(detailReason) !== normalizeReviewTextKey(issueRaw)
                ? `<div class="grammar-point-detail">${detailReason}</div>`
                : ''}
            </div>
          `;
        }).join('')}
      </div>
    `
    : sentenceFeedback.length > 0
      ? `<div class="grammar-feedback-text">${feedback}</div>`
      : `<div class="grammar-feedback-text">${feedback}</div>`;

  return `
    <div class="grammar-review">
      <div class="grammar-title">Native feedback</div>
      ${originalMessage ? `
        <div class="grammar-original-box">
          <div class="grammar-corrected-label">Your message</div>
          <div class="grammar-corrected-text grammar-original-text">${originalHtml}</div>
        </div>
      ` : ''}
      ${feedbackPointsHtml}
      ${normalizedReview.hasErrors ? `
        <div class="grammar-corrected-label">Corrected sentence</div>
        <div class="grammar-corrected-text">${corrected.replace(/\r\n|\r|\n/g, '<br>')}</div>
        <button class="grammar-save-btn" type="button" aria-label="수정 문장을 내 사전에 추가">
          + Save corrected sentence
        </button>
      ` : ''}
      ${naturalRewrite ? `
        <div class="grammar-corrected-label">Natural rewrite</div>
        <div class="grammar-corrected-text">${naturalRewrite.replace(/\r\n|\r|\n/g, '<br>')}</div>
      ` : ''}
      ${naturalAlternative ? `
        <div class="grammar-corrected-label">More natural way</div>
        <div class="grammar-corrected-text">${naturalAlternative.replace(/\r\n|\r|\n/g, '<br>')}</div>
        ${naturalReason ? `<div class="grammar-reason">${naturalReason}</div>` : ''}
      ` : ''}
    </div>
  `;
}

function isLegacyOrWeakGrammarReview(review) {
  if (!review || typeof review !== 'object') return true;

  const hasFeedbackPoints = Array.isArray(review.feedbackPoints) && review.feedbackPoints.length > 0;
  const hasNaturalRewrite = typeof review.naturalRewrite === 'string' && review.naturalRewrite.trim().length > 0;
  const hasEdits = Array.isArray(review.edits) && review.edits.length > 0;
  const hasSentenceFeedback = Array.isArray(review.sentenceFeedback) && review.sentenceFeedback.length > 0;

  if (!('feedbackPoints' in review) && !('naturalRewrite' in review)) return true;

  const feedbackText = String(review.feedback || '').trim().toLowerCase();
  const isPlaceholderOnly =
    (feedbackText === 'looks good overall.' || feedbackText === 'looks good overall') &&
    !hasFeedbackPoints &&
    !hasNaturalRewrite &&
    !hasEdits &&
    !hasSentenceFeedback;

  return isPlaceholderOnly;
}

function attachGrammarSaveButton(bubbleEl, review, originalText, sourceSentAt = null) {
  if (!bubbleEl || !review?.hasErrors) return;
  const saveBtn = bubbleEl.querySelector('.grammar-save-btn');
  if (!saveBtn) return;

  const block = (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  saveBtn.addEventListener('pointerdown', block);
  saveBtn.addEventListener('click', (event) => {
    block(event);
    const added = addGrammarDictionaryEntry(originalText, review, sourceSentAt || null);
    if (added) {
      saveBtn.textContent = 'Saved to My Dictionary';
      saveBtn.classList.add('saved');
    }
    showToast(added ? '문법 수정 문장을 사전에 추가했습니다.' : '이미 사전에 있는 표현입니다.');
  });
}

function appendGrammarOkIndicator(bubbleEl) {
  if (!bubbleEl || bubbleEl.querySelector('.grammar-ok-indicator')) return;
  const indicator = document.createElement('div');
  indicator.className = 'grammar-ok-indicator';
  indicator.innerHTML = '<span class="grammar-ok-icon">✓</span><span class="grammar-ok-label">No grammar issues.</span>';
  bubbleEl.appendChild(indicator);
}

function removeGrammarOkIndicator(bubbleEl) {
  const indicator = bubbleEl?.querySelector('.grammar-ok-indicator');
  if (indicator) indicator.remove();
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatTime(date) {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function scrollToBottom() {
  chatMessages.scrollTo({
    top: chatMessages.scrollHeight,
    behavior: 'smooth'
  });
}

function showToast(message) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

function stopAiSpeech() {
  aiSpeechState.requestId += 1;
  aiSpeechState.loading = false;
  if (aiSpeechState.audio) {
    aiSpeechState.audio.onended = null;
    aiSpeechState.audio.onerror = null;
    aiSpeechState.audio.pause();
    aiSpeechState.audio.src = '';
    aiSpeechState.audio = null;
  }
  if (aiSpeechState.objectUrl) {
    URL.revokeObjectURL(aiSpeechState.objectUrl);
    aiSpeechState.objectUrl = '';
  }
  if (aiSpeechState.button) {
    aiSpeechState.button.classList.remove('speaking');
    aiSpeechState.button.classList.remove('loading');
    aiSpeechState.button.setAttribute('aria-pressed', 'false');
  }
  aiSpeechState.button = null;
}

async function speakAiMessage(text, buttonEl) {
  const speakText = String(text || '').trim();
  if (!speakText) return;

  if (aiSpeechState.button === buttonEl && (aiSpeechState.loading || aiSpeechState.audio)) {
    stopAiSpeech();
    return;
  }

  stopAiSpeech();
  aiSpeechState.button = buttonEl;
  const requestId = ++aiSpeechState.requestId;
  buttonEl.setAttribute('aria-pressed', 'true');

  try {
    const voiceName = getSelectedTtsVoicePreset();
    const cacheKey = buildTtsCacheKey(speakText, voiceName, AI_TTS_STYLE_PROMPT);
    const hasCache = aiTtsCache.blobs.has(cacheKey);
    if (!hasCache) {
      aiSpeechState.loading = true;
      buttonEl.classList.add('loading');
    }

    const blob = await fetchAiTtsBlob(speakText, { voiceName, style: AI_TTS_STYLE_PROMPT });
    if (requestId !== aiSpeechState.requestId) return;

    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);

    audio.onended = () => {
      if (aiSpeechState.audio === audio) {
        stopAiSpeech();
      }
    };
    audio.onerror = () => {
      if (aiSpeechState.audio === audio) {
        stopAiSpeech();
      }
      showToast('음성 재생 중 오류가 발생했습니다.');
    };

    aiSpeechState.loading = false;
    aiSpeechState.objectUrl = objectUrl;
    aiSpeechState.audio = audio;
    buttonEl.classList.remove('loading');
    buttonEl.classList.add('speaking');

    await audio.play();
  } catch (error) {
    if (requestId !== aiSpeechState.requestId) return;
    stopAiSpeech();
    showToast(`음성 생성 실패: ${error.message}`);
  }
}

function getSelectedTtsVoicePreset() {
  const fromSelect = voicePresetSelect?.value?.trim();
  if (fromSelect) return fromSelect;
  return localStorage.getItem('gemini_tts_voice_preset') || DEFAULT_TTS_VOICE_PRESET;
}

function buildTtsCacheKey(text, voiceName, style) {
  return `${voiceName}::${style}::${String(text || '').trim()}`;
}

function setCachedTtsBlob(cacheKey, blob) {
  if (!cacheKey || !blob) return;
  if (aiTtsCache.blobs.has(cacheKey)) {
    aiTtsCache.blobs.delete(cacheKey);
  }
  aiTtsCache.blobs.set(cacheKey, blob);
  while (aiTtsCache.blobs.size > TTS_CACHE_LIMIT) {
    const oldestKey = aiTtsCache.blobs.keys().next().value;
    if (!oldestKey) break;
    aiTtsCache.blobs.delete(oldestKey);
  }
}

async function requestTtsBlobFromServer(text, { voiceName, style }) {
  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voiceName,
      style,
    }),
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    throw new Error(errorPayload?.error || `HTTP ${response.status}`);
  }

  return response.blob();
}

async function fetchAiTtsBlob(text, { voiceName, style }) {
  const cacheKey = buildTtsCacheKey(text, voiceName, style);
  const cached = aiTtsCache.blobs.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (aiTtsCache.inflight.has(cacheKey)) {
    return aiTtsCache.inflight.get(cacheKey);
  }

  const promise = requestTtsBlobFromServer(text, { voiceName, style })
    .then((blob) => {
      setCachedTtsBlob(cacheKey, blob);
      aiTtsCache.inflight.delete(cacheKey);
      return blob;
    })
    .catch((error) => {
      aiTtsCache.inflight.delete(cacheKey);
      throw error;
    });

  aiTtsCache.inflight.set(cacheKey, promise);
  return promise;
}

function preloadAiMessageTts(text) {
  const speakText = String(text || '').trim();
  if (!speakText) return;
  const voiceName = getSelectedTtsVoicePreset();
  void fetchAiTtsBlob(speakText, {
    voiceName,
    style: AI_TTS_STYLE_PROMPT,
  }).catch(() => {
    // Silent failure: preload should not interrupt chat UX.
  });
}

function attachAiSpeechButton(bubbleRow, bubble) {
  if (!bubbleRow || !bubble) return;
  const ttsBtn = document.createElement('button');
  ttsBtn.className = 'bubble-tts-btn';
  ttsBtn.type = 'button';
  ttsBtn.setAttribute('aria-label', 'Play message audio');
  ttsBtn.setAttribute('aria-pressed', 'false');
  ttsBtn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 10H8L13 6V18L8 14H4V10Z" fill="currentColor"/>
      <path d="M16 9.5C17 10.4 17.6 11.6 17.6 13C17.6 14.4 17 15.6 16 16.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M18.7 7C20.3 8.6 21.2 10.7 21.2 13C21.2 15.3 20.3 17.4 18.7 19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;

  ttsBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceText = bubble.dataset.original || bubble.textContent || '';
    speakAiMessage(sourceText, ttsBtn);
  });

  bubbleRow.appendChild(ttsBtn);
}

function setupUserBubbleNativeSwipeAction(messageEl, bubble, context = {}) {
  if (!messageEl || !bubble) return;

  messageEl.classList.add('has-native-swipe-action');

  const actionBtn = document.createElement('button');
  actionBtn.className = 'bubble-native-action-btn';
  actionBtn.type = 'button';
  actionBtn.setAttribute('aria-label', 'Open native alternatives');
  actionBtn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M13 5l7 7-7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  messageEl.insertBefore(actionBtn, messageEl.querySelector('.message-time'));

  const MAX_SWIPE = 54;
  let startX = 0;
  let startY = 0;
  let baseX = 0;
  let dragging = false;
  let moved = false;

  const closeRow = () => {
    messageEl.classList.remove('native-action-revealed');
    bubble.style.transform = '';
    if (openNativeSwipeRow === messageEl) openNativeSwipeRow = null;
  };

  const revealRow = () => {
    if (openNativeSwipeRow && openNativeSwipeRow !== messageEl) {
      const prevBubble = openNativeSwipeRow.querySelector('.bubble');
      openNativeSwipeRow.classList.remove('native-action-revealed');
      if (prevBubble) prevBubble.style.transform = '';
    }
    openNativeSwipeRow = messageEl;
    messageEl.classList.add('native-action-revealed');
    bubble.style.transform = `translateX(-${MAX_SWIPE}px)`;
  };

  actionBtn.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await openNativeAlternativesSheet(bubble.dataset.original || bubble.textContent || '', context);
    closeRow();
  });

  bubble.addEventListener('click', (event) => {
    if (messageEl.classList.contains('native-action-revealed')) {
      event.preventDefault();
      event.stopPropagation();
      closeRow();
    }
  }, true);

  messageEl.addEventListener('touchstart', (event) => {
    if (!event.touches || event.touches.length !== 1) return;
    if (event.target instanceof Element && event.target.closest('.bubble-native-action-btn')) return;
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    baseX = messageEl.classList.contains('native-action-revealed') ? -MAX_SWIPE : 0;
    dragging = true;
    moved = false;
    bubble.style.transition = 'none';
  }, { passive: true });

  messageEl.addEventListener('touchmove', (event) => {
    if (!dragging || !event.touches || event.touches.length !== 1) return;
    const dx = event.touches[0].clientX - startX;
    const dy = Math.abs(event.touches[0].clientY - startY);
    if (dy > Math.abs(dx) && dy > 8) return;

    const nextX = Math.max(-MAX_SWIPE, Math.min(0, baseX + dx));
    if (Math.abs(nextX - baseX) > 4) moved = true;
    event.preventDefault();
    bubble.style.transform = `translateX(${nextX}px)`;
  }, { passive: false });

  const finishSwipe = () => {
    if (!dragging) return;
    dragging = false;
    bubble.style.transition = '';

    const matrix = getComputedStyle(bubble).transform;
    const tx = matrix !== 'none' ? Number(matrix.split(',')[4]) : 0;
    if (tx <= -30) {
      revealRow();
    } else {
      closeRow();
    }

    if (moved) {
      const suppressClickOnce = (event) => {
        event.preventDefault();
        event.stopPropagation();
        bubble.removeEventListener('click', suppressClickOnce, true);
      };
      bubble.addEventListener('click', suppressClickOnce, true);
    }
  };

  messageEl.addEventListener('touchend', finishSwipe, { passive: true });
  messageEl.addEventListener('touchcancel', finishSwipe, { passive: true });
}

function ensureNativeAlternativesSheet() {
  if (nativeSheetRefs) return nativeSheetRefs;

  const overlay = document.createElement('div');
  overlay.className = 'native-sheet-overlay';
  overlay.innerHTML = `
    <div class="native-sheet" role="dialog" aria-label="Native alternatives">
      <div class="native-sheet-handle"></div>
      <div class="native-sheet-header">
        <div class="native-sheet-title">Native alternatives</div>
        <button class="native-sheet-close" type="button">Close</button>
      </div>
      <div class="native-sheet-body"></div>
    </div>
  `;

  document.body.appendChild(overlay);

  const sheet = overlay.querySelector('.native-sheet');
  const body = overlay.querySelector('.native-sheet-body');
  const closeBtn = overlay.querySelector('.native-sheet-close');

  const close = () => closeNativeAlternativesSheet();
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  nativeSheetRefs = { overlay, sheet, body };
  return nativeSheetRefs;
}

function closeNativeAlternativesSheet() {
  const refs = ensureNativeAlternativesSheet();
  refs.overlay.classList.remove('active');
  document.body.classList.remove('native-sheet-open');
}

async function openNativeAlternativesSheet(originalText, context = {}) {
  const refs = ensureNativeAlternativesSheet();
  const currentRequestId = ++nativeSheetRequestId;

  refs.body.innerHTML = `
    <div class="native-original">
      <div class="native-original-label">Your message</div>
      <div class="native-original-text">${escapeHtml(originalText)}</div>
    </div>
    <div class="native-loading">Finding natural options...</div>
  `;

  refs.overlay.classList.add('active');
  document.body.classList.add('native-sheet-open');

  const alternatives = await gemini.getNativeAlternatives(originalText);
  if (currentRequestId !== nativeSheetRequestId) return;

  refs.body.innerHTML = `
    <div class="native-original">
      <div class="native-original-label">Your message</div>
      <div class="native-original-text">${escapeHtml(originalText)}</div>
    </div>
    ${alternatives.map((item, index) => `
      <div class="native-option-swipe" data-option-index="${index}">
        <button class="native-add-btn" type="button" aria-label="내 사전에 추가">+</button>
        <div class="native-option">
          <div class="native-option-top">
            <span class="native-rank">Option ${index + 1}</span>
            <span class="native-tone">${escapeHtml(item.tone)}</span>
          </div>
          <div class="native-text">${escapeHtml(item.text)}</div>
          <div class="native-nuance">Nuance: ${escapeHtml(item.nuance)}</div>
        </div>
      </div>
    `).join('')}
  `;

  attachNativeOptionSwipeHandlers(alternatives, originalText, context);
}

function attachNativeOptionSwipeHandlers(alternatives, originalText, context = {}) {
  if (!nativeSheetRefs?.body) return;
  const rows = nativeSheetRefs.body.querySelectorAll('.native-option-swipe');

  rows.forEach((row) => {
    const optionCard = row.querySelector('.native-option');
    const addBtn = row.querySelector('.native-add-btn');
    const optionIndex = Number(row.dataset.optionIndex);
    const option = alternatives[optionIndex];
    if (!optionCard || !addBtn || !option) return;

    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let dragging = false;
    const MAX_SWIPE = 72;

    const closeRow = () => {
      row.classList.remove('revealed');
      optionCard.style.transform = '';
    };

    addBtn.addEventListener('click', () => {
      const added = addDictionaryEntry(option, originalText, context.sourceSentAt || null);
      showToast(added ? '내 사전에 추가했습니다.' : '이미 사전에 있는 표현입니다.');
      closeRow();
    });

    row.addEventListener('touchstart', (event) => {
      if (!event.touches || event.touches.length !== 1) return;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      dragging = true;
      currentX = row.classList.contains('revealed') ? -MAX_SWIPE : 0;
      optionCard.style.transition = 'none';
    }, { passive: true });

    row.addEventListener('touchmove', (event) => {
      if (!dragging || !event.touches || event.touches.length !== 1) return;

      const dx = event.touches[0].clientX - startX;
      const dy = Math.abs(event.touches[0].clientY - startY);
      if (dy > Math.abs(dx) && dy > 8) return;

      event.preventDefault();
      const nextX = Math.max(-MAX_SWIPE, Math.min(0, currentX + dx));
      optionCard.style.transform = `translateX(${nextX}px)`;
    }, { passive: false });

    const finishSwipe = () => {
      if (!dragging) return;
      dragging = false;
      optionCard.style.transition = 'transform 0.18s ease';

      const matrix = getComputedStyle(optionCard).transform;
      const tx = matrix !== 'none' ? Number(matrix.split(',')[4]) : 0;
      const shouldReveal = tx <= -36;

      if (shouldReveal) {
        row.classList.add('revealed');
        optionCard.style.transform = `translateX(-${MAX_SWIPE}px)`;
      } else {
        closeRow();
      }
    };

    row.addEventListener('touchend', finishSwipe, { passive: true });
    row.addEventListener('touchcancel', finishSwipe, { passive: true });
  });
}

function getDictionaryEntries() {
  return JSON.parse(localStorage.getItem('native_dictionary_entries') || '[]');
}

function saveDictionaryEntries(entries) {
  localStorage.setItem('native_dictionary_entries', JSON.stringify(entries));
}

function addDictionaryEntry(option, originalText = '', sourceSentAt = null) {
  const entries = getDictionaryEntries();
  const optionText = String(option?.text || '').trim();
  if (!optionText) return false;
  const exists = entries.some((entry) => String(entry.text || '').toLowerCase() === optionText.toLowerCase());
  if (exists) return false;

  const createdAt = new Date().toISOString();
  entries.unshift({
    id: generateMessageId(),
    entryType: 'native',
    original: originalText,
    originalSentAt: sourceSentAt || createdAt,
    text: optionText,
    tone: option.tone,
    nuance: option.nuance,
    createdAt,
  });
  saveDictionaryEntries(entries);
  updateDictionaryButtonBadge();
  if (dictionaryView?.classList.contains('active')) {
    renderDictionaryPage();
  }
  return true;
}

function addGrammarDictionaryEntry(originalText, review, sourceSentAt = null) {
  const correctedText = String(review?.correctedText || '').trim();
  if (!correctedText) return false;

  const entries = getDictionaryEntries();
  const exists = entries.some((entry) => String(entry.text || '').toLowerCase() === correctedText.toLowerCase());
  if (exists) return false;

  const createdAt = new Date().toISOString();
  const edits = Array.isArray(review?.edits) ? review.edits : [];
  const grammarEdits = edits
    .map((edit) => ({
      wrong: String(edit?.wrong || '').trim(),
      right: String(edit?.right || '').trim(),
      reason: String(edit?.reason || '').trim(),
    }))
    .filter((edit) => edit.wrong && edit.right)
    .slice(0, 4);

  entries.unshift({
    id: generateMessageId(),
    entryType: 'grammar',
    original: originalText || '',
    originalSentAt: sourceSentAt || createdAt,
    text: correctedText,
    tone: '',
    nuance: '',
    grammarEdits,
    createdAt,
  });

  saveDictionaryEntries(entries);
  updateDictionaryButtonBadge();
  if (dictionaryView?.classList.contains('active')) {
    renderDictionaryPage();
  }
  return true;
}

function getDictionaryEntryType(entry) {
  return entry?.entryType === 'grammar' ? 'grammar' : 'native';
}

function getDictionaryEntryTag(entry) {
  return getDictionaryEntryType(entry) === 'grammar'
    ? '#Grammar Correction'
    : '#Native Expression';
}

function getDictionaryEntryTypeClass(entry) {
  return getDictionaryEntryType(entry) === 'grammar'
    ? 'type-grammar'
    : 'type-native';
}

function isDictionaryTypeVisible(type) {
  if (type === 'grammar') return dictionaryFilterState.grammar;
  return dictionaryFilterState.native;
}

function renderDictionaryFilterRow() {
  const grammarActive = dictionaryFilterState.grammar ? 'active' : '';
  const nativeActive = dictionaryFilterState.native ? 'active' : '';
  return `
    <div class="dictionary-filter-row">
      <button class="dictionary-filter-chip chip-grammar ${grammarActive}" type="button" data-filter-type="grammar">#Grammar Correction</button>
      <button class="dictionary-filter-chip chip-native ${nativeActive}" type="button" data-filter-type="native">#Native Expression</button>
    </div>
  `;
}

function toggleDictionaryFilter(filterType) {
  const isGrammar = filterType === 'grammar';
  const targetKey = isGrammar ? 'grammar' : 'native';
  const otherKey = isGrammar ? 'native' : 'grammar';
  const targetOn = dictionaryFilterState[targetKey];
  const otherOn = dictionaryFilterState[otherKey];

  if (targetOn && otherOn) {
    dictionaryFilterState[targetKey] = true;
    dictionaryFilterState[otherKey] = false;
  } else if (targetOn && !otherOn) {
    dictionaryFilterState[targetKey] = true;
    dictionaryFilterState[otherKey] = true;
  } else {
    dictionaryFilterState[targetKey] = true;
  }
}

function attachDictionaryFilterHandlers() {
  if (!dictionaryPageList) return;
  const chips = dictionaryPageList.querySelectorAll('.dictionary-filter-chip');
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const filterType = chip.dataset.filterType;
      if (filterType !== 'grammar' && filterType !== 'native') return;
      toggleDictionaryFilter(filterType);
      renderDictionaryPage();
    });
  });
}

function renderDictionaryGrammarEdits(entry) {
  if (getDictionaryEntryType(entry) !== 'grammar') return '';
  const edits = Array.isArray(entry.grammarEdits) ? entry.grammarEdits : [];
  if (edits.length === 0) return '';

  const rows = edits.map((edit) => `
    <div class="dictionary-grammar-row">
      <span class="dictionary-grammar-wrong">${escapeHtml(String(edit.wrong || ''))}</span>
      <span class="dictionary-grammar-arrow">→</span>
      <span class="dictionary-grammar-right">${escapeHtml(String(edit.right || ''))}</span>
    </div>
  `).join('');

  return `
    <div class="dictionary-grammar-box">
      <div class="dictionary-grammar-label">Grammar fixes</div>
      ${rows}
    </div>
  `;
}

function updateDictionaryButtonBadge() {
  if (!dictionaryBtn) return;
  dictionaryBtn.dataset.count = String(getDictionaryEntries().length);
}

function renderDictionaryPage() {
  if (!dictionaryPageList) return;
  const entries = getDictionaryEntries();
  const visibleEntries = entries.filter((entry) => isDictionaryTypeVisible(getDictionaryEntryType(entry)));

  if (entries.length === 0) {
    dictionaryPageList.innerHTML = `
      ${renderDictionaryFilterRow()}
      <div class="dictionary-empty">아직 저장된 표현이 없습니다.</div>
    `;
    attachDictionaryFilterHandlers();
    return;
  }

  const listHtml = visibleEntries.length === 0
    ? '<div class="dictionary-empty">선택한 필터에 맞는 항목이 없습니다.</div>'
    : visibleEntries.map((entry) => `
    <div class="dictionary-entry-swipe" data-entry-id="${escapeHtml(entry.id || '')}">
      <button class="dictionary-delete-btn" type="button" aria-label="사전에서 삭제">−</button>
      <div class="dictionary-entry">
        <div class="dictionary-entry-meta-head">
          <span class="dictionary-entry-type ${getDictionaryEntryTypeClass(entry)}">${escapeHtml(getDictionaryEntryTag(entry))}</span>
          <span class="dictionary-entry-time">${escapeHtml(formatDictionaryTimestamp(entry.originalSentAt || entry.createdAt))}</span>
        </div>
        <div class="dictionary-entry-original-label">원래 메시지</div>
        <div class="dictionary-entry-original">${escapeHtml(entry.original || '-')}</div>
        ${renderDictionaryGrammarEdits(entry)}
        ${getDictionaryEntryType(entry) === 'native' ? `
          <div class="dictionary-entry-top">
            <span class="dictionary-tone">${escapeHtml(entry.tone || 'Natural')}</span>
          </div>
        ` : ''}
        <div class="dictionary-text">${escapeHtml(entry.text)}</div>
        ${getDictionaryEntryType(entry) === 'native' ? `<div class="dictionary-nuance">${escapeHtml(entry.nuance || '')}</div>` : ''}
      </div>
    </div>
  `).join('');

  dictionaryPageList.innerHTML = `
    ${renderDictionaryFilterRow()}
    ${listHtml}
  `;

  attachDictionaryFilterHandlers();
  attachDictionarySwipeHandlers();
}

function attachDictionarySwipeHandlers() {
  if (!dictionaryPageList) return;
  const rows = dictionaryPageList.querySelectorAll('.dictionary-entry-swipe');

  rows.forEach((row) => {
    const entryCard = row.querySelector('.dictionary-entry');
    const deleteBtn = row.querySelector('.dictionary-delete-btn');
    const entryId = row.dataset.entryId;
    if (!entryCard || !deleteBtn || !entryId) return;

    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let dragging = false;
    const MAX_SWIPE = 72;

    const closeRow = () => {
      row.classList.remove('revealed');
      entryCard.style.transform = '';
    };

    deleteBtn.addEventListener('click', () => {
      removeDictionaryEntry(entryId);
      renderDictionaryPage();
      updateDictionaryButtonBadge();
      showToast('사전에서 삭제했습니다.');
    });

    row.addEventListener('touchstart', (event) => {
      if (!event.touches || event.touches.length !== 1) return;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      dragging = true;
      currentX = row.classList.contains('revealed') ? -MAX_SWIPE : 0;
      entryCard.style.transition = 'none';
    }, { passive: true });

    row.addEventListener('touchmove', (event) => {
      if (!dragging || !event.touches || event.touches.length !== 1) return;

      const dx = event.touches[0].clientX - startX;
      const dy = Math.abs(event.touches[0].clientY - startY);
      if (dy > Math.abs(dx) && dy > 8) return;

      event.preventDefault();
      const nextX = Math.max(-MAX_SWIPE, Math.min(0, currentX + dx));
      entryCard.style.transform = `translateX(${nextX}px)`;
    }, { passive: false });

    const finishSwipe = () => {
      if (!dragging) return;
      dragging = false;
      entryCard.style.transition = 'transform 0.18s ease';

      const matrix = getComputedStyle(entryCard).transform;
      const tx = matrix !== 'none' ? Number(matrix.split(',')[4]) : 0;
      const shouldReveal = tx <= -36;

      if (shouldReveal) {
        row.classList.add('revealed');
        entryCard.style.transform = `translateX(-${MAX_SWIPE}px)`;
      } else {
        closeRow();
      }
    };

    row.addEventListener('touchend', finishSwipe, { passive: true });
    row.addEventListener('touchcancel', finishSwipe, { passive: true });
  });
}

function removeDictionaryEntry(entryId) {
  const entries = getDictionaryEntries().filter((entry) => entry.id !== entryId);
  saveDictionaryEntries(entries);
}

function formatDictionaryTimestamp(isoString) {
  const date = isoString ? new Date(isoString) : new Date();
  if (Number.isNaN(date.getTime())) return '--/--/-- --:--';

  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yy}/${mm}/${dd} ${hh}:${min}`;
}

function openDictionaryPage() {
  renderDictionaryPage();
  if (dictionaryView) dictionaryView.classList.add('active');
  if (conversationListView) conversationListView.classList.remove('active');
  document.body.classList.add('conversation-list-open');
}

function closeDictionaryPage() {
  if (dictionaryView) dictionaryView.classList.remove('active');
}

// ===========================
// Chat Logic
// ===========================
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || isProcessing) return;

  // Add user message to state
  const time = formatTime(new Date());
  messages.push({ id: generateMessageId(), role: 'user', text, time, sentAt: new Date().toISOString() });

  // UI updates
  removeWelcomeMessage();
  appendMessageBubble('user', text, time, true, null, messages.length - 1);
  messageInput.value = '';
  messageInput.style.height = 'auto';
  updateSendButton();
  saveMessages();

  // API Call
  isProcessing = true;
  const typingIndicator = showTypingIndicator();

  try {
    const response = await gemini.sendMessage(text);
    removeTypingIndicator(typingIndicator);

    const aiTime = formatTime(new Date());

    // Pre-translate for instant tap response
    const translation = await gemini.translate(response);

    messages.push({ id: generateMessageId(), role: 'ai', text: response, time: aiTime, translation });
    appendMessageBubble('ai', response, aiTime, true, translation, messages.length - 1);
    saveMessages();

    // Notification request after first message
    if (messages.length === 2) {
      setTimeout(() => requestNotificationPermission(), 1000);
    }
  } catch (error) {
    removeTypingIndicator(typingIndicator);
    appendMessageBubble('system', `에러가 발생했습니다: ${error.message} `, formatTime(new Date()));
  } finally {
    isProcessing = false;
  }
}

function removeWelcomeMessage() {
  const welcome = document.getElementById('welcomeMsg');
  if (welcome) welcome.remove();
}

function showTypingIndicator() {
  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  indicator.innerHTML = `
  <div class="dot"></div>
    <div class="dot"></div>
    <div class="dot"></div>
`;
  chatMessages.appendChild(indicator);
  scrollToBottom();
  return indicator;
}

function removeTypingIndicator(indicator) {
  if (indicator) indicator.remove();
}

function saveMessages() {
  localStorage.setItem('chat_messages', JSON.stringify(messages));
  renderConversationList();
}

function generateMessageId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function ensureMessageIds() {
  messages = messages.map((message) => {
    if (message?.id) return message;
    hasMessageIdChanges = true;
    return { ...message, id: generateMessageId() };
  });
}

function loadSettings() {
  const hasOption = Array.from(modelSelect.options).some((option) => option.value === gemini.model);
  modelSelect.value = hasOption ? gemini.model : 'gemini-3-flash-preview';
}

// ===========================
// Event Listeners
// ===========================
function setupEventListeners() {
  if (searchToggleBtn) {
    searchToggleBtn.addEventListener('click', () => {
      const currentlyVisible = chatSearchBar ? !chatSearchBar.hidden : chatSearchState.visible;
      setChatSearchVisible(!currentlyVisible);
    });
  }

  if (chatSearchInput) {
    chatSearchInput.addEventListener('input', () => {
      chatSearchState.query = chatSearchInput.value || '';
      refreshChatSearchResults();
    });

    chatSearchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        moveChatSearchResult(event.shiftKey ? -1 : 1);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setChatSearchVisible(false);
      }
    });
  }

  if (chatSearchPrevBtn) {
    chatSearchPrevBtn.addEventListener('click', () => moveChatSearchResult(-1));
  }

  if (chatSearchNextBtn) {
    chatSearchNextBtn.addEventListener('click', () => moveChatSearchResult(1));
  }

  // Send button
  sendBtn.addEventListener('click', sendMessage);

  // Auto-resize textarea
  messageInput.addEventListener('input', () => {
    inputAreaHeightAdjust();
    updateSendButton();
  });

  // Voice button
  if (voiceBtn) {
    voiceBtn.addEventListener('click', () => {
      if (!recognition) {
        showToast('이 브라우저는 음성 인식을 지원하지 않습니다.');
        return;
      }

      if (voiceBtn.classList.contains('recording')) {
        recognition.stop();
      } else {
        voiceBtn.classList.add('recording');
        recognition.start();
      }
    });
  }

  // Profile modal toggle
  if (headerProfile) {
    headerProfile.addEventListener('click', () => {
      profileModal.classList.add('active');
    });
  }

  if (profileClose) {
    profileClose.addEventListener('click', () => {
      profileModal.classList.remove('active');
    });
  }

  // Settings modal toggle
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      settingsModal.classList.add('active');
      loadSettings();
    });
  }

  if (modalClose) {
    modalClose.addEventListener('click', () => {
      settingsModal.classList.remove('active');
    });
  }

  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        settingsModal.classList.remove('active');
      }
    });
  }

  // Profile edit toggle logic
  if (profileEditBtn) {
    profileEditBtn.addEventListener('click', () => {
      isEditingProfile = !isEditingProfile;

      if (isEditingProfile) {
        // Switch to EDIT mode
        profileEditBtn.textContent = '저장';
        aiNameInput.disabled = false;
        profileSystemPrompt.disabled = false;
        profileAvatarLarge.classList.add('editable');
        if (changeAvatarBtn) changeAvatarBtn.style.display = 'block';
        setTimeout(() => aiNameInput.focus(), 100);
      } else {
        // Switch to SAVE (View) mode
        saveProfile();
        profileEditBtn.textContent = '편집';
        aiNameInput.disabled = true;
        profileSystemPrompt.disabled = true;
        profileAvatarLarge.classList.remove('editable');
        if (changeAvatarBtn) changeAvatarBtn.style.display = 'none';
      }
    });
  }

  // Allow clicking avatar to change it during editing
  profileAvatarLarge.addEventListener('click', () => {
    if (isEditingProfile && avatarInput) {
      avatarInput.click();
    }
  });

  function saveProfile() {
    const newName = aiNameInput.value.trim() || 'AI Assistant';
    const newPrompt = profileSystemPrompt.value.trim();

    // Get avatar: either DataURL from background-image or text content
    let newAvatar = profileAvatarLarge.textContent;
    if (profileAvatarLarge.style.backgroundImage && profileAvatarLarge.style.backgroundImage !== 'none') {
      newAvatar = profileAvatarLarge.style.backgroundImage.slice(5, -2); // Remove url("")
    }

    localStorage.setItem('ai_name', newName);
    localStorage.setItem('ai_avatar', newAvatar);
    localStorage.setItem('gemini_tts_voice_preset', getSelectedTtsVoicePreset());
    gemini.setSystemPrompt(newPrompt);

    updateAIProfileUI();
    showToast('프로필 정보가 저장되었습니다 ✓');
  }

  if (testVoicePresetBtn) {
    testVoicePresetBtn.addEventListener('click', () => {
      const profileName = (aiNameInput?.value || localStorage.getItem('ai_name') || 'AI Assistant').trim() || 'AI Assistant';
      speakAiMessage(`Hi there! I'm ${profileName}. How are you?`, testVoicePresetBtn);
    });
  }

  if (voicePresetSelect) {
    voicePresetSelect.addEventListener('change', () => {
      localStorage.setItem('gemini_tts_voice_preset', getSelectedTtsVoicePreset());
      aiTtsCache.blobs.clear();
      aiTtsCache.inflight.clear();
      showToast('음성 프리셋이 저장되었습니다 ✓');
    });
  }

  // Change avatar logic (Photo / Emoji)
  if (changeAvatarBtn) {
    changeAvatarBtn.addEventListener('click', () => {
      if (confirm('갤러리에서 사진을 선택하시겠습니까? (취소하면 이모지를 입력할 수 있습니다)')) {
        avatarInput.click();
      } else {
        const emoji = prompt('새로운 아이콘(이모지 등)을 입력하세요:', profileAvatarLarge.textContent || '✦');
        if (emoji) {
          profileAvatarLarge.style.backgroundImage = 'none';
          profileAvatarLarge.textContent = emoji;
        }
      }
    });
  }

  if (avatarInput) {
    avatarInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          profileAvatarLarge.style.backgroundImage = `url(${event.target.result})`;
          profileAvatarLarge.textContent = '';
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // Save model settings
  if (saveSettings) {
    saveSettings.addEventListener('click', () => {
      gemini.setModel(modelSelect.value);
      updateStatus();
      settingsModal.classList.remove('active');
      showToast('모델 설정이 저장되었습니다 ✓');
    });
  }

  // Clear chat
  clearChat.addEventListener('click', () => {
    if (confirm('모든 대화 내역을 삭제하시겠습니까?')) {
      messages = [];
      saveMessages();
      gemini.clearHistory();
      renderMessages();
      showWelcomeMessage();
      settingsModal.classList.remove('active');
      showToast('대화 내역이 삭제되었습니다');
    }
  });

  // Back button -> open conversation list
  clearBtn.addEventListener('click', () => {
    openConversationList();
  });

  if (dictionaryBtn) {
    dictionaryBtn.addEventListener('click', () => {
      openDictionaryPage();
    });
  }

  if (dictionaryBackBtn) {
    dictionaryBackBtn.addEventListener('click', () => {
      closeDictionaryPage();
      openConversationList();
    });
  }

  // Enable Notifications button
  if (enableNotifications) {
    enableNotifications.addEventListener('click', async () => {
      const result = await requestNotificationPermission(true);
      if (result === 'granted') {
        showToast('알림 권한이 승인되었습니다! 🎉');
      } else if (result === 'denied') {
        showToast('알림 권한이 거부되었습니다. 설정에서 변경해주세요.');
      } else if (result === 'unsupported') {
        showToast('이 브라우저는 알림을 지원하지 않습니다.');
      }
    });
  }

  // Test Push button
  if (testPushBtn) {
    testPushBtn.addEventListener('click', async () => {
      showToast('테스트 메시지를 요청 중...');
      try {
        const response = await fetch('/api/cron?test=true');
        const data = await response.json();
        if (data.success) {
          const subCount = data.totalSubscriptions || 0;
          if (subCount === 0) {
            showToast('서버에 등록된 기기가 없습니다. 알림을 다시 활성화해 주세요.');
          } else {
            showToast(`발송 요청 성공!(대상 기기: ${subCount}대)`);
          }
        } else {
          showToast(`실패: ${data.skipped || data.error || '알 수 없는 오류'} `);
        }
      } catch (err) {
        showToast('서버 연결 실패');
      }
    });
  }
}

function renderConversationList() {
  if (!conversationList) return;

  const aiName = localStorage.getItem('ai_name') || 'AI Assistant';
  const aiAvatar = localStorage.getItem('ai_avatar') || '✦';
  const latest = messages[messages.length - 1] || null;

  const preview = latest
    ? (latest.text || '').replace(/\s+/g, ' ').slice(0, 80)
    : '대화를 시작해보세요.';
  const time = latest?.time || '';

  const avatarHtml = aiAvatar.startsWith('data:image')
    ? `<div class="list-avatar list-avatar-image" style="background-image:url('${aiAvatar}')"></div>`
    : `<div class="list-avatar">${escapeHtml(aiAvatar)}</div>`;

  conversationList.innerHTML = `
    <button class="conversation-row" id="conversationRowMain" type="button">
      ${avatarHtml}
      <div class="conversation-content">
        <div class="conversation-top">
          <span class="conversation-name">${escapeHtml(aiName)}</span>
          <span class="conversation-time">${escapeHtml(time)}</span>
        </div>
        <div class="conversation-preview">${escapeHtml(preview)}</div>
      </div>
      <span class="conversation-chevron">›</span>
    </button>
  `;

  const row = document.getElementById('conversationRowMain');
  if (row) {
    row.addEventListener('click', () => closeConversationList());
  }
}

function openConversationList() {
  renderConversationList();
  closeDictionaryPage();
  if (conversationListView) conversationListView.classList.add('active');
  document.body.classList.add('conversation-list-open');
}

function closeConversationList() {
  if (conversationListView) conversationListView.classList.remove('active');
  document.body.classList.remove('conversation-list-open');
}

function setupBackSwipeGesture() {
  if (!appRoot) return;

  const EDGE_START_PX = 64;
  const ACTIVATE_DX = 8;
  const TRIGGER_DX = 52;
  const MAX_SHIFT = 68;

  const resetVisual = (animated = true) => {
    if (!appRoot) return;
    if (animated) {
      appRoot.style.transition = 'transform 0.2s ease';
      appRoot.style.transform = 'translateX(0)';
      window.setTimeout(() => {
        appRoot.style.transition = '';
      }, 220);
      return;
    }
    appRoot.style.transition = '';
    appRoot.style.transform = 'translateX(0)';
  };

  const isBlockedByModal = () => {
    if (conversationListView?.classList.contains('active')) return true;
    if (settingsModal?.classList.contains('active')) return true;
    if (profileModal?.classList.contains('active')) return true;
    if (nativeSheetRefs?.overlay?.classList.contains('active')) return true;
    return false;
  };

  const endGesture = (openList = false) => {
    const shouldOpen = openList && backSwipeState.active && backSwipeState.deltaX >= TRIGGER_DX;
    backSwipeState = { tracking: false, active: false, startX: 0, startY: 0, deltaX: 0 };
    resetVisual(true);
    if (shouldOpen) {
      window.setTimeout(() => openConversationList(), 100);
    }
  };

  window.addEventListener('touchstart', (event) => {
    if (isBlockedByModal()) return;
    if (!event.touches || event.touches.length !== 1) return;

    const touch = event.touches[0];
    if (touch.clientX > EDGE_START_PX) return;

    backSwipeState.tracking = true;
    backSwipeState.active = false;
    backSwipeState.startX = touch.clientX;
    backSwipeState.startY = touch.clientY;
    backSwipeState.deltaX = 0;
  }, { passive: true });

  window.addEventListener('touchmove', (event) => {
    if (!backSwipeState.tracking || !event.touches || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const dx = touch.clientX - backSwipeState.startX;
    const dy = Math.abs(touch.clientY - backSwipeState.startY);

    if (!backSwipeState.active) {
      if (dy > 20 && dy > Math.abs(dx)) {
        endGesture(false);
        return;
      }
      if (dx > ACTIVATE_DX && dx > dy * 1.05) {
        backSwipeState.active = true;
      }
    }

    if (!backSwipeState.active) return;

    event.preventDefault();
    backSwipeState.deltaX = Math.max(0, Math.min(dx, MAX_SHIFT));
    appRoot.style.transition = 'none';
    appRoot.style.transform = `translateX(${backSwipeState.deltaX}px)`;
  }, { passive: false });

  window.addEventListener('touchend', () => endGesture(true), { passive: true });
  window.addEventListener('touchcancel', () => endGesture(false), { passive: true });
}

function inputAreaHeightAdjust() {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
}

function updateSendButton() {
  const hasText = messageInput.value.trim().length > 0;
  if (hasText) {
    sendBtn.classList.add('active');
    voiceBtn.style.display = 'none';
  } else {
    sendBtn.classList.remove('active');
    voiceBtn.style.display = 'flex';
  }
}

// Push Notifications
// ===========================
async function requestNotificationPermission(manual = false) {
  if (!('serviceWorker' in navigator)) {
    console.warn('Service Worker not supported');
    return 'unsupported';
  }

  // On iOS PWA, Notification might be available but 'Notification' in window might be false in some contexts
  // or PushManager might be the primary way to check.
  const hasNotification = 'Notification' in window;
  const hasPush = 'PushManager' in window;

  if (!hasNotification && !hasPush) {
    console.warn('Neither Notification nor PushManager supported');
    return 'unsupported';
  }

  try {
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        await subscribeUserToPush();
        return 'granted';
      }
      return permission;
    } else if (Notification.permission === 'granted') {
      await subscribeUserToPush();
      return 'granted';
    }
    return Notification.permission;
  } catch (err) {
    console.error('Error requesting notification permission:', err);
    if (manual) showToast('알림 요청 중 오류가 발생했습니다.');
    return 'error';
  }
}

async function subscribeUserToPush() {
  try {
    const registration = await navigator.serviceWorker.ready;

    // Get subscription
    let subscription = await registration.pushManager.getSubscription();

    // If no subscription, create one
    if (!subscription) {
      if (!VAPID_PUBLIC_KEY) {
        console.error('VAPID Public Key missing (VITE_VAPID_PUBLIC_KEY). Please check Vercel Env Vars.');
        showToast('서버 설정(VAPID Key)이 누락되었습니다.');
        return;
      }

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }

    // Always send/sync subscription to server
    const response = await fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });

    if (!response.ok) throw new Error('Failed to register subscription on server');

    console.log('Successfully subscribed to Web Push');
  } catch (error) {
    console.error('Failed to subscribe to Web Push:', error);
    showToast('알림 등록에 실패했습니다.');
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ===========================
// Start
// ===========================
init();
