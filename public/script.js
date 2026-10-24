// AI Student Assistant - Client Script
// Supports Normal, Standard RAG, and Agentic RAG Modes

const chatContainer = document.getElementById('chat-container');
const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');
const typingIndicator = document.getElementById('typing-indicator');
const typingText = document.getElementById('typing-text');
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const offlineBanner = document.getElementById('offline-banner');
const suggestionsWrapper = document.getElementById('suggestions-wrapper');
const uploadDrawer = document.getElementById('upload-drawer');
const fileInput = document.getElementById('file-input');
const uploadStatus = document.getElementById('upload-status');
const uploadStatusText = document.getElementById('upload-status-text');
const documentList = document.getElementById('document-list');
const docCountBadge = document.getElementById('doc-count-badge');
const activeModeLabel = document.getElementById('active-mode-label');

let currentMode = 'normal'; // 'normal' | 'rag' | 'agentic'
let isGenerating = false;

// Mode Selection Handler
function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(`mode-${mode}`);
  if (activeBtn) activeBtn.classList.add('active');

  const modeDescriptions = {
    normal: 'Normal Chat (Llama 3.2)',
    rag: 'RAG Chat (Grounded in Study Notes)',
    agentic: 'Agentic RAG (Multi-Step Reasoning & Query Rewriting)'
  };
  activeModeLabel.textContent = modeDescriptions[mode] || 'Normal Chat';

  if (mode === 'rag' || mode === 'agentic') {
    // Show upload drawer if no docs uploaded yet
    const count = parseInt(docCountBadge.textContent, 10) || 0;
    if (count === 0 && uploadDrawer.classList.contains('hidden')) {
      toggleUploadDrawer();
    }
  }
}

// Toggle Upload Drawer
function toggleUploadDrawer() {
  uploadDrawer.classList.toggle('hidden');
}

function triggerFileInput() {
  fileInput.click();
}

// Handle File Selected for Upload
async function handleFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.pdf')) {
    alert('Please select a valid PDF file.');
    fileInput.value = '';
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    alert('File is too large. Maximum supported PDF size is 10 MB.');
    fileInput.value = '';
    return;
  }

  uploadStatus.classList.remove('hidden');
  uploadStatusText.textContent = `Reading & embedding "${file.name}" with nomic-embed-text...`;

  try {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Data = e.target.result;
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          base64Data: base64Data
        })
      });

      const data = await res.json();
      uploadStatus.classList.add('hidden');
      fileInput.value = '';

      if (res.ok) {
        loadDocumentList();
        appendMessage('assistant', `✅ **${file.name}** was successfully indexed! (${data.document.numPages} pages, ${data.document.numChunks} study chunks). You can now ask questions in **RAG** or **Agentic RAG** mode.`);
      } else {
        alert(data.error || 'Failed to upload document.');
      }
    };
    reader.readAsDataURL(file);
  } catch (err) {
    uploadStatus.classList.add('hidden');
    alert('Failed to read file: ' + err.message);
  }
}

// Fetch and Render Uploaded Documents
async function loadDocumentList() {
  try {
    const res = await fetch('/api/documents');
    const data = await res.json();
    const docs = data.documents || [];
    docCountBadge.textContent = docs.length;

    if (docs.length === 0) {
      documentList.innerHTML = '<p class="empty-docs-msg">No study notes uploaded yet. Upload a PDF above to enable RAG answers!</p>';
    } else {
      documentList.innerHTML = docs.map(doc => `
        <div class="doc-item">
          <div class="doc-name">
            📄 ${doc.fileName}
            <span class="doc-meta">(${doc.numPages} pgs • ${doc.numChunks} chunks)</span>
          </div>
          <button class="doc-delete-btn" title="Delete document" onclick="deleteDocument('${doc.fileName}')">✕</button>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Failed to load documents:', err);
  }
}

// Delete Document
async function deleteDocument(fileName) {
  if (!confirm(`Are you sure you want to remove "${fileName}" from your indexed notes?`)) return;

  try {
    const res = await fetch('/api/documents', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName })
    });
    if (res.ok) {
      loadDocumentList();
    }
  } catch (err) {
    alert('Failed to delete document: ' + err.message);
  }
}

// Format basic Markdown into safe HTML
function formatMarkdown(text) {
  if (!text) return '';

  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Bold (**text**)
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Inline code (`code`)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bullet points
  const lines = html.split('\n');
  let inList = false;
  let formattedLines = [];

  for (let line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('* ') || trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      if (!inList) {
        formattedLines.push('<ul>');
        inList = true;
      }
      formattedLines.push(`<li>${trimmed.substring(2)}</li>`);
    } else if (/^\d+\.\s/.test(trimmed)) {
      if (!inList) {
        formattedLines.push('<ol>');
        inList = true;
      }
      formattedLines.push(`<li>${trimmed.replace(/^\d+\.\s*/, '')}</li>`);
    } else {
      if (inList) {
        formattedLines.push('</ul>');
        inList = false;
      }
      if (trimmed.length > 0) {
        formattedLines.push(`<p>${line}</p>`);
      }
    }
  }

  if (inList) {
    formattedLines.push('</ul>');
  }

  return formattedLines.join('');
}

// Append a message to the chat view
function appendMessage(sender, text, isError = false, meta = {}) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${sender}`;

  const avatarDiv = document.createElement('div');
  avatarDiv.className = 'avatar';
  avatarDiv.textContent = sender === 'user' ? '🎒' : '🤖';

  const bubbleDiv = document.createElement('div');
  bubbleDiv.className = `bubble ${isError ? 'error-bubble' : ''}`;

  if (sender === 'user') {
    bubbleDiv.textContent = text;
  } else {
    // Mode tag for assistant responses
    let modeTagHtml = '';
    if (meta.mode && !isError) {
      const modeNames = {
        normal: '💬 Normal Mode',
        rag: '📖 Standard RAG',
        agentic: '🧠 Agentic RAG'
      };
      modeTagHtml = `<div class="bubble-mode-tag ${meta.mode}">${modeNames[meta.mode] || meta.mode}</div>`;
    }

    let mainHtml = formatMarkdown(text);

    // Citations section
    let citationsHtml = '';
    if (meta.sources && meta.sources.length > 0) {
      citationsHtml = `
        <div class="citations-box">
          <div class="citations-header">📚 Sources Cited:</div>
          <div class="citations-list">
            ${meta.sources.map(s => `
              <span class="citation-pill" title="${s.snippet || ''}">
                📄 ${s.fileName} (Page ${s.pageNumber})
              </span>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Agent Reasoning Trace section
    let traceHtml = '';
    if (meta.trace && meta.trace.length > 0) {
      const traceId = 'trace-' + Date.now();
      traceHtml = `
        <div class="trace-container">
          <div class="trace-header" onclick="document.getElementById('${traceId}').classList.toggle('hidden')">
            <span>🔍 Agent Reasoning Trace (${meta.trace.length} steps)</span>
            <span>▾</span>
          </div>
          <div id="${traceId}" class="trace-body">
            ${meta.trace.map(t => `
              <div class="trace-step">
                <span class="step-num">${t.step}</span>
                <div class="step-content">
                  <strong>${t.action}:</strong> <span>${t.detail}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    bubbleDiv.innerHTML = modeTagHtml + mainHtml + citationsHtml + traceHtml;
  }

  messageDiv.appendChild(avatarDiv);
  messageDiv.appendChild(bubbleDiv);

  chatContainer.appendChild(messageDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Check Ollama status with backend
async function checkOllamaConnection() {
  statusBadge.className = 'status-badge checking';
  statusText.textContent = 'Checking Ollama...';

  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    if (data.running) {
      statusBadge.className = 'status-badge online';
      statusText.textContent = `Online • ${data.activeModel || 'Llama 3.2'}`;
      offlineBanner.classList.add('hidden');
      return true;
    } else {
      markOffline();
      return false;
    }
  } catch (err) {
    markOffline();
    return false;
  }
}

function markOffline() {
  statusBadge.className = 'status-badge offline';
  statusText.textContent = 'Ollama Offline';
  offlineBanner.classList.remove('hidden');
}

// Send user question to server
async function sendQuestion(question) {
  if (!question || isGenerating) return;

  isGenerating = true;
  userInput.disabled = true;
  sendButton.disabled = true;

  if (suggestionsWrapper) {
    suggestionsWrapper.style.display = 'none';
  }

  appendMessage('user', question);

  // Update typing indicator according to mode
  if (currentMode === 'agentic') {
    typingText.textContent = 'Agent is analyzing, evaluating & synthesizing...';
  } else if (currentMode === 'rag') {
    typingText.textContent = 'Searching study notes with nomic-embed-text...';
  } else {
    typingText.textContent = 'Llama 3.2 is thinking...';
  }

  typingIndicator.classList.remove('hidden');
  chatContainer.scrollTop = chatContainer.scrollHeight;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: question,
        mode: currentMode
      })
    });

    const data = await res.json();
    typingIndicator.classList.add('hidden');

    if (res.ok && data.reply) {
      appendMessage('assistant', data.reply, false, {
        mode: data.mode || currentMode,
        sources: data.sources || [],
        trace: data.trace || []
      });
      statusBadge.className = 'status-badge online';
      offlineBanner.classList.add('hidden');
    } else {
      const errMsg = data.error || 'Sorry, could not generate an answer right now.';
      appendMessage('assistant', `⚠️ ${errMsg}`, true);
      if (data.offline) markOffline();
    }
  } catch (err) {
    typingIndicator.classList.add('hidden');
    appendMessage(
      'assistant',
      '⚠️ Connection error. Please make sure the local server is running and Ollama is active on your computer.',
      true
    );
    markOffline();
  } finally {
    isGenerating = false;
    userInput.disabled = false;
    sendButton.disabled = false;
    userInput.value = '';
    userInput.focus();
  }
}

// Handle Form Submit
function handleFormSubmit(event) {
  event.preventDefault();
  const text = userInput.value.trim();
  if (text) {
    sendQuestion(text);
  }
}

// Quick Prompt Chips
function askQuickPrompt(promptText) {
  userInput.value = promptText;
  sendQuestion(promptText);
}

// Initial checks on page load
window.addEventListener('DOMContentLoaded', () => {
  checkOllamaConnection();
  loadDocumentList();
  userInput.focus();
  setInterval(checkOllamaConnection, 20000);
});
