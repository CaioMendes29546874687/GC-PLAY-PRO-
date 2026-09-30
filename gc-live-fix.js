/* GC PLAY PRO — live fix 2026-09-30 */
(function(){
"use strict";
function load(src,ms){return new Promise((ok,no)=>{
 const s=document.createElement("script");s.src=src;s.async=true;let t=setTimeout(()=>{s.remove();no(Error("mpegts timeout"))},ms);
 s.onload=()=>{clearTimeout(t);window.mpegts?ok(window.mpegts):no(Error("mpegts indisponível"))};
 s.onerror=()=>{clearTimeout(t);no(Error("CDN mpegts falhou"))};document.head.appendChild(s);
})}
window.loadMpegTS=async function(){
 if(window.mpegts)return window.mpegts;
 let e;
 for(const u of ["https://cdn.jsdelivr.net/npm/mpegts.js@1.8.2/dist/mpegts.min.js","https://unpkg.com/mpegts.js@1.8.2/dist/mpegts.min.js"])
  try{const m=await load(u,7000);if(m&&m.isSupported())return m;e=Error("MSE não suportado")}catch(x){e=x}
 throw e||Error("mpegts indisponível")
};
async function run(m,v,u,msg,type){
 return new Promise(async(ok,no)=>{
  let good=false,done=false;
  const finish=(fn,x)=>{if(done)return;done=true;clearTimeout(t);v.removeEventListener("error",ve);fn(x)};
  const ve=()=>finish(no,Error("MEDIA_ERR_"+(v.error?.code||"UNKNOWN")+" código "+(v.error?.code||"")));
  v.addEventListener("error",ve,{once:true});
  let p;
  try{
   p=m.createPlayer({type,isLive:true,url:u,cors:true,hasAudio:true,hasVideo:true},{
    enableWorker:false,enableWorkerForMSE:false,enableStashBuffer:true,stashInitialSize:128*1024,
    lazyLoad:false,deferLoadAfterSourceOpen:false,liveBufferLatencyChasing:false,
    autoCleanupSourceBuffer:true,autoCleanupMaxBackwardDuration:20,autoCleanupMinBackwardDuration:8
   });
   state.mpegts=p;
   p.on(m.Events.MEDIA_INFO,i=>{good=true;console.log("[GC] MEDIA_INFO",i);if(msg)msg.textContent=""});
   p.on(m.Events.ERROR,(a,b,c)=>{console.warn("[GC] MPEGTS ERROR",a,b,c);if(/unsupported|format|codec|decode|media/i.test(String(b)))finish(no,Error("MPEGTS "+b))});
   p.attachMediaElement(v);p.load();try{await p.play()}catch{}
   var t=setTimeout(()=>{if(good||v.readyState>=2||v.videoWidth>0)finish(ok,p);else finish(no,Error("sem quadro de vídeo"))},4000);
  }catch(e){finish(no,e)}
 })
}
window.playMpegTS=async function(video,url,message,directFallbackUrl=""){
 if(!video)return;
 if(message)message.textContent="Preparando motor de TV ao vivo...";
 try{
  if(state.mpegts){try{state.mpegts.destroy()}catch{}state.mpegts=null}
  const m=await Promise.race([window.loadMpegTS(),new Promise((_,r)=>setTimeout(()=>r(Error("mpegts demorou demais")),9000))]);
  const f=typeof m.getFeatureList==="function"?m.getFeatureList():{};
  console.log("[GC] MPEGTS features",f);
  if(message)message.textContent=f.mseH265Playback?"Motor pronto • H.265 disponível":"Motor pronto • verificando formato...";
  const src=[url,directFallbackUrl].filter((x,i,a)=>x&&a.indexOf(x)===i);
  let last;
  for(const u of src)for(const type of ["mpegts","mse"]){
   try{
    if(state.mpegts){try{state.mpegts.destroy()}catch{}state.mpegts=null}
    if(message)message.textContent="Testando "+type+"...";
    await run(m,video,u,message,type);
    if(message)message.textContent="";
    return;
   }catch(e){last=e;console.warn("[GC] tentativa",type,u,e);try{if(state.mpegts)state.mpegts.destroy()}catch{}state.mpegts=null;try{video.removeAttribute("src");video.load()}catch{}}
  }
  throw last||Error("nenhuma rota funcionou");
 }catch(e){
  console.error("[GC] live final",e);
  if(message){
   message.textContent=/código 4|MEDIA_ERR_4|unsupported|codec|format/i.test(String(e))?
    "Formato do canal incompatível com o navegador (código 4).":
    "Não foi possível iniciar este canal.";
  }
  try{if(state.mpegts)state.mpegts.destroy()}catch{}state.mpegts=null;
 }
};
})();