import express from "express";
import { Readable } from "node:stream";

const LIVE_BOOTSTRAP = "GC-LIVE-RENDER-1";
const originalListen = express.application.listen;

async function liveProxy(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type, Accept, Origin, User-Agent, Referer");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);

  const raw = String(req.query?.url || "").trim();
  if (!raw) return res.status(400).json({ ok:false, error:"missing url" });

  let target;
  try {
    target = new URL(raw);
    if (!/^https?:$/.test(target.protocol)) throw new Error("protocol");
  } catch {
    return res.status(400).json({ ok:false, error:"invalid url" });
  }

  const headers = {
    "User-Agent": String(req.headers["user-agent"] || "GC-PLAY-PRO/1.0").slice(0, 512),
    "Accept": String(req.headers.accept || "*/*").slice(0, 512)
  };
  if (req.headers.range) headers.Range = String(req.headers.range).slice(0, 256);
  const ref = String(req.query?.ref || "").trim();
  if (ref) headers.Referer = ref.slice(0, 2048);

  let upstream;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      upstream = await fetch(target, { method:"GET", headers, redirect:"follow", cache:"no-store" });
      if (![502,503,504].includes(upstream.status) || attempt === 2) break;
      await upstream.body?.cancel();
    } catch (e) {
      lastError = e;
      if (attempt === 2) break;
      await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  if (!upstream) return res.status(502).json({ok:false,error:String(lastError?.message || "upstream unavailable")});

  const ct = String(upstream.headers.get("content-type") || "").toLowerCase();
  const looksManifest = ct.includes("mpegurl") || ct.includes("m3u8") || /\.m3u8(?:$|[?#])/i.test(target.pathname);
  res.status(upstream.status);
  res.setHeader("X-GC-Live-Gateway", LIVE_BOOTSTRAP);
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  if (upstream.headers.get("content-length")) res.setHeader("Content-Length", upstream.headers.get("content-length"));
  if (upstream.headers.get("accept-ranges")) res.setHeader("Accept-Ranges", upstream.headers.get("accept-ranges"));
  if (upstream.headers.get("etag")) res.setHeader("ETag", upstream.headers.get("etag"));
  if (upstream.headers.get("last-modified")) res.setHeader("Last-Modified", upstream.headers.get("last-modified"));

  if (!looksManifest || !upstream.body) {
    if (ct) res.setHeader("Content-Type", ct);
    if (!upstream.body) return res.end();
    return Readable.fromWeb(upstream.body).pipe(res);
  }

  const text = await upstream.text();
  const gatewayBase = `${req.protocol}://${req.get("host")}${req.baseUrl || "/api/live"}`;

  const gateway = value => {
    try {
      const absolute = new URL(value, target).toString();
      return gatewayBase + "?url=" + encodeURIComponent(absolute);
    } catch {
      return value;
    }
  };

  const rewritten = text.split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/g, (_, value) => `URI="${gateway(value)}"`);
    }
    return gateway(trimmed);
  }).join("\n");

  res.setHeader("Content-Type", ct.includes("mpegurl") ? upstream.headers.get("content-type") : "application/vnd.apple.mpegurl");
  res.removeHeader("Content-Length");
  res.setHeader("Content-Length", Buffer.byteLength(rewritten, "utf8"));
  return res.end(rewritten);
}

if (!express.application.__gcLiveRenderPatched) {
  express.application.__gcLiveRenderPatched = true;
  express.application.listen = function (...args) {
    if (!this.__gcLiveRenderMounted) {
      this.__gcLiveRenderMounted = true;
      this.use("/api/live", liveProxy);
      this.get("/api/live-health", (_req, res) => res.json({ok:true, service:"gc-play-pro-backend", gateway:LIVE_BOOTSTRAP}));
    }
    return originalListen.apply(this, args);
  };
}

console.log("[GC LIVE] Render gateway bootstrap loaded:", LIVE_BOOTSTRAP);
