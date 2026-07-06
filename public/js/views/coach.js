// Coach: streaming chat with the AI trainer that can see your live stats.
import { h, todayStr, vibrate } from '../util.js';
import { api, chatStream } from '../api.js';
import { ico, toast, confirmSheet } from '../ui.js';
import { App } from '../main.js';

const SUGGESTIONS = [
  'What should I eat tonight to hit my protein?',
  'Plan tomorrow’s workout for me',
  'How is my week looking so far?',
  'I only have 25 minutes — give me a session',
  'Why does my squat feel weak at the bottom?',
];

// Tiny safe markdown-ish renderer (bold + bullet lines only, all via textContent)
function renderRich(el, text) {
  el.replaceChildren();
  for (const rawLine of text.split('\n')) {
    if (!rawLine.trim()) { el.append(h('div', { style: { height: '8px' } })); continue; }
    const line = h('div', {});
    let content = rawLine;
    if (/^\s*[-•*]\s+/.test(rawLine)) {
      content = rawLine.replace(/^\s*[-•*]\s+/, '');
      line.style.paddingLeft = '14px';
      line.style.textIndent = '-10px';
      line.append('• ');
    }
    const parts = content.split(/\*\*(.+?)\*\*/g);
    parts.forEach((p, i) => {
      if (i % 2 === 1) line.append(h('b', {}, p));
      else if (p) line.append(p);
    });
    el.append(line);
  }
}

export async function renderCoach(root) {
  const view = h('div', { class: 'view' });
  root.replaceChildren(view);

  const ai = App.boot.settings.ai;
  view.append(h('div', { class: 'vhead' },
    h('div', {}, h('h1', {}, 'Coach'), h('div', { class: 'sub' }, ai.hasKey ? 'Knows your stats. Has opinions.' : 'Your AI trainer')),
    h('div', { class: 'vhead-actions' },
      h('button', { class: 'btn btn--icon', title: 'Clear chat', onclick: async () => {
        const ok = await confirmSheet({ title: 'Clear conversation?', confirmLabel: 'Clear', danger: true });
        if (ok) { await api('/ai/history', { method: 'DELETE' }); renderCoach(root); }
      } }, ico('trash')))));

  if (!ai.hasKey) {
    view.append(h('div', { class: 'card card--accent center', style: { padding: '30px 20px' } },
      h('div', { style: { color: 'var(--accent)', display: 'flex', justifyContent: 'center', marginBottom: '12px' } }, ico('sparkles', 34)),
      h('h3', {}, 'Meet your coach'),
      h('p', { class: 'hint', style: { margin: '8px 0 16px', lineHeight: 1.55 } },
        'A trainer who has actually read your logs — meals, lifts, weigh-ins, streaks — and answers like a friend who knows their stuff. Add your Anthropic API key to wake them up.'),
      h('button', { class: 'btn btn--primary', onclick: () => App.go('#/settings') }, 'Set up AI')));
    return;
  }

  const scroll = h('div', { class: 'chat-scroll' });
  view.append(scroll);

  const toBottom = () => requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));

  const addBubble = (role, text = '') => {
    const b = h('div', { class: `bubble ${role === 'user' ? 'me' : 'coach'}` });
    if (role === 'user') b.textContent = text;
    else renderRich(b, text);
    scroll.append(b);
    toBottom();
    return b;
  };

  // History
  try {
    const hist = await api('/ai/history');
    if (!hist.messages.length) {
      scroll.append(h('div', { class: 'card', style: { border: 'none', background: 'transparent', textAlign: 'center', padding: '18px 6px' } },
        h('p', { class: 'muted small', style: { marginBottom: '12px' } }, 'Ask anything — training, food, recovery. I can see today’s numbers.'),
        h('div', { class: 'chips', style: { justifyContent: 'center' } },
          ...SUGGESTIONS.slice(0, 3).map((s) => h('button', { class: 'chip', onclick: () => send(s) }, s)))));
    }
    for (const m of hist.messages) addBubble(m.role === 'user' ? 'user' : 'coach', m.content);
  } catch (e) { toast(e.message, 'bad'); }

  // Input bar
  const ta = h('textarea', { placeholder: 'Message your coach…', rows: 1 });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(130, ta.scrollHeight) + 'px'; });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); send(ta.value); }
  });
  const sendBtn = h('button', { class: 'chat-send', onclick: () => send(ta.value) }, ico('send'));
  const bar = h('div', { class: 'chat-inputbar' }, ta, sendBtn);
  view.append(bar);

  let busy = false;
  async function send(text) {
    const msg = (text || '').trim();
    if (!msg || busy) return;
    busy = true;
    sendBtn.disabled = true;
    ta.value = '';
    ta.style.height = 'auto';
    vibrate(8);
    addBubble('user', msg);

    const coachBubble = h('div', { class: 'bubble coach' }, h('span', { class: 'typing' }, h('i'), h('i'), h('i')));
    scroll.append(coachBubble);
    toBottom();

    let acc = '';
    let gotFirst = false;
    await chatStream(msg, todayStr(), {
      onDelta: (delta) => {
        if (!gotFirst) { gotFirst = true; }
        acc += delta;
        renderRich(coachBubble, acc);
        toBottom();
      },
      onError: (err) => {
        coachBubble.replaceChildren();
        coachBubble.append(h('span', { style: { color: 'var(--danger)' } }, err.message || 'Something went wrong.'));
        if (err.code === 'no_key' || err.code === 'bad_key') {
          coachBubble.append(h('div', { class: 'mt-8' },
            h('button', { class: 'btn btn--soft btn--sm', onclick: () => App.go('#/settings') }, 'Open Settings')));
        }
      },
      onDone: () => {
        if (!acc && coachBubble.querySelector('.typing')) coachBubble.remove();
      },
    });
    busy = false;
    sendBtn.disabled = false;
  }
}
