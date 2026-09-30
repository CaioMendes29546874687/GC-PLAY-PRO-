/* GC PLAY PRO — playback/catalog hotfix 2026-09-30 */
(function () {
  "use strict";

  const DYNAMIC = window.__GC_DYNAMIC_ITEMS__ || new Map();
  window.__GC_DYNAMIC_ITEMS__ = DYNAMIC;

  function rememberDynamic(items) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (item && item.id) DYNAMIC.set(String(item.id), item);
    }
  }

  /* Xtream episodes are fetched on demand and are not in IndexedDB.
     Keep those objects available so clicking an episode can actually play it. */
  if (typeof window.getSeriesEpisodes === "function" && !window.__GC_SERIES_WRAP__) {
    const originalGetSeriesEpisodes = window.getSeriesEpisodes;
    window.getSeriesEpisodes = async function (seriesKey, season) {
      const result = await originalGetSeriesEpisodes(seriesKey, season);
      rememberDynamic(result);
      return result;
    };
    window.__GC_SERIES_WRAP__ = true;
  }

  if (typeof window.findItem === "function" && !window.__GC_FIND_WRAP__) {
    const originalFindItem = window.findItem;
    window.findItem = async function (id) {
      const key = String(id || "");
      const dynamic = DYNAMIC.get(key);
      if (dynamic) return dynamic;
      return originalFindItem(id);
    };
    window.__GC_FIND_WRAP__ = true;
  }

  /* Make the series card honest before lazy-loading episode data:
     "temporadas disponíveis" is preferable to displaying 0 episodes. */
  if (typeof window.renderSeriesCard === "function" && !window.__GC_SERIES_CARD_WRAP__) {
    const originalRenderSeriesCard = window.renderSeriesCard;
    window.renderSeriesCard = function (item) {
      if (item && Number(item.episodeCount || 0) === 0 &&
          (item.xtreamSeriesId || item.xtreamKind === "series")) {
        const copy = { ...item, episodeCount: 0 };
        const original = originalRenderSeriesCard(copy);
        return original.replace(
          "0 episódios • Temporadas não identificadas",
          "Temporadas disponíveis • toque para abrir"
        );
      }
      return originalRenderSeriesCard(item);
    };
    window.__GC_SERIES_CARD_WRAP__ = true;
  }

  /* Replace the MPEG-TS startup path with a more deterministic pipeline.
     HTTP MPEG-TS uses the mpegts.js "mpegts" media type; try the proxy
     and, if the proxy/source fails, try the other route once. */
  window.playMpegTS = async function (video, url, message, directFallbackUrl = "") {
    const candidates = [];
    const add = (value) => {
      if (!value || candidates.includes(value)) return;
      candidates.push(value);
    };

    add(url);
    add(directFallbackUrl);

    if (!candidates.length) {
      if (message) message.textContent = "URL do canal inválida.";
      return;
    }

    let mpegts;
    try {
      mpegts = await loadMpegTS();
    } catch (error) {
      console.error("[GC] mpegts.js load:", error);
      if (message) message.textContent = "Motor MPEG-TS não carregou.";
      return;
    }

    if (!mpegts || !mpegts.isSupported()) {
      if (message) message.textContent = "Este navegador não suporta MPEG-TS via MSE.";
      return;
    }

    if (state.mpegts) {
      try { state.mpegts.destroy(); } catch {}
      state.mpegts = null;
    }

    let attempt = 0;
    let player = null;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const start = async () => {
      const source = candidates[attempt];
      cleanup();

      try { video.pause(); } catch {}
      video.removeAttribute("src");
      try { video.load(); } catch {}

      player = mpegts.createPlayer(
        {
          type: "mpegts",
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
          stashInitialSize: 384 * 1024,
          lazyLoad: false,
          deferLoadAfterSourceOpen: false,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 20,
          autoCleanupMinBackwardDuration: 8
        }
      );

      state.mpegts = player;

      let ready = false;
      const succeed = () => {
        ready = true;
        cleanup();
        if (message) message.textContent = "";
      };

      video.addEventListener("loadeddata", succeed, { once: true });
      video.addEventListener("canplay", succeed, { once: true });

      player.on(mpegts.Events.ERROR, async (type, detail, info) => {
        console.warn("[GC] MPEG-TS", type, detail, info);

        if (ready) return;

        if (attempt < candidates.length - 1) {
          attempt++;
          if (message) message.textContent = "Tentando rota alternativa do canal...";
          try { player.destroy(); } catch {}
          state.mpegts = null;
          await new Promise(r => setTimeout(r, 350));
          start();
          return;
        }

        if (message) {
          message.textContent = "O canal respondeu, mas o navegador não conseguiu decodificar o MPEG-TS.";
        }
      });

      player.attachMediaElement(video);
      player.load();

      if (message) {
        message.textContent = attempt === 0
          ? "Conectando ao canal..."
          : "Reconectando ao canal...";
      }

      timer = setTimeout(() => {
        if (ready || video.readyState >= 2) return;

        if (attempt < candidates.length - 1) {
          attempt++;
          try { player.destroy(); } catch {}
          state.mpegts = null;
          start();
        } else if (message) {
          message.textContent = "O canal demorou para entregar vídeo.";
        }
      }, 9000);

      try {
        if (state.settings.autoplay) await player.play();
      } catch (error) {
        console.warn("[GC] MPEG-TS autoplay:", error);
      }
    };

    await start();
  };

  /* Episode cards are dynamically rendered. This delegated handler is
     intentionally independent of IndexedDB, so an on-demand Xtream
     episode always reaches playItem(). */
  document.addEventListener("click", async function (event) {
    const card = event.target.closest("#contentGrid [data-item-id]");
    if (!card) return;

    const favorite = event.target.closest("[data-favorite-id]");
    if (favorite) return;

    const id = String(card.dataset.itemId || "");
    const item = DYNAMIC.get(id);
    if (!item) return;

    event.preventDefault();
    event.stopPropagation();

    await window.playItem(item);
  }, true);
})();
