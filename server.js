import express from "express";
import pg from "pg";
const {Pool}=pg;
const app=express();
app.use(express.json({limit:"25mb"}));
const PORT=process.env.PORT||10000;
const DATABASE_URL=process.env.DATABASE_URL||"";
const SUPABASE_URL=process.env.SUPABASE_URL||"";
const SUPABASE_KEY=process.env.SUPABASE_KEY||"";
const RENDER_ALLOWED_ORIGIN="https://caiomendes29546874687.github.io";

app.use((req,res,next)=>{
  const origin=req.headers.origin;
  if(!origin || origin===RENDER_ALLOWED_ORIGIN){
    res.setHeader("Access-Control-Allow-Origin",origin||RENDER_ALLOWED_ORIGIN);
    res.setHeader("Vary","Origin");
    res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, apikey, x-client-info");
    res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  }
  if(req.method==="OPTIONS")return res.sendStatus(204);
  next();
});
let pool=null;

function getPool(){
  if(!DATABASE_URL) return null;
  if(!pool) pool=new Pool({connectionString:DATABASE_URL,ssl:{rejectUnauthorized:false},max:5});
  return pool;
}
async function db(){const p=getPool();if(!p)throw new Error("DATABASE_URL não configurada no Render.");return p;}
async function init(){
  const p=getPool(); if(!p){console.warn("GC DB: DATABASE_URL ausente; serviço inicia em modo configuração.");return;}
  const fs=await import("node:fs/promises");
  await p.query(await fs.readFile(new URL("./schema.sql",import.meta.url),"utf8"));
  console.log("GC DB: schema pronto.");
}
async function supabaseFetch(path,token){
  if(!SUPABASE_URL||!SUPABASE_KEY)throw new Error("Supabase de origem não configurado no Render.");
  const r=await fetch(SUPABASE_URL+"/rest/v1/"+path,{headers:{apikey:SUPABASE_KEY,Authorization:"Bearer "+token,Accept:"application/json"},signal:AbortSignal.timeout(30000)});
  const raw=await r.text();
  if(!r.ok)throw new Error("Supabase REST HTTP "+r.status+": "+raw.slice(0,500));
  return raw?JSON.parse(raw):[];
}
async function supabaseUser(token){
  if(!SUPABASE_URL||!SUPABASE_KEY||!token)return null;
  const r=await fetch(SUPABASE_URL+"/auth/v1/user",{headers:{apikey:SUPABASE_KEY,Authorization:"Bearer "+token}});
  if(!r.ok)return null; return r.json();
}
function rowsObject(rows){return rows.map(r=>({...r}));}

app.get("/health",async(_req,res)=>{
  let database="not_configured";
  try{const p=getPool();if(p){await p.query("select 1");database="ok";}}catch(e){database="error";}
  res.json({ok:true,service:"gc-play-pro-backend",database,version:"render-migration-1"});
});

app.get("/api/status",async(_req,res)=>{
  try{const p=await db();const q=await p.query("select (select count(*) from provider_lists) lists,(select count(*) from clients) clients,(select count(*) from devices) devices,(select count(*) from activations) activations,(select count(*) from sync_logs) sync_logs,(select count(*) from admin_profiles) admin_profiles");res.json({ok:true,...q.rows[0]});}
  catch(e){res.status(503).json({ok:false,error:e.message});}
});

app.post("/api/migration/pull",async(req,res)=>{
  try{
    const auth=(req.headers.authorization||"").replace(/^Bearer\\s+/i,"");
    const u=await supabaseUser(auth);
    if(!u?.id)return res.status(401).json({error:"Sessão Supabase inválida."});
    const admins=await supabaseFetch("admin_profiles?id=eq."+encodeURIComponent(u.id)+"&select=id,role",auth);
    if(!admins?.some(x=>x.role==="admin"))return res.status(403).json({error:"Acesso de administrador necessário."});
    const tables=["provider_lists","clients","devices","activations","sync_logs","admin_profiles"];
    const data={};
    for(const table of tables)data[table]=await supabaseFetch(table+"?select=*",auth);
    const p=await db(); const client=await p.connect();
    try{
      await client.query("BEGIN");
      for(const x of data.provider_lists||[])await client.query(`INSERT INTO provider_lists(id,name,source_url,server_url,username,provider_password,expires_at,provider_status,status,max_connections,active_connections,last_sync_at,last_error,created_by,provider_secret_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,source_url=EXCLUDED.source_url,server_url=EXCLUDED.server_url,username=EXCLUDED.username,provider_password=EXCLUDED.provider_password,expires_at=EXCLUDED.expires_at,provider_status=EXCLUDED.provider_status,status=EXCLUDED.status,max_connections=EXCLUDED.max_connections,active_connections=EXCLUDED.active_connections,last_sync_at=EXCLUDED.last_sync_at,last_error=EXCLUDED.last_error,created_by=EXCLUDED.created_by,provider_secret_id=EXCLUDED.provider_secret_id,updated_at=EXCLUDED.updated_at`,[x.id,x.name,x.source_url,x.server_url,x.username,x.provider_password,x.expires_at,x.provider_status,x.status,x.max_connections??1,x.active_connections??0,x.last_sync_at,x.last_error,x.created_by,x.provider_secret_id,x.created_at,x.updated_at]);
      for(const x of data.clients||[])await client.query(`INSERT INTO clients(id,name,email,phone,plan,list_id,device_limit,status,activation_code,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,phone=EXCLUDED.phone,plan=EXCLUDED.plan,list_id=EXCLUDED.list_id,device_limit=EXCLUDED.device_limit,status=EXCLUDED.status,activation_code=EXCLUDED.activation_code,updated_at=EXCLUDED.updated_at`,[x.id,x.name,x.email,x.phone,x.plan,x.list_id,x.device_limit??1,x.status,x.activation_code,x.created_at,x.updated_at]);
      for(const x of data.devices||[])await client.query(`INSERT INTO devices(id,client_id,device_uid,device_name,platform,last_seen_at,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET client_id=EXCLUDED.client_id,device_uid=EXCLUDED.device_uid,device_name=EXCLUDED.device_name,platform=EXCLUDED.platform,last_seen_at=EXCLUDED.last_seen_at,status=EXCLUDED.status`,[x.id,x.client_id,x.device_uid,x.device_name,x.platform,x.last_seen_at,x.status,x.created_at]);
      for(const x of data.activations||[])await client.query(`INSERT INTO activations(id,client_id,device_id,activation_code,activated_at,revoked_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET client_id=EXCLUDED.client_id,device_id=EXCLUDED.device_id,activation_code=EXCLUDED.activation_code,activated_at=EXCLUDED.activated_at,revoked_at=EXCLUDED.revoked_at`,[x.id,x.client_id,x.device_id,x.activation_code,x.activated_at,x.revoked_at]);
      for(const x of data.sync_logs||[])await client.query(`INSERT INTO sync_logs(id,list_id,status,old_expiry,new_expiry,details,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET list_id=EXCLUDED.list_id,status=EXCLUDED.status,old_expiry=EXCLUDED.old_expiry,new_expiry=EXCLUDED.new_expiry,details=EXCLUDED.details,created_at=EXCLUDED.created_at`,[x.id,x.list_id,x.status,x.old_expiry,x.new_expiry,x.details,x.created_at]);
      for(const x of data.admin_profiles||[])await client.query(`INSERT INTO admin_profiles(id,full_name,role,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET full_name=EXCLUDED.full_name,role=EXCLUDED.role`,[x.id,x.full_name,x.role,x.created_at]);
      await client.query("SELECT setval(pg_get_serial_sequence('sync_logs','id'),COALESCE((SELECT MAX(id) FROM sync_logs),1),true)");
      await client.query("COMMIT");
      const q=await client.query("select (select count(*) from provider_lists) lists,(select count(*) from clients) clients,(select count(*) from devices) devices,(select count(*) from activations) activations,(select count(*) from sync_logs) sync_logs,(select count(*) from admin_profiles) admin_profiles");
      res.json({ok:true,source:"supabase",destination:"render",imported:q.rows[0]});
    }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
  }catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.post("/api/migration/import",async(req,res)=>{
  try{
    const auth=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
    const u=await supabaseUser(auth);
    if(!u?.id)return res.status(401).json({error:"Sessão Supabase inválida."});
    const body=req.body||{}; const p=await db(); const client=await p.connect();
    try{
      await client.query("BEGIN");
      const tables=["provider_lists","clients","devices","activations","sync_logs","admin_profiles"];
      for(const table of tables){
        const items=Array.isArray(body[table])?body[table]:[];
        if(!items.length)continue;
        if(table==="provider_lists"){
          for(const x of items)await client.query(`INSERT INTO provider_lists(id,name,source_url,server_url,username,provider_password,expires_at,provider_status,status,max_connections,active_connections,last_sync_at,last_error,created_by,provider_secret_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,source_url=EXCLUDED.source_url,server_url=EXCLUDED.server_url,username=EXCLUDED.username,provider_password=EXCLUDED.provider_password,expires_at=EXCLUDED.expires_at,provider_status=EXCLUDED.provider_status,status=EXCLUDED.status,max_connections=EXCLUDED.max_connections,active_connections=EXCLUDED.active_connections,last_sync_at=EXCLUDED.last_sync_at,last_error=EXCLUDED.last_error,created_by=EXCLUDED.created_by,provider_secret_id=EXCLUDED.provider_secret_id,updated_at=EXCLUDED.updated_at`,[x.id,x.name,x.source_url,x.server_url,x.username,x.provider_password,x.expires_at,x.provider_status,x.status,x.max_connections??1,x.active_connections??0,x.last_sync_at,x.last_error,x.created_by,x.provider_secret_id,x.created_at,x.updated_at]);
        } else if(table==="clients"){
          for(const x of items)await client.query(`INSERT INTO clients(id,name,email,phone,plan,list_id,device_limit,status,activation_code,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,phone=EXCLUDED.phone,plan=EXCLUDED.plan,list_id=EXCLUDED.list_id,device_limit=EXCLUDED.device_limit,status=EXCLUDED.status,activation_code=EXCLUDED.activation_code,updated_at=EXCLUDED.updated_at`,[x.id,x.name,x.email,x.phone,x.plan,x.list_id,x.device_limit??1,x.status,x.activation_code,x.created_at,x.updated_at]);
        } else if(table==="devices"){
          for(const x of items)await client.query(`INSERT INTO devices(id,client_id,device_uid,device_name,platform,last_seen_at,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET client_id=EXCLUDED.client_id,device_uid=EXCLUDED.device_uid,device_name=EXCLUDED.device_name,platform=EXCLUDED.platform,last_seen_at=EXCLUDED.last_seen_at,status=EXCLUDED.status`,[x.id,x.client_id,x.device_uid,x.device_name,x.platform,x.last_seen_at,x.status,x.created_at]);
        } else if(table==="activations"){
          for(const x of items)await client.query(`INSERT INTO activations(id,client_id,device_id,activation_code,activated_at,revoked_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET client_id=EXCLUDED.client_id,device_id=EXCLUDED.device_id,activation_code=EXCLUDED.activation_code,activated_at=EXCLUDED.activated_at,revoked_at=EXCLUDED.revoked_at`,[x.id,x.client_id,x.device_id,x.activation_code,x.activated_at,x.revoked_at]);
        } else if(table==="sync_logs"){
          for(const x of items)await client.query(`INSERT INTO sync_logs(id,list_id,status,old_expiry,new_expiry,details,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET list_id=EXCLUDED.list_id,status=EXCLUDED.status,old_expiry=EXCLUDED.old_expiry,new_expiry=EXCLUDED.new_expiry,details=EXCLUDED.details,created_at=EXCLUDED.created_at`,[x.id,x.list_id,x.status,x.old_expiry,x.new_expiry,x.details,x.created_at]);
        } else if(table==="admin_profiles"){
          for(const x of items)await client.query(`INSERT INTO admin_profiles(id,full_name,role,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET full_name=EXCLUDED.full_name,role=EXCLUDED.role`,[x.id,x.full_name,x.role,x.created_at]);
        }
      }
      await client.query("COMMIT");
      const q=await client.query("select (select count(*) from provider_lists) lists,(select count(*) from clients) clients,(select count(*) from devices) devices,(select count(*) from activations) activations,(select count(*) from sync_logs) sync_logs,(select count(*) from admin_profiles) admin_profiles");
      res.json({ok:true,imported:q.rows[0]});
    }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
  }catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.use(express.static("."));
app.listen(PORT,()=>{init().catch(e=>console.error("GC DB init:",e));console.log("GC PLAY PRO backend listening on "+PORT);});
