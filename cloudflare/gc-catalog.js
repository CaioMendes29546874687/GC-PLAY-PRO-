const ALLOW_ORIGIN = "https://caiomendes29546874687.github.io";
const CATALOG_CORS = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Accept,Range",
  "Access-Control-Expose-Headers": "Content-Type,Content-Length,Content-Range,Accept-Ranges,ETag,Last-Modified,Vary",
  "Vary": "Origin"
};
const MEDIA_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Accept,Range,Origin,Referer",
  "Access-Control-Expose-Headers": "Content-Type,Content-Length,Content-Range,Accept-Ranges,ETag,Last-Modified,Vary",
  "Accept-Ranges": "bytes"
};

function json(value, status = 200, headers = CATALOG_CORS) {
  return new Response(JSON.stringify(value), {
    status,
    headers: new Headers({
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    })
  });
}

function parsePublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw Error("URL inválida"); }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) {
    throw Error("Destino não permitido");
  }

  const h = u.hostname.toLowerCase();
  const privateHost =
    h === "localhost" || h.endsWith(".localhost") ||
    h === "metadata.google.internal" || h === "metadata" ||
    h === "instance-data.ec2.internal" || h === "0.0.0.0" || h === "::1" ||
    h.startsWith("127.") || h.startsWith("10.") || h.startsWith("192.168.") ||
    h.startsWith("169.254.") ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h) ||
    h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80:");
  if (privateHost) throw Error("Destino privado não permitido");
  return u;
}

function looksLikeCatalog(u, ct) {
  const p = u.pathname.toLowerCase();
  const t = (ct || "").toLowerCase();
  return p.endsWith(".m3u") || p.endsWith(".m3u8") || p.endsWith(".json") ||
    p.endsWith(".txt") || t.includes("mpegurl") || t.includes("m3u") ||
    t.includes("application/json") || t.includes("text/plain") ||
    p.endsWith("player_api.php") || p.endsWith("get.php") ||
    p.includes("xmltv") || p.includes("epg");
}

function looksLikeHls(u, ct) {
  const p = u.pathname.toLowerCase();
  const t = (ct || "").toLowerCase();
  return p.endsWith(".m3u8") || p.endsWith("/m3u8") || t.includes("mpegurl") || t.includes("application/x-mpegurl");
}

function looksLikeDash(u, ct) {
  const p = u.pathname.toLowerCase();
  const t = (ct || "").toLowerCase();
  return p.endsWith(".mpd") || t.includes("dash+xml") || t.includes("application/dash");
}

function rewriteDashManifest(text, baseUrl, workerOrigin, referrer = "", userAgent = "") {
  const rewrite = value => {
    const raw = String(value || "").trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("data:")) return raw;
    try {
      const absolute = new URL(raw, baseUrl).toString();
      return mediaProxyUrl(workerOrigin, absolute, referrer, userAgent);
    } catch {
      return raw;
    }
  };

  let out = String(text || "");
  out = out.replace(/(<BaseURL[^>]*>)([^<]+)(<\/BaseURL>)/gi, (_, a, value, b) => a + rewrite(value) + b);
  out = out.replace(/\b(media|initialization|sourceURL|href)="([^"]+)"/gi, (_, key, value) => key + '="' + rewrite(value) + '"');
  return out;
}

function mediaProxyUrl(workerOrigin, target, referrer = "", userAgent = "") {
  const p = new URL(workerOrigin);
  p.searchParams.set("mode", "media");
  p.searchParams.set("url", target);
  if (referrer) p.searchParams.set("ref", String(referrer).slice(0, 2048));
  if (userAgent) p.searchParams.set("ua", String(userAgent).slice(0, 2048));
  return p.toString();
}

function rewriteHlsManifest(text, baseUrl, workerOrigin, referrer = "", userAgent = "") {
  const rewrite = value => {
    const raw = String(value || "").trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("data:")) return raw;
    let absolute;
    try { absolute = new URL(raw, baseUrl).toString(); } catch { return raw; }
    return mediaProxyUrl(workerOrigin, absolute, referrer, userAgent);
  };

  let out = String(text || "");
  out = out.replace(/URI="([^"]+)"/gi, (_, uri) => 'URI="' + rewrite(uri) + '"');
  out = out.split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    return rewrite(trimmed);
  }).join("\n");
  return out;
}

async function fetchCatalog(u) {
  return fetch(u.toString(), {
    redirect: "manual",
    headers: {
      "User-Agent": "GC-PLAY-PRO-Catalog/4.0",
      "Accept": "application/vnd.apple.mpegurl,application/x-mpegURL,audio/x-mpegurl,application/json,text/plain,application/xml,text/xml,*/*"
    }
  });
}

async function fetchMedia(request, target) {
  const baseHeaders = new Headers();
  for (const name of ["Range", "Accept", "User-Agent"]) {
    const value = request.headers.get(name);
    if (value) baseHeaders.set(name, value);
  }
  const parsedRequest = new URL(request.url);
  const customReferrer = parsedRequest.searchParams.get("ref") || "";
  const customUserAgent = parsedRequest.searchParams.get("ua") || "";
  if (customReferrer) baseHeaders.set("Referer", customReferrer);
  if (customUserAgent) baseHeaders.set("User-Agent", customUserAgent);

  /*
     Compatibilidade IPTV:
     muitos servidores rejeitam Origin/Referer artificiais. A tentativa
     principal agora é a mais neutra possível (Range/Accept/User-Agent),
     que também é a que mais se aproxima de um player nativo.
     Se a origem exigir identificação por Origin/Referer, fazemos uma
     segunda tentativa com o domínio da própria origem.
  */
  const requestInit = {
    method: request.method === "HEAD" ? "HEAD" : "GET",
    redirect: "follow"
  };

  const fetchTarget = async (targetUrl, headers) => fetch(targetUrl.toString(), {
    ...requestInit,
    headers: new Headers(headers)
  });

  let upstream = await fetchTarget(target, baseHeaders);

  const firstType = upstream.headers.get("content-type") || "";
  const retryStatus = [401, 403, 406, 408, 425, 429, 500, 502, 503, 504, 522, 524].includes(upstream.status);
  const suspiciousMediaBody =
    /text\/html/i.test(firstType) &&
    (target.pathname.toLowerCase().includes(".m3u8") || target.pathname.toLowerCase().endsWith("/m3u8") || target.pathname.toLowerCase().includes(".mpd"));

  if (retryStatus || suspiciousMediaBody) {
    const providerHeaders = new Headers(baseHeaders);
    providerHeaders.set("Origin", target.origin);
    providerHeaders.set("Referer", target.origin + "/");
    upstream = await fetchTarget(target, providerHeaders);
  }

  /*
     Alguns provedores IPTV respondem por HTTP, mas o endpoint HTTPS
     é o que realmente está disponível para o Worker. Quando o HTTP
     termina em 522/524, tente a mesma rota em HTTPS antes de devolver
     o erro ao player. Isso é especialmente importante para o HLS LIVE,
     porque 522 não é uma falha do HLS.js: é timeout entre Cloudflare e
     a origem.
  */
  if ((upstream.status === 522 || upstream.status === 524) && target.protocol === "http:") {
    try {
      const httpsTarget = new URL(target.toString());
      httpsTarget.protocol = "https:";
      const httpsHeaders = new Headers(baseHeaders);
      httpsHeaders.delete("Origin");
      httpsHeaders.delete("Referer");
      upstream = await fetchTarget(httpsTarget, httpsHeaders);
      if (upstream.status === 401 || upstream.status === 403 || upstream.status === 406) {
        httpsHeaders.set("Origin", httpsTarget.origin);
        httpsHeaders.set("Referer", httpsTarget.origin + "/");
        upstream = await fetchTarget(httpsTarget, httpsHeaders);
      }
    } catch {}
  }

  const ct = upstream.headers.get("content-type") || "";
  const targetIsHls = looksLikeHls(target, ct);
  const targetIsDash = looksLikeDash(target, ct);

  if (targetIsHls && upstream.ok && upstream.body) {
    let text = await upstream.text();

    // Alguns provedores retornam HTTP 200 com corpo vazio/HTML ou uma resposta
    // que não é um manifesto HLS válido. Nesse caso, repete com Origin/Referer
    // do próprio provedor antes de entregar qualquer coisa ao HLS.js.
    const looksLikeValidHls = value => {
      const body = String(value || "").replace(/^\uFEFF/, "").trim();
      return /^#EXTM3U(?:\s|$)/i.test(body) &&
        (/#EXTINF:/i.test(body) || /#EXT-X-STREAM-INF:/i.test(body) || /#EXT-X-TARGETDURATION:/i.test(body));
    };

    if (!looksLikeValidHls(text)) {
      const providerHeaders = new Headers(baseHeaders);
      providerHeaders.set("Origin", target.origin);
      providerHeaders.set("Referer", target.origin + "/");
      const retry = await fetchTarget(target, providerHeaders);
      if (retry.ok && retry.body) {
        const retryText = await retry.text();
        if (looksLikeValidHls(retryText)) {
          upstream = retry;
          text = retryText;
        }
      }
    }

    const rewritten = rewriteHlsManifest(text, target.toString(), new URL(request.url).origin, customReferrer, customUserAgent);
    const outHeaders = new Headers(MEDIA_CORS);
    outHeaders.set("Content-Type", "application/vnd.apple.mpegurl");
    outHeaders.set("Cache-Control", "no-store");
    outHeaders.set("X-GC-HLS", looksLikeValidHls(text) ? "valid" : "invalid");
    return new Response(rewritten, { status: upstream.status, headers: outHeaders });
  }

  if (targetIsDash && upstream.ok && upstream.body) {
    const text = await upstream.text();
    const rewritten = rewriteDashManifest(text, target.toString(), new URL(request.url).origin, customReferrer, customUserAgent);
    const outHeaders = new Headers(MEDIA_CORS);
    outHeaders.set("Content-Type", "application/dash+xml");
    outHeaders.set("Cache-Control", "no-store");
    return new Response(rewritten, { status: upstream.status, headers: outHeaders });
  }

  const outHeaders = new Headers(MEDIA_CORS);
  for (const name of [
    "content-type", "content-length", "content-range", "accept-ranges",
    "etag", "last-modified", "cache-control"
  ]) {
    const value = upstream.headers.get(name);
    if (value) outHeaders.set(name, value);
  }
  outHeaders.set("Cache-Control", "no-store");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders
  });
}

addEventListener("fetch", event => {
  event.respondWith((async () => {
    const request = event.request;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: MEDIA_CORS });
    if (!["GET", "HEAD"].includes(request.method)) return json({ error: "Método não permitido" }, 405);

    const parsed = new URL(request.url);
    const mode = parsed.searchParams.get("mode") || "catalog";
    const raw = parsed.searchParams.get("url");

    if (!raw || raw.length > 8192) return json({ error: "URL inválida" }, 400);

    if (mode === "media") {
      try {
        const target = parsePublicUrl(raw);
        return await fetchMedia(request, target);
      } catch (error) {
        return json({ error: "Falha no fluxo", detail: error?.message || String(error) }, 502, MEDIA_CORS);
      }
    }

    const origin = request.headers.get("Origin");
    if (origin && origin !== ALLOW_ORIGIN) return json({ error: "Origem não autorizada" }, 403);

    try {
      let u = parsePublicUrl(raw);
      let response = await fetchCatalog(u);

      for (let hop = 0; hop < 2 && response.status >= 300 && response.status < 400; hop++) {
        const location = response.headers.get("Location");
        if (!location) return json({ error: "Redirecionamento sem destino" }, 502);
        u = parsePublicUrl(new URL(location, u).toString());
        response = await fetchCatalog(u);
      }

      if (response.status >= 300 && response.status < 400) return json({ error: "Muitos redirecionamentos" }, 502);

      const ct = response.headers.get("content-type") || "";
      if (!response.ok) return json({ error: "Origem respondeu com erro", status: response.status }, 502);
      if (!looksLikeCatalog(u, ct)) return json({ error: "Somente catálogo M3U/API JSON/EPG é aceito. Vídeo não é proxificado no modo catálogo." }, 415);

      const headers = new Headers(CATALOG_CORS);
      for (const name of ["content-type", "content-length", "etag", "last-modified"]) {
        const value = response.headers.get(name);
        if (value) headers.set(name, value);
      }
      headers.set("X-GC-Catalog", "4");
      headers.set("Cache-Control", "no-store");
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      return json({ error: "Falha no catálogo", detail: error?.message || String(error) }, 502);
    }
  })());
});