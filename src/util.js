// Ortak yardımcılar: HTML temizleme, ağ istekleri, önbellek.
export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export class ProviderError extends Error {
  constructor(provider, message, status = 502) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
  }
}

/** Zaman aşımı kontrollü fetch. */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    throw new ProviderError('network', `İstek başarısız: ${err.message}`, 504);
  } finally {
    clearTimeout(timer);
  }
}

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
  '#x27': "'", '#34': '"', hellip: '…', mdash: '—', ndash: '–', rsquo: '’',
  lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', bull: '•', deg: '°',
};

/** HTML entity'lerini çözer. */
export function htmlDecode(input = '') {
  return String(input).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, code) => {
    if (code in ENTITIES) return ENTITIES[code];
    if (code[0] === '#') {
      const num = code[1] === 'x' || code[1] === 'X'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      if (Number.isFinite(num)) return String.fromCodePoint(num);
    }
    return full;
  });
}

/** Etiketleri siler, boşlukları sadeleştirir. */
export function stripTags(html = '') {
  return htmlDecode(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** DuckDuckGo yönlendirme bağlantısını gerçek adrese çevirir. */
export function decodeRedirect(href = '') {
  let url = htmlDecode(href).trim();
  if (url.startsWith('//')) url = 'https:' + url;
  try {
    const parsed = new URL(url);
    const target = parsed.searchParams.get('uddg');
    if (target) return decodeURIComponent(target);
  } catch {
    /* yoksay */
  }
  return url;
}

/** Sonuçları alan adına göre gruplamak için anahtar üretir. */
export function dedupeKey(url = '') {
  try {
    const u = new URL(url);
    // Yeni Bing yönlendirmeleri (ck/a?!&p=<hash>) gerçek adresi açık vermiyor;
    // hepsinin anahtarı aynı olmasın diye hash'i de anahtara katıyoruz.
    if (u.hostname.replace(/^www\./, '') === 'bing.com' && u.pathname.startsWith('/ck/a')) {
      return `bing.com/ck/a#${u.searchParams.get('p') || u.hash || ''}`;
    }
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    return `${u.hostname.replace(/^www\./, '')}${path}`;
  } catch {
    return url.toLowerCase();
  }
}

export function domainOf(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function faviconFor(url = '') {
  const host = domainOf(url);
  if (!host) return '';
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

/** Sorgu terimlerini çıkarır (küçük harf). */
export function terms(query = '') {
  return String(query)
    .toLocaleLowerCase('tr')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2);
}

/** Aynı sonucu tekrar döndürmemek için basit TTL önbelleği. */
export class TTLCache {
  constructor(limit = 400, ttlMs = 5 * 60 * 1000) {
    this.limit = limit;
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    if (this.map.size >= this.limit) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
    return value;
  }

  async wrap(key, factory) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await factory();
    this.set(key, value);
    return value;
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Aynı hedefe giden istekleri sıraya koyar ve aralarında en az `minIntervalMs`
 * bekletir. Arama motorları kısa sürede çok istek gelirse bot korumasını devreye
 * aldığı için bu, wlame-dx'in en kritik dayanıklılık parçasıdır.
 */
export class Throttle {
  constructor(minIntervalMs = 1500) {
    this.minIntervalMs = minIntervalMs;
    this.lastStartedAt = 0;
    this.queue = Promise.resolve();
  }

  run(task) {
    const result = this.queue.then(async () => {
      const wait = this.lastStartedAt + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastStartedAt = Date.now();
      return task();
    });
    // Kuyruk, görev hata verse bile devam etmeli.
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/** Belirli hatalarda artan bekleme süreleriyle yeniden dener. */
export async function withRetry(task, { attempts = 3, delays = [800, 2000, 4000], shouldRetry = () => true } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await task(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === attempts - 1 || !shouldRetry(err, attempt)) break;
      const delay = delays[Math.min(attempt, delays.length - 1)];
      await sleep(delay + Math.floor(Math.random() * 300));
    }
  }
  throw lastError;
}

export function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
