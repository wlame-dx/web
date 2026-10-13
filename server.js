// wlame-dx — yerel HTTP sunucusu (geliştirme / kendi makinede çalıştırma).
// API yönlendirmesi src/http-api.js içinde; bu dosya yalnızca:
//   • .env yükler
//   • kök dizinden statik dosyaları sunar
//   • /api/* isteklerini handleApi'ye devreder
// Vercel'de bunun yerine api/[[...path]].js çalışır (aynı çekirdek).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { engineInfo } from './src/aimode.js';
import { handleApi, sendJson, sendText } from './src/http-api.js';
import * as google from './src/providers/google.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Basit .env yükleyici (bağımlılık olmadan).
try {
  const envFile = await fs.readFile(path.join(__dirname, '.env'), 'utf8');
  for (const rawLine of envFile.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
} catch {
  /* .env yok, sorun değil */
}

const WEB_ROOT = __dirname; // repo kökü aynı zamanda statik site (Pages ile aynı dizinler)
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(res, pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const target = path.resolve(WEB_ROOT, relative);
  if (!target.startsWith(WEB_ROOT)) {
    sendText(res, 403, 'Yasak');
    return;
  }
  try {
    const data = await fs.readFile(target);
    const ext = path.extname(target).toLowerCase();
    const codedText = ['.html', '.css', '.js', '.mjs', '.json', '.webmanifest', '.svg'].includes(ext);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': codedText ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(data);
  } catch {
    try {
      const html = await fs.readFile(path.join(WEB_ROOT, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
      res.end(html);
    } catch {
      sendText(res, 404, 'Bulunamadı');
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const started = Date.now();

  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(res, url.pathname);
    }
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: err.message });
    else res.end();
  } finally {
    if (process.env.WLAME_LOG !== '0') {
      const elapsed = Date.now() - started;
      console.log(`${req.method} ${url.pathname}${url.search} → ${res.statusCode} (${elapsed}ms)`);
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  wlame-dx hazır');
  console.log(`  → http://${HOST}:${PORT}`);
  console.log(`  AI motoru: ${engineInfo().engine} (${engineInfo().model})`);
  console.log(`  Google web sonuçları: ${google.isConfigured() ? 'açık (Custom Search API)' : 'kapalı → GOOGLE_API_KEY + GOOGLE_CSE_ID ile açılır'}`);
  console.log('');
});

export { server };