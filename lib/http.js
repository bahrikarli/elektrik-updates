const http = require('http');
const https = require('https');

function urlIcerikIndir(url, redirects = 5, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(String(url || '').trim());
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request(u, {
        method: 'GET',
        headers: {
          'User-Agent': 'elektrik-otomasyon-updater',
          Accept: '*/*',
          ...extraHeaders,
        },
      }, (res) => {
        const status = Number(res.statusCode || 0);
        const loc = res.headers?.location;
        if ([301, 302, 303, 307, 308].includes(status) && loc && redirects > 0) {
          res.resume();
          const nextUrl = new URL(loc, u).toString();
          urlIcerikIndir(nextUrl, redirects - 1, extraHeaders).then(resolve).catch(reject);
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.end();
      req.on('error', reject);
      req.setTimeout(30000, () => req.destroy(new Error('Timeout')));
    } catch (e) {
      reject(e);
    }
  });
}

async function githubReleaseAssetUrl(repo, tag, assetName) {
  const repoTxt = String(repo || '').trim();
  const tagTxt = String(tag || '').trim();
  const assetTxt = String(assetName || '').trim();
  if (!repoTxt || !tagTxt || !assetTxt) return null;
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(repoTxt).replace('%2F', '/')}/releases/tags/${encodeURIComponent(tagTxt)}`;
  const buf = await urlIcerikIndir(apiUrl, 5, { Accept: 'application/vnd.github+json' });
  const rel = JSON.parse(String(buf || '{}'));
  const assets = Array.isArray(rel?.assets) ? rel.assets : [];
  const a = assets.find((x) => String(x?.name || '').trim() === assetTxt);
  return a?.browser_download_url || null;
}

function githubReleaseAssetUrlTahmini(repo, tag, assetName) {
  const repoTxt = String(repo || '').trim().replace(/^\/+|\/+$/g, '');
  const tagTxt = encodeURIComponent(String(tag || '').trim());
  const assetTxt = encodeURIComponent(String(assetName || '').trim());
  if (!repoTxt || !tagTxt || !assetTxt) return null;
  return `https://github.com/${repoTxt}/releases/download/${tagTxt}/${assetTxt}`;
}

module.exports = { urlIcerikIndir, githubReleaseAssetUrl, githubReleaseAssetUrlTahmini };
