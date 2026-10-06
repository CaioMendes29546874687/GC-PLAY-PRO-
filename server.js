import express from "express";
import pg from "pg";
import crypto from "node:crypto";
const {Pool}=pg;
const app=express();
const PORT=process.env.PORT||10000;
const DATABASE_URL=process.env.DATABASE_URL||"";
const MIGRATION_TOKEN=process.env.MIGRATION_TOKEN||"";
const AUTH_SECRET=process.env.AUTH_SECRET||"";
const ORIGIN="https://caiomendes29546874687.github.io";
app.use(express.json({limit:"25mb"}));
app.use(express.urlencoded({extended:false,limit:"1mb"}));
app.use((req,res,next)=>{
  const o=req.headers.origin;
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,PATCH,DELETE,OPTIONS");
  if(req.method==="OPTIONS")return res.sendStatus(204);
  next();
});
let pool;
function getPool(){if(!DATABASE_URL)throw new Error("DATABASE_URL não configurada.");if(!pool)pool=new Pool({connectionString:DATABASE_URL,ssl:{rejectUnauthorized:false},max:8});return pool}
async function db(){return getPool()}
async function init(){const p=getPool();const fs=await import("node:fs/promises");await p.query(await fs.readFile(new URL("./schema.sql",import.meta.url),"utf8"));console.log("GC DB: schema pronto.");}
const b64=x=>Buffer.from(x).toString("base64url");
const unb64=x=>Buffer.from(x,"base64url").toString();
function hashPassword(pass,salt=crypto.randomBytes(16).toString("hex")){return new Promise((resolve,reject)=>crypto.scrypt(pass,salt,64,(e,k)=>e?reject(e):resolve(salt+"$"+k.toString("hex"))))}
function verifyPassword(pass,stored){return new Promise((resolve,reject)=>{const [salt,hex]=String(stored||"").split("$");if(!salt||!hex)return resolve(false);crypto.scrypt(pass,salt,64,(e,k)=>{if(e)return reject(e);const a=Buffer.from(hex,"hex"),b=k;if(a.length!==b.length)return resolve(false);resolve(crypto.timingSafeEqual(a,b))})})}
function sign(payload){const raw=b64(JSON.stringify(payload));const sig=crypto.createHmac("sha256",AUTH_SECRET||"gc-play-pro-dev-secret").update(raw).digest("base64url");return raw+"."+sig}
function verify(token){try{const [raw,sig]=String(token||"").split(".");if(!raw||!sig)return null;const exp=crypto.createHmac("sha256",AUTH_SECRET||"gc-play-pro-dev-secret").update(raw).digest("base64url");if(sig.length!==exp.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(exp)))return null;const p=JSON.parse(unb64(raw));return p.exp>Date.now()?p:null}catch{return null}}
async function auth(req,res,next){const p=verify((req.headers.authorization||"").replace(/^Bearer\s+/i,""));if(!p?.id)return res.status(401).json({error:"Sessão inválida."});req.user=p;next()}
async function adminCount(){const p=await db();return Number((await p.query("select count(*)::int n from admin_auth")).rows[0].n)}
function safeList(r){const x={...r};delete x.provider_password;delete x.provider_secret_id;return x}
async function dashboardData(){const p=await db();const [l,c,d,g]=await Promise.all([
 p.query("select id,name,server_url,username,expires_at,status,provider_status,max_connections,active_connections,last_sync_at,last_error,health_status,health_score,health_checked_at,health_details,created_at from provider_lists order by created_at desc"),
 p.query("select id,name,email,phone,plan,list_id,device_limit,status,activation_code,created_at,updated_at from clients order by created_at desc"),
 p.query("select id,client_id,device_uid,device_name,platform,last_seen_at,status,network_online,network_rtt_ms,network_downlink_mbps,network_effective_type,backend_rtt_ms,diagnostics_status,last_playback_at,last_playback_error,last_buffer_seconds,last_stream_name,last_stream_type from devices order by last_seen_at desc"),
 p.query("select id,list_id,status,old_expiry,new_expiry,details,created_at from sync_logs order by created_at desc limit 12")
]);return{lists:l.rows.map(safeList),clients:c.rows,devices:d.rows,logs:g.rows}}
app.get("/health",async(_q,r)=>{try{await (await db()).query("select 1");r.json({ok:true,service:"gc-play-pro-backend",database:"ok",version:"render-native-panel-1"})}catch(e){r.status(503).json({ok:false,error:e.message})}});
app.get("/api/status",async(_q,r)=>{try{const p=await db();const q=await p.query("select (select count(*) from provider_lists) lists,(select count(*) from clients) clients,(select count(*) from devices) devices,(select count(*) from activations) activations,(select count(*) from sync_logs) sync_logs,(select count(*) from admin_profiles) admin_profiles");r.json({ok:true,...q.rows[0]})}catch(e){r.status(503).json({ok:false,error:e.message})}});
app.get("/api/auth/status",async(_q,r)=>{try{r.json({ok:true,configured:await adminCount()>0})}catch(e){r.status(503).json({ok:false,error:e.message})}});
app.post("/api/auth/setup",async(req,res)=>{try{if(await adminCount()>0)return res.status(409).json({error:"O acesso administrativo já foi criado. Use Entrar."});const {email,password,name}=req.body||{};if(!email||!password||String(password).length<6)return res.status(400).json({error:"E-mail e senha são obrigatórios; a senha deve ter pelo menos 6 caracteres."});const p=await db(),h=await hashPassword(password),profile=(await p.query("select id,full_name,role from admin_profiles order by created_at asc limit 1")).rows[0];const id=profile?.id||crypto.randomUUID();await p.query("insert into admin_profiles(id,full_name,role) values($1,$2,'admin') on conflict(id) do update set full_name=coalesce(excluded.full_name,admin_profiles.full_name),role='admin'",[id,name||profile?.full_name||"Administrador"]);await p.query("insert into admin_auth(id,email,password_hash,full_name,created_at,updated_at) values($1,$2,$3,$4,now(),now())",[id,String(email).toLowerCase(),h,name||profile?.full_name||"Administrador"]);const user={id,email:String(email).toLowerCase(),name:name||profile?.full_name||"Administrador"};res.json({ok:true,token:sign({id:user.id,email:user.email,name:user.name,exp:Date.now()+7*86400000}),user})}catch(e){res.status(500).json({error:e.code==="23505"?"E-mail já cadastrado.":e.message})}});
app.post("/api/auth/login",async(req,res)=>{try{const {email,password}=req.body||{};const p=await db(),q=await p.query("select id,email,password_hash,full_name from admin_auth where lower(email)=lower($1) limit 1",[email||""]);const u=q.rows[0];if(!u||!(await verifyPassword(password||"",u.password_hash)))return res.status(401).json({error:"E-mail ou senha inválidos."});res.json({ok:true,token:sign({id:u.id,email:u.email,name:u.full_name||"Administrador",exp:Date.now()+7*86400000}),user:{id:u.id,email:u.email,name:u.full_name||"Administrador"}})}catch(e){res.status(500).json({error:e.message})}});
app.get("/api/auth/me",auth,async(req,res)=>res.json({ok:true,user:{id:req.user.id,email:req.user.email,name:req.user.name}}));

function normalizeActivationCode(v){return String(v||"").replace(/[^a-z0-9]/gi,"").toUpperCase().slice(0,32)}
function buildManagedPlaylistUrl(list){
  if(!list) return "";
  const source=String(list.source_url||"").trim();
  if(source && !source.includes("***")) return source;
  if(list.server_url && list.username && list.provider_password){
    const u=new URL("/get.php",serverOf(list.server_url));
    u.searchParams.set("username",list.username);
    u.searchParams.set("password",list.provider_password);
    u.searchParams.set("type","m3u_plus");
    u.searchParams.set("output","ts");
    return u.toString();
  }
  return source;
}
async function loadClientForActivation(code){
  const p=await db();
  const q=await p.query(
    "select c.id,c.name,c.activation_code,c.device_limit,c.status,c.list_id,l.name list_name,l.source_url,l.server_url,l.username,l.provider_password,l.expires_at,l.status list_status from clients c left join provider_lists l on l.id=c.list_id where upper(c.activation_code)=upper($1) limit 1",
    [code]
  );
  return q.rows[0]||null;
}
async function resolveDeviceActivation(code,deviceUid,deviceName,platform){
  const client=await loadClientForActivation(code);
  if(!client) return {ok:false,status:404,error:"Código de ativação inválido."};
  const clientStatus=String(client.status||"").trim().toLowerCase();
  if(["blocked","inactive","expired","disabled"].includes(clientStatus)) return {ok:false,status:403,error:"Cliente bloqueado ou inativo."};
  if(clientStatus!=="active"){
    await (await db()).query("update clients set status='active',updated_at=now() where id=$1",[client.id]);
    client.status="active";
  }
  if(!client.list_id) return {ok:false,status:409,error:"Cliente sem lista vinculada."};
  if(client.list_status==="expired" || (client.expires_at && new Date(client.expires_at)<=new Date())){
    return {ok:false,status:403,error:"A lista deste cliente está expirada."};
  }
  if(!client.expires_at) return {ok:false,status:409,error:"A validade da lista ainda não foi sincronizada."};
  if(!client.server_url || !client.username || !client.provider_password){
    return {ok:false,status:409,error:"Credenciais da lista não estão disponíveis."};
  }
  const p=await db();
  const existing=(await p.query("select id,status from devices where client_id=$1 and device_uid=$2 limit 1",[client.id,String(deviceUid||"")])).rows[0];
  if(existing){
    if(existing.status==="blocked") return {ok:false,status:403,error:"Este dispositivo foi revogado. Digite o código novamente para criar uma nova ativação."};
    await p.query("update devices set status='online',device_name=coalesce($1,device_name),platform=coalesce($2,platform),last_seen_at=now() where id=$3",[String(deviceName||"GC PLAY PRO"),String(platform||""),existing.id]);
    await p.query("insert into activations(client_id,device_id,activation_code,activated_at) values($1,$2,$3,now())",[client.id,existing.id,client.activation_code]);
    return {ok:true,device_id:existing.id,client_id:client.id,list_id:client.list_id,expires_at:client.expires_at,list_name:client.list_name,playlist_url:buildManagedPlaylistUrl(client)};
  }
  const limit=Math.max(1,Number(client.device_limit)||1);
  const activeCount=Number((await p.query("select count(*)::int n from devices where client_id=$1 and status<>'blocked'",[client.id])).rows[0].n);
  if(activeCount>=limit) return {ok:false,status:409,error:"Limite de dispositivos atingido. Remova um dispositivo no painel para liberar uma nova ativação."};
  const created=(await p.query("insert into devices(client_id,device_uid,device_name,platform,last_seen_at,status) values($1,$2,$3,$4,now(),'online') returning id",[client.id,String(deviceUid||""),String(deviceName||"GC PLAY PRO"),String(platform||"")])).rows[0];
  await p.query("insert into activations(client_id,device_id,activation_code,activated_at) values($1,$2,$3,now())",[client.id,created.id,client.activation_code]);
  return {ok:true,device_id:created.id,client_id:client.id,list_id:client.list_id,expires_at:client.expires_at,list_name:client.list_name,playlist_url:buildManagedPlaylistUrl(client)};
}

app.post("/api/device/activate",async(req,res)=>{
  console.log("GC ACTIVATE REQUEST",JSON.stringify({origin:req.headers.origin||"",contentType:req.headers["content-type"]||"",code:String(req.body?.activation_code||"").replace(/[^A-Za-z0-9]/g,"").slice(0,4)+"****"}));
  try{
    const b=req.body||{},code=normalizeActivationCode(b.activation_code),uid=String(b.device_uid||"").trim();
    if(code.length<6||!uid)return res.status(400).json({ok:false,error:"Código de ativação e identificador do dispositivo são obrigatórios."});
    const result=await resolveDeviceActivation(code,uid,b.device_name,b.platform);
    return res.status(result.status||200).json(result);
  }catch(e){return res.status(500).json({ok:false,error:e.message})}
});

app.post("/api/device/check",async(req,res)=>{
  console.log("GC CHECK REQUEST",JSON.stringify({origin:req.headers.origin||"",contentType:req.headers["content-type"]||""}));
  try{
    const b=req.body||{},code=normalizeActivationCode(b.activation_code),uid=String(b.device_uid||"").trim();
    if(code.length<6||!uid)return res.status(400).json({ok:false,active:false,reason:"missing_credentials"});
    const client=await loadClientForActivation(code);
    if(!client)return res.status(404).json({ok:false,active:false,reason:"invalid_code"});
    const clientStatus=String(client.status||"").trim().toLowerCase();
    if(["blocked","inactive","expired","disabled"].includes(clientStatus))return res.status(403).json({ok:false,active:false,reason:"client_blocked"});
    if(clientStatus!=="active"){
      await (await db()).query("update clients set status='active',updated_at=now() where id=$1",[client.id]);
      client.status="active";
    }
    if(!client.list_id||!client.expires_at||new Date(client.expires_at)<=new Date()||client.list_status==="expired"){
      return res.status(403).json({ok:false,active:false,reason:"expired",expires_at:client.expires_at||null});
    }
    const p=await db();
    const d=(await p.query("select id,status,device_name,platform from devices where client_id=$1 and device_uid=$2 limit 1",[client.id,uid])).rows[0];
    if(!d)return res.status(404).json({ok:false,active:false,reason:"device_revoked"});
    if(d.status==="blocked")return res.status(403).json({ok:false,active:false,reason:"device_revoked"});
    await p.query("update devices set status='online',last_seen_at=now() where id=$1",[d.id]);
    return res.json({ok:true,active:true,device_id:d.id,client_id:client.id,list_id:client.list_id,expires_at:client.expires_at,list_name:client.list_name});
  }catch(e){return res.status(500).json({ok:false,active:false,reason:"server_error",error:e.message})}
});


function sha(v){return crypto.createHash("sha256").update(String(v||"")).digest("hex").slice(0,40)}
function cleanNum(v,max=999999){const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(max,n)):null}
function normalizeTelemetryBody(b){
  return {
    activation_code:normalizeActivationCode(b.activation_code),
    device_uid:String(b.device_uid||"").trim(),
    device_name:String(b.device_name||"GC PLAY PRO").slice(0,160),
    platform:String(b.platform||"").slice(0,160),
    online:b.online===false?false:true,
    network_rtt_ms:cleanNum(b.network_rtt_ms,60000),
    backend_rtt_ms:cleanNum(b.backend_rtt_ms,60000),
    network_downlink_mbps:cleanNum(b.network_downlink_mbps,10000),
    network_effective_type:String(b.network_effective_type||"").slice(0,40)
  };
}
async function findActiveDevice(code,uid){
  const p=await db();
  const q=await p.query(`select d.id,d.client_id,d.device_uid,d.status,c.list_id,l.name list_name
    from devices d join clients c on c.id=d.client_id
    left join provider_lists l on l.id=c.list_id
    where upper(c.activation_code)=upper($1) and d.device_uid=$2 limit 1`,[code,uid]);
  const d=q.rows[0];
  if(!d||d.status==="blocked") return null;
  return d;
}
function diagnosticStatus(m){
  if(m.online===false)return "offline";
  if(m.backend_rtt_ms!=null && m.backend_rtt_ms>1000)return "internet_slow";
  if(m.network_rtt_ms!=null && m.network_rtt_ms>250)return "internet_unstable";
  if(m.network_downlink_mbps!=null && m.network_downlink_mbps<2)return "internet_slow";
  return "ok";
}

app.post("/api/telemetry/heartbeat",async(req,res)=>{
  try{
    const m=normalizeTelemetryBody(req.body||{});
    if(m.activation_code.length<6||!m.device_uid)return res.status(400).json({ok:false,error:"Credenciais do dispositivo ausentes."});
    const d=await findActiveDevice(m.activation_code,m.device_uid);
    if(!d)return res.status(403).json({ok:false,error:"Dispositivo não está ativo. Solicite nova ativação."});
    const p=await db(),st=diagnosticStatus(m);
    await p.query(`update devices set last_seen_at=now(),device_name=$1,platform=$2,network_online=$3,network_rtt_ms=$4,backend_rtt_ms=$5,network_downlink_mbps=$6,network_effective_type=$7,diagnostics_status=$8,status='online' where id=$9`,
      [m.device_name,m.platform,m.online,m.network_rtt_ms,m.backend_rtt_ms,m.network_downlink_mbps,m.network_effective_type,st,d.id]);
    res.json({ok:true,device_id:d.id,status:st,server_time:new Date().toISOString()});
  }catch(e){res.status(500).json({ok:false,error:e.message})}
});

app.post("/api/telemetry/playback",async(req,res)=>{
  try{
    const b=req.body||{},m=normalizeTelemetryBody(b);
    const event=String(b.event_type||"").toLowerCase();
    const allowed=new Set(["start","playing","waiting","stalled","error","recovered","ended"]);
    if(!allowed.has(event)||m.activation_code.length<6||!m.device_uid)return res.status(400).json({ok:false,error:"Evento ou credenciais inválidos."});
    const d=await findActiveDevice(m.activation_code,m.device_uid);
    if(!d)return res.status(403).json({ok:false,error:"Dispositivo não está ativo."});
    const streamName=String(b.stream_name||"Conteúdo").slice(0,300);
    const streamType=String(b.stream_type||"unknown").slice(0,30);
    const streamKey=sha(String(d.list_id||"")+"|"+String(b.stream_key||streamName)+"|"+streamType);
    const p=await db();
    const startup=cleanNum(b.startup_ms,3600000),buffer=cleanNum(b.buffer_seconds,86400);
    const errCode=String(b.error_code||"").slice(0,100),errMsg=String(b.error_message||"").slice(0,500);
    await p.query(`insert into playback_events(client_id,device_id,list_id,event_type,stream_key,stream_name,stream_type,occurred_at,startup_ms,buffer_seconds,network_rtt_ms,network_downlink_mbps,network_effective_type,online,error_code,error_message,details)
      values($1,$2,$3,$4,$5,$6,$7,now(),$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [d.client_id,d.id,d.list_id,event,streamKey,streamName,streamType,startup,buffer,m.network_rtt_ms,m.network_downlink_mbps,m.network_effective_type,m.online,errCode,errMsg,JSON.stringify({browser:String(b.browser||"").slice(0,200)})]);
    const status=event==="error"?"error":(event==="waiting"||event==="stalled"?"unstable":"ok");
    await p.query(`insert into channel_health(list_id,stream_key,stream_name,stream_type,status,client_reports,error_reports,buffer_reports,last_error,last_checked_at,last_ok_at,details)
      values($1,$2,$3,$4,$5,1,$6,$7,$8,now(),case when $5='ok' then now() else null end,$9)
      on conflict(list_id,stream_key) do update set
        stream_name=excluded.stream_name,stream_type=excluded.stream_type,
        client_reports=channel_health.client_reports+1,
        error_reports=channel_health.error_reports+excluded.error_reports,
        buffer_reports=channel_health.buffer_reports+excluded.buffer_reports,
        status=case when excluded.status='error' then 'error' when excluded.status='unstable' then 'unstable' else 'ok' end,
        last_error=coalesce(nullif(excluded.last_error,''),channel_health.last_error),
        last_checked_at=now(),
        last_ok_at=case when excluded.status='ok' then now() else channel_health.last_ok_at end,
        details=excluded.details`,
      [d.list_id,streamKey,streamName,streamType,status,event==="error"?1:0,(event==="waiting"||event==="stalled")?1:0,errMsg,JSON.stringify({source:"client"})]);
    const deviceStatus=event==="error"?"playback_error":(event==="waiting"||event==="stalled"?"buffering":"ok");
    await p.query(`update devices set last_seen_at=now(),last_playback_at=now(),last_playback_error=$1,last_buffer_seconds=$2,last_stream_name=$3,last_stream_type=$4,diagnostics_status=$5,network_online=$6,network_rtt_ms=$7,network_downlink_mbps=$8,network_effective_type=$9 where id=$10`,
      [errMsg||null,buffer||0,streamName,streamType,deviceStatus,m.online,m.network_rtt_ms,m.network_downlink_mbps,m.network_effective_type,d.id]);
    res.json({ok:true,stream_key:streamKey});
  }catch(e){res.status(500).json({ok:false,error:e.message})}
});

app.get("/api/diagnostics/overview",auth,async(_req,res)=>{
  try{
    const p=await db();
    const [dev,events,channels,lists]=await Promise.all([
      p.query(`select count(*)::int total,
        count(*) filter(where last_seen_at>now()-interval '3 minutes')::int online,
        count(*) filter(where diagnostics_status in ('internet_slow','internet_unstable'))::int network_issues,
        count(*) filter(where diagnostics_status in ('buffering','playback_error'))::int playback_issues
        from devices where status<>'blocked'`),
      p.query(`select count(*)::int total,
        count(*) filter(where event_type='error')::int errors,
        count(*) filter(where event_type in ('waiting','stalled'))::int buffering,
        count(distinct client_id)::int clients_affected
        from playback_events where occurred_at>now()-interval '15 minutes'`),
      p.query(`select count(*)::int total,
        count(*) filter(where status='error')::int errors,
        count(*) filter(where status='unstable')::int unstable
        from channel_health`),
      p.query(`select count(*)::int total,
        count(*) filter(where health_status='error')::int errors,
        count(*) filter(where health_status='unstable')::int unstable
        from provider_lists`)
    ]);
    res.json({ok:true,window_minutes:15,devices:dev.rows[0],playback:events.rows[0],channels:channels.rows[0],lists:lists.rows[0]});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get("/api/diagnostics/details",auth,async(req,res)=>{
  try{
    const p=await db();
    const [devices,channels,events]=await Promise.all([
      p.query(`select d.id,d.client_id,c.name client_name,d.device_name,d.platform,d.last_seen_at,d.status,d.diagnostics_status,d.network_online,d.network_rtt_ms,d.backend_rtt_ms,d.network_downlink_mbps,d.network_effective_type,d.last_playback_at,d.last_playback_error,d.last_buffer_seconds,d.last_stream_name,d.last_stream_type,l.name list_name
        from devices d join clients c on c.id=d.client_id left join provider_lists l on l.id=c.list_id
        where d.status<>'blocked' order by d.last_seen_at desc nulls last`),
      p.query(`select h.*,l.name list_name from channel_health h left join provider_lists l on l.id=h.list_id
        where h.last_checked_at>now()-interval '24 hours' order by case h.status when 'error' then 1 when 'unstable' then 2 else 3 end,h.last_checked_at desc limit 100`),
      p.query(`select e.occurred_at,e.event_type,e.stream_name,e.stream_type,e.startup_ms,e.buffer_seconds,e.network_rtt_ms,e.network_downlink_mbps,e.error_code,e.error_message,c.name client_name,d.device_name,l.name list_name
        from playback_events e left join clients c on c.id=e.client_id left join devices d on d.id=e.device_id left join provider_lists l on l.id=e.list_id
        where e.occurred_at>now()-interval '24 hours' order by e.occurred_at desc limit 120`)
    ]);
    res.json({ok:true,devices:devices.rows,channels:channels.rows,events:events.rows});
  }catch(e){res.status(500).json({error:e.message})}
});

async function probeUrl(url,timeout=7000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const u=String(url||"");
    const r=await fetch(u,{method:"GET",headers:{"User-Agent":"GC-PLAY-PRO-MONITOR/1.0","Range":"bytes=0-2047","Accept":"*/*"},signal:controller.signal,redirect:"follow"});
    const ct=String(r.headers.get("content-type")||"").toLowerCase();
    const reader=r.body?.getReader();
    let bytes=0;
    if(reader){const x=await reader.read();bytes=x.value?.byteLength||0;try{await reader.cancel()}catch{}}
    const ok=r.ok&&bytes>0&&!ct.includes("text/html");
    return {ok,status:r.status,contentType:ct,bytes};
  }catch(e){return {ok:false,status:0,error:e.name==="AbortError"?"timeout":e.message}}
  finally{clearTimeout(timer)}
}

app.post("/api/diagnostics/probe-list/:id",auth,async(req,res)=>{
  try{
    const p=await db(),q=await p.query("select * from provider_lists where id=$1",[req.params.id]),l=q.rows[0];
    if(!l)return res.status(404).json({error:"Lista não encontrada."});
    if(!l.server_url||!l.username||!l.provider_password)return res.status(400).json({error:"Credenciais da lista indisponíveis."});
    const base=serverOf(l.server_url);
    const apiUrl=new URL("/player_api.php",base);apiUrl.searchParams.set("username",l.username);apiUrl.searchParams.set("password",l.provider_password);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
    let authOk=false,streams=[];
    try{
      const r=await fetch(apiUrl,{headers:{"User-Agent":"GC-PLAY-PRO-MONITOR/1.0","Accept":"application/json"},signal:controller.signal});
      const x=await r.json();authOk=r.ok&&!!x?.user_info&&String(x.user_info.auth??"1")!=="0";
      clearTimeout(timer);
      if(authOk){
        const u=new URL("/player_api.php",base);u.searchParams.set("username",l.username);u.searchParams.set("password",l.provider_password);u.searchParams.set("action","get_live_streams");
        const sr=await fetch(u,{headers:{"User-Agent":"GC-PLAY-PRO-MONITOR/1.0","Accept":"application/json"},signal:AbortSignal.timeout(10000)});
        const arr=await sr.json();streams=Array.isArray(arr)?arr.slice(0,8):[];
      }
    }catch(e){clearTimeout(timer);authOk=false}
    const results=[];
    for(const row of streams){
      const id=row?.stream_id??row?.id;if(id==null)continue;
      const ext=String(row?.container_extension||"ts").replace(/^\./,"")||"ts";
      const url=new URL("/live/"+encodeURIComponent(l.username)+"/"+encodeURIComponent(l.provider_password)+"/"+encodeURIComponent(id)+"."+ext,base);
      const probe=await probeUrl(url.toString(),6500);
      const key=sha(String(l.id)+"|"+String(row.name||id)+"|live");
      const status=probe.ok?"ok":(probe.error==="timeout"?"unstable":"error");
      await p.query(`insert into channel_health(list_id,stream_key,stream_name,stream_type,status,score,last_checked_at,last_ok_at,last_error,details)
        values($1,$2,$3,'live',$4,$5,now(),case when $4='ok' then now() else null end,$6,$7)
        on conflict(list_id,stream_key) do update set status=excluded.status,score=excluded.score,last_checked_at=now(),last_ok_at=case when excluded.status='ok' then now() else channel_health.last_ok_at end,last_error=excluded.last_error,details=excluded.details`,
        [l.id,key,String(row.name||id),status,probe.ok?100:0,probe.error||("HTTP "+probe.status),JSON.stringify({probe})]);
      results.push({name:String(row.name||id),status,probe});
    }
    const good=results.filter(x=>x.status==="ok").length,score=results.length?Math.round(good/results.length*100):(authOk?70:0);
    const hs=score<50?"error":score<90?"unstable":"ok";
    await p.query("update provider_lists set health_status=$1,health_score=$2,health_checked_at=now(),health_details=$3 where id=$4",[hs,score,JSON.stringify({authOk,sampled:results.length,results}),l.id]);
    res.json({ok:true,list_id:l.id,status:hs,score,sampled:results.length,results});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get("/api/data",auth,async(_req,res)=>{try{res.json({ok:true,...await dashboardData()})}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/clients",auth,async(req,res)=>{try{const x=req.body||{},p=await db();const q=await p.query("insert into clients(name,email,phone,plan,list_id,device_limit,status,activation_code) values($1,$2,$3,$4,$5,$6,'active',$7) returning *",[x.name,x.email||null,x.phone||null,x.plan||"Mensal",x.list_id||null,Number(x.device_limit)||1,String(x.activation_code||crypto.randomUUID().replaceAll("-","").slice(0,8).toUpperCase())]);res.json({ok:true,client:q.rows[0]})}catch(e){res.status(500).json({error:e.message})}});
app.patch("/api/clients/:id",auth,async(req,res)=>{try{const x=req.body||{},p=await db();const q=await p.query("update clients set name=$1,plan=$2,device_limit=$3,list_id=$4,status=coalesce($5,status),updated_at=now() where id=$6 returning *",[x.name,x.plan,Number(x.device_limit)||1,x.list_id||null,x.status||null,req.params.id]);res.json({ok:true,client:q.rows[0]})}catch(e){res.status(500).json({error:e.message})}});
app.delete("/api/clients/:id",auth,async(req,res)=>{try{await (await db()).query("delete from clients where id=$1",[req.params.id]);res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
function serverOf(v){try{return new URL(v).origin}catch{return v}}
async function syncList(id){const p=await db(),q=await p.query("select * from provider_lists where id=$1",[id]),l=q.rows[0];if(!l)throw new Error("Lista não encontrada.");const old=l.expires_at;if(!l.server_url||!l.username||!l.provider_password)throw new Error("Credenciais da lista ausentes no Render.");const u=new URL("/player_api.php",serverOf(l.server_url));u.searchParams.set("username",l.username);u.searchParams.set("password",l.provider_password);const r=await fetch(u,{headers:{"User-Agent":"GC-PLAY-PRO-MANAGER/Render","Accept":"application/json"},signal:AbortSignal.timeout(15000)});const raw=await r.text();if(!r.ok)throw new Error("Servidor respondeu HTTP "+r.status);let x;try{x=JSON.parse(raw)}catch{throw new Error("Servidor não retornou JSON Xtream.")}if(!x?.user_info)throw new Error("Resposta sem user_info.");const exp=(()=>{const n=Number(x.user_info.exp_date);if(!Number.isFinite(n))return null;return new Date(n<100000000000?n*1000:n).toISOString()})();const ps=String(x.user_info.status||"unknown"),now=new Date(),expired=exp&&new Date(exp)<=now,soon=exp&&new Date(exp).getTime()<=now.getTime()+604800000,st=expired||/expired|disabled|inactive/i.test(ps)?"expired":soon?"expiring":"active";await p.query("update provider_lists set server_url=$1,expires_at=$2,provider_status=$3,status=$4,last_sync_at=now(),last_error=null,max_connections=$5,active_connections=$6 where id=$7",[serverOf(l.server_url),exp,ps,st,Number(x.user_info.max_connections)||1,Number(x.user_info.active_cons)||0,id]);await p.query("insert into sync_logs(list_id,status,old_expiry,new_expiry,details) values($1,'success',$2,$3,$4)",[id,old,exp,JSON.stringify({provider_status:ps})]);return{ok:true,id,name:l.name,new_expiry:exp,status:st,provider_status:ps}}
app.post("/api/sync",auth,async(req,res)=>{try{const p=await db(),ids=req.body?.all?(await p.query("select id from provider_lists")).rows.map(x=>x.id):[req.body?.list_id];const results=[];for(const id of ids.filter(Boolean)){try{results.push(await syncList(id))}catch(e){const msg=e.message;await p.query("update provider_lists set status='error',last_sync_at=now(),last_error=$1 where id=$2",[msg,id]);await p.query("insert into sync_logs(list_id,status,details) values($1,'error',$2)",[id,msg]);results.push({id,ok:false,error:msg})}}res.json({ok:results.every(x=>x.ok),count:results.length,results})}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/lists",auth,async(req,res)=>{try{const x=req.body||{};if(!x.name||!x.server_url||!x.username||!x.provider_password)return res.status(400).json({error:"Nome, servidor, usuário e senha são obrigatórios."});const p=await db(),q=await p.query("insert into provider_lists(name,source_url,server_url,username,provider_password,status,max_connections) values($1,$2,$3,$4,$5,'unknown',1) returning id,name,server_url,username,expires_at,status,provider_status,max_connections,active_connections,last_sync_at,last_error,created_at",[x.name,x.source_url||null,serverOf(x.server_url),x.username,x.provider_password]);const s=await syncList(q.rows[0].id);res.json({ok:true,list:(await p.query("select id,name,server_url,username,expires_at,status,provider_status,max_connections,active_connections,last_sync_at,last_error,health_status,health_score,health_checked_at,health_details,created_at from provider_lists where id=$1",[q.rows[0].id])).rows[0],sync:s})}catch(e){res.status(500).json({error:e.message})}});
app.patch("/api/lists/:id",auth,async(req,res)=>{try{const p=await db(),x=req.body||{};const q=await p.query("update provider_lists set name=$1 where id=$2 returning id,name,server_url,username,expires_at,status,provider_status,max_connections,active_connections,last_sync_at,last_error,created_at",[x.name,req.params.id]);res.json({ok:true,list:q.rows[0]})}catch(e){res.status(500).json({error:e.message})}});
app.delete("/api/lists/:id",auth,async(req,res)=>{try{await (await db()).query("delete from provider_lists where id=$1",[req.params.id]);res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});

app.delete("/api/devices/:id",auth,async(req,res)=>{
  try{
    const p=await db();
    const d=(await p.query("select id,client_id,device_uid from devices where id=$1",[req.params.id])).rows[0];
    if(!d)return res.status(404).json({error:"Dispositivo não encontrado."});
    await p.query("update activations set revoked_at=coalesce(revoked_at,now()) where device_id=$1 and revoked_at is null",[req.params.id]);
    await p.query("delete from devices where id=$1",[req.params.id]);
    res.json({ok:true,revoked_device_id:req.params.id});
  }catch(e){res.status(500).json({error:e.message})}
});

app.post("/api/migration/import",async(req,res)=>{try{if(!MIGRATION_TOKEN||req.headers["x-migration-token"]!==MIGRATION_TOKEN)return res.status(401).json({error:"Migration token inválido."});const b=req.body||{},p=await db(),c=await p.connect();try{await c.query("BEGIN");for(const x of b.provider_lists||[])await c.query("insert into provider_lists(id,name,source_url,server_url,username,provider_password,expires_at,provider_status,status,max_connections,active_connections,last_sync_at,last_error,created_by,provider_secret_id,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) on conflict(id) do update set name=excluded.name,source_url=excluded.source_url,server_url=excluded.server_url,username=excluded.username,provider_password=excluded.provider_password,expires_at=excluded.expires_at,provider_status=excluded.provider_status,status=excluded.status,max_connections=excluded.max_connections,active_connections=excluded.active_connections,last_sync_at=excluded.last_sync_at,last_error=excluded.last_error,created_by=excluded.created_by,provider_secret_id=excluded.provider_secret_id,updated_at=excluded.updated_at",[x.id,x.name,x.source_url,x.server_url,x.username,x.provider_password,x.expires_at,x.provider_status,x.status,x.max_connections??1,x.active_connections??0,x.last_sync_at,x.last_error,x.created_by,x.provider_secret_id,x.created_at,x.updated_at]);for(const x of b.clients||[])await c.query("insert into clients(id,name,email,phone,plan,list_id,device_limit,status,activation_code,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict(id) do update set name=excluded.name,email=excluded.email,phone=excluded.phone,plan=excluded.plan,list_id=excluded.list_id,device_limit=excluded.device_limit,status=excluded.status,activation_code=excluded.activation_code,updated_at=excluded.updated_at",[x.id,x.name,x.email,x.phone,x.plan,x.list_id,x.device_limit??1,x.status,x.activation_code,x.created_at,x.updated_at]);for(const x of b.devices||[])await c.query("insert into devices(id,client_id,device_uid,device_name,platform,last_seen_at,status,created_at) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(id) do update set client_id=excluded.client_id,device_uid=excluded.device_uid,device_name=excluded.device_name,platform=excluded.platform,last_seen_at=excluded.last_seen_at,status=excluded.status",[x.id,x.client_id,x.device_uid,x.device_name,x.platform,x.last_seen_at,x.status,x.created_at]);for(const x of b.activations||[])await c.query("insert into activations(id,client_id,device_id,activation_code,activated_at,revoked_at) values($1,$2,$3,$4,$5,$6) on conflict(id) do update set client_id=excluded.client_id,device_id=excluded.device_id,activation_code=excluded.activation_code,activated_at=excluded.activated_at,revoked_at=excluded.revoked_at",[x.id,x.client_id,x.device_id,x.activation_code,x.activated_at,x.revoked_at]);for(const x of b.sync_logs||[])await c.query("insert into sync_logs(id,list_id,status,old_expiry,new_expiry,details,created_at) values($1,$2,$3,$4,$5,$6,$7) on conflict(id) do update set list_id=excluded.list_id,status=excluded.status,old_expiry=excluded.old_expiry,new_expiry=excluded.new_expiry,details=excluded.details,created_at=excluded.created_at",[x.id,x.list_id,x.status,x.old_expiry,x.new_expiry,x.details,x.created_at]);for(const x of b.admin_profiles||[])await c.query("insert into admin_profiles(id,full_name,role,created_at) values($1,$2,$3,$4) on conflict(id) do update set full_name=excluded.full_name,role=excluded.role",[x.id,x.full_name,x.role,x.created_at]);await c.query("select setval(pg_get_serial_sequence('sync_logs','id'),coalesce((select max(id) from sync_logs),1),true)");await c.query("commit")}catch(e){await c.query("rollback");throw e}finally{c.release()}res.json({ok:true,imported:{lists:(b.provider_lists||[]).length,clients:(b.clients||[]).length,devices:(b.devices||[]).length,activations:(b.activations||[]).length,sync_logs:(b.sync_logs||[]).length,admin_profiles:(b.admin_profiles||[]).length}})}catch(e){res.status(500).json({ok:false,error:e.message})}});
app.use(express.static("."));
app.listen(PORT,()=>{init().catch(e=>console.error("GC DB init:",e));console.log("GC PLAY PRO backend listening on "+PORT)});
