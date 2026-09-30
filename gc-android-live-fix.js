/* GC PLAY PRO — Android live compatibility */
(function () {
  "use strict";

  const originalPlay = window.playMpegTS;

  if (typeof originalPlay !== "function") return;

  window.playMpegTS = async function (video, url, message, directFallbackUrl = "") {
    if (message) message.textContent = "Preparando compatibilidade da TV ao vivo...";

    const oldError = video && video.onerror;

    if (video) {
      video.onerror = function () {
        const code = video.error && video.error.code;
        console.warn("[GC PLAY PRO] live video error:", code, video.error);

        if (code === 4 && message) {
          message.textContent = "Canal incompatível com este formato de vídeo (código 4).";
        }

        if (typeof oldError === "function") {
          try { oldError.call(video); } catch {}
        }
      };
    }

    return originalPlay(video, url, message, directFallbackUrl);
  };
})();