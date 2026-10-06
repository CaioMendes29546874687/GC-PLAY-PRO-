/* GC PLAY PRO — ARCHITECTURE V2 BRIDGE
 * Liga os 14 engines ao motor existente sem substituir a reprodução.
 */
"use strict";

(function(global){
  const A=global.GCArchitecture;
  if(!A || global.__GC_ARCH_BRIDGE__) return;
  global.__GC_ARCH_BRIDGE__=true;

  const diag=(type,data={})=>{
    try{return A.diagnostics.push(type,data)}catch{return null}
  };

  const bootAt=Date.now();
  diag("bridge_loaded",{device:A.adapters.preferred(),deviceInfo:A.devices.info()});

  /* Carregamento/importação: mede tempo, origem e resultado. */
  function wrapAsync(name, eventName){
    const original=global[name];
    if(typeof original!=="function" || original.__gcArchWrapped) return;
    const wrapped=async function(...args){
      const started=performance.now();
      const url=typeof args[0]==="string"?args[0]:"";
      diag(eventName+"_start",{
        url:url.slice(0,512),
        security:A.security.catalog(url),
        source:"catalog"
      });
      try{
        const result=await original.apply(this,args);
        diag(eventName+"_success",{
          ok:result!==false,
          elapsedMs:Math.round(performance.now()-started)
        });
        return result;
      }catch(error){
        diag(eventName+"_error",{
          elapsedMs:Math.round(performance.now()-started),
          error:String(error?.message||error)
        });
        throw error;
      }
    };
    wrapped.__gcArchWrapped=true;
    wrapped.__gcArchOriginal=original;
    global[name]=wrapped;
  }

  wrapAsync("loadM3U","catalog_load");

  /* Reprodução: apenas classifica/telemetria. A URL não é reescrita. */
  const originalPlay=global.playItem;
  if(typeof originalPlay==="function" && !originalPlay.__gcArchWrapped){
    const wrappedPlay=async function(item,...rest){
      const url=String(item?.url||"");
      const kind=A.playback.classify(url);
      diag("playback_start",{
        type:item?.type||"unknown",
        transport:kind,
        direct:A.playback.direct(url),
        security:A.security.playback(url),
        name:String(item?.name||"").slice(0,160)
      });
      try{
        const result=await originalPlay.call(this,item,...rest);
        diag("playback_success",{transport:kind});
        return result;
      }catch(error){
        diag("playback_error",{
          transport:kind,
          error:String(error?.message||error)
        });
        throw error;
      }
    };
    wrappedPlay.__gcArchWrapped=true;
    wrappedPlay.__gcArchOriginal=originalPlay;
    global.playItem=wrappedPlay;
  }

  /* EPG: não bloqueia o vídeo; apenas registra/parsa quando a função existente retorna XML. */
  const originalEPG=global.loadLiveEPG;
  if(typeof originalEPG==="function" && !originalEPG.__gcArchWrapped){
    const wrappedEPG=async function(item,...rest){
      const started=performance.now();
      try{
        const result=await originalEPG.call(this,item,...rest);
        let parsed=0;
        if(typeof result==="string" && result.includes("<programme")){
          parsed=A.epg.parseXML(result).length;
        }else if(Array.isArray(result)){
          parsed=result.length;
        }
        diag("epg_success",{items:parsed,elapsedMs:Math.round(performance.now()-started)});
        return result;
      }catch(error){
        diag("epg_error",{elapsedMs:Math.round(performance.now()-started),error:String(error?.message||error)});
        throw error;
      }
    };
    wrappedEPG.__gcArchWrapped=true;
    global.loadLiveEPG=wrappedEPG;
  }

  /* Busca: índice RAM pequeno e rápido para a amostra já carregada.
     O motor atual continua responsável pelos filtros/categorias. */
  let lastIndex=null;
  let lastItems=null;
  function rebuildSearchIndex(){
    const s=global.__GC_STATE__;
    const items=Array.isArray(s?.items)?s.items:[];
    if(items===lastItems) return;
    lastItems=items;
    lastIndex=items.filter(Boolean);
    A.cache.set("search-index-meta",{
      count:lastIndex.length,
      builtAt:Date.now()
    },10*60*1000);
  }

  global.GCArchitecture.searchCatalog=async function(term,limit=100){
    rebuildSearchIndex();
    const s=global.__GC_STATE__;
    const query=String(term||"").trim();
    if(!query) return [];
    /* Para listas grandes, consulta o índice RAM primeiro e só depois
       usa o catálogo completo quando ele já estiver disponível. */
    let result=A.search.search(lastIndex,query,limit);
    if(!result.length && Array.isArray(s?.seriesCatalog) && s.seriesCatalog.length){
      result=A.search.search(s.seriesCatalog,query,limit);
    }
    diag("search",{term:query.slice(0,120),results:result.length});
    return result;
  };

  /* Ponte de séries: mantém a hierarquia real do app e expõe uma
     consulta única para GC IA, busca e diagnóstico. */
  global.GCArchitecture.seriesCatalog=async function(){
    const s=global.__GC_STATE__;
    return Array.isArray(s?.seriesCatalog) ? s.seriesCatalog : [];
  };
  global.GCArchitecture.seriesEpisodes=async function(seriesKey,season=null){
    if(typeof global.getSeriesEpisodes!=="function") return [];
    return global.getSeriesEpisodes(seriesKey,season);
  };

  global.GCArchitecture.diagnosticsSnapshot=function(){
    return {
      ...A.diagnostics.snapshot(),
      uptimeMs:Date.now()-bootAt,
      activation:A.activation.valid(),
      device:A.devices.info(),
      searchIndexSize:lastIndex?.length||0
    };
  };

  /* Atualiza diagnóstico sem polling agressivo. */
  let lastReady=false;
  const timer=setInterval(()=>{
    const s=global.__GC_STATE__;
    const ready=!!(s?.db && !s?.loading);
    if(ready!==lastReady){
      lastReady=ready;
      diag("app_ready_state",{ready,counts:s?.counts||null,total:s?.total||0});
    }
  },2000);
  if(timer?.unref) timer.unref();

  global.GCArchitecture.bridgeReady=true;
  diag("bridge_ready",{elapsedMs:Date.now()-bootAt});
})(window);
