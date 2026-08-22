/**
 * chatbot.js — Asistente de compra dentro del probador (Opción A del roadmap)
 *
 * Este widget es intencionalmente independiente del resto de la app: no
 * importa nada de app.js/ui.js y solo lee contexto opcional desde
 * window.NovafitState (ver app.js). Así, si mañana quieres reusar este
 * mismo widget en OTRA página (por ejemplo la landing de ventas con el
 * chatbot B), puedes copiar este archivo casi tal cual.
 *
 * Backend: un flujo de n8n expuesto como Webhook. Ver README sección
 * "Chatbot del probador" para las instrucciones de cómo armarlo.
 */

// ⚠️ Reemplaza esto por la URL real de tu Webhook de n8n (Production URL,
// no la de test) una vez que hayas armado el flujo — ver README.
const N8N_WEBHOOK_URL = 'https://juanjolb95.app.n8n.cloud/webhook/novafit-chat';

const SESSION_KEY = 'novafit_chat_session_id';

function getSessionId() {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = 'sess_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

class ChatWidget {
  constructor() {
    this.sessionId = getSessionId();
    this.open = false;
    this.sending = false;
    this._buildDom();
    this._bindEvents();
  }

  _buildDom() {
    this.root = document.createElement('div');
    this.root.className = 'novafit-chat-root';
    this.root.innerHTML = `
      <button class="novafit-chat-bubble" aria-label="Abrir asistente de compra">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </button>
      <div class="novafit-chat-panel hidden">
        <div class="novafit-chat-header">
          <div>
            <strong>Asistente Novafit</strong>
            <span>Pregúntame sobre tallas, colores o cómo usar el probador</span>
          </div>
          <button class="novafit-chat-close" aria-label="Cerrar chat">✕</button>
        </div>
        <div class="novafit-chat-messages"></div>
        <form class="novafit-chat-input-row">
          <input type="text" placeholder="Escribe tu pregunta..." maxlength="500" autocomplete="off" />
          <button type="submit" aria-label="Enviar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </form>
      </div>
    `;
    document.body.appendChild(this.root);

    this.bubbleBtn = this.root.querySelector('.novafit-chat-bubble');
    this.panel = this.root.querySelector('.novafit-chat-panel');
    this.closeBtn = this.root.querySelector('.novafit-chat-close');
    this.messagesEl = this.root.querySelector('.novafit-chat-messages');
    this.form = this.root.querySelector('.novafit-chat-input-row');
    this.input = this.root.querySelector('input');

    this._addMessage(
      'bot',
      '¡Hola! Soy el asistente de Novafit. Puedo ayudarte con tallas, colores disponibles, o cómo usar el probador virtual. ¿En qué te ayudo?'
    );
  }

  _bindEvents() {
    this.bubbleBtn.addEventListener('click', () => this.toggle());
    this.closeBtn.addEventListener('click', () => this.toggle(false));
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this._send();
    });
  }

  toggle(force) {
    this.open = typeof force === 'boolean' ? force : !this.open;
    this.panel.classList.toggle('hidden', !this.open);
    if (this.open) this.input.focus();
  }

  _addMessage(role, text) {
    const el = document.createElement('div');
    el.className = `novafit-chat-msg novafit-chat-msg-${role}`;
    el.textContent = text;
    this.messagesEl.appendChild(el);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    return el;
  }

  async _send() {
    const text = this.input.value.trim();
    if (!text || this.sending) return;

    this._addMessage('user', text);
    this.input.value = '';
    this.sending = true;
    const typingEl = this._addMessage('bot', '...');

    const garment = window.NovafitState?.selectedGarment;

    try {
      const res = await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionId: this.sessionId,
          context: {
            page: 'probador',
            selectedGarment: garment ? { id: garment.id, name: garment.name, color: garment.color } : null,
          },
        }),
      });

      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const data = await res.json();
      const reply = data.reply || data.output || data.message;
      typingEl.textContent = reply || 'No obtuve respuesta del asistente, intenta de nuevo.';
    } catch (err) {
      typingEl.textContent =
        'No pude conectar con el asistente. Si eres el administrador: revisa que N8N_WEBHOOK_URL en js/chatbot.js apunte a tu Webhook de producción y que el flujo esté activo.';
      console.error('Chatbot error:', err);
    } finally {
      this.sending = false;
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new ChatWidget();
});
