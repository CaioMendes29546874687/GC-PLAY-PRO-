/* GC PLAY PRO — Experience Layer 2026 */
(function(){
"use strict";
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const esc=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function ready(){
 document.body.classList.add("gc-pro-v3");
 buildTopline();
 buildMobileNav();
 buildAssistant();
 buildSearch();
 buildHomeEnhancements();
 buildLiveEnhancements();
 buildSettingsEnhancements();
 hookNavigation();
 sync();
 setTimeout(sync,1200);
 setTimeout(sync,3000);
}
function buildTopline(){
 if($(".gcp-topline")) return;
 const bar=document.createElement("div");
 bar.className="gcp-topline";
 bar.innerHTML=`
  <div class="gcp-top-search"><button id="gcpSearchOpen">⌕</button><input id="gcpTopSearchInput" placeholder="Buscar canais, filmes, séries e animes..."><button id="gcpMic" title="Busca por voz">●</button></div>
  <div class="gcp-status"><i></i><span id="gcpStatusText">SISTEMA PRONTO</span></div>
  <div class="gcp-top-actions">
   <button class="gcp-top-action" id="gcpQrOpen" title="QR Code">▣</button>
   <button class="gcp-top-action" id="gcpAssistantOpen" title="Assistente">✦</button>
   <button class="gcp-top-action" id="gcpSettingsOpen" title="Configurações">⚙</button>
  </div>`;
 document.body.appendChild(bar);
 $("#gcpSearchOpen").onclick=()=>openSearch();
 $("#gcpTopSearchInput").oninput=e=>searchGlobal(e.target.value);
 $("#gcpTopSearchInput").onkeydown=e=>{if(e.key==="Enter")openSearch(e.target.value)};
 $("#gcpQrOpen").onclick=showQR;
 $("#gcpAssistantOpen").onclick=()=>toggleAssistant();
 $("#gcpSettingsOpen").onclick=()=>{const b=$("#settingsButton");if(b)b.click()};
 $("#gcpMic").onclick=startVoiceSearch;
}
function buildMobileNav(){
 if($(".gcp-mobile-nav")) return;
 const nav=document.createElement("nav");nav.className="gcp-mobile-nav";
 nav.innerHTML=[
  ["⌂","INÍCIO","home"],["▣","TV","live"],["▶","FILMES","movies"],["▤","SÉRIES","series"],["☆","LISTA","favorites"]
 ].map(x=>`<button data-gcp-section="${x[2]}"><b>${x[0]}</b>${x[1]}</button>`).join("");
 document.body.appendChild(nav);
 nav.addEventListener("click",e=>{const b=e.target.closest("button[data-gcp-section]");if(!b)return;navigate(b.dataset.gcpSection)});
}
function navigate(section){
 const b=$(`.nav-item[data-section="${section}"]`);
 if(b){b.click();return}
 if(section==="favorites"){stateSafe().currentSection="favorites";if(window.renderFavorites)window.renderFavorites();return}
}
function stateSafe(){return window.__GC_STATE__||{}}
function hookNavigation(){
 document.addEventListener("click",e=>{
  const b=e.target.closest(".nav-item[data-section]");
  if(!b)return;
  setTimeout(sync,80);
 },false);
}
function sync(){
 const s=stateSafe();
 const text=$("#gcpStatusText");
 const section=s.currentSection||"home";
 if(text) text.textContent=s.loading?"CARREGANDO CATÁLOGO…":(s.total?"ONLINE • "+Number(s.total).toLocaleString("pt-BR")+" ITENS":"SISTEMA PRONTO");
 $(".gcp-mobile-nav button").forEach(b=>b.classList.toggle("active",b.dataset.gcpSection===section));
 const home=$(".gcp-home-grid"), live=$("#gcpLiveSection"), dashboard=$("#homeDashboard");
 if(home) home.style.display=section==="home"?"grid":"none";
 if(live) live.style.display=section==="live"?"block":"none";
 if(dashboard) dashboard.style.display=section==="home"?"block":"none";
}
function buildHomeEnhancements(){
 const dash=$("#homeDashboard");
 if(!dash||$(".gcp-home-grid"))return;
 const wrap=document.createElement("section");wrap.className="gcp-home-grid";
 wrap.innerHTML=`
  <div class="gcp-feature" id="gcpFeature"><div class="gcp-feature-content"><span class="gcp-badge">● GC PLAY PRO</span><h1>Seu conteúdo.<br><span style="color:var(--gcp-neon)">Do seu jeito.</span></h1><p>TV ao vivo, filmes e séries em uma experiência única, rápida e organizada.</p><div class="hero-buttons"><button class="primary-button" id="gcpFeaturePlay">▶ EXPLORAR</button><button class="secondary-button" id="gcpFeatureList">＋ MINHA LISTA</button></div></div></div>
  <div class="gcp-side-stack"><div class="gcp-mini-panel"><div class="gcp-mini-head"><strong>TV AO VIVO</strong><span>VER TODOS →</span></div><div class="gcp-mini-list" id="gcpLiveMini"></div></div><div class="gcp-mini-panel"><div class="gcp-mini-head"><strong>CONTINUE ASSISTINDO</strong><span>HISTÓRICO</span></div><div class="gcp-mini-list" id="gcpHistoryMini"></div></div></div>`;
 dash.parentNode.insertBefore(wrap,dash);
 $("#gcpFeaturePlay").onclick=()=>navigate("live");
 $("#gcpFeatureList").onclick=()=>{const b=$("#quickAddPlaylist");if(b)b.click()};
 refreshHomeMini();
}
async function refreshHomeMini(){
 const s=stateSafe();if(!s||!s.db)return;
 try{
  const get=window.GC_PLAY_PRO?.searchDatabase;
  const live=(s.items||[]).filter(x=>x.type==="live").slice(0,5);
  const lm=$("#gcpLiveMini");
  if(lm)lm.innerHTML=live.map((x,i)=>miniItem(x,i+1)).join("")||"<div class='gcp-card-meta'>Adicione uma lista M3U para começar.</div>";
  const hist=[];
  for(const id of (s.history||[]).slice(0,5)){if(window.GC_PLAY_PRO?.state){const x=(s.items||[]).find(y=>y.id===id);if(x)hist.push(x)}}
  const hm=$("#gcpHistoryMini");if(hm)hm.innerHTML=hist.map((x,i)=>miniItem(x,i+1)).join("")||"<div class='gcp-card-meta'>Nada para retomar ainda.</div>";
  $$(".gcp-mini-item[data-id]").forEach(el=>el.onclick=async()=>{const item=await findSafe(el.dataset.id);if(item&&window.GC_PLAY_PRO?.playItem)window.GC_PLAY_PRO.playItem(item)});
 }catch{}
}
function miniItem(x,i){
 return `<div class="gcp-mini-item" data-id="${esc(x.id)}"><img class="gcp-mini-logo" src="${esc(x.logo||"")}" onerror="this.style.display='none'"><div><div class="gcp-mini-name">${esc(x.name)}</div><div class="gcp-mini-meta">${esc(x.group||"Conteúdo")}</div></div><button class="gcp-mini-play">▶</button></div>`;
}
async function findSafe(id){
 if(window.GC_PLAY_PRO?.state?.items){const x=window.GC_PLAY_PRO.state.items.find(y=>y.id===id);if(x)return x}
 try{if(window.__GC_STATE__?.db){return await new Promise((res,rej)=>{const t=window.__GC_STATE__.db.transaction("items","readonly");const q=t.objectStore("items").get(id);q.onsuccess=()=>res(q.result||null);q.onerror=()=>rej(q.error)})}}catch{}
 return null;
}
function buildLiveEnhancements(){
 if($(".gcp-live-layout"))return;
 const sec=document.createElement("section");sec.id="gcpLiveSection";sec.className="gcp-section";
 sec.innerHTML=`<div class="gcp-section-head"><div><span class="section-label">TV AO VIVO</span><h2>Central de canais</h2><p>Categorias, canais, reprodução e informações em uma única tela.</p></div><button class="gcp-see" id="gcpLiveRefresh">ATUALIZAR</button></div><div class="gcp-live-layout"><aside class="gcp-live-sidebar" id="gcpLiveCats"></aside><div class="gcp-live-list" id="gcpLiveList"></div><div class="gcp-live-preview"><video id="gcpPreviewVideo" class="gcp-preview-video" controls playsinline></video><div class="gcp-preview-title" id="gcpPreviewTitle">Selecione um canal</div><div class="gcp-preview-meta" id="gcpPreviewMeta">O player principal continua disponível ao abrir o canal.</div><div class="gcp-preview-actions"><button id="gcpPreviewOpen">ABRIR PLAYER</button><button id="gcpPreviewFav">☆ FAVORITO</button><button id="gcpPreviewFull">⛶ TELA CHEIA</button><button id="gcpPreviewInfo">ⓘ INFORMAÇÕES</button></div></div></div>`;
 const lib=$("#librarySection");if(lib)lib.parentNode.insertBefore(sec,lib);
 $("#gcpLiveRefresh").onclick=refreshLivePanel;
 $("#gcpPreviewFull").onclick=()=>$("#gcpPreviewVideo")?.requestFullscreen?.();
 refreshLivePanel();
}
async function refreshLivePanel(){
 const s=stateSafe();const list=$("#gcpLiveList"),cats=$("#gcpLiveCats");if(!list||!cats)return;
 const all=(s.items||[]).filter(x=>x.type==="live"&&!isAdult(x));
 const groups=[...new Set(all.map(x=>String(x.group||"OUTROS")))]; 
 cats.innerHTML=[["all","Todos"],...groups.slice(0,18).map(x=>[x,x])].map((x,i)=>`<button class="gcp-live-cat ${i===0?"active":""}" data-group="${esc(x[0])}">▣ ${esc(x[1])}</button>`).join("");
 const paint=g=>{const rows=(g==="all"?all:all.filter(x=>x.group===g)).slice(0,250);list.innerHTML=rows.map((x,i)=>`<div class="gcp-live-row" data-live-id="${esc(x.id)}"><span class="gcp-live-num">${String(i+1).padStart(3,"0")}</span><img class="gcp-live-logo" src="${esc(x.logo||"")}" onerror="this.style.display='none'"><div><div class="gcp-live-title">${esc(x.name)}</div><div class="gcp-live-program">Ao vivo • ${esc(x.group||"TV")}</div></div><span class="gcp-live-dot">●</span></div>`).join("")||"<div class='gcp-card-meta'>Nenhum canal nesta categoria.</div>";
  $$(".gcp-live-row",list).forEach(row=>row.onclick=()=>selectLive(row.dataset.liveId));
 };
 cats.querySelectorAll("button").forEach(b=>b.onclick=()=>{cats.querySelectorAll("button").forEach(x=>x.classList.remove("active"));b.classList.add("active");paint(b.dataset.group)});
 paint("all");
}
function isAdult(x){return window.isAdultContent?window.isAdultContent(x):/(xxx|adult|porn|18\+)/i.test([x?.name,x?.group].join(" "))}
async function selectLive(id){
 const item=await findSafe(id);if(!item)return;
 const video=$("#gcpPreviewVideo"),title=$("#gcpPreviewTitle"),meta=$("#gcpPreviewMeta");if(title)title.textContent=item.name;if(meta)meta.textContent=(item.group||"TV AO VIVO")+" • Ao vivo";
 if(video){try{video.pause();video.removeAttribute("src");video.load()}catch{}}
 $("#gcpPreviewOpen").onclick=()=>window.GC_PLAY_PRO?.playItem?.(item);
 $("#gcpPreviewFav").onclick=()=>{window.toggleFavorite?.(item.id);};
 $("#gcpPreviewInfo").onclick=()=>alert((item.name||"Canal")+"\n\nCategoria: "+(item.group||"TV")+"\nID EPG: "+(item.tvgId||"não informado"));
 try{
  if(window.GC_PLAY_PRO?.playItem){await window.GC_PLAY_PRO.playItem(item)}
 }catch{}
}
function buildSearch(){
 if($(".gcp-search-overlay"))return;
 const o=document.createElement("div");o.className="gcp-search-overlay";o.innerHTML=`<div class="gcp-search-box"><div class="gcp-search-input"><input id="gcpSearchInput" placeholder="Digite o nome do canal, filme ou série..."><button id="gcpSearchClose" class="secondary-button">FECHAR</button></div><div class="gcp-search-tabs"><button class="active" data-t="all">TODOS</button><button data-t="live">CANAIS</button><button data-t="movie">FILMES</button><button data-t="series">SÉRIES</button></div><div id="gcpSearchResults" class="gcp-search-results"></div></div>`;document.body.appendChild(o);
 $("#gcpSearchClose").onclick=()=>o.classList.remove("open");$("#gcpSearchInput").oninput=e=>searchGlobal(e.target.value);o.addEventListener("click",e=>{if(e.target===o)o.classList.remove("open")});
 $$(".gcp-search-tabs button",o).forEach(b=>b.onclick=()=>{o.dataset.type=b.dataset.t;$$(".gcp-search-tabs button",o).forEach(x=>x.classList.toggle("active",x===b));searchGlobal($("#gcpSearchInput").value)});
}
function openSearch(term=""){const o=$(".gcp-search-overlay");if(!o)return;o.classList.add("open");const i=$("#gcpSearchInput");if(i){i.value=term;i.focus()}searchGlobal(term)}
async function searchGlobal(term){
 const results=$("#gcpSearchResults");if(!results)return;term=String(term||"").trim();if(!term){results.innerHTML="<div class='gcp-card-meta'>Digite algo para pesquisar.</div>";return}
 const type=$(".gcp-search-tabs button.active")?.dataset.t||"all";const s=stateSafe();let arr=(s.items||[]).filter(x=>!isAdult(x));const n=term.toLowerCase();arr=arr.filter(x=>(x.name+" "+(x.group||"")+" "+(x.tvgName||"")).toLowerCase().includes(n));if(type!=="all")arr=arr.filter(x=>x.type===type);
 results.innerHTML=arr.slice(0,100).map(x=>`<div class="gcp-live-row" data-search-id="${esc(x.id)}"><img class="gcp-live-logo" src="${esc(x.logo||"")}" onerror="this.style.display='none'"><div><div class="gcp-live-title">${esc(x.name)}</div><div class="gcp-live-program">${esc(x.group||"")} • ${esc(x.type)}</div></div><span class="gcp-live-dot">▶</span></div>`).join("")||"<div class='gcp-card-meta'>Nenhum resultado.</div>";
 $$(".gcp-live-row[data-search-id]",results).forEach(r=>r.onclick=async()=>{const x=await findSafe(r.dataset.searchId);if(x)window.GC_PLAY_PRO?.playItem?.(x)});
}
function startVoiceSearch(){
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){alert("Busca por voz não é suportada neste navegador.");return}
 const r=new SR();r.lang="pt-BR";r.onresult=e=>{const t=e.results[0][0].transcript;openSearch(t)};r.start();
}
function buildAssistant(){
 if($(".gcp-assistant"))return;
 const a=document.createElement("div");a.className="gcp-assistant";a.innerHTML=`<div class="gcp-assistant-panel" id="gcpAssistantPanel"><div class="gcp-assistant-head"><strong>✦ GC ASSISTENTE</strong><span>BUSCA INTELIGENTE LOCAL</span></div><div class="gcp-assistant-log" id="gcpAssistantLog"><div class="gcp-msg bot">Olá! Posso procurar canais, filmes e séries da sua própria lista. Experimente: “filmes de ação”, “séries” ou o nome de um conteúdo.</div></div><div class="gcp-assistant-input"><input id="gcpAssistantInput" placeholder="O que você quer assistir?"><button id="gcpAssistantSend">→</button></div></div><button class="gcp-assistant-btn" id="gcpAssistantBtn">✦</button>`;document.body.appendChild(a);
 $("#gcpAssistantBtn").onclick=()=>toggleAssistant();$("#gcpAssistantSend").onclick=assistantAsk;$("#gcpAssistantInput").onkeydown=e=>{if(e.key==="Enter")assistantAsk()};
}
function toggleAssistant(){$("#gcpAssistantPanel")?.classList.toggle("open")}
function assistantAsk(){
 const input=$("#gcpAssistantInput"),log=$("#gcpAssistantLog");if(!input||!log)return;const q=input.value.trim();if(!q)return;log.insertAdjacentHTML("beforeend",`<div class="gcp-msg user">${esc(q)}</div>`);input.value="";
 const s=stateSafe(),n=q.toLowerCase();let type=null;if(/\b(canal|canais|tv|ao vivo|esporte|not[ií]cia)\b/.test(n))type="live";else if(/\b(filme|filmes|movie)\b/.test(n))type="movie";else if(/\b(s[ée]rie|s[ée]ries|temporada|epis[oó]dio)\b/.test(n))type="series";
 const terms=n.replace(/\b(canal|canais|tv|ao vivo|esporte|not[ií]cia|filme|filmes|movie|s[ée]rie|s[ée]ries|temporada|epis[oó]dio|quero|quero assistir|procure|procurar|me mostre|mostrar|por favor)\b/g," ").trim();
 let arr=(s.items||[]).filter(x=>!isAdult(x)&&(!type||x.type===type));if(terms)arr=arr.filter(x=>(x.name+" "+(x.group||"")).toLowerCase().includes(terms));arr=arr.slice(0,5);
 const answer=arr.length?("Encontrei "+arr.length+" opção(ões):<br>"+arr.map(x=>`<button class="gcp-see" data-ai-id="${esc(x.id)}" style="margin:3px">${esc(x.name)}</button>`).join("")):"Não encontrei esse conteúdo na sua lista. Tente outro nome ou categoria.";
 log.insertAdjacentHTML("beforeend",`<div class="gcp-msg bot">${answer}</div>`);log.scrollTop=log.scrollHeight;
 $$(".gcp-see[data-ai-id]",log).forEach(b=>b.onclick=async()=>{const x=await findSafe(b.dataset.aiId);if(x)window.GC_PLAY_PRO?.playItem?.(x)});
}
function buildSettingsEnhancements(){
 const modal=$("#settingsDialog .settings-modal");if(!modal||$(".gcp-settings-extra",modal))return;
 const box=document.createElement("div");box.className="gcp-settings-extra";box.innerHTML=`<div class="gcp-diagnostics"><div class="gcp-diag"><strong>CATÁLOGO</strong><span id="gcpDiagCatalog">Aguardando lista</span></div><div class="gcp-diag"><strong>PLAYER</strong><span>HLS • MPEG-TS • DASH</span></div><div class="gcp-diag"><strong>ARMAZENAMENTO</strong><span>IndexedDB local</span></div></div><div style="display:flex;gap:8px;margin-top:12px"><button type="button" class="secondary-button" id="gcpQrSettings">▣ QR DA LISTA</button><button type="button" class="secondary-button" id="gcpDiagButton">DIAGNÓSTICO</button></div>`;modal.appendChild(box);
 $("#gcpQrSettings").onclick=showQR;$("#gcpDiagButton").onclick=diagnostics;setInterval(()=>{const s=stateSafe(),e=$("#gcpDiagCatalog");if(e)e.textContent=s.total?Number(s.total).toLocaleString("pt-BR")+" itens":"Nenhuma lista";},1500);
}
function showQR(){
 let d=document.getElementById("gcpQrDialog");if(!d){d=document.createElement("dialog");d.id="gcpQrDialog";d.innerHTML=`<div style="padding:25px;min-width:min(360px,90vw)"><button class="modal-close" onclick="this.closest('dialog').close()">×</button><span class="section-label">CONECTAR / COMPARTILHAR</span><h2>QR Code</h2><p class="modal-description">Código da página atual ou da lista configurada.</p><div class="gcp-qr" id="gcpQrCanvas"></div><button class="primary-button" id="gcpQrRefresh">GERAR NOVAMENTE</button></div>`;document.body.appendChild(d);$("#gcpQrRefresh").onclick=()=>makeQR()}
 if(d.showModal)d.showModal();else d.setAttribute("open","");makeQR();
}
function makeQR(){
 const box=$("#gcpQrCanvas");if(!box)return;box.innerHTML="";
 const value=stateSafe().playlistMeta?.url||location.href;
 if(window.QRCode){new QRCode(box,{text:value,width:190,height:190,colorDark:"#07100b",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M})}
 else {const img=document.createElement("img");img.width=190;img.height=190;img.alt="QR";img.src="https://api.qrserver.com/v1/create-qr-code/?size=190x190&data="+encodeURIComponent(value);box.appendChild(img)}
}
function diagnostics(){
 const s=stateSafe();alert("GC PLAY PRO\n\nCatálogo: "+Number(s.total||0).toLocaleString("pt-BR")+" itens\nTV: "+Number(s.counts?.live||0).toLocaleString("pt-BR")+"\nFilmes: "+Number(s.counts?.movie||0).toLocaleString("pt-BR")+"\nSéries: "+Number(s.counts?.series||0).toLocaleString("pt-BR")+"\nBanco: "+(s.db?"OK":"não inicializado")+"\nM3U: "+(typeof window.loadM3U==="function"?"OK":"não disponível"));
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ready);else ready();
setInterval(sync,2500);
setInterval(refreshHomeMini,5000);
})();