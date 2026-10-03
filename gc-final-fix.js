/* GC PLAY PRO — FINAL RUNTIME FIX 2026-10-02 */
(function(){
"use strict";

const VERSION="20261002-13";
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

    if(/\b(voltar|volte|retornar|retroceder)\b/.test(n)){
      if(window.GC_PLAY_PRO?.closePlayer) window.GC_PLAY_PRO.closePlayer();
      if(window.__GC_STATE__){
        window.__GC_STATE__.seriesView.seriesKey=null;
        window.__GC_STATE__.seriesView.season=null;
      }
      try{ await window.GC_PLAY_PRO?.navigateSection?.("home"); }catch{}
      addMessage("Voltei para o início.");
      return;
    }

    if(/\b(fechar player|feche o player|fechar v[ií]deo|feche o v[ií]deo|sair do player)\b/.test(n)){
      window.GC_PLAY_PRO?.closePlayer?.();
      addMessage("Player fechado.");
      return;
    }

    if(/\b(temporada|season)\s*(\d+)\b/.test(n)){
      const m=n.match(/\b(?:temporada|season)\s*(\d+)\b/);
      const s=window.__GC_STATE__||window.GC_PLAY_PRO?.state;
      if(s?.seriesView?.seriesKey){
        s.currentSection="series";
        s.currentFilter="series";
        s.currentGenre="all";
        s.seriesView.season=Number(m[1]);
        try{ await window.GC_PLAY_PRO?.render?.(); addMessage("Abrindo a <b>temporada "+m[1]+"</b>."); }
        catch{ addMessage("Não consegui abrir essa temporada agora."); }
      }else{
        addMessage("Primeiro abra uma série para escolher a temporada.");
      }
      return;
    }

    if(/\b(favoritar|favorito|adicionar aos favoritos|salvar nos favoritos|remover dos favoritos|desfavoritar|tirar dos favoritos)\b/.test(n)){
      const current=window.GC_PLAY_PRO?.state?.currentItem;
      if(current?.id){
        const button=document.querySelector('[data-favorite-id="'+CSS.escape(String(current.id))+'"]');
        if(button){ button.click(); addMessage("Favoritos atualizados."); }
        else addMessage("Abra um conteúdo para alterar os favoritos.");
      }else addMessage("Abra um conteúdo primeiro para alterar os favoritos.");
      return;
    }

    if(/\b(pr[oó]ximo epis[oó]dio|pr[oó]ximo cap[ií]tulo|epis[oó]dio seguinte|avançar epis[oó]dio|epis[oó]dio anterior|cap[ií]tulo anterior|voltar epis[oó]dio)\b/.test(n)){
      const s=window.GC_PLAY_PRO?.state;
      const current=s?.currentItem;
      const key=current?.seriesKey;
      const season=Number(current?.season ?? 0);
      const episode=Number(current?.episode ?? 0);
      if(key && typeof window.GC_PLAY_PRO?.getSeriesEpisodes==="function"){
        try{
          const eps=await window.GC_PLAY_PRO.getSeriesEpisodes(key, season||null);
          const ordered=[...eps].sort((a,b)=>Number(a.episode??0)-Number(b.episode??0));
          const dir=/\b(anterior|voltar)\b/.test(n)?-1:1;
          const idx=ordered.findIndex(x=>String(x.id)===String(current.id));
          const target=ordered[idx+dir];
          if(target){
            await window.GC_PLAY_PRO.playItem(target);
            addMessage((dir>0?"Abrindo o próximo":"Voltando ao episódio anterior")+" episódio.");
          }else addMessage(dir>0?"Você já está no último episódio.":"Você já está no primeiro episódio.");
        }catch{ addMessage("Não consegui localizar o episódio seguinte agora."); }
      }else addMessage("Este conteúdo não está identificado como episódio de uma série.");
      return;
    }

    const video=document.getElementById("videoPlayer");

    if(/\b(pausar|pause|pausa|pare o v[ií]deo|parar o v[ií]deo|parar)\b/.test(n) && video){
      video.pause();
      addMessage("Vídeo pausado.");
      return;
    }

    if(/\b(continuar|continue|retomar|retome|despausar|play|reproduzir|continue o v[ií]deo)\b/.test(n) && video){
      try{ await video.play(); addMessage("Continuando a reprodução."); }
      catch{ addMessage("Não consegui continuar a reprodução neste momento."); }
      return;
    }

    if(/\b(mudo|mutar|mute|silenciar|silencie)\b/.test(n) && video){
      video.muted=true;
      addMessage("Som desativado.");
      return;
    }

    if(/\b(desmutar|tirar do mudo|ativar som|ligar som|som ligado)\b/.test(n) && video){
      video.muted=false;
      addMessage("Som ativado.");
      return;
    }

    const volumeMatch=n.match(/\b(?:volume|som)\s*(?:para|em|de)?\s*(\d{1,3})\s*%?/);
    if(volumeMatch && video){
      const value=Math.max(0,Math.min(100,Number(volumeMatch[1])));
      video.volume=value/100;
      video.muted=value===0;
      addMessage("Volume ajustado para <b>"+value+"%</b>.");
      return;
    }

    if(/\b(aumentar|aumente|mais)\s*(?:o\s*)?(?:volume|som)\b/.test(n) && video){
      video.muted=false;
      video.volume=Math.min(1,video.volume+0.1);
      addMessage("Aumentei o volume para <b>"+Math.round(video.volume*100)+"%</b>.");
      return;
    }

    if(/\b(diminuir|diminua|menos)\s*(?:o\s*)?(?:volume|som)\b/.test(n) && video){
      video.volume=Math.max(0,video.volume-0.1);
      addMessage("Volume reduzido para <b>"+Math.round(video.volume*100)+"%</b>.");
      return;
    }

    const speedMatch=n.match(/\b(?:velocidade|velocidade de reprodu[cç][aã]o)\s*(?:para|em)?\s*(0\.5|0\.75|1|1\.25|1\.5|1\.75|2)\s*x?/);
    if(speedMatch && video){
      const rate=Number(speedMatch[1]);
      video.playbackRate=rate;
      if(window.__GC_STATE__?.settings) window.__GC_STATE__.settings.playbackRate=rate;
      addMessage("Velocidade ajustada para <b>"+rate+"x</b>.");
      return;
    }

    if(/\b(adicionar aos favoritos|favoritar|favorito|salvar nos favoritos)\b/.test(n)){
      const current=window.__GC_STATE__?.currentItem;
      if(current?.id && typeof window.toggleFavorite==="function"){
        window.toggleFavorite(current.id);
        addMessage("Conteúdo adicionado aos favoritos.");
      }else{
        addMessage("Abra um conteúdo primeiro para adicioná-lo aos favoritos.");
      }
      return;
    }

    if(/\b(remover dos favoritos|desfavoritar|tirar dos favoritos)\b/.test(n)){
      const current=window.__GC_STATE__?.currentItem;
      if(current?.id && typeof window.toggleFavorite==="function"){
        window.toggleFavorite(current.id);
        addMessage("Conteúdo removido dos favoritos.");
      }else{
        addMessage("Abra um conteúdo primeiro para alterar os favoritos.");
      }
      return;
    }

    if(/\b(meus favoritos|favoritos|abrir favoritos)\b/.test(n) && !/\b(adicionar|remover|tirar)\b/.test(n)){
      try{ await window.GC_PLAY_PRO?.navigateSection?.("favorites"); addMessage("Abrindo seus favoritos."); }
      catch{ addMessage("Não consegui abrir os favoritos agora."); }
      return;
    }

    if(/\b(configura[cç][aã]o|configura[cç][oõ]es|configurar o aplicativo|abrir configura[cç][oõ]es)\b/.test(n)){
      const settings=document.querySelector('[aria-label*="config" i], [data-settings], #settingsPanel');
      if(settings){ settings.scrollIntoView({behavior:"smooth",block:"center"}); addMessage("Abri as configurações disponíveis."); }
      else addMessage("As configurações disponíveis ficam no menu do aplicativo.");
      return;
    }

    if(/\b(recarregar|atualizar|recarregue a p[aá]gina)\b/.test(n)){
      addMessage("Atualizando o aplicativo...");
      setTimeout(()=>location.reload(),150);
      return;
    }

    const s=window.__GC_STATE__||window.GC_PLAY_PRO?.state;
    const items=Array.isArray(s?.items)?s.items:[];
    const catalog=Array.isArray(s?.seriesCatalog)?s.seriesCatalog:[];

    const stripCommand=(value)=>String(value||"")
      .replace(/\b(quero|abra|abrir|abre|assistir|assista|coloque|coloca|reproduza|reproduzir|toque|mostrar|mostre|pesquise|pesquisar|procure|procurar|buscar|busque|me mostre|por favor)\b/gi," ")
      .replace(/\b(?:a|o|um|uma|os|as)\s+(?=(?:s[eé]rie|filme|filmes|canal|temporada|epis[oó]dio)\b)/gi," ")
      .replace(/\b(?:canal|canais|tv|televis[aã]o|ao vivo|filme|filmes|s[eé]rie|s[eé]ries|temporada|temporadas|epis[oó]dio|epis[oó]dios)\b/gi," ")
      .replace(/\b(?:do|da|dos|das|de)\b/gi," ")
      .replace(/\s+/g," ").trim();

    const clean=stripCommand(q);
    const norm=(value)=>String(value||"")
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
    const compact=(value)=>norm(value).replace(/\s+/g,"");

    const queryNorm=norm(clean);
    const queryCompact=compact(clean);

    /* "Filmes do X", "série X" e "911" também são pesquisas específicas,
       mesmo sem o verbo "abra". Um comando que seja apenas "Filmes" continua
       sendo navegação para a seção. */
    const hasCommandVerb=/\b(abra|abrir|abre|assistir|assista|coloque|coloca|reproduza|reproduzir|toque|mostrar|mostre|pesquise|pesquisar|procure|procurar|buscar|busque)\b/.test(n);
    const hasContentQualifier=/\b(filmes?|movies?|s[eé]ries?|serie|canais?)\b/.test(n);
    const wantsSpecific=Boolean(queryNorm && (hasCommandVerb || hasContentQualifier));

    const scoreCandidate=(item)=>{
      if(!item || window.isAdultContent?.(item)) return -1;
      const title=norm(item.seriesName||item.name||"");
      const alt=norm(item.name||"");
      const titleCompact=compact(title);
      const altCompact=compact(alt);
      if(!queryNorm || !title) return -1;

      /* Trata "911", "9-1-1" e "9 1 1" como o mesmo título. */
      if(titleCompact===queryCompact) return 1200;
      if(altCompact===queryCompact) return 1150;
      if(title===queryNorm) return 1100;
      if(alt===queryNorm) return 1050;
      if(titleCompact.startsWith(queryCompact)) return 950;
      if(title.startsWith(queryNorm)) return 900;
      if(altCompact.startsWith(queryCompact)) return 850;
      if(title.includes(queryNorm)) return 800;
      if(alt.includes(queryNorm)) return 700;

      const terms=queryNorm.split(" ").filter(Boolean);
      const hits=terms.filter(t=>title.includes(t)||alt.includes(t)).length;
      return hits===terms.length ? 600+hits : -1;
    };

    async function gcAiFindDatabaseItems(predicate, limit=40){
      const found=[];
      if(!s?.db) return found;
      try{
        await new Promise(resolve=>{
          const tx=s.db.transaction("items","readonly");
          const request=tx.objectStore("items").openCursor();
          request.onsuccess=e=>{
            const cursor=e.target.result;
            if(!cursor || found.length>=limit){ resolve(); return; }
            try{
              const item=cursor.value;
              if(predicate(item)) found.push(item);
            }catch{}
            cursor.continue();
          };
          request.onerror=()=>resolve();
        });
      }catch{}
      return found;
    }

    if(wantsSpecific && queryNorm){
      /* Primeiro séries, para comandos como "abra a série 911". */
      const seriesPool=[
        ...catalog,
        ...items.filter(x=>x && (x.type==="series" || x.seriesKey))
      ];

      const uniqueSeries=new Map();
      for(const item of seriesPool){
        const key=String(item.seriesKey||item.id||item.name||"");
        if(!key) continue;
        const prev=uniqueSeries.get(key);
        if(!prev || scoreCandidate(item)>scoreCandidate(prev)) uniqueSeries.set(key,item);
      }

      const seriesFound=Array.from(uniqueSeries.values())
        .map(item=>({item,score:scoreCandidate(item)}))
        .filter(x=>x.score>=0)
        .sort((a,b)=>b.score-a.score)
        .slice(0,10)
        .map(x=>x.item);

      const explicitlySeries=/\b(s[eé]rie|s[eé]ries|temporada|epis[oó]dio|epis[oó]dios)\b/.test(n);

      if(seriesFound.length && (explicitlySeries || !/\bfilmes?\b/.test(n))){
        const item=seriesFound[0];
        let key=String(item.seriesKey||"").trim();

        if(s?.seriesKeyAliases instanceof Map && key){
          key=s.seriesKeyAliases.get(key)||key;
        }

        if(!key){
          const title=String(item.seriesName||item.name||"").trim();
          const match=catalog.find(x=>compact(x.seriesName||x.name)===queryCompact || norm(x.seriesName||x.name)===norm(title));
          key=String(match?.seriesKey||"").trim();
        }

        if(s && key){
          s.currentSection="series";
          s.currentFilter="series";
          s.currentGenre="all";
          s.searchTerm="";
          s.seriesView.seriesKey=key;
          s.seriesView.season=null;
        }

        try{
          if(window.GC_PLAY_PRO?.render) await window.GC_PLAY_PRO.render();
          const label=String(item.seriesName||item.name||clean||"").replace(/[&<>]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[m]));
          addMessage("Abrindo a série <b>"+label+"</b>.");
        }catch{
          addMessage("Encontrei a série, mas não consegui abrir os episódios agora.");
        }
        return;
      }

      /* Filmes/conteúdos: usa RAM + IndexedDB para não depender dos 4 mil
         itens mantidos em memória em playlists muito grandes. */
      let contentFound=items
        .filter(x=>x && x.type!=="series" && !x.seriesKey)
        .map(item=>({item,score:scoreCandidate(item)}))
        .filter(x=>x.score>=0)
        .sort((a,b)=>b.score-a.score)
        .map(x=>x.item);

      if(!contentFound.length || /\bfilmes?\b/.test(n)){
        const dbFound=await gcAiFindDatabaseItems(item=>{
          if(!item || item.type==="series" || item.seriesKey) return false;
          return scoreCandidate(item)>=0;
        },60);
        const seen=new Set(contentFound.map(x=>String(x.id||x.url||x.name||"")));
        for(const item of dbFound){
          const key=String(item.id||item.url||item.name||"");
          if(!seen.has(key)){seen.add(key);contentFound.push(item);}
        }
        contentFound.sort((a,b)=>scoreCandidate(b)-scoreCandidate(a));
      }

      if(contentFound.length){
        /* Se há vários filmes relacionados, mostra a busca dentro de Filmes.
           Se houver uma correspondência praticamente exata, abre diretamente. */
        const exact=contentFound.find(x=>scoreCandidate(x)>=1100);
        if(exact){
          try{
            await window.GC_PLAY_PRO?.playItem?.(exact);
            addMessage("Abrindo <b>"+String(exact.name||"conteúdo").replace(/[&<>]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[m]))+"</b>.");
          }catch{
            addMessage("Encontrei o conteúdo, mas não consegui iniciar a reprodução.");
          }
          return;
        }

        if(s){
          s.currentSection="movies";
          s.currentFilter="movie";
          s.currentGenre="all";
          s.searchTerm=clean;
          s.seriesView.seriesKey=null;
          s.seriesView.season=null;
        }

        try{
          if(window.GC_PLAY_PRO?.render) await window.GC_PLAY_PRO.render();
          addMessage("Encontrei <b>"+contentFound.length+"</b> resultado(s) para <b>"+String(clean).replace(/[&<>]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[m]))+"</b>.");
        }catch{
          addMessage("Encontrei os filmes, mas não consegui mostrar os resultados agora.");
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