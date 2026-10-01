/* GC PLAY PRO — Section UI v3 */
(function(){
"use strict";
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const esc=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
let lastSection="", loadingType=null;

function boot(){
 document.body.classList.add("gc-pro-v4");
 removeOldExperience();
 buildTopbar();
 buildCatalogShell();
 buildMobileNav();
 bindCategoryDelegation();
 observeState();
 setTimeout(refresh,250);
 setTimeout(refresh,1000);
 setTimeout(refresh,2500);
}
function removeOldExperience(){
 $$(".gcp-topline,.gcp-mobile-nav,.gcp-assistant,.gcp-search-overlay").forEach(x=>x.remove());
}
function buildTopbar(){
 if($(".gcv4-topbar"))return;
 const x=document.createElement("div");x.className="gcv4-topbar";
 x.innerHTML=`
  <div class="gcv4-search"><span>⌕</span><input id="gcv4Search" placeholder="Buscar canais, filmes e séries..."><button id="gcv4SearchBtn">BUSCAR</button></div>
  <div class="gcv4-actions"><button id="gcv4Qr">▣</button><button id="gcv4Settings">⚙</button></div>`;
 document.body.appendChild(x);
 $("#gcv4SearchBtn").onclick=()=>{const b=$("#searchButton");if(b)b.click();};
 $("#gcv4Search").onkeydown=e=>{if(e.key==="Enter"){const b=$("#searchButton");if(b)b.click();setTimeout(()=>{const i=$("#globalSearch");if(i){i.value=e.target.value;i.dispatchEvent(new Event("input",{bubbles:true}));i.focus()}},120)}};
 $("#gcv4Qr").onclick=()=>{if(window.showGCQR)window.showGCQR();};
 $("#gcv4Settings").onclick=()=>$("#settingsButton")?.click();
}
function buildCatalogShell(){
 const lib=$("#librarySection");const grid=$("#contentGrid");if(!lib||!grid||$(".gcv4-shell"))return;
 const header=lib.querySelector(".section-header");
 if(header)header.classList.add("gcv4-old-header");
 const shell=document.createElement("div");shell.className="gcv4-shell";
 shell.innerHTML=`
  <aside class="gcv4-sidebar">
   <div class="gcv4-side-title"><span id="gcv4SectionIcon">▣</span><div><strong id="gcv4SideTitle">TV AO VIVO</strong><small id="gcv4SideSub">Categorias</small></div></div>
   <div id="gcv4Categories" class="gcv4-categories"></div>
  </aside>
  <section class="gcv4-results">
   <div class="gcv4-results-head"><div><span class="section-label" id="gcv4Label">TV AO VIVO</span><h2 id="gcv4Title">Canais ao vivo</h2><p id="gcv4Count">0 itens</p></div><div class="gcv4-head-actions"><button id="gcv4Sort">A–Z</button><button id="gcv4Reload">↻</button></div></div>
   <div id="gcv4Content"></div>
  </section>`;
 lib.appendChild(shell);
 const content=$("#gcv4Content");content.appendChild(grid);
 const empty=$("#emptyState");if(empty)content.appendChild(empty);
}
function buildMobileNav(){
 if($(".gcv4-mobile"))return;
 const n=document.createElement("nav");n.className="gcv4-mobile";
 n.innerHTML=[["home","⌂","INÍCIO"],["live","▣","TV"],["movies","▶","FILMES"],["series","▤","SÉRIES"],["favorites","★","LISTA"]].map(x=>`<button data-gcv4-nav="${x[0]}"><b>${x[1]}</b>${x[2]}</button>`).join("");
 document.body.appendChild(n);
 n.onclick=e=>{
 const b=e.target.closest("[data-gcv4-nav]");if(!b)return;
 const target={home:"home",live:"live",movies:"movies",series:"series",favorites:"favorites"}[b.dataset.gcv4Nav];
 if(target) $(".nav-item[data-section='"+target+"']")?.click();
};
}
function observeState(){
 if(window.__gcv4Timer)return;window.__gcv4Timer=setInterval(refresh,1500);
}
async function refresh(){
 const s=window.__GC_STATE__;if(!s)return;
 const section=s.currentSection||"home";

 /* O estado visual e o catálogo precisam sempre usar a mesma seção.
    O módulo antigo continua sendo a autoridade para renderizar o catálogo. */
 if(section!==lastSection){
   lastSection=section;
   updateSectionShell(section);
   const nav=window.GC_PLAY_PRO?.navigateSection;
   if(typeof nav==="function"){
     await nav(section);
     return;
   }
 }

 /* Se alguma ação antiga deixar Home com filtro de filmes/séries,
    normaliza imediatamente para a Home real. */
 if(section==="home" && s.currentFilter!=="all"){
   s.currentFilter="all";
   s.currentGenre="all";
   s.seriesView.seriesKey=null;
   s.seriesView.season=null;
   if(typeof window.GC_PLAY_PRO?.navigateSection==="function"){
     await window.GC_PLAY_PRO.navigateSection("home");
     return;
   }
 }

 /* Ao entrar em filmes/séries, primeiro garante o catálogo e depois
    manda o renderizador oficial desenhar somente aquele tipo. */
 if(["movies","series"].includes(section)){
   const type=section==="movies"?"movie":"series";
   if(s.xtreamSession && (s.counts?.[type]||0)===0 && loadingType!==section){
     loadingType=section;
     try{
       await window.GC_PLAY_PRO?.ensureXtreamSectionLoaded?.(type);
     }finally{loadingType=null;}
     if(typeof window.GC_PLAY_PRO?.render==="function") await window.GC_PLAY_PRO.render();
     return;
   }
 }

 renderCategories();
 updateCount();
}
function updateSectionShell(section){
 const shell=$(".gcv4-shell");if(!shell)return;
 const cfg={
  live:{title:"TV AO VIVO",label:"CANAIS AO VIVO",sub:"Categorias de televisão",icon:"▣"},
  movies:{title:"FILMES",label:"CATÁLOGO DE FILMES",sub:"Categorias de filmes",icon:"▶"},
  series:{title:"SÉRIES",label:"CATÁLOGO DE SÉRIES",sub:"Categorias e temporadas",icon:"▤"},
  favorites:{title:"FAVORITOS",label:"MINHA LISTA",sub:"Conteúdo salvo",icon:"★"},
  adult:{title:"ADULTOS",label:"ÁREA PROTEGIDA",sub:"Conteúdo protegido",icon:"🔒"},
  home:{title:"INÍCIO",label:"GC PLAY PRO",sub:"Página principal",icon:"GC"}
 };
 const c=cfg[section]||cfg.home;
 $("#gcv4SectionIcon").textContent=c.icon;$("#gcv4SideTitle").textContent=c.title;$("#gcv4SideSub").textContent=c.sub;
 $("#gcv4Label").textContent=c.label;$("#gcv4Title").textContent=section==="live"?"Canais ao vivo":section==="movies"?"Filmes":section==="series"?"Séries e temporadas":section==="favorites"?"Minha lista":"Conteúdo";
 $(".gcv4-shell").classList.toggle("is-home",section==="home");
}
function categorySource(section){
 const s=window.__GC_STATE__||{};
 if(section==="live")return s.genreCatalog?.live||[];
 if(section==="movies")return s.genreCatalog?.movie||[];
 if(section==="series")return s.genreCatalog?.series||[];
 return [];
}
function renderCategories(){
 const s=window.__GC_STATE__;if(!s)return;
 const section=s.currentSection||"home";const box=$("#gcv4Categories");if(!box)return;
 if(section==="home"||section==="favorites"||section==="adult"){box.innerHTML=`<button class="gcv4-cat active" data-gcv4-cat="all"><span>●</span> Todos</button>`;return}
 const type=section==="live"?"live":section==="movies"?"movie":"series";
 const list=categorySource(section);
 box.innerHTML=`<button class="gcv4-cat ${s.currentGenre==="all"?"active":""}" data-gcv4-cat="all"><span>●</span> Todos <em>›</em></button>`+
 list.map(g=>`<button class="gcv4-cat ${String(s.currentGenre).toLowerCase()===String(g).toLowerCase()?"active":""}" data-gcv4-cat="${esc(g)}"><span>●</span><b>${esc(g)}</b></button>`).join("");
}
function bindCategoryDelegation(){
 if(window.__gcv4CategoryDelegation)return;
 window.__gcv4CategoryDelegation=true;
 document.addEventListener("click",event=>{
   const b=event.target.closest("[data-gcv4-cat]");
   if(!b)return;
   const box=b.closest("#gcv4Categories");
   if(!box)return;
   event.preventDefault();
   event.stopPropagation();
   const s=window.__GC_STATE__;
   const section=s?.currentSection||"home";
   const type=section==="live"?"live":section==="movies"?"movie":section==="series"?"series":null;
   if(!type)return;
   window.GC_PLAY_PRO?.setCatalogCategory?.(type,b.getAttribute("data-gcv4-cat")||"all");
 },true);
}
function updateCount(){
 const s=window.__GC_STATE__;const el=$("#gcv4Count");if(!s||!el)return;
 const n=s.currentSection==="live"?s.counts.live:s.currentSection==="movies"?s.counts.movie:s.currentSection==="series"?s.counts.series:s.total;
 el.textContent=Number(n||0).toLocaleString("pt-BR")+" itens";
}
window.showGCQR=function(){
 const value=window.__GC_STATE__?.playlistMeta?.url||location.href;
 let d=document.getElementById("gcv4QrDialog");
 if(!d){d=document.createElement("dialog");d.id="gcv4QrDialog";d.innerHTML=`<div class="gcv4-qrbox"><button class="modal-close" onclick="this.closest('dialog').close()">×</button><span class="section-label">COMPARTILHAR</span><h2>QR CODE</h2><div id="gcv4QrCanvas"></div><small>Escaneie para abrir o GC PLAY PRO.</small></div>`;document.body.appendChild(d)}
 const box=$("#gcv4QrCanvas");box.innerHTML="";
 if(window.QRCode)new QRCode(box,{text:value,width:190,height:190,colorDark:"#07100b",colorLight:"#fff"});
 else box.innerHTML="<div class='gcv4-qr-fallback'>QR indisponível</div>";
 d.showModal?.();
};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();