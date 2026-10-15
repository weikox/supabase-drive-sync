(async () => {
  if (window.__curSync) return; window.__curSync = true;
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;z-index:2147483647;top:20px;right:20px;background:#18181b;color:#fafafa;padding:16px 20px;border-radius:12px;font:14px/1.4 system-ui,sans-serif;max-width:360px;box-shadow:0 10px 30px rgba(0,0,0,.5)";
  document.body.appendChild(box);
  const say = (t) => (box.textContent = t);
  const send = (body) => new Promise((res, rej) => chrome.runtime.sendMessage({ type: "upload", body }, (r) => (r && !r.error ? res(r) : rej(new Error(r?.error || "Sin respuesta")))));

  const cands = [];
  const add = (v) => { if (typeof v === "string" && v.length > 20 && v.length < 5000) { v = v.replace(/^"|"$/g, ""); if (!cands.includes(v)) cands.push(v); } };
  for (const st of [sessionStorage, localStorage]) for (let i = 0; i < st.length; i++) {
    const k = st.key(i), v = st.getItem(k);
    if (/token|auth/i.test(k)) add(v);
    try { const o = JSON.parse(v); if (o && typeof o === "object") for (const kk in o) if (/token|auth/i.test(kk)) add(o[kk]); } catch {}
  }
  cands.push("");

  let H = {};
  const api = async (p, o = {}) => {
    const r = await fetch("/webcli" + p, { credentials: "include", ...o, headers: { accept: "application/json, text/plain, */*", "content-type": "application/json;charset=UTF-8", ...H } });
    const t = await r.text();
    if (!r.ok || t.trim()[0] === "<") throw new Error("Curenergía HTTP " + r.status);
    return JSON.parse(t);
  };

  try {
    say("Buscando tu sesión…");
    let prof = null;
    for (const c of cands) {
      H = c ? { "auth-token": c } : {};
      try { prof = await api("/usuario/data?loginLanguage=es&origenLogin=19&viewAPP=RESIDENCIALNM", { method: "POST" }); if (prof?.listaContratosTotal) break; prof = null; } catch {}
    }
    if (!prof) throw new Error("No encuentro tu sesión. Entra en Mis facturas y vuelve a pulsar.");
    const all = [];
    for (const c of prof.listaContratosTotal) {
      const sup = c.codLineaPdt === "GAS" ? "gas" : "luz";
      say("Leyendo facturas de " + sup + "…");
      await api("/usuario/data?codRs=" + c.codRecepSum + "&origenLogin=19");
      const l = await api("/nm/facturas/lista?language=es", { method: "POST" });
      for (const f of l.facturas || []) all.push({ ...f, supply: sup, codContrato: f.codContrato || c.codContrato, _rs: c.codRecepSum });
    }
    await send({ invoices: all });
    let ok = 0, ko = 0, rs = null;
    for (let i = 0; i < all.length; i++) {
      const f = all[i];
      say(`Descargando PDF ${i + 1} de ${all.length}…`);
      try {
        if (rs !== f._rs) { await api("/usuario/data?codRs=" + f._rs + "&origenLogin=19"); rs = f._rs; }
        const d = await api("/nm/facturas/descarga?language=es", { method: "POST", body: JSON.stringify({ numFactura: f.factura }) });
        if (!d.fichero) throw 0;
        await send({ pdf: { invoice_id: f.factura, base64: d.fichero } });
        ok++;
      } catch { ko++; }
    }
    say(`✔ ${all.length} facturas enviadas · ${ok} PDFs${ko ? ` · ${ko} fallidos` : ""}`);
  } catch (e) { say("✖ " + e.message); }
  setTimeout(() => { box.remove(); window.__curSync = false; }, 15000);
})();
