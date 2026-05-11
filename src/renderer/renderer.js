console.log('[renderer] script start');
window.addEventListener('error', (e) => {
  console.log('[renderer] window error:', e.message, 'at', e.filename + ':' + e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
  console.log('[renderer] unhandled rejection:', e.reason && e.reason.message || e.reason);
});

const petEl = document.getElementById('pet');
const catImg = document.getElementById('cat-img');
const bubbleEl = document.getElementById('bubble');
const badgeIconEl = document.getElementById('badge-icon');
const badgeLabelEl = document.getElementById('badge-label');
console.log('[renderer] DOM refs OK');

const THEME_BASE = '../theme/default-cat/';

const CLICK_LINES = [
  '먀',
  '꾸륵',
  '꾹',
  '쉿',
  '마오',
  '하지마라',
  '아야',
  '.....',
];

let frames = [];
let frameIdx = 0;
let frameInterval = 400;
let frameTimer = null;
let currentStateName = '';

function applyFrame() {
  if (!frames.length) return;
  catImg.src = THEME_BASE + frames[frameIdx];
}

function setFrames(newFrames, intervalMs, manualAdvance) {
  frames = Array.isArray(newFrames) ? newFrames.slice() : [];
  frameInterval = intervalMs || 400;
  frameIdx = 0;
  if (frameTimer) {
    clearInterval(frameTimer);
    frameTimer = null;
  }
  if (frames.length === 0) return;
  applyFrame();
  if (frames.length > 1 && !manualAdvance) {
    frameTimer = setInterval(() => {
      frameIdx = (frameIdx + 1) % frames.length;
      applyFrame();
    }, frameInterval);
  }
}

function advanceFrame() {
  if (frames.length < 2) return;
  frameIdx = (frameIdx + 1) % frames.length;
  applyFrame();
}

window.catApi.onState((payload) => {
  if (!payload) return;
  if (payload.state !== currentStateName) {
    currentStateName = payload.state;
    petEl.dataset.state = payload.state;
  }
  if (payload.state === 'walk' && typeof payload.direction === 'number') {
    if (payload.direction > 0) catImg.classList.add('flipped');
    else catImg.classList.remove('flipped');
  } else {
    catImg.classList.remove('flipped');
  }
  const manual = payload.state === 'laptop';
  setFrames(payload.frames, payload.frameIntervalMs, manual);
});

window.catApi.onFrameAdvance(() => {
  if (currentStateName === 'laptop') advanceFrame();
});

const notifyListEl = document.getElementById('notify-list');
const MAX_NOTIFIES = 5;

function syncCardCount() {
  const count = notifyListEl.children.length;
  document.documentElement.style.setProperty('--card-count', String(count));
  window.catApi.notifyResize(count);
}

function removeCard(card) {
  card.remove();
  updateNotifyVisibility();
  syncCardCount();
}

function updateNotifyVisibility() {
  if (notifyListEl.children.length === 0) {
    notifyListEl.hidden = true;
    isPassthrough = false;
    window.catApi.setPassthrough(true);
    isPassthrough = true;
  } else {
    notifyListEl.hidden = false;
  }
}

function createNotifyCard(payload) {
  const card = document.createElement('div');
  card.className = 'notify-card';

  const img = document.createElement('img');
  img.className = 'icon';
  img.alt = '';
  if (payload.iconDataUrl && payload.iconDataUrl.length > 200) {
    img.src = payload.iconDataUrl;
  } else {
    img.style.display = 'none';
  }
  img.addEventListener('error', () => {
    console.log('[renderer] notify icon load failed, src.length=', (img.src || '').length);
    img.style.display = 'none';
  });
  img.addEventListener('load', () => {
    console.log('[renderer] notify icon loaded, src.length=', (img.src || '').length);
  });

  const text = document.createElement('div');
  text.className = 'text';
  const siteDiv = document.createElement('div');
  siteDiv.className = 'site';
  siteDiv.textContent = payload.site || '';
  const msgDiv = document.createElement('div');
  msgDiv.className = 'message';
  msgDiv.textContent = payload.message || '응답 완료!';
  text.appendChild(siteDiv);
  text.appendChild(msgDiv);

  card.appendChild(img);
  card.appendChild(text);

  card.addEventListener('click', () => {
    if (payload.url) window.catApi.openUrl(payload.url);
    removeCard(card);
  });

  return card;
}

function addNotify(payload) {
  while (notifyListEl.children.length >= MAX_NOTIFIES) {
    notifyListEl.firstChild.remove();
  }
  const card = createNotifyCard(payload);
  notifyListEl.appendChild(card);
  notifyListEl.hidden = false;
  window.catApi.setPassthrough(false);
  isPassthrough = false;
  syncCardCount();
}

const notifySound = new Audio('sounds/notify.mp3');
notifySound.preload = 'auto';
notifySound.volume = 0.3;

function playNotifySound() {
  try {
    notifySound.currentTime = 0;
    const p = notifySound.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {}
}

window.catApi.onNotify((payload) => {
  if (!payload) return;
  addNotify(payload);
  catImg.classList.remove('notify-bounce');
  void catImg.offsetWidth;
  catImg.classList.add('notify-bounce');
  playNotifySound();
});

let currentAppLabel = '';
let currentAppIcon = '';
let speechTimer = null;

badgeIconEl.addEventListener('error', () => {
  console.log('[renderer] badge icon load failed, src.length=', (badgeIconEl.src || '').length);
  badgeIconEl.hidden = true;
  badgeIconEl.removeAttribute('src');
});
badgeIconEl.addEventListener('load', () => {
  console.log('[renderer] badge icon loaded, src.length=', (badgeIconEl.src || '').length);
});

function showBubble(text, iconUrl) {
  const hasIcon = !!(iconUrl && iconUrl.length > 200);
  const hasText = !!text;

  if (hasIcon) {
    badgeIconEl.src = iconUrl;
    badgeIconEl.hidden = false;
  } else {
    badgeIconEl.hidden = true;
    badgeIconEl.removeAttribute('src');
  }

  if (hasText) {
    badgeLabelEl.textContent = text;
    badgeLabelEl.hidden = false;
  } else {
    badgeLabelEl.textContent = '';
    badgeLabelEl.hidden = true;
  }

  bubbleEl.hidden = !(hasIcon || hasText);
}

function showAppBadge() {
  showBubble(currentAppLabel, currentAppIcon);
}

function showSpeech(text, durationMs = 1500) {
  showBubble(text, null);
  if (speechTimer) clearTimeout(speechTimer);
  speechTimer = setTimeout(() => {
    speechTimer = null;
    showAppBadge();
  }, durationMs);
}

function shortLabel(info) {
  const exe = (info.exe || '').toLowerCase();
  const title = info.title || '';
  if (exe.includes('chrome') || exe.includes('msedge') || exe.includes('whale')) {
    const t = title.replace(/ - (Google Chrome|Microsoft.+Edge|Whale)$/i, '');
    return t.length > 24 ? t.slice(0, 24) + '…' : (t || 'Browser');
  }
  if (!exe) return '';
  return exe.replace(/\.exe$/i, '');
}

window.catApi.onForeground((info) => {
  currentAppLabel = shortLabel(info);
  currentAppIcon = info.iconDataUrl || '';
  if (!speechTimer) showAppBadge();
});

const DRAG_THRESHOLD_PX = 4;
let dragSession = null;

catImg.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.catApi.testWalk();
});

catImg.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  dragSession = {
    startX: e.screenX,
    startY: e.screenY,
    moved: false,
  };
  window.catApi.dragBegin();
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (dragSession) {
    setPassthrough(false);
    const dx = e.screenX - dragSession.startX;
    const dy = e.screenY - dragSession.startY;
    if (!dragSession.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      dragSession.moved = true;
      catImg.style.cursor = 'grabbing';
    }
    return;
  }
  setPassthrough(!isOverInteractive(e.clientX, e.clientY));
});

function isOverInteractive(x, y) {
  const winW = window.innerWidth;
  const winH = window.innerHeight;
  const catLeft = (winW - 140) / 2;
  const catRight = catLeft + 140;
  const catBottomCss = parseFloat(getComputedStyle(catImg).bottom) || 60;
  const catBottom = winH - catBottomCss;
  const catTop = catBottom - 140;
  if (x >= catLeft && x <= catRight && y >= catTop && y <= catBottom) return true;
  if (!bubbleEl.hidden) {
    const r = bubbleEl.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  if (!notifyListEl.hidden) {
    const r = notifyListEl.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
}

let isPassthrough = true;
function setPassthrough(p) {
  if (p === isPassthrough) return;
  isPassthrough = p;
  window.catApi.setPassthrough(p);
}

window.addEventListener('mouseup', () => {
  if (!dragSession) return;
  const wasClick = !dragSession.moved;
  dragSession = null;
  catImg.style.cursor = '';
  window.catApi.dragEnd();
  if (wasClick) {
    showSpeech(pickLine(), 1500);
  }
});

let lastLineIdx = -1;
function pickLine() {
  if (CLICK_LINES.length === 1) return CLICK_LINES[0];
  let i = Math.floor(Math.random() * CLICK_LINES.length);
  if (i === lastLineIdx) i = (i + 1) % CLICK_LINES.length;
  lastLineIdx = i;
  return CLICK_LINES[i];
}
