/* GC PLAY PRO — SAMSUNG TIZEN STABILITY FIX
   Mantém a interface existente e reduz reflow/efeitos pesados em Smart TVs. */
(function(){
  "use strict";

  const ua = navigator.userAgent || "";
  const isSamsung =
    /Tizen|SMART-TV|SamsungBrowser.*TV|TV Safari/i.test(ua) ||
    (/Samsung/i.test(ua) && !/Mobile|Android/i.test(ua));

  if (!isSamsung) return;

  window.__GC_SAMSUNG_TV__ = true;
  document.documentElement.classList.add("gc-samsung-stable");

  const style = document.createElement("style");
  style.id = "gc-samsung-stability-style";
  style.textContent = `
    html.gc-samsung-stable,
    html.gc-samsung-stable body {
      scroll-behavior: auto !important;
    }

    html.gc-samsung-stable *,
    html.gc-samsung-stable *::before,
    html.gc-samsung-stable *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.001ms !important;
      scroll-behavior: auto !important;
    }

    html.gc-samsung-stable .gc-spinner {
      animation: none !important;
    }

    html.gc-samsung-stable img {
      transition: none !important;
    }

    html.gc-samsung-stable .content-grid,
    html.gc-samsung-stable #contentGrid {
      contain: layout style !important;
    }

    html.gc-samsung-stable .gc-card {
      transform: none !important;
      will-change: auto !important;
    }

    html.gc-samsung-stable .gc-card:hover,
    html.gc-samsung-stable .gc-card:focus {
      transform: none !important;
    }

    html.gc-samsung-stable .gc-home-row {
      scroll-behavior: auto !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);

  /* Evita o efeito de reativar estilos várias vezes enquanto a página
     ainda está inicializando no navegador Tizen. */
  let applied = false;
  const apply = () => {
    if (applied) return;
    applied = true;
    document.documentElement.classList.add("gc-samsung-stable");
    document.body && document.body.classList.add("gc-samsung-stable");
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply, {once:true});
  } else {
    apply();
  }

  console.log("[GC PLAY PRO] Samsung Tizen stability mode ativo.");
})();
