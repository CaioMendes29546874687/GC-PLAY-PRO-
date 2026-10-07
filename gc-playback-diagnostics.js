/* GC PLAY PRO — PLAYBACK INSPECTOR 2026-10-06 */
(function(){
"use strict";
const V="20261006-INSPECTOR1";
const stages=[];
let session=null;

function safeUrl(u){
  try{ const x=new URL(String(u||"")); return x.protocol+"//"+x.host+x.pathname.replace(/\/+/g,"/"); }catch{return String(u||"").slice(0,160);}
}
function classify(item){
  const u=String(item?.url||"").trim().toLowerCase();
  const type=String(item?.type||"").toLowerCase();
  const xt=String(item?.xtreamKind||"").toLowerCase();
  const live=type==="live"||xt==="live"||/\/live\/|\/channel\/|\/stream\/|\/tv\//.test(u);
  if(/\.m3u8(?:$|[?#])/.test(u)) return {plan:"HLS",engine:"HLS.js",fallback:"MPEG-TS",reason:"manifesto HLS"};
  if(/\.mpd(?:$|[?#])|manifest\.mpd/.test(u)) return {plan:"DASH/CMAF",engine:"Shaka Player",fallback:"HLS/DASH alternativo",reason:"manifesto MPEG-DASH"};
  if(live && /\.(ts|m2ts|mpeg|mpg)(?:$|[?#])/.test(u)) return {plan:"LIVE MPEG-TS",engine:"mpegts.js",fallback:"HLS",reason:"transporte TS ao vivo"};
  if(live) return {plan:"LIVE",engine:"HLS.js → mpegts.js",fallback:"URL direta",reason:"rota de transmissão ao vivo"};
  if(/\.(mp4|m4v)(?:$|[?#])/.test(u)) return {plan:"VOD MP4",engine:"HTML5 video",fallback:"Gateway GC",reason:"arquivo MP4"};
  if(/\.(webm)(?:$|[?#])/.test(u)) return {plan:"VOD WEBM",engine:"HTML5 video",fallback:"Gateway GC",reason:"arquivo WebM"};
  if(/\.(mkv|avi|mov|wmv|flv)(?:$|[?#])/.test(u)) return {plan:"VOD CONTAINER",engine:"native/Media3",fallback:"VLC/Media3",reason:"container que pode exigir motor nativo"};
  return {plan:"UNKNOWN",engine:"probe → HTML5/Media3",fallback:"HLS/TS quando aplicável",reason:"extensão não conclusiva"};
}
function add(stage,status,detail,extra={}){
  const row={time:new Date().toISOString(),stage,status,detail,...extra};
  stages.push(row);
  if(stages.length>80) stages.shift();
  render();
  return row;
}
function begin(item){
  session={id:String(item?.id||item?.name||Date.now()),name:String(item?.name||"Conteúdo"),type:String(item?.type||"unknown"),started:performance.now(),item};
  stages.length=0;
  const p=classify(item);
  session.plan=p;
  add("01 • IDENTIFICAÇÃO","OK",p.plan+" → "+p.engine,{plan:p,source:safeUrl(item?.url)});
  if(!item?.url) add("02 • URL","FAIL","Conteúdo sem URL de reprodução.");
  else if(!/^https?:\/\//i.test(String(item.url))) add("02 • URL","WARN","URL não é HTTP/HTTPS; navegador pode não suportar.",{source:safeUrl(item.url)});
  else add("02 • URL","OK","URL HTTP(S) válida.",{source:safeUrl(item.url)});
  return p;
}
function event(name,data={}){
  if(!session) return;
  const elapsed=Math.round(performance.now()-session.started);
  const map={
    native_start:["03 • MOTOR NATIVO","TRY","Android Media3/ExoPlayer recebeu a mídia."],
    nativePlaying:["04 • PRIMEIRO FRAME","OK","ExoPlayer confirmou reprodução."],
    nativeError:["04 • MOTOR NATIVO","FAIL","ExoPlayer informou erro."],\n    nativeTimeout:["04 • MOTOR NATIVO","FAIL","ExoPlayer não confirmou primeiro frame dentro do limite; fallback necessário."],
    waiting:["04 • BUFFER","WAIT","Vídeo aguardando dados."],
    stalled:["04 • REDE","WARN","Fluxo parou temporariamente."],
    loadedmetadata:["04 • METADATA","OK","Metadata do vídeo recebida."],
    loadeddata:["05 • PRIMEIRO FRAME","OK","Primeiro frame disponível."],
    canplay:["05 • DECODIFICAÇÃO","OK","Navegador informou que pode reproduzir."],
    playing:["06 • REPRODUÇÃO","OK","Playback efetivamente iniciado."],
    error:["06 • REPRODUÇÃO","FAIL","HTML5 MediaError detectado."]
  };
  const m=map[name]||["EVENTO","INFO",name];
  add(m[0],m[1],m[2],{elapsed_ms:elapsed,error_code:data.code||"",detail:data.detail||""});
}
function render(){
  const box=document.getElementById("gcPlaybackDiagnostics");
  if(!box||!session)return;
  const p=session.plan;
  box.innerHTML="<div class='gc-diag-head'><strong>GC PLAYBACK INSPECTOR</strong><span>"+p.plan+" • "+p.engine+"</span></div>"+
    stages.map((x,i)=>"<div class='gc-diag-row'><b>"+String(i+1).padStart(2,"0")+"</b><span class='gc-diag-status gc-"+x.status.toLowerCase()+"'>"+x.status+"</span><div><strong>"+x.stage+"</strong><small>"+x.detail+(x.elapsed_ms!=null?" • "+x.elapsed_ms+" ms":"")+"</small></div></div>").join("");
}
function ensureUi(){
  if(document.getElementById("gcPlaybackDiagnostics"))return;
  const panel=document.getElementById("playerPanel"); if(!panel)return;
  const wrap=document.createElement("details"); wrap.id="gcPlaybackDiagnostics"; wrap.className="gc-playback-diagnostics";
  wrap.innerHTML="<summary>🔎 DIAGNÓSTICO DO PLAYBACK</summary><div class='gc-diag-body'></div>";
  panel.appendChild(wrap);
  wrap.querySelector("summary").addEventListener("click",()=>render());
}
function bindVideo(){
  const v=document.getElementById("videoPlayer"); if(!v||v.__gcInspectorBound)return;
  v.__gcInspectorBound=true;
  ["loadedmetadata","loadeddata","canplay","playing","waiting","stalled","error","emptied","abort","suspend"].forEach(e=>v.addEventListener(e,()=>{
    const er=v.error; event(e,{code:er?.code||"",detail:er?.message||"",src:safeUrl(v.currentSrc||v.src)});
  },true));
}
function install(){
  ensureUi(); bindVideo();
  window.addEventListener("gc-native-player",e=>{
    const d=e.detail||{};
    if(d.event==="nativePlaying")event("nativePlaying",{detail:d.value});
    else if(d.event==="nativeError")event("nativeError",{detail:d.value});
  });
  const api=window.GC_PLAY_PRO;
  if(api?.playItem && !api.playItem.__gcInspectorWrapped){
    const original=api.playItem;
    const wrapped=async function(item){
      ensureUi(); bindVideo();
      begin(item);
      const plan=session.plan;
      add("03 • SELEÇÃO DO MOTOR","OK","Motor selecionado: "+plan.engine+"; fallback: "+plan.fallback);
      try{
        const result=await original.apply(this,arguments);
        add("03 • RETORNO DO MOTOR","OK","Fluxo de reprodução entregue ao motor.");
        return result;
      }catch(e){
        add("03 • RETORNO DO MOTOR","FAIL",String(e?.message||e));
        throw e;
      }
    };
    wrapped.__gcInspectorWrapped=true;
    api.playItem=wrapped;
  }
}
window.GCPlaybackInspector={version:V,classify,begin,event,install,getSession:()=>session,getStages:()=>stages.slice()};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true}); else install();
setTimeout(install,500); setTimeout(install,2000);
})();