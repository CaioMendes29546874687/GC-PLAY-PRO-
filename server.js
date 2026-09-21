const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const MAX_LIMIT = 200;

const state = {
  items: [],
  groups: new Map(),
  groupNames: new Map(),
  series: new Map(),
  loadedAt: null,
  loading: false,
  lastError: null,
  progress: {
    bytes: 0,
    totalBytes: null,
    items: 0
  }
};

let refreshPromise = null;
const searchCache = new Map();
const SEARCH_CACHE_MAX = 10;

/* ==================== UTILIDADES ==================== */

function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseNumber(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function parseAttributes(text) {
  const attrs = {};
  const regex = /([\w-]+)="([^"]*)"/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    attrs[match[1].toLowerCase()] = match[2];
  }

  return attrs;
}

/* ==================== SÉRIES ==================== */

function detectEpisode(text = "") {
  const source = String(text);

  const patterns = [
    /\bS(\d{1,2})\s*E(\d{1,3})\b/i,
    /\b(\d{1,2})\s*[xX]\s*(\d{1,3})\b/,
    /\bT(?:emporada)?\s*(\d{1,2})\s*(?:[-._ ]*)E(?:p(?:is[oó]dio)?)?\s*(\d{1,3})\b/i,
    /\bTemporada\s*(\d{1,2})\s*(?:[-._ ]*)Epis[oó]dio\s*(\d{1,3})\b/i
  ];

  for (const regex of patterns) {
    const match = source.match(regex);

    if (match) {
      const season = Number(match[1]);
      const episode = Number(match[2]);

      if (
        season >= 0 &&
        season <= 99 &&
        episode >= 0 &&
        episode <= 999
      ) {
        return {
          season,
          episode,
          token: match[0],
          index: match.index
        };
      }
    }
  }

  return null;
}

function cleanSeriesName(text = "") {
  let name = String(text).trim();

  const detected = detectEpisode(name);

  if (detected) {
    name =
      name.slice(0, detected.index) +
      " " +
      name.slice(
        detected.index + detected.token.length
      );
  }

  name = name
    .replace(/[\[\(\{]\s*[-_. ]*[\]\)\}]/g, " ")
    .replace(
      /\b(HD|FHD|SD|4K|1080P|720P)\b/gi,
      " "
    )
    .replace(/[-_.|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return name || "Série sem nome";
}

function addSeriesEpisode(seriesMap, itemIndex, item) {
  const sourceText =
    `${item.name || ""} ${item.title || ""}`;

  const detected = detectEpisode(sourceText);

  if (!detected) return null;

  const seriesName = cleanSeriesName(
    item.name || item.title || ""
  );

  const key = normalize(seriesName);

  if (!key || key.length < 2) return null;

  let series = seriesMap.get(key);

  if (!series) {
    series = {
      id: `s${seriesMap.size + 1}`,
      name: seriesName,
      logo: item.logo || "",
      group: item.group || "",
      seasons: new Map(),
      episodes: 0
    };

    seriesMap.set(key, series);
  } else if (!series.logo && item.logo) {
    series.logo = item.logo;
  }

  let season = series.seasons.get(detected.season);

  if (!season) {
    season = {
      number: detected.season,
      episodes: []
    };

    series.seasons.set(
      detected.season,
      season
    );
  }

  season.episodes.push({
    episode: detected.episode,
    itemIndex
  });

  series.episodes++;

  return {
    seriesKey: key,
    season: detected.season,
    episode: detected.episode
  };
}

/* ==================== M3U ==================== */

function parseExtInf(line) {
  const commaIndex = line.indexOf(",");

  const attrsText = line.slice(
    8,
    commaIndex >= 0
      ? commaIndex
      : line.length
  );

  const title =
    commaIndex >= 0
      ? line.slice(commaIndex + 1).trim()
      : "Sem nome";

  const attrs = parseAttributes(attrsText);

  return {
    name:
      attrs["tvg-name"] ||
      title ||
      "Sem nome",

    title,

    logo:
      attrs["tvg-logo"] ||
      "",

    group:
      attrs["group-title"] ||
      "Outros",

    tvgId:
      attrs["tvg-id"] ||
      ""
  };
}

function addItem(
  items,
  groups,
  groupNames,
  seriesMap,
  info,
  url
) {
  const id = items.length + 1;

  const item = {
    id,
    name: info.name,
    title: info.title,
    logo: info.logo,
    group: info.group,
    tvgId: info.tvgId,
    url
  };

  const index = items.length;

  items.push(item);

  const groupKey =
    normalize(info.group) ||
    "outros";

  let groupList =
    groups.get(groupKey);

  if (!groupList) {
    groupList = [];

    groups.set(
      groupKey,
      groupList
    );

    groupNames.set(
      groupKey,
      info.group || "Outros"
    );
  }

  groupList.push(index);

  addSeriesEpisode(
    seriesMap,
    index,
    item
  );
}
async function parseM3UStream(response) {
  const items = [];
  const groups = new Map();
  const groupNames = new Map();
  const seriesMap = new Map();

  let current = null;
  let buffer = "";
  let bytes = 0;

  const totalBytes =
    Number(
      response.headers.get("content-length")
    ) || null;

  state.progress = {
    bytes: 0,
    totalBytes,
    items: 0
  };

  function processLine(rawLine) {
    const line = rawLine.trim();

    if (!line) return;

    if (line.startsWith("#EXTINF:")) {
      current = parseExtInf(line);
      return;
    }

    if (line.startsWith("#")) return;

    if (current) {
      addItem(
        items,
        groups,
        groupNames,
        seriesMap,
        current,
        line
      );

      current = null;

      state.progress.items =
        items.length;
    }
  }

  if (!response.body) {
    const text =
      await response.text();

    for (
      const line of text.split(/\r?\n/)
    ) {
      processLine(line);
    }

  } else {

    const reader =
      response.body.getReader();

    const decoder =
      new TextDecoder();

    while (true) {
      const {
        done,
        value
      } = await reader.read();

      if (done) break;

      bytes += value.byteLength;

      state.progress.bytes =
        bytes;

      buffer +=
        decoder.decode(
          value,
          { stream: true }
        );

      let newlineIndex;

      while (
        (newlineIndex =
          buffer.indexOf("\n")) !== -1
      ) {
        const line =
          buffer.slice(
            0,
            newlineIndex
          );

        buffer =
          buffer.slice(
            newlineIndex + 1
          );

        processLine(line);
      }
    }

    buffer +=
      decoder.decode();

    if (buffer) {
      processLine(buffer);
    }
  }

  return {
    items,
    groups,
    groupNames,
    series: seriesMap
  };
}

/* ==================== CARREGAMENTO ==================== */

async function refreshLibrary() {
  if (refreshPromise)
    return refreshPromise;

  refreshPromise =
    (async () => {

      state.loading = true;
      state.lastError = null;

      const controller =
        new AbortController();

      const timeout =
        setTimeout(() => {
          controller.abort();
        }, 300000);

      try {

        if (!process.env.M3U_URL) {
          throw new Error(
            "M3U_URL não configurada no Render."
          );
        }

        console.log(
          "Baixando M3U..."
        );

        const response =
          await fetch(
            process.env.M3U_URL,
            {
              method: "GET",
              redirect: "follow",
              signal:
                controller.signal,

              headers: {
                "User-Agent":
                  "GC-PLAY-PRO/1.2"
              }
            }
          );

        if (!response.ok) {
          throw new Error(
            `Falha ao baixar M3U: HTTP ${response.status}`
          );
        }

        const parsed =
          await parseM3UStream(
            response
          );

        if (
          !parsed.items.length
        ) {
          throw new Error(
            "A M3U foi carregada, mas nenhum conteúdo foi encontrado."
          );
        }

        state.items =
          parsed.items;

        state.groups =
          parsed.groups;

        state.groupNames =
          parsed.groupNames;

        state.series =
          parsed.series;

        state.loadedAt =
          new Date().toISOString();

        state.lastError = null;

        searchCache.clear();

        console.log(
          `Biblioteca carregada: ${state.items.length} itens`
        );

        console.log(
          `Séries detectadas: ${state.series.size}`
        );

        return state;

      } catch (error) {

        state.lastError =
          error.name ===
          "AbortError"

            ? "Tempo limite ao carregar a M3U."

            : error.message;

        throw error;

      } finally {

        clearTimeout(timeout);

        state.loading = false;

        refreshPromise = null;
      }
    })();

  return refreshPromise;
}

async function ensureLibrary() {
  if (state.items.length)
    return state;

  return refreshLibrary();
}

/* ==================== RESPOSTA PÚBLICA ==================== */

function publicItem(item) {
  return {
    id: item.id,
    name: item.name,
    title: item.title,
    logo: item.logo,
    group: item.group,
    tvgId: item.tvgId,
    tvgName: item.name,
    url: item.url
  };
}

function getSearchMatches(
  query,
  groupKey
) {
  const cacheKey =
    `${groupKey || "*"}|${query}`;

  if (
    searchCache.has(cacheKey)
  ) {
    return searchCache.get(
      cacheKey
    );
  }

  const matches = [];

  const candidates =
    groupKey
      ? state.groups.get(
          groupKey
        ) || []
      : null;

  const test = (index) => {
    const item =
      state.items[index];

    const text =
      normalize(
        `${item.name || ""} ${item.title || ""} ${item.group || ""}`
      );

    return text.includes(query);
  };

  if (candidates) {

    for (
      const index of candidates
    ) {
      if (test(index))
        matches.push(index);
    }

  } else {

    for (
      let i = 0;
      i < state.items.length;
      i++
    ) {
      if (test(i))
        matches.push(i);
    }
  }

  searchCache.set(
    cacheKey,
    matches
  );

  while (
    searchCache.size >
    SEARCH_CACHE_MAX
  ) {
    searchCache.delete(
      searchCache.keys()
        .next()
        .value
    );
  }

  return matches;
}
/* ==================== ROTAS BÁSICAS ==================== */

app.get("/", (req, res) => {
  res.json({
    status: "online",
    app: "GC PLAY PRO",
    version: "1.2.0",
    message:
      "Backend + M3U + organizador de séries funcionando!"
  });
});

app.get(
  "/api/status",
  (req, res) => {
    res.json({
      online: true,
      service:
        "GC PLAY PRO API",
      version: "1.2.0",
      libraryReady:
        state.items.length > 0,
      total:
        state.items.length,
      series:
        state.series.size,
      loading:
        state.loading,
      loadedAt:
        state.loadedAt,
      error:
        state.lastError,
      progress:
        state.progress,
      timestamp:
        new Date().toISOString()
    });
  }
);

app.get(
  "/api/library/status",
  (req, res) => {
    res.json({
      ready:
        state.items.length > 0,
      loading:
        state.loading,
      total:
        state.items.length,
      groups:
        state.groups.size,
      series:
        state.series.size,
      loadedAt:
        state.loadedAt,
      error:
        state.lastError,
      progress:
        state.progress
    });
  }
);

app.get(
  "/api/library",
  async (req, res) => {

    try {

      await ensureLibrary();

      const groups = [];

      for (
        const [
          key,
          indexes
        ] of state.groups.entries()
      ) {

        groups.push({
          key,

          name:
            state.groupNames
              .get(key) ||
            key,

          count:
            indexes.length
        });
      }

      groups.sort(
        (a, b) =>
          b.count - a.count
      );

      res.json({
        success: true,
        total:
          state.items.length,
        groups,
        series:
          state.series.size,
        loadedAt:
          state.loadedAt
      });

    } catch (error) {

      res.status(500).json({
        success: false,
        error:
          error.message
      });
    }
  }
);

app.get(
  "/api/library/items",
  async (req, res) => {

    try {

      await ensureLibrary();

      const page =
        parseNumber(
          req.query.page,
          1,
          1,
          1000000
        );

      const limit =
        parseNumber(
          req.query.limit,
          20,
          1,
          MAX_LIMIT
        );

      const search =
        normalize(
          req.query.search ||
          ""
        );

      const groupKey =
        normalize(
          req.query.group ||
          ""
        );

      let indexes;
      let total;

      if (search) {

        indexes =
          getSearchMatches(
            search,
            groupKey
          );

        total =
          indexes.length;

      } else if (groupKey) {

        indexes =
          state.groups.get(
            groupKey
          ) || [];

        total =
          indexes.length;

      } else {

        indexes = null;

        total =
          state.items.length;
      }

      const totalPages =
        Math.max(
          1,
          Math.ceil(
            total / limit
          )
        );

      const safePage =
        Math.min(
          page,
          totalPages
        );

      let resultItems = [];

      if (indexes) {

        const start =
          (safePage - 1) *
          limit;

        const selected =
          indexes.slice(
            start,
            start + limit
          );

        resultItems =
          selected.map(
            (index) =>
              publicItem(
                state.items[index]
              )
          );

      } else {

        const start =
          (safePage - 1) *
          limit;

        resultItems =
          state.items
            .slice(
              start,
              start + limit
            )
            .map(publicItem);
      }

      res.json({
        success: true,
        page:
          safePage,
        limit,
        total,
        totalPages,
        items:
          resultItems
      });

    } catch (error) {

      res.status(500).json({
        success: false,
        error:
          error.message
      });
    }
  }
);

/* ==================== API DE SÉRIES ==================== */

function seriesToPublic(series) {

  const seasons =
    [...series.seasons.values()]
      .sort(
        (a, b) =>
          a.number - b.number
      )
      .map(
        (season) => ({
          number:
            season.number,

          episodeCount:
            season.episodes.length
        })
      );

  return {
    id:
      series.id,

    name:
      series.name,

    logo:
      series.logo,

    group:
      series.group,

    seasons,

    episodeCount:
      series.episodes
  };
}

function findSeriesById(id) {

  for (
    const series
    of state.series.values()
  ) {

    if (
      series.id === id
    ) {
      return series;
    }
  }

  return null;
}

app.get(
  "/api/series",
  async (req, res) => {

    try {

      await ensureLibrary();

      const page =
        parseNumber(
          req.query.page,
          1,
          1,
          100000
        );

      const limit =
        parseNumber(
          req.query.limit,
          30,
          1,
          100
        );

      const search =
        normalize(
          req.query.search ||
          ""
        );

      let list =
        [
          ...state.series.values()
        ];

      if (search) {

        list =
          list.filter(
            (series) =>
              normalize(
                series.name
              ).includes(search)
          );
      }

      list.sort(
        (a, b) =>
          a.name.localeCompare(
            b.name,
            "pt-BR"
          )
      );

      const total =
        list.length;

      const totalPages =
        Math.max(
          1,
          Math.ceil(
            total / limit
          )
        );

      const safePage =
        Math.min(
          page,
          totalPages
        );

      const start =
        (safePage - 1) *
        limit;

      res.json({
        success: true,
        page:
          safePage,
        limit,
        total,
        totalPages,

        items:
          list
            .slice(
              start,
              start + limit
            )
            .map(
              seriesToPublic
            )
      });

    } catch (error) {

      res.status(500).json({
        success: false,
        error:
          error.message
      });
    }
  }
);

app.get(
  "/api/series/:id",
  async (req, res) => {

    try {

      await ensureLibrary();

      const series =
        findSeriesById(
          req.params.id
        );

      if (!series) {

        return res.status(
          404
        ).json({
          success: false,
          error:
            "Série não encontrada."
        });
      }

      const seasons =
        [
          ...series.seasons.values()
        ]
          .sort(
            (a, b) =>
              a.number - b.number
          )
          .map(
            (season) => ({
              number:
                season.number,

              episodeCount:
                season.episodes.length,

              episodes:
                [
                  ...season.episodes
                ]
                  .sort(
                    (a, b) =>
                      a.episode -
                      b.episode
                  )
                  .map(
                    (ep) => {

                      const item =
                        state.items[
                          ep.itemIndex
                        ];

                      return {
                        episode:
                          ep.episode,

                        id:
                          item.id,

                        name:
                          item.name,

                        title:
                          item.title,

                        logo:
                          item.logo,

                        group:
                          item.group,

                        url:
                          item.url
                      };
                    }
                  )
            })
          );

      res.json({
        success: true,

        id:
          series.id,

        name:
          series.name,

        logo:
          series.logo,

        group:
          series.group,

        episodeCount:
          series.episodes,

        seasons
      });

    } catch (error) {

      res.status(500).json({
        success: false,
        error:
          error.message
      });
    }
  }
);
app.get(
  "/api/library/refresh",
  async (req, res) => {

    try {

      await refreshLibrary();

      res.json({
        success: true,
        total:
          state.items.length,
        series:
          state.series.size,
        loadedAt:
          state.loadedAt
      });

    } catch (error) {

      res.status(500).json({
        success: false,
        error:
          error.message
      });
    }
  }
);

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `GC PLAY PRO API rodando na porta ${PORT}`
    );
  }
);
