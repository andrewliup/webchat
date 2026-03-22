// ── STATE ──
const state = {
  me: null, partner: null, users: [],
  messages: [], lastReadId: null,
  oldestLoadedId: null, newestLoadedId: null,
  hasMoreOlder: true, hasMoreNewer: false,
  isLoadingOlder: false, isLoadingNewer: false,
  unreadCount: 0, firstUnreadId: null,
  theme: localStorage.getItem('theme') || 'light',
  ctxTarget: null, quoteMsg: null,
  _longPressTimer: null, _longPressFired: false,
  socket: null, typingTimer: null
};

// Apply saved theme immediately
document.body.setAttribute('data-theme', state.theme);
document.getElementById('themeBtn').textContent = state.theme === 'dark' ? '☀️' : '🌙';

// ── HELPERS ──
// Format time in UTC+8 (Asia/Shanghai timezone)
function fmtTime(ts) {
  const d = new Date(ts);
  // Convert to UTC+8
  const utc8Time = d.getTime() + (8 * 3600000);
  const utc8 = new Date(utc8Time);
  return utc8.getUTCHours().toString().padStart(2,'0') + ':' + utc8.getUTCMinutes().toString().padStart(2,'0');
}
function fmtSep(ts) {
  const now = new Date();
  const d = new Date(ts);
  // Convert to UTC+8
  const utc8Time = d.getTime() + (8 * 3600000);
  const utc8NowTime = now.getTime() + (8 * 3600000);
  const utc8Now = new Date(utc8NowTime);
  const todayStart = Date.UTC(utc8Now.getUTCFullYear(), utc8Now.getUTCMonth(), utc8Now.getUTCDate());
  const yestStart  = todayStart - 86400000;
  if (utc8Time >= todayStart)  return 'Today '     + fmtTime(ts);
  if (utc8Time >= yestStart)   return 'Yesterday ' + fmtTime(ts);
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const weekStart = todayStart - utc8Now.getUTCDay() * 86400000;
  if (utc8Time >= weekStart)   return days[new Date(utc8Time).getUTCDay()] + ' ' + fmtTime(ts);
  return new Date(utc8Time).toLocaleDateString('en-US', { timeZone: 'UTC' }) + ' ' + fmtTime(ts);
}
function needsSep(msgs, idx) {
  if (idx === 0) return true;
  const a = new Date(msgs[idx - 1].sent_at).getTime();
  const b = new Date(msgs[idx].sent_at).getTime();
  return b - a > 2 * 3600000;
}
function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function api(path, opts = {}) {
  return fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts });
}

// ── RENDER ──
function renderMessages() {
  const area   = document.getElementById('messagesArea');
  const badge  = document.getElementById('unreadBadge');
  const msgs   = state.messages.filter(m => !m.is_deleted);
  let html = '';

  msgs.forEach((m, i) => {
    if (needsSep(msgs, i))
      html += `<div class="date-sep"><span>${fmtSep(new Date(m.sent_at).getTime())}</span></div>`;

    const isSelf     = m.sender_id === state.me.id;
    const sender     = state.users.find(u => u.id === m.sender_id) || {};
    const color      = isSelf ? '#7c4dff' : (sender.avatar_color || '#00a884');
    const isLastRead = isSelf && m.id === state.lastReadId;
    const isMedia    = m.type === 'image' || m.type === 'video';
    const avatarInner = sender.avatar_url
      ? `<img src="${sender.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : (sender.nickname || sender.email || '?')[0].toUpperCase();
    const avatarBg    = sender.avatar_url ? 'transparent' : color;
    const avatarClick = sender.avatar_url ? `onclick="openLightbox('image','${sender.avatar_url}')" style="background:${avatarBg}"` : `style="background:${avatarBg}"`;

    html += `<div class="msg-row ${isSelf ? 'self' : ''}" data-id="${m.id}">
      <div class="msg-avatar" ${avatarClick}>${avatarInner}</div>
      <div class="bubble${isMedia ? ' media-bubble' : ''}" data-id="${m.id}">
        ${renderBubbleContent(m)}
        <div class="bubble-meta">
          ${m.edited_at ? '<span class="edited-tag">edited</span>' : ''}
        </div>
      </div>
      ${isLastRead ? '<span class="eye-icon"><svg width="14" height="10" viewBox="0 0 14 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 1C4 1 1.5 4 1 5c.5 1 3 4 6 4s5.5-3 6-4c-.5-1-3-4-6-4z" stroke="currentColor" stroke-width="1.2" fill="none"/><circle cx="7" cy="5" r="1.8" fill="currentColor"/></svg></span>' : ''}
    </div>`;
  });

  area.innerHTML = html + badge.outerHTML;
  updateUnreadBadge();
}

function renderBubbleContent(m) {
  if (m.is_recalled) return '<span class="recalled-msg">Message recalled</span>';
  let quoteHtml = '';
  if (m.quote_id) {
    const q = state.messages.find(x => x.id === m.quote_id);
    if (q) {
      const qs   = state.users.find(u => u.id === q.sender_id) || {};
      const qTxt = q.type === 'text' ? escHtml(q.content) : `[${q.type}]`;
      quoteHtml  = `<div class="quote-bar" onclick="jumpToMsg(${q.id})"><strong>${escHtml(qs.nickname || '?')}</strong>${qTxt}</div>`;
    }
  }
  if (m.type === 'image') {
    const thumb = m.thumb_url || m.media_url;
    return quoteHtml + `<img class="thumb" src="${thumb}" alt="image" loading="lazy" onclick="openLightbox('image','${m.media_url}')">`;
  }
  if (m.type === 'video') {
    if (m.thumb_url) {
      return quoteHtml + `<div class="video-wrapper" onclick="openLightbox('video','${m.media_url}')"><img class="thumb" src="${m.thumb_url}" alt="video" loading="lazy"><div class="play-btn">▶</div></div>`;
    }
    return quoteHtml + `<div class="video-wrapper" onclick="openLightbox('video','${m.media_url}')"><video class="thumb" src="${m.media_url}#t=0.1" preload="metadata"></video><div class="play-btn">▶</div></div>`;
  }
  return quoteHtml + `<span class="bubble-text">${escHtml(m.content)}</span>`;
}

function jumpToMsg(id) {
  const el = document.querySelector(`#messagesArea [data-id="${id}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('msg-highlight');
  setTimeout(() => el.classList.remove('msg-highlight'), 1500);
}

function scrollToLastRead() {
  const area = document.getElementById('messagesArea');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (state.unreadCount > 0 && state.firstUnreadId) {
        const el = area.querySelector(`[data-id="${state.firstUnreadId}"]`);
        if (el) {
          el.scrollIntoView({ block: 'start' });
          // Re-anchor after any images above finish loading (they expand and push position down)
          area.querySelectorAll('img').forEach(img => {
            if (!img.complete) {
              img.addEventListener('load', () => {
                const target = area.querySelector(`[data-id="${state.firstUnreadId}"]`);
                if (target) target.scrollIntoView({ block: 'start' });
              }, { once: true });
            }
          });
          return;
        }
      }
      scrollInstant(area);
    });
  });
}

function updateUnreadBadge() {
  const badge = document.getElementById('unreadBadge');
  if (state.unreadCount > 0) {
    badge.textContent = `${state.unreadCount} new messages ↓`;
    badge.style.display = 'block';
    badge.onclick = () => {
      document.getElementById('messagesArea').scrollTop = 9999999;
      state.unreadCount = 0;
      badge.style.display = 'none';
    };
  } else {
    badge.style.display = 'none';
  }
}

// ── INCREMENTAL DOM HELPERS (avoid full re-render when only one thing changes) ──
const EYE_SVG = `<svg width="14" height="10" viewBox="0 0 14 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 1C4 1 1.5 4 1 5c.5 1 3 4 6 4s5.5-3 6-4c-.5-1-3-4-6-4z" stroke="currentColor" stroke-width="1.2" fill="none"/><circle cx="7" cy="5" r="1.8" fill="currentColor"/></svg>`;

function buildMsgRowHtml(m, msgs, idx) {
  const isSelf     = m.sender_id === state.me.id;
  const sender     = state.users.find(u => u.id === m.sender_id) || {};
  const color      = isSelf ? '#7c4dff' : (sender.avatar_color || '#00a884');
  const isLastRead = isSelf && m.id === state.lastReadId;
  const isMedia    = m.type === 'image' || m.type === 'video';
  const avatarInner = sender.avatar_url
    ? `<img src="${sender.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
    : (sender.nickname || sender.email || '?')[0].toUpperCase();
  const avatarBg    = sender.avatar_url ? 'transparent' : color;
  const avatarClick = sender.avatar_url
    ? `onclick="openLightbox('image','${sender.avatar_url}')" style="background:${avatarBg}"`
    : `style="background:${avatarBg}"`;
  let html = '';
  if (needsSep(msgs, idx))
    html += `<div class="date-sep"><span>${fmtSep(new Date(m.sent_at).getTime())}</span></div>`;
  html += `<div class="msg-row ${isSelf ? 'self' : ''}" data-id="${m.id}">
      <div class="msg-avatar" ${avatarClick}>${avatarInner}</div>
      <div class="bubble${isMedia ? ' media-bubble' : ''}" data-id="${m.id}">
        ${renderBubbleContent(m)}
        <div class="bubble-meta">
          ${m.edited_at ? '<span class="edited-tag">edited</span>' : ''}
        </div>
      </div>
      ${isLastRead ? `<span class="eye-icon">${EYE_SVG}</span>` : ''}
    </div>`;
  return html;
}

// Bug 3: fade-in both the separator and the message row together
function appendMessage(msg) {
  const area = document.getElementById('messagesArea');
  const msgs = state.messages.filter(m => !m.is_deleted);
  const idx  = msgs.findIndex(m => m.id === msg.id);
  if (idx === -1) { renderMessages(); return; }
  const frag = document.createRange().createContextualFragment(buildMsgRowHtml(msg, msgs, idx));
  frag.querySelectorAll('.msg-row, .date-sep').forEach(el => el.classList.add('new-msg'));
  const badge = area.querySelector('#unreadBadge');
  if (badge) area.insertBefore(frag, badge);
  else area.appendChild(frag);
  updateUnreadBadge();
}

// Bug 4: also remove orphaned date separator when a message is deleted
function updateBubble(id) {
  const msg = state.messages.find(m => m.id === id);
  if (!msg) return;
  if (msg.is_deleted) {
    const row = document.querySelector(`#messagesArea .msg-row[data-id="${id}"]`);
    if (row) {
      const prev = row.previousElementSibling;
      if (prev && prev.classList.contains('date-sep')) prev.remove();
      row.remove();
    }
    return;
  }
  const bubble = document.querySelector(`#messagesArea .bubble[data-id="${id}"]`);
  if (!bubble) { renderMessages(); return; }
  bubble.innerHTML = renderBubbleContent(msg) +
    `<div class="bubble-meta">${msg.edited_at ? '<span class="edited-tag">edited</span>' : ''}</div>`;
}

function updateEyeIcon(messageId) {
  const area = document.getElementById('messagesArea');
  area.querySelectorAll('.eye-icon').forEach(e => e.remove());
  const row = area.querySelector(`.msg-row[data-id="${messageId}"]`);
  if (row) {
    const eye = document.createElement('span');
    eye.className = 'eye-icon';
    eye.innerHTML = EYE_SVG;
    row.appendChild(eye);
  }
}

function updateAvatarsInDom(user) {
  if (!user.avatar_url) return;
  const area = document.getElementById('messagesArea');
  const sel  = user.id === state.me.id ? '.msg-row.self .msg-avatar' : '.msg-row:not(.self) .msg-avatar';
  area.querySelectorAll(sel).forEach(el => {
    el.innerHTML = `<img src="${user.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    el.style.background = 'transparent';
  });
}

// ── LOGIN ──
async function doLogin() {
  const email    = document.getElementById('emailInput').value.trim();
  const passcode = document.getElementById('passcodeInput').value.trim();
  const err      = document.getElementById('loginErr');
  err.textContent = '';

  if (!email || !passcode) {
    err.textContent = 'Please fill all fields.'; return;
  }

  const res = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, passcode })
  });
  const data = await res.json();
  if (!res.ok) { err.textContent = data.error || 'Login failed.'; return; }

  await enterChat(data.user);
}

document.getElementById('loginBtn').addEventListener('click', doLogin);
document.getElementById('passcodeInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});
document.getElementById('emailInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('passcodeInput').focus();
});

async function enterChat(user) {
  state.me = user;

  // Load users
  const uRes  = await api('/api/users');
  const uData = await uRes.json();
  state.users = uData.users || [];
  state.partner = state.users.find(u => u.id !== state.me.id) || null;

  // Load messages
  await loadMessages();

  // Update UI
  document.getElementById('loginScreen').classList.remove('active');
  document.getElementById('chatScreen').classList.add('active');
  updatePartnerHeader();
  setupEmojiPicker();
  connectSocket();
  setupIntersectionObserver();
}

function fmtLastSeen(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - new Date(ts.replace(' ', 'T') + 'Z').getTime()) / 1000);
  if (diff < 60)           return 'last seen just now';
  if (diff < 3600)         return `last seen ${Math.floor(diff / 60)} min ago`;
  if (diff < 86400)        return `last seen ${Math.floor(diff / 3600)} hr ago`;
  return `last seen ${Math.floor(diff / 86400)} day${Math.floor(diff / 86400) > 1 ? 's' : ''} ago`;
}

function updatePartnerHeader() {
  const p = state.partner;
  const dot = document.getElementById('partnerDot');
  const lastSeenEl = document.getElementById('partnerLastSeen');
  if (p) {
    document.getElementById('partnerName').textContent = p.nickname;
    const av = document.getElementById('partnerAvatar');
    if (p.avatar_url) {
      av.innerHTML = `<img src="${p.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
      av.style.background = 'transparent';
      av.onclick = () => openLightbox('image', p.avatar_url);
    } else {
      av.textContent = (p.nickname || p.email || '?')[0].toUpperCase();
      av.style.background = p.avatar_color || '#00a884';
      av.style.cursor = 'default';
      av.onclick = null;
    }
    if (p.online) {
      dot.className = 'status-dot online';
      lastSeenEl.textContent = 'active';
    } else {
      dot.className = 'status-dot away';
      lastSeenEl.textContent = fmtLastSeen(p.last_seen);
    }
  } else {
    document.getElementById('partnerName').textContent = 'Waiting for partner…';
    dot.className = 'status-dot';
    lastSeenEl.textContent = '';
  }
}

async function loadMessages() {
  const res  = await api('/api/messages/initial');
  const data = await res.json();
  const msgs = data.messages || [];

  msgs.forEach(m => {
    if (typeof m.sent_at === 'string') m.sent_at = new Date(m.sent_at).getTime();
  });

  state.lastReadId = data.lastReadId || null;
  const unread = msgs.filter(m => m.sender_id !== state.me.id && (!state.lastReadId || m.id > state.lastReadId));
  state.unreadCount   = unread.length;
  state.firstUnreadId = unread.length ? unread[0].id : null;

  state.messages = msgs;
  state.oldestLoadedId = msgs.length ? msgs[0].id : null;
  state.newestLoadedId = msgs.length ? msgs[msgs.length - 1].id : null;
  state.hasMoreOlder = msgs.length >= 50;
  // Check if there are newer messages beyond what was loaded
  const newerCount = state.lastReadId ? msgs.filter(m => m.id > state.lastReadId).length : 0;
  state.hasMoreNewer = newerCount >= 50;

  renderMessages();
  scrollToLastRead();
}

async function loadOlderMessages() {
  if (!state.hasMoreOlder || state.isLoadingOlder || !state.oldestLoadedId) return;
  state.isLoadingOlder = true;

  const res = await api(`/api/messages?before_id=${state.oldestLoadedId}&limit=50`);
  const data = await res.json();
  const msgs = data.messages || [];

  msgs.forEach(m => {
    if (typeof m.sent_at === 'string') m.sent_at = new Date(m.sent_at).getTime();
  });

  if (msgs.length) {
    const area = document.getElementById('messagesArea');
    const oldHeight = area.scrollHeight;

    state.messages = [...msgs, ...state.messages];
    state.oldestLoadedId = msgs[0].id;
    state.hasMoreOlder = msgs.length >= 50;

    renderMessages();

    const newHeight = area.scrollHeight;
    area.scrollTop = newHeight - oldHeight;
  } else {
    state.hasMoreOlder = false;
  }

  state.isLoadingOlder = false;
}

async function loadNewerMessages() {
  if (!state.hasMoreNewer || state.isLoadingNewer || !state.newestLoadedId) return;
  state.isLoadingNewer = true;

  const res = await api(`/api/messages?after_id=${state.newestLoadedId}&limit=50`);
  const data = await res.json();
  const msgs = data.messages || [];

  msgs.forEach(m => {
    if (typeof m.sent_at === 'string') m.sent_at = new Date(m.sent_at).getTime();
  });

  if (msgs.length) {
    const area = document.getElementById('messagesArea');
    const savedScrollTop = area.scrollTop;
    state.messages = [...state.messages, ...msgs];
    state.newestLoadedId = msgs[msgs.length - 1].id;
    state.hasMoreNewer = msgs.length >= 50;
    renderMessages();
    area.scrollTop = savedScrollTop;
  } else {
    state.hasMoreNewer = false;
  }

  state.isLoadingNewer = false;
}

// Bug fix: instant scroll for initial load/pagination — smooth only for user-triggered scrolls
function scrollInstant(area) {
  area.style.scrollBehavior = 'auto';
  area.scrollTop = area.scrollHeight + 9999;
  area.style.scrollBehavior = '';
}

// ── SOCKET.IO ──
function connectSocket() {
  state.socket = io({ auth: { userId: state.me.id } });

  state.socket.on('new_message', msg => {
    if (typeof msg.sent_at === 'string') msg.sent_at = new Date(msg.sent_at).getTime();
    msg.id = Number(msg.id);
    // Deduplicate — sender already added it optimistically
    if (state.messages.find(m => Number(m.id) === msg.id)) return;
    state.messages.push(msg);

    const area = document.getElementById('messagesArea');
    const atBottom = area.scrollTop + area.clientHeight >= area.scrollHeight - 60;

    if (msg.sender_id !== state.me.id && !atBottom) {
      state.unreadCount++;
      if (!state.firstUnreadId) state.firstUnreadId = msg.id;
    }

    appendMessage(msg);
    if (atBottom || msg.sender_id === state.me.id) {
      requestAnimationFrame(() => { area.scrollTo({ top: area.scrollHeight, behavior: 'smooth' }); });
    }
  });

  state.socket.on('message_updated', updated => {
    const idx = state.messages.findIndex(m => m.id === updated.id);
    if (idx !== -1) { state.messages[idx] = { ...state.messages[idx], ...updated }; updateBubble(updated.id); }
  });

  state.socket.on('message_deleted', ({ id, action }) => {
    const idx = state.messages.findIndex(m => m.id === id);
    if (idx !== -1) {
      if (action === 'recall') state.messages[idx].is_recalled = 1;
      else state.messages[idx].is_deleted = 1;
      updateBubble(id);
    }
  });

  state.socket.on('message_read', ({ userId, messageId }) => {
    if (userId !== state.me.id) {
      state.lastReadId = messageId;
      updateEyeIcon(messageId);
    }
  });

  state.socket.on('user_status', ({ userId, online, lastSeen }) => {
    const u = state.users.find(x => x.id === userId);
    if (u) {
      u.online = online;
      if (!online && lastSeen) u.last_seen = lastSeen;
      updatePartnerHeader();
    }
  });

  state.socket.on('user_updated', ({ user }) => {
    const idx = state.users.findIndex(x => x.id === user.id);
    if (idx !== -1) state.users[idx] = { ...state.users[idx], ...user };
    if (state.partner && state.partner.id === user.id) {
      state.partner = { ...state.partner, ...user };
      updatePartnerHeader();
    }
    if (state.me && state.me.id === user.id) {
      state.me = { ...state.me, ...user };
    }
    updateAvatarsInDom(user);
  });

  state.socket.on('user_typing', ({ userId }) => {
    if (userId !== state.me.id) {
      document.getElementById('partnerName').textContent = (state.partner?.nickname || 'Partner') + ' typing…';
      clearTimeout(state._typingClear);
      state._typingClear = setTimeout(() => {
        document.getElementById('partnerName').textContent = state.partner?.nickname || 'Partner';
      }, 2000);
    }
  });
}

// ── INTERSECTION OBSERVER (auto read) ──
function setupIntersectionObserver() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const id = parseInt(entry.target.dataset.id);
      const msg = state.messages.find(m => m.id === id);
      if (!msg || msg.sender_id === state.me.id) return;
      if (state.lastReadId && id <= state.lastReadId) return;
      state.lastReadId = id;
      api(`/api/messages/${id}/read`, { method: 'PUT' });
    });
  }, { threshold: 0.5 });

  // Re-observe on each render; also stop shimmer when images finish loading
  const area = document.getElementById('messagesArea');
  const mo = new MutationObserver(() => {
    area.querySelectorAll('.msg-row').forEach(el => observer.observe(el));
    area.querySelectorAll('img.thumb:not(.loaded)').forEach(img => {
      if (img.complete) { img.classList.add('loaded'); return; }
      img.addEventListener('load',  () => img.classList.add('loaded'), { once: true });
      img.addEventListener('error', () => img.classList.add('loaded'), { once: true });
    });
  });
  mo.observe(area, { childList: true });
}

// ── PAGE VISIBILITY (pause sync) ──
document.addEventListener('visibilitychange', () => {
  if (!state.socket) return;
  if (document.hidden) {
    state.socket.disconnect();
  } else {
    state.socket.connect();
    // Re-fetch messages in case we missed any while hidden
    loadMessages();
  }
});

// ── SEND TEXT ──
const msgInput = document.getElementById('msgInput');
const sendBtn  = document.getElementById('sendBtn');

msgInput.addEventListener('input', () => {
  msgInput.style.height = 'auto';
  msgInput.style.height = Math.min(msgInput.scrollHeight, 100) + 'px';
  sendBtn.style.display = msgInput.value.trim() ? 'flex' : 'none';

  // Typing indicator
  if (state.socket) {
    state.socket.emit('typing', { userId: state.me.id });
  }
});
msgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
});
sendBtn.addEventListener('click', sendText);

async function sendText() {
  const text = msgInput.value.trim();
  if (!text) return;
  msgInput.value = '';
  msgInput.style.height = 'auto';
  sendBtn.style.display = 'none';

  const body = { content: text, type: 'text' };
  if (state.quoteMsg) body.quote_id = state.quoteMsg.id;
  clearQuote();

  const res  = await api('/api/messages', { method: 'POST', body: JSON.stringify(body) });
  const data = await res.json();
  if (data.message) {
    const msg = data.message;
    if (typeof msg.sent_at === 'string') msg.sent_at = new Date(msg.sent_at).getTime();
    msg.id = Number(msg.id);
    await jumpToPresent(msg);
  }
}

// ── LIGHTBOX ──
function openLightbox(type, url) {
  const lb = document.getElementById('lightbox');
  const content = document.getElementById('lightboxContent');
  content.innerHTML = type === 'image'
    ? `<img src="${url}" alt="image">`
    : `<video src="${url}" controls autoplay playsinline></video>`;
  lb.classList.add('active');
}
document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
document.getElementById('lightbox').addEventListener('click', e => {
  if (e.target === document.getElementById('lightbox')) closeLightbox();
});
function closeLightbox() {
  const lb = document.getElementById('lightbox');
  lb.classList.remove('active');
  document.getElementById('lightboxContent').innerHTML = '';
}

// ── EMOJI ──
const EMOJIS = ['😊','😂','❤️','👍','🔥','😍','🎉','😢','😎','🤔','👏','🙏',
  '😅','🥰','😭','🤣','😘','🤩','😡','😴','🤗','😏','🥳','😬','🤝','💪',
  '🌟','✨','💯','🎊','🍕','☕','🌈','🎵','💡','🚀','🌸','🦋'];

function setupEmojiPicker() {
  document.getElementById('emojiGrid').innerHTML = EMOJIS.map(e =>
    `<button onclick="insertEmoji('${e}')">${e}</button>`
  ).join('');
}
function insertEmoji(e) {
  msgInput.value += e;
  msgInput.dispatchEvent(new Event('input'));
  document.getElementById('emojiPicker').style.display = 'none';
  msgInput.focus();
}
document.getElementById('emojiBtn').addEventListener('click', ev => {
  ev.stopPropagation();
  const p = document.getElementById('emojiPicker');
  p.style.display = p.style.display === 'block' ? 'none' : 'block';
  document.getElementById('attachMenu').classList.remove('active');
});

// ── ATTACH ──
document.getElementById('attachBtn').addEventListener('click', ev => {
  ev.stopPropagation();
  document.getElementById('attachMenu').classList.toggle('active');
  document.getElementById('emojiPicker').style.display = 'none';
});
document.getElementById('attachImage').addEventListener('click', () => {
  document.getElementById('imageInput').click();
  document.getElementById('attachMenu').classList.remove('active');
});
document.getElementById('attachVideo').addEventListener('click', () => {
  document.getElementById('videoInput').click();
  document.getElementById('attachMenu').classList.remove('active');
});

async function uploadAndSend(file, type) {
  const fd = new FormData();
  fd.append('file', file);
  const upRes  = await fetch('/api/upload', { method: 'POST', credentials: 'include', body: fd });
  const upData = await upRes.json();
  if (!upData.url) return;
  const body = { type, media_url: upData.url };
  if (upData.thumb_url) body.thumb_url = upData.thumb_url;
  const res  = await api('/api/messages', { method: 'POST', body: JSON.stringify(body) });
  const data = await res.json();
  if (data.message) {
    const msg = data.message;
    if (typeof msg.sent_at === 'string') msg.sent_at = new Date(msg.sent_at).getTime();
    msg.id = Number(msg.id);
    await jumpToPresent(msg);
  }
}

// Jump to bottom, replacing loaded messages with latest batch + new message
async function jumpToPresent(newMsg) {
  const area = document.getElementById('messagesArea');
  if (state.hasMoreNewer) {
    // There are unread messages not in memory — fetch latest batch from server
    const res  = await api('/api/messages?limit=50');
    const data = await res.json();
    const msgs = data.messages || [];
    msgs.forEach(m => {
      if (typeof m.sent_at === 'string') m.sent_at = new Date(m.sent_at).getTime();
      m.id = Number(m.id);
    });
    // Ensure our new message is included
    if (newMsg && !msgs.find(m => m.id === newMsg.id)) msgs.push(newMsg);
    state.messages      = msgs;
    state.oldestLoadedId = msgs.length ? msgs[0].id : null;
    state.newestLoadedId = msgs.length ? msgs[msgs.length - 1].id : null;
    state.hasMoreOlder  = msgs.length >= 50;
    state.hasMoreNewer  = false;
    state.unreadCount   = 0;
    state.firstUnreadId = null;
    renderMessages();
    scrollInstant(area);
  } else {
    // Already have all messages — just append without destroying the DOM
    if (newMsg && !state.messages.find(m => m.id === newMsg.id)) {
      state.messages.push(newMsg);
      state.newestLoadedId = newMsg.id;
    }
    state.unreadCount   = 0;
    state.firstUnreadId = null;
    appendMessage(newMsg);
    area.scrollTo({ top: area.scrollHeight, behavior: 'smooth' });
    // Re-scroll after image finishes loading
    if (newMsg && (newMsg.type === 'image' || newMsg.type === 'video')) {
      const img = area.querySelector(`.msg-row[data-id="${newMsg.id}"] img`);
      if (img && !img.complete) {
        img.addEventListener('load', () => area.scrollTo({ top: area.scrollHeight, behavior: 'smooth' }), { once: true });
      }
    }
  }
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.getElementById('messagesArea').scrollTo({ top: 9999999, behavior: 'smooth' });
    });
  });
}

document.getElementById('imageInput').addEventListener('change', e => {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  files.forEach(f => uploadAndSend(f, 'image'));
  e.target.value = '';
});
document.getElementById('videoInput').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  uploadAndSend(f, 'video');
  e.target.value = '';
});

// ── CONTEXT MENU ──
// Desktop: right-click. Mobile: long press (pointerdown below). Suppress on touch to avoid double-fire.
document.getElementById('messagesArea').addEventListener('contextmenu', e => {
  e.preventDefault();
  if (e.pointerType === 'touch' || state._longPressFired) return;
  const bubble = e.target.closest('.bubble');
  if (bubble) showCtxMenu(bubble);
});
// Bug 2: always clear any pending timer and reset flag at the start of a new press
document.getElementById('messagesArea').addEventListener('pointerdown', e => {
  clearTimeout(state._longPressTimer);
  state._longPressFired = false;
  const bubble = e.target.closest('.bubble');
  if (!bubble) return;
  state._longPressTimer = setTimeout(() => {
    state._longPressFired = true;
    window.getSelection()?.removeAllRanges();
    showCtxMenu(bubble);
  }, 600);
});
// Cancel timer on release or cancel — prevents menu showing after a quick tap
document.getElementById('messagesArea').addEventListener('pointerup',     () => clearTimeout(state._longPressTimer));
document.getElementById('messagesArea').addEventListener('pointercancel', () => clearTimeout(state._longPressTimer));
document.getElementById('messagesArea').addEventListener('pointermove',   () => clearTimeout(state._longPressTimer));
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('#ctxMenu'))    document.getElementById('ctxMenu').classList.remove('active');
  if (!e.target.closest('#emojiPicker')) document.getElementById('emojiPicker').style.display = 'none';
  if (!e.target.closest('#attachMenu')) document.getElementById('attachMenu').classList.remove('active');
});

function showCtxMenu(bubble) {
  if (!bubble) return;
  const id  = parseInt(bubble.dataset.id);
  const msg = state.messages.find(m => m.id === id);
  if (!msg) return;
  state.ctxTarget = msg;
  const isSelf    = msg.sender_id === state.me.id;
  const canEdit   = isSelf && msg.type === 'text' && !msg.is_recalled && Date.now() - new Date(msg.sent_at).getTime() < 600000;
  const canRecall = isSelf && !msg.is_recalled && Date.now() - new Date(msg.sent_at).getTime() < 600000;
  document.getElementById('ctxCopy').style.display   = msg.type === 'text' && !msg.is_recalled ? 'inline-flex' : 'none';
  document.getElementById('ctxQuote').style.display  = !msg.is_recalled && !msg.is_deleted ? 'inline-flex' : 'none';
  document.getElementById('ctxEdit').style.display   = canEdit ? 'inline-flex' : 'none';
  document.getElementById('ctxRecall').style.display = canRecall ? 'inline-flex' : 'none';
  document.getElementById('ctxDelete').style.display = isSelf ? 'inline-flex' : 'none';
  document.getElementById('ctxClear').style.display  = 'inline-flex';

  const menu = document.getElementById('ctxMenu');
  menu.classList.add('active');
  const mw = menu.offsetWidth  || 300;
  const mh = menu.offsetHeight || 120;
  const pad = 8;

  // Position relative to the bubble, not the exact touch point
  const rect = bubble.getBoundingClientRect();
  const spaceAbove = rect.top;
  const spaceBelow = window.innerHeight - rect.bottom;

  // Prefer above the bubble; fall back to below if not enough space
  let top;
  if (spaceAbove >= mh + pad) {
    top = rect.top - mh - pad;
  } else if (spaceBelow >= mh + pad) {
    top = rect.bottom + pad;
  } else {
    // Not enough room either way — center vertically over the bubble
    top = rect.top + (rect.height - mh) / 2;
  }

  // Horizontal: align with the bubble, clamped to screen
  let left = isSelf
    ? rect.right - mw           // right-align for own messages
    : rect.left;                // left-align for partner messages
  left = Math.max(pad, Math.min(left, window.innerWidth - mw - pad));
  top  = Math.max(pad, Math.min(top,  window.innerHeight - mh - pad));

  menu.style.left = left + 'px';
  menu.style.top  = top  + 'px';
}

document.getElementById('ctxCopy').addEventListener('click', () => {
  if (!state.ctxTarget) return;
  const text = state.ctxTarget.content;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
});
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try { document.execCommand('copy'); } catch(e) {}
  document.body.removeChild(ta);
}
document.getElementById('ctxQuote').addEventListener('click', () => {
  if (!state.ctxTarget) return;
  state.quoteMsg = state.ctxTarget;
  const sender = state.users.find(u => u.id === state.quoteMsg.sender_id) || {};
  const text   = state.quoteMsg.type === 'text' ? state.quoteMsg.content : `[${state.quoteMsg.type}]`;
  document.getElementById('quotePreviewName').textContent = sender.nickname || '?';
  document.getElementById('quotePreviewText').textContent = text;
  document.getElementById('quotePreview').classList.add('active');
  msgInput.focus();
});
document.getElementById('quoteCancelBtn').addEventListener('click', clearQuote);
function clearQuote() {
  state.quoteMsg = null;
  document.getElementById('quotePreview').classList.remove('active');
}

document.getElementById('ctxEdit').addEventListener('click', async () => {
  if (!state.ctxTarget) return;
  const newText = prompt('Edit message:', state.ctxTarget.content);
  if (newText !== null && newText.trim()) {
    await api(`/api/messages/${state.ctxTarget.id}`, {
      method: 'PUT', body: JSON.stringify({ content: newText.trim() })
    });
  }
});
document.getElementById('ctxRecall').addEventListener('click', async () => {
  if (state.ctxTarget) await api(`/api/messages/${state.ctxTarget.id}?action=recall`, { method: 'DELETE' });
});
document.getElementById('ctxDelete').addEventListener('click', async () => {
  if (state.ctxTarget) await api(`/api/messages/${state.ctxTarget.id}`, { method: 'DELETE' });
});
document.getElementById('ctxClear').addEventListener('click', async () => {
  if (confirm('Clear all messages from your view? (They stay on server)')) {
    await api('/api/messages/clear', { method: 'POST' });
    await loadMessages();
  }
});

// ── SEARCH ──
document.getElementById('searchBtn').addEventListener('click', () => {
  document.getElementById('searchOverlay').classList.add('active');
  document.getElementById('searchInput').focus();
});
document.getElementById('closeSearchBtn').addEventListener('click', () => {
  document.getElementById('searchOverlay').classList.remove('active');
  document.getElementById('searchInput').value = '';
  document.getElementById('searchResults').innerHTML = '';
});
document.getElementById('searchInput').addEventListener('input', async e => {
  const q = e.target.value.trim();
  const results = document.getElementById('searchResults');
  if (!q) { results.innerHTML = ''; return; }

  const res  = await api(`/api/messages/search?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  const hits = data.messages || [];

  if (!hits.length) { results.innerHTML = '<div class="search-empty">No results found</div>'; return; }

  results.innerHTML = hits.map(m => {
    const hi     = escHtml(m.content).replace(new RegExp(`(${escHtml(q)})`, 'gi'), '<mark>$1</mark>');
    const sender = state.users.find(u => u.id === m.sender_id) || {};
    return `<div class="search-item" data-id="${m.id}">
      <div class="search-item-text">${hi}</div>
      <div class="search-item-meta">${escHtml(sender.nickname || '?')} · ${fmtSep(new Date(m.sent_at).getTime())}</div>
    </div>`;
  }).join('');

  results.querySelectorAll('.search-item').forEach(el => {
    el.addEventListener('click', () => {
      document.getElementById('searchOverlay').classList.remove('active');
      jumpToMsg(parseInt(el.dataset.id));
    });
  });
});

// ── THEME ──
document.getElementById('themeBtn').addEventListener('click', () => {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
  document.body.setAttribute('data-theme', state.theme);
  document.getElementById('themeBtn').textContent = state.theme === 'dark' ? '☀️' : '🌙';
  localStorage.setItem('theme', state.theme);
});

// ── SCROLL READ TRACKING & LAZY LOAD ──
let scrollDebounce = null;
document.getElementById('messagesArea').addEventListener('scroll', () => {
  const area = document.getElementById('messagesArea');

  // Clear unread badge at bottom
  if (area.scrollTop + area.clientHeight >= area.scrollHeight - 20) {
    state.unreadCount = 0;
    document.getElementById('unreadBadge').style.display = 'none';
  }

  // Debounced lazy loading
  clearTimeout(scrollDebounce);
  scrollDebounce = setTimeout(() => {
    // Load older messages when near top
    if (area.scrollTop < 200 && state.hasMoreOlder && !state.isLoadingOlder) {
      loadOlderMessages();
    }
    // Load newer messages when near bottom
    if (area.scrollHeight - area.scrollTop - area.clientHeight < 200 && state.hasMoreNewer && !state.isLoadingNewer) {
      loadNewerMessages();
    }
  }, 300);
});

// ── RESTORE SESSION ON LOAD ──
// Refresh "last seen X ago" every minute
setInterval(() => { if (state.partner && !state.partner.online) updatePartnerHeader(); }, 60000);

(async () => {
  const res = await api('/api/auth/me');
  if (res.ok) {
    const data = await res.json();
    await enterChat(data.user);
  } else {
    // Restore last used email if available
    const lastEmail = localStorage.getItem('lastEmail');
    if (lastEmail) document.getElementById('emailInput').value = lastEmail;
  }
})();

// ── LOGOUT ──
document.getElementById('logoutBtn').addEventListener('click', async () => {
  const email = state.me ? state.me.email : '';
  await api('/api/auth/logout', { method: 'POST' });
  if (email) localStorage.setItem('lastEmail', email);
  location.reload();
});

// ── PROFILE ──
const profileOverlay = document.getElementById('profileOverlay');

function openProfile() {
  const me = state.me;
  document.getElementById('profileNickname').value = me.nickname || '';
  renderProfileAvatar();
  document.getElementById('profileErr').textContent = '';
  profileOverlay.classList.add('active');
}

function renderProfileAvatar() {
  const el = document.getElementById('profileAvatarDisplay');
  if (state.me.avatar_url) {
    el.innerHTML = `<img src="${state.me.avatar_url}" alt="avatar">`;
  } else {
    el.textContent = (state.me.nickname || state.me.email || '?')[0].toUpperCase();
    el.style.background = state.me.avatar_color || 'var(--accent)';
  }
}

document.getElementById('profileBtn').addEventListener('click', openProfile);
document.getElementById('closeProfileBtn').addEventListener('click', () => profileOverlay.classList.remove('active'));
profileOverlay.addEventListener('click', e => { if (e.target === profileOverlay) profileOverlay.classList.remove('active'); });

// Avatar photo pick
document.getElementById('profileAvatarWrap').addEventListener('click', () => {
  document.getElementById('avatarInput').click();
});
document.getElementById('avatarInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/upload/avatar', { method: 'POST', body: fd });
  if (res.ok) {
    const data = await res.json();
    state.me.avatar_url = data.url;
    state.me.avatar_color = null;
    // keep state.users in sync so renderMessages picks up the new photo
    const idx = state.users.findIndex(u => u.id === state.me.id);
    if (idx !== -1) { state.users[idx].avatar_url = data.url; state.users[idx].avatar_color = null; }
    renderProfileAvatar();
  }
  e.target.value = '';
});

document.getElementById('saveProfileBtn').addEventListener('click', async () => {
  const nickname = document.getElementById('profileNickname').value.trim();
  const err      = document.getElementById('profileErr');
  err.textContent = '';
  if (!nickname) { err.textContent = 'Nickname cannot be empty.'; return; }

  const body = { nickname };
  if (state.me.avatar_url) body.avatar_url = state.me.avatar_url;

  const res = await api('/api/profile', { method: 'PUT', body: JSON.stringify(body) });
  if (!res.ok) { err.textContent = 'Save failed.'; return; }
  const data = await res.json();
  state.me = { ...state.me, ...data.user };
  profileOverlay.classList.remove('active');
  // update my entry in users list and re-render so avatars refresh everywhere
  const idx = state.users.findIndex(u => u.id === state.me.id);
  if (idx !== -1) state.users[idx] = { ...state.users[idx], ...state.me };
  renderMessages();
  scrollToBottom();
});
