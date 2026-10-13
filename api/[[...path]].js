// wlame-dx — Vercel sunucusuz giriş noktası.
//
// api/[[...path]].js, Vercel'de /api/* altındaki HER isteği yakalar ve aynı
// Node tarzı req/res öz sözleşmesiyle src/http-api.js'deki handleApi'ye devreder.
// Böylece yerel sunucu ile Vercel arasında kod tekrarı olmaz; SSE dahil her
// uç nokta tek kaynaktan çalışır.

import { handleApi } from '../src/http-api.js';

export const config = {
  runtime: 'nodejs20.x',
  maxDuration: 60,
};

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // Vercel bu projede yalnızca API barındırır; arayüz GitHub Pages'te.
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
}