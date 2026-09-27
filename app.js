/* =========================================================
   GC PLAY PRO — APP.JS
   Versão completa
   M3U + IndexedDB + pesquisa + favoritos + HLS
   + proxy Supabase para fontes autorizadas com CORS
   ========================================================= */

"use strict";

/* =========================================================
   CONFIGURAÇÃO DO BACKEND
   ========================================================= */

const GC_SUPABASE_URL =
  "https://kuzgdvpdqmocklsgyzvt.supabase.co";

/*
  Chave ANON pública do projeto.
  Ela pode ser usada no navegador.
*/
const GC_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1emdkdnBkbW9ja3NneXp2dCIsImlhdCI6MTc4ODkwNzY2NiwiZXhwIjoyMTA0NDgzNjY2fQ.i8sbcWehPQ0wl98Rmwe4TGzfufqK0U9G5iHIYCGIBoc";

const GC_M3U_PROXY =
  `${GC_SUPABASE_URL}/functions/v1/m3u-proxy`;

/*
  Neste primeiro teste o Edge Function aceita
  somente o domínio autorizado no servidor.
*/
const GC_PROXY_HOSTS = new Set([
  "z1sv.site"
]);

function getM3URequest(url) {
  const target = new URL(url);

  if (
    GC_PROXY_HOSTS.has(
      target.hostname.toLowerCase()
    )
  ) {
    return {
      url:
        `${GC_M3U_PROXY}?url=${encodeURIComponent(url)}`,

      headers: {
        Authorization:
          `Bearer ${GC_SUPABASE_ANON_KEY}`,

        apikey:
          GC_SUPABASE_ANON_KEY
      }
    };
  }

  return {
    url,
    headers: {}
  };
}


/* =========================================================
   HELPERS
   ========================================================= */

const $ = (
  selector,
  root = document
) =>
  root.querySelector(selector);

const $$ = (
  selector,
  root = document
) =>
  [...root.querySelectorAll(selector)];

const esc = value =>
  String(value ?? "").replace(
    /[&<>"']/g,
    char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char])
  );

const normalize = value =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();

const formatNumber = value =>
  Number(value || 0)
    .toLocaleString("pt-BR");

function safeUrl(value) {
  try {
    return new URL(value).toString();
  } catch {
    return "";
  }
}


/* =========================================================
   ELEMENTOS
   ========================================================= */

const els = {

  add:
    $("#addPlaylistButton"),

  emptyAdd:
    $("#emptyAddButton"),

  dialog:
    $("#playlistDialog"),

  form:
    $("#playlistForm"),

  closeDialog:
    $("#closePlaylistDialog"),

  name:
    $("#playlistName"),

  url:
    $("#playlistUrl"),

  message:
    $("#playlistMessage"),

  searchButton:
    $("#searchButton"),

  searchDialog:
    $("#searchDialog"),

  closeSearch:
    $("#closeSearchDialog"),

  search:
    $("#globalSearch"),

  searchResults:
    $("#searchResults"),

  settingsButton:
    $("#settingsButton"),

  settingsDialog:
    $("#settingsDialog"),

  closeSettings:
    $("#closeSettingsDialog"),

  autoplay:
    $("#autoplaySetting"),

  compact:
    $("#compactSetting"),

  explore:
    $("#exploreButton"),

  grid:
    $("#contentGrid"),

  empty:
    $("#emptyState"),

  library:
    $("#librarySection"),

  status:
    $("#connectionStatus"),

  channels:
    $("#channelCount"),

  movies:
    $("#movieCount"),

  series:
    $("#seriesCount"),

  player:
    $("#playerPanel"),

  closePlayer:
    $("#closePlayer"),

  video:
    $("#videoPlayer"),

  playerTitle:
    $("#playerTitle"),

  playerMessage:
    $("#playerMessage"),

  toast:
    $("#toast")

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
   ESTADO
   ========================================================= */

const state = {

  filter:
    "all",

  group:
    "",

  query:
    "",

  total:
    0,

  counts: {

    live:
      0,

    movie:
      0,

    series:
      0

  },

  items:
    [],

  favorites:
    new Set(),

  history:
    [],

  playlist:
    null,

  db:
    null,

  dbReady:
    false,

  rendering:
    false,

  abort:
    null,

  hls:
    null,

  favoriteOnly:
    false,

  settings: {

    autoplay:
      true,

    compact:
      false

  }

};


/* =========================================================
   TOAST / STATUS
   ========================================================= */

let toastTimer = null;

function toast(
  message,
  duration = 4000
) {

  if (!els.toast)
    return;

  els.toast.textContent =
    message;

  els.toast.classList.add(
    "show"
  );

  clearTimeout(
    toastTimer
  );

  toastTimer =
    setTimeout(
      () => {
        els.toast.classList.remove(
          "show"
        );
      },
      duration
    );

}

function updateStatus(text) {

  if (els.status) {
    els.status.textContent =
      text;
  }

}

function setMessage(
  message,
  error = false
) {

  if (!els.message)
    return;

  els.message.textContent =
    message || "";

  els.message.classList.toggle(
    "error",
    Boolean(error)
  );

}


/* =========================================================
   LOCAL STORAGE
   ========================================================= */

function loadLocalState() {

  try {

    state.playlist =
      JSON.parse(
        localStorage.getItem(
          KEY.playlist
        ) || "null"
      );

  } catch {

    state.playlist =
      null;

  }


  try {

    state.settings = {

      ...state.settings,

      ...JSON.parse(
        localStorage.getItem(
          KEY.settings
        ) || "{}"
      )

    };

  } catch {}


  try {

    const favorites =
      JSON.parse(
        localStorage.getItem(
          KEY.favorites
        ) || "[]"
      );

    state.favorites =
      new Set(
        Array.isArray(
          favorites
        )
          ? favorites.map(
              String
            )
          : []
      );

  } catch {

    state.favorites =
      new Set();

  }


  try {

    state.history =
      JSON.parse(
        localStorage.getItem(
          KEY.history
        ) || "[]"
      );

    if (
      !Array.isArray(
        state.history
      )
    ) {

      state.history =
        [];

    }

  } catch {

    state.history =
      [];

  }


  if (els.autoplay) {

    els.autoplay.checked =
      state.settings.autoplay !==
      false;

  }


  if (els.compact) {

    els.compact.checked =
      state.settings.compact ===
      true;

  }


  document.body.classList.toggle(
    "compact-mode",
    state.settings.compact ===
      true
  );

}


function saveLocalState() {

  try {

    localStorage.setItem(
      KEY.playlist,
      JSON.stringify(
        state.playlist
      )
    );

    localStorage.setItem(
      KEY.settings,
      JSON.stringify(
        state.settings
      )
    );

    localStorage.setItem(
      KEY.favorites,
      JSON.stringify(
        [...state.favorites]
      )
    );

    localStorage.setItem(
      KEY.history,
      JSON.stringify(
        state.history.slice(
          0,
          50
        )
      )
    );

  } catch (error) {

    console.warn(
      "localStorage:",
      error
    );

  }

}


/* =========================================================
   INDEXED DB
   ========================================================= */

const DB_NAME =
  "GC_PLAY_PRO_DB";

const DB_VERSION =
  2;

const STORE =
  "items";


function openDB() {

  return new Promise(
    (
      resolve,
      reject
    ) => {

      if (
        !(
          "indexedDB"
          in window
        )
      ) {

        reject(
          new Error(
            "IndexedDB não disponível."
          )
        );

        return;

      }


      const request =
        indexedDB.open(
          DB_NAME,
          DB_VERSION
        );


      request.onupgradeneeded =
        event => {

          const db =
            event.target.result;

          let store;


          if (
            !db.objectStoreNames.contains(
              STORE
            )
          ) {

            store =
              db.createObjectStore(
                STORE,
                {
                  keyPath:
                    "id"
                }
              );

          } else {

            store =
              event
                .target
                .transaction
                .objectStore(
                  STORE
                );

          }


          if (
            !store.indexNames.contains(
              "type"
            )
          ) {

            store.createIndex(
              "type",
              "type",
              {
                unique:
                  false
              }
            );

          }


          if (
            !store.indexNames.contains(
              "group"
            )
          ) {

            store.createIndex(
              "group",
              "group",
              {
                unique:
                  false
              }
            );

          }


          if (
            !store.indexNames.contains(
              "name"
            )
          ) {

            store.createIndex(
              "name",
              "nameLower",
              {
                unique:
                  false
              }
            );

          }

        };


      request.onsuccess =
        () => {

          state.db =
            request.result;

          state.dbReady =
            true;

          state.db.onversionchange =
            () => {

              state.db.close();

            };

          resolve(
            state.db
          );

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


function clearDB() {

  return new Promise(
    (
      resolve,
      reject
    ) => {

      if (
        !state.dbReady
      ) {

        resolve();

        return;

      }


      const transaction =
        state.db.transaction(
          STORE,
          "readwrite"
        );


      transaction
        .objectStore(
          STORE
        )
        .clear();


      transaction.oncomplete =
        resolve;

      transaction.onerror =
        () =>
          reject(
            transaction.error
          );

    }
  );

}


function putBatch(batch) {

  if (
    !batch.length
  ) {

    return Promise.resolve();

  }


  return new Promise(
    (
      resolve,
      reject
    ) => {

      const transaction =
        state.db.transaction(
          STORE,
          "readwrite"
        );


      const store =
        transaction.objectStore(
          STORE
        );


      for (
        const item of batch
      ) {

        store.put(
          item
        );

      }


      transaction.oncomplete =
        resolve;

      transaction.onerror =
        () =>
          reject(
            transaction.error
          );

    }
  );

}


function getItemById(id) {

  return new Promise(
    (
      resolve,
      reject
    ) => {

      if (
        !state.dbReady
      ) {

        resolve(
          null
        );

        return;

      }


      const request =
        state.db
          .transaction(
            STORE,
            "readonly"
          )
          .objectStore(
            STORE
          )
          .get(id);


      request.onsuccess =
        () =>
          resolve(
            request.result ||
              null
          );


      request.onerror =
        () =>
          reject(
            request.error
          );

    }
  );

}


function getItems(options = {}) {

  const {

    limit =
      120,

    type =
      "",

    group =
      "",

    query =
      ""

  } = options;


  return new Promise(
    (
      resolve,
      reject
    ) => {

      if (
        !state.dbReady
      ) {

        resolve(
          []
        );

        return;

      }


      const transaction =
        state.db.transaction(
          STORE,
          "readonly"
        );


      const store =
        transaction.objectStore(
          STORE
        );


      let source =
        store;


      if (
        type &&
        [
          "live",
          "movie",
          "series"
        ].includes(type)
      ) {

        source =
          store.index(
            "type"
          );

      }


      const request =
        source.openCursor(
          type
            ? IDBKeyRange.only(
                type
              )
            : null
        );


      const result =
        [];


      const q =
        normalize(
          query
        );


      request.onsuccess =
        event => {

          const cursor =
            event.target.result;


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


          const matchesGroup =
            !group ||
            item.group ===
              group;


          const matchesQuery =
            !q ||
            item.nameLower.includes(
              q
            ) ||
            item.groupLower.includes(
              q
            );


          if (
            matchesGroup &&
            matchesQuery
          ) {

            result.push(
              item
            );

          }


          cursor.continue();

        };


      request.onerror =
        () =>
          reject(
            request.error
          );

    }
  );

}


function getAllGroups() {

  return new Promise(
    (
      resolve,
      reject
    ) => {

      if (
        !state.dbReady
      ) {

        resolve(
          []
        );

        return;

      }


      const groups =
        new Set();


      const request =
        state.db
          .transaction(
            STORE,
            "readonly"
          )
          .objectStore(
            STORE
          )
          .openCursor();


      request.onsuccess =
        event => {

          const cursor =
            event.target.result;


          if (!cursor) {

            resolve(
              [...groups]
                .filter(
                  Boolean
                )
                .sort(
                  (
                    a,
                    b
                  ) =>
                    a.localeCompare(
                      b,
                      "pt-BR"
                    )
                )
            );

            return;

          }


          if (
            cursor.value.group
          ) {

            groups.add(
              cursor.value.group
            );

          }


          cursor.continue();

        };


      request.onerror =
        () =>
          reject(
            request.error
          );

    }
  );

}


/* =========================================================
   M3U PARSER
   ========================================================= */

function parseAttributes(
  line
) {

  const attrs =
    {};

  const regex =
    /([A-Za-z0-9_-]+)="([^"]*)"/g;

  let match;


  while (
    (
      match =
        regex.exec(
          line
        )
    )
  ) {

    attrs[
      match[1].toLowerCase()
    ] =
      match[2];

  }


  return attrs;

}


function classifyEntry(
  name,
  group,
  url
) {

  const text =
    `${name} ${group} ${url}`
      .toLowerCase();


  if (
    /series|serie|s[eé]rie|season|temporada|episode|episodio|s\d{1,2}\s*e\d{1,2}/i
      .test(
        text
      )
  ) {

    return "series";

  }


  if (
    /\.(mp4|mkv|avi|mov|wmv)(\?|$)/i
      .test(
        url
      ) ||
    /filme|movie|cinema|vod/i
      .test(
        text
      )
  ) {

    return "movie";

  }


  return "live";

}


function makeId(
  name,
  url,
  group
) {

  const input =
    `${name}|${url}|${group}`;


  let hash =
    2166136261;


  for (
    let i = 0;
    i < input.length;
    i++
  ) {

    hash ^=
      input.charCodeAt(
        i
      );

    hash =
      Math.imul(
        hash,
        16777619
      );

  }


  return (
    "gc_" +
    (
      hash >>> 0
    ).toString(16) +
    "_" +
    Math.abs(
      input.length
    )
  );

}


function parseEntry(
  extinf,
  url,
  pendingGroup = ""
) {

  if (
    !extinf ||
    !url
  ) {

    return null;

  }


  const attrs =
    parseAttributes(
      extinf
    );


  const comma =
    extinf.indexOf(
      ","
    );


  let name =
    comma >= 0
      ? extinf
          .slice(
            comma + 1
          )
          .trim()
      : attrs[
          "tvg-name"
        ] ||
        "Sem nome";


  name =
    name ||
    "Sem nome";


  const group =
    attrs[
      "group-title"
    ] ||
    pendingGroup ||
    "";


  const logo =
    attrs[
      "tvg-logo"
    ] ||
    attrs[
      "logo"
    ] ||
    "";


  const type =
    classifyEntry(
      name,
      group,
      url
    );


  return {

    id:
      makeId(
        name,
        url,
        group
      ),

    name:

      name,

    nameLower:

      normalize(
        name
      ),

    group:

      group,

    groupLower:

      normalize(
        group
      ),

    logo:

      logo,

    url:

      url,

    type:

      type,

    tvgId:

      attrs[
        "tvg-id"
      ] ||
      "",

    language:

      attrs[
        "tvg-language"
      ] ||
      "",

    country:

      attrs[
        "tvg-country"
      ] ||
      ""

  };

}


async function parseResponse(
  response,
  onBatch
) {

  if (
    !response.body
  ) {

    throw new Error(
      "O servidor não forneceu um fluxo de dados."
    );

  }


  const reader =
    response.body.getReader();


  const decoder =
    new TextDecoder(
      "utf-8"
    );


  let buffer =
    "";

  let extinf =
    null;

  let pendingGroup =
    "";

  let batch =
    [];


  const flush =
    async () => {

      if (
        !batch.length
      ) {

        return;

      }


      const current =
        batch;

      batch =
        [];


      await onBatch(
        current
      );

    };


  while (true) {

    const {
      done,
      value
    } =
      await reader.read();


    if (done)
      break;


    buffer +=
      decoder.decode(
        value,
        {
          stream:
            true
        }
      );


    const lines =
      buffer.split(
        /\r?\n/
      );


    buffer =
      lines.pop() ||
      "";


    for (
      let raw of lines
    ) {

      const line =
        raw.trim();


      if (!line)
        continue;


      if (
        line.startsWith(
          "#EXTGRP:"
        )
      ) {

        pendingGroup =
          line
            .slice(
              8
            )
            .trim();

        continue;

      }


      if (
        line.startsWith(
          "#EXTINF:"
        )
      ) {

        extinf =
          line;

        continue;

      }


      if (
        line.startsWith(
          "#"
        )
      ) {

        continue;

      }


      if (extinf) {

        const item =
          parseEntry(
            extinf,
            line,
            pendingGroup
          );


        extinf =
          null;


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

    }

  }


  buffer +=
    decoder.decode();


  const last =
    buffer.trim();


  if (
    last &&
    !last.startsWith(
      "#"
    ) &&
    extinf
  ) {

    const item =
      parseEntry(
        extinf,
        last,
        pendingGroup
      );


    if (item) {

      batch.push(
        item
      );

    }

  }


  await flush();

}


async function parseText(
  text,
  onBatch
) {

  const response =
    new Response(
      new Blob(
        [text],
        {
          type:
            "audio/x-mpegurl"
        }
      )
    );


  await parseResponse(
    response,
    onBatch
  );

}


/* =========================================================
   CONTADORES
   ========================================================= */

function updateCounters() {

  if (els.channels) {

    els.channels.textContent =
      formatNumber(
        state.counts.live
      );

  }


  if (els.movies) {

    els.movies.textContent =
      formatNumber(
        state.counts.movie
      );

  }


  if (els.series) {

    els.series.textContent =
      formatNumber(
        state.counts.series
      );

  }

}


/* =========================================================
   CSS DINÂMICO
   ========================================================= */

function ensureDynamicCSS() {

  if (
    $("#gc-play-dynamic-css")
  ) {

    return;

  }


  const style =
    document.createElement(
      "style"
    );


  style.id =
    "gc-play-dynamic-css";


  style.textContent = `

    .content-card{

      position:relative;
      overflow:hidden;
      cursor:pointer;

      border:
        1px solid
        rgba(
          50,
          255,
          130,
          .14
        );

      background:
        linear-gradient(
          145deg,
          rgba(
            10,
            28,
            19,
            .96
          ),
          rgba(
            3,
            8,
            6,
            .96
          )
        );

      border-radius:
        20px;

      min-height:
        170px;

      transition:
        transform
        .2s
        ease,
        border-color
        .2s
        ease,
        box-shadow
        .2s
        ease;

    }


    .content-card:hover{

      transform:
        translateY(-3px);

      border-color:
        rgba(
          50,
          255,
          130,
          .5
        );

      box-shadow:
        0 12px 35px
        rgba(
          0,
          255,
          120,
          .12
        );

    }


    .content-image{

      height:
        110px;

      display:
        flex;

      align-items:
        center;

      justify-content:
        center;

      background:
        radial-gradient(
          circle at center,
          rgba(
            34,
            255,
            126,
            .16
          ),
          rgba(
            0,
            0,
            0,
            .2
          )
        );

      overflow:
        hidden;

    }


    .content-image img{

      width:
        100%;

      height:
        100%;

      object-fit:
        cover;

    }


    .content-placeholder{

      font-size:
        32px;

      opacity:
        .7;

    }


    .content-info{

      padding:
        12px
        14px
        14px;

    }


    .content-type{

      font-size:
        10px;

      letter-spacing:
        1.5px;

      font-weight:
        800;

      color:
        #39ff87;

      margin-bottom:
        6px;

    }


    .content-name{

      font-weight:
        800;

      white-space:
        nowrap;

      overflow:
        hidden;

      text-overflow:
        ellipsis;

    }


    .content-group{

      margin-top:
        5px;

      color:
        rgba(
          255,
          255,
          255,
          .55
        );

      font-size:
        11px;

      white-space:
        nowrap;

      overflow:
        hidden;

      text-overflow:
        ellipsis;

    }


    .fav-btn{

      position:
        absolute;

      right:
        10px;

      top:
        10px;

      width:
        34px;

      height:
        34px;

      border-radius:
        50%;

      border:
        1px solid
        rgba(
          50,
          255,
          130,
          .25
        );

      background:
        rgba(
          0,
          0,
          0,
          .65
        );

      color:
        #fff;

      cursor:
        pointer;

      z-index:
        3;

    }


    .fav-btn.active{

      color:
        #39ff87;

      border-color:
        #39ff87;

    }


    .search-result{

      display:
        flex;

      gap:
        12px;

      align-items:
        center;

      padding:
        12px;

      border:
        1px solid
        rgba(
          50,
          255,
          130,
          .12
        );

      border-radius:
        14px;

      margin-bottom:
        8px;

      cursor:
        pointer;

      background:
        rgba(
          5,
          15,
          10,
          .8
        );

    }


    .search-result:hover{

      border-color:
        rgba(
          50,
          255,
          130,
          .4
        );

    }


    .search-result-thumb{

      width:
        48px;

      height:
        48px;

      border-radius:
        10px;

      object-fit:
        cover;

      background:
        #07140d;

      flex:
        0 0 auto;

    }


    .search-result-title{

      font-weight:
        800;

    }


    .search-result-meta{

      font-size:
        11px;

      color:
        rgba(
          255,
          255,
          255,
          .55
        );

      margin-top:
        4px;

    }


    .search-empty{

      padding:
        25px
        10px;

      text-align:
        center;

      opacity:
        .6;

    }


    .library-progress{

      margin:
        15px 0;

      padding:
        12px
        15px;

      border-radius:
        14px;

      border:
        1px solid
        rgba(
          50,
          255,
          130,
          .15
        );

      background:
        rgba(
          10,
          30,
          18,
          .65
        );

      color:
        #39ff87;

      font-size:
        12px;

    }


    .group-select{

      max-width:
        220px;

      margin-left:
        auto;

      margin-bottom:
        15px;

    }


    .group-select select{

      width:
        100%;

      padding:
        11px
        13px;

      border-radius:
        12px;

      border:
        1px solid
        rgba(
          50,
          255,
          130,
          .18
        );

      background:
        #07110b;

      color:
        #fff;

    }


    .hidden{

      display:
        none !important;

    }


    .compact-mode
    .content-card{

      min-height:
        135px;

    }


    .compact-mode
    .content-image{

      height:
        80px;

    }

  `;


  document.head.appendChild(
    style
  );

}


/* =========================================================
   GRUPOS
   ========================================================= */

let groupSelectEl =
  null;


async function buildGroupSelector() {

  if (
    !els.library
  ) {

    return;

  }


  const groups =
    await getAllGroups();


  if (
    !groups.length &&
    !groupSelectEl
  ) {

    return;

  }


  if (
    !groupSelectEl
  ) {

    groupSelectEl =
      document.createElement(
        "div"
      );


    groupSelectEl.className =
      "group-select";


    groupSelectEl.innerHTML = `

      <select
        aria-label="Grupo"
      >

        <option value="">
          Todos os grupos
        </option>

      </select>

    `;


    const header =
      els.library.querySelector(
        ".section-header"
      );


    if (header) {

      header.after(
        groupSelectEl
      );

    }


    const select =
      $("select",
        groupSelectEl
      );


    select.addEventListener(
      "change",
      () => {

        state.group =
          select.value;

        render();

      }
    );

  }


  const select =
    $("select",
      groupSelectEl
    );


  select.innerHTML =
    `
      <option value="">
        Todos os grupos
      </option>
    ` +
    groups
      .map(
        group =>
          `
          <option
            value="${esc(group)}"
          >
            ${esc(group)}
          </option>
          `
      )
      .join("");


  select.value =
    groups.includes(
      state.group
    )
      ? state.group
      : "";

}


/* =========================================================
   CARD
   ========================================================= */

function typeLabel(type) {

  if (
    type === "movie"
  ) {

    return "FILME";

  }


  if (
    type === "series"
  ) {

    return "SÉRIE";

  }


  return "TV AO VIVO";

}


function cardLogo(item) {

  return item.logo

    ? `
      <img
        src="${esc(item.logo)}"
        alt=""
        loading="lazy"
        onerror="this.style.display='none'"
      >
    `

    : `
      <div
        class="content-placeholder"
      >
        GC
      </div>
    `;

}


function createCard(item) {

  const card =
    document.createElement(
      "article"
    );


  card.className =
    "content-card";


  const favorite =
    state.favorites.has(
      item.id
    );


  card.innerHTML = `

    <button
      class="fav-btn
      ${favorite ? "active" : ""}"
      title="Favorito"
      aria-label="Favorito"
    >
      ★
    </button>


    <div
      class="content-image"
    >
      ${cardLogo(item)}
    </div>


    <div
      class="content-info"
    >

      <div
        class="content-type"
      >
        ${typeLabel(
          item.type
        )}
      </div>


      <div
        class="content-name"
      >
        ${esc(
          item.name
        )}
      </div>


      <div
        class="content-group"
      >
        ${esc(
          item.group ||
          "Sem grupo"
        )}
      </div>

    </div>

  `;


  const fav =
    $(".fav-btn",
      card
    );


  fav.addEventListener(
    "click",
    event => {

      event.stopPropagation();

      toggleFavorite(
        item
      );

    }
  );


  card.addEventListener(
    "click",
    () => {

      playItem(
        item
      );

    }
  );


  return card;

}


/* =========================================================
   RENDER
   ========================================================= */

async function getVisibleItems() {

  if (
    !state.dbReady
  ) {

    return [];

  }


  if (
    state.favoriteOnly
  ) {

    const results =
      [];


    for (
      const id of
      state.favorites
    ) {

      if (
        results.length >=
        120
      ) {

        break;

      }


      const item =
        await getItemById(
          id
        );


      if (item) {

        results.push(
          item
        );

      }

    }


    return results;

  }


  return getItems({

    limit:
      120,

    type:
      state.filter ===
      "all"
        ? ""
        : state.filter,

    group:
      state.group,

    query:
      state.query

  });

}


async function render() {

  if (
    state.rendering ||
    !els.grid
  ) {

    return;

  }


  state.rendering =
    true;


  try {

    const items =
      await getVisibleItems();


    els.grid.innerHTML =
      "";


    if (
      !items.length
    ) {

      els.grid.classList.add(
        "hidden"
      );


      if (els.empty) {

        els.empty.classList.remove(
          "hidden"
        );

      }


      return;

    }


    els.grid.classList.remove(
      "hidden"
    );


    if (els.empty) {

      els.empty.classList.add(
        "hidden"
      );

    }


    const fragment =
      document.createDocumentFragment();


    for (
      const item of items
    ) {

      fragment.appendChild(
        createCard(
          item
        )
      );

    }


    els.grid.appendChild(
      fragment
    );

  } finally {

    state.rendering =
      false;

  }

}


/* =========================================================
   CARREGAMENTO M3U
   ========================================================= */

async function loadM3U(
  url
) {

  if (!url) {

    throw new Error(
      "URL da lista não informada."
    );

  }


  if (
    state.abort
  ) {

    state.abort.abort();

  }


  state.abort =
    new AbortController();


  await clearDB();


  state.items =
    [];


  state.total =
    0;


  state.counts = {

    live:
      0,

    movie:
      0,

    series:
      0

  };


  state.group =
    "";


  updateCounters();


  await render();


  updateStatus(
    "CARREGANDO"
  );


  toast(
    "Conectando à lista M3U...",
    5000
  );


  const request =
    getM3URequest(
      url
    );


  try {

    const response =
      await fetch(
        request.url,
        {

          method:
            "GET",

          signal:
            state.abort.signal,

          cache:
            "no-store",

          redirect:
            "follow",

          headers:
            request.headers

        }
      );


    if (
      !response.ok
    ) {

      throw new Error(
        `Servidor respondeu HTTP ${response.status}`
      );

    }


    const contentType =
      response.headers.get(
        "content-type"
      ) || "";


    console.log(
      "GC PLAY PRO M3U:",
      {
        url:
          request.url,

        contentType
      }
    );


    let lastPaint =
      0;


    await parseResponse(
      response,
      async batch => {

        await putBatch(
          batch
        );


        state.total +=
          batch.length;


        for (
          const item of
          batch
        ) {

          if (
            state.counts[
              item.type
            ] !==
            undefined
          ) {

            state.counts[
              item.type
            ]++;

          }

        }


        /*
          Mantemos apenas uma
          pequena janela em RAM.
          O restante fica no IndexedDB.
        */

        if (
          state.items.length <
          3000
        ) {

          const room =
            3000 -
            state.items.length;


          state.items.push(
            ...batch.slice(
              0,
              room
            )
          );

        }


        const now =
          performance.now();


        if (
          now -
          lastPaint >
          300
        ) {

          lastPaint =
            now;


          updateCounters();


          updateStatus(
            `CARREGANDO • ${formatNumber(
              state.total
            )}`
          );

        }

      }
    );


    updateCounters();


    updateStatus(
      `ONLINE • ${formatNumber(
        state.total
      )}`
    );


    toast(
      `Lista carregada: ${formatNumber(
        state.total
      )} conteúdos.`,
      5000
    );


    await buildGroupSelector();


    await render();


    saveLocalState();


  } catch (
    error
  ) {

    if (
      error?.name ===
      "AbortError"
    ) {

      return;

    }


    updateStatus(
      "ERRO"
    );


    console.error(
      "GC PLAY PRO M3U:",
      error
    );


    const message =
      error instanceof
      TypeError

        ? "O navegador não conseguiu acessar a fonte. Verifique CORS ou use o proxy autorizado."

        : error.message ||
          "Falha ao carregar a lista.";


    setMessage(
      message,
      true
    );


    toast(
      message,
      7000
    );


    throw error;

  }

}


/* =========================================================
   FAVORITOS
   ========================================================= */

function toggleFavorite(
  item
) {

  if (
    state.favorites.has(
      item.id
    )
  ) {

    state.favorites.delete(
      item.id
    );

  } else {

    state.favorites.add(
      item.id
    );

  }


  saveLocalState();


  render();

}


/* =========================================================
   HISTÓRICO
   ========================================================= */

function addHistory(
  item
) {

  state.history =
    [

      {
        id:
          item.id,

        time:
          Date.now()

      },

      ...state.history.filter(
        entry =>
          entry.id !==
          item.id
      )

    ].slice(
      0,
      50
    );


  saveLocalState();

}


/* =========================================================
   HLS / PLAYER
   ========================================================= */

function destroyHLS() {

  if (
    state.hls
  ) {

    try {

      state.hls.destroy();

    } catch {}

    state.hls =
      null;

  }

}


async function loadHLS() {

  if (
    window.Hls
  ) {

    return window.Hls;

  }


  await new Promise(
    (
      resolve,
      reject
    ) => {

      const existing =
        document.querySelector(
          'script[data-gc-hls]'
        );


      if (existing) {

        existing.addEventListener(
          "load",
          resolve,
          {
            once:
              true
          }
        );


        existing.addEventListener(
          "error",
          reject,
          {
            once:
              true
          }
        );


        return;

      }


      const script =
        document.createElement(
          "script"
        );


      script.src =
        "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js";


      script.dataset.gcHls =
        "1";


      script.onload =
        resolve;


      script.onerror =
        () =>
          reject(
            new Error(
              "Não foi possível carregar o HLS.js."
            )
          );


      document.head.appendChild(
        script
      );

    }
  );


  return window.Hls;

}


async function playItem(
  item
) {

  if (
    !item?.url
  ) {

    return;

  }


  addHistory(
    item
  );


  if (
    els.player
  ) {

    els.player.classList.remove(
      "hidden"
    );

  }


  if (
    els.playerTitle
  ) {

    els.playerTitle.textContent =
      item.name;

  }


  if (
    els.playerMessage
  ) {

    els.playerMessage.textContent =
      "Carregando...";

  }


  destroyHLS();


  const video =
    els.video;


  if (!video)
    return;


  video.pause();


  video.removeAttribute(
    "src"
  );


  video.load();


  const url =
    safeUrl(
      item.url
    );


  if (!url) {

    if (
      els.playerMessage
    ) {

      els.playerMessage.textContent =
        "URL de reprodução inválida.";

    }


    return;

  }


  const isHLS =
    /\.m3u8(\?|$)/i.test(
      url
    );


  try {

    if (
      isHLS &&
      window.Hls &&
      window.Hls.isSupported()
    ) {

      state.hls =
        new window.Hls({

          enableWorker:
            true,

          lowLatencyMode:
            false

        });


      state.hls.loadSource(
        url
      );


      state.hls.attachMedia(
        video
      );


      state.hls.on(
        window.Hls.Events.MANIFEST_PARSED,
        () => {

          if (
            state.settings
              .autoplay
          ) {

            video
              .play()
              .catch(
                () => {}
              );

          }

        }
      );


    } else if (
      isHLS &&
      video.canPlayType(
        "application/vnd.apple.mpegurl"
      )
    ) {

      video.src =
        url;


      if (
        state.settings
          .autoplay
      ) {

        await video
          .play()
          .catch(
            () => {}
          );

      }


    } else {

      video.src =
        url;


      if (
        state.settings
          .autoplay
      ) {

        await video
          .play()
          .catch(
            () => {}
          );

      }

    }


    if (
      els.playerMessage
    ) {

      els.playerMessage.textContent =
        "";

    }


    if (
      els.player &&
      state.settings
        .autoplay
    ) {

      els.player.scrollIntoView({

        behavior:
          "smooth",

        block:
          "start"

      });

    }


  } catch (
    error
  ) {

    console.error(
      "Player:",
      error
    );


    if (
      els.playerMessage
    ) {

      els.playerMessage.textContent =
        "Não foi possível iniciar este conteúdo.";

    }

  }

}


/* =========================================================
   PESQUISA GLOBAL
   ========================================================= */

let searchTimer =
  null;


async function searchGlobal(
  query
) {

  const q =
    normalize(
      query
    );


  if (
    !els.searchResults
  ) {

    return;

  }


  if (!q) {

    els.searchResults.innerHTML =
      "";

    return;

  }


  els.searchResults.innerHTML =
    `
      <div
        class="search-empty"
      >
        Pesquisando...
      </div>
    `;


  try {

    const results =
      await getItems({

        limit:
          80,

        query:
          q

      });


    if (
      !results.length
    ) {

      els.searchResults.innerHTML =
        `
          <div
            class="search-empty"
          >
            Nenhum conteúdo encontrado.
          </div>
        `;

      return;

    }


    els.searchResults.innerHTML =
      results
        .map(
          item => `

            <div
              class="search-result"
              data-id="${esc(
                item.id
              )}"
            >

              ${
                item.logo

                  ? `

                    <img
                      class="search-result-thumb"
                      src="${esc(
                        item.logo
                      )}"
                      alt=""
                      onerror="this.style.display='none'"
                    >

                  `

                  : `

                    <div
                      class="search-result-thumb"
                    ></div>

                  `
              }


              <div>

                <div
                  class="search-result-title"
                >
                  ${esc(
                    item.name
                  )}
                </div>


                <div
                  class="search-result-meta"
                >
                  ${esc(
                    typeLabel(
                      item.type
                    )
                  )}

                  ·

                  ${esc(
                    item.group ||
                    "Sem grupo"
                  )}

                </div>

              </div>

            </div>

          `
        )
        .join("");


    $$(".search-result",
      els.searchResults
    )
      .forEach(
        element => {

          element.addEventListener(
            "click",
            async () => {

              const item =
                await getItemById(
                  element.dataset.id
                );


              if (!item) {

                toast(
                  "Conteúdo não encontrado."
                );

                return;

              }


              closeDialog(
                els.searchDialog
              );


              playItem(
                item
              );

            }
          );

        }
      );


  } catch (
    error
  ) {

    console.error(
      "Pesquisa:",
      error
    );


    els.searchResults.innerHTML =
      `
        <div
          class="search-empty"
        >
          Erro na pesquisa.
        </div>
      `;

  }

}


/* =========================================================
   DIÁLOGOS
   ========================================================= */

function openDialog(
  dialog
) {

  if (!dialog)
    return;


  if (
    typeof dialog.showModal ===
    "function"
  ) {

    if (
      !dialog.open
    ) {

      dialog.showModal();

    }

  } else {

    dialog.setAttribute(
      "open",
      ""
    );

  }

}


function closeDialog(
  dialog
) {

  if (!dialog)
    return;


  if (
    typeof dialog.close ===
    "function"
  ) {

    if (
      dialog.open
    ) {

      dialog.close();

    }

  } else {

    dialog.removeAttribute(
      "open"
    );

  }

}


function openPlaylistDialog() {

  setMessage(
    ""
  );


  if (
    els.name &&
    !els.name.value
  ) {

    els.name.value =
      state.playlist?.name ||
      "";

  }


  if (
    els.url &&
    !els.url.value
  ) {

    els.url.value =
      state.playlist?.url ||
      "";

  }


  openDialog(
    els.dialog
  );

}


function openSearchDialog() {

  openDialog(
    els.searchDialog
  );


  setTimeout(
    () => {

      els.search?.focus();

    },
    100
  );

}


function openSettingsDialog() {

  openDialog(
    els.settingsDialog
  );

}


/* =========================================================
   IMPORTAÇÃO DE ARQUIVO
   ========================================================= */

function createFileImporter() {

  if (!els.form)
    return;


  if (
    $("#gcFileImportButton")
  ) {

    return;

  }


  const button =
    document.createElement(
      "button"
    );


  button.type =
    "button";


  button.id =
    "gcFileImportButton";


  button.className =
    "secondary-button";


  button.textContent =
    "USAR ARQUIVO M3U";


  const input =
    document.createElement(
      "input"
    );


  input.type =
    "file";


  input.accept =
    ".m3u,.m3u8,text/plain,audio/x-mpegurl";


  input.hidden =
    true;


  button.addEventListener(
    "click",
    () =>
      input.click()
  );


  input.addEventListener(
    "change",
    async () => {

      const file =
        input.files?.[0];


      if (!file)
        return;


      setMessage(
        "Lendo arquivo M3U..."
      );


      try {

        await clearDB();


        state.items =
          [];


        state.total =
          0;


        state.counts = {

          live:
            0,

          movie:
            0,

          series:
            0

        };


        updateCounters();


        const text =
          await file.text();


        await parseText(
          text,
          async batch => {

            await putBatch(
              batch
            );


            state.total +=
              batch.length;


            for (
              const item of
              batch
            ) {

              state.counts[
                item.type
              ]++;

            }


            if (
              state.items.length <
              3000
            ) {

              const room =
                3000 -
                state.items.length;


              state.items.push(
                ...batch.slice(
                  0,
                  room
                )
              );

            }


            updateCounters();

          }
        );


        state.playlist = {

          name:
            file.name,

          url:
            `file:${file.name}`,

          source:
            "local"

        };


        saveLocalState();


        updateStatus(
          `ONLINE • ${formatNumber(
            state.total
          )}`
        );


        await buildGroupSelector();


        await render();


        closeDialog(
          els.dialog
        );


        toast(
          `Arquivo carregado: ${formatNumber(
            state.total
          )} conteúdos.`,
          5000
        );


      } catch (
        error
      ) {

        console.error(
          "Arquivo M3U:",
          error
        );


        setMessage(
          "Não foi possível ler o arquivo M3U.",
          true
        );

      }


      input.value =
        "";

    }
  );


  els.form.appendChild(
    button
  );


  els.form.appendChild(
    input
  );

}


/* =========================================================
   NAVEGAÇÃO
   ========================================================= */

function setFilter(
  filter
) {

  state.favoriteOnly =
    false;


  state.filter =
    filter ||
    "all";


  $$(".filter-button")
    .forEach(
      button => {

        button.classList.toggle(

          "active",

          button.dataset
            .filter ===
            state.filter

        );

      }
    );


  render();

}


function showFavorites() {

  state.favoriteOnly =
    true;


  state.filter =
    "all";


  $$(".filter-button")
    .forEach(
      button => {

        button.classList.toggle(

          "active",

          button.dataset
            .filter ===
            "all"

        );

      }
    );


  if (
    els.library
  ) {

    els.library.scrollIntoView({

      behavior:
        "smooth",

      block:
        "start"

    });

  }


  render();

}


function handleNavigation(
  section
) {

  if (
    section ===
    "home"
  ) {

    window.scrollTo({

      top:
        0,

      behavior:
        "smooth"

    });


    state.favoriteOnly =
      false;


    return;

  }


  if (
    section ===
    "live"
  ) {

    setFilter(
      "live"
    );

  }


  if (
    section ===
    "movies"
  ) {

    setFilter(
      "movie"
    );

  }


  if (
    section ===
    "series"
  ) {

    setFilter(
      "series"
    );

  }


  if (
    section ===
    "favorites"
  ) {

    showFavorites();

  }


  if (
    els.library
  ) {

    els.library.scrollIntoView({

      behavior:
        "smooth",

      block:
        "start"

    });

  }

}


/* =========================================================
   EVENTOS
   ========================================================= */

function bindEvents() {

  els.add?.addEventListener(
    "click",
    openPlaylistDialog
  );


  els.emptyAdd?.addEventListener(
    "click",
    openPlaylistDialog
  );


  els.explore?.addEventListener(
    "click",
    () => {

      els.library?.scrollIntoView({

        behavior:
          "smooth",

        block:
          "start"

      });

    }
  );


  els.closeDialog?.addEventListener(
    "click",
    () =>
      closeDialog(
        els.dialog
      )
  );


  els.searchButton?.addEventListener(
    "click",
    openSearchDialog
  );


  els.closeSearch?.addEventListener(
    "click",
    () =>
      closeDialog(
        els.searchDialog
      )
  );


  els.settingsButton?.addEventListener(
    "click",
    openSettingsDialog
  );


  els.closeSettings?.addEventListener(
    "click",
    () =>
      closeDialog(
        els.settingsDialog
      )
  );


  els.closePlayer?.addEventListener(
    "click",
    () => {

      destroyHLS();


      els.video?.pause();


      if (
        els.video
      ) {

        els.video.removeAttribute(
          "src"
        );

        els.video.load();

      }


      els.player?.classList.add(
        "hidden"
      );

    }
  );


  $$(".filter-button")
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () =>
            setFilter(
              button.dataset
                .filter
            )
        );

      }
    );


  $$(".nav-item")
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            $$(".nav-item")
              .forEach(
                item =>
                  item.classList.toggle(
                    "active",
                    item ===
                      button
                  )
              );


            handleNavigation(
              button.dataset
                .section
            );

          }
        );

      }
    );


  els.search?.addEventListener(
    "input",
    () => {

      clearTimeout(
        searchTimer
      );


      searchTimer =
        setTimeout(
          () =>
            searchGlobal(
              els.search.value
            ),
          180
        );

    }
  );


  els.autoplay?.addEventListener(
    "change",
    () => {

      state.settings.autoplay =
        els.autoplay.checked;

      saveLocalState();

    }
  );


  els.compact?.addEventListener(
    "change",
    () => {

      state.settings.compact =
        els.compact.checked;


      document.body.classList.toggle(

        "compact-mode",

        state.settings.compact

      );


      saveLocalState();

    }
  );


  els.form?.addEventListener(
    "submit",
    async event => {

      event.preventDefault();


      const name =
        els.name?.value.trim() ||
        "Minha lista";


      const url =
        els.url?.value.trim();


      if (!url) {

        setMessage(
          "Informe a URL da lista.",
          true
        );

        return;

      }


      try {

        new URL(
          url
        );

      } catch {

        setMessage(
          "URL inválida.",
          true
        );

        return;

      }


      const submit =
        $(
          "button[type='submit']",
          els.form
        );


      if (submit) {

        submit.disabled =
          true;

        submit.textContent =
          "CARREGANDO...";

      }


      setMessage(
        "Conectando..."
      );


      try {

        state.playlist = {

          name,

          url,

          source:
            "remote",

          savedAt:
            Date.now()

        };


        saveLocalState();


        await loadM3U(
          url
        );


        setMessage(
          `Lista carregada com ${formatNumber(
            state.total
          )} conteúdos.`
        );


        closeDialog(
          els.dialog
        );


      } catch {

        /*
          loadM3U já mostra
          a mensagem detalhada.
        */

      } finally {

        if (submit) {

          submit.disabled =
            false;

          submit.textContent =
            "SALVAR LISTA";

        }

      }

    }
  );


  [
    els.dialog,
    els.searchDialog,
    els.settingsDialog

  ]

    .filter(
      Boolean
    )

    .forEach(
      dialog => {

        dialog.addEventListener(
          "click",
          event => {

            if (
              event.target ===
              dialog
            ) {

              closeDialog(
                dialog
              );

            }

          }
        );

      }
    );

}


/* =========================================================
   INICIALIZAÇÃO
   ========================================================= */

async function init() {

  ensureDynamicCSS();


  loadLocalState();


  bindEvents();


  createFileImporter();


  updateCounters();


  updateStatus(
    "OFFLINE"
  );


  try {

    await openDB();


    if (
      state.playlist?.source ===
        "remote" &&
      state.playlist.url
    ) {

      updateStatus(
        state.total
          ? `ONLINE • ${formatNumber(
              state.total
            )}`
          : "CONFIGURADO"
      );

    }


    const first =
      await getItems({
        limit:
          1
      });


    if (
      first.length
    ) {

      updateStatus(
        "ONLINE"
      );

    }


    await buildGroupSelector();


    await render();


  } catch (
    error
  ) {

    console.error(
      "IndexedDB:",
      error
    );


    toast(
      "Armazenamento local avançado indisponível."
    );

  }

}


/* =========================================================
   INICIAR
   ========================================================= */

init();


/* =========================================================
   FIM DO GC PLAY PRO
   ========================================================= */
