// GEÇİCİ tanı uç noktası (3. tur): Google'ın JS'siz/HTML sürümleri ve DDG IA tekrar.
const TARGETS = [
  ['google-gbv', 'https://www.google.com/search?q=kubernetes&num=10&gbv=1'],
  ['google-udm14', 'https://www.google.com/search?q=kubernetes&num=10&udm=14'],
  ['google-ncr', 'https://www.google.com/search?q=kubernetes&num=10&gl=us&hl=en&pws=0&filter=0'],
  ['google-basic', 'https://www.google.com/search?q=kubernetes&num=10&client=firefox-b-d&source=hp'],
  ['ddg-ia-retry', 'https://api.duckduckgo.com/?q=kubernetes&format=json&no_html=1&t=wlamedx'],
  ['bing-rss', 'https://www.bing.com/search?q=kubernetes&format=rss'],
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function probe([name, url]) {
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(url, {
      headers: {
        'User-Agent': name.includes('bing-rss') ? 'Mozilla/5.0 (compatible; wlame-dx/1.0)' : UA,
        Accept: 'text/html,application/json,application/xml,*/*',
        'Accept-Language': 'en-US,en;q=0.9,tr;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    const raw = await response.arrayBuffer();
    const body = new TextDecoder('utf-8').decode(raw);
    clearTimeout(timer);
    const out = { name, status: response.status, len: raw.byteLength, ms: Date.now() - started };
    if (name === 'ddg-ia-retry') {
      out.bodyPreview = body.slice(0, 200);
    } else if (name === 'bing-rss') {
      out.items = (body.match(/<item>/g) || []).length;
      out.title = /<title>([\s\S]*?)<\/title>/i.exec(body)?.[1]?.slice(0, 50);
    } else {
      out.hints = {
        consent: /before you continue|consent/i.test(body),
        captcha: /unusual traffic|captcha|detected unusual/i.test(body),
        h3: (body.match(/<h3/gi) || []).length,
        resultLinks: (body.match(/<a href="\/url\?q=/gi) || []).length,
        divG: (body.match(/<div class="g"/gi) || []).length,
      };
      out.bodyPreview = body.replace(/\s+/g, ' ').slice(0, 160);
    }
    return out;
  } catch (err) {
    return { name, error: err.name + ': ' + err.message, ms: Date.now() - started };
  }
}

export default async function handler(req, res) {
  const results = await Promise.all(TARGETS.map(probe));
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ region: process.env.VERCEL_REGION || '?', results }, null, 1));
}