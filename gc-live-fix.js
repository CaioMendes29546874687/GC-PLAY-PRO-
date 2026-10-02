/* GC PLAY PRO — live fix 2026-10-01-5 */
(function(){
  "use strict";

  /*
   * O app.js já possui o motor MPEG-TS principal. O hotfix não deve
   * substituí-lo: isso evita duas implementações competindo pelo mesmo
   * elemento <video>.
   */
  window.playMpegTS = async function(video, url, message, directFallbackUrl = "", secondaryFallbackUrl = "") {
    const native = window.__GC_NATIVE_PLAY_MPEGTS__;
    if (typeof native !== "function") {
      if (message) message.textContent = "Motor MPEG-TS não está disponível.";
      return;
    }

    if (message) message.textContent = "Iniciando MPEG-TS...";
    try {
      return await native(video, url, message, directFallbackUrl, secondaryFallbackUrl);
    } catch (error) {
      console.error("[GC LIVE] motor nativo:", error);
      if (message) message.textContent = error?.message || "Falha no motor MPEG-TS.";
    }
  };
})();
/* HLS Android compatibility: force HLS.js path instead of Chrome native HLS. */
(function(){
  const nativeHls = window.playHLS;
  if (typeof nativeHls !== "function" || window.__GC_HLS_ANDROID_WRAP__) return;
  window.playHLS = async function(video, url, message, fallbackUrl = "") {
    if (!video) return nativeHls(video, url, message, fallbackUrl);
    const originalCanPlayType = video.canPlayType;
    try {
      video.canPlayType = function(type) {
        if (/mpegurl/i.test(String(type || ""))) return "";
        return originalCanPlayType.call(video, type);
      };
    } catch {}
    try {
      return await nativeHls(video, url, message, fallbackUrl);
    } finally {
      try { video.canPlayType = originalCanPlayType; } catch {}
    }
  };
  window.__GC_HLS_ANDROID_WRAP__ = true;
})();
