// Bing sağlayıcısı — DDG bot korumasına takıldığında devreye giren yedek web motoru.
// Gerçek sonuç sayfasını döndürür; bağlantılar bing.com/ck/a yönlendirmesindedir ve
// buradaki `u` parametresi base64 olarak hedef adresi taşır.
import { UA, ProviderError, fetchWithTimeout, stripTags, htmlDecode, withRetry } from '../util.js';

const ENDPOINT = 'https://www.bing.com/search';

/** Bing yönlendirme bağlantısını gerçek adrese çevirir. */
export function decodeBingUrl(href = '') {
  let url = htmlDecode(href).trim();
  if (url.startsWith('//')) url = 'https:' + url;
  try {
    const target = new URL(url).searchParams.get('u');
    if (!target) return url;
    const base64 = target.startsWith('a1') ? target.slice(2) : target;
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const decoded = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return decoded.startsWith('http') ? decoded : url;
  } catch {
    return url;
  }
}

function parse(html) {
  const items = [];
  for (const block of html.split('<li class="b_algo"').slice(1)) {
    const link = /<h2>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!link) continue;

    const url = decodeBingUrl(link[1]);
    if (!/^https?:\/\//.test(url)) continue;

    const cite = /<cite[^>]*>([\s\S]*?)<\/cite>/.exec(block);
    const snippet = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block);

    items.push({
      title: stripTags(link[2]),
      url,
      snippet: snippet ? stripTags(snippet[1]) : '',
      displayUrl: cite ? stripTags(cite[1]).replace(/\s*›\s*/g, '/') : '',
    });
  }
  return items;
}

export async function search(query, { page = 1, lang = 'tr', limit = 10, timeout = 9000 } = {}) {
  const params = new URLSearchParams({
    q: query,
    mkt: lang === 'tr' ? 'tr-TR' : 'en-US', // bölgesel pazar: Türkçe sorguda alakasız sonuçları eler
    setlang: lang === 'tr' ? 'tr' : 'en',
    cc: lang === 'tr' ? 'TR' : 'US',
    count: String(Math.min(limit, 20)),
    form: 'QBLH',
    ...(page > 1 ? { first: String((page - 1) * 10 + 1) } : {}),
  });

  return withRetry(async () => {
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

    if (!response.ok) throw new ProviderError('bing', `Bing HTTP ${response.status}`, 502);

    const html = await response.text();
    const results = parse(html);

    if (results.length === 0) {
      const error = new ProviderError('bing', 'Bing bot doğrulaması istedi veya sonuç döndürmedi', 429);
      error.code = /captcha|Verify you are human|unusual traffic/i.test(html) ? 'rate_limited' : 'unavailable';
      throw error;
    }
    return results;
  }, { attempts: 2, delays: [700, 1600], shouldRetry: (err) => err.status === 504 });
}

export const meta = {
  id: 'bing',
  name: 'Bing',
  color: '#258ffa',
  needsKey: false,
};
