/* GC M3U READ DIAGNOSTICS — leitura real da playlist, sem clonar o response.
 * Objetivo: descobrir exatamente onde o carregamento fica lento.
 * NÃO intercepta fetch e NÃO duplica o body da M3U.
 */
"use strict";
(function(){
  const KEY="GC_PLAY_PRO_M3U_READ_DIAG_V3";
  const MAX=240;
  const state={
    version:4, active:false, phase:"boot", source:"",
    startedAt:0, lastAt:0, bytes:0, chunks:0, items:0,
    firstItemMs:null, firstPaintMs:null, responseMs:null,
    parseMs:null, writeQueuedMs:null, finalizeMs:null,
    contentType:"", status:null, error:"",
    lastProgressAt:0, lastProgressItems:0, lastProgressBytes:0,
    events:[]
  };

  const now=()=>performance.now();
  const elapsed=()=>state.startedAt?Math.max(0,Math.round(now()-state.startedAt)):0;
  const emit=(type,data={})=>{
    const e={t:elapsed(),type,...data};
    state.events.push(e);
    if(state.events.length>MAX) state.events.shift();
    state.lastAt=now();
    try{localStorage.setItem(KEY,JSON.stringify({version:4,updatedAt:Date.now(),state:{...state,events:state.events}}))}catch{}
    try{window.dispatchEvent(new CustomEvent("gc-m3u-read-diagnostic",{detail:e}))}catch{}
  };
  const phase=(name,data={})=>{
    state.phase=name;
    emit("phase",{phase:name,...data});
    render();
  };
  const activation=(phaseName,data={})=>{
    if(!state.startedAt) state.startedAt=now();
    state.active=true;
    phase(String(phaseName||"activation"),data);
    return snapshot();
  };

  const start=(source,meta={})=>{
    Object.assign(state,{
      active:true,phase:"starting",source:String(source||"").slice(0,600),
      startedAt:now(),lastAt:now(),bytes:0,chunks:0,items:0,
      firstItemMs:null,firstPaintMs:null,responseMs:null,
      parseMs:null,writeQueuedMs:null,finalizeMs:null,
      contentType:"",status:null,error:"",events:[]
    });
    emit("start",{source:state.source,...meta});
    render();
  };
  const response=(data={})=>{
    if(state.responseMs==null) state.responseMs=elapsed();
    state.status=data.status??state.status;
    state.contentType=data.contentType||state.contentType;
    emit("response",{...data,elapsedMs:state.responseMs});
    render();
  };
  const chunk=(bytes)=>{
    const n=Number(bytes)||0;
    state.bytes+=n; state.chunks++;
    if(state.chunks===1) emit("first_chunk",{bytes:n});
    const t=now();
    if(t-state.lastProgressAt>=350){
      state.lastProgressAt=t;
      emit("network_progress",{bytes:state.bytes,chunks:state.chunks,items:state.items});
      render();
    }
  };
  const itemProgress=(count)=>{
    const n=Number(count)||0;
    state.items=n;
    if(state.firstItemMs==null && n>0){
      state.firstItemMs=elapsed();
      emit("first_item",{items:n,elapsedMs:state.firstItemMs});
    }
    const t=now();
    if(t-state.lastProgressAt>=350 || n-state.lastProgressItems>=1000){
      state.lastProgressAt=t; state.lastProgressItems=n;
      emit("parse_progress",{items:n,bytes:state.bytes});
      render();
    }
  };
  const firstPaint=()=>{
    if(state.firstPaintMs==null){
      state.firstPaintMs=elapsed();
      emit("first_paint",{elapsedMs:state.firstPaintMs,items:state.items});
      render();
    }
  };
  const write=(data={})=>{
    state.writeQueuedMs=elapsed();
    emit("write_queue",{elapsedMs:state.writeQueuedMs,...data});
    render();
  };
  const finish=(data={})=>{
    state.active=false; state.phase="done";
    state.items=Number(data.items??state.items);
    state.bytes=Number(data.bytes??state.bytes);
    state.finalizeMs=elapsed();
    emit("finish",{elapsedMs:state.finalizeMs,items:state.items,bytes:state.bytes,...data});
    render();
  };
  const fail=(error,data={})=>{
    state.active=false; state.phase="error";
    state.error=String(error?.message||error||"erro desconhecido");
    emit("error",{elapsedMs:elapsed(),error:state.error,...data});
    render();
  };

  function formatBytes(n){
    n=Number(n)||0;
    if(n<1024)return n+" B";
    if(n<1048576)return (n/1024).toFixed(1)+" KB";
    if(n<1073741824)return (n/1048576).toFixed(2)+" MB";
    return (n/1073741824).toFixed(2)+" GB";
  }
  function formatMs(ms){
    if(ms==null)return "—";
    ms=Number(ms)||0;
    return ms<1000?ms+" ms":(ms/1000).toFixed(1)+" s";
  }
  function rate(){
    const sec=Math.max(.001,elapsed()/1000);
    return state.bytes/sec;
  }
  function bottleneck(){
    if(state.error)return "ERRO DURANTE A LEITURA";
    if(state.phase==="starting" || state.phase==="fetch_start" || state.phase==="connecting")
      return "CONEXÃO / ORIGEM";
    if(state.phase==="response_wait")
      return "TTFB / SERVIDOR / PROXY";
    if(state.responseMs!=null && state.firstItemMs==null && elapsed()>1500)
      return "PARSER — nenhum item reconhecido";
    if(state.firstPaintMs==null && state.items>0 && elapsed()>2500)
      return "PRIMEIRA PINTURA / INDEXAÇÃO";
    if(state.phase==="finalizing")
      return "INDEXAÇÃO / GRAVAÇÃO";
    if(state.phase==="done")return "SEM GARGALO CRÍTICO";
    return "PROCESSAMENTO M3U";
  }
  function snapshot(){
    return {
      ...state,
      elapsedMs:elapsed(),
      bytesPerSecond:Math.round(rate()),
      bytesFormatted:formatBytes(state.bytes),
      bottleneck:bottleneck(),
      device:{
        online:navigator.onLine,
        ua:navigator.userAgent,
        memory:navigator.deviceMemory||null,
        connection:navigator.connection?{
          effectiveType:navigator.connection.effectiveType||"",
          downlink:navigator.connection.downlink||null,
          rtt:navigator.connection.rtt||null,
          saveData:!!navigator.connection.saveData
        }:null
      }
    };
  }

  let box=null;
  function ensureUI(){
    if(box||!document.body)return;
    const style=document.createElement("style");
    style.textContent=`
      #gcM3UDiag{position:fixed;right:14px;bottom:74px;width:min(470px,calc(100vw - 28px));z-index:999998;background:rgba(2,8,5,.98);border:1px solid rgba(57,255,136,.55);border-radius:16px;box-shadow:0 20px 80px #000;color:#eafff1;font:12px Arial,sans-serif;overflow:hidden}
      #gcM3UDiag .m3h{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:rgba(57,255,136,.08);color:#67ff9e;font-weight:900;letter-spacing:.7px}
      #gcM3UDiag .m3b{padding:11px;max-height:58vh;overflow:auto}
      #gcM3UDiag .m3grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:9px}
      #gcM3UDiag .m3card{padding:8px;border:1px solid rgba(255,255,255,.08);border-radius:9px;background:rgba(255,255,255,.025)}
      #gcM3UDiag .m3k{display:block;color:#789487;font-size:9px;letter-spacing:.7px;margin-bottom:3px}
      #gcM3UDiag .m3v{font-weight:800;color:#eafff1;word-break:break-word}
      #gcM3UDiag .m3ok{color:#63ff9b}.m3warn{color:#ffd166}.m3err{color:#ff7070}
      #gcM3UDiag .m3bar{height:5px;background:#102018;border-radius:8px;overflow:hidden;margin:8px 0}
      #gcM3UDiag .m3fill{height:100%;width:0;background:#39ff88;transition:width .2s}
      #gcM3UDiag .m3foot{display:flex;gap:6px;justify-content:flex-end}
      #gcM3UDiag button{background:#07140c;color:#9dffbe;border:1px solid rgba(57,255,136,.3);border-radius:8px;padding:6px 9px}
      @media(max-width:600px){#gcM3UDiag{right:7px;bottom:68px;width:calc(100vw - 14px)}}
    `;
    document.head.appendChild(style);
    box=document.createElement("aside");box.id="gcM3UDiag";
    box.innerHTML=`<div class="m3h"><span>⚡ DIAGNÓSTICO DE LEITURA M3U</span><button id="gcM3Close">×</button></div><div class="m3b" id="gcM3Body"></div>`;
    document.body.appendChild(box);
    box.querySelector("#gcM3Close").onclick=()=>{box.remove();box=null};
  }
  function render(){
    if(!state.active && state.phase==="idle")return;
    ensureUI();
    const s=snapshot(), body=box?.querySelector("#gcM3Body");
    if(!body)return;
    const statusClass=state.error?"m3err":state.phase==="done"?"m3ok":"m3warn";
    body.innerHTML=`
      <div class="m3grid">
        <div class="m3card"><span class="m3k">FASE ATUAL</span><span class="m3v ${statusClass}">${String(state.phase).toUpperCase()}</span></div>
        <div class="m3card"><span class="m3k">GARGALO PROVÁVEL</span><span class="m3v">${bottleneck()}</span></div>
        <div class="m3card"><span class="m3k">TEMPO</span><span class="m3v">${formatMs(s.elapsedMs)}</span></div>
        <div class="m3card"><span class="m3k">ITENS LIDOS</span><span class="m3v">${state.items.toLocaleString("pt-BR")}</span></div>
        <div class="m3card"><span class="m3k">DADOS RECEBIDOS</span><span class="m3v">${formatBytes(state.bytes)}</span></div>
        <div class="m3card"><span class="m3k">VELOCIDADE</span><span class="m3v">${formatBytes(s.bytesPerSecond)}/s</span></div>
        <div class="m3card"><span class="m3k">1º ITEM</span><span class="m3v">${formatMs(state.firstItemMs)}</span></div>
        <div class="m3card"><span class="m3k">1ª EXIBIÇÃO</span><span class="m3v">${formatMs(state.firstPaintMs)}</span></div>
      </div>
      <div class="m3bar"><div class="m3fill" style="width:${Math.min(100,Math.max(4,state.firstPaintMs?100:Math.min(96,(state.items/5000)*100)))}%"></div></div>
      <div class="m3card"><span class="m3k">ORIGEM</span><span class="m3v">${state.source||"—"}</span></div>
      <div class="m3card" style="margin-top:7px"><span class="m3k">HTTP / CONTENT-TYPE</span><span class="m3v">${state.status??"—"} / ${state.contentType||"—"}</span></div>
      ${state.error?`<div class="m3card m3err" style="margin-top:7px"><span class="m3k">ERRO</span><span class="m3v">${state.error}</span></div>`:""}
      <div class="m3foot" style="margin-top:9px"><button id="gcM3Copy">COPIAR RELATÓRIO</button><button id="gcM3Clear">LIMPAR</button></div>
    `;
    body.querySelector("#gcM3Copy").onclick=async()=>{
      const report=JSON.stringify(snapshot(),null,2);
      try{await navigator.clipboard.writeText(report);body.querySelector("#gcM3Copy").textContent="COPIADO ✓"}catch{console.log("[GC M3U DIAG REPORT]",report);body.querySelector("#gcM3Copy").textContent="VEJA O CONSOLE"}
    };
    body.querySelector("#gcM3Clear").onclick=()=>clear();
  }
  function clear(){
    state.active=false;state.phase="idle";state.events=[];
    try{localStorage.removeItem(KEY)}catch{}
    if(box){box.remove();box=null}
  }

  window.GCListDiagnostics={start,phase,activation,response,chunk,itemProgress,firstPaint,write,finish,fail,getState:snapshot,getReport:snapshot,clear};
  window.GCM3UReadDiagnostics=window.GCListDiagnostics;
  // Abre automaticamente na inicialização para mostrar o caminho completo da lista.
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",()=>{ensureUI();activation("boot",{message:"Aguardando ativação e origem da lista..."});},{once:true});
  else {ensureUI();activation("boot",{message:"Aguardando ativação e origem da lista..."});}
  window.addEventListener("gc-m3u-read-diagnostic",render);
})();
