import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const COGNITO_URL = "https://cognito-idp.eu-west-1.amazonaws.com/";
const COGNITO_CLIENT_ID = "544rp4im2pvqsbtpcdejmc75ml";
const API_BASE = "https://api.naturgy.com/ntgy-fua-e-fua/fua/api";
const DEFAULT_CONTRACT = "2001816104";
const DEFAULT_X_CLIENT_ID = "001aA00000A9yaHQAR";
const DEFAULT_X_CONTACT_ID = "003aA00000BeEIrQAN";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

type Tokens = { accessToken: string; idToken: string };

async function cognitoLogin(): Promise<{ nif: string; tokens: Tokens }> {
  const nif = process.env.NATURGY_NIF;
  const pass = process.env.NATURGY_PASS;
  if (!nif || !pass) throw new Error("NATURGY_NIF / NATURGY_PASS no configuradas");

  const res = await fetch(COGNITO_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: { USERNAME: nif, PASSWORD: pass },
    }),
  });
  if (!res.ok) throw new Error(`Login Cognito falló HTTP ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  const auth = data.AuthenticationResult;
  if (!auth) throw new Error(`Respuesta Cognito inesperada: ${JSON.stringify(data)}`);
  return {
    nif,
    tokens: { accessToken: auth.AccessToken, idToken: auth.IdToken },
  };
}

function traceparent() {
  const hex = (n: number) =>
    Array.from(crypto.getRandomValues(new Uint8Array(n)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  return `00-${hex(16)}-${hex(8)}-01`;
}

function naturgyHeaders(nif: string, t: Tokens): Record<string, string> {
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "es,es-ES;q=0.9,en;q=0.8",
    nif,
    origin: "https://omega.naturgy.es",
    referer: "https://omega.naturgy.es/",
    "sec-ch-ua": '"Microsoft Edge";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "cross-site",
    "skip-loading": "true",
    "user-agent": USER_AGENT,
    "x-access-token": t.accessToken,
    "x-id-token": t.idToken,
    "x-client-code": nif,
    "x-client-doc-number": nif,
    "x-client-id": DEFAULT_X_CLIENT_ID,
    "x-contact-id": DEFAULT_X_CONTACT_ID,
    "x-language": "es",
    "x-origin": "AC",
    "x-trading-company": "newco",
    "x-user-role": "newcoClient",
    traceparent: traceparent(),
  };
}

async function fetchInvoiceList(nif: string, t: Tokens, contract: string): Promise<any[]> {
  const url = `${API_BASE}/invoices?contractAccountId=${encodeURIComponent(contract)}`;
  const res = await fetch(url, { headers: naturgyHeaders(nif, t) });
  if (!res.ok) throw new Error(`/invoices HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json: any = await res.json();
  return json.InvoicesPDS ?? [];
}

function b64encode(s: string): string {
  // Worker-friendly base64
  return btoa(unescape(encodeURIComponent(s)));
}

async function fetchInvoicePdf(
  nif: string,
  t: Tokens,
  opts: { invoiceCode?: string; documentId?: string },
): Promise<Uint8Array> {
  const documentId =
    opts.documentId ?? b64encode(`fact_${nif}_${opts.invoiceCode}`);
  const url =
    `${API_BASE}/pdfDocument?pdfDocumentType=invoice` +
    `&docNumber=${encodeURIComponent(nif)}` +
    `&documentId=${encodeURIComponent(documentId)}`;
  const res = await fetch(url, { headers: naturgyHeaders(nif, t) });
  if (!res.ok) throw new Error(`pdfDocument HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const ctype = res.headers.get("content-type") ?? "";
  const buf = new Uint8Array(await res.arrayBuffer());
  if (ctype.includes("application/pdf") || (buf[0] === 0x25 && buf[1] === 0x50)) {
    return buf; // %PDF
  }
  // Intentar JSON con base64
  try {
    const text = new TextDecoder().decode(buf);
    const json = JSON.parse(text);
    for (const k of ["pdfDocument", "pdf", "document", "documentBase64", "data", "file", "content"]) {
      if (typeof json[k] === "string") {
        const bin = atob(json[k]);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      }
    }
    throw new Error(`PDF: respuesta JSON sin campo base64: ${Object.keys(json).join(",")}`);
  } catch {
    return buf;
  }
}

/** Sincroniza la lista de facturas: hace login + GET /invoices + upsert en BD. */
export const syncNaturgyInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { nif, tokens } = await cognitoLogin();
    const invoices = await fetchInvoiceList(nif, tokens, DEFAULT_CONTRACT);

    const rows = invoices.map((inv: any) => ({
      user_id: userId,
      contract_account_id: DEFAULT_CONTRACT,
      invoice_id: String(inv.invoiceId ?? inv.invoiceNum ?? ""),
      invoice_num: inv.invoiceNum ?? null,
      issued_date: inv.issuedDate ? String(inv.issuedDate).slice(0, 10) : null,
      period_from: inv.periodStart ? String(inv.periodStart).slice(0, 10) : null,
      period_to: inv.periodEnd ? String(inv.periodEnd).slice(0, 10) : null,
      amount:
        typeof inv.amount === "number"
          ? inv.amount
          : inv.totalAmount ?? inv.importe ?? null,
      status: inv.status ?? inv.estado ?? null,
      pdf_document_id: inv.pdfDocumentId ?? null,
      raw: inv,
    }));

    if (rows.length > 0) {
      const { error } = await supabase
        .from("naturgy_invoices")
        .upsert(rows, { onConflict: "user_id,contract_account_id,invoice_id" });
      if (error) throw new Error(`Upsert: ${error.message}`);
    }
    return { ok: true as const, count: rows.length };
  });

/** Descarga una factura concreta, la sube a Storage y guarda la ruta. */
export const downloadNaturgyInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => {
    if (!data?.id) throw new Error("id requerido");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error: e1 } = await supabase
      .from("naturgy_invoices")
      .select("*")
      .eq("id", data.id)
      .single();
    if (e1 || !row) throw new Error(e1?.message ?? "Factura no encontrada");

    const { nif, tokens } = await cognitoLogin();
    const pdf = await fetchInvoicePdf(nif, tokens, {
      invoiceCode: row.invoice_id,
      documentId: row.pdf_document_id ?? undefined,
    });

    const path = `${userId}/${row.contract_account_id}/${row.issued_date ?? "sin-fecha"}_${row.invoice_id}.pdf`;
    const { error: e2 } = await supabase.storage
      .from("invoices")
      .upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (e2) throw new Error(`Storage: ${e2.message}`);

    await supabase
      .from("naturgy_invoices")
      .update({ pdf_storage_path: path })
      .eq("id", data.id);

    const { data: signed, error: e3 } = await supabase.storage
      .from("invoices")
      .createSignedUrl(path, 60 * 10);
    if (e3) throw new Error(`Signed URL: ${e3.message}`);

    return { ok: true as const, path, url: signed.signedUrl, size: pdf.byteLength };
  });

/** Genera una URL firmada para un PDF ya descargado. */
export const getNaturgyInvoiceUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { path: string }) => {
    if (!data?.path) throw new Error("path requerido");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: signed, error } = await supabase.storage
      .from("invoices")
      .createSignedUrl(data.path, 60 * 10);
    if (error) throw new Error(error.message);
    return { ok: true as const, url: signed.signedUrl };
  });
