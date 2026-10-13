// wlame-dx uçtan uca testler — `npm test`
// Sunucuyu ayrı bir portta ayağa kaldırır, gerçek ağ istekleriyle API'yi doğrular.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}`;

let child;

async function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      /* henüz hazır değil */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Sunucu zaman aşımına uğradı');
}

before(async () => {
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', WLAME_LOG: '0' },
    stdio: 'ignore',
  });
  await waitForServer();
});

after(() => {
  child?.kill();
});

test('1) sağlık kontrolü', async () => {
  const res = await fetch(`${BASE}/api/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.name, 'wlame-dx');
  assert.ok(['local', 'llm'].includes(data.ai.engine));
  console.log(`   → AI motoru: ${data.ai.engine} (${data.ai.model})`);
});

test('2) ana sayfa yükleniyor', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /wlame-dx/);
  assert.match(html, /styles\.css/);
});

test('3) öneriler (Google autocomplete + Wikipedia)', async () => {
  const res = await fetch(`${BASE}/api/suggest?q=node&lang=tr`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.suggestions));
  console.log(`   → ${data.suggestions.length} öneri: ${data.suggestions.slice(0, 4).map((s) => s.text).join(' | ')}`);
});

test('4) Wikipedia özeti', async () => {
  const res = await fetch(`${BASE}/api/wiki?q=JavaScript&lang=tr`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.summary, 'Wikipedia özeti bulunamadı');
  assert.ok(data.summary.extract.length > 50);
  console.log(`   → ${data.summary.title}: ${data.summary.extract.slice(0, 90)}…`);
});

test('5) birleşik arama: web + Wikipedia + Haberler', async () => {
  const res = await fetch(`${BASE}/api/search?q=node.js&lang=tr`);
  assert.equal(res.status, 200);
  const data = await res.json();
  console.log(`   → ${data.results.length} web, ${data.wikipedia.length} wiki, ${data.news.length} haber (${data.took} ms)`);
  if (data.notices?.length) console.log(`   → uyarı: ${data.notices.map((n) => n.provider).join(', ')}`);
  if (data.errors?.length) console.log(`   → hata: ${data.errors.map((e) => `${e.provider}(${e.message.slice(0, 60)})`).join(', ')}`);

  assert.ok(
    data.results.length + data.wikipedia.length + data.news.length > 0,
    'Hiç sonuç yok (web/wiki/haber)',
  );
  if (data.results.length) {
    const first = data.results[0];
    assert.ok(first.title && first.url.startsWith('http'));
    assert.ok(['duckduckgo', 'google', 'brave', 'bing', 'marginalia'].includes(first.provider));
    console.log(`   → ilk sonuç [${first.provider}]: ${first.title}`);
  } else {
    console.log('   → web sonucu yok (bu ağdan motorlara ulaşılamadı); haber/wiki dolu');
  }
});

test('5b) hız sınırı: art arda 3 sorgu sorunsuz dönüyor', async () => {
  const queries = ['vue.js', 'rust dili', 'kubernetes nedir'];
  const started = Date.now();
  const responses = await Promise.all(queries.map((q) => fetch(`${BASE}/api/search?q=${encodeURIComponent(q)}`)));
  const payloads = await Promise.all(responses.map((r) => r.json()));
  const valid = payloads.filter((p) => Array.isArray(p.results) && Array.isArray(p.wikipedia));
  const withWeb = payloads.filter((p) => p.results.length > 0).length;
  console.log(`   → ${withWeb}/3 sorgu web sonucu döndürdü (${Date.now() - started} ms)`);
  payloads.forEach((p, i) => {
    const engines = Object.entries(p.sources)
      .filter(([k, v]) => typeof v === 'number' && v > 0 && ['duckduckgo', 'bing', 'google', 'brave', 'marginalia'].includes(k))
      .map(([k]) => k)
      .join('+');
    console.log(`   → ${queries[i]}: ${p.results.length} web sonucu [${engines || 'yok'}]`);
  });
  assert.equal(valid.length, 3, 'Art arda sorgulardan biri geçersiz yanıt döndü');
});

test('5c) yedek motor zinciri hazır', async () => {
  const res = await fetch(`${BASE}/api/health`);
  const data = await res.json();
  const bing = data.providers.find((p) => p.id === 'bing');
  assert.ok(bing, 'Bing yedek sağlayıcısı tanımlı değil');
  console.log(`   → yedek motor: ${data.fallback}, ddg devre kesici: ${data.providers[0].circuitOpen ? 'açık' : 'kapalı'}`);
});

test('6) AI modu (SSE akışı)', async () => {
  const res = await fetch(`${BASE}/api/ai/stream?q=node.js%20nedir&lang=tr`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);

  const text = await res.text();
  const events = text
    .split('\n\n')
    .filter(Boolean)
    .map((block) => block.replace(/^data:\s*/, ''))
    .map((payload) => { try { return JSON.parse(payload); } catch { return null; } })
    .filter(Boolean);

  const types = events.map((e) => e.type);
  assert.ok(types.includes('sources'), 'kaynak olayı gelmedi');
  assert.ok(types.includes('chunk'), 'metin akışı gelmedi');
  assert.ok(types.includes('done'), 'bitiş olayı gelmedi');

  const answer = events.filter((e) => e.type === 'chunk').map((e) => e.text).join('');
  assert.ok(answer.length > 80, 'AI yanıtı çok kısa');
  const citations = events.find((e) => e.type === 'citations');
  console.log(`   → AI yanıtı ${answer.length} karakter, ${citations?.citations?.length ?? 0} kaynak`);
  console.log(`   → "${answer.slice(0, 130).replace(/\n/g, ' ')}…"`);
});

test('7) AI modu (tek seferlik JSON)', async () => {
  const res = await fetch(`${BASE}/api/ai?q=python%20programlama%20dili&lang=tr`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.answer.length > 40);
  assert.ok(Array.isArray(data.citations));
  console.log(`   → motor: ${data.engine}, ${data.citations.length} kaynak`);
});

test('8) boş sorgu reddediliyor', async () => {
  const res = await fetch(`${BASE}/api/search?q=`);
  assert.equal(res.status, 400);
});

test('9) bilinmeyen API yolu 404 döner', async () => {
  const res = await fetch(`${BASE}/api/yok-boyle-bir-sey`);
  assert.equal(res.status, 404);
});
