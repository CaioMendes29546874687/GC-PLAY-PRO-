/* GC PLAY PRO — FINAL READINESS / INTEGRATION LAYER
 * Integração final não-invasiva das 14 partes.
 * Não transporta vídeo pelo Supabase/Cloudflare.
 */
"use strict";
(function(global){
  if(global.__GC_FINAL_READINESS__) return;
  global.__GC_FINAL_READINESS__=true;

  const A=global.GCArchitecture;
  const S=()=>global.__GC_STATE__||null;
  const diag=(type,data={})=>{try{A?.diagnostics?.record?.(type,data)}catch{}};
  const clean=v=>String(v??"").trim();

  function repairSeriesMetadata(){
    const s=S();
    if(!s || !Array.isArray(s.seriesCatalog) || !Array.isArray(s.items)) return;
    const byKey=new Map();
    for(const item of s.items){
      if(item?.type!=="series" || !item.seriesKey) continue;
      const key=String(item.seriesKey);
      const current=byKey.get(key);
      if(!current || (!current.xtreamSeriesId && item.xtreamSeriesId)) byKey.set(key,item);
    }
    let repaired=0;
    for(const entry of s.seriesCatalog){
      const src=byKey.get(String(entry.seriesKey));
      if(src){
        if(!entry.xtreamSeriesId && src.xtreamSeriesId){entry.xtreamSeriesId=src.xtreamSeriesId;repaired++;}
        if(!entry.logo && src.logo) entry.logo=src.logo;
        if(!entry.group && src.group) entry.group=src.group;
        if(!entry.genre && src.genre) entry.genre=src.genre;
      }
    }
    if(repaired) diag("series_metadata_repaired",{count:repaired});
  }

  function deviceAdapter(){
    const ua=navigator.userAgent||"";
    let platform="web";
    if(/Tizen|SMART-TV|SamsungBrowser.*TV/i.test(ua)) platform="samsung";
    else if(/Web0S|WebOS|NetCast/i.test(ua)) platform="lg";
    else if(/Android TV|GoogleTV|BRAVIA|AFT[A-Z]/i.test(ua)) platform="android-tv";
    else if(/Android/i.test(ua)) platform="android";
    else if(/iPhone|iPad|iPod/i.test(ua)) platform="ios";
    const memory=navigator.deviceMemory||null;
    const cores=navigator.hardwareConcurrency||null;
    return {platform,memory,cores,online:navigator.onLine};
  }

  async function globalSearch(term,limit=100){
    const q=clean(term);
    if(!q) return [];
    try{
      if(typeof global.GCArchitectureGlobalSearch==="function"){
        const r=await global.GCArchitectureGlobalSearch(q,limit);
        if(r?.length) return r;
      }
    }catch(e){diag("final_search_error",{error:String(e?.message||e)});}
    const s=S();
    return A?.search?.search?.(Array.isArray(s?.items)?s.items:[],q,limit)||[];
  }

  async function seriesEpisodes(seriesKey,season=null){
    try{
      repairSeriesMetadata();
      if(typeof global.getSeriesEpisodes==="function") return await global.getSeriesEpisodes(seriesKey,season);
    }catch(e){diag("final_series_error",{error:String(e?.message||e),seriesKey,season});}
    return [];
  }

  function activation(){
    try{
      const raw=localStorage.getItem("GC_PLAY_PRO_ACTIVATION_V1");
      if(!raw) return {valid:false,reason:"missing"};
      const x=JSON.parse(raw);
      if(x?.active===false) return {valid:false,reason:"inactive",deviceId:x?.deviceId||null};
      const expires=Date.parse(x?.expiresAt||"");
      if(!expires) return {valid:false,reason:"invalid_expiry",deviceId:x?.deviceId||null};
      const currentDevice=localStorage.getItem("GC_PLAY_PRO_DEVICE_ID")||null;
      const deviceBound=!!x?.deviceId;
      const deviceMatches=!deviceBound || !currentDevice || String(x.deviceId)===String(currentDevice);
      if(!deviceMatches) return {valid:false,reason:"device_mismatch",expiresAt:new Date(expires).toISOString(),deviceId:x.deviceId};
      return {valid:expires>Date.now(),expiresAt:new Date(expires).toISOString(),deviceId:x?.deviceId||null};
    }catch{return {valid:false,reason:"invalid_storage"}}
  }

  function selfTest(){
    const s=S();
    const tests={
      ingestion:typeof global.loadM3U==="function" && !!A?.ingestion,
      xtream:!!A?.xtream,
      catalog:!!A?.catalog,
      series:!!A?.series && typeof global.getSeriesEpisodes==="function",
      epg:!!A?.epg,
      search:!!A?.search,
      cache:!!A?.cache,
      playback:typeof global.playItem==="function" && !!A?.playback,
      adapters:!!A?.adapters,
      activation:!!A?.activation,
      devices:!!A?.devices,
      diagnostics:!!A?.diagnostics,
      security:!!A?.security,
      ai:!!A?.ai
    };
    const passed=Object.values(tests).filter(Boolean).length;
    const total=Object.keys(tests).length;
    const result={ok:passed===total,passed,total,tests,adapter:deviceAdapter(),activation:activation(),counts:s?.counts||null,totalItems:s?.total||0,bridgeReady:!!A?.bridgeReady};
    diag("final_self_test",result);
    return result;
  }

  global.GCPlayProFinal={
    version:"2026.10.06.1",
    adapter:deviceAdapter,
    search:globalSearch,
    seriesEpisodes,
    activation,
    repairSeriesMetadata,
    selfTest
  };

  function boot(){
    repairSeriesMetadata();
    const result=selfTest();
    global.dispatchEvent(new CustomEvent("gc:final-ready",{detail:result}));
    diag("final_ready",{version:global.GCPlayProFinal.version,adapter:result.adapter});
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot,{once:true});
  else setTimeout(boot,0);

  global.addEventListener("online",()=>diag("network_online"));
  global.addEventListener("offline",()=>diag("network_offline"));
})(window);
