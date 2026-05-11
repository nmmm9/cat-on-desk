const fs = require('fs');
const path = require('path');
const { net } = require('electron');

const SITE_MAP_PATH = path.join(__dirname, 'site-map.json');

let SITE_MAP = {};
try {
  SITE_MAP = JSON.parse(fs.readFileSync(SITE_MAP_PATH, 'utf8'));
} catch {
  SITE_MAP = {};
}

const SITE_ENTRIES = Object.entries(SITE_MAP)
  .map(([key, domain]) => ({ key, lowerKey: key.toLowerCase(), domain }))
  .sort((a, b) => b.lowerKey.length - a.lowerKey.length);

const faviconCache = new Map();
const inflight = new Map();

const DOMAIN_REGEX = /([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|io|kr|co|org|ai|app|dev|me|tv|so|xyz|gg|info|jp|uk|fr|de|cn))/i;

function detectSite(title) {
  if (!title) return null;
  const lower = title.toLowerCase();
  for (const { lowerKey, domain } of SITE_ENTRIES) {
    if (lower.includes(lowerKey)) return domain;
  }
  const m = lower.match(DOMAIN_REGEX);
  if (m) return m[1];
  return null;
}

function downloadAsDataUrl(url) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val, why) => {
      if (settled) return;
      settled = true;
      if (!val) console.log('[favicon-dl] FAIL', url, why);
      resolve(val);
    };
    let req;
    try {
      req = net.request({ method: 'GET', url, redirect: 'follow' });
    } catch (e) {
      return finish(null, 'create: ' + e.message);
    }
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        return finish(null, 'status ' + res.statusCode);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (buf.length < 100) return finish(null, 'small ' + buf.length);
        const ctRaw = res.headers['content-type'] || 'image/png';
        const ct = Array.isArray(ctRaw) ? ctRaw[0] : ctRaw;
        finish(`data:${ct};base64,${buf.toString('base64')}`, null);
      });
      res.on('error', (e) => finish(null, 'res: ' + e.message));
    });
    req.on('error', (e) => finish(null, 'req: ' + e.message));
    setTimeout(() => finish(null, 'timeout'), 5000);
    try { req.end(); } catch (e) { finish(null, 'end: ' + e.message); }
  });
}

async function getFaviconForDomain(domain) {
  if (!domain) return null;
  if (faviconCache.has(domain)) return faviconCache.get(domain);
  if (inflight.has(domain)) return inflight.get(domain);
  return _fetchFavicon(domain);
}

async function getSiteFavicon(title) {
  const domain = detectSite(title);
  if (!domain) return null;
  return getFaviconForDomain(domain);
}

function _fetchFavicon(domain) {
  if (faviconCache.has(domain)) return Promise.resolve(faviconCache.get(domain));
  if (inflight.has(domain)) return inflight.get(domain);

  const candidates = [
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`,
    `https://${domain}/favicon.ico`,
  ];
  const promise = (async () => {
    for (const url of candidates) {
      const dataUrl = await downloadAsDataUrl(url);
      if (dataUrl) {
        faviconCache.set(domain, dataUrl);
        console.log('[favicon] OK', domain, '<-', url.split('/')[2], dataUrl.length + 'B');
        inflight.delete(domain);
        return dataUrl;
      }
    }
    console.log('[favicon] ALL FAIL', domain);
    inflight.delete(domain);
    return null;
  })();
  inflight.set(domain, promise);
  return promise;
}

module.exports = { getSiteFavicon, getFaviconForDomain, detectSite };
