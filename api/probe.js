// GEÇİCİ tanı uç noktası (2. tur): DuckDuckGo'nun resmi Instant Answer API'si,
// Google scrape denemesi ve Swisscows ayrıntısı.
const TARGETS = [
  ['ddg-ia-en', 'https://api.duckduckgo.com/?q=kubernetes&format=json&no_html=1&skip_disambig=1'],
  ['ddg-ia-tr', 'https://api.duckduckgo.com/?q=yapay%20zeka&format=json&no_html=1&skip_disambig=1&kl=tr-tr'],
  ['ddg-ia-tr2', 'https://api.duckduckgo.com/?q=derin%20%C3%B6%C4%9Frenme&format=json&no_html=1&skip_disambig=1&kl=tr-tr'],
  ['google-scrape', 'https://www.google.com/search?q=yapay+zeka&num=10&hl=tr'],
  ['google-scrape-en', 'https://www.google.com/search?q=kubernetes&num=10&hl=en'],
  ['swisscows', 'https://swisscows.com/en/web?query=yapay+zeka'],
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function probe([name, url]) {
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json,text/html,*/*' },
      signal: controller.signal,
      redirect: 'follow',
    });
    const body = await response.text();
    clearTimeout(timer);
    const out = {
      name,
      status: response.status,
      finalUrl: response.url.replace(/^https?:\/\//, '').slice(0, 45),
      len: body.length,
      ms: Date.now() - started,
    };
    if (name.startsWith('ddg-ia')) {
      try {
        const j = JSON.parse(body);
        out.ia = {
          abstract: (j.AbstractText || '').slice(0, 90),
          heading: j.Heading,
          relatedCount: (j.RelatedTopics || []).length,
          results: (j.Results || []).length,
          firstRelated: j.RelatedTopics?.[0]?.FirstURL?.slice(0, 60) || null,
        };
      } catch { out.ia = 'json parse fail'; }
    } else if (name.startsWith('google')) {
      out.hints = {
        consent: /consent|before you continue/i.test(body),
        captcha: /captcha|unusual traffic|our systems have detected/i.test(body),
        h3: (body.match(/<h3/gi) || []).length,
        resultLinks: (body.match(/<a href="\/url\?q=/gi) || []).length,
      };
    } else {
      out.hints = {
        captcha: /captcha|robot/i.test(body),
        li: (body.match(/<li/g) || []).length,
        linkCount: (body.match(/<a[^>]+href="https?:\/\//gi) || []).length,
      };
      const ci = body.toLowerCase().indexOf('captcha');
      if (ci > -1) out.captchaContext = body.slice(Math.max(0, ci - 60), ci + 80).replace(/\s+/g, ' ');
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