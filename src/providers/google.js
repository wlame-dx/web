// Google sağlayıcısı.
//
// Google'ın sonuç sayfası (google.com/search) bot koruması döndürdüğü için
// doğrudan kazıma yapılmaz. Bunun yerine Google'ın AÇIK uç noktaları kullanılır:
//   1) Autocomplete  → suggestqueries.google.com  (öneriler)
//   2) News RSS       → news.google.com/rss/search (haberler)
//   3) Custom Search JSON API → gerçek web sonuçları (GOOGLE_API_KEY + GOOGLE_CSE_ID gerekir)
import { UA, fetchWithTimeout, stripTags, htmlDecode, TTLCache, withRetry } from '../util.js';

const SUGGEST_URL = 'https://suggestqueries.google.com/complete/search';
const NEWS_URL = 'https://news.google.com/rss/search';
const CSE_URL = 'https://www.googleapis.com/customsearch/v1';

const cache = new TTLCache(300, 5 * 60 * 1000);

export function config() {
  return {
    key: process.env.GOOGLE_API_KEY || '',
    cx: process.env.GOOGLE_CSE_ID || '',
  };
}

export function isConfigured() {
  const { key, cx } = config();
  return Boolean(key && cx);
}

/** Google otomatik tamamlama. google.com'a giden canlı sorgu. */
export async function suggest(query, { hl = 'tr', timeout = 6000 } = {}) {
  const key = `suggest:${hl}:${query.toLocaleLowerCase('tr')}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const url = `${SUGGEST_URL}?client=firefox&hl=${hl}&q=${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(
    url,
    { headers: { 'User-Agent': UA, Accept: 'application/json' } },
    timeout,
  );
  if (!response.ok) return [];
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    return cache.set(key, Array.isArray(data?.[1]) ? data[1] : []);
  } catch {
    return [];
  }
}

function parseRss(xml) {
  const items = [];
  const blocks = xml.split('<item>').slice(1);
  for (const block of blocks) {
    const pick = (tag) => {
      const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(block);
      return m ? m[1] : '';
    };
    const title = stripTags(pick('title'));
    const link = stripTags(pick('link'));
    const date = stripTags(pick('pubDate'));
    const sourceMatch = /<source[^>]*>([\s\S]*?)<\/source>/.exec(block);
    if (!title || !link) continue;
    items.push({
      title,
      url: link,
      snippet: sourceMatch ? stripTags(sourceMatch[1]) : '',
      date: date ? new Date(date).toISOString() : null,
      sourceName: sourceMatch ? stripTags(sourceMatch[1]) : 'Google Haberler',
    });
  }
  return items;
}

/** Google Haberler RSS. */
export async function news(query, { hl = 'tr', gl = 'TR', ceid = 'TR:tr', limit = 8, timeout = 8000 } = {}) {
  const key = `news:${hl}:${limit}:${query.toLocaleLowerCase('tr')}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const url = `${NEWS_URL}?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  const items = await withRetry(async () => {
    const response = await fetchWithTimeout(
      url,
      { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml' } },
      timeout,
    );
    if (!response.ok) throw new Error(`Google Haberler HTTP ${response.status}`);
    const xml = await response.text();
    return parseRss(xml).slice(0, limit);
  }, { attempts: 2, delays: [600, 1500] });

  return cache.set(key, items);
}

/** Google Programmable Search (Custom Search JSON API). Anahtar yoksa boş döner. */
export async function webSearch(query, { limit = 10, timeout = 8000, lang = 'tr' } = {}) {
  const { key, cx } = config();
  if (!key || !cx) return [];

  const params = new URLSearchParams({
    key,
    cx,
    q: query,
    num: String(Math.min(limit, 10)),
    hl: lang,
  });
  const response = await fetchWithTimeout(
    `${CSE_URL}?${params}`,
    { headers: { 'User-Agent': UA } },
    timeout,
  );
  if (!response.ok) {
    throw new Error(`Google CSE HTTP ${response.status}`);
  }
  const data = await response.json();
  return (data.items || []).map((item) => ({
    title: htmlDecode(item.title),
    url: item.link,
    snippet: htmlDecode(item.snippet || ''),
    displayUrl: item.displayLink || '',
  }));
}

export const meta = {
  id: 'google',
  name: 'Google',
  color: '#4285f4',
  needsKey: true,
};
