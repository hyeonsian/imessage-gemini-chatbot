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
const systemPrompt = document.getElementById('systemPrompt');
const saveSettings = document.getElementById('saveSettings');
const clearChat = document.getElementById('clearChat');
const clearBtn = document.getElementById('clearBtn');
const contactStatus = document.getElementById('contactStatus');

// ===========================
// Initialize
// ===========================
function init() {
  renderMessages();
  loadSettings();
  setupEventListeners();
  updateStatus();

  if (messages.length === 0) {
    showWelcomeMessage();
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
      ? 'Gemini API가 연결되었습니다.<br>아무 메시지나 보내서 대화를 시작해보세요!'
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

function appendMessageBubble(role, text, time, animate = true) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${role === 'user' ? 'sent' : 'received'}`;
  if (!animate) msgDiv.style.animation = 'none';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = formatMessage(text);

  const timeEl = document.createElement('div');
  timeEl.className = 'message-time';
  timeEl.textContent = time || formatTime(new Date());

  msgDiv.appendChild(bubble);
  msgDiv.appendChild(timeEl);
  chatMessages.appendChild(msgDiv);
}

function formatMessage(text) {
  // Simple markdown parsing
  let html = escapeHtml(text);

  // Code blocks
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  return html;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(date) {
  return date.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}

// ===========================
// Typing Indicator
// ===========================
function showTypingIndicator() {
  const existing = document.getElementById('typingMsg');
  if (existing) return;

  const typingDiv = document.createElement('div');
  typingDiv.className = 'message received';
  typingDiv.id = 'typingMsg';
  typingDiv.innerHTML = `
    <div class="typing-indicator">
      <div class="dot"></div>
      <div class="dot"></div>
      <div class="dot"></div>
    </div>
  `;
  chatMessages.appendChild(typingDiv);
  scrollToBottom();
}

function hideTypingIndicator() {
  const el = document.getElementById('typingMsg');
  if (el) el.remove();
}

// ===========================
// Send Message
// ===========================
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || isProcessing) return;

  // Remove welcome message if present
  const welcome = document.getElementById('welcomeMsg');
  if (welcome) welcome.remove();

  isProcessing = true;
  const time = formatTime(new Date());

  // Add user message
  const userMsg = { role: 'user', text, time };
  messages.push(userMsg);
  appendMessageBubble('user', text, time);
  saveMessages();
  scrollToBottom();

  // Clear input
  messageInput.value = '';
  messageInput.style.height = 'auto';
  updateSendButton();

  // Show typing indicator
  contactStatus.textContent = '입력 중...';
  showTypingIndicator();

  try {
    const response = await gemini.sendMessage(text);
    hideTypingIndicator();

    const aiTime = formatTime(new Date());
    const aiMsg = { role: 'ai', text: response, time: aiTime };
    messages.push(aiMsg);
    appendMessageBubble('ai', response, aiTime);
    saveMessages();
    scrollToBottom();
  } catch (error) {
    hideTypingIndicator();
    showToast(error.message);
  } finally {
    isProcessing = false;
    updateStatus();
  }
}

// ===========================
// Storage
// ===========================
function saveMessages() {
  localStorage.setItem('chat_messages', JSON.stringify(messages));
}

function loadSettings() {
  modelSelect.value = gemini.model;
  systemPrompt.value = gemini.systemPrompt;
}

// ===========================
// Toast
// ===========================
function showToast(message) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
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
// Event Listeners
// ===========================
function setupEventListeners() {
  // Send button
  sendBtn.addEventListener('click', sendMessage);

  // Enter to send (Shift+Enter for newline)
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    updateSendButton();
  });

  // Settings modal
  settingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('active');
    loadSettings();
  });

  modalClose.addEventListener('click', () => {
    settingsModal.classList.remove('active');
  });

  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.classList.remove('active');
    }
  });

  // Save settings
  saveSettings.addEventListener('click', () => {
    gemini.setModel(modelSelect.value);
    gemini.setSystemPrompt(systemPrompt.value.trim());
    updateStatus();
    settingsModal.classList.remove('active');
    showToast('설정이 저장되었습니다 ✓');
  });

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
}

function updateSendButton() {
  sendBtn.disabled = messageInput.value.trim().length === 0;
}

// ===========================
// Start
// ===========================
init();
