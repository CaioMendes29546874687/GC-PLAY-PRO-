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

/* O proxy é genérico: cada playlist pode usar um domínio diferente. */
const GC_PROXY_HOSTS = null;

const DB_NAME = "GC_PLAY_PRO_FAST";
const DB_VERSION = 5;
const STORE_NAME = "items";
const SERIES_STORE = "seriesCatalog";

const RAM_LIMIT = 3000;
const WRITE_BATCH = 500;

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

  genreCatalog: {
    all: [],
    live: [],
    movie: [],
    series: []
  },

  groupsReady: false,

  settings: {
    autoplay: true,
    compact: false
  }
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

    const settings = localStorage.getItem(SETTINGS_KEY);

    if (settings) {
      const data = JSON.parse(settings);

      state.settings = {
        ...state.settings,
        ...data
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

      if (!store.indexNames.contains("group")) {
        store.createIndex(
          "group",
          "group",
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

      if (!store.indexNames.contains("seriesSeason")) {
        store.createIndex(
          "seriesSeason",
          ["seriesKey", "season"],
          { unique: false }
        );
      }

      if (!store.indexNames.contains("typeGroup")) {
        store.createIndex(
          "typeGroup",
          ["type", "group"],
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

      await new Promise(
        requestAnimationFrame
      );
    }
  } catch (error) {
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

function classifyItem(name, group, url) {
  const text = normalizeText(
    `${name} ${group} ${url}`
  );
  const lowerUrl = String(url || "").toLowerCase();

  if (
    /\/series\//i.test(lowerUrl) ||
    /(?:^|[\s._()\[\]-])(?:s|season|t|temporada)\s*\d+\s*(?:e|ep|episode|episodio)\s*\d+/i.test(text) ||
    /(?:^|[\s._()\[\]-])\d+\s*x\s*\d+/i.test(text) ||
    text.includes("serie") ||
    text.includes("series")
  ) {
    return "series";
  }

  if (
    /\/movie(?:s)?\//i.test(lowerUrl) ||
    text.includes("filme") ||
    text.includes("filmes") ||
    text.includes("movie") ||
    text.includes("movies") ||
    text.includes("vod")
  ) {
    return "movie";
  }

  return "live";
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

  /*
     Limpeza final: remove números de episódio/temporada
     que tenham ficado colados ao título por separadores
     incomuns usados por provedores IPTV.
  */
  seriesName = seriesName
    .replace(/\s*[-_.:#|]+\s*$/g, "")
    .trim();

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

    ...(() => {
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
  };
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
   FETCH COM ABORT
   ========================================================= */

async function fetchPlaylist(url, signal) {
  const finalUrl =
    resolvePlaylistUrl(url);

  const response = await fetch(
    finalUrl,
    {
      method: "GET",
      signal,

      headers: {
        "Accept":
          "application/vnd.apple.mpegurl," +
          "audio/x-mpegurl," +
          "text/plain," +
          "*/*"
      },

      cache: "no-store"
    }
  );

  if (!response.ok) {
    let detail = "";

    try {
      const contentType =
        response.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        const data = await response.clone().json();

        if (data?.error) {
          detail = ` — ${data.error}`;

          if (data?.host) {
            detail += ` (${data.host})`;
          }

          if (data?.status) {
            detail += ` [origem HTTP ${data.status}]`;
          }
        }
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
  const result = {
    name: "",
    group: "",
    logo: "",
    tvgId: "",
    tvgName: "",
    country: "",
    language: ""
  };

  const colonIndex =
    line.indexOf(":");

  const content =
    colonIndex >= 0
      ? line.slice(
          colonIndex + 1
        )
      : line;

  const commaIndex =
    findNameSeparator(content);

  const attributes =
    commaIndex >= 0
      ? content.slice(
          0,
          commaIndex
        )
      : content;

  const name =
    commaIndex >= 0
      ? content.slice(
          commaIndex + 1
        ).trim()
      : "Sem nome";

  result.name =
    name || "Sem nome";

  result.group =
    getAttribute(
      attributes,
      [
        "group-title",
        "group"
      ]
    ) || "Sem categoria";

  result.logo =
    getAttribute(
      attributes,
      [
        "tvg-logo",
        "logo"
      ]
    );

  result.tvgId =
    getAttribute(
      attributes,
      [
        "tvg-id"
      ]
    );

  result.tvgName =
    getAttribute(
      attributes,
      [
        "tvg-name"
      ]
    );

  result.country =
    getAttribute(
      attributes,
      [
        "tvg-country",
        "country"
      ]
    );

  result.language =
    getAttribute(
      attributes,
      [
        "tvg-language",
        "language"
      ]
    );

  return result;
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

    if (type) {
      fallback = fallback.filter(item => item.type === type);
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
    const source = type ? store.index("type") : store;
    const request = type
      ? source.openCursor(IDBKeyRange.only(type))
      : source.openCursor();

    request.onsuccess = event => {
      const cursor = event.target.result;

      if (!cursor || result.length >= limit) {
        resolve(result);
        return;
      }

      const item = cursor.value;
      const matchesGenre =
        genre === "all" ||
        normalizeText(getGenreName(item.group)) === normalizeText(genre);

      const matchesTerm =
        !term ||
        item.nameLower.includes(normalizeText(term)) ||
        normalizeText(item.group).includes(normalizeText(term));

      if (matchesGenre && matchesTerm) {
        result.push(item);
      }

      cursor.continue();
    };

    request.onerror = () => reject(request.error);
  });
}

async function render() {
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
    state.currentFilter === "all"
      ? null
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
  const seasons = Object.keys(item.seasons || {}).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  const logo = item.logo
    ? `<img class="gc-card-image" src="${escapeHTML(item.logo)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="gc-card-placeholder" style="display:none">📺</div>`
    : `<div class="gc-card-placeholder">📺</div>`;
  return `<article class="gc-card" data-series-key="${escapeHTML(item.seriesKey)}" tabindex="0">${logo}<div class="gc-card-info"><div class="gc-card-title">${escapeHTML(title)}</div><div class="gc-card-meta">${formatNumber(item.episodeCount || 0)} episódios • ${escapeHTML(seasons.length ? seasons.map(s=>`T${s}`).join(" • ") : "Temporadas")}</div></div></article>`;
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
    const seasons=Object.entries(selected.seasons||{}).sort((a,b)=>Number(a[0])-Number(b[0]));
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
  if (item?.seriesKey && item?.seriesName) {
    return {
      seriesKey: item.seriesKey,
      seriesName: item.seriesName,
      season: item.season ?? null,
      episode: item.episode ?? null,
      genre: item.genre || getGenreName(item.group)
    };
  }

  return extractSeriesInfo(item);
}

function looksLikeSeriesRecord(item) {
  if (!item) return false;

  if (item.type === "series") return true;

  const name = String(item.name || "");
  const group = String(item.group || "");
  const url = String(item.url || "");

  return classifyItem(name, group, url) === "series";
}

function getDerivedSeriesInfo(item) {
  if (item?.seriesKey && item?.seriesName) {
    return {
      seriesKey: item.seriesKey,
      seriesName: item.seriesName,
      season: item.season ?? null,
      episode: item.episode ?? null,
      genre: item.genre || getGenreName(item.group)
    };
  }

  return extractSeriesInfo(item);
}

async function getAllSeriesItems() {
  if (Array.isArray(state.seriesCatalog) && state.seriesCatalog.length) {
    return state.seriesCatalog;
  }

  if (!state.db) {
    return state.items
      .filter(looksLikeSeriesRecord)
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
    if (!looksLikeSeriesRecord(item)) continue;

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

async function rebuildSeriesCatalogInBackground() {
  if (
    state.seriesCatalogReady ||
    state.seriesCatalogBuilding ||
    !state.db
  ) {
    return;
  }

  state.seriesCatalogBuilding = true;

  try {
    const map = new Map();

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

        if (looksLikeSeriesRecord(item)) {
          const info = getDerivedSeriesInfo(item);
          let entry = map.get(info.seriesKey);

          if (!entry) {
            entry = {
              seriesKey: info.seriesKey,
              seriesName: info.seriesName || item.name,
              nameLower: normalizeText(
                info.seriesName || item.name
              ),
              logo: item.logo || "",
              group: item.group || "",
              genre: info.genre || getGenreName(item.group),
              episodeCount: 0,
              seasons: {}
            };

            map.set(info.seriesKey, entry);
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

        for (const item of result) {
          store.put(item);
        }

        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    }

    state.seriesCatalog = result;
    state.seriesCatalogMap = new Map(
      result.map(item => [item.seriesKey, item])
    );
    state.seriesCatalogReady = true;
    state.seriesItemsCache = result;

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

function getSeriesEpisodes(seriesKey, season = null) {
  if (!state.db) {
    let items = state.items.filter(looksLikeSeriesRecord);
    items = items.filter(item => getDerivedSeriesInfo(item).seriesKey === seriesKey);
    if (season !== null) {
      items = items.filter(item => Number(getDerivedSeriesInfo(item).season ?? 0) === Number(season));
    }
    return Promise.resolve(items);
  }

  return new Promise((resolve, reject) => {
    const result = [];
    const transaction = state.db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const source = season !== null && store.indexNames.contains("seriesSeason")
      ? store.index("seriesSeason")
      : store.index("seriesKey");
    const range = season !== null && store.indexNames.contains("seriesSeason")
      ? IDBKeyRange.only([seriesKey, Number(season)])
      : IDBKeyRange.only(seriesKey);
    const request = source.openCursor(range);

    request.onsuccess = event => {
      const cursor = event.target.result;
      if (!cursor) {
        result.sort((a,b) =>
          Number(a.episode ?? 999999) - Number(b.episode ?? 999999) ||
          String(a.name || "").localeCompare(String(b.name || ""), "pt-BR", {sensitivity:"base"})
        );
        resolve(result);
        return;
      }
      result.push({...cursor.value, type:"series"});
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
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
      "https://cdn.jsdelivr.net/npm/hls.js@latest";

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
      "https://cdn.jsdelivr.net/npm/mpegts.js@latest/dist/mpegts.min.js";

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
  if (!item) return false;

  const url =
    String(item.url || "").toLowerCase();

  return (
    item.type === "live" &&
    !isHLS(url) &&
    (
      url.includes(".ts") ||
      url.includes(".m2ts") ||
      url.includes("mpegts") ||
      url.includes("/live/") ||
      url.includes("/stream/")
    )
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
          enableWorkerForMSE: false,
          enableStashBuffer: false,
          liveBufferLatencyChasing: true,
          liveBufferLatencyMaxLatency: 2
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

        if (message) {
          message.textContent =
            "Erro ao reproduzir MPEG-TS.";
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

  try {
    video.pause();
  } catch {}

  video.removeAttribute("src");

  try {
    video.load();
  } catch {}

  const originalUrl =
    item.url;

  /*
     Muitos servidores de IPTV bloqueiam
     o acesso direto do navegador por CORS.
     Como o domínio da playlist já é autorizado
     pelo nosso proxy, usamos o mesmo proxy
     também para o fluxo de reprodução.
  */
  const playbackUrl =
    shouldUseProxy(originalUrl)
      ? buildProxyUrl(originalUrl)
      : originalUrl;

  /* -------------------------------------------------------
     MPEG-TS AO VIVO
     ------------------------------------------------------- */

  if (isMpegTSLive(item)) {
    await playMpegTS(
      video,
      playbackUrl,
      message
    );

    return;
  }

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

  video.onloadeddata = () => {
    if (message) {
      message.textContent = "";
    }
  };

  video.onplaying = () => {
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

        lowLatencyMode: false,

        backBufferLength: 30,

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
      state.currentGenre = "all";
      state.seriesView.seriesKey = null;
      state.seriesView.season = null;

      buttons.forEach(item => {
        item.classList.toggle("active", item === button);
      });

      renderGenreFilters();
      render();
    });
  });
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
    const genre = getGenreName(group);
    const key = normalizeText(genre);
    if (!key) return;

    if (!catalog.all.has(key)) {
      catalog.all.set(key, genre);
    }

    if (catalog[type] && !catalog[type].has(key)) {
      catalog[type].set(key, genre);
    }
  };

  if (!state.db) {
    for (const item of state.items) {
      add(item.type, item.group);
    }
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

        const item = cursor.value;

        /*
         * Corrige categorias de séries que foram salvas
         * com type antigo antes do agrupamento novo.
         */
        const effectiveType =
          looksLikeSeriesRecord(item)
            ? "series"
            : item.type;

        add(effectiveType, item.group);
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
  const key=["live","movie","series"].includes(type)?type:"all";
  if(key==="series" && state.seriesCatalog.length){
    return Array.from(new Set(state.seriesCatalog.map(item=>item.genre || getGenreName(item.group)).filter(Boolean)))
      .sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));
  }
  const cached=state.genreCatalog[key];
  if(Array.isArray(cached) && cached.length) return cached;
  return Array.from(new Set(state.groups.map(getGenreName).filter(Boolean)))
    .sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));
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
   NAVEGAÇÃO
   ========================================================= */

function setupNavigation() {
  const buttons =
    $$(
      "[data-section]"
    );

  buttons.forEach(
    button => {
      button.addEventListener(
        "click",
        async () => {
          const section =
            button.dataset.section;

          state.currentSection =
            section;

          buttons.forEach(
            item => {
              item.classList.toggle(
                "active",
                item === button
              );
            }
          );

          await handleSection(
            section
          );
        }
      );
    }
  );
}

/* =========================================================
   TRATAMENTO DAS SEÇÕES
   ========================================================= */

async function handleSection(
  section
) {
  if (
    section === "home"
  ) {
    state.currentFilter =
      "all";

    state.currentGenre =
      "all";

    state.searchTerm =
      "";

    renderGenreFilters();

    render();

    return;
  }

  if (
    section === "live"
  ) {
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
    section === "favorites"
  ) {
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

    if (item) {
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

function setupSettings() {
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

  if (looksLikeSeriesRecord(item)) {
    updateSeriesCatalogEntry(item);
  }

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

    return;
  }

  if (
    !url ||
    !isHttpUrl(url)
  ) {
    toast(
      "Informe uma URL M3U válida."
    );

    return;
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

      if (
        batch.length >=
        WRITE_BATCH
      ) {
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
          700
        ) {
          lastRender =
            now;

          render();

          updateLiveCounters();

          updateLoadMessage(
            `Carregando... ${formatNumber(
              processed
            )} itens`
          );

          /*
             Entrega o controle ao navegador
             para não travar a interface.
          */

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

    while (
      writeProcessing ||
      writeQueue.length
    ) {
      await sleep(50);
    }

    /*
       O índice de séries já foi gravado durante a importação.
       Carregamos somente esse índice — nunca os 400k episódios.
    */
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
       Fechar diálogo depois de um pequeno
       intervalo para o usuário visualizar
       o resultado.
    */

    setTimeout(
      () => {
        closeDialog(
          "playlistDialog"
        );
      },
      1800
    );

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

  form.addEventListener(
    "submit",
    async event => {
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
        await loadM3U(
          url
        );
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
      const library =
        $("#librarySection");

      if (library) {
        library.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }
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

    state.counts.series =
      series;

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

async function loadLocalCatalog() {
  try {
    if (!state.db) return;
    state.items = await loadSample(RAM_LIMIT);
    state.seriesItemsCache = null;

    const storedSeries = await loadSeriesCatalogFromDB();
    state.seriesCatalog = storedSeries;
    state.seriesCatalogMap = new Map(storedSeries.map(item=>[item.seriesKey,item]));
    state.seriesCatalogReady = storedSeries.length > 0;

    try {
      const saved = JSON.parse(localStorage.getItem("GC_PLAY_PRO_GROUPS_V1") || "[]");
      state.groups = Array.isArray(saved) ? saved : [];
    } catch { state.groups = []; }

    if (!state.groups.length) {
      state.groups = await getGroups();
      try { localStorage.setItem("GC_PLAY_PRO_GROUPS_V1", JSON.stringify(state.groups)); } catch {}
    }

    state.genreCatalog = {
      all: Array.from(new Set(state.groups.map(getGenreName))),
      live: [],
      movie: [],
      series: Array.from(new Set(storedSeries.map(item=>item.genre || getGenreName(item.group))))
    };

    await loadDatabaseStats();
    renderGenreFilters();
    render();
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
  const update =
    () => {
      const element =
        $("#connectionStatus");

      if (!element) {
        return;
      }

      if (
        !navigator.onLine
      ) {
        element.textContent =
          "OFFLINE";
      } else if (
        state.loading
      ) {
        element.textContent =
          "CARREGANDO...";
      } else {
        element.textContent =
          "ONLINE";
      }
    };

  window.addEventListener(
    "online",
    update
  );

  window.addEventListener(
    "offline",
    update
  );

  update();
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

async function initApp() {
  console.log(
    "%cGC PLAY PRO",
    "font-size:24px;font-weight:900;color:#69ff65;"
  );

  console.log(
    "Inicializando sistema..."
  );

  ensureCSS();

  loadState();

  setupCardEvents();

  setupFilters();

  renderGenreFilters();

  setupNavigation();

  setupDialogs();

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
