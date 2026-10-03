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

    /* O cursor/FOCUS do controle remoto não pode disparar
       sombras, transforms ou filtros caros em cada mudança de foco.
       No Tizen isso pode causar o efeito de "piscar" a tela inteira. */
    html.gc-samsung-stable *,
    html.gc-samsung-stable *::before,
    html.gc-samsung-stable *::after {
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }

    html.gc-samsung-stable .gc-card,
    html.gc-samsung-stable .gc-card:hover,
    html.gc-samsung-stable .gc-card:focus,
    html.gc-samsung-stable .gc-card:focus-visible,
    html.gc-samsung-stable button:hover,
    html.gc-samsung-stable button:focus,
    html.gc-samsung-stable button:focus-visible,
    html.gc-samsung-stable .nav-item:hover,
    html.gc-samsung-stable .nav-item:focus {
      transform: none !important;
      box-shadow: none !important;
      filter: none !important;
      transition: none !important;
    }

    /* Player: evita repaint pesado enquanto o vídeo abre/carrega. */
    html.gc-samsung-stable #playerPanel,
    html.gc-samsung-stable #playerPanel *,
    html.gc-samsung-stable .gc-player,
    html.gc-samsung-stable .gc-player * {
      animation: none !important;
      transition: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
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
