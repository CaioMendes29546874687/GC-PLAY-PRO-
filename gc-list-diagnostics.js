/* GC LIST DIAGNOSTICS — mede somente a leitura/carregamento da playlist. */
"use strict";
(function(){
  const KEY="GC_PLAY_PRO_LIST_DIAG_V1";
  const MAX=120;
  const state={startedAt:0,last:0,events:[],source:"",phase:"idle",processed:0,bytes:0};
  function now(){return Math.round(performance.now());}
  function push(type,extra={}){
    const e={t:now(),type,...extra};
    state.events.push(e);
    if(state.events.length>MAX) state.events.shift();
    state.last=e.t;
    try{localStorage.setItem(KEY,JSON.stringify({version:1,updatedAt:Date.now(),events:state.events}));}catch{}
    try{window.GCArchitecture?.diagnostics?.record?.("playlist_"+type,e);}catch{}
    try{window.dispatchEvent(new CustomEvent("gc-list-diagnostic",{detail:e}));}catch{}
  }
  function start(source,meta={}){
    state.startedAt=now();state.source=String(source||"");state.phase="fetch";state.processed=0;state.bytes=0;
    push("start",{source:state.source.slice(0,500),...meta});
  }
  function phase(name,extra={}){state.phase=name;push("phase",{phase:name,...extra});}
  function progress(extra={}){state.processed=Number(extra.processed||state.processed);state.bytes=Number(extra.bytes||state.bytes);push("progress",{processed:state.processed,bytes:state.bytes,...extra});}
  function finish(extra={}){state.phase="done";push("finish",{elapsedMs:Math.max(0,now()-state.startedAt),processed:state.processed,bytes:state.bytes,...extra});}
  function fail(error,extra={}){state.phase="error";push("error",{elapsedMs:Math.max(0,now()-state.startedAt),error:String(error?.message||error||"unknown"),...extra});}
  window.GCListDiagnostics={start,phase,progress,finish,fail,getState:()=>({...state,events:[...state.events]})};
  window.addEventListener("error",e=>{if(state.phase!=="idle") fail(e.error||e.message,{kind:"window"});});
  window.addEventListener("unhandledrejection",e=>{if(state.phase!=="idle") fail(e.reason,{kind:"promise"});});
})();