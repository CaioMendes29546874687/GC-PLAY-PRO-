/* GC PLAY PRO — FINAL RUNTIME FIX 2026-10-02 */
(function(){
"use strict";

const VERSION="20261002-2";
window.__GC_FINAL_FIX_VERSION__=VERSION;

function api(){ return window.GC_PLAY_PRO || null; }
function state(){ return api()?.state || window.__GC_STATE__ || null; }

async function directSection(section){
  const a=api(), s=state();
  if(!a || !s) return false;

  if(section==="live" || section==="movies" || section==="series"){
    const type=section==="live" ? "live" : section==="movies" ? "movie" : "series";
    s.currentSection=section;
    s.currentFilter=type;
    s.currentGenre="all";
    s.seriesView.seriesKey=null;
    s.seriesView.season=null;
    if(typeof a.setCatalogCategory==="function"){
      await a.setCatalogCategory(type,"all");
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

/* Bottom/top navigation: use the fast catalog API instead of waiting
   indefinitely for the original boot promise. */
document.addEventListener("click",async function(event){
  const button=event.target.closest(".gc-bottom-nav button.nav-item[data-section], .main-nav button.nav-item[data-section]");
  if(!button) return;

  const section=button.dataset.section || "home";
  if(!["home","live","movies","series","favorites"].includes(section)) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  try{
    await directSection(section);
    document.querySelectorAll("[data-section]").forEach(b=>{
      b.classList.toggle("active",b.dataset.section===section);
    });
  }catch(error){
    console.error("[GC FINAL] navigation:",error);
  }
},true);

/* Series browser: the previous hotfix no longer consumes these clicks.
   Handle series -> season -> episode here, including dynamically fetched
   Xtream episodes that are not stored in IndexedDB. */
document.addEventListener("click",async function(event){
  const target=event.target;

  const back=target.closest("#contentGrid [data-series-back]");
  if(back){
    event.preventDefault();
    event.stopImmediatePropagation();
    const s=state(), a=api();
    if(!s || !a) return;
    if(s.seriesView.season!==null) s.seriesView.season=null;
    else s.seriesView.seriesKey=null;
    await a.render();
    return;
  }

  const series=target.closest("#contentGrid [data-series-key]");
  if(series){
    event.preventDefault();
    event.stopImmediatePropagation();
    const s=state(), a=api();
    if(!s || !a) return;
    s.seriesView.seriesKey=String(series.dataset.seriesKey||"");
    s.seriesView.season=null;
    await a.render();
    return;
  }

  const season=target.closest("#contentGrid [data-series-season]");
  if(season){
    event.preventDefault();
    event.stopImmediatePropagation();
    const s=state(), a=api();
    if(!s || !a) return;
    s.seriesView.season=Number(season.dataset.seriesSeason);
    await a.render();
    return;
  }

  const card=target.closest("#contentGrid [data-item-id]");
  if(card && !target.closest("[data-favorite-id]")){
    const id=String(card.dataset.itemId||"");
    const a=api();
    if(a?.playItem){
      event.preventDefault();
      event.stopImmediatePropagation();
      try{
        const item=typeof window.findItem==="function" ? await window.findItem(id) : null;
        if(item) await a.playItem(item);
      }catch(error){
        console.error("[GC FINAL] item playback:",error);
      }
    }
  }
},true);

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
