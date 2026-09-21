const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;

const MAX_LIMIT = 200;
const SEARCH_CACHE_MAX = 10;

/*
========================================
 ESTADO DA BIBLIOTECA
========================================
*/

const library = {
  items: [],
  groups: new Map(),
  groupNames: new Map(),

  total: 0,
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

/*
========================================
 CACHE DE BUSCA
========================================
*/

const searchCache = new Map();

/*
========================================
 NORMALIZAÇÃO
========================================
*/

function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/*
========================================
 ATRIBUTOS DO EXTINF
========================================
*/

function parseAttributes(text) {
  const attrs = {};

  const regex = /([\w-]+)="([^"]*)"/g;

  let match;

  while ((match = regex.exec(text)) !== null) {
    attrs[match[1]] = match[2];
  }

  return attrs;
}

/*
========================================
 PARSE DO EXTINF
========================================
*/

function parseExtInf(line) {
  const commaIndex = line.indexOf(",");

  const attributesText = line.slice(
    8,
    commaIndex >= 0 ? commaIndex : line.length
  );

  const title =
    commaIndex >= 0
      ? line.slice(commaIndex + 1).trim()
      : "Sem nome";

  const attrs = parseAttributes(attributesText);

  const name =
    attrs["tvg-name"] ||
    title ||
    "Sem nome";

  const logo =
    attrs["tvg-logo"] ||
    "";

  const group =
    attrs["group-title"] ||
    "Outros";

  const tvgId =
    attrs["tvg-id"] ||
    "";

  return {
    name,
    title,
    logo,
    group,
    tvgId
  };
}

/*
========================================
 ADICIONAR ITEM
========================================
*/

function addItem(items, groups, groupNames, info, url) {

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

  items.push(item);

  const groupKey =
    normalize(info.group) || "outros";

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

  /*
  Guardamos o índice do item,
  não o objeto inteiro.
  */

  groupList.push(id - 1);
}

/*
========================================
 PARSER M3U EM STREAM
========================================
*/

async function parseM3UStream(response) {

  const items = [];

  const groups = new Map();

  const groupNames = new Map();

  let currentInfo = null;

  let buffer = "";

  let bytesRead = 0;

  const totalBytes =
    Number(
      response.headers.get("content-length")
    ) || null;

  library.progress = {
    bytes: 0,
    totalBytes,
    items: 0
  };

  /*
  --------------------------------------
  PROCESSAR UMA LINHA
  --------------------------------------
  */

  function processLine(rawLine) {

    const line = rawLine.trim();

    if (!line) {
      return;
    }

    /*
    EXTINF
    */

    if (line.startsWith("#EXTINF:")) {

      currentInfo =
        parseExtInf(line);

      return;
    }

    /*
    Comentários / diretivas
    */

    if (line.startsWith("#")) {
      return;
    }

    /*
    URL do conteúdo
    */

    if (currentInfo) {

      addItem(
        items,
        groups,
        groupNames,
        currentInfo,
        line
      );

      currentInfo = null;

      library.progress.items =
        items.length;
    }
  }

  /*
  --------------------------------------
  CASO NÃO EXISTA STREAM
  --------------------------------------
  */

  if (!response.body) {

    const text =
      await response.text();

    const lines =
      text.split(/\r?\n/);

    for (const line of lines) {
      processLine(line);
    }

  } else {

    /*
    ------------------------------------
    LEITURA STREAMING
    ------------------------------------
    */

    const reader =
      response.body.getReader();

    const decoder =
      new TextDecoder();

    while (true) {

      const {
        done,
        value
      } = await reader.read();

      if (done) {
        break;
      }

      bytesRead +=
        value.byteLength;

      library.progress.bytes =
        bytesRead;

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

    /*
    ------------------------------------
    FINAL DO STREAM
    ------------------------------------
    */

    buffer +=
      decoder.decode();

    if (buffer) {
      processLine(buffer);
    }
  }

  return {
    items,
    groups,
    groupNames
  };
}

/*
========================================
 CARREGAR M3U
========================================
*/

async function refreshLibrary() {

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise =
    (async () => {

      library.loading = true;
      library.lastError = null;

      searchCache.clear();

      console.log(
        "================================="
      );

      console.log(
        "GC PLAY PRO"
      );

      console.log(
        "Iniciando atualização M3U..."
      );

      console.log(
        "================================="
      );

      const controller =
        new AbortController();

      const timeout =
        setTimeout(
          () => controller.abort(),
          5 * 60 * 1000
        );

      try {

        if (!process.env.M3U_URL) {

          throw new Error(
            "M3U_URL não configurada no Render."
          );
        }

        /*
        --------------------------------
        DOWNLOAD
        --------------------------------
        */

        const response =
          await fetch(
            process.env.M3U_URL,
            {
              method: "GET",

              redirect: "follow",

              headers: {
                "User-Agent":
                  "GC-PLAY-PRO/2.0"
              },

              signal:
                controller.signal
            }
          );

        if (!response.ok) {

          throw new Error(
            `Falha ao baixar M3U. HTTP ${response.status}`
          );
        }

        console.log(
          "M3U conectada."
        );

        /*
        --------------------------------
        PARSER
        --------------------------------
        */

        const parsed =
          await parseM3UStream(
            response
          );

        if (
          !parsed.items.length
        ) {

          throw new Error(
            "Nenhum conteúdo foi encontrado na M3U."
          );
        }

        /*
        --------------------------------
        TROCA ATÔMICA
        --------------------------------
        */

        library.items =
          parsed.items;

        library.groups =
          parsed.groups;

        library.groupNames =
          parsed.groupNames;

        library.total =
          parsed.items.length;

        library.loadedAt =
          new Date().toISOString();

        library.lastError =
          null;

        console.log(
          `Biblioteca carregada: ${library.total} conteúdos`
        );

        console.log(
          `Categorias: ${library.groups.size}`
        );

        return library;

      } catch (error) {

        library.lastError =
          error.name === "AbortError"
            ? "Tempo limite ao carregar a M3U."
            : error.message;

        console.error(
          "Erro ao carregar M3U:",
          error
        );

        throw error;

      } finally {

        clearTimeout(timeout);

        library.loading =
          false;

        refreshPromise =
          null;
      }

    })();

  return refreshPromise;
}

/*
========================================
 GARANTIR BIBLIOTECA CARREGADA
========================================
*/

async function ensureLibrary() {

  if (library.items.length > 0) {
    return library;
  }

  return refreshLibrary();
}

/*
========================================
 ITEM PÚBLICO DA API
========================================
*/

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

/*
========================================
 CACHE DE BUSCA
========================================
*/

function getSearchMatches(
  query,
  groupKey
) {

  const cacheKey =
    `${groupKey || "*"}::${query}`;

  if (
    searchCache.has(cacheKey)
  ) {

    return searchCache.get(
      cacheKey
    );
  }

  const results = [];

  /*
  --------------------------------------
  CANDIDATOS
  --------------------------------------
  */

  let candidates = null;

  if (groupKey) {

    candidates =
      library.groups.get(
        groupKey
      ) || [];
  }

  /*
  --------------------------------------
  BUSCA
  --------------------------------------
  */

  if (candidates) {

    for (
      const index of candidates
    ) {

      const item =
        library.items[index];

      const text =
        normalize(
          `${item.name} ${item.title} ${item.group}`
        );

      if (
        text.includes(query)
      ) {

        results.push(index);
      }
    }

  } else {

    for (
      let index = 0;
      index < library.items.length;
      index++
    ) {

      const item =
        library.items[index];

      const text =
        normalize(
          `${item.name} ${item.title} ${item.group}`
        );

      if (
        text.includes(query)
      ) {

        results.push(index);
      }
    }
  }

  /*
  --------------------------------------
  LIMITAR CACHE
  --------------------------------------
  */

  if (
    searchCache.size >=
    SEARCH_CACHE_MAX
  ) {

    const firstKey =
      searchCache.keys().next().value;

    searchCache.delete(
      firstKey
    );
  }

  searchCache.set(
    cacheKey,
    results
  );

  return results;
}

/*
========================================
 HOME
========================================
*/

app.get("/", (req, res) => {

  res.json({
    status: "online",

    app: "GC PLAY PRO",

    version: "2.0.0",

    message:
      "Backend + Motor M3U otimizado",

    library: {
      ready:
        library.items.length > 0,

      loading:
        library.loading,

      total:
        library.total,

      groups:
        library.groups.size,

      loadedAt:
        library.loadedAt
    }
  });
});

/*
========================================
 STATUS
========================================
*/

app.get(
  "/api/status",
  (req, res) => {

    res.json({
      online: true,

      service:
        "GC PLAY PRO API",

      version:
        "2.0.0",

      timestamp:
        new Date().toISOString(),

      library: {
        ready:
          library.items.length > 0,

        loading:
          library.loading,

        total:
          library.total,

        groups:
          library.groups.size,

        loadedAt:
          library.loadedAt,

        error:
          library.lastError
      }
    });
  }
);

/*
========================================
 STATUS DA BIBLIOTECA
========================================
*/

app.get(
  "/api/library/status",
  (req, res) => {

    res.json({

      success: true,

      ready:
        library.items.length > 0,

      loading:
        library.loading,

      total:
        library.total,

      groups:
        library.groups.size,

      loadedAt:
        library.loadedAt,

      error:
        library.lastError,

      progress:
        library.progress
    });
  }
);

/*
========================================
 RESUMO DA BIBLIOTECA
========================================
*/

app.get(
  "/api/library",
  async (req, res) => {

    try {

      await ensureLibrary();

      const groups = [];

      for (
        const [
          groupKey,
          indexes
        ] of library.groups
      ) {

        groups.push({

          name:
            library.groupNames.get(
              groupKey
            ) || groupKey,

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
          library.total,

        groups,

        loadedAt:
          library.loadedAt
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

/*
========================================
 ITENS
========================================
*/

app.get(
  "/api/library/items",
  async (req, res) => {

    try {

      await ensureLibrary();

      let page =
        parseInt(
          req.query.page,
          10
        ) || 1;

      let limit =
        parseInt(
          req.query.limit,
          10
        ) || 50;

      page =
        Math.max(
          1,
          page
        );

      limit =
        Math.min(
          MAX_LIMIT,
          Math.max(
            1,
            limit
          )
        );

      const search =
        normalize(
          req.query.search || ""
        );

      const groupKey =
        normalize(
          req.query.group || ""
        );

      let indexes = null;

      /*
      ----------------------------------
      SEM BUSCA
      ----------------------------------
      */

      if (!search) {

        if (groupKey) {

          indexes =
            library.groups.get(
              groupKey
            ) || [];

        } else {

          const start =
            (page - 1) * limit;

          const end =
            start + limit;

          const items =
            library.items
              .slice(start, end)
              .map(publicItem);

          res.json({

            success: true,

            page,

            limit,

            total:
              library.total,

            totalPages:
              Math.ceil(
                library.total / limit
              ),

            items
          });

          return;
        }

      } else {

        /*
        ------------------------------
        COM BUSCA
        ------------------------------
        */

        indexes =
          getSearchMatches(
            search,
            groupKey
          );
      }

      /*
      ----------------------------------
      PAGINAÇÃO DE ÍNDICES
      ----------------------------------
      */

      const total =
        indexes.length;

      const start =
        (page - 1) * limit;

      const end =
        start + limit;

      const pageIndexes =
        indexes.slice(
          start,
          end
        );

      const items =
        pageIndexes.map(
          index =>
            publicItem(
              library.items[index]
            )
        );

      res.json({

        success: true,

        page,

        limit,

        total,

        totalPages:
          Math.ceil(
            total / limit
          ),

        items
      });

    } catch (error) {

      console.error(
        "Erro na API de itens:",
        error
      );

      res.status(500).json({

        success: false,

        error:
          error.message
      });
    }
  }
);

/*
========================================
 ATUALIZAR M3U
========================================
*/

app.get(
  "/api/library/refresh",
  async (req, res) => {

    try {

      await refreshLibrary();

      res.json({

        success: true,

        message:
          "Biblioteca atualizada.",

        total:
          library.total,

        groups:
          library.groups.size,

        loadedAt:
          library.loadedAt
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

/*
========================================
 SERVIDOR
========================================
*/

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "================================="
    );

    console.log(
      "GC PLAY PRO BACKEND"
    );

    console.log(
      `Servidor rodando na porta ${PORT}`
    );

    console.log(
      "Motor M3U otimizado: ATIVO"
    );

    console.log(
      "================================="
    );
  }
);
