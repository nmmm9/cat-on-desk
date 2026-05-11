(() => {
  if (window.__catondeskHooked) return;
  window.__catondeskHooked = true;

  function shouldHook(url, method) {
    if (!url) return false;
    if (String(method || 'GET').toUpperCase() !== 'POST') return false;
    return /\/api\//i.test(url);
  }

  function notifyDone(meta) {
    console.log('[catondesk] Genspark response done →', meta?.url);
    window.dispatchEvent(
      new CustomEvent('catondesk:ai-done', {
        detail: { site: 'Genspark', message: 'Genspark 응답 완료', ...(meta || {}) },
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
      const isStream =
        ct.includes('text/event-stream') ||
        ct.includes('application/x-ndjson') ||
        ct.includes('application/stream+json') ||
        (res.headers.get('transfer-encoding') || '').toLowerCase().includes('chunked');
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

  // XHR fallback (일부 엔드포인트가 XHR을 쓸 수 있음)
  const OrigXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const x = new OrigXHR();
    let watch = false;
    let watchUrl = '';
    const origOpen = x.open;
    x.open = function (method, url, ...rest) {
      if (shouldHook(url, method)) {
        watch = true;
        watchUrl = url;
      }
      return origOpen.call(this, method, url, ...rest);
    };
    x.addEventListener('loadend', () => {
      if (watch) notifyDone({ apiUrl: watchUrl, pageUrl: location.href });
    });
    return x;
  }
  PatchedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;

  console.log('[catondesk] hooked Genspark fetch + XHR');
})();
