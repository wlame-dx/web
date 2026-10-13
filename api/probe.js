// GEÇİCİ tanı uç noktası: Vercel'in veri merkezi IP'sinden hangi arama
// motorlarının gerçekten yanıt verdiğini ölçer. Sabit bir izin listesi kullanır
// (açık proxy değildir). İş bitince silinir.
const TARGETS = [
  ['duckduckgo-html', 'https://html.duckduckgo.com/html/?q=yapay+zeka'],
  ['duckduckgo-lite', 'https://lite.duckduckgo.com/lite/?q=yapay+zeka'],
  ['duckduckgo-main', 'https://duckduckgo.com/?q=yapay+zeka'],
  ['marginalia-old', 'https://old-search.marginalia.nu/search?query=yapay+zeka&profile=default&group=list'],
  ['marginalia-new', 'https://search.marginalia.nu/search?query=yapay+zeka&profile=default&group=list'],
  ['mojeek', 'https://www.mojeek.com/search?q=yapay+zeka'],
  ['bing', 'https://www.bing.com/search?q=yapay+zeka'],
  ['brave', 'https://search.brave.com/search?q=yapay+zeka'],
  ['ecosia', 'https://www.ecosia.org/search?q=yapay+zeka'],
  ['yahoo', 'https://search.yahoo.com/search?p=yapay+zeka'],
  ['startpage', 'https://www.startpage.com/sp/search?query=yapay+zeka'],
  ['swisscows', 'https://swisscows.com/en/web?query=yapay+zeka'],
  ['search-marginalia-api', 'https://old-search.marginalia.nu/api/search?query=yapay+zeka'],
  ['wikipedia', 'https://tr.wikipedia.org/w/api.php?action=query&list=search&srsearch=yapay+zeka&format=json&origin=*&srlimit=3'],
  ['gnews-rss', 'https://news.google.com/rss/search?q=yapay+zeka&hl=tr&gl=TR&ceid=TR:tr'],
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function probe([name, url]) {
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/json,application/xml,*/*' },
      signal: controller.signal,
      redirect: 'follow',
    });
    const body = await response.text();
    clearTimeout(timer);
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1]?.trim().slice(0, 60) || '';
    return {
      name,
      status: response.status,
      finalUrl: response.url.replace(/^https?:\/\//, '').slice(0, 50),
      len: body.length,
      title,
      ms: Date.now() - started,
      captcha: /captcha|robot|are you a human|verify you are|unusual traffic/i.test(body),
      resultHints: {
        li: (body.match(/<li/g) || []).length,
        h2a: (body.match(/<h2[^>]*>\s*<a/gi) || []).length,
        cardResult: (body.match(/card search-result/g) || []).length,
        ddgResult: (body.match(/result__a|result__title/gi) || []).length,
        bingAlgo: (body.match(/b_algo/gi) || []).length,
      },
    };
  } catch (err) {
    return { name, error: err.name + ': ' + err.message, ms: Date.now() - started };
  }
}

export default async function handler(req, res) {
  const results = await Promise.all(TARGETS.map(probe));
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ region: process.env.VERCEL_REGION || '?', results }, null, 1));
}