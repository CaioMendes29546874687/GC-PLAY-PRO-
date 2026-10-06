/* Falha de mídia não dispara proxy: o diagnóstico informa a origem. */
        console.error(
      "VIDEO ERROR:",
      mediaError
    );

    if (message) {
      message.textContent =
        mediaError
          ? `Formato/fluxo de vídeo não suportado (código ${mediaError.code}).`
          : "O navegador não conseguiu decodificar este vídeo.";
    }
  };

  try {
    await video.play();

    if (message) {
      message.textContent =
        "";
    }
  } catch (error) {
    console.warn(
      "Autoplay bloqueado:",
      error
    );

    if (message) {
      message.textContent =
        "Toque no botão ▶ do player para iniciar.";
    }
  }
}

/* =========================================================
   PLAY HLS
   ========================================================= */

async function playHLS(
  video,
  url,
  message,
  mpegtsFallbackUrl = "",
  directMpegtsFallbackUrl = "",
  directHlsFallbackUrl = ""
) {
  /* Alguns servidores aceitam HLS direto, mas o proxy pode falhar
     na reescrita do manifesto/segmentos. Antes de cair para MPEG-TS,
     tentamos uma única vez o HLS direto com o loader padrão. */
  let directHlsStarted = false;
  const tryDirectHlsFallback = async () => {
    if (!directHlsFallbackUrl || directHlsStarted || directHlsFallbackUrl === url) return false;
    directHlsStarted = true;
    try {
      if (state.hls) { state.hls.destroy(); state.hls = null; }
      if (message) message.textContent = "Tentando conexão HLS direta...";
      const HlsDirect = await loadHLS();
      if (!HlsDirect?.isSupported()) throw new Error("HLS.js indisponível");
      const direct = new HlsDirect({
        enableWorker: true,
        backBufferLength: 12,
        lowLatencyMode: false,
        maxBufferLength: 12,
        maxMaxBufferLength: 24,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 8,
        fragLoadingTimeOut: 15000,
        manifestLoadingTimeOut: 15000,
        levelLoadingTimeOut: 15000
      });
      state.hls = direct;
      direct.on(HlsDirect.Events.MANIFEST_PARSED, async () => {
        if (state.settings.autoplay) { try { await video.play(); } catch {} }
      });
      direct.on(HlsDirect.Events.FRAG_BUFFERED, () => { if (message) message.textContent = ""; });
      direct.on(HlsDirect.Events.ERROR, (event, data) => {
        if (data?.fatal && message) message.textContent = "HLS direto também falhou.";
      });
      direct.attachMedia(video);
      direct.loadSource(directHlsFallbackUrl);
      return true;
    } catch (error) {
      console.warn("[GC PLAY PRO] HLS direto falhou:", error);
      return false;
    }
  };
  let startupTimer = null;
  let fallbackStarted = false;

  const clearStartupTimer = () => {
    if (startupTimer) {
      clearTimeout(startupTimer);
      startupTimer = null;
    }
  };

  const startMpegTSFallback = async () => {
    if (!mpegtsFallbackUrl || fallbackStarted) return false;
    fallbackStarted = true;
    clearStartupTimer();

    try {
      if (state.hls) {
        state.hls.destroy();
        state.hls = null;
      }
    } catch {}

    if (message) message.textContent = "HLS não respondeu. Tentando MPEG-TS...";

    try {
      const native = window.__GC_NATIVE_PLAY_MPEGTS__;
      if (typeof native !== "function") throw new Error("Motor MPEG-TS não disponível.");
      await native(
        video,
        mpegtsFallbackUrl,
        message,
        directMpegtsFallbackUrl
      );
      return true;
    } catch (error) {
      console.warn("[GC PLAY PRO] fallback MPEG-TS:", error);
      if (message) message.textContent = "O canal ao vivo não respondeu.";
      return false;
    }
  };
  /* -------------------------------------------------------
     Safari / iPhone / alguns Smart TVs
     ------------------------------------------------------- */

  /* Android/Android TV: use HLS.js first. Chrome can report native
     HLS support and still fail the stream with MEDIA_ERR_SRC_NOT_SUPPORTED.
     Keep native HLS for non-Android environments such as Safari/iOS. */
  const gcAndroidLike = /Android|Android TV/i.test(navigator.userAgent || "");

  if (
    !gcAndroidLike &&
    video.canPlayType(
      "application/vnd.apple.mpegurl"
    )
  ) {
    video.src = url;

    video.onloadedmetadata = () => {
      const position = getResumePosition(state.currentItem);
      if (position > 5 && Number.isFinite(video.duration) && video.duration > position + 8) {
        try { video.currentTime = position; } catch {}
      }
    };

    try {
      await video.play();

      if (message) {
        message.textContent =
          "";
      }
    } catch {
      if (message) {
        message.textContent =
          "Toque no player para iniciar.";
      }
    }

    return;
  }

  /* -------------------------------------------------------
     HLS.JS
     ------------------------------------------------------- */

  try {
    const Hls =
      await loadHLS();

    if (
      !Hls ||
      !Hls.isSupported()
    ) {
      throw new Error(
        "HLS não suportado neste navegador."
      );
    }

    /*
       O proxy precisa ser usado também nos segmentos,
       chaves e playlists internas do HLS.
       Sem isso o manifesto pode abrir, mas o vídeo
       fica preto porque os .ts/.m4s continuam indo
       direto para z1sv.site e sofrem CORS.
    */
    class GCProxyLoader extends Hls.DefaultConfig.loader {
      load(context, config, callbacks) {
        return super.load(context, config, callbacks);
      }
    }

    const hls =
      new Hls({
        enableWorker: true,
        backBufferLength: 12,

        lowLatencyMode: false,

        maxBufferLength: 12,

        maxMaxBufferLength: 24,

        liveSyncDurationCount: 3,

        liveMaxLatencyDurationCount: 8,

        fragLoadingTimeOut: 30000,

        manifestLoadingTimeOut: 30000,

        levelLoadingTimeOut: 30000,

        loader: GCProxyLoader,

        fLoader: GCProxyLoader,

        pLoader: GCProxyLoader
      });

    state.hls =
      hls;

    hls.on(
      Hls.Events.MEDIA_ATTACHED,
      () => {
        hls.loadSource(url);
      }
    );

    hls.on(
      Hls.Events.MANIFEST_PARSED,
      async () => {
        if (message) {
          message.textContent =
            "Carregando vídeo...";
        }

        if (
          state.settings.autoplay
        ) {
          try {
            await video.play();
          } catch {
            if (message) {
              message.textContent =
                "Toque no botão ▶ para iniciar.";
            }
          }
        }
      }
    );

    hls.on(
      Hls.Events.FRAG_BUFFERED,
      () => {
        clearStartupTimer();
        if (message) {
          message.textContent = "";
        }
      }
    );

    /* HLS sem primeiro frame também troca de transporte cedo,
       evitando a tela de carregamento indefinida. */
    startupTimer = setTimeout(async () => {
      if (video.readyState >= 2 || video.videoWidth > 0) return;
      if (await tryDirectHlsFallback()) return;
      startMpegTSFallback();
    }, 6000);

    hls.on(
      Hls.Events.ERROR,
      async (
        event,
        data
      ) => {
        console.warn(
          "HLS ERROR:",
          data
        );

        if (
          data &&
          data.fatal
        ) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !hls.__gcNetworkRetry) {
            hls.__gcNetworkRetry = true;
            if (message) message.textContent = "Reconectando ao fluxo...";
            try {
              hls.startLoad();
              return;
            } catch {}
          }

          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !hls.__gcMediaRetry) {
            hls.__gcMediaRetry = true;
            if (message) message.textContent = "Recuperando vídeo...";
            try {
              hls.recoverMediaError();
              return;
            } catch {}
          }

          if (await tryDirectHlsFallback()) return;
          if (mpegtsFallbackUrl && !fallbackStarted) {
            startMpegTSFallback();
            return;
          }

          if (message) {
            message.textContent =
              "Erro ao reproduzir este conteúdo.";
          }

          try {
            hls.destroy();
          } catch {}

          state.hls =
            null;
        }
      }
    );

    hls.attachMedia(
      video
    );

  } catch (error) {
    console.error(
      "Erro HLS:",
      error
    );

    if (message) {
      message.textContent =
        "Não foi possível iniciar este fluxo HLS.";
    }
  }
}

/* =========================================================
   HISTÓRICO
   ========================================================= */

function saveResumePosition(item, video) {
  if (!item || !video || item.type === "live") return;

  const duration = Number(video.duration);
  const current = Number(video.currentTime);

  if (!Number.isFinite(current) || current < 5) return;

  if (Number.isFinite(duration) && duration > 0 && current >= duration - 8) {
    delete state.resume[item.id];
  } else {
    state.resume[item.id] = Math.round(current);
  }

  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify(state.resume));
  } catch {}
}

function getResumePosition(item) {
  if (!item || item.type === "live") return 0;
  const value = Number(state.resume[item.id] || 0);
  return Number.isFinite(value) && value > 5 ? value : 0;
}

function clearResumePosition(item) {
  if (!item) return;
  delete state.resume[item.id];
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify(state.resume));
  } catch {}
}

function addHistory(item) {
  if (!item) {
    return;
  }

  state.history =
    state.history.filter(
      id => id !== item.id
    );

  state.history.unshift(
    item.id
  );

  state.history =
    state.history.slice(
      0,
      100
    );

  saveState();
}

/* =========================================================
   FAVORITO
   ========================================================= */

function toggleFavorite(id) {
  if (
    state.favorites.has(id)
  ) {
    state.favorites.delete(id);

    toast(
      "Removido dos favoritos."
    );
  } else {
    state.favorites.add(id);

    toast(
      "Adicionado aos favoritos."
    );
  }

  saveState();

  render();
}

/* =========================================================
   PROCURAR ITEM NA RAM
   ========================================================= */

function findRAMItem(id) {
  return state.items.find(
    item => item.id === id
  );
}

/* =========================================================
   PROCURAR ITEM NO BANCO
   ========================================================= */

async function findItem(id) {
  const key = String(id || "");

  const dynamic = window.__GC_DYNAMIC_ITEMS__;
  if (dynamic instanceof Map) {
    const item = dynamic.get(key);
    if (item) return item;
  }

  const ram =
    findRAMItem(id);

  if (ram) {
    return ram;
  }

  try {
    return await getItem(id);
  } catch {
    return null;
  }
}

/* =========================================================
   EVENTOS DOS CARDS
   ========================================================= */

function setupCardEvents() {
  const grid =
    $("#contentGrid");

  if (!grid) {
    return;
  }

  grid.addEventListener(
    "click",
    async event => {
      const favoriteButton =
        event.target.closest(
          "[data-favorite-id]"
        );

      if (favoriteButton) {
        event.preventDefault();
        event.stopPropagation();

        const id =
          favoriteButton.dataset.favoriteId;

        toggleFavorite(id);

        return;
      }

      const card =
        event.target.closest(
          "[data-item-id]"
        );

      if (!card) {
        return;
      }

      const id =
        card.dataset.itemId;

      const item =
        await findItem(id);

      if (item) {
        await playItem(item);
      }
    }
  );
}

/* =========================================================
   FILTROS
   ========================================================= */

function setupFilters() {
  const buttons = $$("[data-filter]");

  buttons.forEach(button => {
    button.addEventListener("click", () => {
      state.currentFilter = button.dataset.filter || "all";
      state.adultUnlocked = false;
      state.currentSection =
        ({
          all: "home",
          live: "live",
          movie: "movies",
          series: "series"
        })[state.currentFilter] || "home";

      showHomeOrLibrary(state.currentSection === "home" && state.currentFilter === "all");
      syncSectionNavigation(state.currentSection);
      state.currentGenre = "all";
      state.seriesView.seriesKey = null;
      state.seriesView.season = null;

      buttons.forEach(item => {
        item.classList.toggle("active", item === button);
      });

      $$(".gc-quick-card[data-filter]").forEach(item => {
        item.classList.toggle(
          "active",
          item.dataset.filter === state.currentFilter
        );
      });

      renderGenreFilters();
      render();
    });
  });
}

const ADULT_PIN_KEY = "GC_PLAY_PRO_ADULT_PIN_SHA256_V1";
const DEFAULT_ADULT_PIN = "0000";

function normalizeAdultText(value) {
  return normalizeText(value)
    .replace(/[|/\\_:;(){}<>+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isAdultContent(item) {
  if (!item) return false;

  const text = normalizeAdultText([
    item.group,
    item.name,
    item.tvgName,
    item.category,
    item.genre,
    item.url
  ].filter(Boolean).join(" "));

  if (!text) return false;

  const strongAdultTerms =
    /(?:\badult\b|\badultos?\b|\bxxx\b|\b18\s*\+\b|\bsexo\b|\bsexual\b|\bporn(?:o|ografia)?\b|\bpornhub\b|\bredtube\b|\bbrazzers\b|\bhentai\b|\berotic(?:a|o)\b|\berotismo\b|\bnudez?\b|\bonlyfans\b|\bplayboy\b|\bpenthouse\b|\bsexy\b)/i

  return strongAdultTerms.test(text);
}

function isAdultSeries(item) {
  return isAdultContent(item);
}

async function hashAdultPin(pin) {
  const value = String(pin || "");
  if (!value || !window.crypto?.subtle) return value;
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function ensureAdultPin() {
  try {
    const stored = localStorage.getItem(ADULT_PIN_KEY);
    if (stored) return stored;
    const hash = await hashAdultPin(DEFAULT_ADULT_PIN);
    localStorage.setItem(ADULT_PIN_KEY, hash);
    return hash;
  } catch {
    return await hashAdultPin(DEFAULT_ADULT_PIN);
  }
}

async function verifyAdultPin(pin) {
  const stored = await ensureAdultPin();
  return (await hashAdultPin(pin)) === stored;
}

async function unlockAdultArea() {
  const pin = window.prompt("ÁREA ADULTOS\nDigite a senha de 4 dígitos:");
  if (pin === null) return false;

  if (!/^\d{4,8}$/.test(pin)) {
    toast("A senha deve ter de 4 a 8 dígitos.");
    return false;
  }

  if (!(await verifyAdultPin(pin))) {
    toast("Senha incorreta.");
    return false;
  }

  state.adultUnlocked = true;
  return true;
}

async function changeAdultPin() {
  const current = window.prompt("ALTERAR SENHA\nDigite a senha atual:");
  if (current === null) return;

  if (!(await verifyAdultPin(current))) {
    toast("Senha atual incorreta.");
    return;
  }

  const next = window.prompt("Digite a nova senha (4 a 8 dígitos):");
  if (next === null) return;

  if (!/^\d{4,8}$/.test(next)) {
    toast("A nova senha deve ter de 4 a 8 dígitos.");
    return;
  }

  const confirmation = window.prompt("Digite a nova senha novamente:");
  if (confirmation !== next) {
    toast("As senhas não conferem.");
    return;
  }

  try {
    localStorage.setItem(ADULT_PIN_KEY, await hashAdultPin(next));
    state.adultUnlocked = false;
    toast("Senha da área Adultos alterada.");
  } catch {
    toast("Não foi possível alterar a senha.");
  }
}

function getGenreName(group) {
  let value = String(group || "").trim();

  value = value
    .replace(/^\\s*(?:tv|live|live tv|iptv|filmes?|movies?|v[oó]d|series?|séries?|animes?|kids?|infantil|canais?)\\s*[-|:/\\\\>]\\s*/i, "")
    .replace(/^\\s*[|:/\\\\>-]+\\s*/, "")
    .trim();

  return value || "OUTROS";
}

async function buildGenreCatalog() {
  const catalog = {
    all: new Map(),
    live: new Map(),
    movie: new Map(),
    series: new Map()
  };

  const add = (type, group) => {
    if (!["live", "movie", "series"].includes(type)) return;

    const genre = getGenreName(group);
    const key = normalizeText(genre);
    if (!key) return;

    if (!catalog.all.has(key)) catalog.all.set(key, genre);
    if (!catalog[type].has(key)) catalog[type].set(key, genre);
  };

  const addItem = item => {
    if (!item || isAdultContent(item)) return;
    add(item.type, item.group);
  };

  if (!state.db) {
    for (const item of state.items) addItem(item);
  } else {
    await new Promise((resolve, reject) => {
      const transaction = state.db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).openCursor();

      request.onsuccess = event => {
        const cursor = event.target.result;

        if (!cursor) {
          resolve();
          return;
        }

        addItem(cursor.value);
        cursor.continue();
      };

      request.onerror = () => reject(request.error);
    });
  }

  state.genreCatalog = {
    all: Array.from(catalog.all.values()).sort((a,b) =>
      a.localeCompare(b, "pt-BR", { sensitivity: "base" })
    ),
    live: Array.from(catalog.live.values()).sort((a,b) =>
      a.localeCompare(b, "pt-BR", { sensitivity: "base" })
    ),
    movie: Array.from(catalog.movie.values()).sort((a,b) =>
      a.localeCompare(b, "pt-BR", { sensitivity: "base" })
    ),
    series: Array.from(catalog.series.values()).sort((a,b) =>
      a.localeCompare(b, "pt-BR", { sensitivity: "base" })
    )
  };
}

function getAvailableGenres(type) {
  const key = ["live", "movie", "series", "adult"].includes(type)
    ? type
    : "all";

  if (key === "adult") return [];

  /*
     As categorias agora vêm SOMENTE do catálogo por tipo.
     Não usamos mais seriesCatalog aqui, porque ele pode conter
     registros antigos de versões anteriores.
  */
  const cached = state.genreCatalog[key];

  return Array.isArray(cached) ? cached : [];
}

function renderGenreFilters() {
  const container = $("#genreFilters");
  if (!container) return;

  const genres = getAvailableGenres(state.currentFilter);

  if (!genres.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <button class="filter-button ${state.currentGenre === "all" ? "active" : ""}" data-genre="all">
      TODAS AS CATEGORIAS
    </button>
    ${genres.map(genre => `
      <button class="filter-button ${normalizeText(genre) === normalizeText(state.currentGenre) ? "active" : ""}" data-genre="${escapeHTML(genre)}">
        ${escapeHTML(genre)}
      </button>
    `).join("")}
  `;

  container.querySelectorAll("[data-genre]").forEach(button => {
    button.addEventListener("click", () => {
      state.currentGenre = button.dataset.genre || "all";
      state.seriesView.seriesKey = null;
      state.seriesView.season = null;

      container.querySelectorAll("[data-genre]").forEach(item => {
        item.classList.toggle("active", item === button);
      });

      render();
    });
  });
}

/* =========================================================
   SINCRONIZAÇÃO DA NAVEGAÇÃO
   ========================================================= */

function syncSectionNavigation(section = null) {
  const map = {
    all: "home",
    catalog: "home",
    live: "live",
    movie: "movies",
    series: "series",
    adult: "adult"
  };

  const targetSection =
    section ||
    map[state.currentFilter] ||
    state.currentSection ||
    "home";

  $$("[data-section]").forEach(button => {
    button.classList.toggle("active", button.dataset.section === targetSection);
  });

  $$(".gc-quick-card[data-section]").forEach(button => {
    button.classList.toggle("active", button.dataset.section === targetSection);
  });

  $$(".gc-quick-card[data-filter]").forEach(button => {
    const filter = button.dataset.filter || "";
    const active = (targetSection === "live" && filter === "live") || (targetSection === "movies" && filter === "movie") || (targetSection === "series" && filter === "series");
    button.classList.toggle("active", active);
  });
}

/* =========================================================
   API DE NAVEGAÇÃO PARA A NOVA INTERFACE
   ========================================================= */
async function navigateSection(section) {
  /* Aguarda a inicialização do banco/catálogo antes de executar a navegação. */
  if (window.__GC_APP_READY__) {
    try { await window.__GC_APP_READY__; } catch {}
  }
  if (!state.db) {
    toast("Catálogo ainda inicializando. Aguarde um instante.");
    return false;
  }
  const allowed = ["home","live","movies","series","adult","favorites"];
  if (!allowed.includes(section)) return false;
  if (section === "adult") {
    const unlocked = await unlockAdultArea();
    if (!unlocked) return false;
    state.adultUnlocked = true;
  } else {
    state.adultUnlocked = false;
  }
  state.currentSection = section;
  $$(".nav-item[data-section]").forEach(item => {
    item.classList.toggle("active", item.dataset.section === section);
  });
  await handleSection(section);
  return true;
}

function setCatalogCategory(type, genre = "all") {
  const map = { live: "live", movie: "movies", series: "series" };
  if (!map[type]) return;
  state.currentSection = map[type];
  state.currentFilter = type;
  state.currentGenre = genre || "all";
  state.seriesView.seriesKey = null;
  state.seriesView.season = null;
  showHomeOrLibrary(false);
  syncSectionNavigation(state.currentSection);
  renderGenreFilters();
  return render();
}

/* =========================================================
   NAVEGAÇÃO
   ========================================================= */

function setupNavigation() {
  if (window.__gcNavigationDirect) return;
  window.__gcNavigationDirect = true;

  const bind = button => {
    if (!button || button.__gcNavBound) return;
    button.__gcNavBound = true;

    button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();

      const section = button.dataset.section || "home";

      try {
        if (section === "adult") {
          const unlocked = await unlockAdultArea();
          if (!unlocked) return;
          state.adultUnlocked = true;
        } else {
          state.adultUnlocked = false;
        }

        state.currentSection = section;

        $$(".nav-item[data-section]").forEach(item => {
          item.classList.toggle("active", item.dataset.section === section);
        });

        await handleSection(section);
      } catch (error) {
        console.error("[GC PLAY PRO] navegação:", error);
        toast("Não foi possível abrir esta seção.");
      }
    });
  };

  $$(".nav-item[data-section]").forEach(bind);
}
/* =========================================================
   TRATAMENTO DAS SEÇÕES
   ========================================================= */

async function handleSection(
  section
) {
  syncSectionNavigation(section);

  if (
    section === "home"
  ) {
    state.adultUnlocked = false;
    state.currentFilter = "all";
    state.currentGenre = "all";
    state.searchTerm = "";
    state.seriesView.seriesKey = null;
    state.seriesView.season = null;
    showHomeOrLibrary(true);
    renderGenreFilters();
    await renderHomeDashboard();
    return;
  }

  if (
    section === "live"
  ) {
    showHomeOrLibrary(false);
    state.adultUnlocked = false;
    state.currentFilter =
      "live";

    state.currentGenre =
      "all";

    renderGenreFilters();
    render();

    return;
  }

  if (
    section === "movies"
  ) {
    showHomeOrLibrary(false);
    state.adultUnlocked = false;
    state.currentFilter =
      "movie";

    state.currentGenre =
      "all";

    renderGenreFilters();

    /*
       Se a sessão Xtream estiver ativa mas o catálogo ainda não
       estiver no IndexedDB, carregamos a seção sob demanda.
       Isso evita a tela vazia quando a API respondeu inicialmente
       apenas a TV ao vivo.
    */
    if (state.xtreamSession && Number(state.counts?.movie || 0) === 0) {
      await ensureXtreamSectionLoaded("movie");
    } else {
      await render();
    }

    return;
  }

  if (
    section === "series"
  ) {
    showHomeOrLibrary(false);
    state.adultUnlocked = false;
    state.currentFilter =
      "series";

    state.currentGenre =
      "all";

    state.seriesView.seriesKey = null;
    state.seriesView.season = null;

    renderGenreFilters();

    if (state.xtreamSession && Number(state.counts?.series || 0) === 0) {
      await ensureXtreamSectionLoaded("series");
    } else {
      await render();
    }

    return;
  }

  if (
    section === "adult"
  ) {
    showHomeOrLibrary(false);
    state.currentFilter = "adult";
    state.currentGenre = "all";
    state.seriesView.seriesKey = null;
    state.seriesView.season = null;
    renderGenreFilters();
    render();
    return;
  }

  if (
    section === "favorites"
  ) {
    showHomeOrLibrary(false);
    await renderFavorites();
    return;
  }
}

/* =========================================================
   FAVORITOS
   ========================================================= */

async function renderFavorites() {
  const grid =
    $("#contentGrid");

  const empty =
    $("#emptyState");

  if (!grid) {
    return;
  }

  if (
    !state.favorites.size
  ) {
    grid.innerHTML = "";

    if (empty) {
      empty.style.display =
        "block";
    }

    return;
  }

  const items = [];

  for (
    const id of state.favorites
  ) {
    const item =
      await findItem(id);

    if (item && !isAdultContent(item)) {
      items.push(item);
    }
  }

  if (!items.length) {
    grid.innerHTML = "";

    if (empty) {
      empty.style.display =
        "block";
    }

    return;
  }

  if (empty) {
    empty.style.display =
      "none";
  }

  grid.innerHTML =
    items
      .slice(0, 120)
      .map(renderCard)
      .join("");
}

/* =========================================================
   DIALOGS
   ========================================================= */

function openDialog(id) {
  const dialog =
    document.getElementById(id);

  if (!dialog) {
    return;
  }

  if (
    typeof dialog.showModal ===
    "function"
  ) {
    try {
      dialog.showModal();
      return;
    } catch {}
  }

  dialog.classList.add(
    "active",
    "open",
    "show"
  );
}

function closeDialog(id) {
  const dialog =
    document.getElementById(id);

  if (!dialog) {
    return;
  }

  if (
    typeof dialog.close ===
    "function"
  ) {
    try {
      dialog.close();
    } catch {}
  }

  dialog.classList.remove(
    "active",
    "open",
    "show"
  );
}

/* =========================================================
   ABERTURA ROBUSTA DO MODAL M3U
   ========================================================= */

function setupPlaylistDialogDelegation() {
  if (window.__gcPlaylistDialogDelegation) return;
  window.__gcPlaylistDialogDelegation = true;

  /*
     Este delegado fica ativo antes da inicialização do restante
     da interface. Assim os botões do modal continuam funcionando
     mesmo se outra parte do app falhar durante o boot.
  */
  document.addEventListener("click", event => {
    const openButton = event.target.closest(
      "#addPlaylistButton, #emptyAddButton, #quickAddPlaylist"
    );

    if (openButton) {
      event.preventDefault();
      event.stopPropagation();

      const dialog = document.getElementById("playlistDialog");

      if (!dialog) {
        console.error("[GC PLAY PRO] playlistDialog não encontrado.");
        return;
      }

      try {
        if (typeof dialog.showModal === "function" && !dialog.open) {
          dialog.showModal();
        } else {
          dialog.classList.add("active", "open", "show");
          dialog.setAttribute("open", "");
        }

        const name = document.getElementById("playlistName");
        if (name) setTimeout(() => name.focus(), 50);
      } catch (error) {
        console.warn("[GC PLAY PRO] Fallback do modal M3U:", error);
        dialog.classList.add("active", "open", "show");
        dialog.setAttribute("open", "");
      }

      return;
    }

    const closeButton = event.target.closest("#closePlaylistDialog");

    if (closeButton) {
      event.preventDefault();
      event.stopPropagation();
      closeDialog("playlistDialog");
    }
  }, true);

  document.addEventListener("cancel", event => {
    if (event.target?.id !== "playlistDialog") return;
    event.preventDefault();
    closeDialog("playlistDialog");
  }, true);
}

setupPlaylistDialogDelegation();

/* =========================================================
   BOTÕES DOS DIALOGS
   ========================================================= */

function setupDialogs() {
  const addButton =
    $("#addPlaylistButton");

  const emptyAddButton =
    $("#emptyAddButton");

  const closePlaylist =
    $("#closePlaylistDialog");

  const searchButton =
    $("#searchButton");

  const closeSearch =
    $("#closeSearchDialog");

  const settingsButton =
    $("#settingsButton");

  const closeSettings =
    $("#closeSettingsDialog");

  const closePlayerButton =
    $("#closePlayer");

  if (addButton) {
    addButton.addEventListener(
      "click",
      () => {
        openDialog(
          "playlistDialog"
        );
      }
    );
  }

  if (emptyAddButton) {
    emptyAddButton.addEventListener(
      "click",
      () => {
        openDialog(
          "playlistDialog"
        );
      }
    );
  }

  if (closePlaylist) {
    closePlaylist.addEventListener(
      "click",
      () => {
        closeDialog(
          "playlistDialog"
        );
      }
    );
  }

  if (searchButton) {
    searchButton.addEventListener(
      "click",
      () => {
        openDialog(
          "searchDialog"
        );

        setTimeout(
          () => {
            const input =
              $("#globalSearch");

            if (input) {
              input.focus();
            }
          },
          100
        );
      }
    );
  }

  if (closeSearch) {
    closeSearch.addEventListener(
      "click",
      () => {
        closeDialog(
          "searchDialog"
        );
      }
    );
  }

  if (settingsButton) {
    settingsButton.addEventListener(
      "click",
      () => {
        syncSettingsUI();

        openDialog(
          "settingsDialog"
        );
      }
    );
  }

  if (closeSettings) {
    closeSettings.addEventListener(
      "click",
      () => {
        closeDialog(
          "settingsDialog"
        );
      }
    );
  }

  if (closePlayerButton) {
    closePlayerButton.addEventListener(
      "click",
      closePlayer
    );
  }

  const quickAddPlaylist = $("#quickAddPlaylist");
  if (quickAddPlaylist) {
    quickAddPlaylist.addEventListener("click", () => {
      openDialog("playlistDialog");
    });
  }
}

/* =========================================================
   SETTINGS
   ========================================================= */

function syncSettingsUI() {
  const autoplay =
    $("#autoplaySetting");

  const compact =
    $("#compactSetting");

  if (autoplay) {
    autoplay.checked =
      !!state.settings.autoplay;
  }

  if (compact) {
    compact.checked =
      !!state.settings.compact;
  }
}

function setupPlayerControls() {
  const video = $("#videoPlayer");
  const speed = $("#playerSpeed");
  const clearResume = $("#clearResumeButton");

  if (!video) return;

  if (speed) {
    speed.value = String(state.settings.playbackRate || 1);
    speed.addEventListener("change", () => {
      const rate = Number(speed.value);
      if (!Number.isFinite(rate) || rate <= 0) return;
      state.settings.playbackRate = rate;
      video.playbackRate = rate;
      saveState();
    });
  }

  if (clearResume) {
    clearResume.addEventListener("click", () => {
      clearResumePosition(state.currentItem);
      toast("Ponto de retomada removido.");
    });
  }
}

function setupSettings() {
  const changePinButton = $("#changeAdultPinButton");

  if (changePinButton) {
    changePinButton.addEventListener("click", changeAdultPin);
  }

  const autoplay =
    $("#autoplaySetting");

  const compact =
    $("#compactSetting");

  if (autoplay) {
    autoplay.addEventListener(
      "change",
      () => {
        state.settings.autoplay =
          autoplay.checked;

        saveState();
      }
    );
  }

  if (compact) {
    compact.addEventListener(
      "change",
      () => {
        state.settings.compact =
          compact.checked;

        document.body.classList.toggle(
          "gc-compact",
          compact.checked
        );

        saveState();
      }
    );
  }

  document.body.classList.toggle(
    "gc-compact",
    state.settings.compact
  );
}
/* =========================================================
   ATUALIZAR PROGRESSO
   ========================================================= */

function updateLoadMessage(
  message,
  percent = null
) {
  const element =
    $("#playlistMessage");

  if (!element) {
    return;
  }

  if (
    percent !== null &&
    Number.isFinite(percent)
  ) {
    element.innerHTML = `
      ${escapeHTML(message)}

      <div class="gc-progress">
        <div
          class="gc-progress-bar"
          style="width:${Math.max(
            0,
            Math.min(100, percent)
          )}%"
        ></div>
      </div>
    `;
  } else {
    element.textContent =
      message;
  }
}

/* =========================================================
   ATUALIZAR CONTADORES DURANTE A CARGA
   ========================================================= */

function updateLiveCounters() {
  state.total =
    state.counts.live +
    state.counts.movie +
    state.counts.series;

  renderStats();
}

/* =========================================================
   PROCESSAR ITEM DA M3U
   ========================================================= */

function processParsedItem(
  item,
  batch,
  groups
) {
  if (!item || !item.url) {
    return;
  }

  batch.push(item);

  if (item.group) {
    groups.add(item.group);
  }

  if (item.type === "live") {
    state.counts.live++;
  } else if (item.type === "movie") {
    state.counts.movie++;
  } else if (item.type === "series") {
    /* Uma série pode aparecer centenas de vezes (um registro por episódio).
       O contador precisa representar séries únicas, não episódios. */
    const info = getDerivedSeriesInfo(item);
    const key = normalizeText(
      info.seriesKey || info.seriesName || item.seriesName || item.name || item.url
    );
    if (key) state.importSeriesKeys.add(key);
    state.counts.series = state.importSeriesKeys.size;
  }

  /*
     Não reconstruir o catálogo de séries durante a importação.
     Em listas grandes isso cria milhares de operações extras no
     IndexedDB e pode deixar o navegador aparentemente travado.
     O catálogo será reconstruído somente depois que a importação
     terminar.
  */

  if (state.items.length < RAM_LIMIT) {
    state.items.push(item);
  }
}

/* =========================================================
   CACHE LOCAL — RESTAURAÇÃO INSTANTÂNEA
   ========================================================= */

/*
   Para listas gigantes, nunca obrigue o usuário a baixar/parsingar
   novamente uma playlist que já está no aparelho. O IndexedDB é o
   catálogo persistente; o snapshot abaixo guarda somente metadados
   pequenos para que a primeira tela possa ser restaurada sem contar
   centenas de milhares de registros.
*/
function saveCatalogCacheMeta(url) {
  try {
    localStorage.setItem(
      CACHE_META_KEY,
      JSON.stringify({
        url: String(url || "").trim(),
        updatedAt: Date.now(),
        total: Number(state.total || 0),
        counts: {
          live: Number(state.counts?.live || 0),
          movie: Number(state.counts?.movie || 0),
          series: Number(
            state.seriesCatalogReady
              ? state.seriesCatalog.length
              : state.counts?.series || 0
          )
        }
      })
    );
  } catch {}
}

function getCatalogCacheMeta(url) {
  try {
    const raw = localStorage.getItem(CACHE_META_KEY);
    if (!raw) return null;

    const meta = JSON.parse(raw);
    if (!meta || String(meta.url || "").trim() !== String(url || "").trim()) {
      return null;
    }

    if (!Number.isFinite(Number(meta.updatedAt))) return null;

    return meta;
  } catch {
    return null;
  }
}

async function tryRestoreCatalogInstant(url) {
  const meta = getCatalogCacheMeta(url);
  if (!meta) return false;

  /*
     Não confie somente no snapshot: confirme que o banco realmente
     possui dados. Se o navegador limpou o IndexedDB, seguimos pela
     rede normalmente.
  */
  try {
    if (!state.db) {
      state.db = await openDB();
    }

    const sample = await loadSample(Math.min(RAM_LIMIT, 1200));
    if (!sample.length) return false;

    state.items = sample;
    state.seriesItemsCache = null;

    try {
      const savedGroups = JSON.parse(
        localStorage.getItem("GC_PLAY_PRO_GROUPS_V1") || "[]"
      );
      state.groups = Array.isArray(savedGroups) ? savedGroups : [];
    } catch {
      state.groups = [];
    }

    state.groupsReady = state.groups.length > 0;

    const counts = meta.counts || {};
    state.counts = {
      live: Number(counts.live || 0),
      movie: Number(counts.movie || 0),
      series: Number(counts.series || 0)
    };

    state.total = Number(
      meta.total ||
      state.counts.live + state.counts.movie + state.counts.series
    );

    state.seriesCatalog = [];
    state.seriesCatalogMap = new Map();
    state.seriesCatalogReady = false;
    state.seriesCatalogBuilding = false;

    state.playlistMeta.url = String(url);
    state.playlistMeta.name =
      document.getElementById("playlistName")?.value?.trim() ||
      getSavedPlaylist()?.name ||
      "Minha Playlist";

    renderStats();
    renderGenreFilters();
    render();
    await renderHomeDashboard();

    const age = Math.max(0, Date.now() - Number(meta.updatedAt || Date.now()));
    const ageMin = Math.floor(age / 60000);

    updateLoadMessage(
      ageMin > 0
        ? `Catálogo local instantâneo • atualizado há ${ageMin} min`
        : "Catálogo local instantâneo"
    );

    toast(
      `Biblioteca pronta: ${formatNumber(state.total)} conteúdos`,
      2500
    );

    /*
       Após meia hora, uma nova submissão volta ao fluxo de rede.
       Enquanto o cache está recente, o usuário não precisa esperar
       a playlist inteira ser baixada novamente.
    */
    return age <= CACHE_MAX_AGE_MS;
  } catch (error) {
    console.warn("[GC PLAY PRO] cache local indisponível:", error);
    return false;
  }
}

/* =========================================================
   CARREGAR M3U — MOTOR PRINCIPAL
   ========================================================= */

async function loadM3U(
  url
) {
  if (
    state.loading
  ) {
    toast(
      "Já existe uma playlist sendo carregada."
    );

    return false;
  }

  if (
    !url ||
    !isHttpUrl(url)
  ) {
    toast(
      "Informe uma URL M3U válida."
    );

    return false;
  }

  /* -------------------------------------------------------
     CANCELAR CARGA ANTERIOR
     ------------------------------------------------------- */

  if (state.loadAbort) {
    try {
      state.loadAbort.abort();
    } catch {}
  }

  const controller =
    new AbortController();

  state.loadAbort =
    controller;

  state.loading =
    true;

  /*
     Cache-first: se esta URL já foi importada recentemente, restaure
     a biblioteca local antes de qualquer download. Isso evita apagar
     o banco e reprocessar 100k/300k+ registros para cada abertura.
  */
  const cachedInstant = await tryRestoreCatalogInstant(url);
  if (cachedInstant) {
    state.loading = false;
    return true;
  }

  writeError = null;

  state.items =
    [];

  state.groups =
    [];

  state.groupsReady =
    false;

  state.counts = {
    live: 0,
    movie: 0,
    series: 0
  };

  state.total =
    0;

  state.seriesItemsCache = null;
  state.importSeriesKeys = new Set();
  state.seriesCatalog = [];
  state.seriesCatalogMap = new Map();
  state.seriesCatalogChanged = new Set();
  state.seriesCatalogReady = false;

  renderStats();

  updateLoadMessage(
    "Preparando conexão..."
  );

  const startTime =
    performance.now();

  try {
    /* -----------------------------------------------------
       CONECTAR PRIMEIRO — só apaga o catálogo antigo
       depois que a nova playlist respondeu.
       Assim uma URL com erro não destrói a lista atual.
       ----------------------------------------------------- */

    updateLoadMessage(
      "Testando conexão com a playlist..."
    );

    const xtreamFast =
      await tryLoadXtreamFast(
        url,
        controller.signal
      );

    if (xtreamFast) {
      updateLoadMessage("Catálogo Xtream recebido. Gravando biblioteca...");

      try {
        await resetDatabaseFast();
      } catch (error) {
        console.warn("Não foi possível limpar banco antigo:", error);
      }

      state.db = await openDB();
      state.xtreamSession = xtreamFast.session;
      state.xtreamUserInfo = xtreamFast.userInfo || null;
      state.playlistMeta.url = url;
      state.playlistMeta.name = document.getElementById("playlistName")?.value?.trim() || "Minha Playlist";
      /* Xtream agora usa carregamento sob demanda para séries. Não faça
         uma segunda leitura da M3U inteira ao abrir a tela de séries. */
      state.xtreamSeriesFallbackNeeded = false;
      state.items = xtreamFast.items.slice(0, RAM_LIMIT);
      state.groups = xtreamFast.groups;
      state.groupsReady = true;
      state.counts = { ...xtreamFast.counts };
      state.total = xtreamFast.items.length;
      state.seriesCatalog = xtreamFast.seriesCatalog;
      state.seriesCatalogMap = new Map(
        xtreamFast.seriesCatalog.map(item => [item.seriesKey, item])
      );
      state.seriesCatalogReady = true;

      await writeBatch(
        xtreamFast.items,
        xtreamFast.seriesCatalog
      );

      try {
        localStorage.setItem("GC_PLAY_PRO_GROUPS_V1", JSON.stringify(state.groups));
        localStorage.setItem(
          "GC_PLAY_PRO_XTREAM_SESSION_V1",
          JSON.stringify({
            base: xtreamFast.session.base,
            username: xtreamFast.session.username,
            password: xtreamFast.session.password,
            liveExtension: xtreamFast.session.liveExtension
          })
        );
      } catch {}

      await buildGenreCatalog();
      await loadDatabaseStats();
      saveCatalogCacheMeta(url);

      state.loading = false;
      resetToPlaylistHome();
      await renderHomeDashboard();

      /*
         Filmes e séries continuam em segundo plano. A tela e a TV ao vivo
         não ficam bloqueadas esperando catálogos grandes.
      */
      Promise.allSettled([
        ensureXtreamSectionLoaded("movie"),
        ensureXtreamSectionLoaded("series")
      ]).then(() => {
        saveCatalogCacheMeta(url);
      }).catch(() => {});

      const elapsed = (performance.now() - startTime) / 1000;
      updateLoadMessage(
        "Catálogo rápido: " + formatNumber(xtreamFast.items.length) +
        " conteúdos em " + elapsed.toFixed(1) + "s"
      );

      toast(
        "Xtream Fast: " + formatNumber(xtreamFast.items.length) + " conteúdos carregados.",
        5000
      );

      return true;
    }

    const response =
      await fetchPlaylist(
        url,
        controller.signal
      );

    if (
      controller.signal.aborted
    ) {
      throw new DOMException(
        "Operação cancelada",
        "AbortError"
      );
    }

    updateLoadMessage(
      "Playlist encontrada. Preparando catálogo..."
    );

    try {
      await resetDatabaseFast();
    } catch (error) {
      console.warn(
        "Não foi possível limpar banco antigo:",
        error
      );
    }

    state.db =
      await openDB();

    updateLoadMessage(
      "Conectado. Recebendo playlist..."
    );

    /* -----------------------------------------------------
       VERIFICAR TIPO DE RESPOSTA
       ----------------------------------------------------- */

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    console.log(
      "[GC PLAY PRO] Content-Type:",
      contentType
    );

    /* -----------------------------------------------------
       BATCH ATUAL
       ----------------------------------------------------- */

    let batch = [];

    const groups =
      new Set();

    let processed = 0;

    let lastRender =
      performance.now();

    let firstPaint =
      false;

    /* -----------------------------------------------------
       PARSE PROGRESSIVO
       ----------------------------------------------------- */

    for await (
      const item of parseM3UStream(
        response,
        controller.signal
      )
    ) {
      if (
        controller.signal.aborted
      ) {
        throw new DOMException(
          "Operação cancelada",
          "AbortError"
        );
      }

      processParsedItem(
        item,
        batch,
        groups
      );

      processed++;

      /* -----------------------------------------------
         A CADA 500 ITENS
         ----------------------------------------------- */

      const targetBatchSize = firstPaint ? WRITE_BATCH : FIRST_PAINT_BATCH;

      if (
        batch.length >=
        targetBatchSize
      ) {
        await waitForWriteCapacity();

        const batchToWrite =
          batch;

        batch = [];

        queueWrite(
          batchToWrite,
          takeSeriesCatalogUpdates()
        );

        /* ---------------------------------------------
           PRIMEIRA EXIBIÇÃO
           --------------------------------------------- */

        if (!firstPaint) {
          firstPaint =
            true;

          render();

          updateLiveCounters();

          updateLoadMessage(
            `Carregando... ${formatNumber(
              processed
            )} itens`
          );
        }

        /* ---------------------------------------------
           RENDER THROTTLE
           --------------------------------------------- */

        const now =
          performance.now();

        if (
          now -
            lastRender >
          UI_RENDER_INTERVAL
        ) {
          lastRender = now;

          /*
             Durante uma importação gigante não reconstruímos
             centenas de cards repetidamente. Só atualizamos
             números e progresso; o catálogo visual completo
             é renderizado no fim.
          */
          updateLiveCounters();

          updateLoadMessage(
            `Carregando... ${formatNumber(
              processed
            )} itens`
          );

          await new Promise(
            requestAnimationFrame
          );
        }
      }
    }

    /* -----------------------------------------------------
       ÚLTIMO LOTE
       ----------------------------------------------------- */

    if (batch.length) {
      await waitForWriteCapacity();
      queueWrite(
        batch,
        takeSeriesCatalogUpdates()
      );
    }

    /* -----------------------------------------------------
       ATUALIZAR ESTADO
       ----------------------------------------------------- */

    state.groups =
      Array.from(groups).sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));

    try {
      localStorage.setItem("GC_PLAY_PRO_GROUPS_V1", JSON.stringify(state.groups));
    } catch {}

    state.groupsReady =
      true;

    updateLiveCounters();

    render();

    /* -----------------------------------------------------
       AGUARDAR FILA DE GRAVAÇÃO
       ----------------------------------------------------- */

    updateLoadMessage(
      `Finalizando... ${formatNumber(
        processed
      )} itens`
    );

    /*
       Não bloqueamos a interface durante
       todo o processo de gravação.
    */

    if (processed === 0) {
      throw new Error(
        "A resposta foi recebida, mas nenhum item M3U válido foi encontrado."
      );
    }

    /*
       O índice de séries já foi gravado durante a importação.
       Carregamos somente esse índice — nunca os 400k episódios.
    */
    setTimeout(async () => {
      try {
        while (writeProcessing || writeQueue.length) {
          await sleep(100);
        }

        if (writeError) {
          console.warn(
            "[GC PLAY PRO] Gravação em segundo plano:",
            writeError
          );
          return;
        }

        /*
           IMPORTANTE: o contador bruto de episódios é atualizado
           durante a importação. Aqui, depois que TODA a gravação
           terminou, reconstruímos o catálogo por nome para obter
           a quantidade real de séries únicas.
        */
        await rebuildSeriesCatalogInBackground(true);

        state.seriesCatalog =
          await loadSeriesCatalogFromDB();

        state.seriesCatalogMap =
          new Map(
            state.seriesCatalog.map(
              item => [item.seriesKey, item]
            )
          );

        state.seriesCatalogReady =
          true;

        /*
           Antes daqui, updateLiveCounters() mostrava o número
           de episódios como se fossem séries. Agora o contador
           passa a usar exclusivamente o catálogo único.
        */
        state.counts.series =
          state.seriesCatalog.length;

        state.total =
          state.counts.live +
          state.counts.movie +
          state.counts.series;

        renderGenreFilters();
        renderStats();
        render();
        saveCatalogCacheMeta(url);
      } catch (catalogError) {
        console.warn(
          "[GC PLAY PRO] Catálogo de séries em segundo plano:",
          catalogError
        );
      }
    }, 0);

    /* -----------------------------------------------------
       RESULTADO FINAL
       ----------------------------------------------------- */

    const elapsed =
      (
        performance.now() -
        startTime
      ) / 1000;

    updateLiveCounters();

    state.loading = false;
    resetToPlaylistHome();
    await renderHomeDashboard();

    renderStats();
    saveCatalogCacheMeta(url);

    updateLoadMessage(
      `Playlist carregada: ${formatNumber(
        processed
      )} itens em ${elapsed.toFixed(
        1
      )}s`
    );

    toast(
      `${formatNumber(
        processed
      )} conteúdos carregados.`,
      5000
    );

    /*
       O formulário também fecha o diálogo imediatamente quando
       recebe true. Este fechamento atrasado fica apenas como
       proteção para fluxos que chamem loadM3U diretamente.
    */
    return true;

    /*
       Fechar diálogo depois de um pequeno
       intervalo para o usuário visualizar
       o resultado.
    */

    

    /*
       Recriar grupos a partir do banco
       em segundo plano.
    */

    setTimeout(
      async () => {
        try {
          const databaseGroups =
            await getGroups();

          if (
            databaseGroups.length
          ) {
            state.groups =
              databaseGroups;
          }
        } catch (error) {
          console.warn(
            "Erro reconstruindo grupos:",
            error
          );
        }
      },
      100
    );

  } catch (error) {
    state.loading =
      false;

    renderStats();

    if (
      error &&
      error.name ===
      "AbortError"
    ) {
      updateLoadMessage(
        "Carregamento cancelado."
      );

      toast(
        "Carregamento cancelado."
      );

      return;
    }

    console.error(
      "[GC PLAY PRO] Erro M3U:",
      error
    );

    let message =
      "Não foi possível carregar a playlist.";

    if (
      error &&
      error.message
    ) {
      message +=
        ` ${error.message}`;
    }

    updateLoadMessage(
      message
    );

    toast(
      "Erro ao carregar a playlist.",
      5000
    );

    return false;
  } finally {
    state.loadAbort =
      null;

    state.loading =
      false;

    renderStats();
  }
}

/* =========================================================
   CARREGAR ARQUIVO M3U LOCAL
   ========================================================= */

async function loadFile(
  file
) {
  if (!file) {
    return;
  }

  if (
    !file.name
      .toLowerCase()
      .match(
        /\.(m3u|m3u8|txt)$/i
      )
  ) {
    toast(
      "Selecione um arquivo M3U ou M3U8."
    );

    return;
  }

  state.loading =
    true;

  state.items =
    [];

  state.counts = {
    live: 0,
    movie: 0,
    series: 0
  };

  state.groups =
    [];

  state.seriesItemsCache = null;
  state.seriesCatalog = [];
  state.seriesCatalogMap = new Map();
  state.seriesCatalogChanged = new Set();
  state.seriesCatalogReady = false;
  state.seriesCatalogBuilding = false;

  renderStats();

  try {
    updateLoadMessage(
      "Lendo arquivo local..."
    );

    /*
       Para arquivos locais grandes,
       usamos Blob.stream quando disponível.
    */

    let response;

    if (
      typeof file.stream ===
      "function"
    ) {
      response =
        new Response(
          file.stream()
        );
    } else {
      const text =
        await file.text();

      response =
        new Response(
          text
        );
    }

    if (
      state.db
    ) {
      try {
        state.db.close();
      } catch {}
    }

    try {
      await resetDatabaseFast();
    } catch {}

    state.db =
      await openDB();

    let batch = [];

    const groups =
      new Set();

    let processed = 0;

    for await (
      const item of parseM3UStream(
        response,
        null
      )
    ) {
      processParsedItem(
        item,
        batch,
        groups
      );

      processed++;

      if (
        batch.length >=
        WRITE_BATCH
      ) {
        const batchToWrite = batch;
        batch = [];

        queueWrite(
          batchToWrite,
          takeSeriesCatalogUpdates()
        );

        render();

        updateLiveCounters();

        updateLoadMessage(
          `Carregando arquivo... ${formatNumber(
            processed
          )} itens`
        );

        await new Promise(
          requestAnimationFrame
        );
      }
    }

    if (batch.length) {
      queueWrite(
        batch,
        takeSeriesCatalogUpdates()
      );
    }

    state.groups =
      Array.from(groups)
        .sort(
          (a, b) =>
            a.localeCompare(
              b,
              "pt-BR",
              {
                sensitivity:
                  "base"
              }
            )
        );

    while (
      writeProcessing ||
      writeQueue.length
    ) {
      await sleep(50);
    }

    render();

    updateLiveCounters();

    updateLoadMessage(
      `Arquivo carregado: ${formatNumber(
        processed
      )} itens`
    );

    /*
       Só agora reconstruímos o catálogo de séries. A importação
       principal já terminou, então o usuário recupera o controle
       da interface imediatamente.
    */
    setTimeout(() => {
      rebuildSeriesCatalogInBackground(true);
    }, 50);

    toast(
      `${formatNumber(
        processed
      )} conteúdos carregados.`,
      5000
    );

  } catch (error) {
    console.error(
      "Erro carregando arquivo:",
      error
    );

    updateLoadMessage(
      "Erro ao ler o arquivo."
    );

    toast(
      "Erro ao carregar arquivo M3U."
    );
  } finally {
    state.loading =
      false;

    renderStats();
  }
}

/* =========================================================
   FORMULÁRIO DA PLAYLIST
   ========================================================= */

function setupPlaylistForm() {
  const form =
    $("#playlistForm");

  if (!form) {
    return;
  }

  form.dataset.gcSubmitBound = "1";

  form.addEventListener(
    "submit",
    async event => {
      if (event.__gcPlaylistHandled) return;
      event.__gcPlaylistHandled = true;
      event.preventDefault();

      const nameInput =
        $("#playlistName");

      const urlInput =
        $("#playlistUrl");

      const name =
        nameInput
          ? nameInput.value.trim()
          : "";

      const url =
        urlInput
          ? urlInput.value.trim()
          : "";

      if (!url) {
        toast(
          "Informe a URL da playlist."
        );

        if (urlInput) {
          urlInput.focus();
        }

        return;
      }

      if (
        !isHttpUrl(url)
      ) {
        toast(
          "A URL precisa começar com http:// ou https://."
        );

        return;
      }

      /*
         Salvar nome da playlist
         para uso futuro.
      */

      try {
        localStorage.setItem(
          "GC_PLAY_PRO_PLAYLIST_NAME",
          name ||
            "Minha Playlist"
        );

        localStorage.setItem(
          "GC_PLAY_PRO_PLAYLIST_URL",
          url
        );
      } catch {}

      const submitButton =
        form.querySelector(
          'button[type="submit"]'
        );

      if (submitButton) {
        submitButton.disabled =
          true;

        submitButton.dataset.oldText =
          submitButton.textContent;

        submitButton.textContent =
          "CARREGANDO...";
      }

      try {
        const loaded = await loadM3U(url);

        if (loaded === true) {
          closeDialog("playlistDialog");
        }
      } finally {
        if (submitButton) {
          submitButton.disabled =
            false;

          submitButton.textContent =
            submitButton.dataset.oldText ||
            "CARREGAR";
        }
      }
    }
  );
}

/* =========================================================
   BOTÃO EXPLORAR
   ========================================================= */

function setupExploreButton() {
  const button =
    $("#exploreButton");

  if (!button) {
    return;
  }

  button.addEventListener(
    "click",
    () => {
      const target = state.currentSection === "home" ? $("#homeDashboard") : $("#librarySection");
      if (target) target.scrollIntoView({behavior:"smooth",block:"start"});
    }
  );
}

/* =========================================================
   BUSCA
   ========================================================= */

let searchTimer =
  null;

function setupSearch() {
  const input =
    $("#globalSearch");

  if (!input) {
    return;
  }

  input.addEventListener(
    "input",
    () => {
      clearTimeout(
        searchTimer
      );

      const value =
        input.value.trim();

      state.searchTerm =
        value;

      searchTimer =
        setTimeout(
          () => {
            performSearch(
              value
            );
          },
          250
        );
    }
  );
}

/* =========================================================
   BUSCA GLOBAL
   ========================================================= */

let searchRequestId = 0;

async function performSearch(
  term
) {
  const results =
    $("#searchResults");

  if (!results) {
    return;
  }

  const requestId =
    ++searchRequestId;

  const normalized =
    normalizeText(term);

  if (!normalized) {
    results.innerHTML =
      `
        <div class="gc-results-count">
          Digite o nome de um canal,
          filme ou série.
        </div>
      `;

    return;
  }

  results.innerHTML =
    `
      <div class="gc-loading">
        <span class="gc-spinner"></span>
        Procurando rapidamente...
      </div>
    `;

  const ramMatches =
    state.items.filter(
      item =>
        item.nameLower.includes(
          normalized
        ) ||
        normalizeText(
          item.group
        ).includes(
          normalized
        )
    );

  const unique =
    new Map();

  ramMatches
    .slice(0, 100)
    .forEach(
      item => unique.set(
        item.id,
        item
      )
    );

  if (
    unique.size < 100 &&
    state.db
  ) {
    const dbMatches =
      await searchDatabase(
        normalized,
        100 - unique.size,
        requestId
      );

    if (
      requestId !== searchRequestId
    ) {
      return;
    }

    dbMatches.forEach(
      item => unique.set(
        item.id,
        item
      )
    );
  }

  const matches =
    Array.from(
      unique.values()
    ).slice(0, 100);

  if (!matches.length) {
    results.innerHTML =
      `
        <div class="gc-results-count">
          Nenhum resultado encontrado.
        </div>
      `;

    return;
  }

  results.innerHTML =
    `
      <div class="gc-results-count">
        Até ${formatNumber(matches.length)}
        resultado(s) encontrados
      </div>

      ${matches
        .map(renderSearchResult)
        .join("")}
    `;

  setupSearchResultEvents();
}
/* =========================================================
   BUSCA NO BANCO
   ========================================================= */

function searchDatabase(
  term,
  limit = 100,
  requestId = 0
) {
  return new Promise(
    (resolve, reject) => {
      if (
        !state.db ||
        !term ||
        limit <= 0
      ) {
        resolve([]);
        return;
      }

      const result = [];
      const seen = new Set();

      const transaction =
        state.db.transaction(
          STORE_NAME,
          "readonly"
        );

      const store =
        transaction.objectStore(
          STORE_NAME
        );

      const index =
        store.index("nameLower");

      const upper =
        term + "\\uffff";

      const prefixRange =
        IDBKeyRange.bound(
          term,
          upper,
          false,
          false
        );

      const prefixRequest =
        index.openCursor(
          prefixRange
        );

      let fallbackStarted =
        false;

      const startFallback =
        () => {
          if (fallbackStarted) {
            return;
          }

          fallbackStarted = true;

          if (
            result.length >= limit
          ) {
            resolve(result);
            return;
          }

          const fallbackRequest =
            store.openCursor();

          let scanned = 0;

          fallbackRequest.onsuccess =
            async event => {
              const cursor =
                event.target.result;

              if (!cursor) {
                resolve(result);
                return;
              }

              if (
                requestId !== searchRequestId
              ) {
                resolve([]);
                return;
              }

              const item =
                cursor.value;

              if (
                !seen.has(item.id) &&
                (
                  item.nameLower.includes(term) ||
                  normalizeText(
                    item.group
                  ).includes(term)
                )
              ) {
                seen.add(item.id);
                result.push(item);

                if (
                  result.length >= limit
                ) {
                  resolve(result);
                  return;
                }
              }

              scanned++;

              if (
                scanned % 1000 === 0
              ) {
                await new Promise(
                  requestAnimationFrame
                );

                if (
                  requestId !== searchRequestId
                ) {
                  resolve([]);
                  return;
                }
              }

              cursor.continue();
            };

          fallbackRequest.onerror =
            () => {
              reject(
                fallbackRequest.error
              );
            };
        };

      prefixRequest.onsuccess =
        event => {
          const cursor =
            event.target.result;

          if (!cursor) {
            startFallback();
            return;
          }

          if (
            requestId !== searchRequestId
          ) {
            resolve([]);
            return;
          }

          const item =
            cursor.value;

          if (
            !seen.has(item.id)
          ) {
            seen.add(item.id);
            result.push(item);
          }

          if (
            result.length >= limit
          ) {
            resolve(result);
            return;
          }

          cursor.continue();
        };

      prefixRequest.onerror =
        () => {
          startFallback();
        };
    }
  );
}
/* =========================================================
   RESULTADO DA BUSCA
   ========================================================= */

function renderSearchResult(
  item
) {
  const image =
    item.logo
      ? `
        <img
          src="${escapeHTML(
            item.logo
          )}"
          alt=""
          loading="lazy"
          onerror="this.style.display='none'"
        >
      `
      : `
        <div class="gc-search-logo">
          ${getTypeIcon(
            item.type
          )}
        </div>
      `;

  return `
    <div
      class="gc-search-result"
      data-search-id="${escapeHTML(
        item.id
      )}"
    >

      ${image}

      <div class="gc-search-text">

        <div class="gc-search-name">
          ${escapeHTML(
            item.name
          )}
        </div>

        <div class="gc-search-meta">
          ${escapeHTML(
            formatType(
              item.type
            )
          )}
          •
          ${escapeHTML(
            item.group
          )}
        </div>

      </div>

    </div>
  `;
}

/* =========================================================
   EVENTOS DOS RESULTADOS
   ========================================================= */

function setupSearchResultEvents() {
  const results =
    $("#searchResults");

  if (!results) {
    return;
  }

  results
    .querySelectorAll(
      "[data-search-id]"
    )
    .forEach(
      element => {
        element.addEventListener(
          "click",
          async () => {
            const id =
              element.dataset.searchId;

            const item =
              await findItem(id);

            if (item) {
              closeDialog(
                "searchDialog"
              );

              await playItem(
                item
              );
            }
          }
        );
      }
    );
}

/* =========================================================
   ARQUIVO LOCAL
   ========================================================= */

function setupLocalFileButton() {
  const input =
    document.createElement(
      "input"
    );

  input.type =
    "file";

  input.accept =
    ".m3u,.m3u8,.txt,audio/x-mpegurl,application/vnd.apple.mpegurl";

  input.style.display =
    "none";

  document.body.appendChild(
    input
  );

  const button =
    document.createElement(
      "button"
    );

  button.type =
    "button";

  button.className =
    "gc-local-file-button";

  button.textContent =
    "CARREGAR ARQUIVO M3U";

  button.addEventListener(
    "click",
    () => {
      input.click();
    }
  );

  input.addEventListener(
    "change",
    async () => {
      const file =
        input.files &&
        input.files[0];

      if (file) {
        await loadFile(
          file
        );
      }

      input.value =
        "";
    }
  );

  const form =
    $("#playlistForm");

  if (form) {
    form.appendChild(
      button
    );
  }
}
/* =========================================================
   CARREGAR CONTADORES DO BANCO
   ========================================================= */

async function loadDatabaseStats() {
  try {
    if (!state.db) {
      return;
    }

    const [
      total,
      live,
      movie,
      series
    ] = await Promise.all([
      countAllItems(),
      countByType("live"),
      countByType("movie"),
      countByType("series")
    ]);

    state.total =
      total;

    state.counts.live =
      live;

    state.counts.movie =
      movie;

    /*
       "series" representa séries únicas, não episódios.
       Enquanto o catálogo ainda está sendo reconstruído, usamos
       o contador bruto apenas como valor transitório.
    */
    state.counts.series =
      state.seriesCatalogReady
        ? state.seriesCatalog.length
        : series;

    renderStats();

  } catch (error) {
    console.error(
      "Erro carregando estatísticas:",
      error
    );
  }
}

/* =========================================================
   CARREGAR CATÁLOGO LOCAL
   ========================================================= */

function loadSeriesCatalogFromDB() {
  return new Promise((resolve, reject) => {
    if (!state.db || !state.db.objectStoreNames.contains(SERIES_STORE)) {
      resolve([]);
      return;
    }

    const transaction = state.db.transaction(
      SERIES_STORE,
      "readonly"
    );

    const request =
      transaction.objectStore(SERIES_STORE).getAll();

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => reject(request.error);
  });
}

function needsSeriesCatalogMigration(catalog) {
  if (!Array.isArray(catalog) || !catalog.length) return false;

  return catalog.some(item =>
    Number(item.episodeCount || 0) > 0 &&
    Object.keys(item.seasons || {}).length === 0
  );
}

async function loadLocalCatalog() {
  try {
    if (!state.db) return;
    const savedPlaylist = getSavedPlaylist();
    if (savedPlaylist) state.playlistMeta = savedPlaylist;
    state.items = await loadSample(RAM_LIMIT);
    state.seriesItemsCache = null;

    const storedSeries = await loadSeriesCatalogFromDB();

    /*
       Consolida também catálogos antigos. Assim uma playlist
       que já foi importada antes da correção não precisa ser
       baixada novamente só para juntar os episódios.
    */
    const mergedSeries = new Map();
    const aliases = new Map();

    for (const entry of storedSeries) {
      const title = canonicalSeriesTitle(
        entry.seriesName || entry.name || ""
      );
      const canonicalKey = normalizeText(title);
      const oldKey = String(entry.seriesKey || canonicalKey);

      aliases.set(oldKey, canonicalKey);
      aliases.set(canonicalKey, canonicalKey);

      let target = mergedSeries.get(canonicalKey);

      if (!target) {
        target = {
          ...entry,
          seriesKey: canonicalKey,
          seriesName: title,
          nameLower: normalizeText(title),
          episodeCount: 0,
          seasons: {}
        };
        mergedSeries.set(canonicalKey, target);
      }

      target.episodeCount += Number(entry.episodeCount || 0);

      for (const [season, count] of Object.entries(entry.seasons || {})) {
        target.seasons[season] =
          Number(target.seasons[season] || 0) + Number(count || 0);
      }

      if (!target.logo && entry.logo) target.logo = entry.logo;
      if (!target.group && entry.group) target.group = entry.group;
      if (!target.genre && entry.genre) target.genre = entry.genre;
    }

    state.seriesKeyAliases = aliases;
    state.seriesCatalog = Array.from(mergedSeries.values());
    state.seriesCatalogMap = new Map(
      state.seriesCatalog.map(item => [item.seriesKey, item])
    );
    state.seriesCatalogReady = state.seriesCatalog.length > 0;

    try {
      const saved = JSON.parse(localStorage.getItem("GC_PLAY_PRO_GROUPS_V1") || "[]");
      state.groups = Array.isArray(saved) ? saved : [];
    } catch { state.groups = []; }

    if (!state.groups.length) {
      state.groups = await getGroups();
      try { localStorage.setItem("GC_PLAY_PRO_GROUPS_V1", JSON.stringify(state.groups)); } catch {}
    }

    /*
       Nunca montar categorias a partir de "groups" globais.
       Isso misturava TV, filmes e séries.
       O catálogo é separado pelo item.type real.
    */
    await buildGenreCatalog();

    /*
       O catálogo salvo no IndexedDB pode ser antigo e conter
       episódios agrupados como se fossem séries. Portanto NÃO
       usamos esse catálogo para o contador inicial.
       Primeiro reconstruímos diretamente a partir de TODOS os
       itens da playlist e somente depois calculamos as estatísticas.
    */
    await rebuildSeriesCatalogInBackground(true);

    await loadDatabaseStats();
    renderGenreFilters();
    render();

    /*
       A reconstrução acima já atualiza:
       - state.seriesCatalog
       - state.seriesCatalogMap
       - state.seriesKeyAliases
       - state.counts.series

       Não deixar uma migração em segundo plano sobrescrever o
       catálogo correto depois que a tela já foi carregada.
    */
    try {
      localStorage.setItem(
        "GC_PLAY_PRO_SERIES_MIGRATION_V4",
        "1"
      );
    } catch {}
  } catch (error) {
    console.error("Erro carregando catálogo:", error);
  }
}

/* =========================================================
   RESTAURAR PLAYLIST
   ========================================================= */

function getSavedPlaylist() {
  try {
    const url =
      localStorage.getItem(
        "GC_PLAY_PRO_PLAYLIST_URL"
      );

    const name =
      localStorage.getItem(
        "GC_PLAY_PRO_PLAYLIST_NAME"
      );

    if (!url) {
      return null;
    }

    return {
      url,
      name:
        name ||
        "Minha Playlist"
    };

  } catch {
    return null;
  }
}

/* =========================================================
   RESTAURAR FORMULÁRIO
   ========================================================= */

function restorePlaylistForm() {
  const playlist =
    getSavedPlaylist();

  if (!playlist) {
    return;
  }

  const name =
    $("#playlistName");

  const url =
    $("#playlistUrl");

  if (name) {
    name.value =
      playlist.name;
  }

  if (url) {
    url.value =
      playlist.url;
  }
}

/* =========================================================
   BOTÃO DE CANCELAR CARGA
   ========================================================= */

function setupCancelLoad() {
  const form =
    $("#playlistForm");

  if (!form) {
    return;
  }

  /*
     Permite cancelar com ESC.
  */

  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key === "Escape" &&
        state.loading
      ) {
        if (
          state.loadAbort
        ) {
          state.loadAbort.abort();
        }
      }
    }
  );
}

/* =========================================================
   TECLADO / SMART TV
   ========================================================= */

function setupKeyboardNavigation() {
  document.addEventListener(
    "keydown",
    event => {
      /*
         Não interferir enquanto
         usuário estiver digitando.
      */

      const tag =
        document.activeElement
          ?.tagName
          ?.toLowerCase();

      if (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select"
      ) {
        return;
      }

      /*
         ESC fecha player/dialog.
      */

      if (
        event.key === "Escape"
      ) {
        closePlayer();

        closeDialog(
          "searchDialog"
        );

        closeDialog(
          "settingsDialog"
        );

        return;
      }

      /*
         ENTER em item focado.
      */

      if (
        event.key === "Enter"
      ) {
        const focused =
          document.activeElement;

        if (
          focused &&
          focused.dataset &&
          focused.dataset.itemId
        ) {
          const id =
            focused.dataset.itemId;

          findItem(id)
            .then(item => {
              if (item) {
                playItem(item);
              }
            });
        }
      }
    }
  );
}

/* =========================================================
   FOCUS NOS CARDS
   ========================================================= */

function enableCardFocus() {
  const observer =
    new MutationObserver(
      () => {
        const cards =
          document.querySelectorAll(
            ".gc-card"
          );

        cards.forEach(
          card => {
            if (
              !card.hasAttribute(
                "tabindex"
              )
            ) {
              card.setAttribute(
                "tabindex",
                "0"
              );
            }
          }
        );
      }
    );

  const grid =
    $("#contentGrid");

  if (grid) {
    observer.observe(
      grid,
      {
        childList: true
      }
    );
  }
}

/* =========================================================
   STATUS ONLINE / OFFLINE
   ========================================================= */

function setupConnectionStatus() {
  let backendOnline = null;
  let healthTimer = null;

  const update = () => {
    const element = $("#connectionStatus");
    if (!element) return;

    if (!navigator.onLine) {
      element.textContent = "OFFLINE";
      return;
    }

    if (state.loading) {
      element.textContent = "CARREGANDO...";
      return;
    }

    if (backendOnline === false) {
      element.textContent = "SERVIDOR";
      return;
    }

    element.textContent = "ONLINE";
  };

  const checkHealth = async () => {
    if (!navigator.onLine) {
      backendOnline = false;
      update();
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(GC_HEALTH_URL, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
        headers: { "Accept": "application/json" }
      });
      backendOnline = response.ok;
    } catch (error) {
      backendOnline = false;
      console.warn("[GC PLAY PRO] Health check:", error?.message || error);
    } finally {
      clearTimeout(timeout);
      update();
    }
  };

  window.addEventListener("online", () => {
    update();
    checkHealth();
  });

  window.addEventListener("offline", () => {
    backendOnline = false;
    update();
  });

  update();
  checkHealth();
  healthTimer = setInterval(checkHealth, 60000);
  window.addEventListener("beforeunload", () => clearInterval(healthTimer), { once: true });
}

/* =========================================================
   LIMPAR CATÁLOGO
   ========================================================= */

async function clearCatalog() {
  const confirmed =
    window.confirm(
      "Isso irá apagar a playlist armazenada neste navegador. Continuar?"
    );

  if (!confirmed) {
    return;
  }

  try {
    await resetDatabaseFast();

    state.db =
      await openDB();

    state.items =
      [];

    state.groups =
      [];

    state.counts = {
      live: 0,
      movie: 0,
      series: 0
    };

    state.total =
      0;

    state.seriesItemsCache = null;
    state.seriesCatalog = [];
    state.seriesCatalogMap = new Map();
    state.seriesCatalogChanged = new Set();
    state.seriesCatalogReady = false;
    state.seriesCatalogBuilding = false;

    state.genreCatalog = {
      all: [],
      live: [],
      movie: [],
      series: []
    };

    renderGenreFilters();
    render();

    renderStats();

    toast(
      "Catálogo apagado."
    );

  } catch (error) {
    console.error(
      "Erro limpando catálogo:",
      error
    );

    toast(
      "Não foi possível apagar o catálogo."
    );
  }
}

/* =========================================================
   EXPOR FUNÇÕES PARA DEBUG
   ========================================================= */

window.loadM3U = loadM3U;
window.closeDialog = closeDialog;

window.__GC_STATE__ = state;

window.GC_PLAY_PRO = {
  state,

  ensureXtreamSectionLoaded,

  setCatalogCategory,

  navigateSection,

  render,

  loadM3U,

  loadFile,

  playItem,

  getSeriesEpisodes,
  toggleFavorite,

  closePlayer,

  clearCatalog,

  searchDatabase,

  resetDatabaseFast
};

/* =========================================================
   INICIALIZAÇÃO
   ========================================================= */

/* =========================================================
   BOTÃO SALVAR M3U — AÇÃO DIRETA
   O botão usa onclick no próprio elemento. Não há listener de
   captura no document para este botão, evitando bloquear o
   clique antes de chegar ao elemento.
   ========================================================= */
async function gcPlayProSavePlaylist(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const button = document.getElementById("savePlaylistButton");
  const nameInput = document.getElementById("playlistName");
  const urlInput = document.getElementById("playlistUrl");
  const message = document.getElementById("playlistMessage");

  const name = nameInput?.value.trim() || "Minha Playlist";
  const url = urlInput?.value.trim() || "";

  const showMessage = (text, isError = false) => {
    if (message) {
      message.textContent = text;
      message.style.display = "block";
      message.style.color = isError ? "#ff6b6b" : "var(--green)";
    }
    console.log("[GC PLAY PRO]", text);
  };

  try {
    if (state.loading) {
      showMessage("A playlist já está sendo carregada.", true);
      return false;
    }

    if (!url) {
      showMessage("Informe a URL da playlist.", true);
      urlInput?.focus();
      return false;
    }

    if (!isHttpUrl(url)) {
      showMessage("A URL precisa começar com http:// ou https://.", true);
      urlInput?.focus();
      return false;
    }

    try {
      localStorage.setItem("GC_PLAY_PRO_PLAYLIST_NAME", name);
      localStorage.setItem("GC_PLAY_PRO_PLAYLIST_URL", url);
    } catch {}

    showMessage("Conectando à playlist...");

    if (button) {
      button.disabled = true;
      button.textContent = "CONECTANDO...";
    }

    const loaded = await loadM3U(url);

    if (loaded === true) {
      showMessage("Playlist carregada com sucesso.");
      setTimeout(() => closeDialog("playlistDialog"), 250);
    } else {
      showMessage("Não foi possível carregar a playlist.", true);
    }

    return false;
  } catch (error) {
    console.error("[GC PLAY PRO] Falha ao salvar/importar M3U:", error);
    showMessage(error?.message || "Erro ao carregar a playlist.", true);
    return false;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "SALVAR LISTA";
    }
  }
}

window.gcPlayProSavePlaylist = gcPlayProSavePlaylist;

/* =========================================================
   FORMULÁRIO M3U — FALLBACK GLOBAL
   ========================================================= */
function setupPlaylistFormFallback() {
  if (window.__GC_PLAYLIST_FORM_FALLBACK__) return;
  window.__GC_PLAYLIST_FORM_FALLBACK__ = true;

  document.addEventListener("submit", async event => {
    const form = event.target.closest("#playlistForm");
    if (!form) return;

    /*
       Capturamos o submit aqui para impedir qualquer POST para
       o GitHub Pages. O flag evita que o listener normal execute
       a mesma importação duas vezes.
    */
    if (event.__gcPlaylistHandled) return;
    event.__gcPlaylistHandled = true;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const nameInput = document.getElementById("playlistName");
    const urlInput = document.getElementById("playlistUrl");
    const name = nameInput?.value.trim() || "Minha Playlist";
    const url = urlInput?.value.trim() || "";

    if (!url) {
      toast("Informe a URL da playlist.");
      urlInput?.focus();
      return;
    }

    if (!isHttpUrl(url)) {
      toast("A URL precisa começar com http:// ou https://.");
      urlInput?.focus();
      return;
    }

    try {
      localStorage.setItem("GC_PLAY_PRO_PLAYLIST_NAME", name);
      localStorage.setItem("GC_PLAY_PRO_PLAYLIST_URL", url);
    } catch {}

    const button = form.querySelector('button[type="submit"]');
    if (button) {
      button.disabled = true;
      button.dataset.oldText = button.textContent;
      button.textContent = "CARREGANDO...";
    }

    try {
      const loaded = await loadM3U(url);

      if (loaded === true) {
        closeDialog("playlistDialog");
      }
    } catch (error) {
      console.error("[GC PLAY PRO] Falha no envio M3U:", error);
      toast(error?.message || "Erro ao carregar a playlist.", 6000);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = button.dataset.oldText || "SALVAR LISTA";
      }
    }
  }, true);
}

/* =========================================================
   BOTÕES M3U — FALLBACK DE CLIQUE GLOBAL
   Garante que o modal abra mesmo se outro módulo da interface
   falhar durante a inicialização.
   ========================================================= */
function setupPlaylistButtonFallback() {
  if (window.__GC_PLAYLIST_BUTTON_FALLBACK__) return;
  window.__GC_PLAYLIST_BUTTON_FALLBACK__ = true;

  document.addEventListener("click", event => {
    const button = event.target.closest(
      "#addPlaylistButton, #emptyAddButton, #quickAddPlaylist"
    );

    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    const dialog = document.getElementById("playlistDialog");
    if (!dialog) {
      console.error("[GC PLAY PRO] playlistDialog não encontrado.");
      return;
    }

    try {
      if (dialog.open) return;

      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.classList.add("active", "open", "show");
        dialog.removeAttribute("hidden");
      }

      const name = document.getElementById("playlistName");
      if (name) setTimeout(() => name.focus(), 50);
    } catch (error) {
      console.error("[GC PLAY PRO] Erro abrindo modal M3U:", error);
      dialog.classList.add("active", "open", "show");
    }
  }, true);
}

async function initApp() {

  /* A camada de UI é a única responsável pelos botões de navegação. */

  console.log(
    "%cGC PLAY PRO",
    "font-size:24px;font-weight:900;color:#69ff65;"
  );

  console.log(
    "Inicializando sistema..."
  );

  ensureCSS();

  setupPlaylistButtonFallback();
  setupPlaylistFormFallback();

  loadState();

  setupCardEvents();
  setupHomeEvents();

  setupFilters();

  renderGenreFilters();

  setupDialogs();

  setupPlayerControls();

  setupSettings();

  setupPlaylistForm();

  setupExploreButton();

  setupSearch();

  setupLocalFileButton();

  setupCancelLoad();

  setupKeyboardNavigation();

  enableCardFocus();

  setupConnectionStatus();

  restorePlaylistForm();

  try {
    updateLoadMessage(
      "Inicializando catálogo..."
    );
  } catch {}

  /* -------------------------------------------------------
     ABRIR BANCO
     ------------------------------------------------------- */

  try {
    state.db =
      await openDB();

    /*
       Corrige uma vez os registros antigos que foram classificados
       pela regra antiga e depois reconstrói as séries/categorias.
    */
    /*
       A correção de categorias roda em segundo plano para que uma
       biblioteca grande não bloqueie a abertura do aplicativo.
    */
    migrateCatalogTypes()
      .then(async changed => {
        if (changed > 0) {
          state.seriesCatalog = [];
          state.seriesCatalogMap = new Map();
          state.seriesCatalogReady = false;
          state.seriesItemsCache = null;

          await rebuildSeriesCatalogInBackground(true);
          await buildGenreCatalog();
          await loadDatabaseStats();
          renderGenreFilters();
          await render();
        }
      })
      .catch(error => {
        console.warn("[GC PLAY PRO] Migração de categorias:", error);
      });

    console.log(
      "IndexedDB conectado."
    );

  } catch (error) {
    console.error(
      "Erro abrindo IndexedDB:",
      error
    );

    toast(
      "Erro ao inicializar banco local."
    );

    return;
  }

  /* -------------------------------------------------------
     CARREGAR CATÁLOGO
     ------------------------------------------------------- */

  /*
     RECUPERAÇÃO PRIORITÁRIA DA PLAYLIST:
     Se existe uma URL M3U salva e o IndexedDB está vazio, não espere
     a reconstrução de um catálogo antigo. Primeiro baixe/reimporte a
     playlist. Isso é especialmente importante para catálogos grandes
     (100k/300k+ itens), onde a reconstrução local pode demorar e deixar
     a tela aparentemente vazia.
  */
  let restoredPlaylistAtStartup = false;

  try {
    const savedPlaylist = getSavedPlaylist();

    if (savedPlaylist?.url) {
      let hasLocalItems = false;

      try {
        const sample = await loadSample(1);
        hasLocalItems = Array.isArray(sample) && sample.length > 0;
      } catch (error) {
        console.warn("[GC PLAY PRO] Não foi possível verificar o catálogo local:", error);
      }

      if (!hasLocalItems) {
        updateLoadMessage("Restaurando sua playlist...");
        restoredPlaylistAtStartup = await loadM3U(savedPlaylist.url);
      }
    }
  } catch (error) {
    console.warn("[GC PLAY PRO] Restauração prioritária da playlist:", error);
  }

  /*
     Só reconstrói o catálogo local quando a restauração prioritária
     não carregou uma nova playlist. Assim o startup não fica preso
     reconstruindo uma base vazia/antiga antes de tentar a M3U salva.
  */
  if (!restoredPlaylistAtStartup) {
    await loadLocalCatalog();

    /*
       Segunda tentativa: cobre o caso em que o banco foi alterado
       durante a inicialização ou ficou sem registros depois da leitura.
    */
    try {
      const savedPlaylist = getSavedPlaylist();

      if (
        savedPlaylist?.url &&
        Number(state.total || 0) === 0 &&
        !state.loading
      ) {
        updateLoadMessage("Restaurando sua playlist...");
        await loadM3U(savedPlaylist.url);
      }
    } catch (error) {
      console.warn("[GC PLAY PRO] Auto-restauração da playlist:", error);
    }
  }

  /* -------------------------------------------------------
     ESTATÍSTICAS
     ------------------------------------------------------- */

  renderStats();

  /* -------------------------------------------------------
     MENSAGEM INICIAL
     ------------------------------------------------------- */

  const total =
    state.total;

  if (total > 0) {
    console.log(
      `Catálogo local: ${formatNumber(
        total
      )} itens.`
    );
  } else {
    console.log(
      "Nenhuma playlist carregada."
    );
  }

  console.log(
    "%cGC PLAY PRO pronto.",
    "color:#69ff65;font-weight:bold;"
  );
}

/* =========================================================
   START
   ========================================================= */

if (
  document.readyState ===
  "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    () => { window.__GC_APP_READY__ = initApp(); },
    { once: true }
  );
} else {
  window.__GC_APP_READY__ = initApp();
}

/* GC AI — CHAT + VOZ + AÇÕES */
(function installGCAI(){const AI_URL="https://kuzgdvpdqmocklsgyzvt.supabase.co/functions/v1/gc-ai";let recognition=null,listening=false;const qs=s=>document.querySelector(s);const messages=()=>qs("#gcAiMessages");function addMessage(text,who="bot"){const box=messages();if(!box)return;const el=document.createElement("div");el.className="gc-ai-message "+(who==="user"?"gc-ai-user":"gc-ai-bot");el.textContent=String(text||"");box.appendChild(el);box.scrollTop=box.scrollHeight}function setStatus(text){const el=qs("#gcAiStatus");if(el)el.textContent="● "+text}function openAI(){qs("#gcAiPanel")?.classList.add("open");qs("#gcAiInput")?.focus()}function closeAI(){qs("#gcAiPanel")?.classList.remove("open")}function clickSection(section){const btn=document.querySelector('.nav-item[data-section="'+section+'"]');if(btn){btn.click();return true}return false}async function localAction(raw){const t=normalizeText(raw),video=qs("#videoPlayer");if(/(abra|abrir|va para|ir para|mostre).*(tv|canais?|ao vivo)/.test(t)){clickSection("live");return"Abri a TV ao vivo."}if(/(abra|abrir|va para|ir para|mostre).*(filme|filmes)/.test(t)){clickSection("movies");return"Abri os filmes."}if(/(abra|abrir|va para|ir para|mostre).*(serie|series)/.test(t)){clickSection("series");return"Abri as séries."}if(/(abra|abrir|va para|ir para|mostre).*(inicio|home)/.test(t)){clickSection("home");return"Voltei para o início."}if(/(pausar|pause|pare|parar)/.test(t)&&video){video.pause();return"Reprodução pausada."}if(/(continuar|continue|reproduzir|play|tocar)/.test(t)&&video){try{await video.play();return"Retomei a reprodução."}catch{}}if(/(tela cheia|fullscreen|full screen)/.test(t)){const target=qs("#playerPanel")||video;try{if(document.fullscreenElement)await document.exitFullscreen();else await target.requestFullscreen?.();return"Alternância de tela cheia executada."}catch{}}if(/(fechar|sair).*(player|video|reproducao|reprodução)/.test(t)){qs("#closePlayer")?.click();return"Fechei o player."}if(/(buscar|pesquisar|procure|procurar|encontre|encontrar)/.test(t)){let term=raw.replace(/^(.*?)(buscar|pesquisar|procure|procurar|encontre|encontrar)\s+/i,"").trim().replace(/^(por|o|a|um|uma)\s+/i,"").trim();qs("#searchButton")?.click();const input=qs("#globalSearch");if(input&&term){input.value=term;input.dispatchEvent(new Event("input",{bubbles:true}))}return term?'Pesquisando por "'+term+'".':"Abri a pesquisa."}return null}async function askAI(raw){const action=await localAction(raw);if(action){addMessage(action);return}setStatus("PENSANDO...");try{const s=window.__GC_STATE__||{},v=qs("#videoPlayer");const context={app:"GC PLAY PRO",section:s.currentSection||null,currentItem:s.currentItem?{name:s.currentItem.name,type:s.currentItem.type,group:s.currentItem.group,xtreamStreamId:s.currentItem.xtreamStreamId||null}:null,catalogCounts:s.counts||null,playback:{paused:!!v?.paused}};const response=await fetch(AI_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:raw,context})});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||"Falha ao consultar a IA.");addMessage(data.reply||"Não consegui gerar uma resposta.");setStatus("PRONTO")}catch(error){addMessage("O cérebro do GC AI ainda não está configurado. "+(error?.message||""));setStatus("IA INDISPONÍVEL")}}function initVoice(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition,button=qs("#gcAiVoice");if(!button)return;if(!SR){button.title="Reconhecimento de voz não disponível neste dispositivo";return}recognition=new SR();recognition.lang="pt-BR";recognition.interimResults=false;recognition.continuous=false;recognition.onstart=()=>{listening=true;button.classList.add("listening");setStatus("OUVINDO...")};recognition.onend=()=>{listening=false;button.classList.remove("listening");if(qs("#gcAiStatus")?.textContent.includes("OUVINDO"))setStatus("PRONTO")};recognition.onerror=()=>{listening=false;button.classList.remove("listening");setStatus("ERRO DE VOZ")};recognition.onresult=async e=>{const text=e.results?.[0]?.[0]?.transcript?.trim();if(!text)return;addMessage(text,"user");await askAI(text)};button.addEventListener("click",()=>{try{if(listening)recognition.stop();else recognition.start()}catch{}})}function init(){const open=qs("#gcAiOpen"),close=qs("#gcAiClose"),form=qs("#gcAiForm"),input=qs("#gcAiInput");open?.addEventListener("click",openAI);close?.addEventListener("click",closeAI);form?.addEventListener("submit",async e=>{e.preventDefault();const text=input?.value?.trim();if(!text)return;input.value="";addMessage(text,"user");await askAI(text)});document.querySelectorAll("[data-gc-ai-quick]").forEach(btn=>btn.addEventListener("click",()=>{const text=btn.dataset.gcAiQuick;addMessage(text,"user");askAI(text)}));initVoice()}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();window.GCAI={open:openAI,close:closeAI,ask:askAI}})();
