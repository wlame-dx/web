// Brave Search API sağlayıcısı (opsiyonel).
// Ücretsiz katmanı olan bu API, DDG hız sınırına takıldığında garantili web
// sonucu sağlar. BRAVE_API_KEY yoksa sessizce devre dışı kalır.
import { UA, fetchWithTimeout, stripTags, domainOf } from '../util.js';

const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

export function isConfigured() {
  return Boolean(process.env.BRAVE_API_KEY);
}

export async function search(query, { limit = 10, lang = 'tr', timeout = 8000 } = {}) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return [];

  const params = new URLSearchParams({
    q: query,
    count: String(Math.min(limit, 20)),
    country: lang === 'tr' ? 'tr' : 'us',
    search_lang: lang === 'tr' ? 'tr' : 'en',
    safesearch: 'moderate',
  });

  const response = await fetchWithTimeout(
    `${ENDPOINT}?${params}`,
    {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': key,
        'User-Agent': UA,
      },
    },
    timeout,
  );

  if (!response.ok) throw new Error(`Brave HTTP ${response.status}`);
  const data = await response.json();

  return (data.web?.results || []).map((item) => ({
    title: stripTags(item.title),
    url: item.url,
    snippet: stripTags(item.description || ''),
    displayUrl: item.meta_url?.hostname || domainOf(item.url),
    date: item.age || item.page_age || null,
  }));
}

export const meta = {
  id: 'brave',
  name: 'Brave Search',
  color: '#fb542b',
  needsKey: true,
};
