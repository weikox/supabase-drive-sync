import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAppSecret } from "./app-secrets";
import { getScrapflyKey, postForm } from "./provider-login.server";

const API = "https://pro.api.carrefour.es";
// Carrefour login is Gigya / SAP Customer Data Cloud (same API key the web app uses).
const GIGYA_LOGIN = "https://ss-mya-p3.carrefour.es/accounts.login";
const GIGYA_API_KEY = "3_Ns3U5-wXeiSQL-vZtu1Fd2DpWBsEdB78mYs2dn0_kyFFwwSJAZZd1EHUm9kodfND";

/** Builds a receipt-style PDF from stored ticket data (fallback when Carrefour no longer keeps the PDF). */
async function buildTicketPdf(r: any): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const items: any[] = Array.isArray(r.items) ? r.items : [];
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Courier);
  const bold = await doc.embedFont(StandardFonts.CourierBold);
  const W = 260, lh = 12, H = Math.max(400, 200 + items.length * lh * 2);
  const page = doc.addPage([W, H]);
  // WinAnsi-safe text
  const s = (t: any) => String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E€]/g, "");
  let y = H - 30;
  const line = (t: string, f = font, size = 8) => { page.drawText(s(t).slice(0, 48), { x: 15, y, size, font: f }); y -= lh; };
  const lr = (a: string, b: string, f = font) => {
    page.drawText(s(a).slice(0, 34), { x: 15, y, size: 8, font: f });
    const bt = s(b); page.drawText(bt, { x: W - 15 - f.widthOfTextAtSize(bt, 8), y, size: 8, font: f }); y -= lh;
  };
  line("CARREFOUR", bold, 14); y -= 4;
  line(r.store ?? ""); if (r.address) line(r.address);
  line(`Ticket: ${r.ticket_id}`);
  line(`Fecha: ${r.purchase_date ? new Date(r.purchase_date).toLocaleString("es-ES", { timeZone: "Europe/Madrid" }) : "-"}`);
  line("-".repeat(48));
  for (const it of items) {
    lr(`${it.numberUnits ?? 1} x ${it.description ?? ""}`, Number(it.netAmount ?? 0).toFixed(2));
  }
  if (!items.length) line("(Sin desglose de articulos)");
  line("-".repeat(48));
  lr("TOTAL", `${Number(r.amount ?? 0).toFixed(2)} EUR`, bold);
  y -= 8; line("Copia generada a partir de los datos de la compra.", font, 6);
  return doc.save();
}

type Creds = { token: string; csrf?: string };

/** Extracts the bearer token and csrf token from a pasted "Copy as cURL" text (or a raw token). */
function parseCreds(text: string): Creds {
  const t = text.match(/authorization:\s*bearer\s+([\w\-.]+)/i)?.[1]
    ?? text.match(/\b(ey[\w-]+\.[\w-]+\.[\w-]+)\b/)?.[1];
  if (!t) throw new Error("No encuentro el token en el texto pegado. Copia de nuevo la petición como cURL.");
  const csrf = text.match(/x-csrf-token:\s*([\w-]+)/i)?.[1];
  return { token: t, csrf };
}

function headers(c: Creds): Record<string, string> {
  const h: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    authorization: `bearer ${c.token}`,
    "content-type": "application/json",
    origin: "https://www.carrefour.es",
    referer: "https://www.carrefour.es/",
    requestorigin: "MYA",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
  };
  if (c.csrf) { h["x-csrf-token"] = c.csrf; h["x-xsrf-token"] = c.csrf; }
  return h;
}

function extractCookie(setCookies: string[], name: string): string | undefined {
  const re = new RegExp(`(?:^|[;,\\s])${name}=([^;]+)`);
  for (const c of setCookies) { const m = c.match(re); if (m) return decodeURIComponent(m[1]); }
  return undefined;
}

/** Logs in with Carrefour account credentials (Gigya / SAP CDC) and returns the bearer token. */
async function carrefourLogin(supabase: any): Promise<Creds> {
  const user = await getAppSecret(supabase, "CARREFOUR_USER", process.env.CARREFOUR_USER);
  const pass = await getAppSecret(supabase, "CARREFOUR_PASS", process.env.CARREFOUR_PASS);
  if (!user || !pass) throw new Error("CARREFOUR_USER / CARREFOUR_PASS no configuradas");
  const key = await getScrapflyKey(supabase, process.env.SCRAPFLY_API_KEY);
  const r = await postForm({
    url: GIGYA_LOGIN,
    scrapflyKey: key,
    headers: { origin: "https://www.carrefour.es", referer: "https://www.carrefour.es/" },
    fields: {
      loginID: user,
      password: pass,
      sessionExpiration: "-1",
      targetEnv: "jssdk",
      include: "profile,data,emails,subscriptions,preferences,",
      includeUserInfo: "true",
      loginMode: "standard",
      lang: "es",
      APIKey: GIGYA_API_KEY,
      source: "showScreenSet",
      sdk: "js_latest",
      authMode: "cookie",
      pageURL: "https://www.carrefour.es/access",
      sdkBuild: "2491",
      format: "json",
    },
  });
  const j = r.json ?? {};
  if (j.errorCode) throw new Error(`Carrefour login: ${j.errorMessage ?? j.errorDetails ?? j.errorCode}`);
  const token = j.id_token ?? j.idToken ?? j.sessionInfo?.sessionToken ?? null;
  if (!token) throw new Error("Carrefour login: la respuesta no trae token");
  return { token, csrf: extractCookie(r.setCookies, "XSRF-TOKEN") };
}

/** Uses the pasted cURL when given, otherwise logs in with the stored credentials. */
async function resolveCreds(supabase: any, curl?: string): Promise<Creds> {
  if (curl?.trim()) return parseCreds(curl);
  return carrefourLogin(supabase);
}

async function cfGet(path: string, c: Creds) {
  const res = await fetch(API + path, { headers: headers(c) });
  if (res.status === 401) throw new Error("La sesión de Carrefour ha caducado. Vuelve a copiar la petición desde Carrefour.");
  return res;
}

export const syncCarrefourTickets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { curl?: string; years?: number }) => d ?? {})
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const c = await resolveCreds(supabase, data.curl);
    const to = new Date(Date.now() + 86400000).toISOString();
    const from = new Date(Date.now() - (data.years ?? 3) * 365 * 86400000).toISOString();

    const { data: existing } = await supabase.from("carrefour_tickets" as any).select("ticket_id, items");
    const known = new Set(((existing ?? []) as any[]).map((r) => r.ticket_id));
    const withItems = new Set(((existing ?? []) as any[]).filter((r) => Array.isArray(r.items) && r.items.length).map((r) => r.ticket_id));

    const all: any[] = [];
    let off = { ticketOffset: 0, currentTickets: 0, atgfOffset: 0, atgnfOffset: 0, currentAtgfOrders: 0, currentAtgnfOrders: 0 };
    for (let page = 0; page < 100; page++) {
      const q = new URLSearchParams({
        from, to, count: "50",
        atgfOffset: String(off.atgfOffset), atgnfOffset: String(off.atgnfOffset),
        currentAtgfOrders: String(off.currentAtgfOrders), currentAtgnfOrders: String(off.currentAtgnfOrders),
        currentTickets: String(off.currentTickets), ticketOffset: String(off.ticketOffset),
      });
      const res = await cfGet(`/md-purchasesAccount-v1/purchases?${q}`, c);
      if (!res.ok) throw new Error(`Carrefour HTTP ${res.status}`);
      const j: any = await res.json();
      const list: any[] = j?.purchases ?? [];
      all.push(...list);
      const next = j?.offsets;
      if (!list.length || !next || next.ticketOffset === off.ticketOffset && next.atgfOffset === off.atgfOffset && next.atgnfOffset === off.atgnfOffset) break;
      off = { ...off, ...next };
    }

    const rows = [];
    for (const p of all.filter((p) => p?.purchaseId)) {
      const id = String(p.purchaseId);
      let items: any = undefined;
      let detail: any = undefined;
      if (!withItems.has(id)) {
        const d = await cfGet(`/md-ticketsAccount-v1/tickets/${encodeURIComponent(id)}`, c);
        if (d.ok) { detail = await d.json(); items = detail?.items ?? null; }
      }
      rows.push({
        user_id: userId,
        ticket_id: id,
        purchase_date: p.purchaseDate ?? null,
        store: p.mallName ?? null,
        address: p.mallAddress ?? null,
        amount: typeof p.amount === "number" ? p.amount : null,
        source: p.orderSource ?? null,
        ...(items !== undefined ? { items } : {}),
        raw: detail ? { ...p, detail } : p,
      });
    }
    if (rows.length) {
      const { error } = await supabase.from("carrefour_tickets" as any)
        .upsert(rows as any, { onConflict: "user_id,ticket_id" });
      if (error) throw new Error(`Guardar: ${error.message}`);
    }
    return { ok: true as const, count: rows.length, nuevos: rows.filter((r) => !known.has(r.ticket_id)).length };
  });

export const downloadCarrefourTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; curl?: string }) => {
    if (!d?.id) throw new Error("Faltan datos");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const c = await resolveCreds(supabase, data.curl);
    const { data: row, error } = await supabase.from("carrefour_tickets" as any).select("*").eq("id", data.id).single();
    if (error || !row) throw new Error(error?.message ?? "Ticket no encontrado");
    const r: any = row;
    const res = await fetch(`${API}/md-ticketsAccount-v1/tickets/${encodeURIComponent(r.ticket_id)}/pdf`,
      { headers: { ...headers(c), accept: "application/pdf, */*" } });
    if (res.status === 401) throw new Error("La sesión de Carrefour ha caducado. Vuelve a copiar la petición desde Carrefour.");
    let pdf: Uint8Array | null = res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    if (!pdf || !(pdf[0] === 0x25 && pdf[1] === 0x50)) {
      // Carrefour no conserva el PDF de tickets antiguos: generamos uno con los datos guardados
      if (!Array.isArray(r.items) || !r.items.length) {
        const d = await cfGet(`/md-ticketsAccount-v1/tickets/${encodeURIComponent(r.ticket_id)}`, c);
        if (d.ok) { const j: any = await d.json(); if (j?.items) { r.items = j.items; await supabase.from("carrefour_tickets" as any).update({ items: j.items } as any).eq("id", data.id); } }
      }
      pdf = await buildTicketPdf(r);
    }
    const day = r.purchase_date ? String(r.purchase_date).slice(0, 10) : "sin-fecha";
    const path = `${userId}/carrefour/${day}_${r.ticket_id}.pdf`;
    const { error: e2 } = await supabase.storage.from("invoices").upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (e2) throw new Error(`Storage: ${e2.message}`);
    await supabase.from("carrefour_tickets" as any).update({ pdf_storage_path: path } as any).eq("id", data.id);
    const { data: signed, error: e3 } = await supabase.storage.from("invoices").createSignedUrl(path, 600);
    if (e3) throw new Error(`Signed URL: ${e3.message}`);
    return { ok: true as const, url: signed.signedUrl };
  });
