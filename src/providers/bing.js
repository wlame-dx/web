// Bing sağlayıcısı — DDG bot korumasına takıldığında devreye giren yedek web motoru.
//
// Önce Bing'in resmi RSS çıktısı denenir (`&format=rss`): sunucu tarafında daha
// sağlamdır, temiz XML döner. RSS boş/başarısız olursa sonuç sayfası HTML'i
// ayrıştırılır; oradaki bağlantılar bing.com/ck/a yönlendirmesindedir ve `u`
// parametresi hedef adresi base64 olarak taşır.
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

/** Bing RSS (`format=rss`) çıktısını ayrıştırır — en sağlam yol. */
function parseRss(xml) {
  const items = [];
  for (const block of xml.split('<item>').slice(1)) {
    const link = /<link>([\s\S]*?)<\/link>/i.exec(block);
    if (!link) continue;
    const url = htmlDecode(link[1]).trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const title = /<title>([\s\S]*?)<\/title>/i.exec(block);
    const desc = /<description>([\s\S]*?)<\/description>/i.exec(block);
    items.push({
      title: stripTags(title ? title[1] : ''),
      url,
      snippet: desc ? stripTags(desc[1]) : '',
      displayUrl: '',
    });
  }
  return items;
}

function parseHtml(html) {
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
  const base = {
    q: query,
    mkt: lang === 'tr' ? 'tr-TR' : 'en-US', // bölgesel pazar: Türkçe sorguda alakasız sonuçları eler
    setlang: lang === 'tr' ? 'tr' : 'en',
    cc: lang === 'tr' ? 'TR' : 'US',
    count: String(Math.min(limit, 20)),
    ...(page > 1 ? { first: String((page - 1) * 10 + 1) } : {}),
  };
  const headers = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': lang === 'tr' ? 'tr-TR,tr;q=0.9,en;q=0.8' : 'en-US,en;q=0.9',
  };

  return withRetry(async () => {
    // 1) Sonuç sayfası HTML'i (Türkçe sorgularda da sonuç veren yol).
    const response = await fetchWithTimeout(
      `${ENDPOINT}?${new URLSearchParams({ ...base, form: 'QBLH' })}`,
      { headers },
      timeout,
    );

    if (!response.ok) throw new ProviderError('bing', `Bing HTTP ${response.status}`, 502);

    const html = await response.text();
    const results = parseHtml(html);
    if (results.length) return results.slice(0, limit);

    // 2) HTML boşsa resmî RSS çıktısını dene (`format=rss`); bazı dillerde
    //    boş feed döner, bu yüzden yalnızca yedek olarak kullanılır.
    try {
      const rssUrl = `${ENDPOINT}?${new URLSearchParams({ ...base, format: 'rss' })}`;
      const rssResponse = await fetchWithTimeout(rssUrl, { headers }, timeout);
      if (rssResponse.ok) {
        const xml = await rssResponse.text();
        const items = parseRss(xml);
        if (items.length) return items.slice(0, limit);
      }
    } catch {
      /* yok say */
    }

    const error = new ProviderError('bing', 'Bing bot doğrulaması istedi veya sonuç döndürmedi', 429);
    error.code = /captcha|Verify you are human|unusual traffic/i.test(html) ? 'rate_limited' : 'unavailable';
    throw error;
  }, { attempts: 2, delays: [700, 1600], shouldRetry: (err) => err.status === 504 });
}

export const meta = {
  id: 'bing',
  name: 'Bing',
  color: '#258ffa',
  needsKey: false,
};