import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getCurenergiaScrapflyKey } from "./curenergia-config.server";
import { getAppSecret } from "./app-secrets";
import { providerRequest } from "./provider-login.server";
import { CookieJar } from "./cookie-jar.server";

const BASE = "https://www.curenergia.es/webcli";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0";

type Sess = { auth_token: string; cookie: string };

function headers(s: Sess, method = "GET"): Record<string, string> {
  const h: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "accept-language": "es,es-ES;q=0.9,en;q=0.8",
    "auth-token": s.auth_token,
    cookie: s.cookie,
    origin: "https://www.curenergia.es",
    referer: "https://www.curenergia.es/wclifrmr/cur/gestiones/facturas/historico-facturas",
    "sec-ch-ua": '"Microsoft Edge";v="155", "Chromium";v="155", "Not(A:Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": UA,
  };
  if (method !== "GET") h["content-type"] = "application/json;charset=UTF-8";
  return h;
}

async function scrapfly(key: string, s: Sess, url: string, init: RequestInit): Promise<{ status: number; text: string }> {
  const p = new URLSearchParams({ key, url, asp: "true", country: "es" });
  const method = (init.method ?? "GET").toUpperCase();
  for (const [k, v] of Object.entries(headers(s, method))) p.append(`headers[${k}]`, v);
  const res = await fetch(`https://api.scrapfly.io/scrape?${p}`, {
    method,
    body: method === "GET" ? undefined : ((init.body as string) ?? ""),
    headers: method === "GET" ? undefined : { "content-type": "application/json;charset=UTF-8" },
  });
  const j: any = await res.json().catch(() => null);
  if (!res.ok || !j?.result) {
    console.error("Scrapfly error", res.status, j?.message);
    throw new Error(`Scrapfly respondió HTTP ${res.status}${j?.message ? `: ${j.message}` : ""}`);
  }
  return { status: j.result.status_code ?? 200, text: String(j.result.content ?? "") };
}

async function call(s: Sess, path: string, init: RequestInit = {}, key?: string): Promise<any> {
  let status: number, text: string, ok: boolean;
  if (key) {
    ({ status, text } = await scrapfly(key, s, `${BASE}${path}`, init));
    ok = status >= 200 && status < 300;
  } else {
    const method = (init.method ?? "GET").toUpperCase();
    const body = method === "GET" ? undefined : ((init.body as string) ?? "");
    const res = await fetch(`${BASE}${path}`, { ...init, body, headers: headers(s, method) });
    text = await res.text(); status = res.status; ok = res.ok;
  }
  if (!ok || text.trim().startsWith("<")) {
    throw new Error(
      status === 403 || status === 401 || text.includes("Access Denied")
        ? "La sesión de Curenergía ha caducado. Pega una petición nueva."
        : `Curenergía respondió HTTP ${status}${text ? `: ${text.slice(0, 300)}` : ""}`,
    );
  }
  return JSON.parse(text);
}

/** Extrae auth-token y cookies de un "Copiar como cURL" (bash o cmd). */
export function parseCurl(raw: string): Sess {
  const t = raw.replace(/\r/g, "").replace(/\^/g, "");
  const token = t.match(/auth-token:\s*([^'"\n]+)/i)?.[1]?.trim();
  const cookie =
    t.match(/-b\s+'([^']+)'/)?.[1] ??
    t.match(/-b\s+"([^"]+)"/)?.[1] ??
    t.match(/cookie:\s*([^'"\n]+)/i)?.[1];
  if (!token || !cookie) throw new Error("No encuentro auth-token y cookies en el texto pegado");
  return { auth_token: token, cookie: cookie.trim() };
}

async function getSession(supabase: any, userId: string): Promise<Sess> {
  const { data } = await supabase
    .from("curenergia_sessions").select("auth_token, cookie").eq("user_id", userId).maybeSingle();
  if (data) {
    if (data.cookie === "bookmarklet") throw new Error("La sesión guardada es la del botón/extensión, no una sesión de Curenergía. Usa la extensión o pega un cURL nuevo.");
    return data;
  }
  const key = await getCurenergiaScrapflyKey(supabase, process.env.SCRAPFLY_API_KEY);
  const s = await curenergiaLogin(supabase, key);
  await supabase.from("curenergia_sessions")
    .upsert({ user_id: userId, ...s, updated_at: new Date().toISOString() });
  return s;
}

/**
 * Logs in with Curenergía account credentials. The portal authenticates with HTTP
 * Basic and returns a jwtToken that is sent as the `auth-token` header afterwards.
 * Curenergía blocks datacenter IPs, so this only works through Scrapfly.
 */
async function curenergiaLogin(supabase: any, key?: string): Promise<Sess> {
  if (!key) throw new Error("Curenergía bloquea las conexiones desde el servidor. Configura SCRAPFLY_API_KEY para poder entrar con usuario y contraseña.");
  const user = await getAppSecret(supabase, "CURENERGIA_USER", process.env.CURENERGIA_USER);
  const pass = await getAppSecret(supabase, "CURENERGIA_PASS", process.env.CURENERGIA_PASS);
  if (!user || !pass) throw new Error("CURENERGIA_USER / CURENERGIA_PASS no configuradas");

  const jar = new CookieJar();
  const basic = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  const res = await providerRequest({
    url: `${BASE}/preLogin?origenLogin=19&loginLanguage=es&viewAPP=RESIDENCIALNM`,
    method: "POST",
    headers: {
      authorization: basic,
      accept: "application/json, text/plain, */*",
      origin: "https://www.curenergia.es",
      referer: "https://www.curenergia.es/wclifral/logincur/loginUnicoForm",
    },
    scrapflyKey: key,
  });
  jar.add(res.setCookies);
  const jwt = res.json?.jwtToken ?? res.json?.data?.jwtToken;
  if (!jwt) {
    const msg = res.json?.userMessage?.[0]?.key ?? res.json?.message;
    throw new Error(`Curenergía no aceptó las credenciales${msg ? ` (${msg})` : ""}.`);
  }
  return { auth_token: jwt, cookie: jar.header() };
}

function toNum(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export const saveCurenergiaSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { curl?: string }) => d ?? {})
  .handler(async ({ data, context }) => {
    if (!data.curl?.trim()) {
      // Empty cURL: fall back to account credentials, drop any stale pasted session.
      await context.supabase.from("curenergia_sessions").delete().eq("user_id", context.userId);
      return { ok: true, mode: "credentials" as const };
    }
    const s = parseCurl(data.curl);
    const { error } = await context.supabase
      .from("curenergia_sessions")
      .upsert({ user_id: context.userId, ...s, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { ok: true, mode: "curl" as const };
  });

export const syncCurenergiaInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ count: number; error?: string }> => {
    try { return await doSync(context.supabase, context.userId); }
    catch (e: any) { return { count: 0, error: friendly(e) }; }
  });

function friendly(e: any): string {
  const m = String(e?.message ?? e);
  return m.includes("HTTP 418") || m.includes("HTTP 403")
    ? "Curenergía ha bloqueado la conexión automática desde el servidor (antirobots)."
    : m;
}

async function doSync(supabase: any, userId: string) {
  {
    const key = await getCurenergiaScrapflyKey(supabase, process.env.SCRAPFLY_API_KEY);
    const s = await getSession(supabase, userId);
    // Llamada directa, igual que el portal: sin peticiones previas que disparen el antirobots.
    const list = await call(s, "/nm/facturas/lista?language=es", { method: "POST" }, key);
    const rows = (list.facturas ?? []).map((f: any) => ({
      user_id: userId,
      supply: /GAS/i.test(String(f.tipoProducto ?? f.descPdt ?? "")) ? "gas" : "luz",
      contract_id: f.codContrato != null ? String(f.codContrato) : null,
      invoice_id: f.factura,
      invoice_num: f.numFacturaIva || null,
      issued_date: f.fecha || null,
      period_from: f.fecMinTerEne || null,
      period_to: f.fecMaxTerEne || null,
      amount: typeof f.importeOrdenacion === "number" ? f.importeOrdenacion : toNum(f.importe),
      consumption: f.consumo || null,
      status: f.descEstado || null,
    })).filter((r: any) => r.invoice_id);
    if (rows.length) {
      const { error } = await supabase.from("curenergia_invoices").upsert(rows, { onConflict: "user_id,invoice_id" });
      if (error) throw new Error(error.message);
    }
    const count = rows.length;
    return { count };
  }
}

export const downloadCurenergiaInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }): Promise<{ url?: string; error?: string }> => {
    try { return await doDownload(context.supabase, context.userId, data.id); }
    catch (e: any) { return { error: friendly(e) }; }
  });

async function doDownload(supabase: any, userId: string, id: string) {
  {
    const key = await getCurenergiaScrapflyKey(supabase, process.env.SCRAPFLY_API_KEY);
    const data = { id };
    const { data: inv, error } = await supabase
      .from("curenergia_invoices").select("*").eq("id", data.id).single();
    if (error || !inv) throw new Error("Factura no encontrada");
    const s = await getSession(supabase, userId);
    const res = await call(s, "/nm/facturas/descarga?language=es", {
      method: "POST",
      body: JSON.stringify({ numFactura: inv.invoice_id }),
    }, key);
    if (!res.fichero) throw new Error("Curenergía no devolvió el PDF");
    const bin = Uint8Array.from(atob(res.fichero), (ch) => ch.charCodeAt(0));
    const path = `${userId}/curenergia/${inv.supply}/${(inv.invoice_num ?? inv.invoice_id).replace(/[^\w.-]/g, "_")}.pdf`;
    const { error: e2 } = await supabase.storage
      .from("invoices").upload(path, bin, { contentType: "application/pdf", upsert: true });
    if (e2) throw new Error(e2.message);
    await supabase.from("curenergia_invoices").update({ pdf_storage_path: path }).eq("id", inv.id);
    const { data: signed, error: e3 } = await supabase.storage.from("invoices").createSignedUrl(path, 600);
    if (e3 || !signed) throw new Error(e3?.message ?? "No se pudo firmar la URL");
    return { url: signed.signedUrl };
  }
}

/** Crea (o renueva) el código secreto que usa el botón de marcadores. */
export const getCurenergiaImportToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("curenergia_sessions").select("auth_token, cookie").eq("user_id", context.userId).maybeSingle();
    if (data?.cookie === "bookmarklet") return { token: data.auth_token as string };
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const { error } = await context.supabase.from("curenergia_sessions").upsert({
      user_id: context.userId, auth_token: token, cookie: "bookmarklet", updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { token };
  });
