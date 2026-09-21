const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// =====================================================
// GC PLAY PRO - M3U ENGINE
// =====================================================

let libraryCache = {
  items: [],
  loadedAt: null,
  source: null
};

let loadingPromise = null;

// -----------------------------------------------------
// PARSER M3U
// -----------------------------------------------------

function parseAttributes(text) {
  const attributes = {};

  const regex = /([\w-]+)="([^"]*)"/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    attributes[match[1]] = match[2];
  }

  return attributes;
}

function parseM3U(content) {
  const lines = content.split(/\r?\n/);

  const items = [];

  let currentInfo = null;

  for (const lineRaw of lines) {
    const line = lineRaw.trim();

    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      const commaIndex = line.indexOf(",");

      const info =
        commaIndex >= 0
          ? line.substring(commaIndex + 1).trim()
          : "";

      const attributesText =
        commaIndex >= 0
          ? line.substring(8, commaIndex)
          : line.substring(8);

      const attributes = parseAttributes(attributesText);

      currentInfo = {
        name:
          attributes["tvg-name"] ||
          info ||
          "Sem nome",

        logo:
          attributes["tvg-logo"] ||
          "",

        group:
          attributes["group-title"] ||
          "Outros",

        tvgId:
          attributes["tvg-id"] ||
          "",

        tvgName:
          attributes["tvg-name"] ||
          info ||
          "Sem nome",

        title: info
      };

      continue;
    }

    // Ignora comentários
    if (line.startsWith("#")) continue;

    // URL do conteúdo
    if (currentInfo) {
      items.push({
        id: items.length + 1,
        name: currentInfo.name,
        title: currentInfo.title,
        logo: currentInfo.logo,
        group: currentInfo.group,
        tvgId: currentInfo.tvgId,
        tvgName: currentInfo.tvgName,
        url: line
      });

      currentInfo = null;
    }
  }

  return items;
}

// -----------------------------------------------------
// CARREGAR M3U
// -----------------------------------------------------

async function loadM3U(force = false) {

  if (!process.env.M3U_URL) {
    throw new Error(
      "M3U_URL não configurada no Render."
    );
  }

  // Cache em memória
  if (
    !force &&
    libraryCache.items.length > 0
  ) {
    return libraryCache;
  }

  // Evita duas atualizações simultâneas
  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {

    console.log("Baixando lista M3U...");

    const response = await fetch(
      process.env.M3U_URL,
      {
        redirect: "follow",
        headers: {
          "User-Agent": "GC-PLAY-PRO/1.0"
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        `Erro ao baixar M3U: HTTP ${response.status}`
      );
    }

    const content = await response.text();

    console.log(
      `M3U recebida: ${content.length} caracteres`
    );

    const items = parseM3U(content);

    libraryCache = {
      items,
      loadedAt: new Date().toISOString(),
      source: "M3U"
    };

    console.log(
      `Biblioteca carregada: ${items.length} itens`
    );

    return libraryCache;

  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

// =====================================================
// ROTAS
// =====================================================

// Página principal
app.get("/", (req, res) => {
  res.json({
    status: "online",
    app: "GC PLAY PRO",
    version: "1.1.0",
    message: "Backend + M3U Engine funcionando!"
  });
});

// Status
app.get("/api/status", (req, res) => {
  res.json({
    online: true,
    service: "GC PLAY PRO API",
    libraryItems: libraryCache.items.length,
    libraryLoadedAt: libraryCache.loadedAt
  });
});

// -----------------------------------------------------
// INFORMAÇÕES DA BIBLIOTECA
// -----------------------------------------------------

app.get("/api/library", async (req, res) => {

  try {

    const library = await loadM3U();

    const groups = {};

    for (const item of library.items) {
      const group = item.group || "Outros";

      groups[group] = (groups[group] || 0) + 1;
    }

    res.json({
      success: true,
      total: library.items.length,
      loadedAt: library.loadedAt,
      groups
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// -----------------------------------------------------
// LISTAGEM PAGINADA
// -----------------------------------------------------

app.get("/api/library/items", async (req, res) => {

  try {

    const library = await loadM3U();

    let page = Number(req.query.page) || 1;
    let limit = Number(req.query.limit) || 100;

    // Segurança
    page = Math.max(1, page);
    limit = Math.min(Math.max(1, limit), 200);

    const search =
      String(req.query.search || "")
        .trim()
        .toLowerCase();

    const group =
      String(req.query.group || "")
        .trim()
        .toLowerCase();

    let filtered = library.items;

    // Busca
    if (search) {
      filtered = filtered.filter(item =>
        `${item.name} ${item.title} ${item.group}`
          .toLowerCase()
          .includes(search)
      );
    }

    // Categoria
    if (group) {
      filtered = filtered.filter(item =>
        String(item.group)
          .toLowerCase() === group
      );
    }

    const total = filtered.length;

    const start =
      (page - 1) * limit;

    const end =
      start + limit;

    const items =
      filtered.slice(start, end);

    res.json({
      success: true,

      page,
      limit,

      total,
      totalPages:
        Math.ceil(total / limit),

      items
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// -----------------------------------------------------
// FORÇAR ATUALIZAÇÃO
// -----------------------------------------------------

app.post("/api/library/refresh", async (req, res) => {

  try {

    const library =
      await loadM3U(true);

    res.json({
      success: true,
      total: library.items.length,
      loadedAt: library.loadedAt
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// SERVIDOR
// =====================================================

app.listen(PORT, "0.0.0.0", () => {

  console.log(
    `GC PLAY PRO API rodando na porta ${PORT}`
  );

});
