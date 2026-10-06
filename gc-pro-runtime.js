/* GC PLAY PRO — PROFESSIONAL PLAYER RUNTIME
 * M3U/Xtream player hardening layer.
 * Não faz proxy de vídeo e não substitui o motor de reprodução existente.
 */
"use strict";

(() => {
  if (window.__GC_PRO_RUNTIME__) return;
  window.__GC_PRO_RUNTIME__ = true;

  const VERSION = "2026.10.06.1";
  const PLAYLISTS_KEY = "GC_PLAY_PRO_PLAYLISTS_V2";
  const ACTIVE_PLAYLIST_KEY = "GC_PLAY_PRO_ACTIVE_PLAYLIST_V2";
  const MAX_PLAYLISTS = 8;

  const state = () => window.__GC_STATE__ || null;
  const diag = (type, data = {}) => {
    try { window.GCArchitecture?.diagnostics?.record?.(type, data); } catch {}
  };

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  }

  /* ---------------------------------------------------------
     MULTI-PLAYLIST
     --------------------------------------------------------- */
  function playlists() {
    const list = readJSON(PLAYLISTS_KEY, []);
    return Array.isArray(list) ? list.filter(x => x && x.url).slice(0, MAX_PLAYLISTS) : [];
  }

  function savePlaylist(name, url, type = "m3u") {
    const cleanUrl = String(url || "").trim();
    if (!/^https?:\/\//i.test(cleanUrl)) throw new Error("URL da playlist inválida.");

    const list = playlists().filter(x => String(x.url) !== cleanUrl);
    const entry = {
      id: "pl-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
      name: String(name || "Minha lista").trim().slice(0, 100) || "Minha lista",
      url: cleanUrl,
      type: String(type || "m3u").toLowerCase(),
      updatedAt: Date.now()
    };
    list.unshift(entry);
    writeJSON(PLAYLISTS_KEY, list.slice(0, MAX_PLAYLISTS));
    writeJSON(ACTIVE_PLAYLIST_KEY, entry.id);
    diag("playlist_saved", { id: entry.id, type: entry.type });
    return entry;
  }

  function removePlaylist(id) {
    const list = playlists().filter(x => String(x.id) !== String(id));
    writeJSON(PLAYLISTS_KEY, list);
    const active = readJSON(ACTIVE_PLAYLIST_KEY, "");
    if (String(active) === String(id)) {
      writeJSON(ACTIVE_PLAYLIST_KEY, list[0]?.id || "");
    }
    diag("playlist_removed", { id: String(id) });
    return list;
  }

  async function openPlaylist(id) {
    const entry = playlists().find(x => String(x.id) === String(id));
    if (!entry || typeof window.loadM3U !== "function") return false;
    writeJSON(ACTIVE_PLAYLIST_KEY, entry.id);
    localStorage.setItem("GC_PLAY_PRO_PLAYLIST_NAME", entry.name);
    localStorage.setItem("GC_PLAY_PRO_PLAYLIST_URL", entry.url);
    diag("playlist_open_start", { id: entry.id });
    const ok = await window.loadM3U(entry.url);
    diag("playlist_open_end", { id: entry.id, ok: ok !== false });
    return ok !== false;
  }

  /* ---------------------------------------------------------
     PLAYER HEALTH / STALL RECOVERY
     --------------------------------------------------------- */
  let watchdog = null;
  let lastRecovery = 0;

  function installPlayerWatchdog() {
    const video = document.getElementById("videoPlayer");
    if (!video || video.__gcProWatchdog) return;
    video.__gcProWatchdog = true;

    let waitingSince = 0;
    let waitingTimer = null;

    const clearWait = () => {
      waitingSince = 0;
      if (waitingTimer) {
        clearTimeout(waitingTimer);
        waitingTimer = null;
      }
    };

    const recover = async reason => {
      const s = state();
      const item = s?.currentItem;
      if (!item?.url) return;
      const now = Date.now();

      /* No máximo uma recuperação automática a cada 15 s. */
      if (now - lastRecovery < 15000) return;
      lastRecovery = now;

      diag("playback_recovery", {
        reason,
        type: item.type || "",
        name: String(item.name || "").slice(0, 120)
      });

      const message = document.getElementById("playerMessage");
      if (message) message.textContent = "Reconectando ao conteúdo...";

      try {
        if (s?.hls) {
          try { s.hls.stopLoad(); } catch {}
          try { s.hls.startLoad(-1); } catch {}
        } else if (s?.dash) {
          try { s.dash.play(); } catch {}
        } else if (s?.mpegts) {
          try { s.mpegts.unload(); } catch {}
          try { s.mpegts.load(); } catch {}
          try { await s.mpegts.play(); } catch {}
        } else {
          video.load();
          if (s?.settings?.autoplay) {
            try { await video.play(); } catch {}
          }
        }
      } catch (error) {
        diag("playback_recovery_error", { error: String(error?.message || error) });
      }
    };

    video.addEventListener("waiting", () => {
      waitingSince = Date.now();
      if (waitingTimer) clearTimeout(waitingTimer);
      waitingTimer = setTimeout(() => {
        if (waitingSince && Date.now() - waitingSince >= 8000) recover("waiting_8s");
      }, 8200);
    });

    video.addEventListener("stalled", () => {
      if (!video.paused) recover("stalled");
    });

    video.addEventListener("playing", clearWait);
    video.addEventListener("canplay", clearWait);
    video.addEventListener("error", () => {
      const code = video.error?.code || 0;
      diag("video_error", { code, src: String(video.currentSrc || video.src || "").slice(0, 500) });
      if (code === 2 || code === 3) recover("media_error_" + code);
    });
  }

  /* ---------------------------------------------------------
     PICTURE-IN-PICTURE + CINEMA
     --------------------------------------------------------- */
  function ensurePlayerTools() {
    const toolbar = document.querySelector(".gc-player-toolbar");
    if (!toolbar || toolbar.__gcProTools) return;
    toolbar.__gcProTools = true;

    const makeButton = (id, label, handler) => {
      const b = document.createElement("button");
      b.type = "button";
      b.id = id;
      b.className = "secondary-button gc-pro-tool";
      b.textContent = label;
      b.addEventListener("click", handler);
      toolbar.appendChild(b);
      return b;
    };

    makeButton("gcPipButton", "PiP", async () => {
      const video = document.getElementById("videoPlayer");
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else if (video?.requestPictureInPicture) {
          await video.requestPictureInPicture();
        } else {
          throw new Error("PiP não suportado");
        }
      } catch {
        const m = document.getElementById("playerMessage");
        if (m) m.textContent = "PiP não é suportado neste dispositivo.";
      }
    });

    makeButton("gcCinemaButton", "MODO CINEMA", async () => {
      const panel = document.getElementById("playerPanel");
      if (!panel) return;
      panel.classList.toggle("gc-pro-cinema");
      try {
        localStorage.setItem("GC_PLAY_PRO_CINEMA", panel.classList.contains("gc-pro-cinema") ? "1" : "0");
      } catch {}
    });

    const style = document.createElement("style");
    style.id = "gc-pro-runtime-style";
    style.textContent = `
      .gc-pro-tool{min-width:82px}
      #playerPanel.gc-pro-cinema .video-container{max-width:100vw!important}
      #playerPanel.gc-pro-cinema .player-header,
      #playerPanel.gc-pro-cinema .gc-player-toolbar,
      #playerPanel.gc-pro-cinema .gc-player-epg{opacity:.92}
    `;
    document.head.appendChild(style);

    try {
      if (localStorage.getItem("GC_PLAY_PRO_CINEMA") === "1") {
        document.getElementById("playerPanel")?.classList.add("gc-pro-cinema");
      }
    } catch {}
  }

  function installPlaylistManager() {
    const settings = document.querySelector("#settingsDialog .gc-dialog");
    if (!settings || settings.__gcPlaylistManager) return;
    settings.__gcPlaylistManager = true;

    const wrap = document.createElement("div");
    wrap.className = "setting-item gc-pro-playlists-setting";
    wrap.innerHTML = `
      <div>
        <strong>▣ Minhas listas</strong>
        <span>Gerencie até 8 fontes M3U/Xtream neste dispositivo.</span>
      </div>
      <button class="secondary-button" id="gcManagePlaylists" type="button">GERENCIAR</button>
    `;
    const version = settings.querySelector(".settings-version");
    settings.insertBefore(wrap, version || null);

    const openManager = () => {
      let dialog = document.getElementById("gcPlaylistManagerDialog");
      if (!dialog) {
        dialog = document.createElement("dialog");
        dialog.id = "gcPlaylistManagerDialog";
        dialog.innerHTML = `
          <div class="gc-dialog">
            <button type="button" class="modal-close" id="gcPlaylistManagerClose">×</button>
            <span class="gc-kicker">LISTAS</span>
            <h2>Minhas listas</h2>
            <p id="gcPlaylistManagerInfo">Escolha a fonte que deseja usar.</p>
            <div id="gcPlaylistManagerList"></div>
            <div style="display:flex;gap:8px;margin-top:14px">
              <button type="button" class="secondary-button" id="gcPlaylistSaveCurrent">SALVAR LISTA ATUAL</button>
            </div>
          </div>
        `;
        document.body.appendChild(dialog);
        document.getElementById("gcPlaylistManagerClose")?.addEventListener("click", () => dialog.close());
        document.getElementById("gcPlaylistSaveCurrent")?.addEventListener("click", () => {
          const url = localStorage.getItem("GC_PLAY_PRO_PLAYLIST_URL") || "";
          const name = localStorage.getItem("GC_PLAY_PRO_PLAYLIST_NAME") || "Minha lista";
          if (!url) return;
          try {
            savePlaylist(name, url, /player_api\\.php|get\\.php/i.test(url) ? "xtream" : "m3u");
            renderManager();
          } catch (e) {
            console.warn("[GC PLAY PRO] salvar lista atual:", e);
          }
        });
      }

      const renderManager = () => {
        const list = document.getElementById("gcPlaylistManagerList");
        if (!list) return;
        const entries = playlists();
        if (!entries.length) {
          list.innerHTML = '<div class="gc-results-count">Nenhuma lista salva neste aparelho.</div>';
          return;
        }
        list.innerHTML = entries.map(item => `
          <div style="display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08)">
            <div style="flex:1;min-width:0">
              <strong style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${String(item.name).replace(/[&<>"]/g,"")}</strong>
              <small style="opacity:.65">${String(item.type).toUpperCase()}</small>
            </div>
            <button type="button" class="secondary-button" data-gc-open-playlist="${String(item.id)}">ABRIR</button>
            <button type="button" class="secondary-button" data-gc-remove-playlist="${String(item.id)}">×</button>
          </div>
        `).join("");

        list.querySelectorAll("[data-gc-open-playlist]").forEach(btn => {
          btn.addEventListener("click", async () => {
            btn.disabled = true;
            try {
              const ok = await openPlaylist(btn.dataset.gcOpenPlaylist);
              if (ok) dialog.close();
            } finally { btn.disabled = false; }
          });
        });

        list.querySelectorAll("[data-gc-remove-playlist]").forEach(btn => {
          btn.addEventListener("click", () => {
            removePlaylist(btn.dataset.gcRemovePlaylist);
            renderManager();
          });
        });
      };

      renderManager();
      try { dialog.showModal(); } catch { dialog.classList.add("active","open","show"); }
    };

    document.getElementById("gcManagePlaylists")?.addEventListener("click", openManager);
  }

  function installRemoteNavigation() {
    if (window.__GC_PRO_REMOTE_KEYS__) return;
    window.__GC_PRO_REMOTE_KEYS__ = true;

    document.addEventListener("keydown", event => {
      const key = event.key;
      if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Enter","Escape"].includes(key)) return;

      const active = document.activeElement;
      if (active?.matches?.("input,textarea,select,video")) return;

      if (key === "Escape") {
        try { window.GC_PLAY_PRO?.closePlayer?.(); } catch {}
        return;
      }

      if (key === "Enter") {
        if (active?.click) active.click();
        return;
      }

      const focusables = Array.from(document.querySelectorAll(
        'button:not([disabled]),[tabindex="0"],select'
      )).filter(el => el.offsetParent !== null);
      if (!focusables.length) return;

      const index = focusables.indexOf(active);
      if (index < 0) {
        focusables[0]?.focus();
        return;
      }

      const direction = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
      const next = focusables[index + direction];
      if (next) {
        event.preventDefault();
        next.focus();
      }
    }, true);
  }

  function boot() {
    ensurePlayerTools();
    installPlaylistManager();
    installRemoteNavigation();
    installPlayerWatchdog();

    const observer = new MutationObserver(() => {
      ensurePlayerTools();
      installPlayerWatchdog();
    });
    const panel = document.getElementById("playerPanel");
    if (panel) observer.observe(panel, { childList: true, subtree: true });

    window.addEventListener("online", () => diag("runtime_online"));
    window.addEventListener("offline", () => diag("runtime_offline"));

    diag("professional_runtime_ready", { version: VERSION });
  }

  window.GCProRuntime = {
    version: VERSION,
    playlists,
    savePlaylist,
    removePlaylist,
    openPlaylist,
    diagnostics: () => window.GCArchitecture?.diagnostics?.snapshot?.() || {}
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    setTimeout(boot, 0);
  }
})();
