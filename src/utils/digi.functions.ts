import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const API = "https://midigi-backend-es.digimobil.es/v2";
const ORIGIN = "https://midigi.digimobil.es";

// Replica la firma X-C / X-S que usa la web de Digi.
function sign() {
  const a = crypto.getRandomValues(new Uint8Array(32));
  const c = btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  let t = "";
  for (let i = 0; i < c.length; i++) t += String.fromCharCode(c.charCodeAt(i) + ((c.charCodeAt(i) + i * 13) % 20));
  return { "X-C": c, "X-S": btoa(t.split("").reverse().join("")) };
}

function headers(cookie?: string | null, token?: string) {
  const h: Record<string, string> = {
    "content-type": "application/json",
    "X-App": "false",
    origin: ORIGIN,
    referer: `${ORIGIN}/`,
    ...sign(),
  };
  if (cookie) h.cookie = cookie;
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

function setCookies(res: Response): string[] {
  return (res.headers as any).getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
}
function deviceCookie(res: Response, prev: string | null) {
  for (const c of setCookies(res)) {
    const m = String(c).match(/midigi_device=[^;]+/);
    if (m && !/=deleted/.test(m[0])) return m[0];
  }
  return prev;
}
/** Digi entrega el JWT real en la cookie httpOnly midigi_bearer. */
function bearerCookie(res: Response): string | null {
  for (const c of setCookies(res)) {
    const m = String(c).match(/midigi_bearer=([^;]+)/);
    if (m && m[1] !== "deleted") return m[0];
  }
  return null;
}
const join = (...c: (string | null | undefined)[]) => c.filter(Boolean).join("; ") || null;

async function json(res: Response) {
  const t = await res.text();
  try { return JSON.parse(t); } catch { return { raw: t }; }
}

type Ctx = { supabase: any; userId: string };

async function saveSession(ctx: Ctx, patch: Record<string, unknown>) {
  await ctx.supabase.from("digi_sessions").upsert({ user_id: ctx.userId, updated_at: new Date().toISOString(), ...patch });
}

/** Devuelve token o null si Digi pide código SMS (deja el uuid pendiente guardado). */
async function digiLogin(ctx: Ctx): Promise<{ token: string; cookie: string | null; uuid: string } | null> {
  const user = process.env.DIGI_USER;
  const pass = process.env.DIGI_PASS;
  if (!user || !pass) throw new Error("DIGI_USER / DIGI_PASS no configuradas");
  const { data: s } = await ctx.supabase.from("digi_sessions").select("*").eq("user_id", ctx.userId).maybeSingle();
  let cookie: string | null = s?.device_cookie?.match(/midigi_device=[^;]+/)?.[0] ?? null;

  const res = await fetch(`${API}/login`, {
    method: "POST",
    headers: headers(cookie),
    body: JSON.stringify({ username: user, password: pass }),
  });
  cookie = deviceCookie(res, cookie);
  const bearer = bearerCookie(res);
  const j = await json(res);
  if (res.status === 429) throw new Error("Digi: demasiados intentos, espera unos minutos");
  if (!res.ok) throw new Error("Digi: usuario o contraseña incorrectos");
  const d = j?.data ?? {};
  if (d.token || bearer) {
    await saveSession(ctx, { device_cookie: join(cookie, bearer), pending_uuid: null });
    return { token: d.token ?? "", cookie: join(cookie, bearer), uuid: String(d.uuid ?? d.user?.uuid ?? "") };
  }
  if (d.required2FA && d.uuid) {
    await saveSession(ctx, { device_cookie: cookie, pending_uuid: d.uuid });
    return null;
  }
  throw new Error("Digi: respuesta de login inesperada");
}

const num = (v: any) => {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[€\s]/g, "").replace(",", "."));
  return isNaN(n) ? null : n;
};
const pad = (n: any) => String(n).padStart(2, "0");

function findArray(o: any): any[] {
  if (Array.isArray(o)) return o;
  if (o && typeof o === "object") {
    for (const k of ["invoices", "items", "list", "contracts", "data", "results"]) {
      if (Array.isArray(o[k])) return o[k];
    }
    for (const v of Object.values(o)) if (Array.isArray(v)) return v as any[];
  }
  return [];
}

function jwtInfo(token: string) {
  try {
    const p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === "string" && v.length > 12 ? `<${v.length}>` : v]));
  } catch {
    return { notJwt: true, len: token.length };
  }
}

async function getContracts(token: string, cookie: string | null, uuid: string) {
  const url = `${API}/getUserContracts?uuid=${encodeURIComponent(uuid)}`;
  const variants: [string, Record<string, string>][] = [["cookie", headers(cookie, token || undefined)]];
  let last = "";
  for (const [name, h] of variants) {
    const res = await fetch(url, { headers: h });
    const body = await json(res);
    if (res.ok) return body;
    last = `${res.status} ${JSON.stringify(body).slice(0, 200)}`;
    console.error("[digi] contratos", name, last, "jwt:", JSON.stringify(jwtInfo(token)));
    if (res.status !== 401 && res.status !== 403) break;
  }
  throw new Error(`Digi contratos HTTP ${last}`);
}

async function doSync(ctx: Ctx, token: string, cookie: string | null, uuid: string) {
  if (!uuid) throw new Error("Digi: falta el identificador de usuario tras el login");
  const cj = await getContracts(token, cookie, uuid);
  const list = findArray(cj?.data ?? cj);
  if (!list.length) throw new Error("Digi: no se encontraron contratos");

  const rows: any[] = [];
  for (const ct of list) {
    const c = String(ct.id ?? ct.contractId ?? ct.contract ?? "");
    if (!c) continue;
    const uid = String(ct.userId ?? ct.user_id ?? ct.idUser ?? uuid);
    for (let offset = 0; offset < 1; offset += 50) {
      const r = await fetch(`${API}/contract/${encodeURIComponent(c)}/invoices`, { headers: headers(cookie, token) });
      const ij = await json(r);
      if (!r.ok) { console.error("[digi] invoices", c, r.status, JSON.stringify(ij).slice(0, 300)); break; }
      let invs = findArray(ij?.data?.invoices ?? ij?.data ?? ij);
      if (!invs.length) {
        const q = new URLSearchParams({ contract: c, userId: uid, offset: "0", limit: "100" });
        const r2 = await fetch(`${API}/getInvoicesForUser?${q}`, { headers: headers(cookie, token) });
        const j2 = await json(r2);
        if (r2.ok) invs = findArray(j2?.data ?? j2);
      }
      console.log("[digi] contrato", c, "facturas", invs.length);
      for (const inv of invs) {
        const id = String(inv.id ?? inv.invoiceId ?? inv.number ?? "");
        if (!id) continue;
        const dt = inv.date;
        let issued: string | null = null;
        if (dt?.year) issued = `${dt.year}-${pad(dt.month)}-${pad(dt.day)}`;
        else if (typeof dt === "string" && /^\d{4}-\d{2}-\d{2}/.test(dt)) issued = dt.slice(0, 10);
        rows.push({
          user_id: ctx.userId,
          invoice_id: id,
          contract_id: c,
          invoice_num: String(inv.number ?? inv.invoiceNumber ?? inv.code ?? id),
          issued_date: issued,
          amount: num(inv.amount ?? inv.total ?? inv.totalAmount ?? inv.price),
          status: inv.status != null ? String(inv.status) : null,
          pdf_url: inv.url ?? null,
          raw: inv,
        });
      }
      if (invs.length < 50) break;
    }
  }
  if (rows.length) {
    const { error } = await ctx.supabase.from("digi_invoices").upsert(rows, { onConflict: "user_id,invoice_id" });
    if (error) throw new Error(`Upsert: ${error.message}`);
  }
  return rows.length;
}

export const syncDigiInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    try {
      const s = await digiLogin(ctx);
      if (!s) return { ok: false as const, needs2FA: true as const, count: 0, error: null };
      return { ok: true as const, needs2FA: false as const, count: await doSync(ctx, s.token, s.cookie, s.uuid), error: null };
    } catch (e: any) {
      console.error("[digi] sync", e?.message);
      return { ok: false as const, needs2FA: false as const, count: 0, error: String(e?.message ?? e) };
    }
  });

export const verifyDigiCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { code: string }) => {
    if (!data?.code || !/^\w{3,10}$/.test(data.code.trim())) throw new Error("Código no válido");
    return { code: data.code.trim() };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { data: s } = await ctx.supabase.from("digi_sessions").select("*").eq("user_id", ctx.userId).maybeSingle();
    if (!s?.pending_uuid) throw new Error("No hay verificación pendiente. Pulsa Sincronizar de nuevo.");
    let cookie: string | null = s.device_cookie?.match(/midigi_device=[^;]+/)?.[0] ?? null;
    const res = await fetch(`${API}/login/2fa`, {
      method: "POST",
      headers: headers(cookie),
      body: JSON.stringify({ uuid: s.pending_uuid, code: data.code, recovery: false }),
    });
    cookie = deviceCookie(res, cookie);
    const bearer = bearerCookie(res);
    const j = await json(res);
    const token = j?.data?.token ?? "";
    if (!res.ok || (!token && !bearer)) throw new Error("Código incorrecto o caducado");
    cookie = join(cookie, bearer);
    await saveSession(ctx, { device_cookie: cookie, pending_uuid: null });
    const uuid = String(j?.data?.uuid ?? s.pending_uuid);
    try {
      return { ok: true as const, count: await doSync(ctx, token, cookie, uuid), error: null };
    } catch (e: any) {
      console.error("[digi] verify sync", e?.message);
      return { ok: false as const, count: 0, error: String(e?.message ?? e) };
    }
  });

export const resendDigiCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const res = await fetch(`${API}/forward2FACode`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: process.env.DIGI_USER }),
    });
    return { ok: res.ok };
  });

export const downloadDigiInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => {
    if (!data?.id) throw new Error("id requerido");
    return data;
  })
  .handler(async ({ data, context }) => {
    try {
    const ctx = context as unknown as Ctx;
    const { data: row, error: e1 } = await ctx.supabase.from("digi_invoices").select("*").eq("id", data.id).single();
    if (e1 || !row) throw new Error(e1?.message ?? "Factura no encontrada");
    if (!row.pdf_url) throw new Error("Esta factura no tiene PDF disponible");

    const { data: sess } = await ctx.supabase.from("digi_sessions").select("device_cookie").eq("user_id", ctx.userId).maybeSingle();
    const cookie: string | null = sess?.device_cookie ?? null;
    const url = String(row.pdf_url).startsWith("http") ? row.pdf_url : `${API}/${String(row.pdf_url).replace(/^\/?(v2\/)?/, "")}`;
    // Igual que la web oficial (pdfBlob): solo cookies + Content-Type: application/pdf
    const h: Record<string, string> = { "content-type": "application/pdf", accept: "application/pdf, */*", origin: ORIGIN };
    if (cookie) h.cookie = cookie;
    let res = await fetch(url, { headers: h, referrerPolicy: "no-referrer" } as RequestInit);
    let buf = new Uint8Array(await res.arrayBuffer());
    const isPdf0 = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
    if (!isPdf0(buf)) {
      // Reintento con las cabeceras firmadas de la API
      const h2 = headers(cookie);
      h2["content-type"] = "application/pdf";
      const r2 = await fetch(url, { headers: h2 });
      const b2 = new Uint8Array(await r2.arrayBuffer());
      if (isPdf0(b2) || !cookie) { res = r2; buf = b2; }
    }
    const isPdf = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
    let pdf = buf;
    if (!isPdf(pdf)) {
      const text = new TextDecoder().decode(buf);
      console.error("[digi] pdf", res.status, res.headers.get("content-type"), text.slice(0, 300));
      let j: any = null;
      try { j = JSON.parse(text); } catch {}
      const d = j?.data ?? j;
      const b64 = typeof d === "string" ? d : d?.file ?? d?.pdf ?? d?.content ?? d?.base64 ?? null;
      const next = typeof d === "object" ? d?.url ?? d?.link ?? null : null;
      if (b64 && /^[A-Za-z0-9+/=\s]+$/.test(b64.replace(/^data:[^,]+,/, ""))) {
        const bin = atob(b64.replace(/^data:[^,]+,/, "").replace(/\s/g, ""));
        pdf = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      } else if (next) {
        const r2 = await fetch(next, { headers: h });
        pdf = new Uint8Array(await r2.arrayBuffer());
      } else if (res.status === 401 || res.status === 403) {
        throw new Error("Digi rechazó la descarga (sesión o enlace caducado). Pulsa Sincronizar lista y vuelve a probar.");
      } else {
        throw new Error(`Digi no devolvió el PDF (${text.slice(0, 80)}). Los enlaces caducan en ~2 h: pulsa Sincronizar lista y vuelve a descargar.`);
      }
      if (!isPdf(pdf)) throw new Error("La respuesta de Digi no es un PDF");
    }

    const path = `${ctx.userId}/digi/${row.issued_date ?? "sin-fecha"}_${row.invoice_id}.pdf`;
    const { error: e2 } = await ctx.supabase.storage.from("invoices").upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (e2) throw new Error(`Storage: ${e2.message}`);
    await ctx.supabase.from("digi_invoices").update({ pdf_storage_path: path }).eq("id", data.id);
    const { data: signed, error: e3 } = await ctx.supabase.storage.from("invoices").createSignedUrl(path, 600);
    if (e3) throw new Error(`Signed URL: ${e3.message}`);
    return { ok: true as const, path, url: signed.signedUrl, error: null };
    } catch (e: any) {
      console.error("[digi] download", e?.message);
      return { ok: false as const, path: null, url: null, error: String(e?.message ?? e) };
    }
  });
