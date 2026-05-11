const SSE_URL = 'http://127.0.0.1:23461/events';
const RECONNECT_MS = 3000;

let abortCtrl = null;
let isConnected = false;

async function connect() {
  if (isConnected) return;
  if (abortCtrl) {
    try { abortCtrl.abort(); } catch {}
  }
  abortCtrl = new AbortController();
  isConnected = true;
  try {
    console.log('[catondesk-bg] connecting to', SSE_URL);
    const res = await fetch(SSE_URL, { signal: abortCtrl.signal });
    if (!res.ok || !res.body) throw new Error('bad response');
    console.log('[catondesk-bg] connected');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const lines = block.split('\n');
        let dataLine = '';
        for (const ln of lines) {
          if (ln.startsWith('data:')) dataLine += ln.slice(5).trim();
        }
        if (!dataLine) continue;
        let msg;
        try { msg = JSON.parse(dataLine); } catch { continue; }
        handleMessage(msg);
      }
    }
  } catch (e) {
    // ignore - retry
  }
  isConnected = false;
  setTimeout(connect, RECONNECT_MS);
}

function handleMessage(msg) {
  console.log('[catondesk-bg] msg', msg);
  if (!msg || msg.type !== 'activate-tab' || !msg.url) return;
  chrome.tabs.query({}, (tabs) => {
    const target = findBestTab(tabs, msg.url);
    console.log('[catondesk-bg] target', target ? `${target.id} ${target.url}` : 'NONE', 'of', tabs.length);
    if (!target) return;
    chrome.tabs.update(target.id, { active: true });
    chrome.windows.update(target.windowId, { focused: true, drawAttention: true });
  });
}

function findBestTab(tabs, target) {
  let exact = null;
  let domainMatch = null;
  let targetDomain = null;
  try { targetDomain = new URL(target).hostname; } catch {}
  for (const t of tabs) {
    if (!t.url) continue;
    if (t.url === target) { exact = t; break; }
    if (targetDomain) {
      try {
        if (new URL(t.url).hostname === targetDomain && !domainMatch) domainMatch = t;
      } catch {}
    }
  }
  return exact || domainMatch;
}

// 알람으로 서비스 워커 깨우기 + 재연결 보장
chrome.alarms.create('catondesk-keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'catondesk-keepalive') return;
  if (!isConnected) connect();
});

// 서비스 워커 시작 시 연결
chrome.runtime.onStartup.addListener(() => connect());
chrome.runtime.onInstalled.addListener(() => connect());
connect();
