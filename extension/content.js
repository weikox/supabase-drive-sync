(async () => {
  if (window.__curSync) return; window.__curSync = true;
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;z-index:2147483647;top:20px;right:20px;background:#18181b;color:#fafafa;padding:16px 20px;border-radius:12px;font:14px/1.4 system-ui,sans-serif;max-width:360px;box-shadow:0 10px 30px rgba(0,0,0,.5)";
  document.body.appendChild(box);
  const say = (t) => (box.textContent = t);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms + Math.random() * ms * 0.5));
  const send = (body) => new Promise((res, rej) => chrome.runtime.sendMessage({ type: "upload", body }, (r) => (r && !r.error ? res(r) : rej(new Error(r?.error || "Sin respuesta")))));

  // Candidatos de sesión: primero los que tienen forma de JWT, máximo 3 para no generar ráfagas.
  const jwt = [], other = [];
  const add = (v) => {
    if (typeof v !== "string") return;
    v = v.replace(/^"|"$/g, "");
    if (v.length < 20 || v.length > 5000) return;
    const list = /^ey[\w-]+\.[\w-]+\./.test(v) ? jwt : other;
    if (!jwt.includes(v) && !other.includes(v)) list.push(v);
  };
  for (const st of [sessionStorage, localStorage]) for (let i = 0; i < st.length; i++) {
    const k = st.key(i), v = st.getItem(k);
    if (/auth.?token|^token$|access.?token/i.test(k)) add(v);
    try { const o = JSON.parse(v); if (o && typeof o === "object") for (const kk in o) if (/token/i.test(kk)) add(o[kk]); } catch {}
    if (/^"?ey[\w-]+\.[\w-]+\./.test(v || "")) add(v);
  }
  const cands = [...jwt, ...other].slice(0, 3);
  if (!cands.length) cands.push("");

  let H = {};
  const api = async (p, o = {}) => {
    const method = (o.method || "GET").toUpperCase();
    const headers = { accept: "application/json, text/plain, */*", ...H };
    let body;
    if (method !== "GET") { headers["content-type"] = "application/json"; body = o.body || "{}"; }
    const r = await fetch("/webcli" + p, { method, body, headers, credentials: "include" });
    const t = await r.text();
    if (r.status === 418) throw Object.assign(new Error("Curenergía ha frenado las peticiones (418). Espera unos minutos, recarga la página y vuelve a pulsar."), { stop: true });
    if (!r.ok || t.trim()[0] === "<") throw new Error("Curenergía HTTP " + r.status);
    return JSON.parse(t);
  };

  try {
    say("Buscando tu sesión…");
    let prof = null;
    for (const c of cands) {
      H = c ? { "auth-token": c } : {};
      try { prof = await api("/usuario/data?loginLanguage=es&origenLogin=19&viewAPP=RESIDENCIALNM", { method: "POST" }); if (prof?.listaContratosTotal) break; prof = null; }
      catch (e) { if (e.stop) throw e; }
      await wait(1500);
    }
    if (!prof) throw new Error("No encuentro tu sesión. Entra en Mis facturas, espera a que cargue y vuelve a pulsar.");
    const all = [];
    for (const c of prof.listaContratosTotal) {
      const sup = c.codLineaPdt === "GAS" ? "gas" : "luz";
      say("Leyendo facturas de " + sup + "…");
      await wait(1200);
      await api("/usuario/data?codRs=" + c.codRecepSum + "&origenLogin=19");
      await wait(1200);
      const l = await api("/nm/facturas/lista?language=es", { method: "POST" });
      for (const f of l.facturas || []) all.push({ ...f, supply: sup, codContrato: f.codContrato || c.codContrato, _rs: c.codRecepSum });
    }
    await send({ invoices: all });
    let ok = 0, ko = 0, rs = null;
    for (let i = 0; i < all.length; i++) {
      const f = all[i];
      say(`Descargando PDF ${i + 1} de ${all.length}…`);
      await wait(1500);
      try {
        if (rs !== f._rs) { await api("/usuario/data?codRs=" + f._rs + "&origenLogin=19"); rs = f._rs; await wait(1000); }
        const d = await api("/nm/facturas/descarga?language=es", { method: "POST", body: JSON.stringify({ numFactura: f.factura }) });
        if (!d.fichero) throw 0;
        await send({ pdf: { invoice_id: f.factura, base64: d.fichero } });
        ok++;
      } catch (e) { if (e?.stop) { say(`Pausado en ${i + 1}/${all.length}: ${e.message}`); throw e; } ko++; }
    }
    say(`✔ ${all.length} facturas enviadas · ${ok} PDFs${ko ? ` · ${ko} fallidos` : ""}`);
  } catch (e) { if (!/^Pausado/.test(box.textContent)) say("✖ " + e.message); }
  setTimeout(() => { box.remove(); window.__curSync = false; }, 20000);
})();
