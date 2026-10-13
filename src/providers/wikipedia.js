// Wikipedia sağlayıcısı — MediaWiki Action API (anahtar gerektirmez).
// Dil kısıtlaması yoktur: varsayılan olarak tr ve en birlikte aranır ve
// birleştirilir (sorgu hangi dildeyse o dilin maddeleri doğal olarak öne çıkar).
// Paralel isteklerde ara sıra 429 döndüğü için önbellek + seyreltme + yeniden
// deneme uygulanır.
import { UA, fetchWithTimeout, stripTags, TTLCache, Throttle, withRetry, ProviderError, terms } from '../util.js';

// Kısıtlama yok: bu dillerin hepsi birlikte taranır.
const DEFAULT_LANGS = ['tr', 'en'];

// Aynı içerik çok sık isteniyor (arama + özet + öneri): önbellek şart.
const cache = new TTLCache(500, 15 * 60 * 1000);
const throttle = new Throttle(200);

function api(lang) {
  return `https://${lang}.wikipedia.org/w/api.php`;
}

/** `langs` (dizi) veya tek `lang` verilmişse onu, yoksa varsayılan dil listesini döner. */
function langList({ lang, langs } = {}) {
  if (Array.isArray(langs) && langs.length) return langs;
  if (lang) return [lang];
  return DEFAULT_LANGS;
}

/** Farklı dillerden gelen listeleri sırayla harmanlar (tr, en, tr, en …). */
function interleave(lists, limit, keyOf) {
  const seen = new Set();
  const merged = [];
  const maxLen = lists.reduce((max, list) => Math.max(max, list.length), 0);
  for (let i = 0; i < maxLen && merged.length < limit; i += 1) {
    for (const list of lists) {
      const item = list[i];
      if (item == null) continue;
      const key = keyOf(item);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
      if (merged.length >= limit) break;
    }
  }
  return merged;
}

async function getJson(url, { timeout = 8000, accept = 'application/json' } = {}) {
  const response = await fetchWithTimeout(url, { headers: { 'User-Agent': UA, Accept: accept } }, timeout);
  if (!response.ok) {
    const error = new ProviderError('wikipedia', `Wikipedia HTTP ${response.status}`, response.status);
    error.code = response.status === 429 ? 'rate_limited' : 'unavailable';
    throw error;
  }
  return response.json();
}

function resilient(task) {
  return withRetry(task, {
    attempts: 3,
    delays: [400, 1200, 2500],
    shouldRetry: (err) => err.code === 'rate_limited' || err.status === 504 || err.status === 429,
  });
}

/** Tek bir dildeki Wikipedia'da madde arar. */
async function searchOne(query, lang, limit, timeout) {
  const key = `search:${lang}:${limit}:${query.toLocaleLowerCase('tr')}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: String(limit),
    srprop: 'snippet|wordcount|timestamp',
    format: 'json',
    formatversion: '2',
    origin: '*',
  });

  const results = await resilient(() => throttle.run(async () => {
    const data = await getJson(`${api(lang)}?${params}`, { timeout });
    const hits = data?.query?.search ?? [];
    return hits.map((hit) => ({
      id: hit.pageid,
      title: hit.title,
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`,
      snippet: stripTags(hit.snippet || ''),
      words: hit.wordcount || 0,
      timestamp: hit.timestamp || null,
      lang,
    }));
  }));

  return cache.set(key, results);
}

/**
 * Madde araması. Dil kısıtlaması yok: `langs` verilmezse tr + en birleştirilir.
 * @returns {Promise<Array>} sonuç listesi
 */
export async function search(query, { lang, langs, limit = 6, timeout = 8000 } = {}) {
  const list = langList({ lang, langs });
  if (list.length === 1) return searchOne(query, list[0], limit, timeout);

  const per = Math.max(2, Math.ceil(limit / list.length) + 2);
  const lists = await Promise.all(list.map((l) => searchOne(query, l, per, timeout).catch(() => [])));
  return interleave(lists, limit, (item) => item.title.toLocaleLowerCase('tr'));
}

/** Tek bir dilde madde özeti (kart/özet kutusu için). */
export async function summary(title, { lang = 'tr', timeout = 8000 } = {}) {
  const key = `summary:${lang}:${title.toLocaleLowerCase('tr')}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;

  const result = await resilient(() => throttle.run(async () => {
    const response = await fetchWithTimeout(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } }, timeout);
    if (response.status === 404) return null;
    if (!response.ok) {
      const error = new ProviderError('wikipedia', `Wikipedia özet HTTP ${response.status}`, response.status);
      error.code = response.status === 429 ? 'rate_limited' : 'unavailable';
      throw error;
    }
    const data = await response.json();
    if (data.type === 'disambiguation') return null;
    return {
      title: data.title,
      description: data.description || '',
      extract: data.extract || '',
      url: data.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      thumbnail: data.thumbnail?.source || '',
      lang,
    };
  }));

  return cache.set(key, result);
}

/**
 * Sorgu sonundaki soru/inceleme eklerini ayıklar ("kubernetes nedir" → "kubernetes").
 */
function stripQuestionWords(query) {
  const patterns = [
    /\s+(ne|nedir|neden|nasıl|nasil|kim|kime|kimin|ne demek|ne anlama gelir|hakkında)\s*$/i,
    /\s+(what is|what are|what|who is|who|how to|how does|whats|meaning|definition|define)\s*$/i,
  ];
  let clean = query.trim();
  for (const pattern of patterns) {
    const next = clean.replace(pattern, '');
    if (next && next !== clean) clean = next;
  }
  return clean === query.trim() ? '' : clean;
}

/** Bir dil için en iyi özet adayını + güven puanını döner. */
async function bestSummaryOne(query, lang, timeout) {
  const direct = await summary(query, { lang, timeout }).catch(() => null);
  if (direct?.extract) return { found: direct, score: 50 };

  // "kubernetes nedir" gibi sorgularda madde adını doğrudan dene.
  const stripped = stripQuestionWords(query);
  if (stripped && stripped !== query) {
    const tryDirect = await summary(stripped, { lang, timeout }).catch(() => null);
    if (tryDirect?.extract) return { found: tryDirect, score: 45 };
  }

  const hits = await searchOne(query, lang, 5, timeout).catch(() => []);
  if (hits.length === 0) return null;

  const queryTerms = terms(query);
  let best = null;
  let bestScore = -1;

  // İlk birkaç maddeyi dene, sorguyla en iyi örtüşeni seç.
  for (const hit of hits.slice(0, 3)) {
    const found = await summary(hit.title, { lang, timeout }).catch(() => null);
    if (!found?.extract) continue;

    const title = found.title.toLocaleLowerCase('tr');
    const excerpt = found.extract.slice(0, 240).toLocaleLowerCase('tr');
    let score = 0;
    for (const term of queryTerms) {
      if (title.includes(term)) score += 6;
      if (excerpt.includes(term)) score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = found;
    }
  }

  return best ? { found: best, score: bestScore } : null;
}

/** Dil kısıtlaması olmadan en iyi özeti bulur (diller arasında en yüksek puanı seçer). */
export async function bestSummary(query, { lang, langs, timeout = 8000 } = {}) {
  const list = langList({ lang, langs });
  if (list.length === 1) {
    const only = await bestSummaryOne(query, list[0], timeout);
    return only?.found || null;
  }

  const candidates = await Promise.all(
    list.map((l) => bestSummaryOne(query, l, timeout).catch(() => null)),
  );
  let best = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.score > bestScore) {
      bestScore = candidate.score;
      best = candidate.found;
    }
  }
  return best;
}

/** Tek bir dilde otomatik tamamlama. */
async function suggestOne(query, lang, limit, timeout) {
  const params = new URLSearchParams({
    action: 'opensearch',
    search: query,
    limit: String(limit),
    namespace: '0',
    format: 'json',
    origin: '*',
  });

  try {
    const data = await resilient(() => throttle.run(() => getJson(`${api(lang)}?${params}`, { timeout })));
    return Array.isArray(data?.[1]) ? data[1] : [];
  } catch {
    return [];
  }
}

/** Öneri — dil kısıtlaması yok (tr + en birleşik). */
export async function suggest(query, { lang, langs, limit = 6, timeout = 5000 } = {}) {
  const list = langList({ lang, langs });
  if (list.length === 1) return suggestOne(query, list[0], limit, timeout);

  const lists = await Promise.all(list.map((l) => suggestOne(query, l, limit, timeout).catch(() => [])));
  return interleave(lists, limit, (text) => String(text).toLocaleLowerCase('tr'));
}

export { DEFAULT_LANGS };

export const meta = {
  id: 'wikipedia',
  name: 'Wikipedia',
  color: '#c8ccd1',
  needsKey: false,
};
