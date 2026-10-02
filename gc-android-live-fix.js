/* GC PLAY PRO — Android live compatibility */
(function () {
  "use strict";

  const originalLoad = window.loadMpegTS;
  if (typeof originalLoad !== "function") return;

  let patched = false;

  window.loadMpegTS = async function () {
    const lib = await originalLoad();

    if (!patched && lib && typeof lib.createPlayer === "function") {
      const createPlayer = lib.createPlayer.bind(lib);

      lib.createPlayer = function (mediaDataSource, config) {
        const safeConfig = {
          ...(config || {}),
          enableWorker: false,
          enableWorkerForMSE: false
        };

        return createPlayer(mediaDataSource, safeConfig);
      };

      patched = true;
      console.log("[GC PLAY PRO] Android compatibility: MSE Worker desativado.");
    }

    return lib;
  };

  const originalPlay = window.playMpegTS;
  if (typeof originalPlay !== "function") return;

  window.playMpegTS = async function (video, url, message, directFallbackUrl = "", secondaryFallbackUrl = "") {
    if (message) message.textContent = "Preparando compatibilidade da TV ao vivo...";

    if (video) {
      video.addEventListener("error", function () {
        const code = video.error && video.error.code;
        console.warn("[GC PLAY PRO] live video error:", code, video.error);

        if (code === 4 && message) {
          message.textContent = "Formato do canal incompatível (código 4).";
        }
      }, { once: true });
    }

    return originalPlay(video, url, message, directFallbackUrl, secondaryFallbackUrl);
  };
})();