// wlame-dx — HTTP API çekirdeği.
//
// Bu modül yönlendirmeyi tek yerde tutar ve iki ortamda aynen çalışır:
//   • Yerel sunucu (server.js)   → http.createServer → handleApi(req, res, url)
//   • Vercel serverless fonksiyonu (api/[[...path]].js) → handleApi(req, res, url)
//
// Node tarzı (req/res) imza kullanır; Vercel Node çalışma zamanı da aynı
// IncomingMessage/ServerResponse sözleşmesini sağladığı için SSE dahil her şey
// aynı kodla akar. Yanıtlara her zaman CORS başlığı eklenir.

import { searchAll, suggestAll } from './providers/index.js';
import { buildAnswer, answerStream, engineInfo } from './aimode.js';
import { TTLCache } from './util.js';
import * as google from './providers/google.js';
import * as wikipedia from './providers/wikipedia.js';
import * as brave from './providers/brave.js';
import * as duckduckgo from './providers/duckduckgo.js';

const searchCache = new TTLCache(200, 10 * 60 * 1000);

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

export function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

export function param(url, name, fallback = '') {
  const value = url.searchParams.get(name);
  return value === null || value === '' ? fallback : value;
}

export function cleanQuery(raw) {
  return String(raw || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 256);
}

export function cachedSearch(query, lang, page) {
  const key = `${lang}:${page}:${query.toLocaleLowerCase('tr')}`;
  const cached = searchCache.get(key);
  if (cached) return Promise.resolve({ ...cached, cached: true });
  return searchAll(query, { lang, page }).then((result) => {
    // Web sonucu üretmeyen aramaları uzun süre önbelleğe almayalım; kısa süre
    // sonra motor toparlanmış olabilir.
    if (result.results.length > 0) searchCache.set(key, result);
    return { ...result, cached: false };
  });
}

export function apiHealth() {
  return {
    ok: true,
    name: 'wlame-dx',
    uptime: Math.round(process.uptime()),
    ai: engineInfo(),
    providers: [
      { id: 'duckduckgo', ready: true, circuitOpen: duckduckgo.circuitState().open },
      { id: 'bing', ready: true, fallback: true },
      { id: 'wikipedia', ready: true },
      { id: 'google', ready: true, webSearchConfigured: google.isConfigured() },
      { id: 'brave', ready: true, webSearchConfigured: brave.isConfigured() },
    ],
    fallback: process.env.WEB_FALLBACK || 'bing',
  };
}

/** HTTP isteklerini /api/* uç noktalarına yönlendirir. */
export async function handleApi(req, res, url) {
  const route = url.pathname;

  if (route === '/api/health') {
    return sendJson(res, 200, apiHealth());
  }

  if (route === '/api/search') {
    const query = cleanQuery(param(url, 'q'));
    if (!query) return sendJson(res, 400, { error: 'q parametresi gerekli' });
    const lang = param(url, 'lang', 'tr') === 'en' ? 'en' : 'tr';
    const page = Math.max(1, Math.min(10, Number(param(url, 'page', '1')) || 1));
    const data = await cachedSearch(query, lang, page);
    return sendJson(res, 200, data);
  }

  if (route === '/api/suggest') {
    const query = cleanQuery(param(url, 'q'));
    if (!query) return sendJson(res, 200, { suggestions: [] });
    const lang = param(url, 'lang', 'tr') === 'en' ? 'en' : 'tr';
    const suggestions = await suggestAll(query, { lang });
    return sendJson(res, 200, { query, suggestions, source: 'google+wikipedia' });
  }

  if (route === '/api/wiki') {
    const query = cleanQuery(param(url, 'q'));
    if (!query) return sendJson(res, 400, { error: 'q parametresi gerekli' });
    const lang = param(url, 'lang', 'tr') === 'en' ? 'en' : 'tr';
    const summary = await wikipedia.bestSummary(query, { lang });
    const hits = await wikipedia.search(query, { lang, limit: 5 }).catch(() => []);
    return sendJson(res, 200, { summary, results: hits });
  }

  if (route === '/api/ai') {
    const query = cleanQuery(param(url, 'q'));
    if (!query) return sendJson(res, 400, { error: 'q parametresi gerekli' });
    const lang = param(url, 'lang', 'tr') === 'en' ? 'en' : 'tr';
    const ctx = await cachedSearch(query, lang, 1);
    const answer = await buildAnswer(query, ctx);
    return sendJson(res, 200, {
      query,
      ...answer,
      sources: ctx.results.slice(0, 8).map((r) => ({ title: r.title, url: r.url, provider: r.provider })),
      took: ctx.took,
    });
  }

  if (route === '/api/ai/stream') {
    const query = cleanQuery(param(url, 'q'));
    if (!query) return sendJson(res, 400, { error: 'q parametresi gerekli' });
    const lang = param(url, 'lang', 'tr') === 'en' ? 'en' : 'tr';

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });

    const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
    let aborted = false;
    req.on('close', () => { aborted = true; });

    try {
      const ctx = await cachedSearch(query, lang, 1);
      send({
        type: 'sources',
        query,
        took: ctx.took,
        results: ctx.results.slice(0, 8),
        wikipediaSummary: ctx.wikipediaSummary,
        news: ctx.news.slice(0, 5),
        stats: ctx.sources,
        errors: ctx.errors,
        notices: ctx.notices,
      });

      for await (const event of answerStream(query, ctx)) {
        if (aborted) break;
        send(event);
      }
    } catch (err) {
      send({ type: 'error', message: err.message });
    } finally {
      res.end();
    }
    return undefined;
  }

  return sendJson(res, 404, { error: 'Bilinmeyen uç nokta', path: route });
}