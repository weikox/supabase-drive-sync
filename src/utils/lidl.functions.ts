import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseLidlItems, parseLidlInput } from "./lidl-parse";

const AUTH = "https://accounts.lidl.com";
const TICKETS = "https://tickets.lidlplus.com/api";
const COUNTRY = "ES";
const REDIRECT = "com.lidlplus.app://callback";
const BASIC = "Basic " + btoa("LidlPlusNativeClient:secret");
const EXP = "La conexión con Lidl Plus ha caducado. Vuelve a conectar tu cuenta (paso 1).";

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function tokenCall(body: Record<string, string>) {
  const res = await fetch(`${AUTH}/connect/token`, {
    method: "POST",
    headers: { Authorization: BASIC, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(res.status === 400 || res.status === 401 ? EXP : `Lidl HTTP ${res.status}`);
  return (await res.json()) as { access_token: string; refresh_token: string };
}

/** Gets an access token and persists the rotated refresh token immediately. */
async function accessToken(supabase: any, userId: string) {
  const { data } = await supabase.from("lidl_sessions").select("refresh_token").eq("user_id", userId).maybeSingle();
  if (!data?.refresh_token) throw new Error("Primero conecta tu cuenta de Lidl Plus.");
  const t = await tokenCall({ grant_type: "refresh_token", refresh_token: data.refresh_token });
  await supabase.from("lidl_sessions").upsert({ user_id: userId, refresh_token: t.refresh_token, updated_at: new Date().toISOString() });
  return t.access_token;
}

function appHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`, "App-Version": "16.43.4", "Operating-System": "Android",
    App: "com.lidl.eci.lidlplus", "Accept-Language": "es", "User-Agent": "okhttp/5.3.2",
    "OS-Version": "16", Model: "sdk_gphone64_x86_64", Brand: "Google", deviceid: "7a3f9c21b04e5d68",
    Date: new Date().toUTCString(),
  };
}

async function lget(path: string, token: string) {
  const res = await fetch(TICKETS + path, { headers: appHeaders(token) });
  if (res.status === 401) throw new Error(EXP);
  if (!res.ok) throw new Error(`Lidl HTTP ${res.status}`);
  return res.json();
}

export const getLidlStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("lidl_sessions" as any).select("refresh_token, updated_at").eq("user_id", context.userId).maybeSingle();
    const d: any = data;
    return { connected: !!d?.refresh_token, updatedAt: (d?.updated_at ?? null) as string | null };
  });

/** Step 1: builds the Lidl login link (PKCE) and stores the verifier. */
export const startLidlLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const { error } = await context.supabase.from("lidl_sessions" as any)
      .upsert({ user_id: context.userId, code_verifier: verifier, updated_at: new Date().toISOString() } as any);
    if (error) throw new Error(`Guardar: ${error.message}`);
    const q = new URLSearchParams({
      client_id: "LidlPlusNativeClient", response_type: "code",
      scope: "openid profile offline_access lpprofile lpapis", redirect_uri: REDIRECT,
      code_challenge: challenge, code_challenge_method: "S256", Country: COUNTRY, language: "es-ES",
    });
    return { url: `${AUTH}/connect/authorize?${q}` };
  });

/** Step 2: exchanges the pasted callback code (or a raw refresh token) and stores it. */
export const finishLidlLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { text: string }) => { if (!d?.text?.trim()) throw new Error("Pega el texto copiado"); return d; })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const p = parseLidlInput(data.text);
    let refresh = p.refreshToken;
    if (p.code) {
      const { data: s } = await supabase.from("lidl_sessions" as any).select("code_verifier").eq("user_id", userId).maybeSingle();
      const v = (s as any)?.code_verifier;
      if (!v) throw new Error("Genera primero el enlace de acceso (paso 1).");
      const t = await tokenCall({ grant_type: "authorization_code", code: p.code, redirect_uri: REDIRECT, code_verifier: v });
      refresh = t.refresh_token;
    } else {
      const t = await tokenCall({ grant_type: "refresh_token", refresh_token: refresh! });
      refresh = t.refresh_token;
    }
    const { error } = await supabase.from("lidl_sessions" as any)
      .upsert({ user_id: userId, refresh_token: refresh, code_verifier: null, updated_at: new Date().toISOString() } as any);
    if (error) throw new Error(`Guardar: ${error.message}`);
    return { ok: true as const };
  });

export const syncLidlTickets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const token = await accessToken(supabase, userId);
    const { data: existing } = await supabase.from("lidl_tickets" as any).select("ticket_id, items");
    const known = new Set(((existing ?? []) as any[]).map((r) => r.ticket_id));
    const withItems = new Set(((existing ?? []) as any[]).filter((r) => Array.isArray(r.items) && r.items.length).map((r) => r.ticket_id));

    const all: any[] = [];
    for (let page = 1; page <= 100; page++) {
      const j: any = await lget(`/v2/${COUNTRY}/tickets?pageNumber=${page}&onlyFavorite=false`, token);
      const list: any[] = j?.tickets ?? [];
      all.push(...list);
      const pages = Math.ceil((j?.totalCount ?? 0) / (j?.size || 1));
      if (!list.length || page >= pages) break;
    }

    const rows: any[] = [];
    for (const t of all.filter((t) => t?.id)) {
      const id = String(t.id);
      let detail: any = null;
      if (!withItems.has(id)) { try { detail = await lget(`/v3/${COUNTRY}/tickets/${encodeURIComponent(id)}`, token); } catch (e: any) { if (e.message === EXP) throw e; } }
      const st = detail?.store ?? t.store;
      rows.push({
        user_id: userId, ticket_id: id,
        purchase_date: detail?.date ?? t.date ?? null,
        store: st?.name ?? (typeof st === "string" ? st : null),
        address: st ? [st.address, st.postalCode, st.locality].filter(Boolean).join(", ") || null : null,
        amount: Number(String(detail?.totalAmount ?? t.totalAmount ?? "").replace(",", ".")) || null,
        ...(detail ? { items: parseLidlItems(detail), raw: detail } : { raw: t }),
      });
    }
    if (rows.length) {
      const { error } = await supabase.from("lidl_tickets" as any).upsert(rows as any, { onConflict: "user_id,ticket_id" });
      if (error) throw new Error(`Guardar: ${error.message}`);
    }
    return { ok: true as const, count: rows.length, nuevos: rows.filter((r) => !known.has(r.ticket_id)).length };
  });

async function buildPdf(r: any): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const items: any[] = Array.isArray(r.items) ? r.items : [];
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Courier);
  const bold = await doc.embedFont(StandardFonts.CourierBold);
  const W = 260, lh = 12, H = Math.max(400, 200 + items.length * lh);
  const page = doc.addPage([W, H]);
  const s = (t: any) => String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "");
  let y = H - 30;
  const line = (t: string, f = font, size = 8) => { page.drawText(s(t).slice(0, 48), { x: 15, y, size, font: f }); y -= lh; };
  const lr = (a: string, b: string, f = font) => {
    page.drawText(s(a).slice(0, 34), { x: 15, y, size: 8, font: f });
    const bt = s(b); page.drawText(bt, { x: W - 15 - f.widthOfTextAtSize(bt, 8), y, size: 8, font: f }); y -= lh;
  };
  line("LIDL", bold, 14); y -= 4;
  line(r.store ?? ""); if (r.address) line(r.address);
  line(`Ticket: ${r.ticket_id}`);
  line(`Fecha: ${r.purchase_date ? new Date(r.purchase_date).toLocaleString("es-ES", { timeZone: "Europe/Madrid" }) : "-"}`);
  line("-".repeat(48));
  for (const it of items) lr(`${it.numberUnits ?? 1} x ${it.description ?? ""}`, Number(it.netAmount ?? 0).toFixed(2));
  if (!items.length) line("(Sin desglose de articulos)");
  line("-".repeat(48));
  lr("TOTAL", `${Number(r.amount ?? 0).toFixed(2)} EUR`, bold);
  y -= 8; line("Copia generada a partir de los datos de Lidl Plus.", font, 6);
  return doc.save();
}

export const downloadLidlTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => { if (!d?.id) throw new Error("Faltan datos"); return d; })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase.from("lidl_tickets" as any).select("*").eq("id", data.id).single();
    if (error || !row) throw new Error(error?.message ?? "Ticket no encontrado");
    const r: any = row;
    if (!Array.isArray(r.items) || !r.items.length) {
      const token = await accessToken(supabase, userId);
      const d = await lget(`/v3/${COUNTRY}/tickets/${encodeURIComponent(r.ticket_id)}`, token);
      r.items = parseLidlItems(d);
      await supabase.from("lidl_tickets" as any).update({ items: r.items, raw: d } as any).eq("id", data.id);
    }
    const pdf = await buildPdf(r);
    const day = r.purchase_date ? String(r.purchase_date).slice(0, 10) : "sin-fecha";
    const path = `${userId}/lidl/${day}_${r.ticket_id}.pdf`;
    const { error: e2 } = await supabase.storage.from("invoices").upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (e2) throw new Error(`Storage: ${e2.message}`);
    await supabase.from("lidl_tickets" as any).update({ pdf_storage_path: path } as any).eq("id", data.id);
    const { data: signed, error: e3 } = await supabase.storage.from("invoices").createSignedUrl(path, 600);
    if (e3) throw new Error(`Signed URL: ${e3.message}`);
    return { ok: true as const, url: signed.signedUrl };
  });
