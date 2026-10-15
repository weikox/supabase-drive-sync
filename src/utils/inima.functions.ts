import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BASE = "https://oficinavirtual.inimawater.es";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

function sessionCookie(res: Response): string | null {
  const m = res.headers.get("set-cookie")?.match(/JSESSIONID=[^;]+/);
  return m ? m[0] : null;
}

async function get(path: string, cookie: string) {
  return fetch(`${BASE}${path}`, { headers: { cookie, "user-agent": UA }, redirect: "follow" });
}

async function inimaLogin(): Promise<string> {
  const user = process.env.INIMA_USER;
  const pass = process.env.INIMA_PASS;
  if (!user || !pass) throw new Error("INIMA_USER / INIMA_PASS no configuradas");

  const pre = await fetch(`${BASE}/OficinaVirtual/login`, { headers: { "user-agent": UA } });
  let cookie = sessionCookie(pre);
  const html = await pre.text();
  const csrf = html.match(/name="_csrf" value="([^"]+)"/)?.[1];
  if (!cookie || !csrf) throw new Error("Inima: no se pudo iniciar sesión (sin token)");

  const res = await fetch(`${BASE}/OficinaVirtual/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie, "user-agent": UA },
    body: new URLSearchParams({ username: user, password: pass, _csrf: csrf }),
  });
  cookie = sessionCookie(res) ?? cookie;
  const loc = res.headers.get("location") ?? "";
  await res.text();
  if (loc.includes("/login")) throw new Error("Inima: usuario o contraseña incorrectos");
  return cookie;
}

const clean = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const toDate = (s: string) => {
  const d = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return d ? `${d[3]}-${d[2]}-${d[1]}` : null;
};

function parseInvoices(html: string, contract: string) {
  const out: any[] = [];
  const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  for (const tr of tbody.split(/<tr[^>]*>/).slice(1)) {
    const key = tr.match(/\/informes\/factura\/([^/"]+)\/descarga\.pdf/)?.[1];
    if (!key) continue;
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => clean(m[1]));
    // [num(print), num, emision, vencimiento, descripcion, total, estado, ...]
    const amount = tds[5]?.replace(/[€\s]/g, "").replace(",", ".");
    out.push({
      invoice_key: key,
      invoice_num: tds[1] || tds[0] || null,
      contract_id: contract,
      issued_date: toDate(tds[2] ?? ""),
      due_date: toDate(tds[3] ?? ""),
      description: tds[4] || null,
      amount: amount && !isNaN(Number(amount)) ? Number(amount) : null,
      status: tds[6] || null,
    });
  }
  return out;
}

export const syncInimaInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const cookie = await inimaLogin();
    const home = await (await get("/OficinaVirtual/cliente/principal", cookie)).text();
    const contracts = [...new Set([...home.matchAll(/\/OficinaVirtual\/contrato\/([^/"]+)\//g)].map((m) => m[1]))];
    if (!contracts.length) throw new Error("Inima: no se encontraron contratos");

    const rows: any[] = [];
    for (const c of contracts) {
      for (let page = 0; page < 20; page++) {
        const html = await (await get(`/OficinaVirtual/contrato/${c}/facturas?page=${page}&size=100`, cookie)).text();
        const items = parseInvoices(html, c).filter((i) => !rows.some((r) => r.invoice_key === i.invoice_key));
        if (!items.length) break;
        rows.push(...items);
        if (items.length < 100) break;
      }
    }
    if (rows.length) {
      const { error } = await supabase
        .from("inima_invoices")
        .upsert(rows.map((r) => ({ ...r, user_id: userId })), { onConflict: "user_id,invoice_key" });
      if (error) throw new Error(`Upsert: ${error.message}`);
    }
    return { ok: true as const, count: rows.length };
  });

export const downloadInimaInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => {
    if (!data?.id) throw new Error("id requerido");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error: e1 } = await supabase.from("inima_invoices").select("*").eq("id", data.id).single();
    if (e1 || !row) throw new Error(e1?.message ?? "Factura no encontrada");

    const cookie = await inimaLogin();
    const res = await get(`/OficinaVirtual/informes/factura/${encodeURIComponent(row.invoice_key)}/descarga.pdf`, cookie);
    if (!res.ok) throw new Error(`PDF HTTP ${res.status}`);
    const pdf = new Uint8Array(await res.arrayBuffer());
    if (!(pdf[0] === 0x25 && pdf[1] === 0x50)) throw new Error("La respuesta no es un PDF");

    const path = `${userId}/inima/${row.issued_date ?? "sin-fecha"}_${row.invoice_key}.pdf`;
    const { error: e2 } = await supabase.storage
      .from("invoices")
      .upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (e2) throw new Error(`Storage: ${e2.message}`);
    await supabase.from("inima_invoices").update({ pdf_storage_path: path }).eq("id", data.id);

    const { data: signed, error: e3 } = await supabase.storage.from("invoices").createSignedUrl(path, 600);
    if (e3) throw new Error(`Signed URL: ${e3.message}`);
    return { ok: true as const, path, url: signed.signedUrl, size: pdf.byteLength };
  });
