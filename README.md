# wlame-dx

Siyah–gri gradyan arayüzlü, çok kaynaklı **meta arama motoru + AI modu**. Sıfır npm
bağımlılığı — yalnızca Node.js yerleşik modülleri.

```
Kaynaklar:  DuckDuckGo  ·  Bing (yedek)  ·  Wikipedia  ·  Google (öneri + haber)  ·  Brave (opsiyonel)
AI modu:    yerel özütleyici motor (anahtarsız)  veya  LLM (AI_API_KEY ile)
```

> Bu repo aynı anda iki dağıtımı barındırır:
>
> | Parça | Nerede | Adres |
> |---|---|---|
> | **Statik arayüz** | GitHub Pages (repo kökü) | <https://wlame-dx.github.io/web/> |
> | **Node backend** | Vercel (serverless, `api/` klasörü) | `https://wlame-dx.vercel.app/api` |
>
> Statik sayfa backend'i otomatik bulur: aynı kaynakta `/api` yoksa Vercel'i dener,
> o da yoksa **sunucusuz moda** düşer (tarayıcıdan doğrudan Wikipedia API + Google
> JSONP öneri + yerel özütleyici). Yani site her ortamda çalışır.

## Özellikler

- **Birleşik sonuçlar** – DuckDuckGo, Wikipedia, Google Haberler ve yedek motor
  sonuçları tek listede; alan adına göre tekilleştirilmiş ve sorguya göre sıralanmış.
- **AI modu** – `✦ AI Modu` sekmesi. Kaynakları canlı olarak (SSE ile) tarayıp
  numaralı kaynak atıflarıyla akıcı bir yanıt üretir; yanıt harf harf akar.
- **Wikipedia kartı** – sorguya en uygun maddenin özeti, görseli ve bağlantısı.
- **Otomatik tamamlama** – Google autocomplete + Wikipedia opensearch birleşimi.
- **Sekmeler** – Web / Haberler / Wikipedia / AI. `TR ⇄ EN` dil düğmesi.
- **Sık kullanılanlar** – Sonuç kartlarındaki ★ ile kaydedilir, `localStorage`'da
  saklanır, ana sayfada favicon'lu kartlar hâlinde listelenir.
- **URL kutusu** – Arama kutusuna `example.com`, `www.ornek.com` veya
  `https://sitelink/yol` gibi bir adres yazıp Enter'a basınca arama yapmaz,
  adresi yeni sekmede açar.
- **Kısayol** – `/` tuşu arama kutusuna odaklanır.

## Hızlı başlangıç (yerel)

```powershell
cd C:\Users\Bisen\Desktop\wlame-dx
npm start                 # → http://127.0.0.1:8787  (statik + API birlikte)
```

```powershell
npm test                  # 11 uçtan uca test (gerçek ağ istekleriyle)
npm run dev               # dosya değişiminde otomatik yeniden başlat
```

`.env` için `.env.example` şablonunu kullanın (isteğe bağlı).

## Dağıtım

### GitHub Pages (statik arayüz)

Repo kökündeki `index.html`, `styles.css`, `app.js` sayfası `wlame-dx.github.io/web`
adresinden servis edilir. Pages bu kökten yayınlanır; gerekirse:

```powershell
gh api repos/wlame-dx/web/pages -X POST `
  -f "build_type=legacy" -f "source[branch]=main" -f "source[path]=/"
```

### Vercel (backend)

Sunucusuz fonksiyonlar `api/[[...path]].js` (tek giriş) ile `src/http-api.js`
çekirdeğini kullanır — yerel sunucuyla **aynı kod**.

```powershell
npx vercel --prod        # proje adı: wlame-dx  (Root Directory: kök)
```

Ortam değişkenleri Vercel paneline eklenir (aşağıya bakın). Ön yüzdeki uzak adres
`app.js` içindeki `REMOTE_API_BASES` dizisinden gelir; deployment adresi farklıysa
oraya yazmanız yeterlidir.

### Sunucusuz (statik) mod

Backend erişilemezse sayfa kendiliğinden tarayıcı tarafı kaynaklara geçer:
Wikipedia arama + özet kartı, Google JSONP öneri ve yerel cümle-özetleyici AI.
Haberler sekmesi bu modda bilgilendirici bir not gösterir.

## Sağlayıcılar ve dayanıklılık

Arama motorları veri merkezi IP'lerine bot koruması uygular. wlame-dx bunu
gizlemez, **açıkça bildirir** ve otomatik olarak yedek kaynağa geçer.

| Sağlayıcı | Durum | Yöntem |
|---|---|---|
| **DuckDuckGo** | Birincil web motoru | `duckduckgo.com/html` POST + hız sınırı ve devre kesici |
| **Bing** | Yedek web motoru | Sonuç sayfası; `ck/a` yönlendirmeleri çözülür |
| **Mojeek** | Son çare yedek web motoru | Anahtarsız; DDG ve Bing veri merkezi IP'lerinde engellenirse denenir |
| **Wikipedia** | Her zaman açık | MediaWiki Action + REST API |
| **Google** | Öneri + Haberler her zaman; web için anahtar | Autocomplete, News RSS, Custom Search JSON API |
| **Brave** | Opsiyonel | `BRAVE_API_KEY` ile ikinci yedek |

- İstekler arasında en az 1,6 sn bekleyen bir kuyruk (`Throttle`).
- 403 / 429 / 202 yanıtları "bot koruması" sayılır; artan beklemelerle yeniden denenir.
- Üst üste 2 engelden sonra **devre kesici** açılır, DDG 5 dakika atlanır.
- Sonuç önbelleği 10 dakika; boş aramalar önbelleğe alınmaz.

## Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT`, `HOST` | `8787`, `127.0.0.1` | Yerel sunucu |
| `GOOGLE_API_KEY` + `GOOGLE_CSE_ID` | — | Google Programmable Search web sonuçları |
| `BRAVE_API_KEY` | — | Brave Search yedek motoru |
| `AI_API_KEY` | — | OpenAI uyumlu LLM anahtarı (AI modu için) |
| `AI_BASE_URL` | `https://api.openai.com/v1` | LLM uç noktası |
| `AI_MODEL` | `gpt-4o-mini` | Model adı |
| `WLAME_DDG_*` | — | DDG kuyruk/devre kesici ayarları |

Anahtar yoksa **yerel özütleyici motor** çalışır: Wikipedia özeti + arama
snippet'leri + haber başlıklarından cümleleri ayıklar, sorguyla örtüşmeyenleri
eler, tanım cümlesini başa alır. `AI_API_KEY` verilirse aynı kaynaklar modele
beslenir ve kaynak numaralı akıcı yanıt üretilir.

## HTTP API

| Uç nokta | Açıklama |
|---|---|
| `GET /api/search?q=&lang=tr&page=1` | Birleşik sonuçlar (JSON) |
| `GET /api/suggest?q=&lang=tr` | Otomatik tamamlama |
| `GET /api/wiki?q=&lang=tr` | Wikipedia özeti + madde listesi |
| `GET /api/ai?q=&lang=tr` | AI yanıtı (tek seferlik JSON) |
| `GET /api/ai/stream?q=&lang=tr` | AI yanıtı (Server-Sent Events) |
| `GET /api/health` | Sağlayıcı ve motor durumu |

## Proje yapısı

```
wlame-dx/
├── index.html / styles.css / app.js   # statik arayüz (Pages + kök)
├── server.js                          # yerel sunucu (statik + API)
├── src/
│   ├── http-api.js                    # API çekirdeği (Vercel ile ortak)
│   ├── util.js                        # HTML temizleme, Throttle, TTL önbellek
│   ├── aimode.js                      # AI modu (yerel özütleyici + LLM akışı)
│   └── providers/                     # duckduckgo, bing, wikipedia, google, brave
├── api/[[...path]].js                 # Vercel catch-all (tek giriş)
├── vercel.json                        # Vercel yapılandırması
└── test/search.test.mjs               # 11 uçtan uca test
```

## Tasarım

Arka plan `radial-gradient` + dikey `linear-gradient(165deg, #040405 → #22262d)`
katmanlarından oluşur; üzerinde ince bir ızgara ve iki yumuşak ışık lekesi var.
Paneller yarı saydam gradyanlar, cam efektli üst bar ve ince gri çerçeveler
kullanır. Tema neredeyse tamamen monokrom: siyah, gri ve beyaz; renk yalnızca
kaynak rozetlerinde (DuckDuckGo / Wikipedia / Google) görünür.