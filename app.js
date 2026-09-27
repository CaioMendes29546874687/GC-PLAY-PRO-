/* =========================================================
   GC PLAY PRO — APP.JS
   Núcleo otimizado para listas M3U 400.000+ itens

   Recursos:
   - Parser M3U em fluxo (ReadableStream)
   - IndexedDB para biblioteca grande
   - Renderização paginada
   - Pesquisa com debounce
   - TV / filmes / séries / grupos
   - Favoritos e histórico
   - Reprodução HLS com fallback nativo
   - Importação por URL e arquivo local
   ========================================================= */

"use strict";

/* ---------- HELPERS ---------- */

const $ = (selector, root = document) =>
  root.querySelector(selector);

const $$ = (selector, root = document) =>
  [...root.querySelectorAll(selector)];

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));


/* =========================================================
   ELEMENTOS
   ========================================================= */

const els = {

  add: $("#addPlaylistButton"),

  emptyAdd: $("#emptyAddButton"),

  dialog: $("#playlistDialog"),

  form: $("#playlistForm"),

  closeDialog: $("#closePlaylistDialog"),

  name: $("#playlistName"),

  url: $("#playlistUrl"),

  message: $("#playlistMessage"),

  searchButton: $("#searchButton"),

  searchDialog: $("#searchDialog"),

  closeSearch: $("#closeSearchDialog"),

  search: $("#globalSearch"),

  searchResults: $("#searchResults"),

  settingsButton: $("#settingsButton"),

  settingsDialog: $("#settingsDialog"),

  closeSettings: $("#closeSettingsDialog"),

  autoplay: $("#autoplaySetting"),

  compact: $("#compactSetting"),

  explore: $("#exploreButton"),

  grid: $("#contentGrid"),

  empty: $("#emptyState"),

  library: $("#librarySection"),

  status: $("#connectionStatus"),

  channels: $("#channelCount"),

  movies: $("#movieCount"),

  series: $("#seriesCount"),

  player: $("#playerPanel"),

  closePlayer: $("#closePlayer"),

  video: $("#videoPlayer"),

  playerTitle: $("#playerTitle"),

  playerMessage: $("#playerMessage"),

  toast: $("#toast")

};


/* =========================================================
   STORAGE
   ========================================================= */

const KEY = {

  playlist:
    "gc_play_pro_playlist",

  settings:
    "gc_play_pro_settings",

  favorites:
    "gc_play_pro_favorites",

  history:
    "gc_play_pro_history"

};


/* =========================================================
   ESTADO PRINCIPAL
   ========================================================= */

const state = {

  filter: "all",

  group: "",

  query: "",

  total: 0,

  counts: {

    live: 0,

    movie: 0,

    series: 0

  },

  /*
     Mantemos apenas uma janela da biblioteca
     em memória.

     O restante fica no IndexedDB.
  */

  items: [],

  favorites: new Set(),

  history: [],

  playlist: null,

  dbReady: false,

  rendering: false,

  hls: null,

  abort: null

};


/* =========================================================
   INDEXED DB
   ========================================================= */

const DB_NAME = "GC_PLAY_PRO_DB";

const DB_VERSION = 1;

const STORE = "items";

let dbPromise;


/*
   Abre/cria o banco local.
*/

function openDB() {

  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {

    const request =
      indexedDB.open(
        DB_NAME,
        DB_VERSION
      );


    request.onupgradeneeded = () => {

      const db =
        request.result;


      if (!db.objectStoreNames.contains(STORE)) {

        const store =
          db.createObjectStore(
            STORE,
            {
              keyPath: "id"
            }
          );


        store.createIndex(
          "type",
          "type"
        );


        store.createIndex(
          "group",
          "group"
        );


        store.createIndex(
          "name",
          "nameLower"
        );

      }

    };


    request.onsuccess = () => {

      resolve(
        request.result
      );

    };


    request.onerror = () => {

      reject(
        request.error
      );

    };

  });

  return dbPromise;

}


/*
   Limpa a biblioteca anterior.
*/

async function clearDB() {

  const db =
    await openDB();


  await new Promise(
    (resolve, reject) => {

      const transaction =
        db.transaction(
          STORE,
          "readwrite"
        );


      transaction
        .objectStore(STORE)
        .clear();


      transaction.oncomplete =
        resolve;


      transaction.onerror =
        () => reject(
          transaction.error
        );

    }
  );

}


/*
   Grava lote de conteúdos.

   Não gravamos 400 mil itens de uma
   vez. Trabalhamos em lotes.
*/

async function putBatch(batch) {

  if (!batch.length) {
    return;
  }

  const db =
    await openDB();


  await new Promise(
    (resolve, reject) => {

      const transaction =
        db.transaction(
          STORE,
          "readwrite"
        );


      const store =
        transaction.objectStore(
          STORE
        );


      for (const item of batch) {

        store.put(item);

      }


      transaction.oncomplete =
        resolve;


      transaction.onerror =
        () => reject(
          transaction.error
        );

    }
  );

}


/*
   Recupera todos os itens.

   Usar somente quando necessário.
*/

async function getAllItems() {

  const db =
    await openDB();


  return new Promise(
    (resolve, reject) => {

      const request =
        db
          .transaction(
            STORE,
            "readonly"
          )
          .objectStore(STORE)
          .getAll();


      request.onsuccess =
        () => resolve(
          request.result || []
        );


      request.onerror =
        () => reject(
          request.error
        );

    }
  );

}


/* =========================================================
   STORAGE LOCAL
   ========================================================= */

function loadLocalState() {

  try {

    state.playlist =
      JSON.parse(
        localStorage.getItem(
          KEY.playlist
        ) || "null"
      );


    const settings =
      JSON.parse(
        localStorage.getItem(
          KEY.settings
        ) || "{}"
      );


    if (
      typeof settings.autoplay ===
      "boolean"
    ) {

      els.autoplay.checked =
        settings.autoplay;

    }


    if (
      typeof settings.compact ===
      "boolean"
    ) {

      els.compact.checked =
        settings.compact;

    }


    const favorites =
      JSON.parse(
        localStorage.getItem(
          KEY.favorites
        ) || "[]"
      );


    state.favorites =
      new Set(
        Array.isArray(favorites)
          ? favorites
          : []
      );


    const history =
      JSON.parse(
        localStorage.getItem(
          KEY.history
        ) || "[]"
      );


    state.history =
      Array.isArray(history)
        ? history
        : [];


    applyCompact();


    updateStatus(
      state.playlist
        ? "CONFIGURADO"
        : "OFFLINE"
    );


  } catch (error) {

    console.warn(
      "Falha ao restaurar dados locais:",
      error
    );

  }

}


/*
   Salva configurações.
*/

function saveSettings() {

  localStorage.setItem(

    KEY.settings,

    JSON.stringify({

      autoplay:
        !!els.autoplay.checked,

      compact:
        !!els.compact.checked

    })

  );


  applyCompact();

}


/*
   Ativa/desativa modo compacto.
*/

function applyCompact() {

  document.body.classList.toggle(

    "compact-mode",

    !!els.compact.checked

  );

}


/*
   Salva favoritos.
*/

function saveFavorites() {

  localStorage.setItem(

    KEY.favorites,

    JSON.stringify(
      [...state.favorites]
    )

  );

}


/*
   Salva histórico.
*/

function saveHistory() {

  localStorage.setItem(

    KEY.history,

    JSON.stringify(
      state.history.slice(0, 50)
    )

  );

}


/* =========================================================
   INTERFACE
   ========================================================= */

let toastTimer;


function toast(message) {

  if (!els.toast) {
    return;
  }


  els.toast.textContent =
    message;


  els.toast.classList.add(
    "show"
  );


  clearTimeout(
    toastTimer
  );


  toastTimer =
    setTimeout(() => {

      els.toast.classList.remove(
        "show"
      );

    }, 3000);

}


/*
   Atualiza o status.
*/

function updateStatus(text) {

  if (!els.status) {
    return;
  }

  els.status.textContent =
    text;

}


/*
   Abre diálogo.
*/

function openDialog(dialog) {

  if (!dialog) {
    return;
  }


  if (
    typeof dialog.showModal ===
    "function"
  ) {

    dialog.showModal();

  } else {

    dialog.setAttribute(
      "open",
      ""
    );

  }

}


/*
   Fecha diálogo.
*/

function closeDialog(dialog) {

  if (!dialog) {
    return;
  }


  if (
    typeof dialog.close ===
    "function"
  ) {

    dialog.close();

  } else {

    dialog.removeAttribute(
      "open"
    );

  }

}


/*
   Mensagem do formulário.
*/

function setMessage(
  text,
  error = false
) {

  if (!els.message) {
    return;
  }


  els.message.textContent =
    text;


  els.message.style.color =
    error
      ? "#ff667a"
      : "";

}


/*
   Atualiza contadores.
*/

function updateCounters() {

  els.channels.textContent =
    state.counts.live
      .toLocaleString("pt-BR");


  els.movies.textContent =
    state.counts.movie
      .toLocaleString("pt-BR");


  els.series.textContent =
    state.counts.series
      .toLocaleString("pt-BR");

}


/* =========================================================
   PARSER M3U
   ========================================================= */


/*
   Lê os atributos de uma linha EXTINF.

   Exemplo:

   #EXTINF:-1 tvg-name="Globo"
   tvg-logo="..." group-title="Brasil",Globo
*/

function parseExtInf(line) {

  const comma =
    line.indexOf(",");


  const metadata =
    comma >= 0
      ? line.slice(
          0,
          comma
        )
      : line;


  const title =
    comma >= 0
      ? line.slice(
          comma + 1
        ).trim()
      : "Sem nome";


  const attributes = {};

  const regex =
    /([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/g;


  let match;


  while (
    (match =
      regex.exec(metadata))
  ) {

    attributes[
      match[1].toLowerCase()
    ] =
      match[2];

  }


  return {

    title,

    name:
      attributes["tvg-name"] ||
      title,

    logo:
      attributes["tvg-logo"] ||
      "",

    group:
      attributes["group-title"] ||
      "",

    tvgId:
      attributes["tvg-id"] ||
      "",

    language:
      attributes["tvg-language"] ||
      ""

  };

}


/*
   Classificação automática.

   É uma classificação heurística,
   porque cada fornecedor M3U pode
   organizar os grupos de maneira
   diferente.
*/

function classify(
  metadata,
  url
) {

  const text = [

    metadata.group,

    metadata.name,

    metadata.title,

    url

  ]
    .join(" ")
    .toLowerCase();


  if (

    /\b(series|serie|séries|temporada|season|episode|episodio|episódio)\b/i
      .test(text)

    ||

    /\/series(?:\/|$)/i
      .test(url)

  ) {

    return "series";

  }


  if (

    /\b(movie|movies|filme|filmes|cinema|vod)\b/i
      .test(text)

    ||

    /\/(?:movie|movies|vod)(?:\/|$)/i
      .test(url)

  ) {

    return "movie";

  }


  return "live";

}


/*
   Gera um ID determinístico.
*/

function makeId(item) {

  const raw =

    `${item.type}|` +
    `${item.url}|` +
    `${item.name}|` +
    `${item.group}`;


  let hash =
    2166136261;


  for (
    let i = 0;
    i < raw.length;
    i++
  ) {

    hash ^= raw.charCodeAt(i);

    hash =
      Math.imul(
        hash,
        16777619
      );

  }


  return (
    hash >>> 0
  ).toString(36);

}


/*
   Cria objeto final.
*/

function parseEntry(
  metadata,
  url,
  index
) {

  if (
    !url ||
    url.startsWith("#")
  ) {

    return null;

  }


  const type =
    classify(
      metadata,
      url
    );


  const item = {

    id: "",

    index,

    type,

    name:
      metadata.name ||
      metadata.title ||
      "Sem nome",

    title:
      metadata.title ||
      metadata.name ||
      "Sem nome",

    group:
      metadata.group ||
      "Sem categoria",

    logo:
      metadata.logo ||
      "",

    url:
      url.trim(),

    tvgId:
      metadata.tvgId ||
      "",

    language:
      metadata.language ||
      ""

  };


  item.nameLower =
    item.name.toLocaleLowerCase(
      "pt-BR"
    );


  item.groupLower =
    item.group.toLocaleLowerCase(
      "pt-BR"
    );


  item.id =
    makeId(item);


  return item;

}


/* =========================================================
   PARSER EM STREAM
   ========================================================= */


/*
   Processa a resposta em chunks.

   Isso evita:

   response.text()

   em uma M3U gigante.

   O navegador vai recebendo e
   processando partes da lista.
*/

async function parseResponse(
  response,
  onBatch
) {

  if (!response.body) {

    const text =
      await response.text();

    await parseText(
      text,
      onBatch
    );

    return;

  }


  const reader =
    response.body.getReader();


  const decoder =
    new TextDecoder(
      "utf-8"
    );


  let buffer = "";

  let pending = null;

  let index = 0;

  let batch = [];


  const flush =
    async () => {

      if (!batch.length) {
        return;
      }


      const copy =
        batch;


      batch = [];


      await onBatch(copy);

    };


  const consumeLine =
    async line => {

      line =
        line
          .replace(
            /\r$/,
            ""
          )
          .trim();


      if (!line) {
        return;
      }


      if (
        line.startsWith(
          "#EXTINF"
        )
      ) {

        pending =
          parseExtInf(
            line
          );

        return;

      }


      if (
        line.startsWith("#")
      ) {

        return;

      }


      if (pending) {

        const item =
          parseEntry(
            pending,
            line,
            index++
          );


        pending = null;


        if (item) {

          batch.push(
            item
          );


          if (
            batch.length >=
            1000
          ) {

            await flush();

          }

        }

      }

    };


  while (true) {

    const result =
      await reader.read();


    if (result.done) {
      break;
    }


    buffer +=
      decoder.decode(
        result.value,
        {
          stream: true
        }
      );


    const lines =
      buffer.split("\n");


    buffer =
      lines.pop() || "";


    for (
      const line of lines
    ) {

      await consumeLine(
        line
      );

    }

  }


  buffer +=
    decoder.decode();


  if (buffer) {

    await consumeLine(
      buffer
    );

  }


  await flush();

}


/*
   Fallback para texto completo.
*/

async function parseText(
  text,
  onBatch
) {

  const lines =
    text.split(
      /\r?\n/
    );


  let pending = null;

  let index = 0;

  let batch = [];


  for (
    const raw of lines
  ) {

    const line =
      raw.trim();


    if (!line) {
      continue;
    }


    if (
      line.startsWith(
        "#EXTINF"
      )
    ) {

      pending =
        parseExtInf(
          line
        );

    }

    else if (

      !line.startsWith("#") &&

      pending

    ) {

      const item =
        parseEntry(
          pending,
          line,
          index++
        );


      pending = null;


      if (item) {

        batch.push(
          item
        );


        if (
          batch.length >=
          1000
        ) {

          await onBatch(
            batch
          );


          batch = [];

        }

      }

    }

  }


  if (batch.length) {

    await onBatch(
      batch
    );

  }

}


/* =========================================================
   FIM DA PARTE 1
   ========================================================= */
/* =========================================================
   CARREGAMENTO DA LISTA M3U
   ========================================================= */

async function loadM3U(url) {

  if (!url) {
    throw new Error(
      "URL da lista não informada."
    );
  }


  /*
     Se já existir um carregamento,
     cancelamos antes de começar outro.
  */

  if (state.abort) {

    state.abort.abort();

  }


  state.abort =
    new AbortController();


  /*
     Limpamos a biblioteca anterior.
  */

  await clearDB();


  state.items = [];

  state.total = 0;

  state.counts = {

    live: 0,

    movie: 0,

    series: 0

  };


  state.group = "";


  updateCounters();

  render();


  updateStatus(
    "CARREGANDO"
  );


  toast(
    "Carregando lista M3U..."
  );


  try {

    const response =
      await fetch(

        url,

        {

          signal:
            state.abort.signal,

          cache:
            "no-store",

          redirect:
            "follow"

        }

      );


    /*
       Verificação HTTP.
    */

    if (!response.ok) {

      throw new Error(
        `Servidor respondeu HTTP ${response.status}`
      );

    }


    /*
       O navegador precisa receber
       uma resposta acessível.

       Se o servidor não permitir
       CORS, o fetch poderá falhar.
    */

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";


    if (
      !contentType
        .toLowerCase()
        .includes("mpegurl")
    ) {

      console.warn(
        "Tipo de conteúdo inesperado:",
        contentType
      );

    }


    let firstPaint = true;

    let lastPaint = 0;


    /*
       Cada lote possui aproximadamente
       1.000 conteúdos.
    */

    await parseResponse(

      response,

      async batch => {

        /*
           Salva imediatamente
           no IndexedDB.
        */

        await putBatch(
          batch
        );


        /*
           Atualiza contadores.
        */

        state.total +=
          batch.length;


        for (
          const item of batch
        ) {

          state.counts[
            item.type
          ]++;

        }


        /*
           Mantemos somente uma
           pequena janela em RAM.

           Isso é importante para
           listas de 400.000+ itens.
        */

        if (
          state.items.length <
          3000
        ) {

          const available =
            3000 -
            state.items.length;


          state.items.push(

            ...batch.slice(
              0,
              available
            )

          );

        }


        /*
           Não redesenhamos a interface
           a cada item.

           Atualizamos no máximo
           aproximadamente 4 vezes
           por segundo durante o
           carregamento.
        */

        const now =
          performance.now();


        if (

          firstPaint ||

          now - lastPaint >
            250

        ) {

          firstPaint = false;

          lastPaint = now;


          updateCounters();


          render();

        }

      }

    );


    /*
       Final da leitura.
    */

    updateCounters();


    updateStatus(

      `ONLINE • ${
        state.total.toLocaleString(
          "pt-BR"
        )
      }`

    );


    toast(

      `Lista carregada: ${
        state.total.toLocaleString(
          "pt-BR"
        )
      } conteúdos.`

    );


    render();


  } catch (error) {

    /*
       Cancelamento não é erro.
    */

    if (
      error.name ===
      "AbortError"
    ) {

      return;

    }


    updateStatus(
      "ERRO"
    );


    /*
       TypeError no fetch costuma
       acontecer quando o navegador
       não consegue acessar o recurso.

       Um dos motivos possíveis
       é CORS.
    */

    const corsHint =

      error instanceof TypeError

        ? " Verifique CORS: o servidor da lista precisa permitir acesso pelo navegador."

        : "";


    toast(

      `Não foi possível carregar a lista.${corsHint}`

    );


    console.error(
      "Erro M3U:",
      error
    );


    throw error;

  }

}


/* =========================================================
   CONSULTA DA BIBLIOTECA
   ========================================================= */

function currentItems() {

  let list =
    state.items;


  /*
     Filtro de tipo.
  */

  if (
    state.filter !==
    "all"
  ) {

    list =
      list.filter(
        item =>
          item.type ===
          state.filter
      );

  }


  /*
     Filtro de grupo.
  */

  if (state.group) {

    list =
      list.filter(
        item =>
          item.group ===
          state.group
      );

  }


  /*
     Pesquisa.
  */

  if (state.query) {

    const query =
      state.query
        .toLocaleLowerCase(
          "pt-BR"
        );


    list =
      list.filter(
        item =>

          item.nameLower
            .includes(query)

          ||

          item.groupLower
            .includes(query)

      );

  }


  return list;

}


/* =========================================================
   CONSULTA INDEXED DB
   ========================================================= */


/*
   Quando a biblioteca é maior
   que a janela mantida na RAM,
   usamos o IndexedDB.

   A interface nunca precisa
   colocar 400.000 cards na tela.
*/

async function queryDB(
  limit = 120
) {

  const db =
    await openDB();


  return new Promise(
    (resolve, reject) => {

      const result = [];


      const transaction =
        db.transaction(
          STORE,
          "readonly"
        );


      const store =
        transaction.objectStore(
          STORE
        );


      const request =
        store.openCursor();


      request.onsuccess =
        () => {

          const cursor =
            request.result;


          if (
            !cursor ||

            result.length >=
              limit

          ) {

            resolve(
              result
            );

            return;

          }


          const item =
            cursor.value;


          /*
             Tipo.
          */

          const typeOK =

            state.filter ===
              "all"

            ||

            item.type ===
              state.filter;


          /*
             Grupo.
          */

          const groupOK =

            !state.group

            ||

            item.group ===
              state.group;


          /*
             Pesquisa.
          */

          const query =
            state.query;


          const searchOK =

            !query

            ||

            item.nameLower
              .includes(query)

            ||

            item.groupLower
              .includes(query);


          if (

            typeOK &&

            groupOK &&

            searchOK

          ) {

            result.push(
              item
            );

          }


          cursor.continue();

        };


      request.onerror =
        () => {

          reject(
            request.error
          );

        };

    }

  );

}


/* =========================================================
   CSS DINÂMICO PARA OS CARDS
   ========================================================= */


/*
   O CSS principal continua
   separado no style.css.

   Estes pequenos estilos são
   inseridos apenas para garantir
   que os componentes gerados
   pelo JavaScript funcionem.
*/

function ensureDynamicCSS() {

  if (
    document.getElementById(
      "gc-dynamic-style"
    )
  ) {

    return;

  }


  const style =
    document.createElement(
      "style"
    );


  style.id =
    "gc-dynamic-style";


  style.textContent = `

    .content-card {

      position: relative;

      overflow: hidden;

      min-height: 220px;

      border: 1px solid
        rgba(57,255,136,.10);

      border-radius: 16px;

      background: #07100b;

      color: #fff;

      cursor: pointer;

      transition:
        transform .2s ease,
        border-color .2s ease,
        box-shadow .2s ease;

    }


    .content-card:hover {

      transform:
        translateY(-3px);

      border-color:
        rgba(57,255,136,.45);

      box-shadow:
        0 12px 35px
        rgba(0,0,0,.35);

    }


    .content-image {

      height: 130px;

      background:
        linear-gradient(
          135deg,
          #07100b,
          #030605
        );

      display: grid;

      place-items: center;

      overflow: hidden;

    }


    .content-image img {

      width: 100%;

      height: 100%;

      object-fit: cover;

    }


    .content-image
    .fallback {

      font-size: 32px;

      color:
        #39ff88;

    }


    .content-info {

      padding: 12px;

    }


    .content-info strong {

      display: block;

      white-space: nowrap;

      overflow: hidden;

      text-overflow: ellipsis;

      font-size: 12px;

    }


    .content-info span {

      display: block;

      margin-top: 6px;

      color: #8b9a91;

      font-size: 9px;

      white-space: nowrap;

      overflow: hidden;

      text-overflow: ellipsis;

    }


    .content-type {

      position: absolute;

      top: 8px;

      left: 8px;

      padding: 5px 7px;

      border-radius: 7px;

      background:
        rgba(0,0,0,.72);

      color:
        #39ff88;

      font-size: 8px;

      font-weight: 900;

      z-index: 2;

    }


    .fav-btn {

      position: absolute;

      right: 8px;

      top: 8px;

      width: 30px;

      height: 30px;

      border:
        1px solid
        rgba(57,255,136,.18);

      border-radius: 8px;

      background:
        rgba(0,0,0,.72);

      color: #fff;

      cursor: pointer;

      z-index: 3;

    }


    .fav-btn.active {

      color:
        #39ff88;

    }


    .search-result {

      display: block;

      width: 100%;

      text-align: left;

      padding: 12px;

      border:
        1px solid
        rgba(57,255,136,.10);

      background:
        #07100b;

      color: #fff;

      border-radius: 10px;

      margin-top: 7px;

    }


    .search-result strong,

    .search-result span {

      display: block;

    }


    .search-result span {

      color:
        #8b9a91;

      font-size: 10px;

      margin-top: 4px;

    }


    .search-empty {

      padding: 20px;

      text-align: center;

      color:
        #8b9a91;

    }


    .group-select {

      height: 38px;

      max-width: 260px;

      margin-top: 12px;

      padding: 0 10px;

      border-radius: 9px;

      background:
        #050907;

      color: #fff;

      border:
        1px solid
        rgba(57,255,136,.15);

    }


    .library-progress {

      font-size: 10px;

      color:
        #8b9a91;

      margin-top: 10px;

    }


    .compact-mode
    .content-card {

      min-height: 175px;

    }


    .compact-mode
    .content-image {

      height: 90px;

    }

  `;


  document.head.appendChild(
    style
  );

}


/* =========================================================
   CARD DE CONTEÚDO
   ========================================================= */

function createCard(item) {

  const favorite =
    state.favorites.has(
      item.id
    );


  const typeLabel =

    item.type === "live"

      ? "TV"

      : item.type === "movie"

        ? "FILME"

        : "SÉRIE";


  return `

    <article
      class="content-card"
      data-id="${esc(item.id)}"
    >

      <div
        class="content-type"
      >
        ${typeLabel}
      </div>


      <button
        class="fav-btn ${
          favorite
            ? "active"
            : ""
        }"
        data-fav="${esc(item.id)}"
        aria-label="Favorito"
      >
        ${
          favorite
            ? "★"
            : "☆"
        }
      </button>


      <div
        class="content-image"
      >

        ${
          item.logo

            ? `

              <img
                loading="lazy"
                src="${esc(item.logo)}"
                alt=""
                onerror="this.style.display='none'"
              >

            `

            : `

              <div
                class="fallback"
              >
                GC
              </div>

            `
        }

      </div>


      <div
        class="content-info"
      >

        <strong>
          ${esc(item.name)}
        </strong>


        <span>
          ${esc(
            item.group ||
            "Sem categoria"
          )}
        </span>

      </div>

    </article>

  `;

}


/* =========================================================
   RENDERIZAÇÃO
   ========================================================= */

async function render() {

  if (!els.grid) {
    return;
  }


  ensureDynamicCSS();


  /*
     Primeiro tentamos a pequena
     janela que está na RAM.
  */

  const ramItems =
    currentItems();


  let visible =
    ramItems.slice(
      0,
      120
    );


  /*
     Se a RAM não tiver o suficiente,
     procuramos no IndexedDB.
  */

  if (

    visible.length < 120 &&

    state.total >
      state.items.length

  ) {

    try {

      const dbItems =
        await queryDB(
          120
        );


      visible =
        dbItems;

    } catch (error) {

      console.warn(
        "Consulta IndexedDB falhou:",
        error
      );

    }

  }


  /*
     Biblioteca vazia.
  */

  if (!visible.length) {

    els.grid.innerHTML =
      "";


    els.empty.style.display =
      "block";


    return;

  }


  els.empty.style.display =
    "none";


  /*
     Apenas os itens visíveis
     são colocados no DOM.
  */

  els.grid.innerHTML =

    visible
      .map(createCard)
      .join("");


  /*
     Remove indicador antigo.
  */

  const oldProgress =
    document.querySelector(
      ".library-progress"
    );


  if (oldProgress) {

    oldProgress.remove();

  }


  /*
     Indicador de biblioteca.
  */

  const progress =
    document.createElement(
      "div"
    );


  progress.className =
    "library-progress";


  progress.textContent =

    `${Math.min(
      visible.length,
      120
    ).toLocaleString(
      "pt-BR"
    )} exibidos • ` +

    `${state.total.toLocaleString(
      "pt-BR"
    )} no catálogo`;


  els.grid.after(
    progress
  );

}


/* =========================================================
   FAVORITOS
   ========================================================= */

function findItem(id) {

  return (

    state.items.find(
      item =>
        item.id === id
    )

    ||

    null

  );

}


function toggleFavorite(id) {

  if (
    state.favorites.has(id)
  ) {

    state.favorites.delete(
      id
    );

  } else {

    state.favorites.add(
      id
    );

  }


  saveFavorites();


  render();

}


/* =========================================================
   HISTÓRICO
   ========================================================= */

function addHistory(item) {

  state.history = [

    item.id,

    ...state.history.filter(
      id =>
        id !== item.id
    )

  ].slice(
    0,
    50
  );


  saveHistory();

}


/* =========================================================
   FIM DA PARTE 2
   ========================================================= */
/* =========================================================
   PLAYER
   ========================================================= */


/*
   Carrega HLS.js somente quando necessário.

   Isso evita carregar uma biblioteca pesada
   logo na abertura do aplicativo.
*/

async function loadHLS() {

  if (window.Hls) {

    return window.Hls;

  }


  await new Promise(
    (resolve, reject) => {

      const script =
        document.createElement(
          "script"
        );


      script.src =
        "https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js";


      script.onload =
        resolve;


      script.onerror =
        reject;


      document.head.appendChild(
        script
      );

    }
  );


  return window.Hls;

}


/*
   Reproduz um conteúdo.
*/

async function playItem(item) {

  if (
    !item ||
    !item.url
  ) {

    return;

  }


  /*
     Abre o player.
  */

  els.player.classList.remove(
    "hidden"
  );


  els.playerTitle.textContent =
    item.name;


  els.playerMessage.textContent =
    "Preparando reprodução...";


  els.playerMessage.style.display =
    "grid";


  /*
     Adiciona ao histórico.
  */

  addHistory(item);


  /*
     Destrói HLS anterior.
  */

  if (state.hls) {

    try {

      state.hls.destroy();

    } catch (error) {

      console.warn(
        "Erro ao destruir HLS:",
        error
      );

    }


    state.hls =
      null;

  }


  /*
     Limpa player anterior.
  */

  els.video.pause();

  els.video.removeAttribute(
    "src"
  );

  els.video.load();


  const url =
    item.url;


  /*
     Detecta HLS.
  */

  const isHLS =
    /\.m3u8(?:$|\?)/i.test(
      url
    );


  try {

    /*
       Caso HLS e navegador
       não possua suporte nativo.
    */

    if (

      isHLS &&

      !els.video.canPlayType(
        "application/vnd.apple.mpegurl"
      )

    ) {

      const Hls =
        await loadHLS();


      if (

        Hls &&

        Hls.isSupported()

      ) {

        state.hls =
          new Hls({

            enableWorker:
              true,

            lowLatencyMode:
              true,

            backBufferLength:
              30,

            maxBufferLength:
              30

          });


        state.hls.loadSource(
          url
        );


        state.hls.attachMedia(
          els.video
        );


        state.hls.on(

          Hls.Events.MANIFEST_PARSED,

          () => {

            els.playerMessage.style.display =
              "none";


            if (
              els.autoplay.checked
            ) {

              els.video
                .play()
                .catch(
                  () => {}
                );

            }

          }

        );


        state.hls.on(

          Hls.Events.ERROR,

          (_, data) => {

            if (
              data &&
              data.fatal
            ) {

              els.playerMessage.style.display =
                "grid";


              els.playerMessage.textContent =
                "Erro na transmissão.";

            }

          }

        );


        return;

      }

    }


    /*
       Reprodução nativa.

       Funciona para formatos que o navegador
       ou dispositivo consiga reproduzir.
    */

    els.video.src =
      url;


    els.video.onloadedmetadata =
      () => {

        els.playerMessage.style.display =
          "none";


        if (
          els.autoplay.checked
        ) {

          els.video
            .play()
            .catch(
              () => {}
            );

        }

      };


    els.video.onerror =
      () => {

        els.playerMessage.style.display =
          "grid";


        els.playerMessage.textContent =
          "Este conteúdo não pôde ser reproduzido neste navegador.";

      };


    els.video.load();


  } catch (error) {

    els.playerMessage.style.display =
      "grid";


    els.playerMessage.textContent =
      "Falha ao iniciar o player.";


    console.error(
      "Player:",
      error
    );

  }

}


/*
   Fecha player.
*/

function closePlayerPanel() {

  if (state.hls) {

    try {

      state.hls.destroy();

    } catch (error) {

      console.warn(
        error
      );

    }


    state.hls =
      null;

  }


  els.video.pause();


  els.video.removeAttribute(
    "src"
  );


  els.video.load();


  els.player.classList.add(
    "hidden"
  );

}


/* =========================================================
   PESQUISA
   ========================================================= */

let searchTimer;


/*
   Abre pesquisa.
*/

function openSearch() {

  openDialog(
    els.searchDialog
  );


  setTimeout(
    () => {

      if (els.search) {

        els.search.focus();

      }

    },
    100
  );

}


/*
   Executa pesquisa.

   Utilizamos debounce para evitar
   consultas a cada tecla.
*/

function doSearch() {

  clearTimeout(
    searchTimer
  );


  searchTimer =
    setTimeout(
      async () => {

        state.query =
          els.search.value
            .trim()
            .toLocaleLowerCase(
              "pt-BR"
            );


        /*
           Sem pesquisa.
        */

        if (!state.query) {

          els.searchResults.innerHTML =

            `

              <div
                class="search-empty"
              >
                Digite algo para pesquisar.
              </div>

            `;


          return;

        }


        /*
           Pesquisa no IndexedDB.

           Limitamos a 80 resultados.
        */

        const results =
          await queryDB(
            80
          );


        /*
           Mostra resultados.
        */

        els.searchResults.innerHTML =

          results.length

            ?

            results
              .map(
                item => `

                  <button
                    class="search-result"
                    data-search-id="${esc(
                      item.id
                    )}"
                  >

                    <strong>
                      ${esc(
                        item.name
                      )}
                    </strong>


                    <span>

                      ${esc(
                        item.group
                      )}

                      •


                      ${
                        item.type ===
                        "live"

                          ? "TV"

                          :

                        item.type ===
                        "movie"

                          ? "FILME"

                          : "SÉRIE"

                      }

                    </span>

                  </button>

                `
              )
              .join("")

            :

            `

              <div
                class="search-empty"
              >

                Nenhum conteúdo encontrado.

              </div>

            `;

      },

      150

    );

}


/* =========================================================
   IMPORTAÇÃO DE ARQUIVO M3U
   ========================================================= */


/*
   Cria botão para carregar uma M3U
   diretamente do aparelho.

   Isso também permite testar listas
   sem depender de CORS.
*/

function addFileButton() {

  /*
     Input invisível.
  */

  const input =
    document.createElement(
      "input"
    );


  input.type =
    "file";


  input.accept =
    ".m3u,.m3u8,.txt,audio/x-mpegurl,application/x-mpegurl";


  input.style.display =
    "none";


  document.body.appendChild(
    input
  );


  /*
     Botão visual.
  */

  const button =
    document.createElement(
      "button"
    );


  button.type =
    "button";


  button.className =
    "secondary-button";


  button.textContent =
    "USAR ARQUIVO M3U";


  button.style.width =
    "100%";


  button.style.marginTop =
    "10px";


  /*
     Coloca dentro do formulário.
  */

  if (els.form) {

    els.form.appendChild(
      button
    );

  }


  /*
     Abre seletor.
  */

  button.addEventListener(
    "click",
    () => {

      input.click();

    }
  );


  /*
     Quando usuário escolhe arquivo.
  */

  input.addEventListener(
    "change",
    async () => {

      const file =
        input.files &&
        input.files[0];


      if (!file) {

        return;

      }


      try {

        setMessage(
          `Lendo ${file.name}...`
        );


        /*
           Limpa biblioteca anterior.
        */

        await clearDB();


        state.items =
          [];


        state.total =
          0;


        state.counts = {

          live: 0,

          movie: 0,

          series: 0

        };


        /*
           O arquivo local pode ser
           processado em streaming.
        */

        await parseResponse(

          new Response(file),

          async batch => {

            await putBatch(
              batch
            );


            state.total +=
              batch.length;


            for (
              const item of batch
            ) {

              state.counts[
                item.type
              ]++;

            }


            /*
               Mantemos apenas
               pequena janela em RAM.
            */

            if (
              state.items.length <
              3000
            ) {

              const available =
                3000 -
                state.items.length;


              state.items.push(

                ...batch.slice(
                  0,
                  available
                )

              );

            }


            updateCounters();

          }

        );


        /*
           Salva informações da
           lista local.
        */

        state.playlist = {

          name:
            file.name,

          url:
            "",

          local:
            true,

          createdAt:
            new Date()
              .toISOString()

        };


        localStorage.setItem(

          KEY.playlist,

          JSON.stringify(
            state.playlist
          )

        );


        updateStatus(

          `ARQUIVO • ${
            state.total.toLocaleString(
              "pt-BR"
            )
          }`

        );


        setMessage(

          `Arquivo carregado: ${
            state.total.toLocaleString(
              "pt-BR"
            )
          } conteúdos.`

        );


        toast(
          "Lista M3U local carregada."
        );


        render();


      } catch (error) {

        console.error(
          "Arquivo M3U:",
          error
        );


        setMessage(
          "Não foi possível ler o arquivo.",
          true
        );

      }

    }

  );

}


/* =========================================================
   SALVAR PLAYLIST POR URL
   ========================================================= */

async function savePlaylist(
  event
) {

  event.preventDefault();


  const name =
    els.name.value.trim();


  const url =
    els.url.value.trim();


  /*
     Validação do nome.
  */

  if (!name) {

    setMessage(
      "Informe um nome.",
      true
    );


    return;

  }


  /*
     Validação da URL.
  */

  try {

    new URL(url);

  } catch {

    setMessage(
      "URL inválida.",
      true
    );


    return;

  }


  /*
     Salva configuração.
  */

  state.playlist = {

    name,

    url,

    createdAt:
      new Date()
        .toISOString()

  };


  localStorage.setItem(

    KEY.playlist,

    JSON.stringify(
      state.playlist
    )

  );


  setMessage(
    "URL salva. Carregando lista..."
  );


  updateStatus(
    "CARREGANDO"
  );


  /*
     Agora tenta realmente
     carregar a M3U.
  */

  try {

    await loadM3U(
      url
    );


    closeDialog(
      els.dialog
    );


  } catch (error) {

    setMessage(

      "A lista foi salva, mas o navegador não conseguiu acessá-la. Pode ser CORS ou URL indisponível.",

      true

    );

  }

}


/* =========================================================
   NAVEGAÇÃO PRINCIPAL
   ========================================================= */

function setupNavigation() {

  /*
     Menu superior.
  */

  $$(".nav-item")
    .forEach(
      button => {

        button.addEventListener(
          "click",
          async () => {

            /*
               Atualiza estado visual.
            */

            $$(".nav-item")
              .forEach(
                item =>
                  item.classList.remove(
                    "active"
                  )
              );


            button.classList.add(
              "active"
            );


            const section =
              button.dataset.section;


            /*
               Define filtro.
            */

            if (
              section === "live"
            ) {

              state.filter =
                "live";

            }

            else if (
              section === "movies"
            ) {

              state.filter =
                "movie";

            }

            else if (
              section === "series"
            ) {

              state.filter =
                "series";

            }

            else if (
              section ===
              "favorites"
            ) {

              /*
                 Favoritos será tratado
                 posteriormente pelo
                 filtro específico.

                 Por enquanto,
                 limpamos pesquisa.
              */

              state.filter =
                "all";

              state.query =
                "";

            }

            else {

              state.filter =
                "all";

            }


            await render();


            /*
               Desce até biblioteca.
            */

            if (
              els.library
            ) {

              els.library.scrollIntoView({
                behavior:
                  "smooth"
              });

            }

          }

        );

      }
    );


  /*
     Filtros da biblioteca.
  */

  $$(".filter-button")
    .forEach(
      button => {

        button.addEventListener(
          "click",
          async () => {

            $$(".filter-button")
              .forEach(
                item =>
                  item.classList.remove(
                    "active"
                  )
              );


            button.classList.add(
              "active"
            );


            state.filter =
              button.dataset.filter ||
              "all";


            await render();

          }

        );

      }
    );

}


/* =========================================================
   EVENTOS
   ========================================================= */

function setupEvents() {

  /*
     Adicionar lista.
  */

  if (els.add) {

    els.add.addEventListener(
      "click",
      () => {

        setMessage("");

        openDialog(
          els.dialog
        );

      }
    );

  }


  /*
     Botão do estado vazio.
  */

  if (els.emptyAdd) {

    els.emptyAdd.addEventListener(
      "click",
      () => {

        setMessage("");

        openDialog(
          els.dialog
        );

      }
    );

  }


  /*
     Fechar lista.
  */

  if (els.closeDialog) {

    els.closeDialog.addEventListener(
      "click",
      () => {

        closeDialog(
          els.dialog
        );

      }
    );

  }


  /*
     Formulário.
  */

  if (els.form) {

    els.form.addEventListener(
      "submit",
      savePlaylist
    );

  }


  /*
     Pesquisa.
  */

  if (els.searchButton) {

    els.searchButton.addEventListener(
      "click",
      openSearch
    );

  }


  if (els.closeSearch) {

    els.closeSearch.addEventListener(
      "click",
      () => {

        closeDialog(
          els.searchDialog
        );

      }
    );

  }


  if (els.search) {

    els.search.addEventListener(
      "input",
      doSearch
    );

  }


  /*
     Configurações.
  */

  if (els.settingsButton) {

    els.settingsButton.addEventListener(
      "click",
      () => {

        openDialog(
          els.settingsDialog
        );

      }
    );

  }


  if (els.closeSettings) {

    els.closeSettings.addEventListener(
      "click",
      () => {

        closeDialog(
          els.settingsDialog
        );

      }
    );

  }


  if (els.autoplay) {

    els.autoplay.addEventListener(
      "change",
      saveSettings
    );

  }


  if (els.compact) {

    els.compact.addEventListener(
      "change",
      saveSettings
    );

  }


  /*
     Explorar.
  */

  if (els.explore) {

    els.explore.addEventListener(
      "click",
      () => {

        if (
          els.library
        ) {

          els.library.scrollIntoView({
            behavior:
              "smooth"
          });

        }

      }
    );

  }


  /*
     Fechar player.
  */

  if (els.closePlayer) {

    els.closePlayer.addEventListener(
      "click",
      closePlayerPanel
    );

  }


  /*
     Clique nos cards.
  */

  if (els.grid) {

    els.grid.addEventListener(
      "click",
      event => {

        /*
           Primeiro verifica favorito.
        */

        const favorite =
          event.target.closest(
            "[data-fav]"
          );


        if (favorite) {

          event.stopPropagation();


          toggleFavorite(
            favorite.dataset.fav
          );


          return;

        }


        /*
           Depois verifica card.
        */

        const card =
          event.target.closest(
            ".content-card"
          );


        if (!card) {

          return;

        }


        const item =
          findItem(
            card.dataset.id
          );


        if (item) {

          playItem(
            item
          );

        }

      }
    );

  }


  /*
     Resultado de pesquisa.
  */

  if (els.searchResults) {

    els.searchResults.addEventListener(
      "click",
      event => {

        const button =
          event.target.closest(
            "[data-search-id]"
          );


        if (!button) {

          return;

        }


        const item =
          findItem(
            button.dataset.searchId
          );


        if (item) {

          closeDialog(
            els.searchDialog
          );


          playItem(
            item
          );

        }

      }
    );

  }


  /*
     Tecla ESC.
  */

  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key ===
        "Escape"
      ) {

        if (
          els.player &&
          !els.player.classList.contains(
            "hidden"
          )
        ) {

          closePlayerPanel();

        }

      }

    }
  );

}


/* =========================================================
   INICIALIZAÇÃO
   ========================================================= */

async function init() {

  /*
     Garante estilos dos elementos
     gerados pelo JavaScript.
  */

  ensureDynamicCSS();


  /*
     Recupera configurações.
  */

  loadLocalState();


  /*
     Configura navegação.
  */

  setupNavigation();


  /*
     Configura eventos.
  */

  setupEvents();


  /*
     Adiciona opção de arquivo.
  */

  addFileButton();


  /*
     Inicializa IndexedDB.
  */

  try {

    await openDB();


    state.dbReady =
      true;


    /*
       Se existe playlist salva,
       não baixamos automaticamente
       uma M3U gigantesca.

       O usuário decide quando
       carregar.
    */

    if (
      state.playlist &&
      state.playlist.url
    ) {

      updateStatus(
        "CONFIGURADO"
      );

    }

  } catch (error) {

    console.error(
      "IndexedDB indisponível:",
      error
    );


    toast(
      "Armazenamento local avançado indisponível."
    );

  }


  /*
     Contadores iniciais.
  */

  updateCounters();


  /*
     Primeira renderização.
  */

  render();

}


/* =========================================================
   INICIAR APLICAÇÃO
   ========================================================= */

init();


/* =========================================================
   FIM DO GC PLAY PRO
   ========================================================= */
