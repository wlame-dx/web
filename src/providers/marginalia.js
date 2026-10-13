// Marginalia sağlayıcısı — "küçük web"i tarayan bağımsız arama motoru.
//
// Veri merkezi IP'lerini engellemeyen, bot'a hoşgörülü bir motor olduğu için
// DDG ve Bing'in veri merkezinde sustuğu durumlarda son çare web kaynağıdır
// (anahtar gerektirmez). Sunucu tarafında render edilen eski arayüzü kullanır;
// yoğunlukta "Wait For A Moment (N sn)" sayfası döndürür — `data-tr` saniyesini
// bekleyip yeniden dener, yani hız sınırına kendiliğinden uyar.
//
// Not: kapsamı küçük/bireysel web'e odaklıdır; ana bilgi üreticileri için değil,
// yedek kaynak olarak kullanılır.
import { UA, ProviderError, fetchWithTimeout, stripTags, Throttle, sleep } from '../util.js';

const ENDPOINT = 'https://old-search.marginalia.nu/search';

// Marginalia küçük ve bağımsız bir motor; istekler arası en az 2,5 sn beklenir.
const throttle = new Throttle(2500);

/** Sonuçların etrafındaki arama sayfası kuyruğu (varsa) kadar bekler. */
async function fetchPage(params) {
  const url = `${ENDPOINT}?${params}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      },
      20000,
    );
    if (!response.ok) throw new ProviderError('marginalia', `Marginalia HTTP ${response.status}`, 502);

    const html = await response.text();

    // "Wait For A Moment (N sn)" hız sınırı sayfası → bekle ve yeniden dene.
    const countdown = /data-tr="(\d+)"/.exec(html);
    if (html.includes('Wait For A Moment')) {
      await sleep((Number(countdown?.[1]) || 1) * 1000 + 1200);
      continue;
    }
    return html;
  }
  throw new ProviderError('marginalia', 'Marginalia hız sınırına takıldı', 429);
}

function parse(html) {
  const items = [];
  const blocks = html.split('class="card search-result"').slice(1);
  for (const block of blocks) {
    const link = /<a[^>]*class="title"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) continue;
    const url = link[1].trim();
    if (!/^https?:\/\//i.test(url)) continue;
    // Motorun kendi sayfalarına giden bağlantıları sonuç sayma.
    if (/marginalia\.(nu|search)\//i.test(url) && !/old-search\.marginalia\.nu\/search/.test(url)) {
      // sonuç URL'leri .nu/search üzerinden gelmez; kendi sitelerini atla
      if (/https?:\/\/(www\.)?marginalia\.nu\//.test(url)) continue;
    }
    // Motorun kendi keşif sayfalarını da (site/…) atla: arama sonucu olmayan bağlantı.
    if (/old-search\.marginalia\.nu\/(site|site-search)/.test(url)) continue;

    const snippet = /<p class="description">([\s\S]*?)<\/p>/i.exec(block);
    items.push({
      title: stripTags(link[2]),
      url,
      snippet: snippet ? stripTags(snippet[1]) : '',
    });
  }
  return items;
}

export async function search(query, { page = 1, limit = 10, timeout = 20000 } = {}) {
  const params = new URLSearchParams({
    query,
    profile: 'default',
    group: 'list',
  });

  const html = await throttle.run(() => fetchPage(params));

  const results = parse(html);
  if (results.length === 0) {
    const error = new ProviderError('marginalia', 'Marginalia sonuç döndürmedi', 429);
    error.code = 'unavailable';
    throw error;
  }
  return results.slice(0, limit);
}

export const meta = {
  id: 'marginalia',
  name: 'Marginalia',
  color: '#7c9f7c',
  needsKey: false,
};