// GEÇİCİ: gerçek bing.search() çağrısını ve ham HTML yapısını ölçer.
import { search as bingSearch } from '../src/providers/bing.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function trySearch(query) {
  const started = Date.now();
  try {
    const items = await bingSearch(query, { lang: 'tr', limit: 10 });
    return { query, ok: true, count: items.length, first: items[0]?.title?.slice(0, 45), ms: Date.now() - started };
  } catch (err) {
    return { query, ok: false, error: err.message + ' [' + (err.code || err.status || '') + ']', ms: Date.now() - started };
  }
}

async function rawFetch(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8' },
    redirect: 'follow',
  });
  const body = await response.text();
  const liIdx = body.indexOf('<li class="b_algo"');
  const h2Idx = body.indexOf('<h2');
  return {
    url: url.slice(0, 70),
    status: response.status,
    len: body.length,
    liAlgo: (body.match(/<li class="b_algo"/g) || []).length,
    bAlgoAny: (body.match(/b_algo/g) || []).length,
    h2: (body.match(/<h2/gi) || []).length,
    liSnippet: liIdx > -1 ? body.slice(liIdx, liIdx + 600).replace(/\s+/g, ' ') : '(li yok)',
    h2Snippet: h2Idx > -1 ? body.slice(h2Idx, h2Idx + 300).replace(/\s+/g, ' ') : '(h2 yok)',
  };
}

export default async function handler(req, res) {
  const searches = [];
  searches.push(await trySearch('yapay zeka'));
  searches.push(await trySearch('yapay zeka'));
  const raw = await rawFetch('https://www.bing.com/search?q=yapay+zeka&mkt=tr-TR&setlang=tr&cc=TR&count=10&form=QBLH');
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ region: process.env.VERCEL_REGION || '?', searches, raw }, null, 1));
}