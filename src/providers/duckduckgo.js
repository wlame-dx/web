// DuckDuckGo sağlayıcısı.
// Not: DDG'nin HTML arayüzü datacenter IP'lerinde bot korumasına takılıyor.
// Bu yüzden birden fazla uç nokta sırayla denenir (POST gövdesi ile).
import {
  UA, ProviderError, fetchWithTimeout, decodeRedirect, stripTags, htmlDecode,
  Throttle, withRetry,
} from '../util.js';

const ENDPOINTS = [
  { url: 'https://duckduckgo.com/html/', kind: 'html' },
  { url: 'https://html.duckduckgo.com/html/', kind: 'html' },
  { url: 'https://lite.duckduckgo.com/lite/', kind: 'lite' },
];

const BLOCK_MARKERS = ['anomaly.js', 'cc=botnet', 'challenge-form', 'If you are not a robot'];

// DDG kısa sürede çok istek gelirse bot korumasına geçiyor; istekleri seyreltiyoruz.
const throttle = new Throttle(Number(process.env.WLAME_DDG_INTERVAL || 1600));

// Devre kesici: üst üste engellenirsek belli bir süre DDG'yi tamamen atlarız,
// böylece her arama gereksiz yere beklemez ve yedek motor devreye girer.
const breaker = {
  failures: 0,
  openUntil: 0,
  threshold: Number(process.env.WLAME_DDG_FAILURES || 2),
  cooldownMs: Number(process.env.WLAME_DDG_COOLDOWN || 5 * 60 * 1000),
};

export function circuitState() {
  return {
    open: Date.now() < breaker.openUntil,
    remainingMs: Math.max(0, breaker.openUntil - Date.now()),
    failures: breaker.failures,
  };
}



function collect(regex, html) {
  const out = [];
  let match;
  while ((match = regex.exec(html)) !== null) out.push(match);
  return out;
}

/** Klasik (duckduckgo.com/html) sayfa düzeni. */
function parseClassic(html) {
  const results = [];
  const blocks = html.split(/<div class="result (?:results_links|result--ad)/).slice(1);
  for (const block of blocks) {
    if (block.includes('result--ad') || block.includes('badge--ad')) continue;
    const titleMatch = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!titleMatch) continue;
    const snippetMatch =
      /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block) ||
      /class="result__snippet"[^>]*>([\s\S]*?)<\/div>/.exec(block) ||
      /class="result__snippet"[^>]*>([\s\S]*?)<\/span>/.exec(block);
    results.push({
      title: stripTags(titleMatch[2]),
      url: decodeRedirect(titleMatch[1]),
      snippet: snippetMatch ? stripTags(snippetMatch[1]) : '',
    });
  }
  return results;
}

/** Hafif (lite.duckduckgo.com) sayfa düzeni. */
function parseLite(html) {
  const links = collect(
    /<a\b[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/g,
    html,
  ).map((m) => ({
    text: stripTags(m[1]),
    href: (/href=['"]([^'"]+)['"]/.exec(m[0]) || [])[1] || '',
  }));

  const snippets = collect(
    /<td\b[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g,
    html,
  ).map((m) => stripTags(m[1]));

  return links.map((link, index) => ({
    title: link.text,
    url: decodeRedirect(link.href),
    snippet: snippets[index] || '',
  }));
}

function parseHtml(html, kind) {
  return kind === 'lite' ? parseLite(html) : parseClassic(html);
}

function assertNotBlocked(html, url) {
  if (BLOCK_MARKERS.some((marker) => html.includes(marker))) {
    const error = new ProviderError('duckduckgo', `Bot koruması algılandı (${url})`, 429);
    error.code = 'rate_limited';
    throw error;
  }
}

async function attempt(query, { page, region, timeout }) {
  const body = new URLSearchParams({
    q: query,
    kl: region,
    df: '',
    ...(page > 1 ? { s: String((page - 1) * 10 + 1) } : {}),
  }).toString();

  const problems = [];
  let rateLimited = false;

  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(
        `${endpoint.url}?q=${encodeURIComponent(query)}&kl=${region}`,
        {
          method: 'POST',
          headers: {
            'User-Agent': UA,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9,tr;q=0.8',
            Referer: 'https://duckduckgo.com/',
            Origin: 'https://duckduckgo.com',
          },
          body,
        },
        timeout,
      );

      const html = await response.text();
      // 403 / 429 / 202 → bu ağ adresi bot korumasına takılmış demektir.
      if (!response.ok || response.status === 202) {
        if ([401, 403, 429, 451, 202].includes(response.status)) rateLimited = true;
        problems.push(`${endpoint.url} → HTTP ${response.status}`);
        continue;
      }
      assertNotBlocked(html, endpoint.url);
      const results = parseHtml(html, endpoint.kind).filter((r) => r.title && /^https?:/.test(r.url));
      if (results.length === 0) {
        problems.push(`${endpoint.url} → sonuç yok`);
        continue;
      }
      return results;
    } catch (err) {
      if (err.code === 'rate_limited') rateLimited = true;
      problems.push(`${endpoint.url} → ${err.message}`);
    }
  }

  const error = new ProviderError('duckduckgo', `DuckDuckGo sonuç vermedi: ${problems.join(' | ')}`, 429);
  error.code = rateLimited ? 'rate_limited' : 'unavailable';
  throw error;
}

/**
 * DuckDuckGo web araması. Hız sınırına takılırsa bir kez yeniden dener;
 * kalıcı engelde devre kesici devreye girer ve yedek motor kullanılır.
 * @returns {Promise<Array<{title:string,url:string,snippet:string}>>}
 */
export async function search(query, { page = 1, region = 'wt-wt', timeout = 9000 } = {}) {
  if (Date.now() < breaker.openUntil) {
    const error = new ProviderError(
      'duckduckgo',
      `DuckDuckGo geçici olarak devre dışı (${Math.ceil((breaker.openUntil - Date.now()) / 1000)} sn)`,
      429,
    );
    error.code = 'circuit_open';
    throw error;
  }

  try {
    const results = await withRetry(
      () => throttle.run(() => attempt(query, { page, region, timeout })),
      {
        attempts: 2,
        delays: [700, 1800],
        // rate_limited kalıcı olabiliyor: tek kısa denemeden sonra yedek motora geç.
        shouldRetry: (err) => err.status === 504,
      },
    );
    breaker.failures = 0;
    return results;
  } catch (err) {
    if (err.code === 'rate_limited') {
      breaker.failures += 1;
      if (breaker.failures >= breaker.threshold) breaker.openUntil = Date.now() + breaker.cooldownMs;
    }
    throw err;
  }
}

/** DuckDuckGo anında yanıt (abstract / tanım / alt konular). */
export async function instantAnswer(query, { timeout = 7000 } = {}) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}` +
      '&format=json&no_html=1&no_redirect=1&skip_disambig=1&t=wlame-dx';
    const response = await fetchWithTimeout(url, { headers: { 'User-Agent': UA } }, timeout);
    if (!response.ok) return null;
    const data = await response.json();

    const topics = [];
    const walk = (items = []) => {
      for (const item of items) {
        if (Array.isArray(item.Topics)) walk(item.Topics);
        else if (item.Text && item.FirstURL) {
          topics.push({ text: htmlDecode(item.Text), url: item.FirstURL });
        }
      }
    };
    walk(data.RelatedTopics);

    return {
      heading: data.Heading || '',
      abstract: data.AbstractText || data.Definition || '',
      abstractUrl: data.AbstractURL || data.DefinitionURL || '',
      source: data.AbstractSource || data.DefinitionSource || '',
      answer: data.Answer || '',
      image: data.Image ? `https://duckduckgo.com${data.Image}` : '',
      topics: topics.slice(0, 8),
    };
  } catch {
    return null;
  }
}

export const meta = {
  id: 'duckduckgo',
  name: 'DuckDuckGo',
  color: '#de5833',
  needsKey: false,
};
