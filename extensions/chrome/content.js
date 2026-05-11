(() => {
  const NOTIFY_URL = 'http://127.0.0.1:23461/ai-response-done';
  const SITE_COOLDOWN_MS = { default: 1500, Gemini: 5000, Genspark: 5000 };
  let lastNotifyAt = 0;

  const HOST = location.hostname;
  let injectFile = null;
  if (HOST.includes('chatgpt') || HOST.includes('openai')) injectFile = 'inject-chatgpt.js';
  else if (HOST.includes('claude')) injectFile = 'inject-claude.js';
  // Gemini는 manifest에서 world:MAIN으로 직접 주입 (CSP 우회)

  if (injectFile) {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL(injectFile);
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  }

  window.addEventListener('catondesk:ai-done', (e) => {
    const now = Date.now();
    const site = (e.detail && e.detail.site) || 'default';
    const cd = SITE_COOLDOWN_MS[site] || SITE_COOLDOWN_MS.default;
    if (now - lastNotifyAt < cd) return;
    lastNotifyAt = now;
    const detail = e.detail || {};
    fetch(NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site: detail.site || 'AI',
        message: detail.message || 'AI 응답 완료',
        url: detail.pageUrl || location.href,
      }),
      mode: 'cors',
    }).catch(() => {});
  });
})();
