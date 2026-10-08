/* GC PLAY PRO — LIVE RENDER FIX 2026-10-08 */
(function(){
  "use strict";
  const RENDER_LIVE="https://gc-play-pro-backend.onrender.com/api/live";
  function renderLiveUrl(value){
    const raw=String(value||"").trim();if(!raw)return raw;
    try{
      const u=new URL(raw);
      const host=u.hostname.toLowerCase();
      if(host==="gc-live-tcp-test.caioroberto318.workers.dev"||host==="gc-catalog.caioroberto318.workers.dev"){
        const source=u.searchParams.get("url");
        if(source){const p=new URL(RENDER_LIVE);p.searchParams.set("url",source);return p.toString()}
      }
      if(/\\/(?:play|live)\\//i.test(u.pathname)){
        const p=new URL(RENDER_LIVE);p.searchParams.set("url",raw);return p.toString()
      }
    }catch{}
    return raw;
  }
  window.GC_RENDER_LIVE_URL=renderLiveUrl;
  const nativeHls=window.playHLS;
  if(typeof nativeHls==="function"&&!window.__GC_RENDER_LIVE_WRAP__){
    window.playHLS=async function(video,url,message,fallbackUrl="",directFallbackUrl="",directHlsFallbackUrl=""){
      const live=renderLiveUrl(url);
      const fb=renderLiveUrl(fallbackUrl),df=renderLiveUrl(directFallbackUrl),dh=renderLiveUrl(directHlsFallbackUrl);
      if(message)message.textContent="Conectando ao LIVE pelo Render...";
      return nativeHls(video,live,message,fb,df,dh);
    };
    window.__GC_RENDER_LIVE_WRAP__=true;
  }
  const nativeMpeg=window.playMpegTS;
  if(typeof nativeMpeg==="function"&&!window.__GC_RENDER_MPEG_WRAP__){
    window.playMpegTS=async function(video,url,message,directFallbackUrl="",secondaryFallbackUrl=""){
      return nativeMpeg(video,renderLiveUrl(url),message,renderLiveUrl(directFallbackUrl),renderLiveUrl(secondaryFallbackUrl));
    };
    window.__GC_RENDER_MPEG_WRAP__=true;
  }
})();

/* Compatibilidade HLS Android: impede a rota nativa de competir com HLS.js. */
(function(){
  const nativeHls=window.playHLS;
  if(typeof nativeHls!=="function"||window.__GC_HLS_ANDROID_WRAP__)return;
  window.playHLS=async function(video,url,message,fallbackUrl="",directFallbackUrl="",directHlsFallbackUrl=""){
    if(!video)return nativeHls(video,url,message,fallbackUrl,directFallbackUrl,directHlsFallbackUrl);
    const original=video.canPlayType;
    try{video.canPlayType=function(type){if(/mpegurl/i.test(String(type||"")))return "";return original.call(video,type)}}catch{}
    try{return await nativeHls(video,url,message,fallbackUrl,directFallbackUrl,directHlsFallbackUrl)}finally{try{video.canPlayType=original}catch{}}
  };
  window.__GC_HLS_ANDROID_WRAP__=true;
})();

/* Catalog recovery remains available for structured Xtream sessions. */
(function(){
  const G="https://gc-catalog.caioroberto318.workers.dev",DB="GC_PLAY_PRO_FAST",STORE="items";
  async function recover(){
    const app=window.GC_PLAY_PRO,s=app?.state;if(!app||!s?.xtreamSession)return false;
    const session=s.xtreamSession;
    async function get(action){const u=new URL(session.base+"/player_api.php");u.searchParams.set("username",session.username);u.searchParams.set("password",session.password);u.searchParams.set("action",action);const r=await fetch(G+"?url="+encodeURIComponent(u),{cache:"no-store",headers:{Accept:"application/json"}});if(!r.ok)throw Error("API "+r.status);const x=await r.json();return Array.isArray(x)?x:(x?.data||x?.streams||x?.items||x?.series||[])}
    async function write(rows,type){const db=await new Promise((res,rej)=>{const q=indexedDB.open(DB,7);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)});await new Promise((res,rej)=>{const t=db.transaction(STORE,"readwrite"),st=t.objectStore(STORE);for(const x of rows)st.put(x);t.oncomplete=res;t.onerror=()=>rej(t.error)});db.close();s.xtreamLoaded=s.xtreamLoaded||{live:false,movie:false,series:false};s.xtreamLoaded[type]=true}
    const norm=v=>String(v??"").normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
    const build=(rows,type)=>rows.map(r=>{const id=r?.stream_id??r?.series_id??r?.id;if(id==null||!r?.name)return null;const name=String(r.name).trim();if(type==="live")return{id:"xt-live-"+id,name,nameLower:norm(name),group:"TV AO VIVO",type:"live",url:session.base+"/live/"+encodeURIComponent(session.username)+"/"+encodeURIComponent(session.password)+"/"+id+".ts",logo:r.stream_icon||"",seriesName:"",seriesKey:"",season:null,episode:null,seriesSeason:["",0],genre:"",xtreamKind:"live",xtreamStreamId:String(id),xtreamExtension:"ts",epgChannelId:r.epg_channel_id||""};if(type==="movie"){const ext=String(r.container_extension||"mp4").replace(/^\\./,"");return{id:"xt-movie-"+id,name,nameLower:norm(name),group:"FILMES",type:"movie",url:session.base+"/movie/"+encodeURIComponent(session.username)+"/"+encodeURIComponent(session.password)+"/"+id+"."+ext,logo:r.stream_icon||"",seriesName:"",seriesKey:"",season:null,episode:null,seriesSeason:["",0],genre:r.genre||"",xtreamKind:"movie",xtreamStreamId:String(id),xtreamExtension:ext};}const key=norm(name);return{id:"xt-series-"+id,name,nameLower:key,group:"SÉRIES",type:"series",url:"",logo:r.cover||"",seriesName:name,seriesKey:key,season:null,episode:null,seriesSeason:["",0],genre:r.genre||"",xtreamKind:"series",xtreamSeriesId:String(id)}}).filter(Boolean);
    const live=build(await get("get_live_streams"),"live"),movies=build(await get("get_vod_streams"),"movie"),series=build(await get("get_series"),"series");await write([...live,...movies,...series],"live");s.items=[...live,...movies,...series].slice(0,4000);s.counts={live:live.length,movie:movies.length,series:series.length};s.total=live.length+movies.length+series.length;await app.render();return true;
  }
  window.GC_PLAY_PRO_CATALOG_RECOVER=recover;
})();
