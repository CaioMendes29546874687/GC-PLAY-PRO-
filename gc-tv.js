"use strict";(()=>{const API="https://gc-play-pro-backend.onrender.com",KEY="GC_PLAY_PRO_ACTIVATION_V1",DK="GC_PLAY_PRO_DEVICE_ID",$=id=>document.getElementById(id),msg=(t,b)=>{const e=$("gcTvActivationMessage");if(e){e.textContent=t;e.style.color=b?"#ff7188":"#9db2a4"}};const jid=()=>{let x=localStorage.getItem(DK);if(!x){x=crypto.randomUUID?.()||"gc-tv-"+Date.now()+"-"+Math.random();localStorage.setItem(DK,x)}return x};async function api(path,body){const r=await fetch(API+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw Error(d.error||"Falha na comunicação com o servidor.");return d}function save(code,uid,d){const exp=d.expires_at||"";localStorage.setItem(KEY,JSON.stringify({active:true,activationCode:code,deviceUid:uid,deviceId:uid,expiresAt:exp,listId:d.list_id||"",listName:d.list_name||"GC PLAY PRO"}));if(d.playlist_url){localStorage.setItem("GC_PLAY_PRO_ACTIVATED_PLAYLIST_V1",d.playlist_url);localStorage.setItem("GC_PLAY_PRO_PLAYLIST_URL",d.playlist_url);localStorage.setItem("GC_PLAY_PRO_PLAYLIST_NAME",d.list_name||"GC PLAY PRO")}const v=$("gcTvValidity");if(v)v.textContent="VALIDADE: "+(exp?new Date(exp).toLocaleDateString("pt-BR"):"ATIVA")}async function load(){const u=localStorage.getItem("GC_PLAY_PRO_ACTIVATED_PLAYLIST_V1")||localStorage.getItem("GC_PLAY_PRO_PLAYLIST_URL");if(u&&window.loadM3U)await window.loadM3U(u)}async function boot(){const uid=jid(),old=(()=>{try{return JSON.parse(localStorage.getItem(KEY)||"null")}catch{return null}})();if(old?.activationCode){try{const d=await api("/api/device/check",{activation_code:old.activationCode,device_uid:uid,device_name:"GC PLAY PRO TV",platform:navigator.userAgent});save(old.activationCode,uid,d);$("gcTvActivation").classList.add("hidden");window.__GC_TV_ACTIVATION_RESOLVE__?.(true);return load()}catch{}}$("gcTvCode").focus()}async function activate(){const code=$("gcTvCode").value.replace(/\s/g,"").toUpperCase();if(code.length<6){msg("Digite o código de ativação.",true);return}try{$("gcTvActivate").disabled=true;msg("Ativando esta TV...");const uid=jid(),d=await api("/api/device/activate",{activation_code:code,device_uid:uid,device_name:"GC PLAY PRO TV",platform:navigator.userAgent});save(code,uid,d);$("gcTvActivation").classList.add("hidden");window.__GC_TV_ACTIVATION_RESOLVE__?.(true);await load()}catch(e){msg(e.message,true)}finally{$("gcTvActivate").disabled=false}}function remote(){document.addEventListener("keydown",e=>{const a=document.activeElement,k=e.key;if(["INPUT","TEXTAREA","SELECT"].includes(a?.tagName))return;if(k==="Enter"){a?.click?.();e.preventDefault();return}if(["Escape","BrowserBack","Backspace"].includes(k)){if($("playerPanel")?.classList.contains("active"))window.GC_PLAY_PRO?.closePlayer?.();else document.querySelector('[data-section="home"]')?.click();e.preventDefault();return}if(!k.startsWith("Arrow"))return;const els=[...document.querySelectorAll("button:not([disabled]),[tabindex='0'],select")].filter(x=>x.offsetParent!==null),r=a?.getBoundingClientRect?.();if(!els.length)return;if(!r){els[0].focus();return}let best=null,bs=1e99;const hor=k==="ArrowLeft"||k==="ArrowRight",dir=k==="ArrowRight"||k==="ArrowDown"?1:-1;for(const x of els){if(x===a)continue;const b=x.getBoundingClientRect(),dx=b.left-r.left,dy=b.top-r.top;if((hor?Math.sign(dx):Math.sign(dy))!==dir)continue;const p=hor?Math.abs(dx):Math.abs(dy),c=hor?Math.abs(b.top-r.top):Math.abs(b.left-r.left),s=p*p+c*c*2;if(s<bs){bs=s;best=x}}if(best){best.focus();best.scrollIntoView({block:"nearest",inline:"nearest"});e.preventDefault()}})}async function tvResolveItem(id){
  const s=window.GC_PLAY_PRO?.state;
  const ram=s?.items?.find?.(x=>String(x.id)===String(id));
  if(ram) return ram;
  try{return await window.findItem?.(id)||null}catch{return null}
}

async function decorateTvCards(){
  const api=window.GC_PLAY_PRO;
  if(!api?.loadLiveEPG) return;
  const cards=[...document.querySelectorAll('.gc-tv .gc-card[data-item-id]')]
    .filter(card=>!card.dataset.gcTvPrepared).slice(0,12);
  for(const card of cards){
    card.dataset.gcTvPrepared="1";
    card.tabIndex=0;
    const item=await tvResolveItem(card.dataset.itemId);
    if(!item || item.type!=="live") continue;
    let epg=card.querySelector(".gc-tv-card-epg");
    if(!epg){epg=document.createElement("div");epg.className="gc-tv-card-epg";epg.innerHTML='<span>EPG</span><b>Carregando programação...</b>';card.appendChild(epg)}
    try{await api.loadLiveEPG(item,epg)}catch(e){epg.innerHTML='<span>EPG</span><b>Programação indisponível</b>'}
  }
}

function startTvEpgCards(){
  const run=()=>decorateTvCards().catch(()=>{});
  run();
  const observer=new MutationObserver(()=>run());
  observer.observe(document.body,{childList:true,subtree:true});
  setInterval(run,60000);
}

function start(){document.body.classList.add("gc-tv");$("gcTvActivate").onclick=activate;$("gcTvCode").onkeydown=e=>{if(e.key==="Enter")activate()};remote();startTvEpgCards()}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>{start();boot()},{once:true}):start()})();