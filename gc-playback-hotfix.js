/* GC PLAY PRO — playback/catalog hotfix 2026-10-01 */
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

  /* MPEG-TS startup is owned by gc-live-fix.js. Keep this hotfix focused
     on dynamic Xtream episode/series behavior so it cannot overwrite the
     modern live playback engine loaded before it. */

  /* Episode cards are dynamically rendered. This delegated handler is
     intentionally independent of IndexedDB, so an on-demand Xtream
     episode always reaches playItem(). */
  document.addEventListener("click", async function (event) {
    /* Série -> temporadas -> episódios: usa captura para que nenhum
       overlay ou listener antigo consiga engolir o toque. */
    const seriesCard = event.target.closest("#contentGrid [data-series-key]");
    if (seriesCard) {
      event.preventDefault();
      event.stopImmediatePropagation();

      const api = window.GC_PLAY_PRO;
      const st = api?.state;
      if (st) {
        st.seriesView.seriesKey = String(seriesCard.dataset.seriesKey || "");
        st.seriesView.season = null;
        await api.render();
      }
      return;
    }

    const seasonCard = event.target.closest("#contentGrid [data-series-season]");
    if (seasonCard) {
      event.preventDefault();
      event.stopImmediatePropagation();

      const api = window.GC_PLAY_PRO;
      const st = api?.state;
      if (st) {
        st.seriesView.season = Number(seasonCard.dataset.seriesSeason);
        await api.render();
      }
      return;
    }

    const back = event.target.closest("#contentGrid [data-series-back]");
    if (back) {
      event.preventDefault();
      event.stopImmediatePropagation();

      const api = window.GC_PLAY_PRO;
      const st = api?.state;
      if (st) {
        if (st.seriesView.season !== null) st.seriesView.season = null;
        else st.seriesView.seriesKey = null;
        await api.render();
      }
      return;
    }

    const card = event.target.closest("#contentGrid [data-item-id]");
    if (!card) return;

    const favorite = event.target.closest("[data-favorite-id]");
    if (favorite) return;

    const id = String(card.dataset.itemId || "");
    const item = DYNAMIC.get(id);
    if (!item) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (typeof window.playItem === "function") {
      await window.playItem(item);
    } else if (window.GC_PLAY_PRO?.playItem) {
      await window.GC_PLAY_PRO.playItem(item);
    }
  }, true);
})();
