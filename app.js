/* =========================================================
   GC PLAY PRO
   APP.JS — MOTOR DE PLAYLIST PROGRESSIVO
   ========================================================= */

"use strict";

/* =========================================================
   CONFIGURAÇÕES
   ========================================================= */

const GC_SUPABASE_URL =
  "https://kuzgdvpdqmocklsgyzvt.supabase.co";

const GC_M3U_PROXY =
  `${GC_SUPABASE_URL}/functions/v1/m3u-proxy`;

const GC_HEALTH_URL =
  `${GC_SUPABASE_URL}/functions/v1/gc-health`;

/* O proxy é genérico: cada playlist pode usar um domínio diferente. */
const GC_PROXY_HOSTS = null;

const DB_NAME = "GC_PLAY_PRO_FAST";
const DB_VERSION = 6;
const STORE_NAME = "items";
const SERIES_STORE = "seriesCatalog";

const RAM_LIMIT = 4000;
const WRITE_BATCH = 20000;
const FIRST_PAINT_BATCH = 1000;
const UI_RENDER_INTERVAL = 2500;
const WRITE_QUEUE_LIMIT = 3;
const RESUME_KEY = "GC_PLAY_PRO_RESUME_V1";

const STATE_KEY = "GC_PLAY_PRO_STATE_V5";
const SETTINGS_KEY = "GC_PLAY_PRO_SETTINGS_V5";

/* =========================================================
   ESTADO
   ========================================================= */

const state = {
  db: null,

  items: [],
  groups: [],

  counts: {
    live: 0,
    movie: 0,
    series: 0
  },

  total: 0,

  currentFilter: "all",
  currentGenre: "all",
  currentSection: "home",

  adultUnlocked: false,

  seriesView: {
    seriesKey: null,
    season: null
  },

  searchTerm: "",

  favorites: new Set(),
  history: [],

  currentItem: null,

  loading: false,

  loadAbort: null,

  hls: null,

  mpegts: null,

  seriesItemsCache: null,

  seriesCatalog: [],
  seriesCatalogMap: new Map(),
  seriesCatalogChanged: new Set(),
  seriesCatalogReady: false,
  seriesCatalogBuilding: false,
  seriesKeyAliases: new Map(),

  genreCatalog: {
    all: [],
    live: [],
    movie: [],
    series: []
  },

  groupsReady: false,

  settings: {
    autoplay: true,
    compact: false,
    playbackRate: 1
  },

  resume: Object.create(null),

  playlistMeta: {
    url: "",
    name: ""
  },

  epgTimer: null
};

/* =========================================================
   DOM
   ========================================================= */

const $ = (selector) => document.querySelector(selector);

const $$ = (selector) =>
  Array.from(document.querySelectorAll(selector));

/* =========================================================
   UTILIDADES
   ========================================================= */

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatNumber(number) {
  return Number(number || 0).toLocaleString("pt-BR");
}

function formatResumeTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${String(m).padStart(2,"0")}min`;
  return `${m}min ${String(s).padStart(2,"0")}s`;
}

function formatType(type) {
  if (type === "live") return "TV AO VIVO";
  if (type === "movie") return "FILME";
  if (type === "series") return "SÉRIE";
  return "CONTEÚDO";
}

function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" ||
           parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isHLS(url) {
  const value = String(url || "").toLowerCase();

  return (
    value.includes(".m3u8") ||
    value.includes("m3u8?")
  );
}

function isM3U(url) {
  const value = String(url || "").toLowerCase();

  return (
    value.includes(".m3u") ||
    value.includes(".m3u8")
  );
}

/* =========================================================
   TOAST
   ========================================================= */

function toast(message, duration = 3000) {
  const element = $("#toast");

  if (!element) {
    console.log("[GC PLAY PRO]", message);
    return;
  }

  element.textContent = message;
  element.classList.add("show");

  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {
    element.classList.remove("show");
  }, duration);
}

/* =========================================================
   PERSISTÊNCIA DO ESTADO
   ========================================================= */

function saveState() {
  try {
    localStorage.setItem(
      STATE_KEY,
      JSON.stringify({
        favorites: Array.from(state.favorites),
        history: state.history.slice(0, 100)
      })
    );

    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify(state.settings)
    );

    localStorage.setItem(
      RESUME_KEY,
      JSON.stringify(state.resume)
    );
  } catch (error) {
    console.warn("Não foi possível salvar estado:", error);
  }
}

function loadState() {
  try {
    const saved = localStorage.getItem(STATE_KEY);

    if (saved) {
      const data = JSON.parse(saved);

      if (Array.isArray(data.favorites)) {
        state.favorites = new Set(data.favorites);
      }

      if (Array.isArray(data.history)) {
        state.history = data.history;
      }
    }

    try {
      const resume = localStorage.getItem(RESUME_KEY);
      if (resume) {
        const data = JSON.parse(resume);
        if (data && typeof data === "object") {
          state.resume = data;
        }
      }
    } catch {}

    try {
      const xtreamSaved = localStorage.getItem("GC_PLAY_PRO_XTREAM_SESSION_V1");
      if (xtreamSaved) {
        const session = JSON.parse(xtreamSaved);
        if (session?.base && session?.username && session?.password) {
          state.xtreamSession = session;
        }
      }
    } catch {}

    const settings = localStorage.getItem(SETTINGS_KEY);

    if (settings) {
      const data = JSON.parse(settings);

      state.settings = {
        ...state.settings,
        ...data,
        playbackRate: Number(data.playbackRate) > 0 ? Number(data.playbackRate) : 1
      };
    }
  } catch (error) {
    console.warn("Erro carregando estado:", error);
  }
}

/* =========================================================
   INDEXEDDB
   ========================================================= */

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const db = event.target.result;

      let store;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        store = db.createObjectStore(
          STORE_NAME,
          {
            keyPath: "id"
          }
        );
      } else {
        store = event.target.transaction.objectStore(
          STORE_NAME
        );
      }

      if (!store.indexNames.contains("type")) {
        store.createIndex(
          "type",
          "type",
          { unique: false }
        );
      }

      if (!store.indexNames.contains("nameLower")) {
        store.createIndex(
          "nameLower",
          "nameLower",
          { unique: false }
        );
      }

      if (!store.indexNames.contains("seriesKey")) {
        store.createIndex(
          "seriesKey",
          "seriesKey",
          { unique: false }
        );
      }

      if (!db.objectStoreNames.contains(SERIES_STORE)) {
        const seriesStore = db.createObjectStore(
          SERIES_STORE,
          { keyPath: "seriesKey" }
        );

        seriesStore.createIndex("genre","genre",{unique:false});
        seriesStore.createIndex("nameLower","nameLower",{unique:false});
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      db.onversionchange = () => {
        db.close();
      };

      resolve(db);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/* =========================================================
   APAGAR BANCO ANTIGO RAPIDAMENTE
   ========================================================= */

function resetDatabaseFast() {
  return new Promise((resolve, reject) => {
    try {
      if (state.db) {
        try {
          state.db.close();
        } catch {}
      }

      const request = indexedDB.deleteDatabase(DB_NAME);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };

      request.onblocked = () => {
        console.warn(
          "Exclusão do banco bloqueada por outra aba."
        );
      };
    } catch (error) {
      reject(error);
    }
  });
}

/* =========================================================
   ESCRITA EM LOTE
   ========================================================= */

let writeQueue = [];
let writeProcessing = false;
let writeError = null;

async function waitForWriteCapacity(limit = WRITE_QUEUE_LIMIT) {
  while (writeQueue.length >= limit) {
    if (writeError) throw writeError;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

function queueWrite(items, seriesUpdates = []) {
  if (
    (!items || !items.length) &&
    (!seriesUpdates || !seriesUpdates.length)
  ) {
    return;
  }

  writeQueue.push({
    items: items || [],
    seriesUpdates: seriesUpdates || []
  });

  processWriteQueue();
}

async function processWriteQueue() {
  if (writeProcessing) return;

  writeProcessing = true;

  try {
    while (writeQueue.length) {
      const payload = writeQueue.shift();

      await writeBatch(
        payload.items,
        payload.seriesUpdates
      );
    }
  } catch (error) {
    writeError = error;
    console.error(
      "Erro gravando banco:",
      error
    );
  } finally {
    writeProcessing = false;
  }
}

function writeBatch(
  items,
  seriesUpdates = []
) {
  return new Promise((resolve, reject) => {
    if (!state.db) {
      reject(
        new Error(
          "Banco de dados não inicializado."
        )
      );
      return;
    }

    const stores = [STORE_NAME];

    if (
      state.db.objectStoreNames.contains(
        SERIES_STORE
      )
    ) {
      stores.push(SERIES_STORE);
    }

    const transaction =
      state.db.transaction(
        stores,
        "readwrite"
      );

    const store =
      transaction.objectStore(
        STORE_NAME
      );

    for (const item of items) {
      store.put(item);
    }

    if (
      stores.includes(SERIES_STORE)
    ) {
      const seriesStore =
        transaction.objectStore(
          SERIES_STORE
        );

      for (const series of seriesUpdates) {
        seriesStore.put(series);
      }
    }

    transaction.oncomplete =
      () => resolve();

    transaction.onerror =
      () => reject(
        transaction.error
      );

    transaction.onabort =
      () => reject(
        transaction.error
      );
  });
}

function updateSeriesCatalogEntry(item) {
  if (!item || !looksLikeSeriesRecord(item)) return;

  const info = getDerivedSeriesInfo(item);

  if (!info.seriesKey) return;

  let entry = state.seriesCatalogMap.get(info.seriesKey);

  if (!entry) {
    entry = {
      seriesKey: info.seriesKey,
      seriesName: info.seriesName || item.name || "Série sem nome",
      nameLower: normalizeText(
        info.seriesName || item.name || ""
      ),
      logo: item.logo || "",
      group: item.group || "",
      genre: info.genre || getGenreName(item.group),
      episodeCount: 0,
      seasons: {}
    };

    state.seriesCatalogMap.set(
      info.seriesKey,
      entry
    );
  }

  if (!entry.logo && item.logo) {
    entry.logo = item.logo;
  }

  if (info.season !== null && info.season !== undefined) {
    const season = String(Number(info.season));

    entry.seasons[season] =
      Number(entry.seasons[season] || 0) + 1;
  }

  entry.episodeCount++;

  state.seriesCatalogChanged.add(info.seriesKey);
}

function takeSeriesCatalogUpdates() {
  if (!state.seriesCatalogChanged.size) {
    return [];
  }

  const updates = [];

  for (const key of state.seriesCatalogChanged) {
    const entry = state.seriesCatalogMap.get(key);

    if (!entry) continue;

    updates.push({
      ...entry,
      seasons: {
        ...entry.seasons
      }
    });
  }

  state.seriesCatalogChanged.clear();

  return updates;
}

/* =========================================================
   BANCO — CONSULTAS
   ========================================================= */

function getItem(id) {
  return new Promise((resolve, reject) => {
    const transaction =
      state.db.transaction(
        STORE_NAME,
        "readonly"
      );

    const store =
      transaction.objectStore(STORE_NAME);

    const request = store.get(id);

    request.onsuccess = () => {
      resolve(request.result || null);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

function countAllItems() {
  return new Promise((resolve, reject) => {
    const transaction =
      state.db.transaction(
        STORE_NAME,
        "readonly"
      );

    const store =
      transaction.objectStore(STORE_NAME);

    const request = store.count();

    request.onsuccess = () => {
      resolve(request.result || 0);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

function countByType(type) {
  return new Promise((resolve, reject) => {
    const transaction =
      state.db.transaction(
        STORE_NAME,
        "readonly"
      );

    const store =
      transaction.objectStore(STORE_NAME);

    const index =
      store.index("type");

    const request =
      index.count(
        IDBKeyRange.only(type)
      );

    request.onsuccess = () => {
      resolve(request.result || 0);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/* =========================================================
   CARREGAR AMOSTRA DO BANCO
   ========================================================= */

function loadSample(limit = RAM_LIMIT) {
  return new Promise((resolve, reject) => {
    const result = [];

    const transaction =
      state.db.transaction(
        STORE_NAME,
        "readonly"
      );

    const store =
      transaction.objectStore(STORE_NAME);

    const request =
      store.openCursor();

    request.onsuccess = event => {
      const cursor = event.target.result;

      if (!cursor) {
        resolve(result);
        return;
      }

      result.push(cursor.value);

      if (result.length >= limit) {
        resolve(result);
        return;
      }

      cursor.continue();
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/* =========================================================
   CONSULTA DE ITENS
   ========================================================= */

function queryItems({
  type = null,
  group = null,
  limit = 120
} = {}) {
  return new Promise((resolve, reject) => {
    const result = [];

    const transaction =
      state.db.transaction(
        STORE_NAME,
        "readonly"
      );

    const store =
      transaction.objectStore(STORE_NAME);

    let source = store;

    if (type) {
      source = store.index("type");
    }

    const request = type
      ? source.openCursor(
          IDBKeyRange.only(type)
        )
      : source.openCursor();

    request.onsuccess = event => {
      const cursor = event.target.result;

      if (!cursor) {
        resolve(result);
        return;
      }

      const item = cursor.value;

      if (
        (!group || item.group === group)
      ) {
        result.push(item);
      }

      if (result.length >= limit) {
        resolve(result);
        return;
      }

      cursor.continue();
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/* =========================================================
   GRUPOS
   ========================================================= */

function getGroups() {
  return new Promise((resolve, reject) => {
    const groups = new Set();

    const transaction =
      state.db.transaction(
        STORE_NAME,
        "readonly"
      );

    const store =
      transaction.objectStore(STORE_NAME);

    const request =
      store.openCursor();

    request.onsuccess = event => {
      const cursor = event.target.result;

      if (!cursor) {
        resolve(
          Array.from(groups).sort(
            (a, b) =>
              a.localeCompare(
                b,
                "pt-BR",
                { sensitivity: "base" }
              )
          )
        );

        return;
      }

      const group =
        String(cursor.value.group || "").trim();

      if (group) {
        groups.add(group);
      }

      cursor.continue();
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/* =========================================================
   HASH DETERMINÍSTICO
   ========================================================= */

function hashString(value) {
  let hash = 2166136261;

  const text = String(value || "");

  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);

    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }

  return (
    hash >>> 0
  ).toString(16);
}

/* =========================================================
   CLASSIFICAÇÃO
   ========================================================= */

function getXtreamPathType(url) {
  try {
    const path = new URL(String(url || "")).pathname.toLowerCase();

    if (/(?:^|\/)series(?:\/|$)/.test(path)) return "series";
    if (/(?:^|\/)movie(?:s)?(?:\/|$)/.test(path)) return "movie";
    if (/(?:^|\/)live(?:\/|$)/.test(path)) return "live";
  } catch {}

  return null;
}

function classifyItem(name, group, url) {
  const nameText = normalizeText(name);
  const groupText = normalizeText(group);
  const lowerUrl = String(url || "").toLowerCase();

  /*
     Em playlists Xtream/M3U Plus, o caminho da própria URL é
     a fonte mais confiável: /live/, /movie/ e /series/.
     Isso tem prioridade sobre nomes e grupos mistos. */
  const pathType = getXtreamPathType(url);

  if (pathType) {
    return pathType;
  }

  /*
     A classificação precisa ser EXCLUSIVA.
     Não podemos usar apenas "serie" ou "filme" em qualquer
     parte do texto, porque grupos como "CANAIS | FILMES & SERIES"
     são canais, não séries.
  */

  const explicitSeries =
    /\/series\//i.test(lowerUrl) ||
    /\b(?:s|season|t|temporada)\s*0*\d{1,3}\s*(?:e|ep|episode|episodio)\s*0*\d{1,4}\b/i.test(nameText) ||
    /\b0*\d{1,3}\s*x\s*0*\d{1,4}\b/i.test(nameText) ||
    /\b(?:s|season|t|temporada)\s*0*\d{1,3}\s*(?:e|ep|episode|episodio)\s*0*\d{1,4}\b/i.test(lowerUrl);

  if (explicitSeries) {
    return "series";
  }

  const groupHead = groupText
    .split(/[|>:/\\]+/)[0]
    .trim();

  const groupIsSeries =
    /^(?:serie|series|série|séries)\b/i.test(groupHead);

  const groupIsMovie =
    /^(?:filme|filmes|movie|movies|vod)\b/i.test(groupHead);

  if (groupIsSeries) {
    return "series";
  }

  if (
    /\/movie(?:s)?\//i.test(lowerUrl) ||
    groupIsMovie
  ) {
    return "movie";
  }

  /*
     Alguns provedores usam grupos como:
     "FILMES | AÇÃO", "MOVIES | NETFLIX" ou
     "SÉRIES | DRAMA". Aceitamos esses grupos somente
     quando não são uma categoria mista de canais.
  */
  const groupHasMovie =
    /\b(?:filme|filmes|movie|movies|vod)\b/i.test(groupText);

  const groupHasSeries =
    /\b(?:serie|series|série|séries|season|temporada)\b/i.test(groupText);

  const groupHasLive =
    /\b(?:canais?|canal|tv|ao vivo|live|iptv)\b/i.test(groupText);

  if (groupHasMovie && !groupHasSeries && !groupHasLive) {
    return "movie";
  }

  if (groupHasSeries && !groupHasMovie && !groupHasLive) {
    return "series";
  }

  /*
     Alguns provedores usam [FILME], FILME: ou MOVIE:
     no próprio nome. Só aceitamos esses formatos explícitos,
     nunca uma palavra "filme" perdida no grupo.
  */
  if (
    /^(?:filme|movie)\s*[:\-]|\[(?:filme|movie)\]/i.test(nameText)
  ) {
    return "movie";
  }

  return "live";
}

/* =========================================================
   NORMALIZAÇÃO DO TÍTULO DA SÉRIE
   ========================================================= */

function canonicalSeriesTitle(value) {
  let title = String(value || "").trim();

  title = title
    .replace(/\s*[-|:_./()\[\]]*\s*(?:s|season|t|temporada)\s*0*\d{1,3}\s*(?:[-_.:/ ]*?)?(?:e|ep|episode|episodio)\s*0*\d{1,4}.*$/i, "")
    .replace(/\s*[-|:_./()\[\]]*\s*0*\d{1,3}\s*x\s*0*\d{1,4}.*$/i, "")
    .replace(/\s*[-|:_./()\[\]]*\s*(?:season|temporada)\s*0*\d{1,3}.*$/i, "")
    .replace(/\s*[-|:_./()\[\]]*\s*(?:s|t)\s*0*\d{1,3}\s*$/i, "")
    .replace(/\s*[-|:_./()\[\]]*\s*(?:episode|episodio|ep)\s*0*\d{1,4}.*$/i, "")
    .replace(/\s*[-|:_./()\[\]]*\s*e\s*0*\d{1,4}\s*$/i, "")
    .replace(/\s*[-_.:#|]+\s*$/g, "")
    .trim();

  return title || "Série sem nome";
}

/* =========================================================
   INFORMAÇÕES DE SÉRIE
   ========================================================= */

function extractSeriesInfo(item) {
  const name = String(item?.name || "").trim();
  const tvgName = String(item?.tvgName || "").trim();
  const group = String(item?.group || "").trim();
  const url = String(item?.url || "");

  /*
     Mantemos o nome original para descobrir temporada/episódio.
     Não usamos normalizeText() aqui porque queremos preservar
     separadores e números exatamente como vieram.
  */
  const sources = [name, tvgName, group, url];

  let season = null;
  let episode = null;

  const patterns = [
    /\b(?:s|t)\s*0*(\d{1,3})\s*e\s*0*(\d{1,4})\b/i,
    /\b(?:season|temporada)\s*0*(\d{1,3})\s*(?:e|ep|episode|episodio)\s*0*(\d{1,4})\b/i,
    /\b0*(\d{1,3})\s*x\s*0*(\d{1,4})\b/i,
    /(?:^|[\s._()[\]-])(?:s|season|t|temporada)\s*0*(\d{1,3})\s*(?:[-_.:/ ]*?)?(?:e|ep|episode|episodio)\s*0*(\d{1,4})(?=$|[\s._()[\]-])/i,
    /(?:^|[\s._()[\]-])0*(\d{1,3})\s*x\s*0*(\d{1,4})(?=$|[\s._()[\]-])/i,
    /(?:season|temporada)\s*0*(\d{1,3})[^0-9]{0,15}(?:episode|episodio|ep)\s*0*(\d{1,4})/i,
    /[\\/]season[\\/_-]?0*(\d{1,3})[\\/_-](?:episode|ep)[\\/_-]?0*(\d{1,4})/i,
    /[\\/]s0*(\d{1,3})[\\/_-]e0*(\d{1,4})/i
  ];

  for (const source of sources) {
    for (const pattern of patterns) {
      const match = source.match(pattern);

      if (match) {
        season = Number(match[1]);
        episode = Number(match[2]);
        break;
      }
    }

    if (season !== null && episode !== null) break;
  }

  /*
     Alguns provedores colocam temporada/episódio apenas
     na URL ou em parâmetros.
  */
  if (season === null) {
    const seasonMatch =
      url.match(/[?&](?:season|temporada|s|t)=0*(\d+)/i) ||
      url.match(/[\\/](?:season|temporada|s|t)[\\/_-]?0*(\d+)/i);

    if (seasonMatch) {
      season = Number(seasonMatch[1]);
    }
  }

  if (episode === null) {
    const episodeMatch =
      url.match(/[?&](?:episode|episodio|ep|e)=0*(\d+)/i) ||
      url.match(/[\\/](?:episode|episodio|ep|e)[\\/_-]?0*(\d+)/i);

    if (episodeMatch) {
      episode = Number(episodeMatch[1]);
    }
  }

  /*
     Muitos provedores informam somente S01/T01 no nome
     e colocam o episódio em outro campo ou na URL.
     Mesmo sem o episódio, a temporada precisa ser reconhecida
     para que todos os episódios compartilhem a mesma série.
  */
  if (season === null) {
    /*
       Algumas listas trazem apenas o número do episódio
       ou um padrão incompleto. Para séries sem temporada
       explícita, agrupamos esses episódios como Temporada 1.
    */
    if (episode !== null) {
      season = 1;
    }
  }

  if (season === null) {
    for (const source of sources) {
      const seasonOnly =
        source.match(/(?:^|[\s._()[\]-])(?:s|season|t|temporada)\s*0*(\d{1,3})(?=$|[\s._()[\]-])/i) ||
        source.match(/[\\/](?:season|temporada|s|t)[\\/_-]?0*(\d{1,3})(?=[\\/_-]|$)/i);

      if (seasonOnly) {
        season = Number(seasonOnly[1]);
        break;
      }
    }
  }

  let seriesName = tvgName || name;

  /*
     Se o grupo já contém o nome da série + temporada,
     aproveitamos o nome antes de "Temporada/S01".
  */
  const groupClean = group
    .replace(/^\s*(?:series?|séries?)\s*[-|:/\\>]+\s*/i, "")
    .trim();

  const groupSeries = groupClean.match(
    /^(.*?)\s*(?:[-|:/\\>]+\s*)?(?:temporada|season|s|t)\s*0*\d+/i
  );

  if (groupSeries?.[1]?.trim()) {
    seriesName = groupSeries[1].trim();
  }

  /*
     Remove o identificador de episódio/temporada do nome.
     Isso é o ponto principal: todos os episódios passam a ter
     o mesmo seriesKey.
  */
  seriesName = seriesName
    .replace(
      /\s*[-|:_./()\[\]]*\s*(?:s|season|t|temporada)\s*0*\d{1,3}\s*[-_.:/ ]*\s*(?:e|ep|episode|episodio)\s*0*\d{1,4}.*$/i,
      ""
    )
    .replace(
      /\s*[-|:_./()\[\]]*\s*0*\d{1,3}\s*x\s*0*\d{1,4}.*$/i,
      ""
    )
    .replace(
      /\s*[-|:_./()\[\]]*\s*(?:season|temporada)\s*0*\d{1,3}.*$/i,
      ""
    )
    /*
       Remove também S01/T01 isolado.
       Isso corrige listas que usam nomes como:
       "A Pequena Sereia S01", "A Pequena Sereia - S01",
       "A Pequena Sereia T01" etc.
    */
    .replace(
      /\s*[-|:_./()\[\]]*\s*(?:s|t)\s*0*\d{1,3}\s*$/i,
      ""
    )
    .replace(
      /\s*[-|:_./()\[\]]*\s*(?:episode|episodio|ep)\s*0*\d{1,4}.*$/i,
      ""
    )
    .trim();

  if (!seriesName) {
    seriesName = groupClean || name || "Série sem nome";
  }

  seriesName = canonicalSeriesTitle(seriesName);

  return {
    seriesName,
    seriesKey: normalizeText(seriesName),
    season,
    episode,
    genre: getGenreName(group)
  };
}

/* =========================================================
   NORMALIZA ITEM
   ========================================================= */

function normalizeItem(data) {
  const name =
    String(data.name || "Sem nome").trim();

  const group =
    String(data.group || "Sem categoria").trim();

  const url =
    String(data.url || "").trim();

  const type =
    data.type ||
    classifyItem(
      name,
      group,
      url
    );

  const id =
    data.id ||
    hashString(
      `${name}|${group}|${url}`
    );

  return {
    id,

    name,

    nameLower:
      normalizeText(name),

    group,

    type,

    url,

    logo:
      data.logo || "",

    tvgId:
      data.tvgId || "",

    tvgName:
      data.tvgName || "",

    country:
      data.country || "",

    language:
      data.language || "",

    ...(type === "series"
      ? (() => {
          const info = extractSeriesInfo({
            name,
            group,
            url,
            tvgName: data.tvgName || ""
          });
          return {
            seriesName: info.seriesName,
            seriesKey: info.seriesKey,
            season: info.season,
            episode: info.episode,
            seriesSeason: [info.seriesKey, Number(info.season ?? 0)],
            genre: info.genre
          };
        })()
      : {
          seriesName: "",
          seriesKey: "",
          season: null,
          episode: null,
          seriesSeason: ["", 0],
          genre: ""
        })
  };
}
/* =========================================================
   CORREÇÃO DO CATÁLOGO ANTIGO — TIPOS EXCLUSIVOS
   ========================================================= */

async function migrateCatalogTypes() {
  if (!state.db) return 0;

  const migrationKey =
    "GC_PLAY_PRO_CATEGORY_TYPES_V4";

  try {
    if (localStorage.getItem(migrationKey) === "1") {
      return 0;
    }
  } catch {}

  return new Promise((resolve, reject) => {
    let changed = 0;

    const storeNames =
      state.db.objectStoreNames.contains(SERIES_STORE)
        ? [STORE_NAME, SERIES_STORE]
        : [STORE_NAME];

    const transaction =
      state.db.transaction(storeNames, "readwrite");

    const store =
      transaction.objectStore(STORE_NAME);

    if (storeNames.includes(SERIES_STORE)) {
      /*
         O catálogo de séries antigo foi criado com a regra
         incorreta. Ele será reconstruído usando item.type.
      */
      transaction.objectStore(SERIES_STORE).clear();
    }

    const request =
      store.openCursor();

    request.onsuccess = event => {
      const cursor = event.target.result;

      if (!cursor) {
        return;
      }

      const item = cursor.value;
      const newType = classifyItem(
        item.name,
        item.group,
        item.url
      );

      if (item.type !== newType) {
        item.type = newType;
        cursor.update(item);
        changed++;
      }

      cursor.continue();
    };

    request.onerror = () => {
      reject(request.error);
    };

    transaction.oncomplete = () => {
      try {
        localStorage.setItem(migrationKey, "1");

        /*
           Obriga a reconstrução do catálogo de séries depois
           da correção dos tipos.
        */
        localStorage.removeItem(
          "GC_PLAY_PRO_SERIES_MIGRATION_V3"
        );
        localStorage.removeItem(
          "GC_PLAY_PRO_SERIES_MIGRATION_V2"
        );
      } catch {}

      state.seriesCatalog = [];
      state.seriesCatalogMap = new Map();
      state.seriesCatalogReady = false;

      console.log(
        "[GC PLAY PRO] Tipos corrigidos:",
        changed
      );

      resolve(changed);
    };

    transaction.onerror = () => {
      reject(transaction.error);
    };

    transaction.onabort = () => {
      reject(transaction.error);
    };
  });
}

/* =========================================================
   PROXY M3U
   ========================================================= */

function shouldUseProxy(url) {
  try {
    const parsed = new URL(url);

    /*
       Qualquer URL HTTP/HTTPS pode passar pelo proxy.
       Isso permite usar playlists de domínios diferentes
       sem precisar cadastrar cada servidor manualmente.
    */
    return (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:"
    );
  } catch {
    return false;
  }
}

function buildProxyUrl(url) {
  return (
    `${GC_M3U_PROXY}?url=` +
    encodeURIComponent(url)
  );
}

function resolvePlaylistUrl(url) {
  if (shouldUseProxy(url)) {
    return buildProxyUrl(url);
  }

  return url;
}

/* =========================================================
   MOTOR XTREAM FAST — CATÁLOGO ESTRUTURADO
   ========================================================= */

function parseXtreamLogin(url) {
  try {
    const parsed = new URL(String(url || ""));
    const path = parsed.pathname.toLowerCase();

    if (!/(?:^|\/)get\.php$/.test(path) && !/(?:^|\/)player_api\.php$/.test(path)) return null;

    const username = parsed.searchParams.get("username") || "";
    const password = parsed.searchParams.get("password") || "";
    if (!username || !password) return null;

    const base = new URL(".", parsed).toString().replace(/\/$/, "");
    return { base, username, password };
  } catch {
    return null;
  }
}

function xtreamApiUrl(session, action = "") {
  const api = new URL(session.base + "/player_api.php");
  api.searchParams.set("username", session.username);
  api.searchParams.set("password", session.password);
  if (action) api.searchParams.set("action", action);
  return api.toString();
}

function unwrapXtreamArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];

  for (const key of ["data","streams","items","results","series","categories","vods"]) {
    if (Array.isArray(value[key])) return value[key];
  }

  return [];
}

async function fetchXtreamJSON(session, action, signal, extraParams = {}) {
  const url = new URL(xtreamApiUrl(session, action));

  for (const [key, value] of Object.entries(extraParams || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(buildProxyUrl(url.toString()), {
    method: "GET",
    cache: "no-store",
    signal,
    headers: { "Accept": "application/json" }
  });

  if (!response.ok) {
    throw new Error("Xtream API HTTP " + response.status);
  }

  const data = await response.json();

  if (data && typeof data === "object" && data.user_info && data.user_info.auth === 0) {
    throw new Error("Conta Xtream recusada pelo servidor.");
  }

  return data;
}

function decodeBase64Text(value) {
  if (!value) return "";
  try {
    const binary = atob(String(value));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return String(value);
  }
}

async function loadLiveEPG(item) {
  const container = $("#playerEPG");
  if (!container) return;

  if (!item || item.type !== "live" || !state.xtreamSession || !item.xtreamStreamId) {
    container.innerHTML = "";
    container.classList.remove("show");
    return;
  }

  container.classList.add("show");
  container.innerHTML = '<div class="gc-epg-loading">CARREGANDO PROGRAMAÇÃO...</div>';

  try {
    const data = await fetchXtreamJSON(
      state.xtreamSession,
      "get_short_epg",
      undefined,
      {
        stream_id: item.xtreamStreamId,
        limit: 6
      }
    );

    const entries = Array.isArray(data?.epg_listings)
      ? data.epg_listings
      : [];

    if (!entries.length) {
      container.innerHTML = '<div class="gc-epg-empty">EPG não disponível para este canal.</div>';
      return;
    }

    container.innerHTML = entries.map((entry, index) => {
      const title = decodeBase64Text(entry.title) || "Programação";
      const description = decodeBase64Text(entry.description);
      const start = entry.start || "";
      const end = entry.end || "";
      const now = Number(entry.now_playing) === 1 || index === 0;

      return `
        <div class="gc-epg-item ${now ? "active" : ""}">
          <div class="gc-epg-time">${escapeHTML(start.slice(11,16))} — ${escapeHTML(end.slice(11,16))}</div>
          <div class="gc-epg-title">${escapeHTML(title)}</div>
          ${description ? `<div class="gc-epg-desc">${escapeHTML(description)}</div>` : ""}
        </div>
      `;
    }).join("");
  } catch (error) {
    console.warn("[GC PLAY PRO] EPG:", error);
    container.innerHTML = '<div class="gc-epg-empty">Não foi possível carregar o EPG.</div>';
  }
}

function buildXtreamStreamUrl(session, kind, streamId, extension = "ts") {
  const safeId = encodeURIComponent(String(streamId || ""));
  const safeUser = encodeURIComponent(session.username);
  const safePass = encodeURIComponent(session.password);
  const folder = kind === "movie" ? "movie" : kind === "series" ? "series" : "live";
  const ext = String(extension || "ts").replace(/^\./, "").toLowerCase();

  return session.base + "/" + folder + "/" + safeUser + "/" + safePass + "/" + safeId + "." + ext;
}

function getXtreamCategoryName(map, id, fallback = "OUTROS") {
  return map.get(String(id ?? "")) || fallback;
}

async function tryLoadXtreamFast(url, signal) {
  const session = parseXtreamLogin(url);
  if (!session) return null;

  try {
    updateLoadMessage("Detectando conexão Xtream...");

    const results = await Promise.allSettled([
      fetchXtreamJSON(session, "", signal),
      fetchXtreamJSON(session, "get_live_categories", signal),
      fetchXtreamJSON(session, "get_vod_categories", signal),
      fetchXtreamJSON(session, "get_series_categories", signal),
      fetchXtreamJSON(session, "get_live_streams", signal),
      fetchXtreamJSON(session, "get_vod_streams", signal),
      fetchXtreamJSON(session, "get_series", signal)
    ]);

    if (signal?.aborted) throw new DOMException("Operação cancelada", "AbortError");

    const authData = results[0].status === "fulfilled" ? results[0].value : null;
    const userInfo = authData?.user_info || {};

    if (Object.keys(userInfo).length && String(userInfo.auth ?? "1") === "0") {
      throw new Error("Usuário ou senha Xtream inválidos.");
    }

    const live = results[4].status === "fulfilled" ? unwrapXtreamArray(results[4].value) : [];
    const movies = results[5].status === "fulfilled" ? unwrapXtreamArray(results[5].value) : [];
    const series = results[6].status === "fulfilled" ? unwrapXtreamArray(results[6].value) : [];

    if (!live.length && !movies.length && !series.length) return null;

    const liveCategories = new Map();
    const movieCategories = new Map();
    const seriesCategories = new Map();

    if (results[1].status === "fulfilled") {
      for (const cat of unwrapXtreamArray(results[1].value)) {
        if (cat?.category_id != null && cat?.category_name) {
          liveCategories.set(String(cat.category_id), String(cat.category_name));
        }
      }
    }

    if (results[2].status === "fulfilled") {
      for (const cat of unwrapXtreamArray(results[2].value)) {
        if (cat?.category_id != null && cat?.category_name) {
          movieCategories.set(String(cat.category_id), String(cat.category_name));
        }
      }
    }

    if (results[3].status === "fulfilled") {
      for (const cat of unwrapXtreamArray(results[3].value)) {
        if (cat?.category_id != null && cat?.category_name) {
          seriesCategories.set(String(cat.category_id), String(cat.category_name));
        }
      }
    }

    const allowed = Array.isArray(userInfo.allowed_output_formats)
      ? userInfo.allowed_output_formats.map(v => String(v).toLowerCase())
      : [];

    const liveExtension = allowed.includes("m3u8")
      ? "m3u8"
      : allowed.includes("ts")
        ? "ts"
        : "ts";
    const items = [];
    const seriesCatalog = [];
    const groups = new Set();

    for (const row of live) {
      const id = row?.stream_id ?? row?.id;
      if (id == null || !row?.name) continue;

      const group = getXtreamCategoryName(liveCategories, row.category_id, "TV AO VIVO");

      const item = {
        id: "xt-live-" + id,
        name: String(row.name).trim(),
        nameLower: normalizeText(row.name),
        group,
        type: "live",
        url: buildXtreamStreamUrl(session, "live", id, liveExtension),
        logo: row.stream_icon || "",
        tvgId: row.epg_channel_id || "",
        tvgName: row.name || "",
        country: "",
        language: "",
        seriesName: "",
        seriesKey: "",
        season: null,
        episode: null,
        seriesSeason: ["", 0],
        genre: getGenreName(group),
        xtreamKind: "live",
        xtreamStreamId: String(id),
        xtreamExtension: liveExtension,
        epgChannelId: row.epg_channel_id || "",
        tvArchive: Number(row.tv_archive || 0),
        tvArchiveDuration: Number(row.tv_archive_duration || 0)
      };

      items.push(item);
      groups.add(group);
    }

    for (const row of movies) {
      const id = row?.stream_id ?? row?.id;
      if (id == null || !row?.name) continue;

      const group = getXtreamCategoryName(movieCategories, row.category_id, "FILMES");
      const extension = String(row.container_extension || "mp4").replace(/^\./, "").toLowerCase();

      const item = {
        id: "xt-movie-" + id,
        name: String(row.name).trim(),
        nameLower: normalizeText(row.name),
        group,
        type: "movie",
        url: buildXtreamStreamUrl(session, "movie", id, extension),
        logo: row.stream_icon || "",
        tvgId: "",
        tvgName: "",
        country: "",
        language: "",
        seriesName: "",
        seriesKey: "",
        season: null,
        episode: null,
        seriesSeason: ["", 0],
        genre: getGenreName(group),
        xtreamKind: "movie",
        xtreamStreamId: String(id),
        xtreamExtension: extension,
        rating: row.rating ?? null
      };

      items.push(item);
      groups.add(group);
    }

    for (const row of series) {
      const id = row?.series_id ?? row?.id;
      if (id == null || !row?.name) continue;

      const title = String(row.name).trim();
      const key = normalizeText(title);
      const group = getXtreamCategoryName(seriesCategories, row.category_id, row.genre || "SÉRIES");

      const item = {
        id: "xt-series-" + id,
        name: title,
        nameLower: key,
        group,
        type: "series",
        url: "",
        logo: row.cover || row.stream_icon || "",
        tvgId: "",
        tvgName: title,
        country: "",
        language: "",
        seriesName: title,
        seriesKey: key,
        season: null,
        episode: null,
        seriesSeason: ["", 0],
        genre: row.genre || getGenreName(group),
        xtreamKind: "series",
        xtreamSeriesId: String(id),
        plot: row.plot || "",
        cast: row.cast || "",
        director: row.director || "",
        rating: row.rating ?? null,
        releaseDate: row.releaseDate || row.release_date || "",
        backdrop: Array.isArray(row.backdrop_path) ? (row.backdrop_path[0] || "") : "",
        youtubeTrailer: row.youtube_trailer || "",
        episodeRunTime: row.episode_run_time || ""
      };

      items.push(item);
      seriesCatalog.push({
        ...item,
        episodeCount: 0,
        seasons: {},
        xtreamSeriesId: String(id)
      });
      groups.add(group);
    }

    if (!items.length) return null;

    return {
      session: { ...session, liveExtension },
      userInfo,
      items,
      seriesCatalog,
      groups: Array.from(groups),
      counts: {
        live: live.length,
        movie: movies.length,
        series: series.length
      }
    };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    console.warn("[GC PLAY PRO] Xtream Fast indisponível; usando M3U:", error);
    return null;
  }
}

async function fetchXtreamSeriesEpisodes(seriesItem, season, signal) {
  const session = state.xtreamSession;
  const seriesId = seriesItem?.xtreamSeriesId;
  if (!session || !seriesId) return [];

  const data = await fetchXtreamJSON(session, "get_series_info", signal, { series_id: seriesId });
  const episodesObject = data?.episodes || {};
  const result = [];

  for (const [seasonKey, list] of Object.entries(episodesObject)) {
    if (!Array.isArray(list)) continue;

    for (const episode of list) {
      const seasonNumber = Number(episode.season ?? seasonKey ?? 1);
      if (season !== null && Number(seasonNumber) !== Number(season)) continue;

      const episodeId = episode?.id;
      if (episodeId == null) continue;

      const title =
        episode.title ||
        episode.info?.name ||
        (seriesItem.seriesName + " S" + String(seasonNumber).padStart(2,"0") +
         "E" + String(episode.episode_num || 0).padStart(2,"0"));

      result.push({
        id: "xt-episode-" + seriesId + "-" + episodeId,
        name: String(title).trim(),
        nameLower: normalizeText(title),
        group: seriesItem.group || "SÉRIES",
        type: "series",
        url: buildXtreamStreamUrl(session, "series", episodeId, episode.container_extension || "mp4"),
        logo: episode.info?.movie_image || seriesItem.logo || "",
        tvgId: "",
        tvgName: title,
        country: "",
        language: "",
        seriesName: seriesItem.seriesName,
        seriesKey: seriesItem.seriesKey,
        season: seasonNumber,
        episode: Number(episode.episode_num || 0),
        seriesSeason: [seriesItem.seriesKey, seasonNumber],
        genre: seriesItem.genre || getGenreName(seriesItem.group),
        xtreamKind: "episode",
        xtreamSeriesId: String(seriesId),
        xtreamEpisodeId: String(episodeId),
        xtreamExtension: episode.container_extension || "mp4",
        plot: episode.info?.plot || "",
        duration: episode.info?.duration || "",
        durationSecs: Number(episode.info?.duration_secs || 0),
        rating: episode.info?.rating ?? null
      });
    }
  }

  result.sort((a,b) =>
    Number(a.season || 0) - Number(b.season || 0) ||
    Number(a.episode || 0) - Number(b.episode || 0)
  );

  return result;
}

/* =========================================================
   FETCH COM ABORT
   ========================================================= */

async function fetchPlaylist(url, signal) {
  const finalUrl = resolvePlaylistUrl(url);

  /*
     O fetch da playlist precisa ter timeout apenas para a fase
     de conexão/recebimento dos headers. Depois que os headers
     chegam, o stream pode continuar por quanto tempo for necessário.
  */
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort();
  }, 60000);

  const onAbort = () => timeoutController.abort();

  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId);
      throw new DOMException("Operação cancelada", "AbortError");
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }

  let response;

  try {
    response = await fetch(finalUrl, {
      method: "GET",
      signal: timeoutController.signal,
      headers: {
        "Accept":
          "application/vnd.apple.mpegurl," +
          "audio/x-mpegurl," +
          "text/plain," +
          "application/x-mpegURL," +
          "*/*"
      },
      cache: "no-store",
      redirect: "follow"
    });
  } catch (error) {
    if (signal?.aborted) {
      throw new DOMException("Operação cancelada", "AbortError");
    }

    if (error?.name === "AbortError") {
      throw new Error(
        "Tempo limite excedido ao conectar à playlist/proxy (60s)."
      );
    }

    throw new Error(
      `Falha de conexão com a playlist: ${error?.message || error}`
    );
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onAbort);
  }

  if (!response.ok) {
    let detail = "";

    try {
      const contentType =
        response.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        const data = await response.clone().json();

        if (data?.error) {
          detail = ` — ${data.error}`;
        }

        if (data?.detail) {
          detail += ` — ${data.detail}`;
        }

        if (data?.host) {
          detail += ` (${data.host})`;
        }

        if (data?.status) {
          detail += ` [origem HTTP ${data.status}]`;
        }
      } else {
        const text = (await response.clone().text()).slice(0, 300).trim();
        if (text) detail = ` — ${text}`;
      }
    } catch {}

    throw new Error(
      `Servidor respondeu HTTP ${response.status}${detail}`
    );
  }

  if (!response.body) {
    throw new Error(
      "O servidor não retornou um fluxo de dados."
    );
  }

  const contentType =
    response.headers.get("content-type") || "";

  if (/text\/html/i.test(contentType)) {
    throw new Error(
      "A origem retornou uma página HTML em vez de uma playlist M3U."
    );
  }

  return response;
}

/* =========================================================
   PARSER M3U PROGRESSIVO
   ========================================================= */

async function* parseM3UStream(
  response,
  signal
) {
  const reader =
    response.body.getReader();

  const decoder =
    new TextDecoder("utf-8");

  let buffer = "";

  let currentInfo = null;

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException(
          "Operação cancelada",
          "AbortError"
        );
      }

      const {
        value,
        done
      } = await reader.read();

      if (done) {
        break;
      }

      buffer +=
        decoder.decode(
          value,
          { stream: true }
        );

      const lines =
        buffer.split(/\r?\n/);

      buffer =
        lines.pop() || "";

      for (const rawLine of lines) {
        const line =
          rawLine.trim();

        if (!line) {
          continue;
        }

        if (
          line.startsWith("#EXTINF:")
        ) {
          currentInfo =
            parseEXTINF(line);

          continue;
        }

        if (
          line.startsWith("#")
        ) {
          continue;
        }

        if (!currentInfo) {
          continue;
        }

        const item =
          normalizeItem({
            ...currentInfo,
            url: line
          });

        currentInfo = null;

        yield item;
      }
    }

    buffer +=
      decoder.decode();

    const lastLines =
      buffer.split(/\r?\n/);

    for (const rawLine of lastLines) {
      const line =
        rawLine.trim();

      if (!line) {
        continue;
      }

      if (
        line.startsWith("#EXTINF:")
      ) {
        currentInfo =
          parseEXTINF(line);

        continue;
      }

      if (
        line.startsWith("#")
      ) {
        continue;
      }

      if (
        currentInfo
      ) {
        const item =
          normalizeItem({
            ...currentInfo,
            url: line
          });

        currentInfo = null;

        yield item;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

/* =========================================================
   PARSER EXTINF
   ========================================================= */

function parseEXTINF(line) {
  const colonIndex = line.indexOf(":");
  const content = colonIndex >= 0 ? line.slice(colonIndex + 1) : line;
  const commaIndex = findNameSeparator(content);
  const attributes = commaIndex >= 0 ? content.slice(0, commaIndex) : content;
  const name = commaIndex >= 0 ? content.slice(commaIndex + 1).trim() : "Sem nome";

  const attrs = Object.create(null);
  const attrRegex = /([A-Za-z0-9_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s]+))/g;
  let match;
  while ((match = attrRegex.exec(attributes)) !== null) {
    attrs[match[1].toLowerCase()] = (match[3] ?? match[4] ?? match[5] ?? "").trim();
  }

  return {
    name: name || "Sem nome",
    group: attrs["group-title"] || attrs.group || "Sem categoria",
    logo: attrs["tvg-logo"] || attrs.logo || "",
    tvgId: attrs["tvg-id"] || "",
    tvgName: attrs["tvg-name"] || "",
    country: attrs["tvg-country"] || attrs.country || "",
    language: attrs["tvg-language"] || attrs.language || ""
  };
}

/* =========================================================
   LOCALIZAR VÍRGULA DO NOME
   ========================================================= */

function findNameSeparator(text) {
  let quote = null;

  for (
    let i = 0;
    i < text.length;
    i++
  ) {
    const char =
      text[i];

    if (
      char === '"' ||
      char === "'"
    ) {
      if (!quote) {
        quote = char;
      } else if (
        quote === char
      ) {
        quote = null;
      }

      continue;
    }

    if (
      char === "," &&
      !quote
    ) {
      return i;
    }
  }

  return -1;
}

/* =========================================================
   LER ATRIBUTO EXTINF
   ========================================================= */

function getAttribute(
  text,
  names
) {
  for (const name of names) {
    const escaped =
      name.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

    const regex =
      new RegExp(
        `${escaped}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s]+))`,
        "i"
      );

    const match =
      text.match(regex);

    if (match) {
      return (
        match[2] ??
        match[3] ??
        match[4] ??
        ""
      ).trim();
    }
  }

  return "";
}

/* =========================================================
   CSS DINÂMICO
   ========================================================= */

function ensureCSS() {
  if (
    document.getElementById(
      "gc-dynamic-css"
    )
  ) {
    return;
  }

  const style =
    document.createElement("style");

  style.id =
    "gc-dynamic-css";

  style.textContent = `
    .gc-card {
      position: relative;
      overflow: hidden;
      cursor: pointer;
    }

    .gc-card-image {
      width: 100%;
      aspect-ratio: 16 / 9;
      object-fit: cover;
      display: block;
      background: #090d0a;
    }

    .gc-card-placeholder {
      width: 100%;
      aspect-ratio: 16 / 9;
      display: flex;
      align-items: center;
      justify-content: center;
      background:
        linear-gradient(
          135deg,
          #050805,
          #101810
        );
      color: #69ff65;
      font-size: 28px;
      font-weight: 900;
    }

    .gc-card-info {
      padding: 10px;
    }

    .gc-card-title {
      font-weight: 800;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .gc-card-meta {
      opacity: .65;
      font-size: 12px;
      margin-top: 5px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .gc-card-favorite {
      position: absolute;
      right: 8px;
      top: 8px;
      width: 34px;
      height: 34px;
      border: 0;
      border-radius: 50%;
      background: rgba(0,0,0,.75);
      color: #69ff65;
      cursor: pointer;
      z-index: 5;
    }

    .gc-card-favorite.active {
      background: #69ff65;
      color: #050805;
    }

    .gc-results-count {
      opacity: .65;
      font-size: 13px;
      margin: 10px 0;
    }

    .gc-group-select {
      width: 100%;
      max-width: 360px;
      margin: 10px 0 16px;
      padding: 12px;
      border-radius: 10px;
      border: 1px solid rgba(105,255,101,.35);
      background: #080c08;
      color: #fff;
      outline: none;
    }

    .gc-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 30px;
      color: #69ff65;
    }

    .gc-spinner {
      width: 22px;
      height: 22px;
      border: 3px solid rgba(105,255,101,.2);
      border-top-color: #69ff65;
      border-radius: 50%;
      animation:
        gcSpin .8s linear infinite;
    }

    @keyframes gcSpin {
      to {
        transform: rotate(360deg);
      }
    }

    .gc-search-result {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px;
      border-radius: 10px;
      cursor: pointer;
    }

    .gc-search-result:hover {
      background:
        rgba(105,255,101,.08);
    }

    .gc-search-result img,
    .gc-search-logo {
      width: 60px;
      height: 40px;
      object-fit: contain;
      border-radius: 6px;
      background: #050805;
    }

    .gc-search-text {
      min-width: 0;
      flex: 1;
    }

    .gc-search-name {
      font-weight: 800;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .gc-search-meta {
      opacity: .6;
      font-size: 12px;
      margin-top: 4px;
    }

    .gc-progress {
      height: 5px;
      width: 100%;
      background: rgba(255,255,255,.08);
      border-radius: 20px;
      overflow: hidden;
      margin-top: 10px;
    }

    .gc-progress-bar {
      height: 100%;
      width: 0%;
      background: #69ff65;
      transition: width .2s linear;
    }
  `;

  document.head.appendChild(style);
}

/* =========================================================
   RENDER CARD
   ========================================================= */

function renderCard(item) {
  const favorite =
    state.favorites.has(item.id);

  const logo =
    item.logo
      ? `
        <img
          class="gc-card-image"
          src="${escapeHTML(item.logo)}"
          alt=""
          loading="lazy"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"
        >
        <div
          class="gc-card-placeholder"
          style="display:none"
        >
          ${getTypeIcon(item.type)}
        </div>
      `
      : `
        <div class="gc-card-placeholder">
          ${getTypeIcon(item.type)}
        </div>
      `;

  return `
    <article
      class="gc-card"
      data-item-id="${escapeHTML(item.id)}"
    >

      ${logo}

      <button
        class="gc-card-favorite ${
          favorite ? "active" : ""
        }"
        data-favorite-id="${escapeHTML(item.id)}"
        aria-label="Favorito"
      >
        ${favorite ? "★" : "☆"}
      </button>

      <div class="gc-card-info">

        <div class="gc-card-title">
          ${escapeHTML(item.name)}
        </div>

        <div class="gc-card-meta">
          ${escapeHTML(item.group)}
        </div>

      </div>

    </article>
  `;
}

/* =========================================================
   ÍCONES
   ========================================================= */

function getTypeIcon(type) {
  if (type === "movie") {
    return "🎬";
  }

  if (type === "series") {
    return "📺";
  }

  return "▶";
}

/* =========================================================
   HOME DINÂMICA — DASHBOARD REAL
   ========================================================= */

function renderHomeRail(containerId, items, emptyText = "Nenhum conteúdo disponível.") {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = items.length ? items.map(renderCard).join("") : `<div class="gc-home-empty">${escapeHTML(emptyText)}</div>`;
}

async function getHomeSample(type = null, limit = 12) {
  const ram = state.items.filter(item => item && !isAdultContent(item) && (!type || item.type === type));
  if (ram.length) return ram.slice(0, limit);
  try { return await queryCatalogItems({ type, genre: "all", term: "", limit }); }
  catch (error) { console.warn("Home sample:", error); return []; }
}

async function renderHomeDashboard() {
  const dashboard = document.getElementById("homeDashboard");
  const library = document.getElementById("librarySection");
  const empty = document.getElementById("emptyState");
  if (!dashboard) return;
  dashboard.style.display = "block";
  if (library) library.style.display = "none";
  if (empty) empty.style.display = "none";

  if (!state.total && !state.items.length) {
    const featured = document.getElementById("homeFeatured");
    if (featured) featured.innerHTML = `<div class="gc-home-welcome"><span class="section-label">GC PLAY PRO</span><h2>Seu painel está pronto.</h2><p>Adicione uma lista M3U para transformar esta tela em uma central com TV, filmes e séries.</p><button type="button" class="primary-button" data-home-action="add">＋ ADICIONAR LISTA</button></div>`;
    ["homeRecent","homeLive","homeMovies","homeSeries"].forEach(id => renderHomeRail(id, []));
    return;
  }

  const [live, movies, series] = await Promise.all([getHomeSample("live", 12), getHomeSample("movie", 12), getHomeSample("series", 12)]);
  let featuredItem = null;
  for (const id of state.history) { const item = await findItem(id); if (item && !isAdultContent(item)) { featuredItem = item; break; } }
  if (!featuredItem) featuredItem = movies[0] || series[0] || live[0] || null;

  const featured = document.getElementById("homeFeatured");
  if (featured) {
    featured.innerHTML = featuredItem ? `
      ${featuredItem.logo ? `<img class="gc-home-featured-bg" src="${escapeHTML(featuredItem.logo)}" alt="" aria-hidden="true">` : ""}
      <div class="gc-home-featured-overlay"></div>
      <div class="gc-home-featured-content">
        <span class="hero-label"><span class="status-dot"></span> ${escapeHTML(formatType(featuredItem.type))}</span>
        <span class="section-label">EM DESTAQUE</span>
        <h2>${escapeHTML(featuredItem.name)}</h2>
        <p>${escapeHTML(featuredItem.group || "Conteúdo da sua biblioteca")}</p>
        <div class="hero-buttons"><button type="button" class="primary-button" data-home-play="${escapeHTML(featuredItem.id)}">▶ ASSISTIR AGORA</button><button type="button" class="secondary-button" data-home-action="${escapeHTML(featuredItem.type)}">EXPLORAR ${escapeHTML(formatType(featuredItem.type))}</button></div>
      </div>` : `<div class="gc-home-welcome"><h2>Nenhum conteúdo encontrado.</h2></div>`;
  }

  const recent = state.history.length ? (await Promise.all(state.history.slice(0, 12).map(id => findItem(id))).then(list => list.filter(item => item && !isAdultContent(item)))) : [];
  const discovery = recent.length ? recent : [...movies, ...series, ...live].slice(0, 12);
  renderHomeRail("homeRecent", discovery.slice(0, 12), "Nenhum destaque ainda.");
  renderHomeRail("homeLive", live, "Nenhum canal disponível.");
  renderHomeRail("homeMovies", movies, "Nenhum filme disponível.");
  renderHomeRail("homeSeries", series, "Nenhuma série disponível.");
}

function showHomeOrLibrary(showHome) {
  const dashboard = document.getElementById("homeDashboard");
  const library = document.getElementById("librarySection");
  const empty = document.getElementById("emptyState");
  if (dashboard) dashboard.style.display = showHome ? "block" : "none";
  if (library) library.style.display = showHome ? "none" : "";
  if (showHome && empty) empty.style.display = "none";
}

function setupHomeEvents() {
  const dashboard = document.getElementById("homeDashboard");
  if (!dashboard) return;
  dashboard.addEventListener("click", async event => {
    const favoriteButton = event.target.closest("[data-favorite-id]");
    if (favoriteButton) { event.preventDefault(); event.stopPropagation(); toggleFavorite(favoriteButton.dataset.favoriteId); return; }
    const playButton = event.target.closest("[data-home-play]");
    if (playButton) { const item = await findItem(playButton.dataset.homePlay); if (item) await playItem(item); return; }
    const card = event.target.closest("[data-item-id]");
    if (card) { const item = await findItem(card.dataset.itemId); if (item) await playItem(item); return; }
    const action = event.target.closest("[data-home-action]");
    if (!action) return;
    const value = action.dataset.homeAction;
    if (value === "add") { openDialog("playlistDialog"); return; }
    if (value === "all") { state.currentSection="catalog"; state.currentFilter="all"; state.currentGenre="all"; showHomeOrLibrary(false); syncSectionNavigation("home"); renderGenreFilters(); render(); document.getElementById("librarySection")?.scrollIntoView({behavior:"smooth",block:"start"}); return; }
    const sectionMap = { live:"live", movie:"movies", series:"series" };
    if (sectionMap[value]) { state.currentSection=sectionMap[value]; state.currentFilter=value==="movie"?"movie":value; state.currentGenre="all"; state.seriesView.seriesKey=null; state.seriesView.season=null; showHomeOrLibrary(false); syncSectionNavigation(state.currentSection); renderGenreFilters(); render(); document.getElementById("librarySection")?.scrollIntoView({behavior:"smooth",block:"start"}); }
  });
}

/* =========================================================
   RENDER BIBLIOTECA
   ========================================================= */

let renderRequestId = 0;

async function queryCatalogItems({
  type = null,
  genre = "all",
  term = "",
  limit = 120
} = {}) {
  if (!state.db) {
    let fallback = state.items.slice();

    if (type === "adult") {
      fallback = fallback.filter(isAdultContent);
    } else {
      fallback = fallback.filter(item =>
        !isAdultContent(item) &&
        (!type || item.type === type)
      );
    }

    if (genre !== "all") {
      const wanted = normalizeText(genre);
      fallback = fallback.filter(item =>
        normalizeText(getGenreName(item.group)) === wanted
      );
    }

    if (term) {
      const normalized = normalizeText(term);
      fallback = fallback.filter(item =>
        item.nameLower.includes(normalized) ||
        normalizeText(item.group).includes(normalized)
      );
    }

    return fallback.slice(0, limit);
  }

  return new Promise((resolve, reject) => {
    const result = [];
    const transaction = state.db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const useTypeIndex = !!type && type !== "adult";
    const source = useTypeIndex ? store.index("type") : store;
    const request = useTypeIndex
      ? source.openCursor(IDBKeyRange.only(type))
      : source.openCursor();

    request.onsuccess = event => {
      const cursor = event.target.result;

      if (!cursor || result.length >= limit) {
        resolve(result);
        return;
      }

      const item = cursor.value;
      const matchesAdult =
        type === "adult"
          ? isAdultContent(item)
          : !isAdultContent(item);

      const matchesType =
        type === "adult"
          ? true
          : (!type || item.type === type);

      const matchesGenre =
        genre === "all" ||
        normalizeText(getGenreName(item.group)) === normalizeText(genre);

      const matchesTerm =
        !term ||
        item.nameLower.includes(normalizeText(term)) ||
        normalizeText(item.group).includes(normalizeText(term));

      if (matchesAdult && matchesType && matchesGenre && matchesTerm) {
        result.push(item);
      }

      cursor.continue();
    };

    request.onerror = () => reject(request.error);
  });
}

async function render() {
  if (state.currentSection === "home" && state.currentFilter === "all") {
    await renderHomeDashboard();
    return;
  }

  showHomeOrLibrary(false);

  const grid = $("#contentGrid");
  const empty = $("#emptyState");

  if (!grid) return;

  const requestId = ++renderRequestId;

  if (state.currentFilter === "series") {
    grid.innerHTML = `
      <div class="gc-loading">
        <span class="gc-spinner"></span>
        Organizando séries, temporadas e episódios...
      </div>
    `;

    await renderSeriesBrowser(grid, empty);

    if (requestId !== renderRequestId) return;
    return;
  }

  const type =
    state.currentFilter === "all" || state.currentFilter === "adult"
      ? (state.currentFilter === "adult" ? "adult" : null)
      : state.currentFilter;

  const items = await queryCatalogItems({
    type,
    genre: state.currentGenre,
    term: state.searchTerm,
    limit: 120
  });

  if (requestId !== renderRequestId) return;

  if (!items.length) {
    grid.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }

  if (empty) empty.style.display = "none";
  grid.innerHTML = items.map(renderCard).join("");
}

/* =========================================================
   NAVEGADOR DE SÉRIES
   SÉRIE -> TEMPORADA -> EPISÓDIOS
   ========================================================= */

function renderSeriesCard(item) {
  const title = item.seriesName || item.name || "Série sem nome";
  const seasons = Object.keys(item.seasons || {})
    .map(Number)
    .filter(Number.isFinite)
    .sort((a,b)=>a-b);

  const seasonLabel = seasons.length
    ? seasons.map(s => `T${s}`).join(" • ")
    : "Temporadas não identificadas";

  const logo = item.logo
    ? `<img class="gc-card-image" src="${escapeHTML(item.logo)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="gc-card-placeholder" style="display:none">📺</div>`
    : `<div class="gc-card-placeholder">📺</div>`;

  return `<article class="gc-card" data-series-key="${escapeHTML(item.seriesKey)}" tabindex="0">${logo}<div class="gc-card-info"><div class="gc-card-title">${escapeHTML(title)}</div><div class="gc-card-meta">${formatNumber(item.episodeCount || 0)} episódios • ${escapeHTML(seasonLabel)}</div></div></article>`;
}
function renderSeasonCard(season,count) {
  return `<article class="gc-card" data-series-season="${escapeHTML(String(season))}" tabindex="0"><div class="gc-card-placeholder">📂</div><div class="gc-card-info"><div class="gc-card-title">Temporada ${escapeHTML(String(season))}</div><div class="gc-card-meta">${formatNumber(count)} episódios</div></div></article>`;
}
function setupSeriesBrowserEvents(grid) {
  grid.querySelectorAll("[data-series-key]").forEach(card=>card.addEventListener("click",()=>{state.seriesView.seriesKey=card.dataset.seriesKey||null;state.seriesView.season=null;render();}));
  grid.querySelectorAll("[data-series-season]").forEach(card=>card.addEventListener("click",()=>{state.seriesView.season=Number(card.dataset.seriesSeason);render();}));
  const back=grid.querySelector("[data-series-back]");
  if(back) back.addEventListener("click",()=>{if(state.seriesView.season!==null) state.seriesView.season=null; else state.seriesView.seriesKey=null;render();});
}
async function renderSeriesBrowser(grid,empty) {
  const items=await getFilteredSeriesItems();
  const key=state.seriesView.seriesKey;
  const season=state.seriesView.season;
  if(!key){
    if(!items.length){grid.innerHTML="";if(empty)empty.style.display="block";return;}
    if(empty)empty.style.display="none";
    grid.innerHTML=items.slice(0,120).map(renderSeriesCard).join("");
    setupSeriesBrowserEvents(grid);
    return;
  }
  const selected=items.find(item=>item.seriesKey===key)||state.seriesCatalogMap.get(key);
  if(!selected){state.seriesView.seriesKey=null;state.seriesView.season=null;return renderSeriesBrowser(grid,empty);}
  if(season===null){
    let seasons=Object.entries(selected.seasons||{});

    if(!seasons.length){
      const episodes=await getSeriesEpisodes(key,null);
      const derived={};

      for(const episode of episodes){
        const info=extractSeriesInfo(episode);
        const n=Number(info.season ?? 1);
        derived[String(n)]=Number(derived[String(n)]||0)+1;
      }

      if(Object.keys(derived).length){
        selected.seasons=derived;
        seasons=Object.entries(derived);

        try{
          await new Promise((resolve,reject)=>{
            const tx=state.db.transaction(SERIES_STORE,"readwrite");
            tx.objectStore(SERIES_STORE).put(selected);
            tx.oncomplete=resolve;
            tx.onerror=()=>reject(tx.error);
            tx.onabort=()=>reject(tx.error);
          });
        }catch(error){
          console.warn("Não foi possível salvar temporadas derivadas:",error);
        }
      }
    }

    seasons.sort((a,b)=>Number(a[0])-Number(b[0]));
    grid.innerHTML=`<div class="gc-series-toolbar"><button type="button" class="filter-button" data-series-back>← VOLTAR</button><div class="gc-series-heading"><strong>${escapeHTML(selected.seriesName)}</strong><span>${formatNumber(selected.episodeCount||0)} episódios</span></div></div><div class="gc-series-grid">${seasons.length?seasons.map(([n,count])=>renderSeasonCard(n,count)).join(""):`<div class="gc-results-count">Nenhuma temporada identificada.</div>`}</div>`;
    setupSeriesBrowserEvents(grid);if(empty)empty.style.display="none";return;
  }
  const episodes=await getSeriesEpisodes(key,season);
  grid.innerHTML=`<div class="gc-series-toolbar"><button type="button" class="filter-button" data-series-back>← TEMPORADAS</button><div class="gc-series-heading"><strong>${escapeHTML(selected.seriesName)}</strong><span>Temporada ${escapeHTML(String(season))} • ${formatNumber(episodes.length)} episódios</span></div></div><div class="gc-series-grid">${episodes.length?episodes.map(renderCard).join(""):`<div class="gc-results-count">Nenhum episódio encontrado.</div>`}</div>`;
  setupSeriesBrowserEvents(grid);if(empty)empty.style.display="none";
}

function getSeriesInfo(item) {
  const parsed = extractSeriesInfo(item);

  return {
    ...parsed,
    seriesName: item.seriesName || parsed.seriesName,
    seriesKey: item.seriesKey || parsed.seriesKey,
    season: item.season ?? parsed.season,
    episode: item.episode ?? parsed.episode
  };
}

function getDerivedSeriesInfo(item) {
  const parsed = extractSeriesInfo(item);

  if (item?.seriesKey && item?.seriesName) {
    return {
      seriesKey: item.seriesKey,
      seriesName: item.seriesName,
      season: item.season ?? parsed.season,
      episode: item.episode ?? parsed.episode,
      genre: item.genre || parsed.genre || getGenreName(item.group)
    };
  }

  return parsed;
}

function looksLikeSeriesRecord(item) {
  if (!item) return false;

  if (item.type === "series") return true;

  const name = String(item.name || "");
  const group = String(item.group || "");
  const url = String(item.url || "");

  return classifyItem(name, group, url) === "series";
}

async function getAllSeriesItems() {
  if (Array.isArray(state.seriesCatalog) && state.seriesCatalog.length) {
    return state.seriesCatalog;
  }

  if (!state.db) {
    return state.items
      .filter(item => item && item.type === "series")
      .map(item => {
        const info = getDerivedSeriesInfo(item);
        return {
          ...item,
          type: "series",
          seriesKey: info.seriesKey,
          seriesName: info.seriesName,
          genre: info.genre,
          episodeCount: 1,
          seasons: info.season
            ? { [String(info.season)]: 1 }
            : {}
        };
      });
  }

  const stored = await loadSeriesCatalogFromDB();

  if (stored.length) {
    state.seriesCatalog = stored;
    state.seriesCatalogMap = new Map(
      stored.map(item => [item.seriesKey, item])
    );
    state.seriesCatalogReady = true;
    return stored;
  }

  /*
   * Catálogo antigo sem índice: usamos somente a RAM
   * imediatamente. A reconstrução completa acontece
   * em segundo plano, sem bloquear a abertura da tela.
   */
  const quick = [];
  const seen = new Set();

  for (const item of state.items) {
    if (!item || item.type !== "series") continue;

    const info = getDerivedSeriesInfo(item);

    if (!seen.has(info.seriesKey)) {
      seen.add(info.seriesKey);

      quick.push({
        ...item,
        type: "series",
        seriesKey: info.seriesKey,
        seriesName: info.seriesName,
        genre: info.genre,
        episodeCount: 1,
        seasons: info.season
          ? { [String(info.season)]: 1 }
          : {}
      });
    }
  }

  rebuildSeriesCatalogInBackground();

  return quick;
}

async function rebuildSeriesCatalogInBackground(force = false) {
  if (
    (!force && state.seriesCatalogReady) ||
    state.seriesCatalogBuilding ||
    !state.db
  ) {
    return;
  }

  state.seriesCatalogBuilding = true;

  try {
    const map = new Map();
    const aliases = new Map();

    await new Promise((resolve, reject) => {
      const transaction = state.db.transaction(
        STORE_NAME,
        "readonly"
      );

      const request =
        transaction.objectStore(STORE_NAME).openCursor();

      let scanned = 0;

      request.onsuccess = event => {
        const cursor = event.target.result;

        if (!cursor) {
          resolve();
          return;
        }

        const item = cursor.value;

        if (item.type === "series") {
          const info = extractSeriesInfo(item);
          const canonicalKey = normalizeText(
            canonicalSeriesTitle(info.seriesName || item.name)
          );

          if (item.seriesKey) {
            aliases.set(String(item.seriesKey), canonicalKey);
          }
          aliases.set(canonicalKey, canonicalKey);

          let entry = map.get(canonicalKey);

          if (!entry) {
            entry = {
              seriesKey: canonicalKey,
              seriesName: canonicalSeriesTitle(info.seriesName || item.name),
              nameLower: normalizeText(
                info.seriesName || item.name
              ),
              logo: item.logo || "",
              group: item.group || "",
              genre: info.genre || getGenreName(item.group),
              episodeCount: 0,
              seasons: {}
            };

            map.set(canonicalKey, entry);
          }

          if (!entry.logo && item.logo) {
            entry.logo = item.logo;
          }

          if (info.season !== null && info.season !== undefined) {
            const season = String(Number(info.season));
            entry.seasons[season] =
              Number(entry.seasons[season] || 0) + 1;
          }

          entry.episodeCount++;
        }

        scanned++;

        if (scanned % 1500 === 0) {
          setTimeout(() => cursor.continue(), 0);
        } else {
          cursor.continue();
        }
      };

      request.onerror = () => reject(request.error);
    });

    const result = Array.from(map.values());

    if (state.db.objectStoreNames.contains(SERIES_STORE)) {
      await new Promise((resolve, reject) => {
        const transaction = state.db.transaction(
          SERIES_STORE,
          "readwrite"
        );

        const store = transaction.objectStore(SERIES_STORE);

        store.clear();

        for (const item of result) {
          store.put(item);
        }

        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    }

    state.seriesKeyAliases = aliases;
    state.seriesCatalog = result;
    state.seriesCatalogMap = new Map(
      result.map(item => [item.seriesKey, item])
    );
    state.seriesCatalogReady = true;
    state.seriesItemsCache = result;

    /* O contador mostra séries únicas; episódios ficam dentro
       de cada série/temporada. */
    state.counts.series = result.length;
    renderStats();

    if (state.currentFilter === "series") {
      render();
    }
  } catch (error) {
    console.warn(
      "Reconstrução do catálogo de séries falhou:",
      error
    );
  } finally {
    state.seriesCatalogBuilding = false;
  }
}

async function getFilteredSeriesItems() {
  let items = await getAllSeriesItems();

  items = items.filter(item =>
    state.currentFilter === "adult"
      ? isAdultSeries(item)
      : !isAdultSeries(item)
  );

  if (state.currentGenre !== "all") {
    const wanted = normalizeText(state.currentGenre);

    items = items.filter(item =>
      normalizeText(
        item.genre || getGenreName(item.group)
      ) === wanted
    );
  }

  if (state.searchTerm) {
    const term = normalizeText(state.searchTerm);

    items = items.filter(item =>
      normalizeText(item.name || item.seriesName || "").includes(term) ||
      normalizeText(item.group || "").includes(term) ||
      normalizeText(item.seriesName || "").includes(term)
    );
  }

  return items;
}

function querySeriesEpisodesByKey(key, season) {
  if (!state.db) {
    return Promise.resolve(
      state.items
        .filter(looksLikeSeriesRecord)
        .filter(item => {
          const info = getDerivedSeriesInfo(item);
          return (
            info.seriesKey === key &&
            (season === null ||
              Number(info.season ?? 0) === Number(season))
          );
        })
    );
  }

  return new Promise((resolve, reject) => {
    const result = [];
    const transaction = state.db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const source = store.index("seriesKey");
    const range = IDBKeyRange.only(key);
    const request = source.openCursor(range);

    request.onsuccess = event => {
      const cursor = event.target.result;

      if (!cursor) {
        const filtered = season === null
          ? result
          : result.filter(item => {
              const info = extractSeriesInfo(item);
              return Number(info.season ?? 1) === Number(season);
            });

        resolve(filtered);
        return;
      }

      result.push({...cursor.value, type:"series"});
      cursor.continue();
    };

    request.onerror = () => reject(request.error);
  });
}

async function getSeriesEpisodes(seriesKey, season = null) {
  const selectedSeries =
    state.seriesCatalogMap.get(seriesKey) ||
    state.seriesCatalog.find(item => item.seriesKey === seriesKey);

  if (selectedSeries?.xtreamSeriesId && state.xtreamSession) {
    try {
      return await fetchXtreamSeriesEpisodes(
        selectedSeries,
        season,
        state.loadAbort?.signal
      );
    } catch (error) {
      console.warn("[GC PLAY PRO] Episódios Xtream:", error);
    }
  }

  const keys = new Set([seriesKey]);

  for (const [oldKey, canonicalKey] of state.seriesKeyAliases) {
    if (canonicalKey === seriesKey) {
      keys.add(oldKey);
    }
  }

  const batches = await Promise.all(
    Array.from(keys).map(key =>
      querySeriesEpisodesByKey(key, season)
    )
  );

  const seen = new Set();
  const result = [];

  for (const batch of batches) {
    for (const item of batch) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      result.push(item);
    }
  }

  result.sort((a,b) =>
    Number(a.episode ?? 999999) - Number(b.episode ?? 999999) ||
    String(a.name || "").localeCompare(
      String(b.name || ""),
      "pt-BR",
      {sensitivity:"base"}
    )
  );

  return result;
}

/* =========================================================
   RENDER ESTATÍSTICAS
   ========================================================= */

function renderStats() {
  const channelCount =
    $("#channelCount");

  const movieCount =
    $("#movieCount");

  const seriesCount =
    $("#seriesCount");

  const connectionStatus =
    $("#connectionStatus");

  if (channelCount) {
    channelCount.textContent =
      formatNumber(
        state.counts.live
      );
  }

  if (movieCount) {
    movieCount.textContent =
      formatNumber(
        state.counts.movie
      );
  }

  if (seriesCount) {
    seriesCount.textContent =
      formatNumber(
        state.counts.series
      );
  }

  if (connectionStatus) {
    connectionStatus.textContent =
      state.loading
        ? "CARREGANDO..."
        : "ONLINE";
  }
}
/* =========================================================
   PLAYER — HLS.JS
   ========================================================= */

async function loadHLS() {
  if (window.Hls) {
    return window.Hls;
  }

  return new Promise((resolve, reject) => {
    const existing =
      document.querySelector(
        'script[data-gc-hls="1"]'
      );

    if (existing) {
      existing.addEventListener(
        "load",
        () => resolve(window.Hls)
      );

      existing.addEventListener(
        "error",
        reject
      );

      return;
    }

    const script =
      document.createElement("script");

    script.src =
      "https://cdn.jsdelivr.net/npm/hls.js@1.7.3";

    script.async = true;

    script.dataset.gcHls = "1";

    script.onload = () => {
      if (window.Hls) {
        resolve(window.Hls);
      } else {
        reject(
          new Error(
            "HLS.js não foi carregado."
          )
        );
      }
    };

    script.onerror = () => {
      reject(
        new Error(
          "Não foi possível carregar HLS.js."
        )
      );
    };

    document.head.appendChild(script);
  });
}

/* =========================================================
   MPEG-TS PLAYER
   ========================================================= */

function loadMpegTS() {
  if (window.mpegts) {
    return Promise.resolve(window.mpegts);
  }

  return new Promise((resolve, reject) => {
    const existing =
      document.querySelector(
        'script[data-gc-mpegts="1"]'
      );

    if (existing) {
      existing.addEventListener(
        "load",
        () => resolve(window.mpegts)
      );

      existing.addEventListener(
        "error",
        reject
      );

      return;
    }

    const script =
      document.createElement("script");

    script.src =
      "https://cdn.jsdelivr.net/npm/mpegts.js@1.8.2/dist/mpegts.min.js";

    script.async = true;
    script.dataset.gcMpegts = "1";

    script.onload = () => {
      if (window.mpegts) {
        resolve(window.mpegts);
      } else {
        reject(
          new Error(
            "mpegts.js não foi carregado."
          )
        );
      }
    };

    script.onerror = () => {
      reject(
        new Error(
          "Não foi possível carregar mpegts.js."
        )
      );
    };

    document.head.appendChild(script);
  });
}

function isMpegTSLive(item) {
  if (!item || item.type !== "live") return false;

  const url = String(item.url || "").toLowerCase();

  if (isHLS(url)) return false;

  /*
     IPTV ao vivo frequentemente entrega MPEG-TS sem
     ".ts" no final da URL. Tratamos endpoints de vídeo
     ao vivo como TS por padrão, exceto formatos que
     normalmente são reproduzidos nativamente.
  */
  if (
    /\.(mp4|m4v|webm|ogg|ogv|flv)(?:$|[?#])/i.test(url)
  ) {
    return false;
  }

  return (
    url.includes(".ts") ||
    url.includes(".m2ts") ||
    url.includes("mpegts") ||
    url.includes("/live/") ||
    url.includes("/stream/") ||
    url.includes("/play/") ||
    url.includes("/channel/") ||
    url.includes("/tv/")
  );
}

async function playMpegTS(
  video,
  url,
  message
) {
  try {
    const mpegts =
      await loadMpegTS();

    if (
      !mpegts ||
      !mpegts.isSupported()
    ) {
      throw new Error(
        "MPEG-TS não é suportado neste navegador."
      );
    }

    if (
      state.mpegts
    ) {
      try {
        state.mpegts.destroy();
      } catch {}

      state.mpegts = null;
    }

    const player =
      mpegts.createPlayer(
        {
          type: "mpegts",
          isLive: true,
          url,
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
          deferLoadAfterSourceOpen: true,
          liveBufferLatencyChasing: false,
          liveSync: false,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 30,
          autoCleanupMinBackwardDuration: 10
        }
      );

    state.mpegts =
      player;

    player.on(
      mpegts.Events.ERROR,
      (errorType, errorDetail, errorInfo) => {
        console.warn(
          "MPEG-TS ERROR:",
          errorType,
          errorDetail,
          errorInfo
        );

        const detail =
          errorDetail || errorType || "erro desconhecido";

        if (message) {
          message.textContent =
            `MPEG-TS: ${detail}`;
        }

        /*
           Algumas emissoras encerram a conexão ou enviam
           um TS com pequena interrupção. Tentamos uma única
           reconexão automática antes de informar erro final.
        */
        if (
          !player.__gcRetried &&
          (
            errorType === mpegts.ErrorTypes.NETWORK_ERROR ||
            errorDetail === mpegts.ErrorDetails.NETWORK_TIMEOUT ||
            errorDetail === mpegts.ErrorDetails.NETWORK_UNRECOVERABLE_EARLY_EOF
          )
        ) {
          player.__gcRetried = true;

          setTimeout(async () => {
            if (state.mpegts !== player) return;

            try {
              player.unload();
              player.load();
              await player.play();

              if (message) message.textContent = "";
            } catch (retryError) {
              console.warn("MPEG-TS retry falhou:", retryError);
            }
          }, 1200);
        }
      }
    );

    player.attachMediaElement(
      video
    );

    player.load();

    if (message) {
      message.textContent =
        "Conectando ao canal MPEG-TS...";
    }

    try {
      await player.play();

      if (message) {
        message.textContent = "";
      }
    } catch (error) {
      console.warn(
        "MPEG-TS autoplay:",
        error
      );

      if (message) {
        message.textContent =
          "Toque no botão ▶ para iniciar.";
      }
    }

  } catch (error) {
    console.error(
      "Erro MPEG-TS:",
      error
    );

    if (message) {
      message.textContent =
        "Não foi possível iniciar o MPEG-TS.";
    }
  }
}

/* =========================================================
   FECHAR PLAYER
   ========================================================= */

function closePlayer() {
  const panel =
    $("#playerPanel");

  const video =
    $("#videoPlayer");

  if (state.hls) {
    try {
      state.hls.destroy();
    } catch {}
    state.hls = null;
  }

  if (state.mpegts) {
    try {
      state.mpegts.destroy();
    } catch {}
    state.mpegts = null;
  }

  if (state.epgTimer) {
    clearInterval(state.epgTimer);
    state.epgTimer = null;
  }

  const epg = $("#playerEPG");
  if (epg) {
    epg.innerHTML = "";
    epg.classList.remove("show");
  }

  if (video && state.currentItem) {
    saveResumePosition(state.currentItem, video);
  }

  if (video) {
    try {
      video.pause();
    } catch {}

    video.removeAttribute("src");

    try {
      video.load();
    } catch {}
  }

  state.currentItem = null;

  if (panel) {
    panel.classList.remove(
      "active",
      "open",
      "show"
    );

    panel.classList.add(
      "hidden"
    );
  }
}

/* =========================================================
   ABRIR PLAYER
   ========================================================= */

async function playItem(item) {
  if (!item || !item.url) {
    toast(
      "Este conteúdo não possui uma URL válida."
    );
    return;
  }

  const panel =
    $("#playerPanel");

  const video =
    $("#videoPlayer");

  const title =
    $("#playerTitle");

  const message =
    $("#playerMessage");

  if (!video) {
    toast(
      "Elemento de vídeo não encontrado."
    );
    return;
  }

  state.currentItem =
    item;

  if (state.epgTimer) {
    clearInterval(state.epgTimer);
    state.epgTimer = null;
  }

  loadLiveEPG(item);

  if (item.type === "live" && state.xtreamSession && item.xtreamStreamId) {
    state.epgTimer = setInterval(() => {
      if (state.currentItem?.id === item.id) {
        loadLiveEPG(item);
      }
    }, 60000);
  }

  if (title) {
    title.textContent =
      item.name;
  }

  if (message) {
    message.textContent =
      "Conectando ao conteúdo...";
  }

  if (panel) {
    panel.classList.remove(
      "hidden"
    );

    panel.classList.add(
      "active",
      "open",
      "show"
    );
  }

  addHistory(item);

  if (state.hls) {
    try {
      state.hls.destroy();
    } catch {}

    state.hls = null;
  }

  if (video && state.currentItem) {
    saveResumePosition(state.currentItem, video);
  }

  try {
    video.pause();
  } catch {}

  video.removeAttribute("src");
  delete video.dataset.gcProxyRetry;

  try {
    video.load();
  } catch {}

  const originalUrl =
    item.url;

  video.playbackRate =
    Number(state.settings.playbackRate) > 0
      ? Number(state.settings.playbackRate)
      : 1;

  const resumePosition = getResumePosition(item);

  /*
     Para arquivos de vídeo normais, tentamos primeiro a origem
     direta. Isso evita jogar todo o tráfego de vídeo pelo proxy
     quando o servidor já permite reprodução no navegador.
     HLS.js e MPEG-TS continuam usando o proxy quando necessário.
  */
  const looksLikeLiveStream =
    item.type === "live" ||
    /\/live\//i.test(originalUrl) ||
    /\/stream\//i.test(originalUrl) ||
    /\/channel\//i.test(originalUrl) ||
    /\/play\//i.test(originalUrl) ||
    /\/tv\//i.test(originalUrl);

  const playbackUrl =
    looksLikeLiveStream || isHLS(originalUrl)
      ? (shouldUseProxy(originalUrl)
          ? buildProxyUrl(originalUrl)
          : originalUrl)
      : originalUrl;

  /* -------------------------------------------------------
     MPEG-TS AO VIVO
     ------------------------------------------------------- */

  /* -------------------------------------------------------
     HLS
     ------------------------------------------------------- */

  if (isHLS(originalUrl)) {
    await playHLS(
      video,
      playbackUrl,
      message
    );

    return;
  }

  /* -------------------------------------------------------
     MPEG-TS AO VIVO
     ------------------------------------------------------- */

  if (looksLikeLiveStream) {
    await playMpegTS(
      video,
      playbackUrl,
      message
    );

    return;
  }

  /* -------------------------------------------------------
     VÍDEO NORMAL
     ------------------------------------------------------- */

  video.controls = true;
  video.playsInline = true;
  video.style.visibility = "visible";
  video.style.opacity = "1";
  video.src = playbackUrl;

  if (message) {
    message.textContent =
      "Carregando vídeo...";
  }

  video.onloadedmetadata = () => {
    if (resumePosition > 5 && Number.isFinite(video.duration) && video.duration > resumePosition + 8) {
      try {
        video.currentTime = resumePosition;
        if (message) {
          message.textContent = `Continuando de ${formatResumeTime(resumePosition)}...`;
          setTimeout(() => {
            if (message) message.textContent = "";
          }, 1800);
        }
      } catch {}
    }
  };

  video.onloadeddata = () => {
    if (message) {
      message.textContent = "";
    }
  };

  video.ontimeupdate = () => {
    if (!state.currentItem || state.currentItem.id !== item.id) return;
    const now = Date.now();
    if (!video.__gcLastResumeSave || now - video.__gcLastResumeSave > 10000) {
      video.__gcLastResumeSave = now;
      saveResumePosition(item, video);
    }
  };

  video.onended = () => {
    clearResumePosition(item);
  };

  video.onplaying = () => {
    if (message) {
      message.textContent = "";
    }
  };

  video.onerror = () => {
    const mediaError = video.error;

    /*
       Fallback único: se a origem direta falhar, tenta o proxy.
       Assim servidores compatíveis ficam fora do proxy e os
       demais continuam funcionando.
    */
    if (
      playbackUrl === originalUrl &&
      shouldUseProxy(originalUrl) &&
      !video.dataset.gcProxyRetry
    ) {
      video.dataset.gcProxyRetry = "1";
      video.src = buildProxyUrl(originalUrl);
      video.load();
      if (state.settings.autoplay) {
        video.play().catch(() => {});
      }
      return;
    }

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
  message
) {
  /* -------------------------------------------------------
     Safari / iPhone / alguns Smart TVs
     ------------------------------------------------------- */

  if (
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
        try {
          if (
            context &&
            context.url &&
            shouldUseProxy(context.url)
          ) {
            context.url =
              buildProxyUrl(context.url);
          }
        } catch (error) {
          console.warn(
            "Erro preparando URL HLS:",
            error
          );
        }

        return super.load(
          context,
          config,
          callbacks
        );
      }
    }

    const hls =
      new Hls({
        enableWorker: true,
        backBufferLength: 30,

        lowLatencyMode: false,

        maxBufferLength: 30,

        maxMaxBufferLength: 60,

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
        if (message) {
          message.textContent = "";
        }
      }
    );

    hls.on(
      Hls.Events.ERROR,
      (
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

      $(".gc-quick-card[data-filter]").forEach(item => {
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

  $("[data-section]").forEach(button => {
    button.classList.toggle("active", button.dataset.section === targetSection);
  });

  $(".gc-quick-card[data-section]").forEach(button => {
    button.classList.toggle("active", button.dataset.section === targetSection);
  });

  $(".gc-quick-card[data-filter]").forEach(button => {
    const filter = button.dataset.filter || "";
    const active = (targetSection === "live" && filter === "live") || (targetSection === "movies" && filter === "movie") || (targetSection === "series" && filter === "series");
    button.classList.toggle("active", active);
  });
}

/* =========================================================
   NAVEGAÇÃO
   ========================================================= */

function setupNavigation() {
  const buttons = $$("[data-section]");

  buttons.forEach(button => {
    button.addEventListener("click", async () => {
      const section = button.dataset.section || "home";

      if (section === "adult") {
        const unlocked = await unlockAdultArea();
        if (!unlocked) return;
        state.adultUnlocked = true;
      } else {
        state.adultUnlocked = false;
      }

      state.currentSection = section;

      buttons.forEach(item => {
        item.classList.toggle("active", item === button);
      });

      await handleSection(section);
    });
  });
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
    render();

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
    render();

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
    state.counts.series++;
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
      renderGenreFilters();
      render();

      state.loading = false;

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

        state.seriesCatalog =
          await loadSeriesCatalogFromDB();

        state.seriesCatalogMap =
          new Map(
            state.seriesCatalog.map(
              item => [item.seriesKey, item]
            )
          );

        state.seriesCatalogReady =
          state.seriesCatalog.length > 0;

        renderGenreFilters();
        render();
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

    render();

    state.loading =
      false;

    renderStats();

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

    await loadDatabaseStats();
    renderGenreFilters();
    render();

    const migrationKey = "GC_PLAY_PRO_SERIES_MIGRATION_V3";
    let migrated = false;

    try {
      migrated = localStorage.getItem(migrationKey) === "1";
    } catch {}

    if (!migrated) {
      setTimeout(async () => {
        await rebuildSeriesCatalogInBackground(true);

        try {
          localStorage.setItem(migrationKey, "1");
        } catch {}
      }, 50);
    } else if (needsSeriesCatalogMigration(state.seriesCatalog)) {
      setTimeout(() => {
        rebuildSeriesCatalogInBackground(true);
      }, 50);
    }
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

window.GC_PLAY_PRO = {
  state,

  loadM3U,

  loadFile,

  playItem,

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

  setupNavigation();

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

  await loadLocalCatalog();

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
    initApp,
    {
      once: true
    }
  );
} else {
  initApp();
}
