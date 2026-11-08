// sw.js — PaseoCan sin internet (24/10/2026)
// Va en GitHub AL LADO de index.html (mismo repo, misma carpeta). Se sube una sola vez:
// NO hace falta cambiarlo cuando cambia la app.
//
// Cómo funciona:
// - La página (index.html) se pide "red primero": con señal siempre llega la última versión
//   y se guarda una copia. Sin señal, o si la red tarda más de ESPERA_RED, se usa la copia.
//   Por eso no hay que subir números de versión para que el celular se actualice.
// - Los scripts de afuera (React de cdnjs) se guardan la primera vez y después salen de la
//   copia: sus direcciones llevan la versión adentro, nunca cambian de contenido.
// - Qué scripts guardar lo dice la PROPIA página (mensaje "pc-guardar"), así la lista vive
//   en un solo lugar: build_header.html. Lo que ya no figura en la lista se borra.
// - Todo lo demás (WhatsApp, Maps, formulario de opiniones) pasa derecho a la red.
const CACHE = "paseocan-v1";
const ESPERA_RED = 4000; // ms: más que esto con señal mala → copia guardada

const PAGINA = new URL("./", self.registration.scope).href; // la carpeta = index.html

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.add(new Request(PAGINA, { cache: "reload" })))
      .catch(() => {}) // sin señal en la instalación: se guarda en la próxima apertura
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith("paseocan-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function esPagina(req) {
  if (req.mode === "navigate") return true;
  const u = new URL(req.url);
  const sinBusqueda = u.origin + u.pathname; // index.html?algo también es la página
  return u.origin === self.location.origin && (sinBusqueda === PAGINA || sinBusqueda === PAGINA + "index.html");
}

async function paginaRedPrimero(req) {
  const cache = await caches.open(CACHE);
  const red = fetch(req).then((r) => {
    if (r && r.ok) cache.put(PAGINA, r.clone()).catch(() => {});
    return r;
  });
  const copia = () => cache.match(PAGINA, { ignoreSearch: true });
  let timer;
  const tarde = new Promise((res) => { timer = setTimeout(res, ESPERA_RED); });
  try {
    const gana = await Promise.race([red.then((r) => ({ r })), tarde.then(() => null)]);
    if (gana && gana.r && gana.r.ok) return gana.r;
    const c = await copia();
    if (c) return c;
    return await red; // sin copia todavía: esperar la red lo que haga falta
  } catch (err) {
    const c = await copia();
    if (c) return c;
    return new Response(
      "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>" +
      "<body style='background:#0f1a14;color:#86efac;font-family:sans-serif;padding:24px'>" +
      "<h2>PaseoCan</h2><p>No hay señal y la app todavía no quedó guardada en este celular." +
      " Abrila una vez con internet y después va a andar sin señal.</p></body>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (esPagina(req)) { e.respondWith(paginaRedPrimero(req)); return; }
  // Solo scripts: salen de la copia si la página pidió guardarlos (ver "pc-guardar").
  // Lo demás (WhatsApp, Maps, opiniones) ni se toca.
  if (req.destination !== "script") return;
  e.respondWith(
    caches.open(CACHE).then((cache) => cache.match(req)).then((c) => c || fetch(req))
  );
});

// La página manda {tipo:"pc-guardar", urls:[...]} con los scripts que necesita para arrancar.
// Se guardan los que falten y se borran los de afuera que ya no usa (cambio de versión de React).
self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.tipo !== "pc-guardar" || !Array.isArray(d.urls)) return;
  const urls = d.urls.filter((u) => typeof u === "string" && /^https:\/\//.test(u));
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const u of urls) {
      try {
        if (await cache.match(u)) continue;
        const r = await fetch(new Request(u, { mode: "cors", credentials: "omit" }));
        if (r && r.ok) await cache.put(u, r);
      } catch (err) {} // sin señal: se intenta en la próxima apertura
    }
    const ks = await cache.keys();
    await Promise.all(ks.filter((k) => new URL(k.url).origin !== self.location.origin && !urls.includes(k.url)).map((k) => cache.delete(k)));
    if (e.source && e.source.postMessage) e.source.postMessage({ tipo: "pc-guardado" });
  })());
});
