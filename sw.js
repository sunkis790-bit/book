/*
 * sw.js — book 가계부 잠금 화면 캐시
 *
 * 원칙
 *  1) 이 서비스 워커는 /book/ 안의 "우리 파일"만 다룹니다(잠금 화면·암호화 파일·아이콘·매니페스트·SheetJS).
 *     평문 앱 코드(styles.css, config.js, js/*.js)는 더 이상 없습니다.
 *  2) Google OAuth(GIS: accounts.google.com, oauth2)와 Drive API(www.googleapis.com 등) 요청은
 *     절대 가로채지 않습니다. 출처(origin)가 다르면 respondWith 없이 그대로 통과시킵니다.
 *  3) 같은 출처라도 /book/ 밖 경로는 건드리지 않습니다.
 *
 * 동작: 네트워크 우선 → 성공하면 캐시 갱신, 실패(오프라인)하면 캐시로 응답.
 *       화면 이동(navigate)은 네트워크가 없을 때 index.html로 대신 응답합니다.
 */
'use strict';

const VERSION = 'v8';
const CACHE = 'book-shell-' + VERSION;
const BASE = new URL('./', self.location).pathname; // '/book/'

const SHELL = [
  '',
  'index.html',
  'app.enc.json',
  'manifest.webmanifest',
  'vendor/xlsx.full.min.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
].map((p) => BASE + p);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 하나가 실패해도 설치 자체는 끝나게(부분 캐시 허용)
    await Promise.allSettled(SHELL.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('book-shell-') && k !== CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 우리 앱 셸만 대상
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;       // Google OAuth·Drive API·CDN: 손대지 않음
  if (url.pathname.indexOf(BASE) !== 0) return;          // /book/ 밖: 손대지 않음
  if (url.pathname === BASE + 'sw.js') return;           // 서비스 워커 스크립트는 브라우저가 직접

  event.respondWith(networkFirst(req, url));
});

async function networkFirst(req, url) {
  const cache = await caches.open(CACHE);

  try {
    const res = await fetch(req);
    // 정상 응답만 저장(opaque·에러 응답 제외). 같은 파일의 ?v=... 변형이 쌓이지 않게
    // 쿼리를 붙인 요청은 경로 기준으로 저장합니다.
    if (res && res.ok && res.type === 'basic') {
      const key = url.search ? new Request(url.origin + url.pathname) : req;
      cache.put(key, res.clone());          // 기다리지 않고 저장
    }
    return res;
  } catch (err) {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    if (req.mode === 'navigate') {
      const shell = await cache.match(BASE + 'index.html', { ignoreSearch: true });
      if (shell) return shell;
    }
    return Response.error();
  }
}
