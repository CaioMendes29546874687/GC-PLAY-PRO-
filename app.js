/* =====================================================
   GC PLAY PRO
   APP.JS — BASE FUNCIONAL
   ===================================================== */

"use strict";


/* =====================================================
   HELPERS
   ===================================================== */

const $ = (selector) => document.querySelector(selector);

const $$ = (selector) => document.querySelectorAll(selector);


/* =====================================================
   ELEMENTOS
   ===================================================== */

const addPlaylistButton = $("#addPlaylistButton");
const emptyAddButton = $("#emptyAddButton");

const playlistDialog = $("#playlistDialog");
const playlistForm = $("#playlistForm");

const closePlaylistDialog = $("#closePlaylistDialog");

const playlistName = $("#playlistName");
const playlistUrl = $("#playlistUrl");

const playlistMessage = $("#playlistMessage");

const searchButton = $("#searchButton");
const searchDialog = $("#searchDialog");
const closeSearchDialog = $("#closeSearchDialog");

const globalSearch = $("#globalSearch");
const searchResults = $("#searchResults");

const settingsButton = $("#settingsButton");
const settingsDialog = $("#settingsDialog");
const closeSettingsDialog = $("#closeSettingsDialog");

const autoplaySetting = $("#autoplaySetting");
const compactSetting = $("#compactSetting");

const exploreButton = $("#exploreButton");

const librarySection = $("#librarySection");

const contentGrid = $("#contentGrid");
const emptyState = $("#emptyState");

const connectionStatus = $("#connectionStatus");

const channelCount = $("#channelCount");
const movieCount = $("#movieCount");
const seriesCount = $("#seriesCount");

const playerPanel = $("#playerPanel");
const closePlayer = $("#closePlayer");

const videoPlayer = $("#videoPlayer");
const playerTitle = $("#playerTitle");
const playerMessage = $("#playerMessage");

const toast = $("#toast");


/* =====================================================
   STORAGE
   ===================================================== */

const STORAGE_KEYS = {

  playlist:
    "gc_play_pro_playlist",

  settings:
    "gc_play_pro_settings",

  favorites:
    "gc_play_pro_favorites",

  history:
    "gc_play_pro_history"

};


/* =====================================================
   ESTADO
   ===================================================== */

let appState = {

  playlist: null,

  channels: [],

  movies: [],

  series: [],

  favorites: [],

  history: [],

  activeFilter: "all",

  searchTerm: ""

};


/* =====================================================
   TOAST
   ===================================================== */

let toastTimer = null;


function showToast(message) {

  if (!toast) {
    return;
  }

  toast.textContent = message;

  toast.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {

    toast.classList.remove("show");

  }, 2800);

}


/* =====================================================
   DIALOGS
   ===================================================== */

function openDialog(dialog) {

  if (!dialog) {
    return;
  }

  if (typeof dialog.showModal === "function") {

    dialog.showModal();

  } else {

    dialog.setAttribute("open", "");

  }

}


function closeDialog(dialog) {

  if (!dialog) {
    return;
  }

  if (typeof dialog.close === "function") {

    dialog.close();

  } else {

    dialog.removeAttribute("open");

  }

}


/* =====================================================
   LISTA M3U
   ===================================================== */

function openPlaylistDialog() {

  playlistMessage.textContent = "";

  if (appState.playlist) {

    playlistName.value =
      appState.playlist.name || "";

    playlistUrl.value =
      appState.playlist.url || "";

  }

  openDialog(playlistDialog);

}


function savePlaylist(event) {

  event.preventDefault();


  const name =
    playlistName.value.trim();

  const url =
    playlistUrl.value.trim();


  if (!name) {

    playlistMessage.textContent =
      "Informe um nome para a lista.";

    return;

  }


  if (!url) {

    playlistMessage.textContent =
      "Informe a URL da lista M3U.";

    return;

  }


  try {

    new URL(url);

  } catch {

    playlistMessage.textContent =
      "A URL informada não é válida.";

    return;

  }


  appState.playlist = {

    name,

    url,

    createdAt:
      new Date().toISOString()

  };


  localStorage.setItem(

    STORAGE_KEYS.playlist,

    JSON.stringify(appState.playlist)

  );


  connectionStatus.textContent =
    "CONFIGURADO";


  playlistMessage.textContent =
    "Lista salva neste dispositivo.";


  showToast(
    "Lista M3U configurada."
  );


  setTimeout(() => {

    closeDialog(playlistDialog);

  }, 700);

}


/* =====================================================
   CARREGAR PLAYLIST SALVA
   ===================================================== */

function loadPlaylist() {

  try {

    const stored =
      localStorage.getItem(
        STORAGE_KEYS.playlist
      );


    if (!stored) {
      return;
    }


    appState.playlist =
      JSON.parse(stored);


    if (appState.playlist) {

      connectionStatus.textContent =
        "CONFIGURADO";

    }

  } catch (error) {

    console.error(
      "Erro ao carregar playlist:",
      error
    );

  }

}


/* =====================================================
   CONFIGURAÇÕES
   ===================================================== */

function loadSettings() {

  try {

    const stored =
      localStorage.getItem(
        STORAGE_KEYS.settings
      );


    if (!stored) {
      return;
    }


    const settings =
      JSON.parse(stored);


    if (
      typeof settings.autoplay ===
      "boolean"
    ) {

      autoplaySetting.checked =
        settings.autoplay;

    }


    if (
      typeof settings.compact ===
      "boolean"
    ) {

      compactSetting.checked =
        settings.compact;

    }


    applyCompactMode();

  } catch (error) {

    console.error(
      "Erro ao carregar configurações:",
      error
    );

  }

}


function saveSettings() {

  const settings = {

    autoplay:
      autoplaySetting.checked,

    compact:
      compactSetting.checked

  };


  localStorage.setItem(

    STORAGE_KEYS.settings,

    JSON.stringify(settings)

  );

}


function applyCompactMode() {

  document.body.classList.toggle(

    "compact-mode",

    compactSetting.checked

  );

}


/* =====================================================
   BUSCA
   ===================================================== */

function openSearch() {

  openDialog(searchDialog);

  setTimeout(() => {

    globalSearch.focus();

  }, 100);

}


function closeSearch() {

  closeDialog(searchDialog);

}


function searchContent(term) {

  const query =
    term.trim().toLowerCase();


  appState.searchTerm =
    query;


  if (!query) {

    searchResults.innerHTML = `

      <div class="search-empty">

        Digite algo para pesquisar.

      </div>

    `;

    return;

  }


  const allContent = [

    ...appState.channels,

    ...appState.movies,

    ...appState.series

  ];


  const results =
    allContent.filter(item => {

      const name =
        String(item.name || "")
          .toLowerCase();

      const group =
        String(item.group || "")
          .toLowerCase();

      return (
        name.includes(query) ||
        group.includes(query)
      );

    });


  if (!results.length) {

    searchResults.innerHTML = `

      <div class="search-empty">

        Nenhum conteúdo encontrado.

      </div>

    `;

    return;

  }


  searchResults.innerHTML =
    results
      .slice(0, 50)
      .map(item => `

        <button
          class="search-result"
          data-url="${escapeHtml(item.url || "")}"
        >

          <strong>
            ${escapeHtml(item.name || "Sem nome")}
          </strong>

          <span>
            ${escapeHtml(item.group || "Conteúdo")}
          </span>

        </button>

      `)
      .join("");


  $$(".search-result").forEach(button => {

    button.addEventListener(
      "click",
      () => {

        const url =
          button.dataset.url;

        const item =
          allContent.find(
            content =>
              content.url === url
          );


        if (item) {

          playContent(item);

          closeSearch();

        }

      }
    );

  });

}


/* =====================================================
   ESCAPE HTML
   ===================================================== */

function escapeHtml(value) {

  return String(value)

    .replaceAll("&", "&amp;")

    .replaceAll("<", "&lt;")

    .replaceAll(">", "&gt;")

    .replaceAll('"', "&quot;")

    .replaceAll("'", "&#039;");

}


/* =====================================================
   FILTROS
   ===================================================== */

function setFilter(filter) {

  appState.activeFilter =
    filter;


  $$(".filter-button")
    .forEach(button => {

      button.classList.toggle(

        "active",

        button.dataset.filter === filter

      );

    });


  renderContent();

}


/* =====================================================
   RENDERIZAÇÃO
   ===================================================== */

function getFilteredContent() {

  let data = [];


  switch (appState.activeFilter) {

    case "live":

      data = appState.channels;

      break;


    case "movie":

      data = appState.movies;

      break;


    case "series":

      data = appState.series;

      break;


    default:

      data = [

        ...appState.channels,

        ...appState.movies,

        ...appState.series

      ];

  }


  if (appState.searchTerm) {

    const query =
      appState.searchTerm;


    data =
      data.filter(item => {

        const name =
          String(item.name || "")
            .toLowerCase();

        return name.includes(query);

      });

  }


  return data;

}


function renderContent() {

  const data =
    getFilteredContent();


  if (!data.length) {

    contentGrid.innerHTML = "";

    emptyState.style.display =
      "block";

    return;

  }


  emptyState.style.display =
    "none";


  contentGrid.innerHTML =
    data
      .slice(0, 200)
      .map(item =>
        createContentCard(item)
      )
      .join("");


  $$(".content-card").forEach(card => {

    card.addEventListener(
      "click",
      () => {

        const index =
          Number(card.dataset.index);

        const current =
          data[index];

        if (current) {

          playContent(current);

        }

      }
    );

  });

}


/* =====================================================
   CARD
   ===================================================== */

function createContentCard(item) {

  const image =
    item.logo ||
    item.cover ||
    "";


  const imageHTML = image

    ? `

      <img
        src="${escapeHtml(image)}"
        loading="lazy"
        alt=""
        onerror="this.style.display='none'"
      >

    `

    : `

      <div class="card-placeholder">
        GC
      </div>

    `;


  return `

    <article
      class="content-card"
      data-index="${getItemIndex(item)}"
    >

      <div class="content-image">

        ${imageHTML}

        <div class="card-overlay">

          ▶

        </div>

      </div>


      <div class="content-info">

        <strong>
          ${escapeHtml(
            item.name || "Sem nome"
          )}
        </strong>

        <span>
          ${escapeHtml(
            item.group || "Conteúdo"
          )}
        </span>

      </div>

    </article>

  `;

}


function getItemIndex(item) {

  const data =
    getFilteredContent();

  return data.indexOf(item);

}


/* =====================================================
   PLAYER
   ===================================================== */

function playContent(item) {

  if (!item || !item.url) {

    showToast(
      "Este conteúdo não possui uma URL."
    );

    return;

  }


  playerTitle.textContent =
    item.name || "GC PLAY PRO";


  playerMessage.textContent =
    "";


  playerPanel.classList.remove(
    "hidden"
  );


  videoPlayer.src =
    item.url;


  if (autoplaySetting.checked) {

    const playPromise =
      videoPlayer.play();


    if (
      playPromise &&
      typeof playPromise.catch ===
      "function"
    ) {

      playPromise.catch(() => {

        playerMessage.textContent =
          "Toque no botão de reprodução para iniciar.";

      });

    }

  }


  addToHistory(item);

}


function closeVideoPlayer() {

  videoPlayer.pause();

  videoPlayer.removeAttribute(
    "src"
  );

  videoPlayer.load();

  playerPanel.classList.add(
    "hidden"
  );

}


/* =====================================================
   HISTÓRICO
   ===================================================== */

function addToHistory(item) {

  try {

    let history =
      JSON.parse(

        localStorage.getItem(
          STORAGE_KEYS.history
        ) || "[]"

      );


    history =
      history.filter(
        itemHistory =>
          itemHistory.url !== item.url
      );


    history.unshift({

      name: item.name,

      url: item.url,

      logo: item.logo || "",

      viewedAt:
        new Date().toISOString()

    });


    history =
      history.slice(0, 100);


    localStorage.setItem(

      STORAGE_KEYS.history,

      JSON.stringify(history)

    );


    appState.history =
      history;

  } catch (error) {

    console.error(
      "Erro ao salvar histórico:",
      error
    );

  }

}


/* =====================================================
   CONTADORES
   ===================================================== */

function updateCounters() {

  channelCount.textContent =
    formatNumber(
      appState.channels.length
    );


  movieCount.textContent =
    formatNumber(
      appState.movies.length
    );


  seriesCount.textContent =
    formatNumber(
      appState.series.length
    );

}


function formatNumber(number) {

  return new Intl.NumberFormat(
    "pt-BR"
  ).format(number);

}


/* =====================================================
   PLACEHOLDER PARA O LEITOR M3U
   ===================================================== */

/*

  A próxima etapa vai substituir
  esta função pelo leitor M3U real.

  Ele será preparado para:

  • M3U
  • M3U8
  • listas grandes
  • milhares de canais
  • categorias
  • filmes
  • séries
  • logos
  • busca
  • favoritos
  • histórico

*/

async function loadM3U(url) {

  if (!url) {

    throw new Error(
      "URL M3U não informada."
    );

  }


  /*
    O parser completo será colocado
    na próxima etapa.

    Não vamos carregar uma lista
    de 40.000+ itens de forma
    desnecessária na interface.
  */

  console.log(
    "Preparado para carregar:",
    url
  );

}


/* =====================================================
   EVENTOS
   ===================================================== */


/* M3U */

addPlaylistButton?.addEventListener(
  "click",
  openPlaylistDialog
);


emptyAddButton?.addEventListener(
  "click",
  openPlaylistDialog
);


closePlaylistDialog?.addEventListener(
  "click",
  () => closeDialog(playlistDialog)
);


playlistForm?.addEventListener(
  "submit",
  savePlaylist
);


/* SEARCH */

searchButton?.addEventListener(
  "click",
  openSearch
);


closeSearchDialog?.addEventListener(
  "click",
  closeSearch
);


globalSearch?.addEventListener(
  "input",
  event => {

    searchContent(
      event.target.value
    );

  }
);


/* SETTINGS */

settingsButton?.addEventListener(
  "click",
  () => openDialog(settingsDialog)
);


closeSettingsDialog?.addEventListener(
  "click",
  () => closeDialog(settingsDialog)
);


autoplaySetting?.addEventListener(
  "change",
  saveSettings
);


compactSetting?.addEventListener(
  "change",
  () => {

    applyCompactMode();

    saveSettings();

  }
);


/* EXPLORE */

exploreButton?.addEventListener(
  "click",
  () => {

    librarySection?.scrollIntoView({
      behavior: "smooth"
    });

  }
);


/* FILTERS */

$$(".filter-button").forEach(
  button => {

    button.addEventListener(
      "click",
      () => {

        setFilter(
          button.dataset.filter
        );

      }
    );

  }
);


/* PLAYER */

closePlayer?.addEventListener(
  "click",
  closeVideoPlayer
);


/* =====================================================
   FECHAR MODAIS CLICANDO FORA
   ===================================================== */

[playlistDialog, searchDialog, settingsDialog]
  .forEach(dialog => {

    dialog?.addEventListener(
      "click",
      event => {

        if (
          event.target === dialog
        ) {

          closeDialog(dialog);

        }

      }
    );

  });


/* =====================================================
   TECLA ESC
   ===================================================== */

document.addEventListener(
  "keydown",
  event => {

    if (event.key !== "Escape") {
      return;
    }


    if (
      playlistDialog?.open
    ) {

      closeDialog(
        playlistDialog
      );

    }


    if (
      searchDialog?.open
    ) {

      closeDialog(
        searchDialog
      );

    }


    if (
      settingsDialog?.open
    ) {

      closeDialog(
        settingsDialog
      );

    }

  }
);


/* =====================================================
   INICIALIZAÇÃO
   ===================================================== */

function init() {

  loadPlaylist();

  loadSettings();

  updateCounters();

  renderContent();

  console.log(
    "GC PLAY PRO iniciado."
  );

}


init();
