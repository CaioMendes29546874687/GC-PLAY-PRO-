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

  function boot() {
    ensurePlayerTools();
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
