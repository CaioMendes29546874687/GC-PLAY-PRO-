/* GC PLAY PRO — FINAL RUNTIME FIX 2026-10-02 */
(function(){
"use strict";

const VERSION="20261002-8";
window.__GC_FINAL_FIX_VERSION__=VERSION;

function api(){ return window.GC_PLAY_PRO || null; }
function state(){ return api()?.state || window.__GC_STATE__ || null; }

async function directSection(section){
  const a=api(), s=state();
  if(!a || !s) return false;

  /* Navegação sempre fecha o player para a biblioteca ficar visível. */
  try{ if(typeof a.closePlayer==="function") a.closePlayer(); }catch{}

  if(window.__GC_APP_READY__){
    try{ await window.__GC_APP_READY__; }catch{}
  }

  if(section==="live" || section==="movies" || section==="series"){
    const type=section==="live" ? "live" : section==="movies" ? "movie" : "series";
    s.currentSection=section;
    s.currentFilter=type;
    s.currentGenre="all";
    s.seriesView.seriesKey=null;
    s.seriesView.season=null;
    if(typeof a.setCatalogCategory==="function"){
      await a.setCatalogCategory(type,"all");
      /* Garante que o painel correto fique visível mesmo se uma camada de UI
         anterior tiver deixado o dashboard ativo. */
      const dash=document.getElementById("homeDashboard");
      const lib=document.getElementById("librarySection");
      if(dash) dash.style.display="none";
      if(lib) lib.style.display="block";
      return true;
    }
  }

  if(section==="home"){
    s.currentSection="home";
    s.currentFilter="all";
    s.currentGenre="all";
    s.seriesView.seriesKey=null;
    s.seriesView.season=null;
    const dash=document.getElementById("homeDashboard");
    const lib=document.getElementById("librarySection");
    if(dash) dash.style.display="block";
    if(lib) lib.style.display="none";
    if(typeof a.render==="function") await a.render();
    return true;
  }

  if(section==="favorites"){
    if(typeof a.navigateSection==="function"){
      await Promise.race([
        a.navigateSection("favorites"),
        new Promise(resolve=>setTimeout(resolve,2500))
      ]);
      return true;
    }
  }

  return false;
}

/* DETERMINISTIC INPUT ROUTER
   Touch/remote/keyboard all enter the same path.
   pointerdown is used first on touch devices; click remains the
   keyboard/remote fallback. A short dedupe prevents double execution. */
let lastInputKey="";
let lastInputAt=0;

function shouldSkipDuplicate(key){
  const now=Date.now();
  if(key===lastInputKey && now-lastInputAt<700) return true;
  lastInputKey=key;
  lastInputAt=now;
  return false;
}

async function handleUiTarget(target,event){
  const button=target?.closest?.(".gc-bottom-nav button.nav-item[data-section], .main-nav button.nav-item[data-section]");
  if(button){
    const section=button.dataset.section || "home";
    if(!["home","live","movies","series","favorites","adult"].includes(section)) return false;
    const key="nav:"+section;
    if(shouldSkipDuplicate(key)) return true;
    event?.preventDefault();
    event?.stopImmediatePropagation();
    try{
      if(section==="adult" && typeof api()?.navigateSection==="function"){
        await api().navigateSection("adult");
      } else {
        await directSection(section);
      }
      document.querySelectorAll("[data-section]").forEach(b=>{
        b.classList.toggle("active",b.dataset.section===section);
      });
    }catch(error){
      console.error("[GC FINAL] navigation:",error);
    }
    return true;
  }

  const s=state(), a=api();

  /* Shortcuts e filtros usam data-filter em vez de data-section. */
  const filterButton=target?.closest?.(".gc-shortcut[data-filter], .filter-button[data-filter]");
  if(filterButton && a?.setCatalogCategory){
    const filter=String(filterButton.dataset.filter||"").toLowerCase();
    const type=filter==="movie" ? "movie" : filter==="series" ? "series" : filter==="live" ? "live" : "all";
    if(type!=="all"){
      if(shouldSkipDuplicate("filter:"+type)) return true;
      event?.preventDefault();
      event?.stopImmediatePropagation();
      try{ await a.setCatalogCategory(type,"all"); }catch(error){ console.error("[GC FINAL] filter:",error); }
      return true;
    }
  }

  const brand=target?.closest?.(".gc-brand[data-section]");
  if(brand){
    if(shouldSkipDuplicate("brand:home")) return true;
    event?.preventDefault();
    event?.stopImmediatePropagation();
    try{ await directSection("home"); }catch(error){ console.error("[GC FINAL] brand:",error); }
    return true;
  }

  const homeAction=target?.closest?.("[data-home-action]");
  if(homeAction && a?.setCatalogCategory){
    const action=String(homeAction.dataset.homeAction||"");
    const map={live:"live",movie:"movie",series:"series"};
    if(map[action]){
      if(shouldSkipDuplicate("home:"+action)) return true;
      event?.preventDefault(); event?.stopImmediatePropagation();
      try{ await a.setCatalogCategory(map[action],"all"); }catch(error){ console.error("[GC FINAL] home action:",error); }
      return true;
    }
  }

  const homePlay=target?.closest?.("[data-home-play]");
  if(homePlay && a?.playItem){
    const id=String(homePlay.dataset.homePlay||"");
    if(shouldSkipDuplicate("homeplay:"+id)) return true;
    event?.preventDefault(); event?.stopImmediatePropagation();
    try{
      const item=typeof window.findItem==="function" ? await window.findItem(id) : null;
      if(item) await a.playItem(item);
    }catch(error){ console.error("[GC FINAL] home playback:",error); }
    return true;
  }

  if(!s || !a) return false;

  const back=target?.closest?.("#contentGrid [data-series-back]");
  if(back){
    if(shouldSkipDuplicate("series:back")) return true;
    event?.preventDefault();
    event?.stopImmediatePropagation();
    if(s.seriesView.season!==null) s.seriesView.season=null;
    else s.seriesView.seriesKey=null;
    await a.render();
    return true;
  }

  const series=target?.closest?.("#contentGrid [data-series-key]");
  if(series){
    const key=String(series.dataset.seriesKey||"");
    if(shouldSkipDuplicate("series:"+key)) return true;
    event?.preventDefault();
    event?.stopImmediatePropagation();
    s.seriesView.seriesKey=key;
    s.seriesView.season=null;
    await a.render();
    return true;
  }

  const season=target?.closest?.("#contentGrid [data-series-season]");
  if(season){
    const value=Number(season.dataset.seriesSeason);
    if(shouldSkipDuplicate("season:"+value)) return true;
    event?.preventDefault();
    event?.stopImmediatePropagation();
    s.seriesView.season=value;
    await a.render();
    return true;
  }

  const card=target?.closest?.("#contentGrid [data-item-id]");
  if(card && !target.closest("[data-favorite-id]") && a.playItem){
    const id=String(card.dataset.itemId||"");
    if(shouldSkipDuplicate("item:"+id)) return true;
    event?.preventDefault();
    event?.stopImmediatePropagation();
    try{
      const item=typeof window.findItem==="function" ? await window.findItem(id) : null;
      if(item) await a.playItem(item);
    }catch(error){
      console.error("[GC FINAL] item playback:",error);
    }
    return true;
  }

  return false;
}

async function routeUiEvent(event){
  try{
    await handleUiTarget(event.target,event);
  }catch(error){
    console.error("[GC FINAL] input router:",error);
  }
}

/* IMPORTANTE: pointerdown não deve acionar cards do catálogo.
   Em celular, o dedo começa o scroll sobre um card; se tratarmos
   pointerdown como seleção, o card é aberto sem intenção.
   Mantemos pointerdown somente para a barra de navegação. */
document.addEventListener("pointerdown",event=>{
  const nav=event.target?.closest?.(".gc-bottom-nav button.nav-item[data-section], .main-nav button.nav-item[data-section]");
  if(nav) routeUiEvent(event);
},true);

document.addEventListener("click",routeUiEvent,true);

/* Expose a manual test hook so the same production path can be invoked
   without relying on any other event listener. */
window.__GC_ROUTE_UI__ = target => handleUiTarget(target,{preventDefault(){},stopImmediatePropagation(){}});

/* Movie/episode code 4 fallback.
   If Android rejects the native source with MEDIA_ERR_SRC_NOT_SUPPORTED,
   replay the same source through mpegts.js when available. */
function installVideoFallback(){
  const video=document.getElementById("videoPlayer");
  if(!video || video.__gcFinalFallback) return;
  video.__gcFinalFallback=true;

  video.addEventListener("error",async function(){
    const error=video.error;
    if(!error || error.code!==4) return;
    const src=video.currentSrc || video.src || "";
    if(!src || /\.m3u8(?:$|[?&])/i.test(src)) return;
    if(!window.mpegts || !window.mpegts.isSupported()) return;
    if(video.__gcMpegFallbackRunning) return;
    video.__gcMpegFallbackRunning=true;

    const message=document.getElementById("playerMessage");
    if(message) message.textContent="Formato detectado. Abrindo pelo motor MPEG-TS...";

    try{
      const s=state();
      if(s?.mpegts){
        try{s.mpegts.destroy();}catch{}
        s.mpegts=null;
      }

      const resume=Number(video.currentTime||0);
      const player=window.mpegts.createPlayer(
        {
          type:"mpegts",
          isLive:false,
          url:src,
          cors:true,
          hasAudio:true,
          hasVideo:true
        },
        {
          enableWorker:false,
          enableWorkerForMSE:false,
          enableStashBuffer:true,
          stashInitialSize:384*1024,
          lazyLoad:true,
          deferLoadAfterSourceOpen:false,
          seekType:"range",
          rangeLoadZeroStart:true
        }
      );

      if(s) s.mpegts=player;
      player.attachMediaElement(video);
      player.load();

      try{
        await player.play();
      }catch{
        if(message) message.textContent="Toque em ▶ para iniciar o vídeo.";
      }

      if(resume>5){
        try{ video.currentTime=resume; }catch{}
      }

      player.on(window.mpegts.Events.ERROR,function(type,detail){
        console.warn("[GC FINAL] MPEG-TS fallback:",type,detail);
        if(message) message.textContent="O servidor não entregou um formato MPEG-TS compatível.";
      });
    }catch(error){
      console.error("[GC FINAL] MPEG-TS fallback failed:",error);
      if(message) message.textContent="Não foi possível iniciar este vídeo.";
    }finally{
      setTimeout(()=>{video.__gcMpegFallbackRunning=false;},1500);
    }
  },true);
}

if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",installVideoFallback,{once:true});
}else{
  installVideoFallback();
}
setTimeout(installVideoFallback,1000);
setTimeout(installVideoFallback,3000);

})();

/* GC AI CONTROLLER — 2026-10-02 */
(function(){
"use strict";

function gcAiController(){
  const openBtn=document.getElementById("gcAiOpen");
  const panel=document.getElementById("gcAiPanel");
  const closeBtn=document.getElementById("gcAiClose");
  const form=document.getElementById("gcAiForm");
  const input=document.getElementById("gcAiInput");
  const messages=document.getElementById("gcAiMessages");
  const voice=document.getElementById("gcAiVoice");
  const status=document.getElementById("gcAiStatus");

  if(!openBtn || !panel) return false;
  if(openBtn.__gcAiBound) return true;
  openBtn.__gcAiBound=true;

  const setOpen=(value)=>{
    panel.classList.toggle("open",!!value);
    openBtn.setAttribute("aria-expanded",value?"true":"false");
    if(value){
      setTimeout(()=>input?.focus(),80);
    }
  };

  openBtn.addEventListener("click",(e)=>{
    e.preventDefault();
    e.stopPropagation();
    setOpen(!panel.classList.contains("open"));
  },true);

  closeBtn?.addEventListener("click",(e)=>{
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
  },true);

  function addMessage(text,type="bot"){
    if(!messages) return;
    const el=document.createElement("div");
    el.className="gc-ai-message "+(type==="user"?"gc-ai-user":"gc-ai-bot");
    el.innerHTML=text;
    messages.appendChild(el);
    messages.scrollTop=messages.scrollHeight;
    return el;
  }

  async function executeCommand(command){
    const q=String(command||"").trim();
    if(!q) return;
    addMessage(q.replace(/[&<>]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[m])),"user");
    const n=q.toLowerCase();

    if(/\b(fechar|feche|sair|fecha)\b/.test(n)){
      setOpen(false);
      return;
    }

    if(/\b(tela cheia|fullscreen|cheia)\b/.test(n)){
      const v=document.getElementById("videoPlayer");
      try{
        if(v?.requestFullscreen) await v.requestFullscreen();
        else if(document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
        addMessage("Tela cheia ativada.");
      }catch{
        addMessage("O dispositivo não permitiu a tela cheia neste momento.");
      }
      return;
    }

    const s=window.__GC_STATE__||window.GC_PLAY_PRO?.state;
    const items=Array.isArray(s?.items)?s.items:[];
    const wantsSpecific=/\b(abra|abrir|abre|assistir|assista|coloque|coloca|reproduza|reproduzir|toque|mostrar|mostre|pesquise|pesquisar|procure|procurar|buscar|busque)\b/.test(n);

    /* Primeiro tenta resolver um conteúdo específico.
       Isso evita que "abra a série X" seja interpretado apenas como
       "abrir a seção Séries". */
    const clean=n
      .replace(/\b(quero|quero assistir|abra|abrir|abre|assistir|assista|coloque|coloca|reproduza|reproduzir|toque|mostrar|mostre|pesquise|pesquisar|procure|procurar|buscar|busque|me mostre|por favor|a|o|um|uma|canal|canais|tv|televis[aã]o|ao vivo|filme|filmes|s[eé]rie|s[eé]ries|temporada|temporadas|epis[oó]dio|epis[oó]dios)\b/g," ")
      .replace(/\s+/g," ").trim();

    if(wantsSpecific && clean && items.length){
      const found=items.filter(x=>!window.isAdultContent?.(x))
        .filter(x=>(String(x.name||"")+" "+String(x.group||"")+" "+String(x.seriesName||"")).toLowerCase().includes(clean))
        .sort((x,y)=>{
          const xn=String(x.seriesName||x.name||"").toLowerCase(), yn=String(y.seriesName||y.name||"").toLowerCase();
          return (xn===clean?0:xn.startsWith(clean)?1:2)-(yn===clean?0:yn.startsWith(clean)?1:2);
        }).slice(0,10);

      if(found.length){
        const item=found[0];

        /* Séries usam o navegador de temporadas, não playItem().
           Assim a IA abre a série escolhida e não apenas a seção. */
        if(item.type==="series" || item.seriesKey){
          const key=item.seriesKey || item.seriesName || item.name;
          if(s){
            s.currentSection="series";
            s.currentFilter="series";
            s.currentGenre="all";
            s.seriesView.seriesKey=key;
            s.seriesView.season=null;
          }
          try{
            if(window.GC_PLAY_PRO?.render) await window.GC_PLAY_PRO.render();
            else document.querySelector('[data-section="series"]')?.click();
            addMessage("Abrindo a série <b>"+String(item.seriesName||item.name||"").replace(/[&<>]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[m]))+"</b>.");
          }catch{
            addMessage("Encontrei a série, mas não consegui abrir os episódios agora.");
          }
          return;
        }

        try{
          await window.GC_PLAY_PRO?.playItem?.(item);
          addMessage("Abrindo <b>"+String(item.name||"conteúdo").replace(/[&<>]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[m]))+"</b>.");
        }catch{
          addMessage("Encontrei o conteúdo, mas não consegui iniciar a reprodução.");
        }
        return;
      }
    }

    /* Só navega para uma seção quando o comando não identifica um título específico. */
    const section =
      /\b(tv|televis[aã]o|canais?|ao vivo)\b/.test(n) ? "live" :
      /\b(filmes?|movie)\b/.test(n) ? "movies" :
      /\b(s[eé]ries?|temporadas?|epis[oó]dios?)\b/.test(n) ? "series" :
      /\b(in[ií]cio|home)\b/.test(n) ? "home" : null;

    if(section){
      try{
        if(typeof window.__GC_ROUTE_UI__==="function"){
          await window.__GC_ROUTE_UI__(document.querySelector('[data-section="'+section+'"]')||{});
        }else{
          document.querySelector('[data-section="'+section+'"]')?.click();
        }
        addMessage("Certo. Abri a seção <b>"+({
          home:"Início",live:"TV ao vivo",movies:"Filmes",series:"Séries"
        }[section])+"</b>.");
      }catch{
        addMessage("Não consegui abrir essa seção agora.");
      }
      return;
    }

    addMessage("Posso abrir <b>TV ao vivo</b>, <b>Filmes</b>, <b>Séries</b>, pesquisar conteúdos da sua lista e tentar colocar o player em tela cheia.");
  }
  form?.addEventListener("submit",(e)=>{
    e.preventDefault();
    executeCommand(input?.value||"");
    if(input) input.value="";
  });

  document.querySelectorAll("[data-gc-ai-quick]").forEach(b=>{
    b.addEventListener("click",()=>{
      executeCommand(b.dataset.gcAiQuick||"");
    });
  });

  voice?.addEventListener("click",()=>{
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){
      if(status) status.textContent="● VOZ NÃO SUPORTADA";
      addMessage("O comando de voz não é suportado neste dispositivo/navegador. Use o chat.");
      return;
    }
    const r=new SR();
    r.lang="pt-BR";
    r.interimResults=false;
    r.maxAlternatives=1;
    voice.classList.add("listening");
    if(status) status.textContent="● OUVINDO...";
    r.onresult=e=>{
      const text=e.results?.[0]?.[0]?.transcript||"";
      if(input) input.value=text;
      executeCommand(text);
      if(input) input.value="";
    };
    r.onerror=()=>{
      if(status) status.textContent="● ERRO NO MICROFONE";
    };
    r.onend=()=>{
      voice.classList.remove("listening");
      if(status) status.textContent="● PRONTO";
    };
    try{ r.start(); }catch{}
  });

  return true;
}

if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",gcAiController,{once:true});
}else{
  gcAiController();
}
setTimeout(gcAiController,500);
setTimeout(gcAiController,1500);
})();