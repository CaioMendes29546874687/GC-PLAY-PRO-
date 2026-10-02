/* =========================================================
   GC PLAY PRO — VLC EXTERNO (ADITIVO)
   Não altera o motor interno. Apenas adiciona uma opção
   para abrir o canal atual no VLC instalado no dispositivo.
   ========================================================= */

"use strict";

(() => {
  const VLC_VERSION = "20261002-1";
  let button = null;

  function getState() {
    return window.__GC_STATE__ || null;
  }

  function getVlcUrl() {
    const state = getState();
    const item = state?.currentItem;

    if (!item) return "";

    let url = String(item.url || "").trim();

    /*
      Para canais Xtream, reconstrói a URL atual diretamente do
      ID da transmissão. Assim o VLC não recebe uma URL antiga
      que tenha ficado salva no IndexedDB.
    */
    if (
      item.xtreamKind === "live" &&
      item.xtreamStreamId &&
      state?.xtreamSession?.base &&
      state?.xtreamSession?.username &&
      state?.xtreamSession?.password
    ) {
      const extension =
        String(state.xtreamSession.liveExtension || "").toLowerCase() === "ts"
          ? "ts"
          : "m3u8";

      const base = String(state.xtreamSession.base).replace(//+$/, "");
      const user = encodeURIComponent(String(state.xtreamSession.username));
      const pass = encodeURIComponent(String(state.xtreamSession.password));
      const id = encodeURIComponent(String(item.xtreamStreamId));

      url = `${base}/live/${user}/${pass}/${id}.${extension}`;
    }

    return /^https?:\/\//i.test(url) ? url : "";
  }

  function buildAndroidIntent(url) {
    try {
      const parsed = new URL(url);
      const scheme = parsed.protocol.replace(":", "");
      const target =
        parsed.host +
        parsed.pathname +
        (parsed.search || "") +
        (parsed.hash || "");

      /*
        Formato intent:// usado para abrir a atividade do VLC
        com a URL HTTP/HTTPS como dado.
      */
      return `intent://${target}#Intent;scheme=${scheme};package=org.videolan.vlc;end`;
    } catch {
      return "";
    }
  }

  function openVLC() {
    const url = getVlcUrl();

    if (!url) {
      alert("Não foi possível obter a URL deste canal.");
      return;
    }

    const android = /Android/i.test(navigator.userAgent || "");

    if (android) {
      const intent = buildAndroidIntent(url);

      if (intent) {
        window.location.href = intent;
        return;
      }
    }

    /*
      Em dispositivos/navegadores que registrarem o protocolo VLC,
      usamos o esquema oficial como segunda opção.
    */
    window.location.href = "vlc://" + url;
  }

  function ensureButton() {
    const toolbar = document.querySelector(".gc-player-toolbar");
    if (!toolbar) return;

    if (!button || !button.isConnected) {
      button = document.createElement("button");
      button.type = "button";
      button.id = "gcOpenVlcButton";
      button.className = "secondary-button gc-vlc-button";
      button.textContent = "▶ VLC";
      button.title = "Abrir este canal no VLC";
      button.setAttribute("aria-label", "Abrir canal no VLC");
      button.addEventListener("click", openVLC);
      toolbar.appendChild(button);
    }

    const state = getState();
    const item = state?.currentItem;
    const live = item?.type === "live";

    button.style.display = live ? "inline-flex" : "none";
  }

  function injectStyle() {
    if (document.getElementById("gc-vlc-style")) return;

    const style = document.createElement("style");
    style.id = "gc-vlc-style";
    style.textContent = `
      .gc-vlc-button{
        align-items:center;
        justify-content:center;
        gap:6px;
        white-space:nowrap;
        cursor:pointer;
      }
    `;
    document.head.appendChild(style);
  }

  function start() {
    injectStyle();
    ensureButton();

    /*
      Observa somente mudanças no DOM do player para manter o botão
      disponível. Não intercepta cliques de cartões, navegação ou
      rolagem e não substitui nenhum player existente.
    */
    const observer = new MutationObserver(() => ensureButton());
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setInterval(ensureButton, 1200);

    console.log("[GC VLC] módulo aditivo carregado:", VLC_VERSION);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
