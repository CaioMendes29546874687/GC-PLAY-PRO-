/* =========================================================
   GC PLAY PRO — CACHE DO SHELL
   Mantém a interface disponível e reduz requisições repetidas
   ao host estático. O conteúdo de vídeo continua fora do cache.
   ========================================================= */

"use strict";

const CACHE_NAME = "gc-play-pro-v163";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css?v=20261005-PLAYER2",
  "./app.js?v=20261006-ARCH9",
  "./gc-architecture-v2.js?v=20261006-16",
  "./gc-architecture-bridge.js?v=20261006-4",
  "./gc-final-readiness.js?v=20261006-2",
  "./gc-pro-ui-v3.css?v=20261001-11",
  "./gc-pro-ui-v3.js?v=20261003-6",
  "./gc-playback-hotfix.js?v=20261001-3",
  "./gc-live-fix.js?v=20261002-8",
  "./gc-android-live-fix.js?v=20261001-1",
  "./gc-final-fix.js?v=20261002-14",
  "./gc-vlc.js?v=20261005-2"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key.startsWith("gc-play-pro-") && key !== CACHE_NAME)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  /*
     Navegação: rede primeiro para receber atualizações,
     cache como fallback quando a rede falhar.
  */
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match("./index.html")))
    );
    return;
  }

  /*
     Shell estático: cache primeiro. O nome versionado do app.js
     permite invalidar o código quando uma nova versão é publicada.
  */
  const isShellAsset =
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/style.css") ||
    url.pathname.endsWith("/index.html");

  if (!isShellAsset) return;

  event.respondWith(
    caches.match(request)
      .then(cached => {
        if (cached) return cached;

        return fetch(request).then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return response;
        });
      })
  );
});
