// Vercel serverless fonksiyonları için ortak ayarlayıcı.
// Her uç nokta dosyası (api/*.js) bunu çağırır; tek noktadan OPTIONS/CORS ve
// hata yönetimi sağlanır, gerçek iş src/http-api.js'deki handleApi'dedir.
import { handleApi } from './http-api.js';

const OPTIONS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function makeHandler() {
  return async function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, OPTIONS_HEADERS);
      res.end();
      return;
    }

    if (!url.pathname.startsWith('/api/')) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Yalnızca /api/* uç noktaları', path: url.pathname }));
      return;
    }

    try {
      await handleApi(req, res, url);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      } else {
        res.end();
      }
    }
  };
}