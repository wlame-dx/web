import { fetchWithTimeout, UA, sleep } from './src/util.js';

async function fetchOld(query) {
  const url = `https://old-search.marginalia.nu/search?query=${encodeURIComponent(query)}&profile=default&group=list`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetchWithTimeout(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } }, 20000);
    const html = await r.text();
    const cd = /data-tr="(\d+)"/.exec(html);
    if (html.includes('Wait For A Moment') && cd) {
      await sleep((Number(cd[1]) || 1) * 1000 + 1500);
      continue;
    }
    return html;
  }
  return null;
}

const html = await fetchOld('yapay zeka');
const idx = html.indexOf('search-result');
console.log('search-result ilk geçiş:', idx);
if (idx > -1) {
  console.log('blok:', html.slice(idx, idx + 1800).replace(/\s+/g, ' '));
} else {
  // diğer la
  for (const k of ['result', 'serp-', 'domain', 'description']) {
    console.log(k, ':', (html.match(new RegExp(k, 'g')) || []).length);
  }
}