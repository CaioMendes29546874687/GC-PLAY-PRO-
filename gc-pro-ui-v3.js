/* GC PLAY PRO — NEW INTERFACE LAYER */
(function(){
"use strict";
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
async function navigate(section){
 const api=window.GC_PLAY_PRO;
 if(api && typeof api.navigateSection==="function"){
   try{
     const ok=await api.navigateSection(section);
     if(ok!==false){ sync(); return true; }
   }catch(error){
     console.error("[GC] navegação:",error);
   }
 }
 const b=$('.nav-item[data-section="'+section+'"]');
 if(b){ b.click(); return true; }
 return false;
}
function sync(){
 const s=window.__GC_STATE__; if(!s)return;
 const section=s.currentSection||"home";
 $$(".nav-item[data-section]").forEach(b=>b.classList.toggle("active",b.dataset.section===section));
 $(".gc-bottom-nav button").forEach(b=>b.classList.toggle("active",b.dataset.section===section));
 const lib=$("#librarySection"), dash=$("#homeDashboard");
 if(section==="home"){if(dash)dash.style.display="block";if(lib)lib.style.display="none";}else{if(dash)dash.style.display="none";if(lib)lib.style.display="block";}
}
function boot(){
 $$(".nav-item[data-section]").forEach(b=>b.addEventListener("click",()=>setTimeout(sync,30),true));
 /* Os botões inferiores agora usam o mesmo .nav-item[data-section] do app.js. */
 document.querySelector(".gc-brand")?.addEventListener("click",()=>navigate("home"));
 document.addEventListener("click",e=>{
   const shortcut=e.target.closest("[data-filter]");
   if(shortcut){
     const v=shortcut.dataset.filter;
     const target=v==="movie"?"movies":v;
     navigate(target);
   }
   const sec=e.target.closest("[data-section]");
   if(sec && sec.classList.contains("gc-shortcut"))navigate(sec.dataset.section);
 });
 document.addEventListener("keydown",e=>{
   if(e.key==="Enter" && document.activeElement?.matches(".gc-brand"))navigate("home");
 });
 setInterval(sync,500);
 sync();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();