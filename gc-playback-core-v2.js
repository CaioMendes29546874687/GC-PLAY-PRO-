/* GC PLAY PRO — PLAYBACK CORE V2
 * One authoritative browser playback path.
 * Keeps catalog/import untouched and prevents competing engines.
 */
(function(){
  "use strict";
  if(window.__GC_PLAYBACK_CORE_V2__) return;
  window.__GC_PLAYBACK_CORE_V2__=true;
  const VERSION="2026.10.06.2";
  const originalApi=window.GC_PLAY_PRO;
  const state=()=>window.__GC_STATE__||originalApi?.state||null;
  const msg=t=>{const e=document.getElementById("playerMessage");if(e)e.textContent=t||""};
  const clean=v=>String(v??"").trim();
  const http=u=>/^https?:\/\//i.test(clean(u));
  const hls=u=>/\.m3u8(?:$|[?#&])/i.test(clean(u))||/m3u8/i.test(clean(u));
  const dash=u=>/\.mpd(?:$|[?#&])/i.test(clean(u));
  const ts=u=>/\.(ts|mpeg|mpg)(?:$|[?#&])/i.test(clean(u))||/\/live\//i.test(clean(u));
  const vod=u=>/\.(mp4|webm|mov|m4v)(?:$|[?#&])/i.test(clean(u));

  function proxy(u,item){
    try{
      if(typeof window.buildMediaProxyUrl==="function") return window.buildMediaProxyUrl(u,item);
    }catch{}
    return u;
  }
  function stopEngines(){
    const s=state();
    try{if(s?.hls){s.hls.destroy();s.hls=null}}catch{}
    try{if(s?.mpegts){s.mpegts.destroy();s.mpegts=null}}catch{}
    try{if(s?.dash){s.dash.reset();s.dash=null}}catch{}
    try{if(s?.shaka && typeof window.destroyShakaPlayer==="function")window.destroyShakaPlayer()}catch{}
  }
  function resetVideo(v){
    try{v.pause()}catch{}
    try{v.removeAttribute("src");v.load()}catch{}
  }
  function show(item){
    const p=document.getElementById("playerPanel");
    const t=document.getElementById("playerTitle");
    if(t)t.textContent=item.name||"GC PLAY PRO";
    if(p){p.classList.remove("hidden");p.classList.add("active","open","show")}
  }
  function directUrl(item){
    let u=clean(item?.url);
    const s=state();
    if(item?.xtreamKind==="live" && s?.xtreamSession && item.xtreamStreamId){
      try{
        if(typeof window.buildXtreamStreamUrl==="function")
          return window.buildXtreamStreamUrl(s.xtreamSession,"live",item.xtreamStreamId,"m3u8");
      }catch{}
    }
    return u;
  }
  async function nativeVideo(v,u,item){
    const direct=http(u)&&/^https:\/\//i.test(u);
    const primary=direct?u:proxy(u,item);
    const fallback=primary===u?proxy(u,item):u;
    let settled=false;
    const cleanup=[];
    const finish=()=>{if(settled)return;settled=true;cleanup.forEach(x=>x());msg("")};
    const fail=async()=>{
      if(settled)return;
      if(fallback && fallback!==primary){
        v.src=fallback; v.load();
        try{await v.play();return}catch{}
      }
      msg("Não foi possível iniciar este vídeo.");
    };
    const timer=setTimeout(fail,7000);
    const onPlaying=()=>{clearTimeout(timer);finish()};
    const onError=()=>{clearTimeout(timer);fail()};
    v.addEventListener("playing",onPlaying,{once:true});
    v.addEventListener("error",onError,{once:true});
    cleanup.push(()=>v.removeEventListener("playing",onPlaying),()=>v.removeEventListener("error",onError));
    v.src=primary;v.load();
    try{await v.play()}catch{msg("Toque em ▶ para iniciar.");}
  }
  function waitPlaying(v,timeout=9000){
    return new Promise((resolve,reject)=>{
      let done=false;
      const finish=(ok,err)=>{
        if(done)return; done=true;
        clearTimeout(timer);
        v.removeEventListener("playing",onPlaying);
        v.removeEventListener("error",onError);
        if(ok)resolve(true); else reject(err||Error("media startup failed"));
      };
      const onPlaying=()=>finish(true);
      const onError=()=>finish(false,v.error||Error("HTML5 media error"));
      const timer=setTimeout(()=>finish(false,Error("startup timeout")),timeout);
      v.addEventListener("playing",onPlaying,{once:true});
      v.addEventListener("error",onError,{once:true});
      if(v.readyState>=3) onPlaying();
    });
  }
  async function play(item){
    if(!item?.url){msg("Este conteúdo não possui uma URL válida.");return false}
    const s=state(); if(s)s.currentItem=item;
    const v=document.getElementById("videoPlayer");
    if(!v){msg("Player de vídeo indisponível.");return false}
    show(item); stopEngines(); resetVideo(v);
    const raw=directUrl(item);
    const kind=dash(raw)?"dash":hls(raw)?"hls":(item.type==="live"||ts(raw))?"ts":vod(raw)?"vod":"unknown";
    if(s){s.GCPlaybackCore=s.GCPlaybackCore||{};s.GCPlaybackCore.kind=kind;s.GCPlaybackCore.startedAt=Date.now()}
    msg(kind==="hls"?"Conectando ao HLS...":kind==="dash"?"Conectando ao DASH...":kind==="ts"?"Conectando ao MPEG-TS...":"Iniciando vídeo...");
    const note=(stage,extra={})=>{console.info("[GC PLAYBACK V2]",stage,{kind,url:raw,...extra});try{window.dispatchEvent(new CustomEvent("gc-playback-stage",{detail:{stage,kind,...extra}}))}catch{}};
    try{
      if(kind==="hls"){
        const p=proxy(raw,item); const fallback=p!==raw?raw:"";
        if(typeof window.playHLS!=="function") throw Error("Motor HLS indisponível");
        note("hls_start",{proxied:p!==raw});
        await window.playHLS(v,p,document.getElementById("playerMessage"),"",fallback);
        msg("Aguardando primeiro quadro...");
        await waitPlaying(v,9000);
        msg(""); note("playing"); return true;
      }
      if(kind==="dash"){
        const p=proxy(raw,item);
        note("dash_start",{proxied:p!==raw});
        let ok=false;
        if(typeof window.playShaka==="function"){
          try{ok=await window.playShaka(v,p,document.getElementById("playerMessage"),p!==raw?raw:"");}catch(e){note("shaka_error",{error:String(e)})}
        }
        if(!ok && typeof window.playDASH==="function"){
          await window.playDASH(v,p,document.getElementById("playerMessage"),p!==raw?raw:""); ok=true;
        }
        if(!ok) throw Error("Motor DASH indisponível");
        msg("Aguardando primeiro quadro..."); await waitPlaying(v,9000); msg(""); note("playing"); return true;
      }
      if(kind==="ts"){
        if(typeof window.playMpegTS!=="function")throw Error("Motor MPEG-TS indisponível");
        note("ts_start");
        await window.playMpegTS(v,proxy(raw,item),document.getElementById("playerMessage"),raw,"");
        msg("Aguardando primeiro quadro...");
        await waitPlaying(v,10000);
        msg(""); note("playing"); return true;
      }
      note("native_start");
      await nativeVideo(v,raw,item);
      await waitPlaying(v,7000);
      msg(""); note("playing"); return true;
    }catch(e){
      note("primary_failed",{error:String(e?.message||e)});
      stopEngines(); resetVideo(v);
      msg("Primeira conexão falhou. Tentando origem direta...");
      try{
        if(kind==="hls" && typeof window.playHLS==="function"){
          await window.playHLS(v,raw,document.getElementById("playerMessage"));
          await waitPlaying(v,9000); msg(""); note("direct_playing"); return true;
        }
        if(kind==="ts" && typeof window.playMpegTS==="function"){
          await window.playMpegTS(v,raw,document.getElementById("playerMessage"));
          await waitPlaying(v,10000); msg(""); note("direct_playing"); return true;
        }
        await nativeVideo(v,raw,item); await waitPlaying(v,7000); msg(""); note("direct_playing"); return true;
      }catch(e2){
        note("final_failed",{error:String(e2?.message||e2)});
        stopEngines(); resetVideo(v);
        msg("Não foi possível reproduzir este conteúdo.");
        return false;
      }
    }
  }

  window.GCPlaybackCore={version:VERSION,play,stop:stopEngines};
  window.playItem=play;
  if(originalApi) originalApi.playItem=play;
  if(window.GCArchitectureBridge && typeof window.GCArchitectureBridge==="object"){}
  console.log("[GC PLAY PRO] Playback Core V2 ativo",VERSION);
})();