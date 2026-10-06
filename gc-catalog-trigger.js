(function(){
  if(window.__GC_CATALOG_TRIGGER__)return;
  window.__GC_CATALOG_TRIGGER__=true;
  document.addEventListener("click",async e=>{
    const b=e.target?.closest?.('[data-section="live"],[data-section="movies"],[data-section="series"]');
    if(!b||!window.GC_PLAY_PRO_CATALOG_RECOVER)return;
    if(sessionStorage.getItem("GC_PLAY_PRO_CATALOG_REBUILT_V1")==="1")return;
    sessionStorage.setItem("GC_PLAY_PRO_CATALOG_REBUILT_V1","1");
    try{await window.GC_PLAY_PRO_CATALOG_RECOVER();location.reload();}
    catch(error){sessionStorage.removeItem("GC_PLAY_PRO_CATALOG_REBUILT_V1");console.warn("[GC PLAY PRO] recovery trigger",error);}
  },true);
})();