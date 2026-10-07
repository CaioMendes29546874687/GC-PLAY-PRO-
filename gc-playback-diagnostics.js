/* GC PLAY PRO — PLAYBACK INSPECTOR 2026-10-06 */
(function(){
"use strict";
const V="20261007-INSPECTOR13";
const stages=[];
let session=null;

function safeUrl(u){
  try{
    const x=new URL(String(u||""));
    let path=x.pathname.replace(/\/+/g,"/");
    /* Não expor tokens de acesso que alguns provedores colocam no caminho. */
    path=path.replace(/(\/play\/)[^/]+/i,"$1***");
    path=path.replace(/(\/live\/)[^/]+\/[^/]+\/[^/]+/i,"$1***");
    return x.protocol+"//"+x.host+path;
  }catch{return String(u||"").slice(0,160).replace(/\/play\/[^/\s]+/ig,"/play/***");}
}
function classify(item){
  const u=String(item?.url||"").trim().toLowerCase();
  const type=String(item?.type||"").toLowerCase();
  const xt=String(item?.xtreamKind||"").toLowerCase();
  const live=type==="live"||xt==="live"||/\/live\/|\/channel\/|\/stream\/|\/tv\//.test(u);
  if(/(?:\.m3u8|\/m3u8)(?:$|[?#])/.test(u)||/[?&]format=m3u8(?:$|&)/.test(u)) return {plan:"HLS",engine:"HLS.js",fallback:"MPEG-TS",reason:"manifesto HLS"};
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
async function probeSource(url,kind){
  if(!session||!url)return;
  const target=String(url);
  const started=performance.now();
  add("03 • TESTE DE REDE","TRY","Testando a fonte antes de concluir falha...",{source:safeUrl(target)});
  const ctrl=new AbortController(), timer=setTimeout(()=>ctrl.abort(),5000);
  try{
    const headers={};
    if(/^VOD /.test(kind)) headers.Range="bytes=0-1023";
    const r=await fetch(target,{method:"GET",headers,cache:"no-store",credentials:"omit",signal:ctrl.signal});
    const ct=r.headers.get("content-type")||"";
    const cl=r.headers.get("content-length")||"";
    let sample="";
    try{sample=new TextDecoder().decode((await r.arrayBuffer()).slice(0,2048));}catch{}
    const looksManifest=/#EXTM3U|#EXTINF/i.test(sample);
    const looksVideo=/^video\//i.test(ct)||/mp4|mpeg|webm|matroska|octet-stream/i.test(ct);
    const looksHtml=/<!doctype html|<html|access denied|cloudflare|forbidden/i.test(sample);
    let status="OK", verdict="FONTE RESPONDE";
    if(r.status>=400){status="FAIL";verdict="HTTP "+r.status+" — servidor recusou a mídia";}
    else if(looksHtml){status="FAIL";verdict="Servidor devolveu HTML/erro em vez de mídia";}
    else if(/^VOD /.test(kind)&&!looksVideo){status="WARN";verdict="Content-Type não parece vídeo";}
    else if(/^LIVE/.test(kind)&&!looksManifest&&!looksVideo){status="WARN";verdict="Resposta não identificada como HLS ou vídeo";}
    add("03 • RESPOSTA DA FONTE",status,verdict+" • HTTP "+r.status+" • "+(ct||"Content-Type ausente"),{elapsed_ms:Math.round(performance.now()-started),content_type:ct,content_length:cl});
  }catch(e){
    add("03 • RESPOSTA DA FONTE","FAIL",e?.name==="AbortError"?"Timeout de 5s ao consultar a fonte.":"Falha de rede: "+(e?.message||e),{elapsed_ms:Math.round(performance.now()-started)});
  }finally{clearTimeout(timer)}
}
function event(name,data={}){
  if(!session) return;
  const elapsed=Math.round(performance.now()-session.started);
  const map={
    native_start:["03 • MOTOR NATIVO","TRY","Android Media3/ExoPlayer recebeu a mídia."],
    nativePlaying:["04 • PRIMEIRO FRAME","OK","ExoPlayer confirmou reprodução."],
    nativeError:["04 • MOTOR NATIVO","FAIL","ExoPlayer informou erro."],
    nativeTimeout:["04 • MOTOR NATIVO","FAIL","ExoPlayer não confirmou primeiro frame dentro do limite; fallback necessário."],
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
function fullReport(){
  return JSON.stringify({
    inspector_version:V,
    generated_at:new Date().toISOString(),
    session:session?{
      id:session.id,name:session.name,type:session.type,
      elapsed_ms:Math.round(performance.now()-session.started),
      plan:session.plan,
      source:safeUrl(session.item?.url)
    }:null,
    environment:{
      online:navigator.onLine,
      user_agent:navigator.userAgent,
      platform:navigator.platform||"",
      language:navigator.language||"",
      screen:innerWidth+"x"+innerHeight,
      device_pixel_ratio:devicePixelRatio
    },
    stages:stages.map(x=>({...x}))
  },null,2);
}
function textReport(){
  if(!session)return "GC PLAYBACK INSPECTOR\\nNenhuma sessão de reprodução.";
  const lines=[
    "GC PLAYBACK INSPECTOR — "+V,
    "GERADO: "+new Date().toISOString(),
    "CONTEÚDO: "+session.name,
    "TIPO: "+session.type,
    "PLANO: "+session.plan.plan+" → "+session.plan.engine,
    "FALLBACK: "+session.plan.fallback,
    "FONTE: "+safeUrl(session.item?.url),
    "ONLINE: "+navigator.onLine,
    "UA: "+navigator.userAgent,
    "",
    "===== ETAPAS ====="
  ];
  stages.forEach((x,i)=>lines.push(
    String(i+1).padStart(2,"0")+" | "+x.status+" | "+x.stage+" | "+x.detail+
    (x.elapsed_ms!=null?" | "+x.elapsed_ms+" ms":"")+
    (x.content_type?" | Content-Type: "+x.content_type:"")+
    (x.content_length?" | Content-Length: "+x.content_length:"")
  ));
  return lines.join("\\n");
}
async function copyReport(){
  const txt=textReport();
  try{
    await navigator.clipboard.writeText(txt);
    toastDiag("✓ DIAGNÓSTICO COMPLETO COPIADO");
    return true;
  }catch{}
  try{
    const ta=document.createElement("textarea");
    ta.value=txt;ta.style.position="fixed";ta.style.opacity="0";
    document.body.appendChild(ta);ta.select();
    const ok=document.execCommand("copy");ta.remove();
    toastDiag(ok?"✓ DIAGNÓSTICO COMPLETO COPIADO":"Não foi possível copiar.");
    return ok;
  }catch{toastDiag("Não foi possível copiar.");return false}
}
function downloadReport(){
  const blob=new Blob([fullReport()],{type:"application/json;charset=utf-8"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="gc-playback-diagnostico-"+Date.now()+".json";
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1500);
}
function toastDiag(msg){
  let t=document.getElementById("gcDiagToast");
  if(!t){t=document.createElement("div");t.id="gcDiagToast";document.body.appendChild(t);}
  t.textContent=msg;t.style.cssText="position:fixed!important;left:50%!important;bottom:24px!important;transform:translateX(-50%)!important;z-index:2147483647!important;background:#06110a!important;color:#63ff9b!important;border:1px solid #39ff88!important;border-radius:10px!important;padding:10px 14px!important;font:900 12px Arial!important;box-shadow:0 10px 40px #000!important";
  clearTimeout(window.__gcDiagToastTimer);window.__gcDiagToastTimer=setTimeout(()=>t.remove(),2400);
}
function render(){
  const box=document.getElementById("gcPlaybackDiagnostics");
  if(!box||!session)return;
  const p=session.plan;
  box.innerHTML="<div class='gc-diag-head'><strong>GC PLAYBACK INSPECTOR</strong><span>"+p.plan+" • "+p.engine+"</span></div>"+
    "<div class='gc-diag-actions'><button type='button' id='gcDiagCopy'>📋 COPIAR COMPLETO</button><button type='button' id='gcDiagJson'>💾 JSON</button></div>"+
    stages.map((x,i)=>"<div class='gc-diag-row'><b>"+String(i+1).padStart(2,"0")+"</b><span class='gc-diag-status gc-"+x.status.toLowerCase()+"'>"+x.status+"</span><div><strong>"+x.stage+"</strong><small>"+x.detail+(x.elapsed_ms!=null?" • "+x.elapsed_ms+" ms":"")+(x.content_type?" • "+x.content_type:"")+"</small></div></div>").join("");
  document.getElementById("gcDiagCopy")?.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();copyReport()});
  document.getElementById("gcDiagJson")?.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();downloadReport()});
}
function pinUi(el){
  if(!el)return;
  el.classList.add("gc-playback-diagnostics");
  el.open=true;
  el.style.setProperty("position","fixed","important");
  el.style.setProperty("left","50%","important");
  el.style.setProperty("right","auto","important");
  el.style.setProperty("top","72px","important");
  el.style.setProperty("bottom","auto","important");
  el.style.setProperty("transform","translateX(-50%)","important");
  el.style.setProperty("width","min(620px, calc(100vw - 16px))","important");
  el.style.setProperty("max-height","42vh","important");
  el.style.setProperty("margin","0","important");
  el.style.setProperty("z-index","2147483647","important");
  el.style.setProperty("display","block","important");
  el.style.setProperty("overflow","hidden","important");
  el.style.setProperty("box-sizing","border-box","important");
}
function ensureUi(){
  let existing=document.getElementById("gcPlaybackDiagnostics");
  if(!existing){
    existing=document.createElement("details");
    existing.id="gcPlaybackDiagnostics";
    existing.innerHTML="<summary>🔎 DIAGNÓSTICO DO PLAYBACK</summary><div class='gc-diag-body'></div>";
    document.body.appendChild(existing);
    existing.querySelector("summary").addEventListener("click",()=>render());
  }else if(existing.parentElement!==document.body){
    document.body.appendChild(existing);
  }
  pinUi(existing);
  return existing;
}
function bindVideo(){
  const v=document.getElementById("videoPlayer"); if(!v||v.__gcInspectorBound)return;
  v.__gcInspectorBound=true;
  ["loadedmetadata","loadeddata","canplay","playing","waiting","stalled","error","emptied","abort","suspend"].forEach(e=>v.addEventListener(e,()=>{
    const er=v.error; event(e,{code:er?.code||"",detail:er?.message||"",src:safeUrl(v.currentSrc||v.src)});
  },true));
}
function install(){
  const ui=ensureUi();
  if(!window.__GC_INSPECTOR_RELOCATOR__){
    window.__GC_INSPECTOR_RELOCATOR__=new MutationObserver(()=>{const x=document.getElementById("gcPlaybackDiagnostics"); if(x) { if(x.parentElement!==document.body) document.body.appendChild(x); pinUi(x); }});
    window.__GC_INSPECTOR_RELOCATOR__.observe(document.documentElement,{childList:true,subtree:true});
  }
  bindVideo();
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
window.GCPlaybackInspector={version:V,classify,begin,event,probeSource,fullReport,textReport,copyReport,downloadReport,install,getSession:()=>session,getStages:()=>stages.slice()};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true}); else install();
setTimeout(install,500); setTimeout(install,2000);
})();