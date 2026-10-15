import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BASE = "https://ov.gomezgroupmetering.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

function extractCookie(res: Response): string | null {
  const raw = res.headers.get("set-cookie");
  const m = raw?.match(/JSESSIONID=[^;]+/);
  return m ? m[0] : null;
}

async function gomezLogin(): Promise<{ cookie: string; html: string }> {
  const user = process.env.GOMEZ_USER;
  const pass = process.env.GOMEZ_PASS;
  if (!user || !pass) throw new Error("GOMEZ_USER / GOMEZ_PASS no configuradas");

  const pre = await fetch(`${BASE}/preLogin`, { headers: { "user-agent": UA } });
  let cookie = extractCookie(pre);
  await pre.text();

  const body = new URLSearchParams({ userTypeLogin: "abonado", user, password: pass });
  const res = await fetch(`${BASE}/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
      ...(cookie ? { cookie } : {}),
    },
    body,
  });
  cookie = extractCookie(res) ?? cookie;
  let html = await res.text();
  const loc = res.headers.get("location");
  if (loc && cookie) {
    const r2 = await fetch(new URL(loc, BASE), { headers: { cookie, "user-agent": UA } });
    html = await r2.text();
  }
  if (!cookie) throw new Error("Login Gómez Group: sin cookie de sesión");
  if (!html.includes("tableRecibos")) {
    throw new Error("Login Gómez Group falló (usuario o contraseña incorrectos)");
  }
  return { cookie, html };
}

function parseReceipts(html: string) {
  const out: { receipt_id: string; receipt_date: string | null; supply: string | null; amount: number | null }[] = [];
  const re = /oid\s*:\s*'(\d+)'[\s\S]*?suministro\s*:\s*'([^']*)'[\s\S]*?fechaRecibo\s*:\s*'([^']*)'[\s\S]*?importe\s*:\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [, oid, sum, fecha, imp] = m;
    const d = fecha.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    const n = imp.replace(/&#8364;|€/g, "").replace(/\./g, "").replace(",", ".").trim();
    out.push({
      receipt_id: oid,
      receipt_date: d ? `${d[3]}-${d[2]}-${d[1]}` : null,
      supply: sum.trim() || null,
      amount: n && !isNaN(Number(n)) ? Number(n) : null,
    });
  }
  return out;
}

export const syncGomezInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { html } = await gomezLogin();
    const rows = parseReceipts(html).map((r) => ({ ...r, user_id: userId }));
    if (rows.length > 0) {
      const { error } = await supabase
        .from("gomez_invoices")
        .upsert(rows, { onConflict: "user_id,receipt_id" });
      if (error) throw new Error(`Upsert: ${error.message}`);
    }
    return { ok: true as const, count: rows.length };
  });

export const downloadGomezInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => {
    if (!data?.id) throw new Error("id requerido");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error: e1 } = await supabase
      .from("gomez_invoices")
      .select("*")
      .eq("id", data.id)
      .single();
    if (e1 || !row) throw new Error(e1?.message ?? "Recibo no encontrado");

    const { cookie } = await gomezLogin();
    const res = await fetch(
      `${BASE}/abrirReciboAbonadoPDF?id=${encodeURIComponent(row.receipt_id)}`,
      { headers: { cookie, "user-agent": UA } },
    );
    if (!res.ok) throw new Error(`PDF HTTP ${res.status}`);
    const pdf = new Uint8Array(await res.arrayBuffer());
    if (!(pdf[0] === 0x25 && pdf[1] === 0x50)) throw new Error("La respuesta no es un PDF");

    const path = `${userId}/gomez/${row.receipt_date ?? "sin-fecha"}_${row.receipt_id}.pdf`;
    const { error: e2 } = await supabase.storage
      .from("invoices")
      .upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (e2) throw new Error(`Storage: ${e2.message}`);

    await supabase.from("gomez_invoices").update({ pdf_storage_path: path }).eq("id", data.id);

    const { data: signed, error: e3 } = await supabase.storage
      .from("invoices")
      .createSignedUrl(path, 600);
    if (e3) throw new Error(`Signed URL: ${e3.message}`);
    return { ok: true as const, path, url: signed.signedUrl, size: pdf.byteLength };
  });
