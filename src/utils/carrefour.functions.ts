import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const API = "https://pro.api.carrefour.es";

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

async function cfGet(path: string, c: Creds) {
  const res = await fetch(API + path, { headers: headers(c) });
  if (res.status === 401) throw new Error("La sesión de Carrefour ha caducado. Vuelve a copiar la petición desde Carrefour.");
  return res;
}

export const syncCarrefourTickets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { curl: string; years?: number }) => {
    if (!d?.curl) throw new Error("Falta el texto copiado de Carrefour");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const c = parseCreds(data.curl);
    const to = new Date(Date.now() + 86400000).toISOString();
    const from = new Date(Date.now() - (data.years ?? 3) * 365 * 86400000).toISOString();

    const { data: existing } = await supabase.from("carrefour_tickets" as any).select("ticket_id");
    const known = new Set(((existing ?? []) as any[]).map((r) => r.ticket_id));

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
      if (!known.has(id) && p.orderSource === "TICKET") {
        const d = await cfGet(`/md-ticketsAccount-v1/tickets/${encodeURIComponent(id)}`, c);
        if (d.ok) items = ((await d.json()) as any)?.items ?? null;
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
        raw: p,
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
  .inputValidator((d: { id: string; curl: string }) => {
    if (!d?.id || !d?.curl) throw new Error("Faltan datos");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const c = parseCreds(data.curl);
    const { data: row, error } = await supabase.from("carrefour_tickets" as any).select("*").eq("id", data.id).single();
    if (error || !row) throw new Error(error?.message ?? "Ticket no encontrado");
    const r: any = row;
    const res = await cfGet(`/md-ticketsAccount-v1/tickets/${encodeURIComponent(r.ticket_id)}/pdf`, c);
    if (!res.ok) throw new Error(`PDF HTTP ${res.status}`);
    const pdf = new Uint8Array(await res.arrayBuffer());
    if (!(pdf[0] === 0x25 && pdf[1] === 0x50)) throw new Error("La respuesta no es un PDF");
    const day = r.purchase_date ? String(r.purchase_date).slice(0, 10) : "sin-fecha";
    const path = `${userId}/carrefour/${day}_${r.ticket_id}.pdf`;
    const { error: e2 } = await supabase.storage.from("invoices").upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (e2) throw new Error(`Storage: ${e2.message}`);
    await supabase.from("carrefour_tickets" as any).update({ pdf_storage_path: path } as any).eq("id", data.id);
    const { data: signed, error: e3 } = await supabase.storage.from("invoices").createSignedUrl(path, 600);
    if (e3) throw new Error(`Signed URL: ${e3.message}`);
    return { ok: true as const, url: signed.signedUrl };
  });
