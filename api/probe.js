// GEÇİCİ: bing.js'in tam olarak kurduğu URL'leri karşılaştırır.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const TARGETS = [
  ['rss-full', 'https://www.bing.com/search?q=yapay+zeka&mkt=tr-TR&setlang=tr&cc=TR&count=10&format=rss'],
  ['rss-min', 'https://www.bing.com/search?q=yapay+zeka&format=rss'],
  ['rss-min3', 'https://www.bing.com/search?q=yapay+zeka&format=rss'],
  ['html-plain', 'https://www.bing.com/search?q=yapay+zeka'],
  ['html-full', 'https://www.bing.com/search?q=yapay+zeka&mkt=tr-TR&setlang=tr&cc=TR&count=10&form=QBLH'],
  ['html-full3', 'https://www.bing.com/search?q=yapay+zeka&mkt=tr-TR&setlang=tr&cc=TR&count=10&form=QBLH'],
];

async function probe([name, url]) {
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    const body = await response.text();
    clearTimeout(timer);
    return {
      name,
      status: response.status,
      len: body.length,
      items: (body.match(/<item>/g) || []).length,
      b_algo: (body.match(/b_algo/g) || []).length,
      captcha: /captcha|unusual traffic|verify you are human/i.test(body),
      title: /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1]?.trim().slice(0, 40) || '',
      ms: Date.now() - started,
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