"use strict";

const express = require("express");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "imagenes");
const PUBLIC_DIR = path.join(__dirname, "public");

fs.mkdirSync(DATA_DIR, { recursive: true });

app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(express.json({ limit: "12mb" }));
app.use(express.static(PUBLIC_DIR, { index: "index.html", maxAge: "1h" }));

/* ----------------------------- utilidades ----------------------------- */

const esc = s =>
  String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const nombreValido = f => /^[0-9]{10,16}_[a-f0-9]{8}\.jpg$/.test(f);

async function listar() {
  let files = [];
  try {
    files = (await fsp.readdir(DATA_DIR)).filter(f => /\.jpg$/i.test(f));
  } catch {
    return [];
  }
  const items = [];
  for (const archivo of files) {
    const abs = path.join(DATA_DIR, archivo);
    const st = await fsp.stat(abs).catch(() => null);
    if (!st) continue;
    let meta = {};
    try {
      meta = JSON.parse(await fsp.readFile(abs.replace(/\.jpg$/i, ".json"), "utf8"));
    } catch {}
    items.push({
      archivo,
      ts: Number(meta.ts) || st.mtimeMs,
      bytes: st.size,
      meta: meta.meta || {},
      ip: meta.ip || null
    });
  }
  return items.sort((a, b) => b.ts - a.ts);
}

/* ------------------------------- API ---------------------------------- */

app.get("/healthz", (_req, res) => res.type("text").send("ok"));

app.post("/api/captura", async (req, res) => {
  try {
    const { imagen, meta = {} } = req.body || {};
    if (typeof imagen !== "string" || !imagen.startsWith("data:image/")) {
      return res.status(400).json({ ok: false, error: "imagen invalida" });
    }
    const b64 = imagen.slice(imagen.indexOf(",") + 1);
    const buf = Buffer.from(b64, "base64");
    if (buf.length < 800) return res.status(400).json({ ok: false, error: "imagen vacia" });
    if (buf.length > 9e6) return res.status(413).json({ ok: false, error: "imagen demasiado grande" });

    const ts = Date.now();
    const archivo = `${ts}_${crypto.randomBytes(4).toString("hex")}.jpg`;
    await fsp.writeFile(path.join(DATA_DIR, archivo), buf);

    const registro = {
      archivo,
      ts,
      iso: new Date(ts).toISOString(),
      ip: req.ip,
      bytes: buf.length,
      meta
    };
    await fsp.writeFile(
      path.join(DATA_DIR, archivo.replace(/\.jpg$/, ".json")),
      JSON.stringify(registro, null, 2)
    );

    res.status(201).json({ ok: true, archivo, url: `/imagenes/${archivo}` });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/imagenes", async (_req, res) => {
  const items = await listar();
  res.json({ ok: true, total: items.length, items });
});

app.delete("/api/imagenes/:archivo", async (req, res) => {
  const { archivo } = req.params;
  if (!nombreValido(archivo)) return res.status(400).json({ ok: false, error: "nombre invalido" });
  try {
    await fsp.unlink(path.join(DATA_DIR, archivo));
    await fsp.unlink(path.join(DATA_DIR, archivo.replace(/\.jpg$/, ".json"))).catch(() => {});
    res.json({ ok: true });
  } catch {
    res.status(404).json({ ok: false, error: "no existe" });
  }
});

/* ------------------------- carpeta /imagenes -------------------------- */

app.get(["/imagenes", "/imagenes/"], async (_req, res) => {
  const items = await listar();
  const cards = items
    .map(it => {
      const url = `/imagenes/${it.archivo}`;
      const m = it.meta || {};
      const hora = new Date(it.ts).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "medium" });
      const kb = Math.round(it.bytes / 1024);
      return `<figure>
        <a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${esc(it.archivo)}" loading="lazy"></a>
        <figcaption>
          <span class="hora">${esc(hora)}</span>
          <span class="det">${kb} KB · ${esc(m.tz || "—")} · ${esc(it.ip || "—")}</span>
          <span class="ua" title="${esc(m.ua)}">${esc((m.ua || "").slice(0, 70))}</span>
          <span class="row">
            <a class="btn" href="${url}" download>Descargar</a>
            <button class="btn danger" data-del="${esc(it.archivo)}">Borrar</button>
          </span>
        </figcaption>
      </figure>`;
    })
    .join("");

  res.type("html").send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>imagenes/ · ${items.length}</title>
<style>
 :root{--bg:#0b0d10;--panel:#12161b;--line:#222932;--txt:#e6edf3;--dim:#7d8b99;--err:#ff5c5c}
 *{box-sizing:border-box}
 body{margin:0;padding:16px;background:var(--bg);color:var(--txt);font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;max-width:1200px;margin-inline:auto}
 header{display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:baseline;border-bottom:1px solid var(--line);padding-bottom:10px;margin-bottom:16px}
 h1{font-size:14px;letter-spacing:.14em;text-transform:uppercase;margin:0;font-weight:600}
 h1 span{color:var(--dim);letter-spacing:0;text-transform:none;font-weight:400}
 .btn{font:inherit;font-size:11px;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--txt);text-decoration:none;cursor:pointer}
 .btn:hover{border-color:#3a4552}
 .danger{color:var(--err);border-color:#ff5c5c44}
 #grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}
 figure{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden}
 figure img{width:100%;aspect-ratio:1;object-fit:cover;display:block}
 figcaption{display:flex;flex-direction:column;gap:4px;padding:8px;font-size:10px;color:var(--dim);word-break:break-word}
 .hora{color:var(--txt)}
 .ua{font-size:9px;opacity:.65}
 .row{display:flex;gap:6px;margin-top:4px}
 .row .btn{flex:1;text-align:center}
 .empty{color:var(--dim);padding:30px 0}
</style></head>
<body>
<header>
  <h1>pagina.com/imagenes <span>· ${items.length} archivo(s)</span></h1>
  <span><a class="btn" href="/">← Capturar</a> <button class="btn" onclick="location.reload()">Refrescar</button></span>
</header>
${items.length ? `<div id="grid">${cards}</div>` : '<p class="empty">Carpeta vacía. Ve a la página principal para capturar.</p>'}
<script>
document.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
  const f = b.dataset.del;
  if (!confirm("¿Borrar " + f + "?")) return;
  const r = await fetch("/api/imagenes/" + encodeURIComponent(f), { method: "DELETE" });
  if (r.ok) b.closest("figure").remove(); else alert("No se pudo borrar");
});
setTimeout(() => location.reload(), 30000);
</script>
</body></html>`);
});

app.use("/imagenes", express.static(DATA_DIR, { index: false, maxAge: "1h" }));

/* ------------------------------ cierres ------------------------------- */

app.use((_req, res) => res.status(404).type("text").send("404"));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).type("text").send("500");
});

app.listen(PORT, () => {
  console.log(`Escuchando en :${PORT} · carpeta de datos: ${DATA_DIR}`);
});
