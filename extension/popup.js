const $ = (id) => document.getElementById(id);
const msg = (t) => ($("msg").textContent = t);

async function show() {
  const { cfg } = await chrome.storage.local.get("cfg");
  $("setup").hidden = !!cfg;
  $("ready").hidden = !cfg;
}

$("save").onclick = async () => {
  const raw = $("code").value.trim();
  const i = raw.lastIndexOf("|");
  if (i < 0) return msg("Código no válido.");
  const app = raw.slice(0, i).replace(/\/$/, ""), token = raw.slice(i + 1);
  try { new URL(app); } catch { return msg("Código no válido."); }
  await chrome.permissions.request({ origins: [new URL(app).origin + "/*"] }).catch(() => {});
  await chrome.storage.local.set({ cfg: { app, token } });
  msg("Guardado."); show();
};

$("reset").onclick = async () => { await chrome.storage.local.remove("cfg"); show(); };

$("sync").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https:\/\/www\.curenergia\.es\//.test(tab.url)) return msg("Abre primero curenergia.es en esta pestaña.");
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  msg("Sincronizando… mira el aviso en la página.");
};

show();
