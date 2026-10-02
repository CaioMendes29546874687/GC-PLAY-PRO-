/* GC PLAY PRO — NEW INTERFACE LAYER v84
   This file only synchronizes visual state.
   Navigation/click ownership is handled by gc-final-fix.js.
*/
(function(){
"use strict";
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));

function sync(){
  const s=window.__GC_STATE__;
  if(!s) return;
  const section=s.currentSection||"home";
  $$(".nav-item[data-section]").forEach(b=>{
    b.classList.toggle("active",b.dataset.section===section);
  });
  $(".gc-bottom-nav button").forEach(b=>{
    b.classList.toggle("active",b.dataset.section===section);
  });
  const lib=$("#librarySection"), dash=$("#homeDashboard");
  if(section==="home"){
    if(dash) dash.style.display="block";
    if(lib) lib.style.display="none";
  }else{
    if(dash) dash.style.display="none";
    if(lib) lib.style.display="block";
  }
}
function boot(){
  if(window.__GC_UI_SYNC_ONLY__) return;
  window.__GC_UI_SYNC_ONLY__=true;
  sync();
  setInterval(sync,500);
}
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot,{once:true});
else boot();
})();