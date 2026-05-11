(() => {
  if (window.__catondeskHooked) return;
  window.__catondeskHooked = true;

  const URL_PATTERN = /\/backend-api\/.*(conversation|message|completion)/i;
  const FALLBACK_URL_PATTERN = /\/backend-api\//i;

  function shouldHook(url, method) {
    if (!url) return false;
    if (String(method || 'GET').toUpperCase() !== 'POST') return false;
    return URL_PATTERN.test(url) || FALLBACK_URL_PATTERN.test(url);
  }

  function notifyDone(meta) {
    console.log('[catondesk] response done →', meta?.url);
    window.dispatchEvent(
      new CustomEvent('catondesk:ai-done', {
        detail: { site: 'ChatGPT', message: 'ChatGPT 응답 완료', ...(meta || {}) },
      })
    );
  }

  const origFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input && input.url;
    const method = (init && init.method) || (input && input.method) || 'GET';
    if (!shouldHook(url, method)) return origFetch(input, init);

    const res = await origFetch(input, init);
    try {
      if (!res.body) return res;
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      const isStream = ct.includes('text/event-stream') || ct.includes('application/x-ndjson');
      if (!isStream) return res;

      const [a, b] = res.body.tee();
      const cloned = new Response(a, { status: res.status, statusText: res.statusText, headers: res.headers });
      (async () => {
        const reader = b.getReader();
        try {
          while (true) {
            const { done } = await reader.read();
            if (done) break;
          }
          notifyDone({ apiUrl: url, pageUrl: location.href });
        } catch {}
      })();
      return cloned;
    } catch {
      return res;
    }
  };

  console.log('[catondesk] hooked ChatGPT fetch (v2 - broader URL + SSE check)');
})();
