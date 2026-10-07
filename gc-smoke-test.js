import fs from "node:fs";

const files = [
  "app.js",
  "index.html",
  "sw.js",
  "gc-architecture-v2.js",
  "gc-architecture-bridge.js",
  "gc-final-readiness.js",
  "gc-pro-runtime.js"
];

for (const file of files) {
  if (!fs.existsSync(file)) throw new Error("Arquivo obrigatório ausente: " + file);
}

const app = fs.readFileSync("app.js", "utf8");
const index = fs.readFileSync("index.html", "utf8");
const sw = fs.readFileSync("sw.js", "utf8");
const runtime = fs.readFileSync("gc-pro-runtime.js", "utf8");

const checks = [
  ["sem proxy de vídeo Supabase", !app.includes("/functions/v1/m3u-proxy")],
  ["gateway Cloudflare configurado", /gc-catalog\.caioroberto318\.workers\.dev/.test(app)],
  ["media gateway configurado", /searchParams\.set\(["\x27]mode["\x27],\s*["\x27]media["\x27]\)/.test(app) && /buildMediaProxyUrl/.test(app)],
  ["DASH via media gateway", /isDASH\(sourceUrl\)/.test(app)],
  ["catálogo paginado", /data-load-more-catalog/.test(app) && /offset = 0/.test(app)],
  ["Xtream com timeout", /timeoutMs = action === "get_series_info" \? 30000 : 25000/.test(app)],
  ["filmes sob demanda", /ensureXtreamSectionLoaded\("movie"\)/.test(app)],
  ["séries sob demanda", /ensureXtreamSectionLoaded\("series"\)/.test(app)],
  ["runtime carregado no index", /gc-pro-runtime\.js\?v=/.test(index)],
  ["runtime no service worker", /gc-pro-runtime\.js\?v=/.test(sw)],
  ["service worker cache versionado", /gc-play-pro-v220-hls39/.test(sw)],
  ["multi-playlist", /MAX_PLAYLISTS = 8/.test(runtime)],
  ["PiP", /requestPictureInPicture/.test(runtime)],
  ["watchdog de travamento", /waiting_8s/.test(runtime)]
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error("Smoke test falhou: " + name);
  console.log("PASS:", name);
}

console.log("GC PLAY PRO smoke test: PASS");
