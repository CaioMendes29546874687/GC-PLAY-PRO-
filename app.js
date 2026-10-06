/* =========================================================
   GC PLAY PRO
   APP.JS — MOTOR DE PLAYLIST PROGRESSIVO
   ========================================================= */

"use strict";

/* GC BUILD 2026-10-02-23 */

/* =========================================================
   CONFIGURAÇÕES
   ========================================================= */

const GC_SUPABASE_URL =
  "https://kuzgdvpdqmocklsgyzvt.supabase.co";

const GC_CATALOG_GATEWAY =
  "https://gc-catalog.caioroberto318.workers.dev";

/* Compatibilidade legada: o catálogo usa Cloudflare; Supabase nunca recebe vídeo. */
const GC_M3U_PROXY = GC_CATALOG_GATEWAY;

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
/* Primeira pintura agressiva: não espere 1000 itens para mostrar a biblioteca. */
const FIRST_PAINT_BATCH = 150;
const UI_RENDER_INTERVAL = 1500;
const CACHE_META_KEY = "GC_PLAY_PRO_CATALOG_META_V2";
const CACHE_MAX_AGE_MS = 30 * 60 * 1000;
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

  dash: null,

  seriesItemsCache: null,

  /* Chaves únicas usadas durante a importação para que o contador
     de séries nunca conte episódios como séries individuais. */
  importSeriesKeys: new Set(),

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

  seriesFallbackPromise: null,
  xtreamSeriesFallbackNeeded: false,

  epgTimer: null
};

/* Exposto apenas para os módulos de reprodução externos. */
window.__GC_STATE__ = state;


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

function isDASH(url) {
  const value = String(url || "").toLowerCase();
  return /(?:\.mpd)(?:$|[?#])/i.test(value) || value.includes("manifest.mpd");
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
     Isso tem prioridade sobre nomes e grupos mistos.
  */
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
    .replace(/\s*[-|:_./()\[\]]*\s*(?:episode|episodio|ep|capitulo|capítulo)\s*0*\d{1,4}.*$/i, "")
    .replace(/\s*[-|:_./()\[\]]*\s*e\s*0*\d{1,4}\s*$/i, "")
    .replace(/\s*[-|:_./()\[\]]*\s*\[?0*\d{1,4}\]?\s*$/i, "")
    .replace(/\s*[-|:_./()\[\]]+\s*0*\d{1,4}\s*$/i, "")
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
    /\[\s*(?:s|t)\s*0*(\d{1,3})\s*e\s*0*(\d{1,4})\s*\]/i,
    /\b0*(\d{1,3})\s*[ªaº]?\s*(?:temporada|season)\s*[-: ]*\s*(?:e|ep|epis[oó]dio)?\s*0*(\d{1,4})\b/i,
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
      /\s*\[\s*(?:s|t)\s*0*\d{1,3}\s*\]\s*$/i,
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

  /*
     V5: reclassificação completa da biblioteca.
     Além do type, precisamos reconstruir os campos de série
     (seriesKey/season/episode). A migração anterior só alterava
     o tipo e deixava episódios antigos com seriesKey vazio.
  */
  const migrationKey = "GC_PLAY_PRO_CATEGORY_TYPES_V6";

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

    const store = transaction.objectStore(STORE_NAME);

    if (storeNames.includes(SERIES_STORE)) {
      transaction.objectStore(SERIES_STORE).clear();
    }

    const request = store.openCursor();

    request.onsuccess = event => {
      const cursor = event.target.result;

      if (!cursor) return;

      const item = cursor.value;
      const newType = classifyItem(
        item.name,
        item.group,
        item.url
      );

      let next = item;

      if (newType === "series") {
        const info = extractSeriesInfo(item);

        next = {
          ...item,
          type: "series",
          seriesName: info.seriesName || item.name || "Série sem nome",
          seriesKey: info.seriesKey || normalizeText(info.seriesName || item.name || ""),
          season: info.season ?? null,
          episode: info.episode ?? null,
          seriesSeason: [
            info.seriesKey || normalizeText(info.seriesName || item.name || ""),
            Number(info.season ?? 0)
          ],
          genre: info.genre || getGenreName(item.group)
        };
      } else {
        next = {
          ...item,
          type: newType,
          seriesName: "",
          seriesKey: "",
          season: null,
          episode: null,
          seriesSeason: ["", 0],
          genre: ""
        };
      }

      /*
         Evita writes desnecessários, mas garante que registros
         antigos recebam todos os campos necessários para os índices.
      */
      const fieldsChanged =
        item.type !== next.type ||
        item.seriesName !== next.seriesName ||
        item.seriesKey !== next.seriesKey ||
        item.season !== next.season ||
        item.episode !== next.episode ||
        JSON.stringify(item.seriesSeason || []) !== JSON.stringify(next.seriesSeason || []) ||
        item.genre !== next.genre;

      if (fieldsChanged) {
        cursor.update(next);
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

        localStorage.removeItem("GC_PLAY_PRO_SERIES_MIGRATION_V3");
        localStorage.removeItem("GC_PLAY_PRO_SERIES_MIGRATION_V2");
        localStorage.removeItem("GC_PLAY_PRO_CATEGORY_TYPES_V5");
        localStorage.removeItem("GC_PLAY_PRO_CATEGORY_TYPES_V4");
      } catch {}

      state.seriesCatalog = [];
      state.seriesCatalogMap = new Map();
      state.seriesCatalogChanged = new Set();
      state.seriesCatalogReady = false;
      state.seriesItemsCache = null;

      console.log(
        "[GC PLAY PRO] Reclassificação V5 concluída:",
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
  /* Compatibilidade: mídia nunca é enviada ao gateway. */
  return false;
}

function buildProxyUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol)) return value;
    return `${GC_CATALOG_GATEWAY}?url=${encodeURIComponent(value)}`;
  } catch {
    return value;
  }
}

function resolvePlaylistUrl(url) {
  /* Somente M3U/Xtream/EPG passam pelo gateway de catálogo. */
  return buildProxyUrl(url);
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

  if (!item || item.type !== "live" || !item.xtreamStreamId) {
    container.innerHTML = "";
    container.classList.remove("show");
    return;
  }

  /* Recupera a sessão Xtream a partir da própria URL do canal quando
     a sessão não foi restaurada do estado/cache. Isso evita perder o
     EPG depois de uma atualização ou restauração do catálogo. */
  let epgSession = state.xtreamSession;
  if (!epgSession && item.url) {
    try {
      const parsed = new URL(String(item.url));
      const match = parsed.pathname.match(/\/live\/([^/]+)\/([^/]+)\//i);
      if (match) {
        epgSession = {
          base: parsed.origin,
          username: decodeURIComponent(match[1]),
          password: decodeURIComponent(match[2])
        };
      }
    } catch {}
  }

  if (!epgSession) {
    container.innerHTML = '<div class="gc-epg-empty">EPG não disponível para este canal.</div>';
    container.classList.add("show");
    return;
  }

  container.classList.add("show");
  container.innerHTML = '<div class="gc-epg-loading">CARREGANDO PROGRAMAÇÃO...</div>';

  try {
    const data = await fetchXtreamJSON(
      epgSession,
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
    updateLoadMessage("Conectando ao catálogo Xtream...");

    /*
       IMPORTAÇÃO COMPLETA DO CATÁLOGO:
       antes o modo rápido buscava somente TV ao vivo e deixava
       filmes/séries para depois. Isso fazia a interface parecer
       que a lista tinha somente canais.
    */
    /*
       PRIMEIRO PAINT: não espere filmes e séries para liberar a
       interface. Login + TV ao vivo são suficientes para validar a
       sessão e mostrar o catálogo imediatamente. Filmes e séries usam
       ensureXtreamSectionLoaded() em segundo plano depois.
    */
    const liveResults = await Promise.allSettled([
      fetchXtreamJSON(session, "", signal),
      fetchXtreamJSON(session, "get_live_categories", signal),
      fetchXtreamJSON(session, "get_live_streams", signal),
      fetchXtreamJSON(session, "get_vod_categories", signal),
      fetchXtreamJSON(session, "get_vod_streams", signal),
      fetchXtreamJSON(session, "get_series_categories", signal),
      fetchXtreamJSON(session, "get_series", signal)
    ]);

    /* Cada índice corresponde exatamente ao endpoint acima.
       A versão anterior preenchia 3 chamadas e deixava os índices
       de filmes/séries como null, fazendo o catálogo inicial contar
       apenas TV ao vivo mesmo quando a API respondia corretamente. */
    const results = liveResults;

    if (signal?.aborted) {
      throw new DOMException("Operação cancelada", "AbortError");
    }

    const value = index => results[index]?.status === "fulfilled"
      ? results[index].value
      : null;

    const authData = value(0);
    const userInfo = authData?.user_info || {};

    if (
      Object.keys(userInfo).length &&
      String(userInfo.auth ?? "1") === "0"
    ) {
      throw new Error("Usuário ou senha Xtream inválidos.");
    }

    /*
       IMPORTANTE:
       Se a URL é Xtream válida, NÃO podemos voltar para a M3U
       completa só porque um dos endpoints é lento ou falhou.
       Os catálogos são independentes. Mantemos a sessão Xtream e
       carregamos filmes/séries sob demanda em ensureXtreamSectionLoaded().
       Assim a aplicação nunca precisa baixar a M3U inteira para separar
       TV, filmes e séries.
    */
    const endpointOk =
      results.slice(1).some(result => result?.status === "fulfilled");

    if (!endpointOk) {
      console.warn("[GC PLAY PRO] Nenhum endpoint de catálogo Xtream respondeu.");
      return null;
    }

    const live = unwrapXtreamArray(value(2));
    const movies = unwrapXtreamArray(value(4));
    const series = unwrapXtreamArray(value(6));

    /*
       Catálogo parcial também é válido: o que não veio agora será
       carregado somente quando o usuário abrir aquela seção.
    */
    if (!live.length && !movies.length && !series.length) {
      console.warn("[GC PLAY PRO] Xtream respondeu sem streams no carregamento rápido; continuando para a importação M3U.");
      return null;
    }

    const liveCategories = new Map();
    const movieCategories = new Map();
    const seriesCategories = new Map();

    for (const cat of unwrapXtreamArray(value(1))) {
      if (cat?.category_id != null && cat?.category_name) {
        liveCategories.set(String(cat.category_id), String(cat.category_name));
      }
    }

    for (const cat of unwrapXtreamArray(value(3))) {
      if (cat?.category_id != null && cat?.category_name) {
        movieCategories.set(String(cat.category_id), String(cat.category_name));
      }
    }

    for (const cat of unwrapXtreamArray(value(5))) {
      if (cat?.category_id != null && cat?.category_name) {
        seriesCategories.set(String(cat.category_id), String(cat.category_name));
      }
    }

    const allowed = Array.isArray(userInfo.allowed_output_formats)
      ? userInfo.allowed_output_formats.map(v => String(v).toLowerCase())
      : [];

    /* Para navegador/Android/TV, TS é o caminho principal quando
       a conta oferece TS. HLS continua disponível como fallback. */
    const liveExtension = allowed.includes("ts")
      ? "ts"
      : "m3u8";

    const items = [];
    const seriesCatalog = [];
    const groups = new Set();

    /* ================= TV AO VIVO ================= */
    for (const row of live) {
      const id = row?.stream_id ?? row?.id;
      if (id == null || !row?.name) continue;

      const group = getXtreamCategoryName(
        liveCategories,
        row.category_id,
        "TV AO VIVO"
      );

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

    /* ================= FILMES ================= */
    for (const row of movies) {
      const id = row?.stream_id ?? row?.id;
      if (id == null || !row?.name) continue;

      const group = getXtreamCategoryName(
        movieCategories,
        row.category_id,
        "FILMES"
      );

      const extension = String(
        row.container_extension || "mp4"
      ).replace(/^\./, "").toLowerCase();

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

    /* ================= SÉRIES ================= */
    for (const row of series) {
      const id = row?.series_id ?? row?.id;
      if (id == null || !row?.name) continue;

      const title = String(row.name).trim();
      const key = normalizeText(title);

      const group = getXtreamCategoryName(
        seriesCategories,
        row.category_id,
        "SÉRIES"
      );

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
        backdrop: Array.isArray(row.backdrop_path)
          ? (row.backdrop_path[0] || "")
          : "",
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

    console.log("[GC PLAY PRO] Catálogo Xtream completo:", {
      live: live.length,
      movies: movies.length,
      series: series.length,
      total: items.length
    });

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

    console.warn(
      "[GC PLAY PRO] Xtream completo indisponível; usando M3U:",
      error
    );

    return null;
  }
}
/* =========================================================
   CARREGAMENTO XTREAM SOB DEMANDA
   ========================================================= */

async function ensureXtreamSectionLoaded(type) {
  const session = state.xtreamSession;
  if (!session || !["movie","series"].includes(type)) return false;

  const current = state.counts?.[type] || 0;
  if (current > 0) return true;

  if (state.__xtreamLoading?.[type]) return state.__xtreamLoading[type];

  state.__xtreamLoading = state.__xtreamLoading || {};
  state.__xtreamLoading[type] = (async () => {
    try {
      const actionCategories = type === "movie" ? "get_vod_categories" : "get_series_categories";
      const actionStreams = type === "movie" ? "get_vod_streams" : "get_series";

      const [catResult, streamResult] = await Promise.all([
        fetchXtreamJSON(session, actionCategories, undefined),
        fetchXtreamJSON(session, actionStreams, undefined)
      ]);

      const catMap = new Map();
      for (const cat of unwrapXtreamArray(catResult)) {
        if (cat?.category_id != null && cat?.category_name) {
          catMap.set(String(cat.category_id), String(cat.category_name));
        }
      }

      const rows = unwrapXtreamArray(streamResult);
      const items = [];
      const seriesCatalog = [];
      const groups = new Set();

      for (const row of rows) {
        const id = row?.stream_id ?? row?.series_id ?? row?.id;
        if (id == null || !row?.name) continue;

        const title = String(row.name).trim();
        const group = getXtreamCategoryName(catMap, row.category_id, type === "movie" ? "FILMES" : "SÉRIES");

        if (type === "movie") {
          const extension = String(row.container_extension || "mp4").replace(/^\./, "").toLowerCase();
          items.push({
            id: "xt-movie-" + id,
            name: title,
            nameLower: normalizeText(title),
            group,
            type: "movie",
            url: buildXtreamStreamUrl(session, "movie", id, extension),
            logo: row.stream_icon || "",
            tvgId: "", tvgName: "", country: "", language: "",
            seriesName: "", seriesKey: "", season: null, episode: null,
            seriesSeason: ["",0], genre: getGenreName(group),
            xtreamKind: "movie", xtreamStreamId: String(id),
            xtreamExtension: extension, rating: row.rating ?? null
          });
        } else {
          const key = normalizeText(title);
          const item = {
            id: "xt-series-" + id,
            name: title, nameLower: key, group, type: "series", url: "",
            logo: row.cover || row.stream_icon || "", tvgId: "", tvgName: title,
            country: "", language: "", seriesName: title, seriesKey: key,
            season: null, episode: null, seriesSeason: ["",0],
            genre: row.genre || getGenreName(group), xtreamKind: "series",
            xtreamSeriesId: String(id), plot: row.plot || "", cast: row.cast || "",
            director: row.director || "", rating: row.rating ?? null,
            releaseDate: row.releaseDate || row.release_date || "",
            backdrop: Array.isArray(row.backdrop_path) ? (row.backdrop_path[0] || "") : "",
            youtubeTrailer: row.youtube_trailer || "", episodeRunTime: row.episode_run_time || ""
          };
          items.push(item);
          seriesCatalog.push({...item, episodeCount:0, seasons:{}, xtreamSeriesId:String(id)});
        }
        groups.add(group);
      }

      if (!items.length) return false;

      await writeBatch(items, type === "series" ? seriesCatalog : []);
      for (const item of items.slice(0, RAM_LIMIT)) {
        const idx = state.items.findIndex(x => x.id === item.id);
        if (idx >= 0) state.items[idx] = item;
        else if (state.items.length < RAM_LIMIT) state.items.push(item);
      }

      state.counts[type] = items.length;
      state.total = state.counts.live + state.counts.movie + state.counts.series;
      state.groups = Array.from(new Set([...(state.groups || []), ...groups]));
      if (type === "series") {
        state.seriesCatalog = seriesCatalog;
        state.seriesCatalogMap = new Map(seriesCatalog.map(x => [x.seriesKey, x]));
        state.seriesCatalogReady = true;
      }
      await buildGenreCatalog();
      await loadDatabaseStats();
      renderGenreFilters();
      render();
      return true;
    } catch (error) {
      console.warn("[GC PLAY PRO] Carregamento sob demanda:", type, error);
      toast("Não foi possível carregar " + (type === "movie" ? "os filmes" : "as séries") + ".");
      return false;
    } finally {
      delete state.__xtreamLoading[type];
    }
  })();

  return state.__xtreamLoading[type];
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
  const baseUrl = resolvePlaylistUrl(url);

  /*
     Playlist M3U grande precisa ser recebida em streaming. Não usamos
     response.text()/json() aqui. Também fazemos uma segunda tentativa
     quando o proxy/origem retorna 502/503/504/429, sem duplicar a
     importação nem apagar o catálogo antes de obter uma resposta válida.
  */
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) {
      throw new DOMException("Operação cancelada", "AbortError");
    }

    const finalUrl = attempt === 0
      ? baseUrl
      : (baseUrl.includes("?")
        ? baseUrl + "&gc_retry=" + Date.now()
        : baseUrl + "?gc_retry=" + Date.now());

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 60000);
    const onAbort = () => timeoutController.abort();

    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await fetch(finalUrl, {
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

      if (!response.ok) {
        let detail = "";
        try {
          const contentType = response.headers.get("content-type") || "";
          if (contentType.includes("application/json")) {
            const data = await response.clone().json();
            if (data?.error) detail = " — " + data.error;
            if (data?.detail) detail += " — " + data.detail;
            if (data?.status) detail += " [origem HTTP " + data.status + "]";
          }
        } catch {}

        const retryable = [429, 502, 503, 504].includes(response.status);
        lastError = new Error("Servidor respondeu HTTP " + response.status + detail);
        if (retryable && attempt === 0) continue;
        throw lastError;
      }

      if (!response.body) {
        throw new Error("O servidor não retornou um fluxo de dados.");
      }

      const contentType = (response.headers.get("content-type") || "").toLowerCase();

      if (/text\/html/i.test(contentType)) {
        throw new Error("A origem retornou uma página HTML em vez de uma playlist M3U.");
      }

      /* Se a URL de importação caiu em um arquivo de mídia, não deixe o
         parser consumir megabytes e terminar silenciosamente com 0 itens. */
      if (/(video\/mp4|video\/mp2t|audio\/mpeg|audio\/mp4)/i.test(contentType)) {
        throw new Error(
          "A URL da lista retornou um arquivo de mídia (" + contentType +
          "), não uma playlist M3U."
        );
      }

      return response;
    } catch (error) {
      lastError = error;

      if (signal?.aborted) {
        throw new DOMException("Operação cancelada", "AbortError");
      }

      if (error?.name === "AbortError") {
        if (attempt === 0) continue;
        throw new Error("Tempo limite excedido ao conectar à playlist/proxy (60s).");
      }

      if (attempt === 0 && /HTTP (429|502|503|504)/.test(String(error?.message || ""))) {
        continue;
      }

      throw new Error(
        error?.message || ("Falha de conexão com a playlist: " + error)
      );
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  throw lastError || new Error("Não foi possível acessar a playlist.");
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

function resetToPlaylistHome() {
  state.currentSection = "home";
  state.currentFilter = "all";
  state.currentGenre = "all";
  state.searchTerm = "";
  state.seriesView.seriesKey = null;
  state.seriesView.season = null;
  state.adultUnlocked = false;

  syncSectionNavigation("home");
  showHomeOrLibrary(true);
  renderGenreFilters();

  try {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  } catch {
    window.scrollTo(0, 0);
  }
}

function showHomeOrLibrary(showHome) {
  const dashboard = document.getElementById("homeDashboard");
  const library = document.getElementById("librarySection");
  const empty = document.getElementById("emptyState");
  if (dashboard) dashboard.style.display = showHome ? "block" : "none";
  if (library) library.style.display = showHome ? "none" : "block";
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
  /*
     A RAM_LIMIT é apenas uma amostra para a primeira pintura.
     Uma lista Xtream grande normalmente começa com milhares de
     canais, então filmes/séries podem estar somente no IndexedDB.
     Nunca podemos tratar "não achei na amostra" como "não existe".
  */
  const wantedType = type === "adult" ? null : type;
  const wantedGenre = normalizeText(genre);
  const wantedTerm = normalizeText(term);

  const matches = item => {
    if (!item) return false;

    if (type === "adult" ? !isAdultContent(item) : isAdultContent(item)) {
      return false;
    }

    if (wantedType && item.type !== wantedType) return false;

    if (
      genre !== "all" &&
      normalizeText(getGenreName(item.group)) !== wantedGenre
    ) {
      return false;
    }

    if (
      wantedTerm &&
      !(item.nameLower || normalizeText(item.name || "")).includes(wantedTerm) &&
      !normalizeText(item.group).includes(wantedTerm)
    ) {
      return false;
    }

    return true;
  };

  /*
     Se o catálogo completo não estiver disponível no banco,
     usamos a amostra local como fallback.
  */
  if (!state.db) {
    return state.items.filter(matches).slice(0, limit);
  }

  /*
     Para uma seção específica, o índice "type" garante que TV,
     filmes e séries sejam buscados em TODO o catálogo, e não
     apenas nos primeiros RAM_LIMIT registros.
  */
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

      if (matches(cursor.value)) {
        result.push(cursor.value);
      }

      cursor.continue();
    };

    request.onerror = () => reject(request.error);
  });
}

/* Busca global escalável: percorre o IndexedDB sem copiar centenas de milhares
   de registros para a RAM. Mantém apenas os melhores resultados. */
async function architectureGlobalSearch(term, limit = 100) {
  const query = normalizeText(term);
  if (!query) return [];
  if (!state.db) return state.items
    .filter(item => !isAdultContent(item))
    .map(item => ({ item, score: 0 }))
    .filter(x => normalizeText(x.item.name || "").includes(query))
    .slice(0, limit)
    .map(x => x.item);

  return new Promise((resolve, reject) => {
    const best = [];
    const transaction = state.db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).openCursor();

    const add = item => {
      if (!item || isAdultContent(item)) return;
      const name = normalizeText(item.name || "");
      const group = normalizeText(item.group || "");
      const series = normalizeText(item.seriesName || "");
      if (!name.includes(query) && !group.includes(query) && !series.includes(query)) return;

      let score = 0;
      if (name === query) score += 1000;
      else if (name.startsWith(query)) score += 600;
      else if (name.includes(query)) score += 400;
      if (series.startsWith(query)) score += 250;
      if (group.includes(query)) score += 80;
      if (item.type === "series") score += 20;

      best.push({item,score});
      best.sort((a,b)=>b.score-a.score);
      if (best.length > limit) best.length = limit;
    };

    request.onsuccess = event => {
      const cursor = event.target.result;
      if (!cursor) {
        resolve(best.map(x=>x.item));
        return;
      }
      add(cursor.value);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

window.GCArchitectureGlobalSearch = architectureGlobalSearch;

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

  let items = await queryCatalogItems({
    type,
    genre: state.currentGenre,
    term: state.searchTerm,
    limit: 120
  });

  /* TV ao vivo precisa continuar visível mesmo se o índice IndexedDB
     estiver atrasado/corrompido. A RAM já contém os canais importados. */
  if (!items.length && type === "live") {
    items = state.items
      .filter(item => item && item.type === "live" && !isAdultContent(item))
      .slice(0, 120);
  }

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
async function ensureSeriesCatalogFromM3U() {
  if (!state.xtreamSeriesFallbackNeeded || !state.playlistMeta.url) return true;
  if (state.seriesFallbackPromise) return state.seriesFallbackPromise;

  state.seriesFallbackPromise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    const batches = [];
    let batch = [];
    let added = 0;

    try {
      updateLoadMessage("Séries: procurando episódios na M3U...");
      const response = await fetchPlaylist(state.playlistMeta.url, controller.signal);

      for await (const item of parseM3UStream(response, controller.signal)) {
        if (!item || item.type !== "series" || !item.url) continue;
        batch.push(item);
        added++;

        if (batch.length >= 10000) {
          batches.push(batch);
          batch = [];
        }

        if (added % 5000 === 0) {
          updateLoadMessage("Séries: " + formatNumber(added) + " episódios encontrados...");
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      if (batch.length) batches.push(batch);

      if (!added) {
        state.xtreamSeriesFallbackNeeded = false;
        updateLoadMessage("Nenhuma série foi encontrada na M3U.");
        return false;
      }

      for (const part of batches) {
        await writeBatch(part);
      }

      state.seriesCatalog = [];
      state.seriesCatalogMap = new Map();
      state.seriesKeyAliases = new Map();
      state.seriesCatalogReady = false;
      state.seriesItemsCache = null;

      await rebuildSeriesCatalogInBackground(true);
      await buildGenreCatalog();
      await loadDatabaseStats();
      renderGenreFilters();

      state.xtreamSeriesFallbackNeeded = false;
      toast("Séries encontradas: " + formatNumber(state.seriesCatalog.length), 4500);
      return true;
    } catch (error) {
      console.warn("[GC PLAY PRO] Fallback de séries M3U:", error);
      toast(error?.name === "AbortError"
        ? "A busca de séries demorou demais. Tente novamente."
        : "Não foi possível localizar as séries na M3U.");
      return false;
    } finally {
      clearTimeout(timeout);
      state.seriesFallbackPromise = null;
    }
  })();

  return state.seriesFallbackPromise;
}

async function renderSeriesBrowser(grid,empty) {
  if (state.xtreamSeriesFallbackNeeded && !state.seriesCatalog.length) {
    grid.innerHTML = `
      <div class="gc-loading">
        <span class="gc-spinner"></span>
        Séries não vieram pela API. Procurando episódios na sua M3U...
      </div>
    `;
    await ensureSeriesCatalogFromM3U();
  }

  let items=await getFilteredSeriesItems();

  /* Se o índice de séries ainda estiver vazio, reconstrói a partir do
     IndexedDB antes de declarar que não existem séries. Isso evita a
     tela vazia quando a lista já foi importada, mas o catálogo derivado
     ainda não terminou de ser criado. */
  if(!items.length && state.db){
    try{
      await rebuildSeriesCatalogInBackground(true);
      items=await getFilteredSeriesItems();
    }catch(error){
      console.warn("[GC PLAY PRO] reconstrução de séries:",error);
    }
  }

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
  const diagnostics = window.GCArchitecture?.diagnostics;
  diagnostics?.record?.("series_rebuild_start", {
    force: !!force,
    cached: Array.isArray(state.seriesCatalog) ? state.seriesCatalog.length : 0
  });

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
          /*
             IMPORTANTE: usar primeiro o seriesKey já gravado no item.
             O item foi normalizado na importação e já possui a chave
             da série. Reinterpretar somente o nome aqui fazia muitos
             episódios perderem o agrupamento e virarem "séries" individuais.
          */
          /*
             Reconstruir a chave a partir do NOME ORIGINAL.
             Registros antigos podem ter seriesName/seriesKey gravados
             com o episódio junto; usar esses campos aqui perpetuaria
             a contagem de episódios como se fossem séries.
          */
          const rawInfo = extractSeriesInfo(item);
          const canonicalName = canonicalSeriesTitle(
            rawInfo.seriesName || item.name
          );
          const info = {
            ...rawInfo,
            seriesName: canonicalName,
            seriesKey: normalizeText(canonicalName),
            genre: item.genre || rawInfo.genre || getGenreName(item.group)
          };
          /*
             Guardar a chave ORIGINAL do episódio para criar um alias
             real. Antes usávamos info.seriesKey, que já era a chave
             canônica reconstruída, então os seriesKey antigos do
             IndexedDB nunca eram associados à nova série.
          */
          const storedKey = String(
            item.seriesKey || ""
          ).trim();
          const canonicalKey = normalizeText(
            canonicalName
          );

          if (storedKey) {
            aliases.set(storedKey, canonicalKey);
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
              xtreamSeriesId: item.xtreamSeriesId ? String(item.xtreamSeriesId) : "",
              episodeCount: 0,
              seasons: {}
            };

            map.set(canonicalKey, entry);
          }

          if (!entry.logo && item.logo) {
            entry.logo = item.logo;
          }
          if (!entry.xtreamSeriesId && item.xtreamSeriesId) {
            entry.xtreamSeriesId = String(item.xtreamSeriesId);
          }

          const detectedSeason =
            info.season !== null && info.season !== undefined
              ? Number(info.season)
              : (item.season !== null && item.season !== undefined ? Number(item.season) : 1);

          const season = String(Number.isFinite(detectedSeason) && detectedSeason > 0 ? detectedSeason : 1);
          entry.seasons[season] =
            Number(entry.seasons[season] || 0) + 1;

          entry.episodeCount++;
        }

        scanned++;

        /*
           IMPORTANTE: não usar setTimeout aqui.
           O cursor pertence à transação IndexedDB e a transação
           pode ficar inativa quando o controle volta ao event loop.
           Nesse caso cursor.continue() falha e o catálogo permanece
           com a contagem bruta de episódios.
        */
        cursor.continue();
      };

      request.onerror = () => reject(request.error);
    });

    const result = Array.from(map.values()).map(entry => {
      const seasons = {};
      for (const [season, count] of Object.entries(entry.seasons || {})) {
        seasons[String(Number(season))] = Number(count || 0);
      }
      entry.seasons = seasons;
      entry.seasonCount = Object.keys(seasons).length;
      return entry;
    }).sort((a,b) =>
      String(a.seriesName || "").localeCompare(String(b.seriesName || ""), "pt-BR", { sensitivity: "base" })
    );

    diagnostics?.record?.("series_rebuild_complete", {
      series: result.length,
      episodes: result.reduce((n, item) => n + Number(item.episodeCount || 0), 0),
      seasons: result.reduce((n, item) => n + Number(item.seasonCount || 0), 0)
    });

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
    state.seriesCatalogChanged = new Set(result.map(item => item.seriesKey));

    /* O contador mostra séries únicas; episódios ficam dentro
       de cada série/temporada. */
    state.counts.series = result.length;
    renderStats();

    if (state.currentFilter === "series") {
      render();
    }
  } catch (error) {
    diagnostics?.record?.("series_rebuild_error", {
      error: String(error?.message || error)
    });
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
    const indexed = window.GCArchitecture?.search?.search?.(items, term, items.length) || [];
    const allowed = new Set(indexed.map(item => item.seriesKey));
    items = indexed.length
      ? items.filter(item => allowed.has(item.seriesKey))
      : items.filter(item =>
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
              const detectedSeason =
                info.season ??
                (item.season !== null && item.season !== undefined
                  ? Number(item.season)
                  : null);
              return Number(detectedSeason ?? 1) === Number(season);
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

  /* Xtream: carregamento sob demanda da série inteira. Não limitar por temporada
     antes de receber a resposta, pois alguns provedores só retornam a estrutura
     completa quando a série é consultada. */
  if (selectedSeries?.xtreamSeriesId && state.xtreamSession) {
    try {
      const result = await fetchXtreamSeriesEpisodes(
        selectedSeries,
        season,
        state.loadAbort?.signal
      );

      const dynamic = window.__GC_DYNAMIC_ITEMS__ ||
        (window.__GC_DYNAMIC_ITEMS__ = new Map());

      for (const episode of result) {
        if (episode?.id) dynamic.set(String(episode.id), episode);
      }

      return result.sort((a,b) =>
        Number(a.season ?? 999999) - Number(b.season ?? 999999) ||
        Number(a.episode ?? 999999) - Number(b.episode ?? 999999)
      );
    } catch (error) {
      console.warn("[GC PLAY PRO] Episódios Xtream:", error);
      window.GCArchitecture?.diagnostics?.push?.("series_episode_fallback", {
        seriesKey,
        error: String(error?.message || error)
      });
    }
  }

  const keys = new Set([seriesKey]);
  for (const [oldKey, canonicalKey] of state.seriesKeyAliases) {
    if (canonicalKey === seriesKey) keys.add(oldKey);
  }

  const result = [];
  const seen = new Set();

  for (const key of keys) {
    const batch = await querySeriesEpisodesByKey(key, season);
    for (const item of batch) {
      const id = String(item.id || "");
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);

      const info = extractSeriesInfo(item);
      const normalizedSeason =
        item.season != null ? Number(item.season) :
        info.season != null ? Number(info.season) : 1;

      if (season !== null && normalizedSeason !== Number(season)) continue;

      result.push({
        ...item,
        type: "series",
        seriesKey,
        seriesName: selectedSeries?.seriesName || info.seriesName,
        season: normalizedSeason,
        episode: item.episode != null ? Number(item.episode) :
          info.episode != null ? Number(info.episode) : null
      });
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
   MPEG-DASH / CMAF PLAYER
   ========================================================= */

function loadDASH() {
  if (window.dashjs) return Promise.resolve(window.dashjs);

  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-gc-dash="1"]');

    if (existing) {
      existing.addEventListener("load", () => resolve(window.dashjs), { once: true });
      existing.addEventListener("error", () => reject(new Error("dash.js não foi carregado.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.dashjs.org/v5.2.1/modern/umd/dash.all.min.js";
    script.async = true;
    script.dataset.gcDash = "1";

    script.onload = () => {
      if (window.dashjs) resolve(window.dashjs);
      else reject(new Error("dash.js não foi carregado."));
    };

    script.onerror = () => reject(new Error("Não foi possível carregar dash.js."));
    document.head.appendChild(script);
  });
}

async function playDASH(video, url, message, directFallbackUrl = "") {
  let player = null;

  try {
    const dashjs = await loadDASH();

    if (!dashjs || !dashjs.MediaPlayer) {
      throw new Error("dash.js não está disponível neste navegador.");
    }

    if (state.dash) {
      try { state.dash.reset(); } catch {}
      state.dash = null;
    }

    player = dashjs.MediaPlayer().create();
    state.dash = player;

    /* DASH/CMAF: manifesto e segmentos usam a origem do provedor. */
    const requestInterceptor = request => Promise.resolve(request);
    player.addRequestInterceptor(requestInterceptor);

    player.on(dashjs.MediaPlayer.events.ERROR, event => {
      console.warn("DASH ERROR:", event);
      if (message) message.textContent = "Erro no fluxo DASH. Tentando reconectar...";
    });

    player.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, async () => {
      if (message) message.textContent = "";
      if (state.settings.autoplay) {
        try { await video.play(); } catch {}
      }
    });

    player.initialize(video, url, false);

    try {
      player.updateSettings({
        streaming: {
          delay: {
            liveDelay: 3,
            liveDelayFragmentCount: 3
          },
          liveCatchup: {
            maxDrift: 0.5,
            playbackRate: {
              min: -0.25,
              max: 0.25
            }
          }
        }
      });
    } catch (settingsError) {
      console.warn("DASH low-latency settings:", settingsError);
    }

    if (message) message.textContent = "Conectando ao DASH/CMAF...";

    const startupTimer = setTimeout(() => {
      if (video.readyState >= 2 || video.videoWidth > 0) return;

      if (directFallbackUrl && !video.__gcDashDirectRetry) {
        video.__gcDashDirectRetry = "1";
        try { player.reset(); } catch {}
        if (state.dash === player) state.dash = null;
        video.src = directFallbackUrl;
        video.load();
        if (message) message.textContent = "Tentando conexão direta...";
        if (state.settings.autoplay) video.play().catch(() => {});
      } else if (message) {
        message.textContent = "O canal DASH está demorando para responder.";
      }
    }, 12000);

    video.addEventListener("loadeddata", () => {
      clearTimeout(startupTimer);
      if (message) message.textContent = "";
    }, { once: true });

    video.addEventListener("playing", () => {
      clearTimeout(startupTimer);
      if (message) message.textContent = "";
    }, { once: true });

    return true;
  } catch (error) {
    console.error("Erro DASH:", error);
    if (player) {
      try { player.reset(); } catch {}
    }
    if (state.dash === player) state.dash = null;

    if (directFallbackUrl && !video.__gcDashDirectRetry) {
      video.__gcDashDirectRetry = "1";
      video.src = directFallbackUrl;
      video.load();
      if (message) message.textContent = "DASH indisponível — tentando conexão direta...";
      if (state.settings.autoplay) video.play().catch(() => {});
      return false;
    }

    if (message) message.textContent = "Não foi possível iniciar este fluxo DASH/CMAF.";
    return false;
  }
}

/* =========================================================
   MPEG-TS PLAYER
   ========================================================= */

function loadMpegTS() {
  if (window.mpegts) return Promise.resolve(window.mpegts);
  if (window.__GC_MPEGTS_LOAD__) return window.__GC_MPEGTS_LOAD__;

  const urls = [
    "https://cdn.jsdelivr.net/npm/mpegts.js@1.8.2/dist/mpegts.min.js",
    "https://unpkg.com/mpegts.js@1.8.2/dist/mpegts.min.js"
  ];

  window.__GC_MPEGTS_LOAD__ = (async () => {
    let lastError = null;

    for (const src of urls) {
      try {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = src;
          script.async = true;
          script.dataset.gcMpegts = "1";

          const timer = setTimeout(() => {
            script.remove();
            reject(new Error("Tempo esgotado ao carregar mpegts.js."));
          }, 5000);

          script.onload = () => {
            clearTimeout(timer);
            if (window.mpegts) resolve();
            else reject(new Error("mpegts.js carregou sem criar window.mpegts."));
          };

          script.onerror = () => {
            clearTimeout(timer);
            script.remove();
            reject(new Error("Falha ao carregar " + src));
          };

          document.head.appendChild(script);
        });

        console.log("[GC MPEGTS] biblioteca carregada:", src);
        return window.mpegts;
      } catch (error) {
        lastError = error;
        console.warn("[GC MPEGTS] tentativa falhou:", src, error);
      }
    }

    throw lastError || new Error("Não foi possível carregar mpegts.js.");
  })().catch(error => {
    window.__GC_MPEGTS_LOAD__ = null;
    throw error;
  });

  return window.__GC_MPEGTS_LOAD__;
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
  message,
  directFallbackUrl = "",
  secondaryFallbackUrl = ""
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
          enableWorker: false,
          enableWorkerForMSE: false,
          enableStashBuffer: true,
          stashInitialSize: 96 * 1024,
          lazyLoad: false,
          /* Evita depender do sourceopen para iniciar o primeiro request. */
          deferLoadAfterSourceOpen: false,
          seekType: "range",
          rangeLoadZeroStart: true,
          liveBufferLatencyChasing: false,
          liveSync: false,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 30,
          autoCleanupMinBackwardDuration: 10
        }
      );

    state.mpegts =
      player;

    let startupResolved = false;
    let startupTimer = null;

    const clearStartupTimer = () => {
      if (startupTimer) {
        clearTimeout(startupTimer);
        startupTimer = null;
      }
    };

    /*
       Alguns navegadores bloqueiam o primeiro player.play() do MPEG-TS
       por política de reprodução automática. Quando isso acontecer,
       o próximo toque no ▶ nativo do vídeo deve retomar o MESMO motor
       MPEG-TS, sem trocar URL, proxy ou estratégia dos demais canais.
       Esta rotina só fica armada quando a primeira tentativa falha,
       portanto os canais que já funcionam seguem pelo caminho normal.
    */
    const installMpegUserGestureResume = (activePlayer) => {
      try {
        if (typeof video.__gcMpegResumeCleanup === "function") {
          video.__gcMpegResumeCleanup();
        }
      } catch {}

      let waitingForGesture = false;

      const onVideoPlay = async () => {
        if (!waitingForGesture) return;
        if (state.mpegts !== activePlayer) return;

        waitingForGesture = false;

        try {
          /*
             Quando o primeiro play foi bloqueado, o mpegts.js pode ter
             ficado apenas com o pipeline criado, sem disparar a busca
             do .ts. No toque real do usuário, recarregamos o MESMO
             player e iniciamos novamente dentro da interação.
          */
          try {
            activePlayer.unload();
          } catch {}

          activePlayer.load();
          await activePlayer.play();

          if (message) {
            message.textContent = "Conectando ao canal MPEG-TS...";
          }
        } catch (error) {
          waitingForGesture = true;
          console.warn(
            "[GC PLAY PRO] toque manual não iniciou MPEG-TS:",
            error
          );

          if (message) {
            message.textContent =
              "Toque em ▶ para iniciar o canal.";
          }
        }
      };

      video.addEventListener("play", onVideoPlay);

      video.__gcMpegResumeCleanup = () => {
        video.removeEventListener("play", onVideoPlay);
        if (video.__gcMpegResumeCleanup === cleanup) {
          video.__gcMpegResumeCleanup = null;
        }
      };

      const cleanup = video.__gcMpegResumeCleanup;

      return {
        waitForGesture() {
          waitingForGesture = true;
        },
        cleanup
      };
    };

    const trySecondaryHlsFallback = async () => {
      if (!secondaryFallbackUrl || video.__gcMpegHlsRetry) return false;
      video.__gcMpegHlsRetry = "1";

      clearStartupTimer();

      try {
        if (state.mpegts === player) {
          player.destroy();
          state.mpegts = null;
        }
      } catch {}

      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {}

      if (message) {
        message.textContent = "Tentando HLS alternativo...";
      }

      try {
        await playHLS(
          video,
          secondaryFallbackUrl,
          message,
          ""
        );
        return true;
      } catch (error) {
        console.warn("[GC PLAY PRO] fallback HLS falhou:", error);
        return false;
      }
    };

    const tryDirectFallback = () => {
      if (!directFallbackUrl || video.__gcMpegDirectRetry) return false;
      video.__gcMpegDirectRetry = "1";
      clearStartupTimer();

      try {
        if (state.mpegts === player) {
          player.destroy();
          state.mpegts = null;
        }
      } catch {}

      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {}

      if (message) {
        message.textContent = "Tentando conexão direta MPEG-TS...";
      }

      try {
        const directPlayer = mpegts.createPlayer(
          {
            type: "mpegts",
            isLive: true,
            url: directFallbackUrl,
            cors: true,
            hasAudio: true,
            hasVideo: true
          },
          {
            enableWorker: false,
            enableWorkerForMSE: false,
            enableStashBuffer: true,
            stashInitialSize: 256 * 1024,
            lazyLoad: false,
            deferLoadAfterSourceOpen: false,
            seekType: "range",
            rangeLoadZeroStart: true,
            liveBufferLatencyChasing: false,
            liveSync: false,
            autoCleanupSourceBuffer: true
          }
        );

        state.mpegts = directPlayer;

        let directResolved = false;
        const directTimer = setTimeout(() => {
          if (!directResolved && video.readyState < 2) {
            if (!trySecondaryHlsFallback()) {
              if (message) {
                message.textContent = "O canal não entregou um fluxo MPEG-TS válido.";
              }
            }
          }
        }, 7000);

        directPlayer.on(mpegts.Events.ERROR, (type, detail, info) => {
          console.warn("[GC PLAY PRO] MPEG-TS direto:", type, detail, info);
          if (directResolved) return;

          clearTimeout(directTimer);

          const textDetail = String(detail || type || "").toLowerCase();
          const retryable =
            textDetail.includes("httpstatus") ||
            textDetail.includes("network") ||
            textDetail.includes("timeout") ||
            textDetail.includes("early_eof") ||
            textDetail.includes("unrecoverable");

          if (retryable || !video.videoWidth) {
            if (!trySecondaryHlsFallback() && message) {
              message.textContent = "O canal não entregou um fluxo compatível.";
            }
          }
        });

        directPlayer.attachMediaElement(video);

        const directUserGesture = installMpegUserGestureResume(directPlayer);

        directPlayer.load();

        directPlayer.play().catch(() => {
          directUserGesture.waitForGesture();

          if (message) {
            message.textContent = "Toque em ▶ para iniciar o canal.";
          }
        });

        const markDirectReady = () => {
          directResolved = true;
          clearTimeout(directTimer);
          if (message) message.textContent = "";
        };

        video.addEventListener("loadeddata", markDirectReady, { once: true });
        video.addEventListener("playing", markDirectReady, { once: true });

        return true;
      } catch (error) {
        console.warn("[GC PLAY PRO] falha MPEG-TS direto:", error);
        return trySecondaryHlsFallback();
      }
    };
    video.addEventListener("loadeddata", () => {
      startupResolved = true;
      clearStartupTimer();
      if (message) message.textContent = "";
    }, { once: true });

    /* Não deixe um proxy travado prender o canal por 12s.
       Se o upstream não responder, tenta a origem direta rapidamente. */
    startupTimer = setTimeout(() => {
      if (startupResolved || video.readyState >= 2) return;
      if (!tryDirectFallback() && message) {
        message.textContent = "O canal está demorando para responder.";
      }
    }, 6000);

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
        const httpInvalid =
          String(errorDetail || "").toLowerCase().includes("httpstatuscodeinvalid");

        /*
           Alguns servidores Xtream aceitam o mesmo stream diretamente,
           mas recusam a requisição feita pelo proxy (ou devolvem 403/404
           para uma extensão específica). Nesses casos o mpegts.js emite
           HTTP_STATUS_CODE_INVALID. Antes nós apenas exibíamos o erro.
           Agora fazemos fallback imediato para a origem direta.
        */
        if (httpInvalid) {
          if (!tryDirectFallback()) {
            trySecondaryHlsFallback();
          }
          return;
        }

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
              tryDirectFallback();
            }
          }, 900);
        }
      }
    );

    player.attachMediaElement(
      video
    );

    const mpegUserGesture = installMpegUserGestureResume(player);

    player.load();

    if (message) {
      message.textContent =
        "Conectando ao canal MPEG-TS...";
    }

    try {
      /*
         IMPORTANTE:
         player.play() apenas inicia o pipeline MSE. Em MPEG-TS ao vivo
         ele pode resolver a Promise antes de existir um frame de vídeo.
         Portanto NÃO limpamos a mensagem aqui. O status só é removido
         pelos eventos loadeddata/playing acima, quando há dados reais.
      */
      await player.play();

      if (
        video.readyState >= 2 ||
        video.videoWidth > 0 ||
        video.videoHeight > 0
      ) {
        startupResolved = true;
        clearStartupTimer();

        if (message) {
          message.textContent = "";
        }
      } else if (message) {
        message.textContent =
          "Motor iniciado — aguardando dados do canal...";
      }
    } catch (error) {
      console.warn(
        "MPEG-TS autoplay:",
        error
      );

      mpegUserGesture.waitForGesture();

      if (message) {
        message.textContent =
          "Motor iniciado — toque em ▶ para iniciar o canal.";
      }
    }

  } catch (error) {
    console.error(
      "Erro MPEG-TS:",
      error
    );

    if (message) {
      message.textContent =
        "O canal ao vivo não respondeu. O player tentou reconectar e usar a conexão direta.";
    }
  }
}

window.__GC_NATIVE_PLAY_MPEGTS__ = playMpegTS;
window.playMpegTS = playMpegTS;

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

  if (state.dash) {
    try {
      state.dash.reset();
    } catch {}
    state.dash = null;
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

async function probeMediaSource(url) {
  const target = String(url || "");
  if (!shouldUseProxy(target)) return { ok: true };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch(target, {
      method: "GET",
      cache: "no-store",
      headers: { "Range": "bytes=0-1", "Accept": "video/*,audio/*,*/*" },
      signal: controller.signal
    });

    const contentType = response.headers.get("content-type") || "";
    const contentLength = response.headers.get("content-length") || "";
    let detail = "";

    if (contentType.includes("application/json")) {
      try {
        const data = await response.clone().json();
        detail = [data?.error, data?.detail, data?.status ? "HTTP origem " + data.status : ""]
          .filter(Boolean).join(" — ");
      } catch {}
    }

    try { await response.body?.cancel(); } catch {}

    return {
      ok: response.ok && !contentType.includes("application/json") && !/text\/html/i.test(contentType),
      status: response.status,
      contentType,
      contentLength,
      detail
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      contentType: "",
      contentLength: "",
      detail: error?.name === "AbortError" ? "tempo limite de 7s" : (error?.message || String(error))
    };
  } finally {
    clearTimeout(timer);
  }
}

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

  const earlyUrl = String(item.url || "");
  const earlyLive = item.type === "live" || earlyUrl.includes("/live/") || earlyUrl.includes("/stream/") || earlyUrl.includes("/channel/") || earlyUrl.includes("/play/") || earlyUrl.includes("/tv/");
  const earlyMode = isDASH(earlyUrl) ? "DASH/CMAF" : isHLS(earlyUrl) ? "HLS" : earlyLive ? "MPEG-TS AO VIVO" : "VÍDEO";
  if (title) title.textContent = item.name;
  if (message) message.textContent = "Conectando ao " + earlyMode + "...";
  if (panel) { panel.classList.remove("hidden"); panel.classList.add("active", "open", "show"); }

  if (state.epgTimer) {
    clearInterval(state.epgTimer);
    state.epgTimer = null;
  }

  /* EPG não deve bloquear o início do vídeo. Carrega em paralelo. */
  if (item.type === "live") {
    Promise.resolve().then(() => loadLiveEPG(item)).catch(() => {});
  }

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
    message.textContent = "Iniciando motor...";
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

  if (state.dash) {
    try {
      state.dash.reset();
    } catch {}
    state.dash = null;
  }

  if (video && state.currentItem) {
    saveResumePosition(state.currentItem, video);
  }

  try {
    video.pause();
  } catch {}

  video.removeAttribute("src");
  delete video.dataset.gcProxyRetry;
  delete video.__gcMpegDirectRetry;

  try {
    video.load();
  } catch {}

  /*
     Corrige registros Xtream antigos que ficaram no IndexedDB com
     extensão truncada (ex.: p4/kv). A URL de reprodução deve ser
     reconstruída a partir do ID Xtream atual, nunca confiar cegamente
     no URL persistido de uma versão antiga do aplicativo.
  */
  if (
    state.xtreamSession &&
    item.xtreamKind &&
    item.xtreamStreamId &&
    ["movie", "episode", "live"].includes(String(item.xtreamKind))
  ) {
    let ext = String(item.xtreamExtension || "").replace(/^\./, "").toLowerCase();

    if (ext === "p4") ext = "mp4";
    if (ext === "kv") ext = "mkv";

    if (!ext) {
      ext = item.xtreamKind === "live"
        ? String(state.xtreamSession.liveExtension || "m3u8").toLowerCase()
        : "mp4";
    }

    item = {
      ...item,
      url: buildXtreamStreamUrl(
        state.xtreamSession,
        item.xtreamKind === "episode" ? "series" : item.xtreamKind,
        item.xtreamStreamId,
        ext
      ),
      xtreamExtension: ext
    };
  }

  const originalUrl =
    item.url;

  /*
     Xtream ao vivo: no Chrome/Android priorizamos HLS (.m3u8).
     O MPEG-TS (.ts) fica reservado como fallback caso o HLS
     não entregue o manifesto/segmentos.
  */
  const liveHlsUrl =
    item.xtreamKind === "live" &&
    state.xtreamSession &&
    item.xtreamStreamId
      ? buildXtreamStreamUrl(
          state.xtreamSession,
          "live",
          item.xtreamStreamId,
          "m3u8"
        )
      : originalUrl;

  const liveTsUrl =
    item.xtreamKind === "live" &&
    state.xtreamSession &&
    item.xtreamStreamId
      ? buildXtreamStreamUrl(
          state.xtreamSession,
          "live",
          item.xtreamStreamId,
          "ts"
        )
      : originalUrl;

  /*
     Xtream ao vivo: quando a conta oferece TS, usamos MPEG-TS como
     transporte principal. HLS fica como fallback. Isso atende melhor
     navegadores Android/TV e evita depender de HLS.js para o primeiro
     pedido do canal.
  */
  const liveExtension =
    String(state.xtreamSession?.liveExtension || "").toLowerCase();

  const gcAndroidLike =
    /Android|Android TV/i.test(navigator.userAgent || "");

  /*
     TV Xtream: HLS (.m3u8) passa a ser o transporte principal em
     todos os navegadores. É mais compatível com Android/TV e evita
     depender do MPEG-TS/MSE logo no primeiro frame. MPEG-TS continua
     disponível como fallback dentro de playHLS().
  */
  const sourceUrl =
    item.xtreamKind === "live"
      ? liveTsUrl
      : originalUrl;

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
    /\/tv\//i.test(sourceUrl);

  /*
     Conteúdo Xtream também passa pelo proxy desde o primeiro pedido.
     Isso evita que o navegador receba o arquivo de vídeo diretamente
     de um servidor sem CORS e só descubra a falha depois do código 4.
  */
  /*
     Para filmes e episódios Xtream, tente a origem diretamente.
     O elemento <video> consegue reproduzir mídia cross-origin sem
     exigir CORS para a simples reprodução. O proxy fica como
     fallback caso a origem bloqueie ou falhe.
     TV ao vivo/HLS continua usando o proxy desde o início porque
     seus manifestos/segmentos precisam do mesmo caminho de rede.
  */
  /*
     Todo conteúdo HTTP(S) que sai do servidor da playlist passa pelo
     proxy HTTPS do GC. Em GitHub Pages, uma origem HTTP pode ser
     bloqueada como mixed content antes mesmo do <video> conseguir
     reproduzir. Para Xtream isso também evita CORS e mantém Range,
     Content-Type e Content-Range no mesmo caminho.
  */
  const isVodFile =
    !looksLikeLiveStream &&
    !isHLS(sourceUrl) &&
    !isDASH(sourceUrl);

  /* Filmes/episódios: navegador tenta a origem nativa primeiro.
     Se falhar, o onerror abaixo troca automaticamente para o proxy GC. */
  /* VOD HTTP da nova lista: no GitHub Pages a origem direta pode
     ficar bloqueada por mixed-content/rede antes de disparar onerror.
     Para HTTP usamos o proxy desde o primeiro pedido. HTTPS continua
     tentando direto e mantém o proxy como fallback. */
  /* Playback é sempre direto; Cloudflare é somente catálogo. */
  const playbackUrl = sourceUrl;

  /* -------------------------------------------------------
     MPEG-TS AO VIVO
     ------------------------------------------------------- */

  /* -------------------------------------------------------
     MPEG-DASH / CMAF
     ------------------------------------------------------- */

  if (isDASH(sourceUrl)) {
    await playDASH(
      video,
      playbackUrl,
      message,
      sourceUrl !== playbackUrl ? sourceUrl : ""
    );
    return;
  }

  /* -------------------------------------------------------
     HLS
     ------------------------------------------------------- */

  if (isHLS(sourceUrl)) {
    const liveTsProxyFallback =
      item.xtreamKind === "live" && liveTsUrl !== sourceUrl
        ? (shouldUseProxy(liveTsUrl) ? buildProxyUrl(liveTsUrl) : liveTsUrl)
        : "";

    const liveTsDirectFallback =
      item.xtreamKind === "live" && liveTsUrl !== sourceUrl
        ? liveTsUrl
        : "";

    const liveDirectHlsFallback =
      item.xtreamKind === "live" && liveHlsUrl !== sourceUrl
        ? liveHlsUrl
        : (item.xtreamKind === "live" && isHLS(originalUrl) && originalUrl !== sourceUrl ? originalUrl : "");

    await playHLS(
      video,
      playbackUrl,
      message,
      liveTsProxyFallback,
      liveTsDirectFallback,
      liveDirectHlsFallback
    );

    return;
  }

  /* -------------------------------------------------------
     MPEG-TS AO VIVO
     ------------------------------------------------------- */

  if (looksLikeLiveStream) {
    if (message) {
      message.textContent = "Conectando ao MPEG-TS...";
    }

    try {
      // Usa o hotfix externo quando carregado; se ele falhar/não carregar,
      // cai automaticamente no motor integrado ao app.
      const livePlayer =
        typeof window.playMpegTS === "function"
          ? window.playMpegTS
          : playMpegTS;

      /* Alguns canais abertos da própria M3U usam uma URL de stream
         diferente da rota Xtream reconstruída. Preserve essa origem
         como fallback final em vez de obrigar todos os canais a usar
         /live/<user>/<pass>/<id>.ts. */
      const originalLiveIsHls =
        item.xtreamKind === "live" && isHLS(originalUrl);

      const hlsFallbackUrl =
        item.xtreamKind === "live"
          ? (
              originalLiveIsHls
                ? (shouldUseProxy(originalUrl) ? buildProxyUrl(originalUrl) : originalUrl)
                : (
                    liveHlsUrl !== sourceUrl
                      ? (shouldUseProxy(liveHlsUrl) ? buildProxyUrl(liveHlsUrl) : liveHlsUrl)
                      : ""
                  )
            )
          : "";

      const liveDirectFallback =
        item.xtreamKind === "live"
          ? (
              !originalLiveIsHls &&
              originalUrl &&
              originalUrl !== playbackUrl &&
              originalUrl !== liveTsUrl
                ? originalUrl
                : liveTsUrl
            )
          : (originalUrl !== playbackUrl ? originalUrl : "");

      await livePlayer(
        video,
        playbackUrl,
        message,
        liveDirectFallback,
        hlsFallbackUrl
      );
    } catch (error) {
      console.error("[GC PLAY PRO] erro ao iniciar TV ao vivo:", error);

      if (message) {
        message.textContent =
          "Falha ao iniciar o motor da TV ao vivo.";
      }
    }

    return;
  }

  /* -------------------------------------------------------
     VÍDEO NORMAL
     ------------------------------------------------------- */

  video.controls = true;
  video.playsInline = true;
  video.style.visibility = "visible";
  video.style.opacity = "1";

  if (message) {
    message.textContent = isVodFile
      ? "Abrindo vídeo..."
      : "Verificando fonte do vídeo...";
  }

  /* Não faça fetch/probe antes de filmes e episódios.
     Esse preflight pode falhar por CORS mesmo quando <video> consegue
     tocar a mídia cross-origin. O <video> será a autoridade final. */
  if (!isVodFile) {
    const probe = await probeMediaSource(playbackUrl);
    if (!probe.ok) {
      console.error("[GC PLAY PRO] pré-teste de mídia:", probe);

      if (message) {
        const ct = probe.contentType ? " • " + probe.contentType : "";
        const status = probe.status ? "HTTP " + probe.status : "";
        const detail = probe.detail ? " • " + probe.detail : "";
        message.textContent =
          "Fonte recusada" + (status ? " (" + status + ")" : "") + ct + detail;
      }
      return;
    }
  }

  video.src = playbackUrl;

  if (message) {
    message.textContent = "Carregando vídeo...";
  }

  let vodStartupTimer = null;
  const clearVodStartupTimer = () => {
    if (vodStartupTimer) {
      clearTimeout(vodStartupTimer);
      vodStartupTimer = null;
    }
  };

  video.onloadedmetadata = () => {
    clearVodStartupTimer();
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
    clearVodStartupTimer();
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
    clearVodStartupTimer();
    if (message) {
      message.textContent = "";
    }
  };

  video.onerror = () => {
    const mediaError = video.error;

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

        state.total = Number(processed || 0);

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

    /* A importação só é considerada concluída depois que TODA a fila
       do IndexedDB terminou. Antes disso, o cache podia ser salvo com
       apenas parte da playlist e a próxima abertura restaurava um banco
       incompleto. */
    while (writeProcessing || writeQueue.length) {
      if (writeError) throw writeError;
      await sleep(25);
    }

    if (writeError) throw writeError;

    /* O total representa itens/episódios importados. A contagem de
       séries, por outro lado, representa séries únicas. Não misture as
       duas métricas, senão uma playlist com episódios faz o total cair. */
    state.total = processed;

    try {
      const databaseGroups = await getGroups();
      if (databaseGroups.length) {
        state.groups = databaseGroups;
        localStorage.setItem("GC_PLAY_PRO_GROUPS_V1", JSON.stringify(state.groups));
      }
    } catch (groupError) {
      console.warn("[GC PLAY PRO] grupos finais:", groupError);
    }

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

  let matches = [];

  /*
   * Catálogos grandes não podem depender somente de state.items.
   * O backend global usa cursor do IndexedDB e continua funcionando
   * mesmo quando a memória contém apenas uma janela do catálogo.
   */
  if (typeof window.GCArchitectureGlobalSearch === "function") {
    try {
      matches = await window.GCArchitectureGlobalSearch(normalized, 100);
    } catch (error) {
      console.warn("[GC PLAY PRO] busca global:", error);
    }
  }

  if (requestId !== searchRequestId) return;

  if (!matches.length) {
    const unique = new Map();

    state.items
      .filter(item =>
        normalizeText(item.name || "").includes(normalized) ||
        normalizeText(item.group || "").includes(normalized) ||
        normalizeText(item.seriesName || "").includes(normalized)
      )
      .slice(0, 100)
      .forEach(item => unique.set(item.id, item));

    if (unique.size < 100 && state.db) {
      const dbMatches = await searchDatabase(
        normalized,
        100 - unique.size,
        requestId
      );
      if (requestId !== searchRequestId) return;
      dbMatches.forEach(item => unique.set(item.id, item));
    }

    matches = Array.from(unique.values()).slice(0, 100);
  }

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
