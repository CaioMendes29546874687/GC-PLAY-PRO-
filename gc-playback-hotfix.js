/* GC PLAY PRO — dynamic catalog compatibility */
(function(){
"use strict";
const D=window.__GC_DYNAMIC_ITEMS__ || new Map();
window.__GC_DYNAMIC_ITEMS__=D;
if(typeof window.getSeriesEpisodes==="function" && !window.__GC_SERIES_WRAP__){
 const original=window.getSeriesEpisodes;
 window.getSeriesEpisodes=async function(key,season){const items=await original(key,season);if(Array.isArray(items))items.forEach(x=>x&&x.id&&D.set(String(x.id),x));return items;};
 window.__GC_SERIES_WRAP__=true;
}
if(typeof window.findItem==="function" && !window.__GC_FIND_WRAP__){
 const original=window.findItem;
 window.findItem=async function(id){return D.get(String(id||"")) || original(id);};
 window.__GC_FIND_WRAP__=true;
}
})();
