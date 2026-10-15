// Uploads to the app from the extension context (no page CSP / CORS issues).
chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m?.type !== "upload") return;
  (async () => {
    const { cfg } = await chrome.storage.local.get("cfg");
    if (!cfg) return reply({ error: "Falta el código de conexión" });
    try {
      const r = await fetch(cfg.app + "/api/public/curenergia-import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: cfg.token, ...m.body }),
      });
      const j = await r.json().catch(() => ({}));
      reply(r.ok ? j : { error: j.error || "App HTTP " + r.status });
    } catch (e) { reply({ error: String(e?.message || e) }); }
  })();
  return true;
});
