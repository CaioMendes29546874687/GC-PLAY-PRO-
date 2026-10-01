/* GC PLAY PRO — live fix 2026-10-01-2 */
(function(){
  "use strict";

  let preloadPromise = null;

  function preload(){
    if (window.mpegts) return Promise.resolve(window.mpegts);
    if (preloadPromise) return preloadPromise;
    try {
      preloadPromise = Promise.race([
        window.loadMpegTS(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("mpegts timeout")), 10000))
      ]).catch(error => {
        console.error("[GC LIVE] preload:", error);
        preloadPromise = null;
        throw error;
      });
      return preloadPromise;
    } catch (error) {
      preloadPromise = null;
      return Promise.reject(error);
    }
  }

  window.__GC_MPEGTS_PRELOAD__ = preload();

  window.playMpegTS = async function(video, url, message, directFallbackUrl = "") {
    const sources = [...new Set([url, directFallbackUrl].filter(Boolean))];
    if (!video || !sources.length) {
      if (message) message.textContent = "URL do canal inválida.";
      return;
    }

    const setMessage = value => { if (message) message.textContent = value; };
    setMessage("Preparando TV ao vivo...");

    try {
      const mpegts = await Promise.race([
        preload(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Motor MPEG-TS demorou para carregar.")), 12000))
      ]);

      if (!mpegts || !mpegts.isSupported()) {
        throw new Error("MPEG-TS não é suportado neste navegador.");
      }

      const features = typeof mpegts.getFeatureList === "function" ? mpegts.getFeatureList() : {};
      console.log("[GC LIVE] MPEG-TS pronto:", features);

      if (features.mseLivePlayback === false) {
        throw new Error("Este navegador não oferece reprodução MPEG-TS ao vivo.");
      }

      if (state.mpegts) {
        try { state.mpegts.destroy(); } catch {}
        state.mpegts = null;
      }

      let lastError = null;

      for (let i = 0; i < sources.length; i++) {
        const source = sources[i];
        setMessage(i === 0 ? "Conectando ao canal ao vivo..." : "Tentando conexão direta...");

        try {
          video.pause();
          video.removeAttribute("src");
          video.removeAttribute("poster");
          try { video.load(); } catch {}

          // Alguns provedores IPTV anunciam .ts mas entregam um fluxo que
          // funciona melhor no modo MSE genérico. Tentamos MPEG-TS primeiro
          // e MSE como segunda estratégia, sem trocar a URL.
          const engineType = i === 0 ? "mpegts" : "mse";
          const player = mpegts.createPlayer({
            type: engineType,
            isLive: true,
            url: source,
            cors: true,
            hasAudio: true,
            hasVideo: true
          }, {
            enableWorker: false,
            enableWorkerForMSE: false,
            enableStashBuffer: true,
            stashInitialSize: 256 * 1024,
            lazyLoad: false,
            deferLoadAfterSourceOpen: false,
            liveBufferLatencyChasing: false,
            liveSync: false,
            autoCleanupSourceBuffer: true,
            autoCleanupMaxBackwardDuration: 20,
            autoCleanupMinBackwardDuration: 8
          });

          state.mpegts = player;
          let mediaInfo = false;
          let ready = false;

          player.on(mpegts.Events.MEDIA_INFO, info => {
            mediaInfo = true;
            console.log("[GC LIVE] MEDIA_INFO:", info);
          });
          player.on(mpegts.Events.ERROR, (type, detail, info) => {
            lastError = new Error("MPEG-TS " + String(detail || type || "erro desconhecido"));
            console.error("[GC LIVE] ERROR:", type, detail, info);
          });

          const onReady = () => { ready = true; setMessage(""); };
          video.addEventListener("loadedmetadata", onReady, { once: true });
          video.addEventListener("loadeddata", onReady, { once: true });
          video.addEventListener("canplay", onReady, { once: true });

          player.attachMediaElement(video);
          player.load();
          try { await player.play(); } catch (error) { console.warn("[GC LIVE] autoplay:", error); }

          const deadline = Date.now() + 15000;
          while (!ready && !mediaInfo && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 250));
            if (video.readyState >= 2 || video.videoWidth > 0) { ready = true; break; }
            if (lastError && /unsupported|format|codec|decode/i.test(lastError.message)) break;
          }

          if (ready || mediaInfo || video.readyState >= 2 || video.videoWidth > 0) {
            setMessage("");
            return;
          }

          throw lastError || new Error("O canal não entregou vídeo em 15 segundos.");
        } catch (error) {
          lastError = error;
          console.error("[GC LIVE] tentativa", i + 1, error);
          try { if (state.mpegts) state.mpegts.destroy(); } catch {}
          state.mpegts = null;
          try { video.removeAttribute("src"); video.load(); } catch {}
        }
      }

      throw lastError || new Error("Não foi possível iniciar o canal.");
    } catch (error) {
      console.error("[GC LIVE] falha final:", error);
      const text = String(error?.message || error);
      setMessage(/codec|format|unsupported|decode|código 4|MEDIA_ERR_4/i.test(text)
        ? "Formato do canal incompatível com o navegador."
        : text.includes("15 segundos")
          ? "O canal não entregou vídeo. A fonte/proxy precisa ser verificada."
          : text || "Não foi possível iniciar este canal.");
      try { if (state.mpegts) state.mpegts.destroy(); } catch {}
      state.mpegts = null;
    }
  };
})();
