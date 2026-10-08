/* GC PLAY PRO — M3U READ DIAGNOSTICS v6 SILENT
   Não intercepta fetch e não clona Response.
   Mede o carregador real através dos hooks do app.js. */
(function(){
  "use strict";
  var KEY="GC_PLAY_PRO_M3U_READ_DIAG_V5";
  var s={
    version:6,active:true,phase:"boot",source:"",startedAt:0,lastAt:0,
    bytes:0,chunks:0,items:0,firstItemMs:null,firstPaintMs:null,
    responseMs:null,writeQueuedMs:null,finalizeMs:null,contentType:"",
    status:null,error:"",counts:{live:0,movie:0,series:0,total:0},
    activationReadyAt:0,autoLoadAt:0,handoffDelayMs:null,events:[]
  };
  var box=null, lastUi=0, lastSave=0;
  function t(){return performance.now();}
  function elapsed(){return s.startedAt?Math.max(0,Math.round(t()-s.startedAt)):0;}
  function save(force){
  var n=Date.now();
  if(!force && n-lastSave<1200)return;
  lastSave=n;
  try{localStorage.setItem(KEY,JSON.stringify({version:6,updatedAt:n,state:s}));}catch(e){}
}
function ui(force){
  var n=t();
  if(!force && n-lastUi<350)return;
  lastUi=n;
  render();
}
  function event(type,data){
    var e=Object.assign({t:elapsed(),type:type},data||{});
    s.events.push(e); if(s.events.length>300)s.events.shift(); s.lastAt=t(); save(false);
    try{window.dispatchEvent(new CustomEvent("gc-m3u-read-diagnostic",{detail:e}));}catch(e){}
  }
  function phase(name,data){
    s.phase=String(name||"unknown"); event("phase",Object.assign({phase:s.phase},data||{})); ui(true);
  }
  function activation(name,data){
    if(!s.startedAt)s.startedAt=t();
    if(name==="activation_ready")s.activationReadyAt=t();
    if(name==="auto_load_start"){s.autoLoadAt=t();s.handoffDelayMs=s.activationReadyAt?Math.max(0,Math.round(s.autoLoadAt-s.activationReadyAt)):null;}
    phase(name,data); return report();
  }
  function start(source,meta){
    s.active=true;s.phase="starting";s.source=String(source||"").slice(0,1000);s.startedAt=t();
    s.lastAt=t();s.bytes=0;s.chunks=0;s.items=0;s.firstItemMs=null;s.firstPaintMs=null;
    s.responseMs=null;s.writeQueuedMs=null;s.finalizeMs=null;s.contentType="";s.status=null;s.error="";s.events=[];
    event("start",Object.assign({source:s.source},meta||{}));save(true);ui(true);
  }
  function response(data){
    if(s.responseMs===null)s.responseMs=elapsed();
    s.status=data&&data.status!=null?data.status:s.status;
    s.contentType=data&&data.contentType||s.contentType; event("response",data||{}); save(true); ui(true);
  }
  function chunk(n){
  n=Number(n)||0;s.bytes+=n;s.chunks++;
  if(s.chunks===1 || t()-lastUi>=350) { event("chunk",{bytes:n,totalBytes:s.bytes,chunks:s.chunks}); ui(true); }
}
  function itemProgress(n){
  n=Number(n)||0;s.items=n;
  if(n>0&&s.firstItemMs===null)s.firstItemMs=elapsed();
  if(n===1 || n%1000===0 || t()-lastUi>=350){
    event("items",{items:n,bytes:s.bytes}); ui(true);
  }
}
  function firstPaint(){if(s.firstPaintMs===null)s.firstPaintMs=elapsed();event("first_paint",{elapsedMs:s.firstPaintMs,items:s.items});save(true);ui(true);}
  function write(data){s.writeQueuedMs=elapsed();event("write_queue",Object.assign({elapsedMs:s.writeQueuedMs},data||{}));ui(true);}
  function finish(data){
    data=data||{};s.active=false;s.phase="done";
    if(data.items!=null)s.items=Number(data.items)||0;if(data.bytes!=null)s.bytes=Number(data.bytes)||0;
    s.finalizeMs=elapsed();event("finish",Object.assign({elapsedMs:s.finalizeMs,items:s.items,bytes:s.bytes},data));save(true);ui(true);
  }
  function fail(err,data){
    s.active=false;s.phase="error";s.error=String(err&&err.message||err||"erro desconhecido");
    event("error",Object.assign({error:s.error,elapsedMs:elapsed()},data||{}));save(true);ui(true);
  }
  function catalogProgress(data){
    data=data||{};
    s.counts={
      live:Number(data.live!=null?data.live:s.counts.live)||0,
      movie:Number(data.movie!=null?data.movie:s.counts.movie)||0,
      series:Number(data.series!=null?data.series:s.counts.series)||0,
      total:Number(data.total!=null?data.total:s.counts.total)||0
    };
    event("catalog_progress",{counts:Object.assign({},s.counts),message:data.message||"Contadores da interface"});ui(false);
  }
  function bytes(n){
    n=Number(n)||0;if(n<1024)return n+" B";if(n<1048576)return (n/1024).toFixed(1)+" KB";
    if(n<1073741824)return (n/1048576).toFixed(2)+" MB";return (n/1073741824).toFixed(2)+" GB";
  }
  function ms(n){if(n==null)return "—";n=Number(n)||0;return n<1000?n+" ms":(n/1000).toFixed(1)+" s";}
  function bottleneck(){
    if(s.error)return "ERRO";if(s.phase==="connecting"||s.phase==="fetch_start")return "CONEXÃO / ORIGEM";
    if(s.phase==="response_wait")return "SERVIDOR / TTFB";
    if(s.phase==="streaming")return "DOWNLOAD / LEITURA";
    if(s.phase==="finalizing")return "INDEXAÇÃO / GRAVAÇÃO";
    if(s.phase==="done")return "SEM GARGALO CRÍTICO";
    return "CARREGAMENTO / PROCESSAMENTO";
  }
  function report(){
    return {version:6,active:s.active,phase:s.phase,source:s.source,startedAt:s.startedAt,lastAt:s.lastAt,
      bytes:s.bytes,chunks:s.chunks,items:s.items,firstItemMs:s.firstItemMs,firstPaintMs:s.firstPaintMs,
      responseMs:s.responseMs,writeQueuedMs:s.writeQueuedMs,finalizeMs:s.finalizeMs,contentType:s.contentType,
      status:s.status,error:s.error,counts:Object.assign({},s.counts),events:s.events.slice(),
      elapsedMs:elapsed(),bytesPerSecond:Math.round(s.bytes/Math.max(.001,elapsed()/1000)),
      bottleneck:bottleneck(),handoffDelayMs:s.handoffDelayMs};
  }
  /* Modo silencioso: o diagnóstico continua coletando métricas e telemetria,
     mas nenhuma janela/painel técnico é exibido ao usuário. */
  function ensure(){}
  function render(){}
  window.GCListDiagnostics={start:start,phase:phase,activation:activation,catalogProgress:catalogProgress,response:response,chunk:chunk,itemProgress:itemProgress,firstPaint:firstPaint,write:write,finish:finish,fail:fail,getState:report,getReport:report};
  window.GCM3UReadDiagnostics=window.GCListDiagnostics;
  function boot(){activation("boot",{message:"Diagnóstico interno iniciado."});}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();