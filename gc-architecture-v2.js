/* GC PLAY PRO — ARCHITECTURE V2
 * 14 engines: ingestion, Xtream, catalog, series, EPG, search, cache,
 * playback, adapters, activation, devices, diagnostics, security, GC IA.
 * This layer is intentionally non-invasive: existing UI/playback remains the
 * authority while the engines expose stable APIs for the next migrations.
 */
"use strict";

(function GCArchitectureV2(global){
  const CATALOG_GATEWAY="https://gc-catalog.caioroberto318.workers.dev";
  const VERSION="2.0.0";

  const text=v=>String(v==null?"":v).trim();
  const norm=v=>text(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const esc=v=>encodeURIComponent(text(v));

  /* 1 — M3U ingestion */
  const M3UEngine={
    parseAttributes(line){
      const out={};
      const re=/([\w-]+)="([^"]*)"/g; let m;
      while((m=re.exec(line))) out[m[1]]=m[2];
      return out;
    },
    parseChunk(chunk){
      const lines=text(chunk).split(/\r?\n/), items=[];
      let pending=null;
      for(const raw of lines){
        const line=raw.trim();
        if(!line) continue;
        if(line.startsWith("#EXTINF:")){
          const comma=line.indexOf(",");
          const attrs=this.parseAttributes(line.slice(0,comma<0?line.length:comma));
          pending={name:comma>=0?line.slice(comma+1).trim():"Sem nome",...attrs};
        }else if(!line.startsWith("#") && pending){
          items.push({name:pending.name,url:line,group:pending["group-title"]||pending.group||"Sem categoria",logo:pending["tvg-logo"]||"",tvgId:pending["tvg-id"]||"",tvgName:pending["tvg-name"]||""});
          pending=null;
        }
      }
      return items;
    }
  };

  /* 2 — Xtream */
  const XtreamEngine={
    session(raw){
      try{
        const u=new URL(text(raw)), p=u.pathname.replace(/\/+$/,"");
        const q=u.searchParams;
        return {base:u.origin,username:q.get("username")||"",password:q.get("password")||"",path:p};
      }catch{return null}
    },
    async api(session,action="",params={},signal){
      if(!session?.base||!session.username||!session.password) throw Error("Sessão Xtream inválida");
      const u=new URL(session.base+"/player_api.php");
      u.searchParams.set("username",session.username);
      u.searchParams.set("password",session.password);
      if(action) u.searchParams.set("action",action);
      for(const [k,v] of Object.entries(params)) u.searchParams.set(k,String(v));
      const r=await fetch(CatalogEngine.gateway(u.toString()),{signal,headers:{Accept:"application/json"}});
      if(!r.ok) throw Error("Xtream HTTP "+r.status);
      return r.json();
    }
  };

  /* 3 — unified catalog */
  const CatalogEngine={
    gateway(url){return CATALOG_GATEWAY+"?url="+esc(url)},
    normalize(raw,type){
      const x=raw||{};
      return {id:text(x.id||x.stream_id||x.series_id||x.num),name:text(x.name||x.title||"Sem nome"),type:type||"unknown",group:text(x.category_name||x.group_title||x.group||"Sem categoria"),logo:text(x.stream_icon||x.cover||x.logo),url:text(x.stream_url||x.url||x.direct_source),categoryId:text(x.category_id||""),raw:x};
    },
    merge(items){const map=new Map();for(const item of items||[]){if(!item?.id)continue;map.set(String(item.id)+":"+item.type,item)}return [...map.values()]}
  };

  /* 4 — series/season/episode */
  const SeriesEngine={
    key(name){return norm(name).replace(/\b(s\s*\d+|t\s*\d+|temporada\s*\d+|season\s*\d+|e\s*\d+|ep\s*\d+)\b.*$/,"").replace(/[._-]+/g," ").replace(/\s+/g," ").trim()},
    parse(name){
      const n=text(name);
      const m=n.match(/(?:s(?:eason)?|t(?:emporada)?)\s*(\d{1,3})\s*(?:e(?:pisode)?|ep)\s*(\d{1,4})/i) ||
              n.match(/(?:s(?:eason)?|t(?:emporada)?)\s*(\d{1,3}).*?(?:e(?:pisode)?|ep)\s*(\d{1,4})/i) ||
              n.match(/\b(\d{1,2})x(\d{1,3})\b/i);
      const season=m?Number(m[1]):null, episode=m?Number(m[2]):null;
      return {seriesKey:this.key(n),season,episode};
    },
    group(items){
      const map=new Map();
      for(const item of items||[]){
        const p=this.parse(item.name); const key=p.seriesKey||norm(item.name);
        if(!map.has(key)) map.set(key,{seriesKey:key,name:item.name,seasons:new Map(),episodes:[]});
        const s=map.get(key); s.episodes.push(item);
        if(p.season!=null){if(!s.seasons.has(p.season))s.seasons.set(p.season,[]);s.seasons.get(p.season).push(item)}
      }
      return [...map.values()].map(s=>({...s,seasons:[...s.seasons.entries()].sort((a,b)=>a[0]-b[0]).map(([season,episodes])=>({season,episodes}))}));
    }
  };

  /* 5 — EPG */
  const EPGEngine={
    parseXML(xml){
      const out=[]; const re=/<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi; let m;
      while((m=re.exec(text(xml)))){
        const a={}; (m[1].match(/([\w-]+)="([^"]*)"/g)||[]).forEach(x=>{const q=x.indexOf("=");a[x.slice(0,q)]=x.slice(q+1).replace(/^"|"$/g,"")});
        const body=m[2], title=body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||"";
        out.push({channelId:a.channel||"",start:a.start||"",stop:a.stop||"",title:title.replace(/<[^>]+>/g,"").trim()});
      } return out;
    }
  };

  /* 6 — search */
  const SearchEngine={
    score(item,term){
      const q=norm(term); if(!q)return 0;
      const n=norm(item?.name),g=norm(item?.group);
      if(n===q)return 100; if(n.startsWith(q))return 80; if(n.includes(q))return 60; if(g.includes(q))return 25; return 0;
    },
    search(items,term,limit=100){return (items||[]).map(x=>({x,s:this.score(x,term)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s||norm(a.x.name).localeCompare(norm(b.x.name))).slice(0,limit).map(x=>x.x)}
  };

  /* 7 — cache/performance */
  const CacheEngine={
    prefix:"GC2:",
    set(key,value,ttl=300000){try{localStorage.setItem(this.prefix+key,JSON.stringify({e:Date.now()+ttl,v:value}));return true}catch{return false}},
    get(key){try{const x=JSON.parse(localStorage.getItem(this.prefix+key)||"null");if(!x)return null;if(x.e<Date.now()){localStorage.removeItem(this.prefix+key);return null}return x.v}catch{return null}},
    del(key){try{localStorage.removeItem(this.prefix+key)}catch{}}
  };

  /* 8 — playback manager */
  const PlaybackEngine={
    classify(url){
      const u=text(url).toLowerCase().split("?")[0];
      if(u.endsWith(".m3u8")||u.includes("m3u8"))return"hls";
      if(u.endsWith(".mpd")||u.includes(".mpd"))return"dash";
      if(/\.m3u$/.test(u))return"m3u";
      if(/\.(mp4|mkv|webm|mov)(?:$|\/)/.test(u))return"vod";
      if(/\.(ts|mpeg|mpg)(?:$|\/)/.test(u))return"mpegts";
      return"unknown";
    },
    direct(url){return text(url)}
  };

  /* 9 — device adapters */
  const AdapterEngine={
    detect(){
      const ua=navigator.userAgent||"";
      return {
        samsung:/Tizen|SMART-TV.*Samsung|SamsungBrowser/i.test(ua),
        lg:/Web0S|webOS|LG Browser/i.test(ua),
        android:/Android/i.test(ua),
        ios:/iPhone|iPad|iPod/i.test(ua),
        tv:/SMART-TV|Tizen|Web0S|webOS|HbbTV/i.test(ua),
        browser:!(/SMART-TV|Tizen|Web0S|webOS/i.test(ua))
      };
    },
    preferred(){const d=this.detect();return d.samsung?"samsung-avplay":d.android?"html5-hls":d.lg?"html5-media":"html5-media"}
  };

  /* 10 — activation bridge */
  const ActivationEngine={
    key:"GC_PLAY_PRO_ACTIVATION",
    read(){try{return JSON.parse(localStorage.getItem(this.key)||"null")}catch{return null}},
    valid(){
      const x=this.read(); if(!x)return false;
      if(x.expiresAt&&!Number.isNaN(Date.parse(x.expiresAt)))return Date.parse(x.expiresAt)>Date.now();
      return !!x.active;
    }
  };

  /* 11 — devices */
  const DeviceEngine={
    async id(){
      const key="GC_PLAY_PRO_DEVICE_ID";
      try{let id=localStorage.getItem(key);if(id)return id;id=(crypto?.randomUUID?.()||("gc-"+Date.now()+"-"+Math.random().toString(36).slice(2)));localStorage.setItem(key,id);return id}catch{return"gc-ephemeral"}
    },
    info(){return {userAgent:navigator.userAgent||"",language:navigator.language||"",platform:navigator.platform||"",screen:[screen.width,screen.height],adapter:AdapterEngine.detect()}}
  };

  /* 12 — diagnostics */
  const DiagnosticsEngine={
    events:[],
    push(type,data={}){const e={type,time:new Date().toISOString(),...data};this.events.push(e);if(this.events.length>100)this.events.shift();try{sessionStorage.setItem("GC2_DIAG",JSON.stringify(this.events))}catch{};return e},
    snapshot(){return {version:VERSION,events:this.events.slice(-20),adapter:AdapterEngine.detect(),connection:navigator.connection?{effectiveType:navigator.connection.effectiveType,downlink:navigator.connection.downlink}:null}}
  };

  /* 13 — security */
  const SecurityEngine={
    isHttp(url){try{return /^https?:$/.test(new URL(url).protocol)}catch{return false}},
    catalog(url){if(!this.isHttp(url))return false;try{const u=new URL(url);return !u.username&&!u.password}catch{return false}},
    playback(url){return this.isHttp(url)}
  };

  /* 14 — GC IA */
  const AIEngine={
    commands:{
      tv:s=>/\b(tv|canais?|ao vivo)\b/i.test(s),
      movies:s=>/\b(filmes?|cinema)\b/i.test(s),
      series:s=>/\b(series?|séries?)\b/i.test(s),
      home:s=>/\b(in[ií]cio|home)\b/i.test(s),
      pause:s=>/\b(pausa|pausar|pare|parar)\b/i.test(s),
      play:s=>/\b(play|tocar|reproduzir|continuar)\b/i.test(s)
    },
    classify(input){const s=text(input);for(const [action,fn] of Object.entries(this.commands))if(fn(s))return action;return"chat"}
  };

  global.GCArchitecture={
    version:VERSION,
    ingestion:M3UEngine,xtream:XtreamEngine,catalog:CatalogEngine,series:SeriesEngine,
    epg:EPGEngine,search:SearchEngine,cache:CacheEngine,playback:PlaybackEngine,
    adapters:AdapterEngine,activation:ActivationEngine,devices:DeviceEngine,
    diagnostics:DiagnosticsEngine,security:SecurityEngine,ai:AIEngine
  };
  global.GCArchitecture.ready=true;
  DiagnosticsEngine.push("architecture_ready",{version:VERSION});
})(window);
