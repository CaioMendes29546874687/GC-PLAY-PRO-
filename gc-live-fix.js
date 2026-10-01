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