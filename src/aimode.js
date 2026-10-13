// wlame-dx AI modu.
//
// İki motor desteklenir:
//   • "local"  → tamamen yerel, anahtar gerektirmeyen özütleyici özet motoru.
//                (Wikipedia + arama sonuçları + haberlerden cümle seçer)
//   • "llm"    → OpenAI uyumlu bir API anahtarı verilirse (AI_API_KEY) kaynakları
//                modele besleyip kaynak numaralı akıcı bir yanıt üretir.
//
// AI modu hiçbir şekilde google.com/search sayfasını kazımaz; Google verisi
// yalnızca açık API/RSS uç noktalarından gelir.
import { terms, stripTags } from './util.js';
import { fetchWithTimeout, UA } from './util.js';

function llmConfig() {
  return {
    key: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '',
    baseUrl: (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: process.env.AI_MODEL || 'gpt-4o-mini',
  };
}

export function engineInfo() {
  const { key, model } = llmConfig();
  return {
    engine: key ? 'llm' : 'local',
    model: key ? model : 'wlame-dx özütleyici motor v1',
  };
}

/** Cümlelere ayırır (Türkçe kısaltmalara toleranslı). */
function splitSentences(text = '') {
  return String(text)
    .replace(/\s+/g, ' ')
    .replace(/\s*(?:…|\.\.\.)?\s*Devamını oku\s*$/i, '')
    .replace(/\s*Read more\s*$/i, '')
    .split(/(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ0-9"“])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 35 && s.length < 400);
}

/** Metnin ilk anlamlı cümlesini döndürür (tanım cümlesi için). */
function firstProseSentence(text = '') {
  const sentences = String(text)
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ0-9"“])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30);

  for (const sentence of sentences.slice(0, 3)) {
    if (/\|/.test(sentence) || /\^\s*"/.test(sentence)) continue;
    return sentence.length > 340 ? `${sentence.slice(0, 337).replace(/\s+\S*$/, '')}…` : sentence;
  }
  return null;
}

/** Cümle gerçekten akıcı bir metin mi, yoksa başlık/kaynakça yığını mı? */
function looksLikeProse(sentence) {
  if (!/^["“A-ZÇĞİÖŞÜ0-9]/.test(sentence)) return false;
  if (/\^\s*"/.test(sentence)) return false; // Wikipedia dipnot kalıntısı
  if (/\[\d+\]/.test(sentence)) return false;
  if ((sentence.match(/\|/g) || []).length > 1) return false;
  if (/\.\.\.$|…$/.test(sentence)) return false;

  const words = sentence.split(/\s+/);
  if (words.length < 9) return false;

  // Büyük harfle başlayan kelime oranı çok yüksekse bu bir başlık listesidir.
  const capitalized = words.filter((w) => /^[A-ZÇĞİÖŞÜ]/.test(w)).length / words.length;
  if (capitalized > 0.45) return false;

  // Noktalama yoğunluğu aşırıysa (menü/kategori listesi) ele.
  const punctuation = (sentence.match(/[,;:]/g) || []).length / words.length;
  if (punctuation > 0.22) return false;

  return true;
}

/** Bir cümleyi sorgu terimlerine ve kaynak kalitesine göre puanlar. */
function sentenceScore(sentence, queryTerms, position, weight) {
  const lower = sentence.toLocaleLowerCase('tr');
  let value = weight;
  for (const term of queryTerms) {
    if (lower.includes(term)) value += 4;
  }
  value += Math.max(0, 10 - position) * 0.6; // erken cümleler hafif avantajlı
  if (/\d{3,}/.test(sentence)) value -= 0.8; // kaynak/tarih kalıntıları
  else if (/\d/.test(sentence)) value += 0.5; // sade sayılar (tarih, miktar)
  return value;
}

/** Kaynak metinlerinden en iyi cümleleri seçer. */
function pickSentences(sources, queryTerms, limit = 5) {
  const candidates = [];
  sources.forEach((source, sourceIndex) => {
    splitSentences(source.text).forEach((sentence, position) => {
      if (!looksLikeProse(sentence)) return;
      const lower = sentence.toLocaleLowerCase('tr');
      const matched = queryTerms.filter((term) => lower.includes(term)).length;
      candidates.push({
        sentence,
        sourceIndex,
        matched,
        score: sentenceScore(sentence, queryTerms, position, source.weight ?? 0),
      });
    });
  });

  // Alakasız cümleleri ele: en az bir sorgu terimi geçmeli.
  // (Yeterli eşleşme yoksa hiç sonuç dönmemesi yerine gevşetip devam ederiz.)
  const relevant = candidates.filter((candidate) => candidate.matched >= 1);
  const pool = relevant.length >= 2 ? relevant : candidates;

  const chosen = [];
  const seen = new Set();
  for (const candidate of pool.sort((a, b) => b.score - a.score || b.matched - a.matched)) {
    const fingerprint = candidate.sentence.toLocaleLowerCase('tr').slice(0, 60);
    if (seen.has(fingerprint)) continue;
    // aynı kaynaktan en fazla 2 cümle
    if (chosen.filter((c) => c.sourceIndex === candidate.sourceIndex).length >= 2) continue;
    seen.add(fingerprint);
    chosen.push(candidate);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

function buildLocalAnswer(query, ctx) {
  const queryTerms = terms(query);
  const sources = [];

  const summarySource = ctx.wikipediaSummary?.extract
    ? {
      text: ctx.wikipediaSummary.extract,
      title: ctx.wikipediaSummary.title,
      url: ctx.wikipediaSummary.url,
      provider: 'wikipedia',
      weight: 6,
    }
    : null;
  if (summarySource) sources.push(summarySource);

  ctx.wikipedia.slice(0, 4).forEach((item) => {
    if (item.snippet) sources.push({ text: item.snippet, ...item, weight: 1 });
  });
  ctx.results.slice(0, 6).forEach((item) => {
    if (item.snippet) sources.push({ text: item.snippet, ...item, weight: 2 });
  });
  ctx.news.slice(0, 4).forEach((item) => {
    if (item.snippet) sources.push({ text: `${item.snippet}`, ...item, weight: 0 });
  });

  const citations = [];
  const citeIndex = new Map();
  const citeFor = (source) => {
    if (!source?.url) return '';
    if (!citeIndex.has(source.url)) {
      citations.push({
        index: citations.length + 1,
        title: source.title || source.url,
        url: source.url,
        provider: source.provider || 'web',
      });
      citeIndex.set(source.url, citations.length);
    }
    return `[${citeIndex.get(source.url)}]`;
  };

  // Ansiklopedik kayıtlarda ilk cümle tanımdır: her zaman başa al.
  // Ama özet sorguyla alakasızsa (Wikipedia bazen yanlış maddeye düşer) atla.
  const leadRelevant = summarySource
    ? queryTerms.some((term) => summarySource.title.toLocaleLowerCase('tr').includes(term)
      || summarySource.text.slice(0, 300).toLocaleLowerCase('tr').includes(term))
    : false;
  const lead = leadRelevant ? firstProseSentence(summarySource.text) : null;
  const leadFingerprint = lead ? lead.toLocaleLowerCase('tr').slice(0, 60) : '';

  const picked = pickSentences(sources, queryTerms, 4)
    .filter((item) => item.sentence.toLocaleLowerCase('tr').slice(0, 60) !== leadFingerprint);

  if (!lead && picked.length === 0) {
    return {
      answer: `"${query}" için yeterli kaynak metni bulunamadı. Web sekmesindeki bağlantılara göz atabilirsin.`,
      bullets: [],
      citations: [],
    };
  }

  const parts = [];
  if (lead) parts.push(`${lead} ${citeFor(summarySource)}`.trim());
  for (const item of picked) {
    parts.push(`${item.sentence} ${citeFor(sources[item.sourceIndex])}`.trim());
  }

  const answer = `**${query}** için ${sources.length} kaynak tarandı ve öne çıkan bilgiler şöyle:\n\n${parts.join(' ')}`;

  const bullets = [];
  if (lead) bullets.push(`${lead} ${citeFor(summarySource)}`.trim());
  picked.slice(0, 3).forEach((item) => {
    bullets.push(`${item.sentence} ${citeFor(sources[item.sourceIndex])}`.trim());
  });

  return { answer, bullets, citations };
}

function buildPrompt(query, ctx) {
  const lines = [];
  if (ctx.wikipediaSummary?.extract) {
    lines.push(`[K1] Wikipedia — ${ctx.wikipediaSummary.title}: ${ctx.wikipediaSummary.extract}`);
  }
  let counter = 2;
  const pushItem = (item, label) => {
    if (!item.snippet) return;
    lines.push(`[K${counter}] ${label} — ${item.title}: ${item.snippet}`);
    counter += 1;
  };
  ctx.results.slice(0, 8).forEach((item) => pushItem(item, item.provider === 'google' ? 'Google' : 'DuckDuckGo'));
  ctx.wikipedia.slice(0, 3).forEach((item) => pushItem(item, 'Wikipedia'));
  ctx.news.slice(0, 4).forEach((item) => pushItem(item, 'Haberler'));

  return `Aşağıdaki kaynakları kullanarak kullanıcının sorusunu Türkçe yanıtla.

Kurallar:
- Yalnızca verilen kaynaklara dayan, kaynakta olmayan bilgi uydurma.
- 2-4 paragraf, net ve akıcı yaz.
- İddiaların sonuna kaynak numarası ekle, örn: [1], [2].
- Bilgi kaynaklarda yoksa bunu açıkça söyle.

Soru: ${query}

Kaynaklar:
${lines.join('\n')}`;
}

async function callLlm(query, ctx, { stream = false } = {}) {
  const { key, baseUrl, model } = llmConfig();
  const response = await fetchWithTimeout(
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'User-Agent': UA,
      },
      body: JSON.stringify({
        model,
        stream,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: 'Sen wlame-dx arama motorunun AI modusun. Kaynaklara dayalı, kısa ve doğru Türkçe yanıtlar verirsin.',
          },
          { role: 'user', content: buildPrompt(query, ctx) },
        ],
      }),
    },
    45000,
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`LLM HTTP ${response.status} ${body.slice(0, 200)}`);
  }
  return response;
}

function collectCitations(ctx) {
  const citations = [];
  const seen = new Set();
  const add = (item, provider) => {
    if (!item?.url || seen.has(item.url)) return;
    seen.add(item.url);
    citations.push({
      index: citations.length + 1,
      title: item.title || item.url,
      url: item.url,
      provider,
    });
  };
  if (ctx.wikipediaSummary) add(ctx.wikipediaSummary, 'wikipedia');
  ctx.wikipedia.forEach((item) => add(item, 'wikipedia'));
  ctx.results.forEach((item) => add(item, item.provider));
  ctx.news.forEach((item) => add(item, 'google-news'));
  return citations;
}

/** AI yanıtını üretir (tam metin). */
export async function buildAnswer(query, ctx) {
  const { key } = llmConfig();
  if (key) {
    try {
      const response = await callLlm(query, ctx, { stream: false });
      const data = await response.json();
      const answer = data?.choices?.[0]?.message?.content?.trim();
      if (answer) {
        return {
          answer,
          bullets: [],
          citations: collectCitations(ctx),
          engine: 'llm',
          model: llmConfig().model,
        };
      }
    } catch (err) {
      // LLM başarısız olursa yerel motora düş.
      const local = buildLocalAnswer(query, ctx);
      return {
        ...local,
        engine: 'local',
        fallbackReason: err.message,
      };
    }
  }

  const local = buildLocalAnswer(query, ctx);
  return { ...local, engine: 'local', model: engineInfo().model };
}

/** AI yanıtını parça parça üretir (SSE için). */
export async function* answerStream(query, ctx) {
  const { key } = llmConfig();
  const citations = collectCitations(ctx);

  if (key) {
    try {
      const response = await callLlm(query, ctx, { stream: true });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let produced = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop() ?? '';
        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const delta = json?.choices?.[0]?.delta?.content;
            if (delta) {
              produced = true;
              yield { type: 'chunk', text: delta };
            }
          } catch {
            /* eksik JSON parçası, yoksay */
          }
        }
      }

      if (produced) {
        yield { type: 'citations', citations };
        yield { type: 'done', engine: 'llm', model: llmConfig().model };
        return;
      }
    } catch (err) {
      yield { type: 'notice', text: `Model yanıtı alınamadı, yerel motora geçiliyor. (${err.message})` };
    }
  }

  const local = buildLocalAnswer(query, ctx);
  yield { type: 'engine', engine: 'local', model: engineInfo().model };
  const words = local.answer.split(/(\s+)/);
  let chunk = '';
  for (let i = 0; i < words.length; i += 1) {
    chunk += words[i];
    if (chunk.length > 22 || i === words.length - 1) {
      yield { type: 'chunk', text: chunk };
      chunk = '';
      await new Promise((resolve) => setTimeout(resolve, 18));
    }
  }
  yield { type: 'bullets', bullets: local.bullets };
  yield { type: 'citations', citations: local.citations.length ? local.citations : citations };
  yield { type: 'done', engine: 'local', model: engineInfo().model };
}

export { stripTags };
