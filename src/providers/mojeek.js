// Mojeek sağlayıcısı — DDG ve Bing veri merkezi IP'lerinden engellendiğinde
// devreye giren ikinci yedek web motoru (anahtar gerektirmez, bot koruması yok).
import { UA, ProviderError, fetchWithTimeout, stripTags, htmlDecode } from '../util.js';

const ENDPOINT = 'https://www.mojeek.com/search';

function parse(html) {
  const items = [];
  for (const block of html.split('<li').slice(1)) {
    const link = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) continue;

    let url = htmlDecode(link[1]).trim();
    if (url.startsWith('//')) url = 'https:' + url;
    if (!/^https?:\/\//i.test(url)) continue;

    // Mojeek ara sayfa yönlendirmesi (`/r?e=...&url=...`) çözülür.
    if (/mojeek\.com\/r\?/.test(url)) {
      try {
        const real = new URL(url).searchParams.get('url');
        if (real && /^https?:\/\//i.test(real)) url = real;
      } catch { /* yönlendirme yoksa ham adres kalır */ }
    }

    const snippet = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block);
    const cite = /class="ob"[^>]*>([\s\S]*?)</.exec(block);

    items.push({
      title: stripTags(link[2]),
      url,
      snippet: snippet ? stripTags(snippet[1]) : '',
      displayUrl: cite ? stripTags(cite[1]).trim() : '',
    });
  }
  return items;
}

export async function search(query, { page = 1, lang = 'tr', limit = 10, timeout = 9000 } = {}) {
  const params = new URLSearchParams({
    q: query,
    ...(page > 1 ? { s: String((page - 1) * 10) } : {}),
  });

  const response = await fetchWithTimeout(
    `${ENDPOINT}?${params}`,
    {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': lang === 'tr' ? 'tr-TR,tr;q=0.9,en;q=0.8' : 'en-US,en;q=0.9',
      },
    },
    timeout,
  );

  if (!response.ok) throw new ProviderError('mojeek', `Mojeek HTTP ${response.status}`, 502);

  const html = await response.text();
  const results = parse(html);

  if (results.length === 0) {
    const error = new ProviderError('mojeek', 'Mojeek sonuç döndürmedi', 429);
    error.code = /captcha|robot|rate limit/i.test(html) ? 'rate_limited' : 'unavailable';
    throw error;
  }
  return results.slice(0, limit);
}

export const meta = {
  id: 'mojeek',
  name: 'Mojeek',
  color: '#60a5fa',
  needsKey: false,
};