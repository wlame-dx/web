// wlame-dx ön yüz mantığı — bağımlılık yok.
// İki görünüm: ana sayfa (sade) ve sonuç sayfası (sekmeli), Google mantığında.

const $ = (id) => document.getElementById(id);

const els = {
  body: document.body,
  form: $('searchForm'),
  input: $('q'),
  clear: $('clearBtn'),
  suggestions: $('suggestions'),
  tabNav: $('tabNav'),
  brand: $('brand'),
  heroSub: $('heroSub'),

  stats: $('statsBar'),
  notices: $('notices'),
  errors: $('errors'),

  panelWeb: $('panelWeb'),
  panelNews: $('panelNews'),
  panelWiki: $('panelWiki'),
  panelAi: $('panelAi'),

  results: $('results'),
  newsList: $('newsList'),
  wikiCard: $('wikiCard'),
  wikiList: $('wikiList'),

  aiEngine: $('aiEngine'),
  aiAnswer: $('aiAnswer'),
  aiBullets: $('aiBullets'),
  aiCitations: $('aiCitations'),
  aiCitationsWrap: $('aiCitationsWrap'),
  aiSources: $('aiSources'),

  aiEngine: $('aiEngine'),
  chipGoogle: $('chipGoogle'),
  chipBrave: $('chipBrave'),
  chipBing: $('chipBing'),
  chipDdg: $('chipDdg'),
  footerAi: $('footerAi'),

  favs: $('favs'),
  favsGrid: $('favsGrid'),
  toast: $('toast'),
};

const PANELS = {
  web: els.panelWeb,
  news: els.panelNews,
  wikipedia: els.panelWiki,
  ai: els.panelAi,
};

const state = {
  view: 'home',
  tab: 'web',
  query: '',
  data: null,
  aiStream: null,
  aiQuery: null,
  aiText: '',
  suggestActive: -1,
  suggestItems: [],
  backend: true,   // Node sunucusu var mı? yoksa tarayıcıdan Wikipedia/öneri kullanılır
  apiBase: '',     // aynı kaynak ("") veya uzak Vercel backend adresi
};

/* ---------------- yardımcılar ---------------- */

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(ms) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} sn`;
}

function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'az önce';
  if (mins < 60) return `${mins} dk önce`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} sa önce`;
  return `${Math.round(hours / 24)} gün önce`;
}

function hostOf(url = '') {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function faviconSrcFor(url = '') {
  const host = hostOf(url);
  return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64` : '';
}

/** Sık kullanılanları tekilleştirmede kullanacak anahtar. */
function favKey(url = '') {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '')).toLocaleLowerCase('tr');
  } catch {
    return url.toLocaleLowerCase('tr').trim();
  }
}

/* ---------------- sık kullanılanlar (localStorage) ---------------- */

const FAV_KEY = 'wlame.favorites';

function loadFavorites() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAV_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveFavorites(list) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(list.slice(0, 24))); } catch { /* dolu/dolu */ }
}

let favorites = loadFavorites();

function isFavorite(url) {
  const key = favKey(url);
  return favorites.some((f) => favKey(f.url) === key);
}

function toggleFavorite(star) {
  const url = star.dataset.favUrl;
  const title = star.dataset.favTitle || url;
  if (isFavorite(url)) {
    favorites = favorites.filter((f) => favKey(f.url) !== favKey(url));
  } else {
    favorites.unshift({ url, title, addedAt: Date.now() });
  }
  saveFavorites(favorites);
  renderFavorites();
  syncStars();
}

function removeFavorite(url) {
  favorites = favorites.filter((f) => favKey(f.url) !== favKey(url));
  saveFavorites(favorites);
  renderFavorites();
}

function renderFavorites() {
  els.favs.hidden = !(state.view === 'home' && favorites.length > 0);
  if (favorites.length === 0) { els.favsGrid.innerHTML = ''; return; }
  els.favsGrid.innerHTML = favorites.map((f) => `
    <div class="fav" data-fav-url="${escapeHtml(f.url)}">
      <img class="fav-icon" src="${faviconSrcFor(f.url)}" alt="" loading="lazy"
           onerror="this.remove()" />
      <a class="fav-body" href="${escapeHtml(f.url)}" target="_blank" rel="noopener noreferrer">
        <span class="fav-title">${escapeHtml(f.title)}</span>
        <span class="fav-domain">${escapeHtml(hostOf(f.url))}</span>
      </a>
      <button type="button" class="fav-del" aria-label="Sık kullanılanlardan kaldır">×</button>
    </div>`).join('');
}

function syncStars() {
  document.querySelectorAll('.star').forEach((star) => {
    const on = isFavorite(star.dataset.favUrl);
    star.classList.toggle('on', on);
    star.textContent = on ? '★' : '☆';
  });
}

/* ---------------- bildirim ---------------- */

let toastTimer = null;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2600);
}

/** AI yanıtındaki **kalın** ve [n] kaynak işaretlerini biçimlendirir. */
function formatAnswer(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(\d+)\]/g, '<span class="cite" data-cite="$1">[$1]</span>');
}

/* ---------------- şablonlar ---------------- */

const BADGE_LABEL = {
  google: 'google',
  duckduckgo: 'duckduckgo',
  bing: 'bing',
  brave: 'brave',
  wikipedia: 'wikipedia',
  'google-news': 'google haber',
};

function resultTemplate(item) {
  const favicon = item.favicon
    ? `<img class="result-favicon" src="${escapeHtml(item.favicon)}" alt="" loading="lazy"
         onerror="this.style.visibility='hidden'" />`
    : '<span class="result-favicon"></span>';
  return `
    <a class="result" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
      <button type="button" class="star" data-fav-url="${escapeHtml(item.url)}"
              data-fav-title="${escapeHtml(item.title)}" aria-label="Sık kullanılanlara ekle">☆</button>
      <div class="result-top">
        ${favicon}
        <span class="result-url">${escapeHtml(item.domain || '')}</span>
        <span class="badge badge-${escapeHtml(item.provider)}">${BADGE_LABEL[item.provider] || item.provider}</span>
      </div>
      <h3 class="result-title">${escapeHtml(item.title)}</h3>
      ${item.snippet ? `<p class="result-snippet">${escapeHtml(item.snippet)}</p>` : ''}
    </a>`;
}

function newsTemplate(item) {
  return `
    <a class="news-item" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
      <button type="button" class="star" data-fav-url="${escapeHtml(item.url)}"
              data-fav-title="${escapeHtml(item.title)}" aria-label="Sık kullanılanlara ekle">☆</button>
      <span class="news-time">${relativeTime(item.date)}</span>
      <span>${escapeHtml(item.title)}</span>
      <span class="news-src">${escapeHtml(item.sourceName || '')}</span>
    </a>`;
}

function wikiCardTemplate(summary) {
  if (!summary?.extract) return '';
  return `
    ${summary.thumbnail
      ? `<img class="wiki-thumb" src="${escapeHtml(summary.thumbnail)}" alt="" loading="lazy"
           onerror="this.remove()" />`
      : ''}
    <div class="wiki-card-head">
      <span class="badge badge-wikipedia">wikipedia</span>
      <h2>${escapeHtml(summary.title)}</h2>
      <button type="button" class="star quiet" data-fav-url="${escapeHtml(summary.url)}"
              data-fav-title="${escapeHtml(summary.title)}" aria-label="Sık kullanılanlara ekle">☆</button>
    </div>
    ${summary.description ? `<div class="wiki-desc">${escapeHtml(summary.description)}</div>` : ''}
    <p>${escapeHtml(summary.extract)}</p>
    <a class="wiki-link" href="${escapeHtml(summary.url)}" target="_blank" rel="noopener noreferrer">
      Vikipedi'de devamını oku →
    </a>`;
}

const emptyBlock = (title, detail) =>
  `<div class="empty"><strong>${escapeHtml(title)}</strong>${escapeHtml(detail)}</div>`;

/* ---------------- görünüm yönetimi ---------------- */

function setView(view) {
  state.view = view;
  els.body.classList.toggle('view-home', view === 'home');
  els.body.classList.toggle('view-results', view === 'results');
  els.favs.hidden = !(view === 'home' && favorites.length > 0);
}

function setTab(tab, { render: shouldRender = true } = {}) {
  state.tab = tab;
  [...els.tabNav.children].forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
  Object.entries(PANELS).forEach(([key, panel]) => { panel.hidden = key !== tab; });

  if (tab !== 'ai') stopAiStream();
  if (tab === 'ai' && state.query) startAi(state.query);

  if (shouldRender && state.data) render(state.data);
  syncUrl();
}

function syncUrl() {
  const url = new URL(location.href);
  if (state.query) url.searchParams.set('q', state.query);
  else url.searchParams.delete('q');
  if (state.tab !== 'web') url.searchParams.set('tab', state.tab);
  else url.searchParams.delete('tab');
  history.replaceState({}, '', url);
}

/* ---------------- arama ---------------- */

function setLoading() {
  els.results.innerHTML = Array.from({ length: 5 }, () => '<div class="skeleton"></div>').join('');
  els.newsList.innerHTML = '<div class="skeleton"></div>'.repeat(4);
  els.wikiCard.hidden = true;
  els.wikiList.innerHTML = '<div class="skeleton"></div>'.repeat(3);
  els.errors.hidden = true;
  els.notices.hidden = true;
  els.stats.hidden = true;
}

function renderNotices(notices) {
  if (!notices?.length) { els.notices.hidden = true; return; }
  els.notices.hidden = false;
  els.notices.innerHTML = notices
    .map((n) => `<div><span class="tag">${escapeHtml(n.provider)}</span><span>${escapeHtml(n.message)}</span></div>`)
    .join('');
}

function renderErrors(errors) {
  if (!errors?.length) { els.errors.hidden = true; return; }
  els.errors.hidden = false;
  els.errors.innerHTML = errors
    .map((e) => `<div>⚠ ${escapeHtml(e.provider)}: ${escapeHtml(e.message)}</div>`)
    .join('');
}

function render(data) {
  state.data = data;

  const total = data.results.length + data.wikipedia.length + data.news.length;
  const staticMode = Boolean(data.sources?.static);
  const engines = staticMode
    ? `wikipedia ${data.sources.wikipedia} · sunucusuz`
    : [
        data.sources.duckduckgo ? `ddg ${data.sources.duckduckgo}` : null,
        data.sources.bing ? `bing ${data.sources.bing}` : null,
        data.sources.marginalia ? `marginalia ${data.sources.marginalia}` : null,
        data.sources.google ? `google ${data.sources.google}` : null,
        data.sources.brave ? `brave ${data.sources.brave}` : null,
        `wiki ${data.sources.wikipedia}`,
        `haber ${data.sources.googleNews}`,
      ].filter(Boolean).join(' · ');

  els.stats.hidden = false;
  els.stats.innerHTML = [
    `<strong>${total}</strong> sonuç`,
    formatTime(data.took),
    escapeHtml(engines),
    data.cached ? 'önbellek' : staticMode ? 'tarayıcı' : 'canlı',
  ].join(' &nbsp;·&nbsp; ');

  // Web
  els.results.innerHTML = data.results.length
    ? data.results.map(resultTemplate).join('')
    : emptyBlock(
        'Web sonucu gelmedi.',
        staticMode || !data.sources?.webTotal
          ? 'Web motorları bu ağdan engelleniyor görünüyor; sonuçlar yukarıdaki uyarılarda açıklanıyor. Vikipedi ve haberler çalışıyor.'
          : 'Farklı bir ifade dene ya da diğer sekmelere bak.',
      );

  // Haberler
  els.newsList.innerHTML = data.news.length
    ? data.news.map(newsTemplate).join('')
    : emptyBlock(
        'Haber bulunamadı.',
        staticMode
          ? 'Haberler yalnızca sunucusu olan tam sürümde var (Google Haberler RSS).'
          : 'Bu sorgu için Google Haberler sonuç döndürmedi.',
      );

  // Wikipedia
  els.wikiCard.innerHTML = data.wikipediaSummary?.extract ? wikiCardTemplate(data.wikipediaSummary) : '';
  els.wikiCard.hidden = !data.wikipediaSummary?.extract;
  els.wikiList.innerHTML = data.wikipedia.length
    ? data.wikipedia.map(resultTemplate).join('')
    : emptyBlock('Wikipedia maddesi bulunamadı.', 'Bu sorguyla eşleşen bir madde yok.');

  // Kaynak çipleri (ana sayfada görünür)
  if (els.chipBing) els.chipBing.classList.toggle('off', !data.sources.bing);
  if (els.chipDdg) els.chipDdg.classList.toggle('off', !data.sources.duckduckgo);

  renderNotices(data.notices);
  renderErrors(data.errors);
  syncStars();
}

async function runSearch(query, { push = true } = {}) {
  const q = (query ?? els.input.value).trim();
  if (!q) { els.input.focus(); return; }

  const changed = q !== state.query;
  state.query = q;
  els.input.value = q;
  els.clear.hidden = false;
  closeSuggestions();
  setView('results');

  if (push) {
    const url = new URL(location.href);
    url.searchParams.set('q', q);
    if (state.tab !== 'web') url.searchParams.set('tab', state.tab);
    history.pushState({ q }, '', url);
  }
  document.title = `${q} — wlame-dx`;

  if (changed) stopAiStream();
  setLoading();

  try {
    const data = state.backend
      ? await fetchSearchData(q)
      : await staticRunSearch(q);
    if (state.query !== q) return;
    render(data);
  } catch (err) {
    els.results.innerHTML = '';
    els.newsList.innerHTML = '';
    els.wikiList.innerHTML = '';
    els.errors.hidden = false;
    els.errors.innerHTML = `<div>⚠ ${escapeHtml(err.message)}</div>`;
  }

  if (state.tab === 'ai') startAi(q);
}

/** Sunucu sürümü araması. */
async function fetchSearchData(q) {
  const params = new URLSearchParams({ q });
  const response = await fetch(`${state.apiBase}/api/search?${params}`);
  if (!response.ok) throw new Error(`Sunucu hatası (${response.status})`);
  return response.json();
}

/* ---------------- öneriler ---------------- */

let suggestTimer = null;

function closeSuggestions() {
  els.suggestions.hidden = true;
  els.suggestions.innerHTML = '';
  state.suggestActive = -1;
  state.suggestItems = [];
}

function openSuggestions(items) {
  state.suggestItems = items;
  state.suggestActive = -1;
  if (!items.length) return closeSuggestions();
  els.suggestions.hidden = false;
  els.suggestions.innerHTML = items
    .map((item, index) => `
      <li data-index="${index}" role="option">
        <span>${escapeHtml(item.text)}</span>
        <span class="src">${escapeHtml(item.source)}</span>
      </li>`)
    .join('');
}

function highlightSuggestion(delta) {
  const items = [...els.suggestions.querySelectorAll('li')];
  if (!items.length) return;
  state.suggestActive = (state.suggestActive + delta + items.length + 1) % (items.length + 1) - 1;
  items.forEach((li, index) => {
    const active = index === state.suggestActive;
    li.setAttribute('aria-selected', String(active));
    if (active) {
      els.input.value = state.suggestItems[index].text;
      li.scrollIntoView({ block: 'nearest' });
    }
  });
}

els.input.addEventListener('input', () => {
  els.clear.hidden = els.input.value.length === 0;
  clearTimeout(suggestTimer);
  const value = els.input.value.trim();
  if (value.length < 2) return closeSuggestions();
  suggestTimer = setTimeout(async () => {
    try {
      let items;
      if (state.backend) {
        const response = await fetch(`${state.apiBase}/api/suggest?q=${encodeURIComponent(value)}`);
        const data = await response.json();
        items = data.suggestions || [];
      } else {
        items = await staticSuggest(value);
      }
      if (els.input.value.trim() === value) openSuggestions(items);
    } catch {
      closeSuggestions();
    }
  }, 220);
});

els.input.addEventListener('keydown', (event) => {
  if (!els.suggestions.hidden) {
    if (event.key === 'ArrowDown') { event.preventDefault(); return highlightSuggestion(1); }
    if (event.key === 'ArrowUp') { event.preventDefault(); return highlightSuggestion(-1); }
    if (event.key === 'Escape') return closeSuggestions();
    if (event.key === 'Enter' && state.suggestActive >= 0) {
      event.preventDefault();
      els.input.value = state.suggestItems[state.suggestActive].text;
      closeSuggestions();
      return submit();
    }
  }
  if (event.key === 'Escape' && state.view === 'results') goHome();
});

els.suggestions.addEventListener('click', (event) => {
  const li = event.target.closest('li[data-index]');
  if (!li) return;
  els.input.value = state.suggestItems[Number(li.dataset.index)].text;
  closeSuggestions();
  submit();
});

document.addEventListener('click', (event) => {
  if (!els.form.contains(event.target)) closeSuggestions();
});

/* ---------------- AI modu ---------------- */

function stopAiStream() {
  if (state.aiStream) {
    state.aiStream.close();
    state.aiStream = null;
  }
  state.aiQuery = null;
}

function setAiEngine(engine, model) {
  els.aiEngine.textContent = engine === 'llm' ? model : 'yerel motor';
  els.engineBadge.textContent = engine === 'llm' ? `model: ${model}` : 'motor: yerel';
  els.footerAi.textContent = engine === 'llm' ? `AI motoru: ${model}` : 'AI motoru: yerel özütleyici';
}

function startAi(query) {
  if (!query) return;
  if (!state.backend) return staticStartAi(query);
  if (state.aiQuery === query && state.aiStream) return; // aynı sorgu, akış sürüyor

  stopAiStream();
  state.aiQuery = query;
  state.aiText = '';

  els.aiAnswer.innerHTML = '<span class="skeleton" style="display:block;height:16px;margin:0 0 8px"></span>'.repeat(3);
  els.aiBullets.innerHTML = '';
  els.aiCitations.innerHTML = '';
  els.aiSources.innerHTML = '';
  els.aiCitationsWrap.hidden = true;
  els.aiEngine.textContent = 'kaynaklar taranıyor…';

  const stream = new EventSource(`${state.apiBase}/api/ai/stream?q=${encodeURIComponent(query)}`);
  state.aiStream = stream;

  stream.onmessage = (event) => {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }

    switch (payload.type) {
      case 'sources': {
        els.aiSources.innerHTML = (payload.results || []).slice(0, 8)
          .map((r) => `<a class="src-pill" href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">
              ${escapeHtml(r.domain || r.provider)}</a>`)
          .join('');
        const count = payload.stats.duckduckgo + payload.stats.bing + payload.stats.wikipedia
          + payload.stats.googleNews + payload.stats.google;
        els.aiEngine.textContent = `${count} kaynak · ${formatTime(payload.took)}`;
        renderNotices(payload.notices);
        break;
      }
      case 'engine':
        setAiEngine(payload.engine, payload.model);
        break;
      case 'chunk':
        state.aiText += payload.text;
        els.aiAnswer.innerHTML = formatAnswer(state.aiText) + '<span class="ai-caret"></span>';
        break;
      case 'bullets':
        if (payload.bullets?.length) {
          els.aiBullets.innerHTML = payload.bullets.map((b) => `<li>${formatAnswer(b)}</li>`).join('');
        }
        break;
      case 'citations':
        if (payload.citations?.length) {
          els.aiCitationsWrap.hidden = false;
          els.aiCitations.innerHTML = payload.citations
            .map((c) => `
              <a class="cite-card" href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer">
                <span class="cite-num">${c.index}</span>
                <span class="cite-title">${escapeHtml(c.title)}</span>
              </a>`)
            .join('');
        }
        break;
      case 'notice':
        els.aiAnswer.insertAdjacentHTML('beforeend',
          `<div class="errors" style="margin-top:12px">${escapeHtml(payload.text)}</div>`);
        break;
      case 'done':
        els.aiAnswer.innerHTML = formatAnswer(state.aiText.replace(/\n{3,}/g, '\n\n'));
        setAiEngine(payload.engine, payload.model);
        stream.close();
        state.aiStream = null;
        break;
      case 'error':
        els.aiAnswer.innerHTML = `<div class="errors">AI yanıtı üretilemedi: ${escapeHtml(payload.message)}</div>`;
        stream.close();
        state.aiStream = null;
        break;
      default:
        break;
    }
  };

  stream.onerror = () => {
    if (state.aiStream) {
      els.aiAnswer.insertAdjacentHTML('beforeend',
        '<div class="errors" style="margin-top:12px">Bağlantı kesildi.</div>');
      stream.close();
      state.aiStream = null;
    }
  };
}

/* ---------------- sunucusuz (statik) mod ----------------
   GitLab/Pages gibi statik barındırmada Node sunucusu yoktur; bu mod
   tarayıcıdan doğrudan CORS'a açık kaynaklara bağlanır:
   Wikipedia API (arama + özet) ve Google autocomplete (JSONP).
   Aynı arayüz, aynı tasarım — sadece kaynaklar tarayıcı tarafındadır. */

function stripHtml(html = '') {
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const wikiApi = (lang) => `https://${lang}.wikipedia.org/w/api.php`;
function wikiPageUrl(title, lang) {
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(title).trim().replace(/\s+/g, '_'))}`;
}

// Dil kısıtı yok: statik modda bu diller birlikte taranır.
const WIKI_LANGS = ['tr', 'en'];

/** JSONP ile (CORS gerektirmeden) Google autocomplete çağırır. */
function jsonp(url, timeout = 4500) {
  return new Promise((resolve, reject) => {
    const cb = `__wlame_cb_${Math.random().toString(36).slice(2, 9)}`;
    const script = document.createElement('script');
    const timer = setTimeout(() => { cleanup(); reject(new Error('jsonp timeout')); }, timeout);
    function cleanup() {
      clearTimeout(timer);
      delete window[cb];
      script.remove();
    }
    window[cb] = (data) => { cleanup(); resolve(data); };
    script.src = `${url}&callback=${cb}`;
    script.onerror = () => { cleanup(); reject(new Error('jsonp failed')); };
    document.head.appendChild(script);
  });
}

async function staticSuggest(value) {
  const items = [];
  try {
    const data = await jsonp(
      `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(value)}`,
    );
    (data?.[1] || []).forEach((text) => items.push({ text: String(text), source: 'google' }));
  } catch { /* öneri yoksa sorun değil */ }
  return items;
}

/** Tek bir dilde Wikipedia araması. */
async function staticWikiSearchOne(q, lang) {
  const url = `${wikiApi(lang)}?action=query&list=search&srsearch=${encodeURIComponent(q)}` +
    '&srlimit=8&format=json&origin=*';
  const response = await fetch(url);
  if (!response.ok) throw new Error('Wikipedia yanıt vermedi');
  const data = await response.json();
  return (data.query?.search || []).map((item) => ({
    title: item.title,
    url: wikiPageUrl(item.title, lang),
    snippet: stripHtml(item.snippet),
    lang,
  }));
}

/** Dil kısıtı olmadan Wikipedia araması (tr + en harmanlanır). */
async function staticWikiSearch(q) {
  const lists = await Promise.all(
    WIKI_LANGS.map((lang) => staticWikiSearchOne(q, lang).catch(() => [])),
  );
  const seen = new Set();
  const merged = [];
  const maxLen = lists.reduce((max, list) => Math.max(max, list.length), 0);
  for (let i = 0; i < maxLen && merged.length < 8; i += 1) {
    for (const list of lists) {
      const item = list[i];
      if (!item) continue;
      const key = item.title.toLocaleLowerCase('tr');
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
      if (merged.length >= 8) break;
    }
  }
  return merged;
}

/** Verilen dil öncelikli, gerekirse diğer dillerde madde özeti. */
async function staticWikiExtract(title, lang) {
  const order = [...new Set([lang, ...WIKI_LANGS].filter(Boolean))];
  for (const l of order) {
    const url = `${wikiApi(l)}?action=query&prop=extracts&exintro&explaintext&redirects=1` +
      `&format=json&origin=*&titles=${encodeURIComponent(title)}`;
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const data = await response.json();
      const pages = data.query?.pages || {};
      const first = Object.values(pages)[0];
      if (!first?.extract) continue;
      return { title: first.title, url: wikiPageUrl(first.title, l), extract: first.extract };
    } catch { /* sonraki dil */ }
  }
  return null;
}

/** "nedir", "nasıl yapılır" gibi soru eklerini sıyırır ("kubernetes nedir" → "kubernetes"). */
function stripQuestionSuffix(q) {
  return String(q)
    .trim()
    .replace(/[?\\.!]+$/, '')
    .replace(
      /\s+(nedir|ne demek|ne yapar|ne işe yarar|nasıl yapılır|nasıl çalışır|nasıl kurulur|nasıl öğrenilir|kimdir|neden|nerede|neresi|kaç|ne)$/i,
      '',
    )
    .trim();
}

async function staticRunSearch(q) {
  const started = performance.now();
  const errors = [];
  const queryTerms = q.toLocaleLowerCase('tr')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 2);

  let wikiItems = [];
  try {
    wikiItems = await staticWikiSearch(q);
  } catch (err) {
    errors.push({ provider: 'wikipedia', message: err.message });
  }

  // Arama zayıfsa (örn. "kubernetes nedir") soru ekini sıyırıp yeniden ara ve
  // bulunanları birleştir.
  const cleaned = stripQuestionSuffix(q);
  if (cleaned && cleaned !== q && wikiItems.length < 3) {
    try {
      const extra = await staticWikiSearch(cleaned);
      const seen = new Set(wikiItems.map((item) => item.title));
      for (const item of extra) if (!seen.has(item.title)) wikiItems.push(item);
    } catch { /* önemli değil */ }
  }

  // Başlığı sorgu terimiyle başlayan veya içeren maddeler öne gelsin.
  const titleRank = (item) => {
    const title = item.title.toLocaleLowerCase('tr');
    let score = queryTerms.reduce((acc, term) => acc + (title.includes(term) ? 60 : 0), 0);
    for (const term of queryTerms) {
      if (term.length >= 6 && title.includes(term.slice(0, 5))) score += 12;
      if (title.startsWith(term)) score += 30;
    }
    return score;
  };
  wikiItems = [...wikiItems].sort((a, b) => titleRank(b) - titleRank(a));

  // Başlığı sorguyla en iyi örtüşen maddeden özet al.
  let summary = null;
  const strong = wikiItems.find((item) =>
    queryTerms.some((term) => item.title.toLocaleLowerCase('tr').includes(term)));
  for (const item of (strong ? [strong] : wikiItems)) {
    const found = await staticWikiExtract(item.title, item.lang).catch(() => null);
    if (found?.extract) { summary = found; break; }
  }

  const results = wikiItems.slice(0, 8).map((item) => ({
    title: item.title,
    url: item.url,
    snippet: item.snippet,
    provider: 'wikipedia',
    domain: `${item.lang || 'tr'}.wikipedia.org`,
  }));

  const took = Math.round(performance.now() - started);
  return {
    query: q,
    page: 1,
    took,
    results,
    wikipedia: wikiItems,
    wikipediaSummary: summary,
    news: [],
    errors,
    notices: [],
    circuit: { open: false },
    sources: {
      wikipedia: wikiItems.length,
      duckduckgo: 0,
      bing: 0,
      google: 0,
      brave: 0,
      googleNews: 0,
      webTotal: results.length,
      fallback: 'yok — sunucusuz sürüm',
      static: true,
    },
  };
}

function buildLocalAnswer(query, extracts) {
  const lead = (extracts[0]?.extract || '').replace(/\s+/g, ' ').trim();
  const firstSentence = (lead.match(/^[^.!?]+[.!?]/) || [lead.slice(0, 240)])[0].trim();
  const total = extracts.length;
  return `**${query}** hakkında ${total} Wikipedia maddesi tarandı ve öne çıkanlar şöyle:\n\n` +
    `${firstSentence} [1]\n\nDetaylar için kaynaklara göz atabilirsin.`;
}

function setAiEngineWeb() {
  els.engineBadge.textContent = 'motor: web sürümü';
  els.footerAi.textContent = 'web sürümü: Wikipedia + yerel özütleyici (sunucusuz)';
}

async function staticStartAi(query) {
  stopAiStream();
  state.aiQuery = query;
  els.aiAnswer.innerHTML = '<div class="skeleton" style="height:16px;border-radius:6px"></div>'.repeat(2);
  els.aiBullets.innerHTML = '';
  els.aiCitations.innerHTML = '';
  els.aiCitationsWrap.hidden = true;
  els.aiSources.innerHTML = '';
  els.aiEngine.textContent = 'Wikipedia okunuyor…';
  setAiEngineWeb();

  let wikiItems = [];
  try { wikiItems = await staticWikiSearch(query); } catch { /* boş */ }

  const extracts = [];
  for (const item of wikiItems.slice(0, 4)) {
    const found = await staticWikiExtract(item.title, item.lang).catch(() => null);
    if (found) extracts.push(found);
  }

  if (!extracts.length) {
    els.aiAnswer.innerHTML = '<div class="errors">Bu sorgu için Wikipedia\'dan özet üretilemedi.</div>';
    els.aiEngine.textContent = 'yerel (web)';
    return;
  }

  els.aiSources.innerHTML = extracts.slice(0, 8)
    .map((s) => `<a class="src-pill" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">` +
      `${escapeHtml(hostOf(s.url))}</a>`)
    .join('');

  els.aiAnswer.innerHTML = formatAnswer(buildLocalAnswer(query, extracts));
  if (extracts.length > 0) {
    els.aiBullets.innerHTML = extracts.map((s, i) => {
      const firstSentence = (s.extract.replace(/\s+/g, ' ').match(/^[^.!?]+[.!?]/) || [s.extract.slice(0, 160)])[0].trim();
      return `<li>${escapeHtml(s.title)} — ${escapeHtml(firstSentence)} <span class="cite" data-cite="${i + 1}">[${i + 1}]</span></li>`;
    }).join('');
  }
  els.aiCitationsWrap.hidden = false;
  els.aiCitations.innerHTML = extracts.map((s, i) => `
    <a class="cite-card" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">
      <span class="cite-num">${i + 1}</span>
      <span class="cite-title">${escapeHtml(s.title)}</span>
    </a>`).join('');
  els.aiEngine.textContent = `${extracts.length} kaynak · yerel (web sürümü)`;
}

/* ---------------- gezinme ---------------- */

function goHome() {
  stopAiStream();
  state.query = '';
  state.data = null;
  els.input.value = '';
  els.clear.hidden = true;
  setView('home');
  setTab('web', { render: false });
  document.title = 'wlame-dx';
  const url = new URL(location.href);
  ['q', 'tab', 'lang'].forEach((k) => url.searchParams.delete(k));
  history.pushState({}, '', url);
  els.input.focus();
}

/** Yazılan değer URL mi? (örn. https://x.com, www.ornek.com, ornek.com/yol, 192.168.1.1) */
function looksLikeUrl(value) {
  const t = value.trim();
  if (!t || /\s/.test(t)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return true; // şema: http:// ftp:// ...
  if (/^(www\.)[^\s/]+\.[a-z]{2,}/i.test(t)) return true; // www.ornek.com
  if (t.startsWith('localhost')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#].*)?$/.test(t)) return true; // IP adresi

  const hostPart = t.split(/[/?#]/)[0];
  const host = hostPart.replace(/:\d+$/, '').toLowerCase();
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return false;
  if (labels.some((label) => !/^[a-z0-9-]+$/i.test(label))) return false;
  const tld = labels[labels.length - 1];
  // "node.js" gibi kısa uzantıları adres sanmayalım — yaygın TLD listesi üzerinden karar ver.
  const COMMON_TLDS = new Set([
    'com', 'net', 'org', 'io', 'dev', 'me', 'co', 'info', 'biz', 'app', 'site',
    'store', 'pro', 'xyz', 'online', 'tech', 'cloud', 'gg', 'tv', 'one', 'live',
    'ai', 'ru', 'de', 'fr', 'es', 'it', 'nl', 'br', 'in', 'jp', 'cn', 'kr', 'ca',
    'au', 'pl', 'se', 'no', 'fi', 'dk', 'at', 'ch', 'be', 'pt', 'gr', 'cz', 'ro',
    'hu', 'ua', 'tr', 'us', 'uk', 'eu', 'asia', 'ae', 'sa', 'ir', 'il', 'kz', 'az',
  ]);
  // .com.tr, .org.tr gibi çok parçalı ulusal uzantılar
  if (labels.length >= 2 && /\.(com|org|net|edu|gov)\.tr$/i.test(host)) return true;
  if (labels.length >= 2 && /\.com\.(uk|br|au|jp|kr|mx|ar|cl|in)$/i.test(host)) return true;
  return COMMON_TLDS.has(tld) && labels[labels.length - 2].length >= 2;
}

function openUrl(value) {
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value.trim()}`;
  state.lastOpenUrl = url; // test/denetim için
  try { window.open(url, '_blank', 'noopener,noreferrer'); } catch { location.href = url; }
  showToast(`Adres yeni sekmede açıldı → ${hostOf(url)}`);
}

function submit() {
  const value = els.input.value.trim();
  if (!value) return;
  closeSuggestions();
  if (looksLikeUrl(value)) return openUrl(value);
  runSearch(value);
}

els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  submit();
});

els.brand.addEventListener('click', (event) => {
  event.preventDefault();
  goHome();
});

els.clear.addEventListener('click', () => {
  els.input.value = '';
  els.clear.hidden = true;
  els.input.focus();
  closeSuggestions();
  if (state.view === 'home') return;
  els.results.innerHTML = '';
  els.newsList.innerHTML = '';
  els.wikiCard.hidden = true;
  els.wikiList.innerHTML = '';
  els.stats.hidden = true;
  els.notices.hidden = true;
  els.errors.hidden = true;
});

els.tabNav.addEventListener('click', (event) => {
  const tab = event.target.closest('.tab');
  if (!tab) return;
  setTab(tab.dataset.tab);
});

window.addEventListener('popstate', () => applyUrl());

// Yıldız → sık kullanılanlara ekle/kaldır (sonuç ana. içindeki bağlantıyı tetiklemesin)
document.addEventListener('click', (event) => {
  const star = event.target.closest('.star');
  if (star) {
    event.preventDefault();
    event.stopPropagation();
    toggleFavorite(star);
    return;
  }
  const favDel = event.target.closest('.fav-del');
  if (favDel) {
    const card = favDel.closest('.fav');
    const url = card?.dataset.favUrl;
    if (url) {
      event.preventDefault();
      removeFavorite(url);
      showToast('Sık kullanılanlardan kaldırıldı');
    }
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement !== els.input) {
    event.preventDefault();
    els.input.focus();
  }
});

/* ---------------- başlangıç ---------------- */

function applyUrl() {
  const url = new URL(location.href);
  const q = url.searchParams.get('q');
  const tab = url.searchParams.get('tab') || 'web';

  if (!q) {
    goHomeSilent();
    return;
  }
  els.input.value = q;
  els.clear.hidden = false;
  state.query = '';
  setTab(tab, { render: false });
  runSearch(q, { push: false });
}

function goHomeSilent() {
  stopAiStream();
  state.query = '';
  state.data = null;
  els.input.value = '';
  els.clear.hidden = true;
  setView('home');
  setTab('web', { render: false });
  document.title = 'wlame-dx';
}

// Uzak backend adayları: aynı kaynak önce denenir, yoksa Vercel deployment'ı.
// İlk uygun aday seçilir; hiçbiri yoksa sayfa sunucusuz (statik) moda düşer.
const REMOTE_API_BASES = ['https://wlame-dx.vercel.app'];

async function detectBackend() {
  for (const base of ['', ...REMOTE_API_BASES]) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const response = await fetch(`${base}/api/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) continue;
      const health = await response.json();
      if (health && health.ai && Array.isArray(health.providers)) {
        state.apiBase = base;
        return true;
      }
    } catch {
      /* sıradaki adayı dene */
    }
  }
  return false;
}

async function init() {
  state.backend = await detectBackend();
  if (!state.backend) {
    // GitHub Pages gibi statik barındırma: sunucusuz mod.
    els.chipGoogle.classList.add('off');
    els.chipBrave.classList.add('off');
    els.chipDdg.classList.add('off');
    els.chipBing.classList.add('off');
    setAiEngineWeb();
  }

  if (state.backend) {
    try {
      const health = await (await fetch(`${state.apiBase}/api/health`)).json();
      setAiEngine(health.ai.engine, health.ai.model);

      const googleReady = health.providers.find((p) => p.id === 'google')?.webSearchConfigured;
      els.chipGoogle.classList.toggle('off', !googleReady);
      els.chipGoogle.title = googleReady
        ? 'Google web sonuçları açık (Custom Search API)'
        : 'Google web sonuçları kapalı — autocomplete ve haberler aktif';

      const braveReady = health.providers.find((p) => p.id === 'brave')?.webSearchConfigured;
      els.chipBrave.classList.toggle('off', !braveReady);
      els.chipBrave.title = braveReady
        ? 'Brave Search açık (yedek web sağlayıcı)'
        : 'Brave Search kapalı — BRAVE_API_KEY ile açılır';

      if (health.providers.find((p) => p.id === 'duckduckgo')?.circuitOpen) {
        els.chipDdg.classList.add('off');
        els.chipDdg.title = 'DuckDuckGo bu ağdan gelen istekleri geçici olarak engelliyor';
      }
    } catch {
      /* sağlık kontrolü başarısız — sorun değil */
    }
  }

  applyUrl();
  renderFavorites();
  if (!state.query) els.input.focus();
}

init();

// Test ve konsol denetimi için küçük bir kanca.
window.__wlame = { state, looksLikeUrl, isFavorite, favorites };
