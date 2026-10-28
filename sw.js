/*
 * Service worker: deixa a biblioteca abrir sem internet.
 *
 * - Arquivos do site: rede primeiro (pega a versão nova a cada publicação), cópia guardada sem internet.
 * - Supabase (script) e fontes: cópia guardada primeiro (endereços com versão fixa).
 * - Capas e banners: guarda as que já apareceram, para aparecerem sem internet (até ~800).
 * - O banco (Supabase) e as lojas nunca passam pelo cache.
 *
 * Ao mudar a lista de arquivos, aumente VERSAO.
 */
const VERSAO = 'v1';
const CACHE = `jogos-${VERSAO}`;
const CACHE_IMG = 'jogos-img';
const MAX_IMG = 800;
const ARQUIVOS = [
  './',
  'index.html',
  'privacidade.html',
  'manifest.webmanifest',
  'styles.css',
  'config.js',
  'nuvem.js',
  'app.js',
  'lojas.js',
  'backup.js',
  'entrada.js',
  'tema.js',
  'icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];
const FIXOS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ARQUIVOS);
    await Promise.all(FIXOS.map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const chaves = await caches.keys();
    await Promise.all(chaves.filter((k) => k.startsWith('jogos-v') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function redePrimeiro(req) {
  const cache = await caches.open(CACHE);
  try {
    const resp = await fetch(req);
    if (resp.ok) cache.put(req, resp.clone());
    return resp;
  } catch (err) {
    const guardado = await cache.match(req, { ignoreSearch: true });
    if (guardado) return guardado;
    if (req.mode === 'navigate') {
      const pagina = await cache.match('index.html');
      if (pagina) return pagina;
    }
    throw err;
  }
}

async function guardadoPrimeiro(req, nome) {
  const cache = await caches.open(nome);
  const guardado = await cache.match(req);
  if (guardado) return guardado;
  const resp = await fetch(req);
  if (resp.ok || resp.type === 'opaque') {
    await cache.put(req, resp.clone());
    if (nome === CACHE_IMG) limitar(cache);
  }
  return resp;
}

async function limitar(cache) {
  const chaves = await cache.keys();
  for (let i = 0; i < chaves.length - MAX_IMG; i++) await cache.delete(chaves[i]);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    event.respondWith(redePrimeiro(req));
  } else if (FIXOS.includes(req.url) || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(guardadoPrimeiro(req, CACHE));
  } else if (req.destination === 'image' && !url.hostname.endsWith('supabase.co')) {
    event.respondWith(guardadoPrimeiro(req, CACHE_IMG).catch(() => Response.error()));
  }
});
