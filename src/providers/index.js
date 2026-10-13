// Sağlayıcıları birleştiren katman: paralel arama, tekilleştirme, sıralama.
import * as duckduckgo from './duckduckgo.js';
import * as bing from './bing.js';
import * as marginalia from './marginalia.js';
import * as wikipedia from './wikipedia.js';
import * as google from './google.js';
import * as brave from './brave.js';
import { dedupeKey, faviconFor, domainOf, terms } from '../util.js';

export const providers = { duckduckgo, bing, marginalia, wikipedia, google, brave };

export const providerList = [
  duckduckgo.meta,
  bing.meta,
  marginalia.meta,
  wikipedia.meta,
  google.meta,
  brave.meta,
];

// Yedek motor: DDG engellendiğinde sonuç üreten ikinci web kaynağı.
const FALLBACK = (process.env.WEB_FALLBACK || 'bing').toLowerCase();

/** Başarısız sağlayıcıyı dostça bir "uyarı"ya çevirir. */
function toNotice(err) {
  if (err.code === 'rate_limited' || err.code === 'circuit_open') {
    return {
      provider: 'duckduckgo',
      tone: 'warn',
      message: FALLBACK === 'bing'
        ? 'DuckDuckGo bu ağdan gelen istekleri şu an bot korumasıyla engelliyor. Sonuçlar yedek motor ve diğer kaynaklardan getirildi.'
        : 'DuckDuckGo şu an hız sınırı uyguluyor. Sonuçlar diğer kaynaklardan getirildi.',
    };
  }
  return { provider: 'duckduckgo', tone: 'warn', message: err.message };
}

/** Sonuç puanı: sorgu terimleri başlıkta geçiyorsa yükselir. */
function score(result, queryTerms) {
  const title = result.title.toLocaleLowerCase('tr');
  const snippet = (result.snippet || '').toLocaleLowerCase('tr');
  let value = 0;
  for (const term of queryTerms) {
    if (title.includes(term)) value += 6;
    if (snippet.includes(term)) value += 2;
  }
  if (result.provider === 'wikipedia') value += 3;
  if (result.provider === 'google') value += 2;
  if (result.provider === 'duckduckgo') value += 1;
  if (result.provider === 'bing') value += 1;
  if (result.snippet) value += 1;
  return value;
}

function withMeta(item, provider) {
  const url = item.url;
  return {
    title: item.title,
    url,
    snippet: item.snippet || '',
    provider,
    domain: item.displayUrl || domainOf(url),
    favicon: faviconFor(url),
    date: item.date || null,
  };
}

const FALLBACK_MODULES = { bing };

/** Web sonuçları: DDG + yedek motor (Bing) + Marginalia birlikte taranır; sıralama alakaya göre yapılır. */
async function webResults(query, { page, notices, errors }) {
  const collected = [];
  const push = (items, provider) => {
    for (const item of items) collected.push({ ...item, provider });
  };

  const margin = FALLBACK_MODULES[FALLBACK];

  await Promise.all([
    // 1) DuckDuckGo — birincil web kaynağı (dil kısıtı yok, dünya geneli).
    duckduckgo.search(query, { page })
      .then((items) => push(items, 'duckduckgo'))
      .catch((err) => notices.push(toNotice(err))),

    // 2) Yedek motor (varsayılan Bing) — "ne bulduysa" katmanı.
    margin
      ? margin.search(query, { page, limit: 10 })
        .then((items) => push(items, FALLBACK))
        .catch((err) => errors.push({ provider: FALLBACK, message: err.message }))
      : Promise.resolve(),

    // 3) Marginalia — bağımsız "küçük web" dizini; ek kapsam.
    marginalia.search(query, { page, limit: 10 })
      .then((items) => push(items, 'marginalia'))
      .catch(() => notices.push({ provider: 'marginalia', tone: 'warn', message: 'Marginalia bu sorguda sonuç döndürmedi.' })),
  ]);

  return collected;
}

/**
 * Tüm sağlayıcılarda arama yapar.
 * @returns {Promise<object>} birleşik sonuç kümesi
 */
export async function searchAll(query, { page = 1, includeNews = true } = {}) {
  const started = Date.now();
  const queryTerms = terms(query);
  const errors = [];
  const notices = [];

  const tasks = [
    webResults(query, { page, notices, errors }).then((items) => ({ key: 'web', items })),

    brave.search(query, { limit: 10 })
      .then((items) => ({ key: 'brave', items }))
      .catch((err) => { errors.push({ provider: 'brave', message: err.message }); return { key: 'brave', items: [] }; }),

    // Wikipedia: dil kısıtı yok — tr + en birleştirilir.
    wikipedia.search(query, { limit: 6 })
      .then((items) => ({ key: 'wikipedia', items }))
      .catch((err) => { errors.push({ provider: 'wikipedia', message: err.message }); return { key: 'wikipedia', items: [] }; }),

    google.webSearch(query, { limit: 10 })
      .then((items) => ({ key: 'google', items }))
      .catch((err) => { errors.push({ provider: 'google', message: err.message }); return { key: 'google', items: [] }; }),

    includeNews
      ? google.news(query, { limit: 8 })
        .then((items) => ({ key: 'news', items }))
        .catch((err) => { errors.push({ provider: 'google-news', message: err.message }); return { key: 'news', items: [] }; })
      : Promise.resolve({ key: 'news', items: [] }),

    wikipedia.bestSummary(query)
      .then((summary) => ({ key: 'summary', items: summary }))
      .catch(() => ({ key: 'summary', items: null })),
  ];

  const settled = await Promise.all(tasks);
  const bucket = Object.fromEntries(settled.map((entry) => [entry.key, entry.items]));

  const counts = { duckduckgo: 0, bing: 0, marginalia: 0, google: 0, brave: 0 };
  const webItems = [
    ...(bucket.google || []).map((item) => withMeta(item, 'google')),
    ...(bucket.brave || []).map((item) => withMeta(item, 'brave')),
    ...(bucket.web || []).map((item) => {
      counts[item.provider] = (counts[item.provider] || 0) + 1;
      return withMeta(item, item.provider);
    }),
  ];

  // Tekilleştirme + sıralama
  const seen = new Map();
  for (const item of webItems) {
    const key = dedupeKey(item.url);
    if (!key || seen.has(key)) continue;
    seen.set(key, item);
  }

  // Alakasızlık filtresi: sorgu terimi başlıkta/URL'de geçiyor mu?
  // (Bing gibi yedek motorlar bazen konu dışı sayfa döndürüyor; bunları çöpe atarız.)
  function classify(item, terms) {
    const title = item.title.toLocaleLowerCase('tr');
    const url = item.url.toLocaleLowerCase('tr');
    const snippet = (item.snippet || '').toLocaleLowerCase('tr');
    let strong = 0;
    let mid = 0;
    for (const term of terms) {
      if (title.includes(term) || url.includes(term)) strong += 1;
      else if (snippet.includes(term)) mid += 1;
    }
    return { strong, mid };
  }

  const scored = [...seen.values()].map((item) => ({
    ...item,
    score: score(item, queryTerms),
    match: classify(item, queryTerms),
  }));

  const rankGroup = (item) => (item.match.strong > 0 ? 2 : item.match.mid > 0 ? 1 : 0);
  scored.sort((a, b) => {
    const groupDiff = rankGroup(b) - rankGroup(a);
    return groupDiff !== 0 ? groupDiff : b.score - a.score;
  });

  // Konu dışı sonuçlar bir kenara; en az 6 alakalı sonuç varsa çöpleri tamamen at.
  const relevant = scored.filter((item) => rankGroup(item) > 0);
  const picked = relevant.length >= 6
    ? relevant
    : scored;

  const results = picked.slice(0, 10).map(({ match, ...item }) => item);

  const wikiResults = (bucket.wikipedia || []).map((item) => withMeta(
    { title: item.title, url: item.url, snippet: item.snippet }, 'wikipedia',
  ));

  const news = (bucket.news || []).map((item) => ({
    title: item.title,
    url: item.url,
    snippet: item.snippet,
    date: item.date,
    sourceName: item.sourceName,
    provider: 'google-news',
  }));

  // Web motorları bu ağdan engellendiyse sekme boş kalır — doldurma yapmayız.
  // Yalnızca kullanıcıya durumu açıkça bildiririz.
  const finalResults = results;
  if (finalResults.length === 0) {
    notices.push({
      provider: 'web',
      tone: 'info',
      message: 'Bu ağdan web motorlarına ulaşılamadı; web sonucu bulunamadı.',
    });
  }

  return {
    query,
    page,
    took: Date.now() - started,
    results: finalResults,
    wikipedia: wikiResults,
    wikipediaSummary: bucket.summary || null,
    news,
    errors,
    notices,
    circuit: duckduckgo.circuitState(),
    sources: {
      duckduckgo: counts.duckduckgo,
      bing: counts.bing,
      marginalia: counts.marginalia,
      brave: counts.brave,
      wikipedia: wikiResults.length,
      google: counts.google,
      googleNews: news.length,
      webTotal: finalResults.length,
      googleCustomSearch: google.isConfigured(),
      braveSearch: brave.isConfigured(),
      fallback: FALLBACK,
    },
  };
}

/** Öneriler: Google autocomplete + Wikipedia opensearch birleşimi (dil kısıtı yok). */
export async function suggestAll(query) {
  const [googleSuggestions, wikiSuggestions] = await Promise.all([
    google.suggest(query).catch(() => []),
    wikipedia.suggest(query).catch(() => []),
  ]);
  const merged = [];
  const push = (text, source) => {
    const value = String(text || '').trim();
    if (!value) return;
    const key = value.toLocaleLowerCase('tr');
    if (merged.some((item) => item.text.toLocaleLowerCase('tr') === key)) return;
    merged.push({ text: value, source });
  };
  googleSuggestions.forEach((text) => push(text, 'google'));
  wikiSuggestions.forEach((text) => push(text, 'wikipedia'));
  return merged.slice(0, 10);
}
