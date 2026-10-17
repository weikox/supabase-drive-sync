import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseEroskiToken, parseEroskiItems } from "./eroski-parse";

const API = "https://areacliente.eroski.es/areacliente/rest/compras/tickets/es";

function headers(token: string, json = true): Record<string, string> {
  return {
    accept: json ? "application/json" : "application/pdf, */*",
    "content-type": "application/json",
    origin: "https://areaprivada.eroski.es",
    referer: "https://areaprivada.eroski.es/",
    "x-auth-token": token,
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
  };
}
const expired = (s: number) => s === 401 || s === 403;
const EXP = "La sesión de Eroski ha caducado. Vuelve a copiar la petición desde Eroski.";

/** dd/mm/yyyy -> yyyy-mm-dd */
const isoDay = (f: string | null | undefined) => {
  const m = f?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

export const syncEroskiTickets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { curl: string }) => { if (!d?.curl) throw new Error("Falta el texto copiado de Eroski"); return d; })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const token = parseEroskiToken(data.curl);
    const now = new Date();
    const toDate = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
    const all: any[] = [];
    for (let page = 1; page <= 50; page++) {
      const res = await fetch(`${API}/get/page/filtred/info`, {
        method: "POST", headers: headers(token),
        body: JSON.stringify({ pageNumber: page, fromDate: "01/01/1901", toDate }),
      });
      if (expired(res.status)) throw new Error(EXP);
      if (!res.ok) throw new Error(`Eroski HTTP ${res.status}`);
      const j: any = await res.json().catch(() => { throw new Error(EXP); });
      const list: any[] = j?.pojos ?? [];
      const before = all.length;
      for (const p of list) if (!all.some((x) => x.idTicket === p.idTicket)) all.push(p);
      if (!list.length || all.length === before || all.length >= (j?.totalElements ?? 0)) break;
    }
    const { data: existing } = await supabase.from("eroski_tickets" as any).select("ticket_id");
    const known = new Set(((existing ?? []) as any[]).map((r) => r.ticket_id));
    const rows = all.filter((p) => p?.idTicket).map((p) => ({
      user_id: userId,
      ticket_id: String(p.idTicket),
      purchase_date: isoDay(p.fecha) ?? (p.objetoDate ? new Date(p.objetoDate).toISOString().slice(0, 10) : null),
      store: p.concepto ?? null,
      amount: typeof p.importe === "number" ? p.importe : null,
      savings: typeof p.ahorroTicket === "number" ? p.ahorroTicket : null,
      raw: p,
    }));
    if (rows.length) {
      const { error } = await supabase.from("eroski_tickets" as any).upsert(rows as any, { onConflict: "user_id,ticket_id" });
      if (error) throw new Error(`Guardar: ${error.message}`);
    }
    return { ok: true as const, count: rows.length, nuevos: rows.filter((r) => !known.has(r.ticket_id)).length };
  });

export const downloadEroskiTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; curl: string }) => { if (!d?.id || !d?.curl) throw new Error("Faltan datos"); return d; })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const token = parseEroskiToken(data.curl);
    const { data: row, error } = await supabase.from("eroski_tickets" as any).select("*").eq("id", data.id).single();
    if (error || !row) throw new Error(error?.message ?? "Ticket no encontrado");
    const r: any = row;
    const res = await fetch(`${API}/download/detalle/compra/id?idCompra=${encodeURIComponent(r.ticket_id)}`, { headers: headers(token, false) });
    if (expired(res.status)) throw new Error(EXP);
    if (!res.ok) throw new Error(`Eroski HTTP ${res.status}`);
    const pdf = new Uint8Array(await res.arrayBuffer());
    if (!(pdf[0] === 0x25 && pdf[1] === 0x50)) throw new Error(EXP);

    let items: any[] | null = null;
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const { text } = await extractText(await getDocumentProxy(pdf.slice()), { mergePages: true });
      items = parseEroskiItems(String(text));
    } catch (e) { console.error("eroski parse", e); }

    const path = `${userId}/eroski/${r.purchase_date ?? "sin-fecha"}_${r.ticket_id}.pdf`;
    const { error: e2 } = await supabase.storage.from("invoices").upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (e2) throw new Error(`Storage: ${e2.message}`);
    await supabase.from("eroski_tickets" as any)
      .update({ pdf_storage_path: path, ...(items ? { items } : {}) } as any).eq("id", data.id);
    const { data: signed, error: e3 } = await supabase.storage.from("invoices").createSignedUrl(path, 600);
    if (e3) throw new Error(`Signed URL: ${e3.message}`);
    return { ok: true as const, url: signed.signedUrl };
  });
