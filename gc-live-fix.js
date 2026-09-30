/* GC PLAY PRO — live startup fix 2026-09-30 */
(function () {
  "use strict";

  function loadScriptWithTimeout(src, timeoutMs) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-gc-mpegts-src="' + src + '"]');
      if (existing && window.mpegts) {
        resolve(window.mpegts);
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.dataset.gcMpegtsSrc = src;

      let finished = false;
      const finish = (fn, value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        fn(value);
      };

      const timer = setTimeout(() => {
        try { script.remove(); } catch {}
        finish(reject, new Error("Tempo esgotado carregando mpegts.js"));
      }, timeoutMs);

      script.onload = () => {
        if (window.mpegts) finish(resolve, window.mpegts);
        else finish(reject, new Error("mpegts.js carregou sem expor window.mpegts"));
      };
      script.onerror = () => finish(reject, new Error("Falha CDN mpegts.js"));
      document.head.appendChild(script);
    });
  }

  /* Do not allow the CDN load to leave the UI forever in
     "Conectando ao conteúdo...". Try two public CDNs. */
  loadMpegTS = async function () {
    if (window.mpegts) return window.mpegts;

    const cdns = [
      "https://cdn.jsdelivr.net/npm/mpegts.js@1.8.2/dist/mpegts.min.js",
      "https://unpkg.com/mpegts.js@1.8.2/dist/mpegts.min.js"
    ];

    let lastError = null;
    for (const src of cdns) {
      try {
        const lib = await loadScriptWithTimeout(src, 7000);
        if (lib && lib.isSupported()) return lib;
        lastError = new Error("mpegts.js sem suporte MSE");
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("mpegts.js indisponível");
  };

  async function startEngine(mpegts, video, source, message, type) {
    const player = mpegts.createPlayer(
      {
        type,
        isLive: true,
        url: source,
        cors: true,
        hasAudio: true,
        hasVideo: true
      },
      {
        enableWorker: true,
        enableWorkerForMSE: true,
        enableStashBuffer: true,
        stashInitialSize: 192 * 1024,
        lazyLoad: false,
        deferLoadAfterSourceOpen: false,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: 3,
        liveBufferLatencyMinRemain: 0.8,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 20,
        autoCleanupMinBackwardDuration: 8,
        reuseRedirectedURL: true
      }
    );

    state.mpegts = player;

    let gotData = false;
    const timer = setTimeout(() => {
      if (!gotData && message) {
        message.textContent = "O servidor conectou, mas ainda não entregou vídeo...";
      }
    }, 5000);

    const cleanup = () => clearTimeout(timer);

    player.on(mpegts.Events.MEDIA_INFO, info => {
      console.log("[GC PLAY PRO] MPEG-TS MEDIA_INFO", info);
      gotData = true;
      cleanup();
      if (message) message.textContent = "";
    });

    player.on(mpegts.Events.ERROR, (errorType, errorDetail, errorInfo) => {
      console.warn("[GC PLAY PRO] MPEG-TS ERROR", type, errorType, errorDetail, errorInfo);
    });

    video.addEventListener("loadeddata", () => {
      gotData = true;
      cleanup();
      if (message) message.textContent = "";
    }, { once: true });

    player.attachMediaElement(video);
    player.load();

    try {
      await player.play();
    } catch (error) {
      console.warn("[GC PLAY PRO] play:", error);
    }

    return player;
  }

  playMpegTS = async function (video, url, message, directFallbackUrl = "") {
    if (!video) return;

    /* Set this BEFORE any network/CDN await. This is why the old
       screenshot could remain stuck on the generic message. */
    if (message) message.textContent = "Preparando motor de TV ao vivo...";

    try {
      if (state.mpegts) {
        try { state.mpegts.destroy(); } catch {}
        state.mpegts = null;
      }

      const mpegts = await Promise.race([
        loadMpegTS(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("mpegts.js demorou demais para iniciar")), 9000)
        )
      ]);

      if (!mpegts || !mpegts.isSupported()) {
        throw new Error("MSE/MPEG-TS não suportado neste navegador");
      }

      if (message) message.textContent = "Conectando ao canal...";

      const sources = [];
      const add = value => {
        if (value && !sources.includes(value)) sources.push(value);
      };
      add(url);
      add(directFallbackUrl);

      let lastError = null;

      /* HTTP MPEG-TS has a dedicated media type in mpegts.js.
         If that mode fails, retry once using the MSE compatibility mode. */
      for (const source of sources) {
        for (const type of ["mpegts", "mse"]) {
          try {
            if (state.mpegts) {
              try { state.mpegts.destroy(); } catch {}
              state.mpegts = null;
            }

            if (message) {
              message.textContent =
                type === "mpegts"
                  ? "Conectando ao canal..."
                  : "Tentando compatibilidade MPEG-TS...";
            }

            await startEngine(mpegts, video, source, message, type);

            await new Promise(resolve => setTimeout(resolve, 3500));

            if (video.readyState >= 2 || video.videoWidth > 0) {
              if (message) message.textContent = "";
              return;
            }

            lastError = new Error("Fluxo conectado sem dados de vídeo");
          } catch (error) {
            lastError = error;
            console.warn("[GC PLAY PRO] tentativa live falhou:", source, type, error);
          }
        }
      }

      throw lastError || new Error("Nenhuma rota de reprodução funcionou");
    } catch (error) {
      console.error("[GC PLAY PRO] live final:", error);

      if (message) {
        message.textContent =
          "Não foi possível iniciar este canal. Verifique se a fonte entrega MPEG-TS/H.264.";
      }

      try {
        if (state.mpegts) state.mpegts.destroy();
      } catch {}
      state.mpegts = null;
    }
  };
})();
