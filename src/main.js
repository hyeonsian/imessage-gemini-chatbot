import './style.css';
import { GeminiAPI } from './gemini.js';

// ===========================
// App State
// ===========================
const gemini = new GeminiAPI();
let messages = JSON.parse(localStorage.getItem('chat_messages') || '[]');
let isProcessing = false;

// ===========================
// DOM Elements
// ===========================
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const modalClose = document.getElementById('modalClose');
const modelSelect = document.getElementById('modelSelect');
const saveSettings = document.getElementById('saveSettings');
const clearChat = document.getElementById('clearChat');
const clearBtn = document.getElementById('clearBtn');
const contactName = document.getElementById('contactName');
const contactStatus = document.getElementById('contactStatus');
const enableNotifications = document.getElementById('enableNotifications');
const voiceBtn = document.getElementById('voiceBtn');
const splash = document.getElementById('splash');

// Profile Modal Elements
const headerProfile = document.getElementById('headerProfile');
const profileModal = document.getElementById('profileModal');
const profileClose = document.getElementById('profileClose');
const aiNameInput = document.getElementById('aiNameInput');
const profileSystemPrompt = document.getElementById('profileSystemPrompt');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const changeAvatarBtn = document.getElementById('changeAvatarBtn');
const avatarInput = document.getElementById('avatarInput');
const headerAvatar = document.getElementById('headerAvatar');
const profileAvatarLarge = document.getElementById('profileAvatarLarge');

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

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
  renderMessages();
  loadSettings();
  setupEventListeners();
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
        const aiMsg = { role: 'ai', text, time };
        messages.push(aiMsg);
        appendMessageBubble('ai', text, time);
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
    contactStatus.textContent = `${getModelName(gemini.model)}`;
  } else {
    contactStatus.textContent = '데모 모드';
  }
}

function updateAIProfileUI() {
  const aiName = localStorage.getItem('ai_name') || 'AI Assistant';
  const aiAvatar = localStorage.getItem('ai_avatar') || '✦';

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
  // Keep date divider
  chatMessages.innerHTML = '<div class="date-divider"><span>오늘</span></div>';

  messages.forEach(msg => {
    appendMessageBubble(msg.role, msg.text, msg.time, false);
  });

  scrollToBottom();
}

function appendMessageBubble(role, text, time, animate = true, translation = null) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${role === 'user' ? 'sent' : 'received'}`;
  if (!animate) msgDiv.style.animation = 'none';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = formatMessage(text);

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
      }, 400); // Match CSS transition timing
    });
  }

  const timeEl = document.createElement('div');
  timeEl.className = 'message-time';
  timeEl.textContent = time || formatTime(new Date());

  msgDiv.appendChild(bubble);
  msgDiv.appendChild(timeEl);
  chatMessages.appendChild(msgDiv);

  if (animate) scrollToBottom();
}

function formatMessage(text) {
  // Simple markdown-to-html (paragraphs, bold,-lists)
  return text
    .replace(/\r\n|\r|\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\- (.*)/gm, '• $1');
}

function formatTime(date) {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
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

// ===========================
// Chat Logic
// ===========================
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || isProcessing) return;

  // Add user message to state
  const time = formatTime(new Date());
  messages.push({ role: 'user', text, time });

  // UI updates
  removeWelcomeMessage();
  appendMessageBubble('user', text, time);
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

    messages.push({ role: 'ai', text: response, time: aiTime, translation });
    appendMessageBubble('ai', response, aiTime, true, translation);
    saveMessages();

    // Notification request after first message
    if (messages.length === 2) {
      setTimeout(() => requestNotificationPermission(), 1000);
    }
  } catch (error) {
    removeTypingIndicator(typingIndicator);
    appendMessageBubble('system', `에러가 발생했습니다: ${error.message}`, formatTime(new Date()));
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
}

function loadSettings() {
  modelSelect.value = gemini.model;
}

// ===========================
// Event Listeners
// ===========================
function setupEventListeners() {
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

  // Save profile and persona
  if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', () => {
      const newName = aiNameInput.value.trim() || 'AI Assistant';
      const newPrompt = profileSystemPrompt.value.trim();

      // Get avatar: either DataURL from background-image or text content
      let newAvatar = profileAvatarLarge.textContent;
      if (profileAvatarLarge.style.backgroundImage && profileAvatarLarge.style.backgroundImage !== 'none') {
        newAvatar = profileAvatarLarge.style.backgroundImage.slice(5, -2); // Remove url("")
      }

      localStorage.setItem('ai_name', newName);
      localStorage.setItem('ai_avatar', newAvatar);
      gemini.setSystemPrompt(newPrompt);

      updateAIProfileUI();
      profileModal.classList.remove('active');
      showToast('프로필 정보가 저장되었습니다 ✓');
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

  // Clear button (+ button)
  clearBtn.addEventListener('click', () => {
    if (messages.length > 0 && confirm('새 대화를 시작하시겠습니까?')) {
      messages = [];
      saveMessages();
      gemini.clearHistory();
      renderMessages();
      showWelcomeMessage();
      showToast('새 대화가 시작되었습니다');
    }
  });

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
            showToast(`발송 요청 성공! (대상 기기: ${subCount}대)`);
          }
        } else {
          showToast(`실패: ${data.skipped || data.error || '알 수 없는 오류'}`);
        }
      } catch (err) {
        showToast('서버 연결 실패');
      }
    });
  }
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
