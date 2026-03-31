let currentSessionId = null;
let isGenerating = false;
let lastUserMessage = "";

// --- SVG ICON LIBRARY ---
const ICONS = {
    copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="#00FF41" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    play: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`,
    stop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>`,
    regenerate: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>`,
    leftArrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>`,
    rightArrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>`,
    send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`,
    attach: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>`
};

window.onload = async () => {
    // Inject Icons into existing static HTML
    document.querySelector('.send-btn').innerHTML = ICONS.send;
    document.querySelector('.attach-btn').innerHTML = ICONS.attach;

    // --- AUTO-EXPANDING TEXTAREA LOGIC ---
    const userInput = document.getElementById('userInput');
    userInput.addEventListener('input', function() {
        this.style.height = '24px'; // Reset briefly to calculate shrinkage
        this.style.height = (this.scrollHeight) + 'px'; // Expand to fit text
        
        // Add scrollbar only if it hits max-height (200px)
        if (this.scrollHeight >= 200) {
            this.style.overflowY = 'auto'; 
        } else {
            this.style.overflowY = 'hidden';
        }
    });

    const res = await fetch('/api/check_config');
    const data = await res.json();
    
    if (data.has_config) {
        await startNewChat(); 
    } else {
        document.getElementById('onboardingModal').style.display = 'flex';
    }
};

async function submitConfig() {
    const btn = document.getElementById('saveBtn');
    const errorMsg = document.getElementById('keyError');
    const base_url = document.getElementById('apiUrlInput').value.trim();
    const model = document.getElementById('apiModelInput').value.trim();
    const api_key = document.getElementById('apiKeyInput').value.trim();

    btn.innerText = "Validating Connection...";
    btn.disabled = true;

    try {
        const res = await fetch('/api/save_config', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base_url, model, api_key })
        });
        const data = await res.json();
        
        if (data.success) {
            document.getElementById('onboardingModal').style.display = 'none';
            await startNewChat();
        } else {
            errorMsg.innerText = data.error || "Invalid configuration.";
            errorMsg.style.display = 'block';
        }
    } catch (err) {
        errorMsg.innerText = "Connection error to Backend.";
        errorMsg.style.display = 'block';
    } finally {
        btn.innerText = "Verify & Initialize";
        btn.disabled = false;
    }
}

function handleEnter(e) {
    // Send message on Enter, but allow Shift+Enter for new lines
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMsg();
    }
}

async function startNewChat() {
    const chatBox = document.getElementById('chat');
    chatBox.innerHTML = ''; 
    window.speechSynthesis.cancel(); // Stop speaking on new chat
    try {
        const res = await fetch('/api/new_session', { method: 'POST' });
        const data = await res.json();
        currentSessionId = data.session_id;
        appendMsg("Hello. I am missyou.ai. Core systems online. How can we level up your skills today?", 'bot', false);
    } catch (err) {
        console.error("Failed to start session:", err);
    }
}

async function sendMsg(overrideText = null) {
    if (isGenerating) return;
    const input = document.getElementById('userInput');
    const text = overrideText || input.value.trim();
    if (!text || !currentSessionId) return;

    lastUserMessage = text;
    appendMsg(text, 'user');
    input.value = '';
    
    // --- Reset box height after sending ---
    input.style.height = '24px';
    input.style.overflowY = 'hidden';

    isGenerating = true;

    const loadingId = 'loading-' + Date.now();
    appendMsg("Thinking...", 'bot', false, loadingId);

    try {
        const res = await fetch('/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, session_id: currentSessionId })
        });
        const data = await res.json();
        document.getElementById(loadingId).remove();
        
        if (data.error) appendMsg("Error: " + data.error, 'bot', false);
        else appendMsg(data.reply, 'bot', true);
    } catch (err) {
        document.getElementById(loadingId).remove();
        appendMsg("Connection lost.", 'bot', false);
    } finally {
        isGenerating = false;
    }
}

function appendMsg(text, sender, addActions = false, specificId = null) {
    const chat = document.getElementById('chat');
    const msgDiv = document.createElement('div');
    msgDiv.className = `msg ${sender}`;
    if (specificId) msgDiv.id = specificId;
    
    if (sender === 'bot') {
        // Store versions inside the HTML element for ChatGPT style toggling
        msgDiv.dataset.versions = JSON.stringify([text]);
        msgDiv.dataset.currentVersion = "0";
        
        let html = `<div class="bubble">${marked.parse(text)}</div>`;
        if (addActions) {
            html += `
            <div class="action-bar">
                <div class="version-control" style="display:none;">
                    <button class="vc-btn" onclick="changeVersion(this, -1)" title="Previous Version">${ICONS.leftArrow}</button>
                    <span class="version-label">1 / 1</span>
                    <button class="vc-btn" onclick="changeVersion(this, 1)" title="Next Version">${ICONS.rightArrow}</button>
                </div>
                <button class="action-btn" onclick="copyText(this)" title="Copy Text">${ICONS.copy}</button>
                <button class="action-btn play-btn" onclick="toggleSpeak(this)" title="Listen">${ICONS.play}</button>
                <button class="action-btn" onclick="regenerateLast(this)" title="Regenerate">${ICONS.regenerate}</button>
            </div>`;
        }
        msgDiv.innerHTML = html;
    } else {
        msgDiv.innerHTML = `<div class="bubble">${text.replace(/\n/g, '<br>')}</div>`;
    }
    
    chat.appendChild(msgDiv);
    chat.scrollTop = chat.scrollHeight; 
}

// --- VERSION CONTROL LOGIC ---
async function regenerateLast(btn) {
    if (isGenerating) return;
    const msgDiv = btn.closest('.msg.bot');
    const bubble = msgDiv.querySelector('.bubble');
    const originalHtml = bubble.innerHTML;

    bubble.innerHTML = "<em>Regenerating response...</em>";
    isGenerating = true;

    try {
        const res = await fetch('/api/regenerate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: currentSessionId })
        });
        const data = await res.json();

        if (data.error) {
            bubble.innerHTML = originalHtml;
            alert(data.error);
        } else {
            let versions = JSON.parse(msgDiv.dataset.versions);
            versions.push(data.reply); 
            msgDiv.dataset.versions = JSON.stringify(versions);
            msgDiv.dataset.currentVersion = versions.length - 1;
            renderVersion(msgDiv);
        }
    } catch (err) {
        bubble.innerHTML = originalHtml;
        alert("Connection lost during regeneration.");
    } finally {
        isGenerating = false;
    }
}

function renderVersion(msgDiv) {
    let versions = JSON.parse(msgDiv.dataset.versions);
    let curr = parseInt(msgDiv.dataset.currentVersion);
    
    let bubble = msgDiv.querySelector('.bubble');
    bubble.innerHTML = marked.parse(versions[curr]);

    let vc = msgDiv.querySelector('.version-control');
    let vLabel = msgDiv.querySelector('.version-label');
    
    if (versions.length > 1) {
        vc.style.display = 'flex';
        vLabel.innerText = `${curr + 1} / ${versions.length}`;
    }
}

function changeVersion(btn, dir) {
    const msgDiv = btn.closest('.msg.bot');
    let versions = JSON.parse(msgDiv.dataset.versions);
    let curr = parseInt(msgDiv.dataset.currentVersion);
    
    curr += dir;
    if (curr < 0) curr = 0;
    if (curr >= versions.length) curr = versions.length - 1;
    
    msgDiv.dataset.currentVersion = curr;
    renderVersion(msgDiv);
}

// --- UTILITIES ---
function copyText(btn) {
    const bubble = btn.closest('.msg.bot').querySelector('.bubble');
    navigator.clipboard.writeText(bubble.innerText).then(() => {
        btn.innerHTML = ICONS.check;
        setTimeout(() => btn.innerHTML = ICONS.copy, 2000);
    });
}

function toggleSpeak(btn) {
    // If it's already speaking, stop it and reset the icon
    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        btn.innerHTML = ICONS.play;
        return;
    }

    const msgDiv = btn.closest('.msg.bot');
    const versions = JSON.parse(msgDiv.dataset.versions);
    const curr = parseInt(msgDiv.dataset.currentVersion);
    
    // Strip out code blocks so it doesn't read raw syntax
    const textToRead = versions[curr].replace(/```[\s\S]*?```/g, ' Code block omitted for audio. ');
    
    const utterance = new SpeechSynthesisUtterance(textToRead);
    
    // Reset the icon back to 'Play' when the audio naturally finishes
    utterance.onend = () => {
        btn.innerHTML = ICONS.play;
    };

    const voices = window.speechSynthesis.getVoices();
    const goodVoice = voices.find(v => v.name.includes('Google US English') || v.name.includes('Samantha') || v.name.includes('Female'));
    if (goodVoice) utterance.voice = goodVoice;
    
    // Change icon to 'Stop' (Square)
    btn.innerHTML = ICONS.stop;
    window.speechSynthesis.speak(utterance);
}
// --- STAGE 4: FILE UPLOAD LOGIC ---
async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file || !currentSessionId) return;

    // Show a loading bubble for the upload
    const loadingId = 'upload-' + Date.now();
    appendMsg(`Assimilating ${file.name}...`, 'bot', false, loadingId);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('session_id', currentSessionId);

    try {
        const res = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        document.getElementById(loadingId).remove();
        
        if (data.error) appendMsg("Assimilation failed: " + data.error, 'bot', false);
        else appendMsg(data.message, 'bot', false);
    } catch (err) {
        document.getElementById(loadingId).remove();
        appendMsg("Connection error during upload.", 'bot', false);
    }
}