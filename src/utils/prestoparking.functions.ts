import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withAppSecrets } from "./app-secrets";

const BASE = "https://secure.prestoparking.com/mobipayparking/";

async function prestoLogin(): Promise<string> {
  const user = process.env.PRESTO_USER;
  const pass = process.env.PRESTO_PASS;
  if (!user || !pass) throw new Error("PRESTO_USER / PRESTO_PASS no configuradas");
  const res = await fetch(
    `${BASE}authToken?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`,
    { headers: { accept: "application/json" } },
  );
  const text = await res.text();
  const m = res.headers.get("set-cookie")?.match(/authToken=[^;]+/);
  if (!res.ok || !m) throw new Error(`Login PrestoParking falló (HTTP ${res.status}): ${text.slice(0, 200)}`);
  return m[0];
}

const toIso = (s: unknown) => (typeof s === "number" && s > 0 ? new Date(s * 1000).toISOString() : null);

export const syncPrestoTickets = createServerFn({ method: "POST" })
  .middleware([withAppSecrets])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const cookie = await prestoLogin();
    const now = Math.floor(Date.now() / 1000);
    const from = now - 3 * 365 * 86400;
    const res = await fetch(`${BASE}usertxoverview?from=${from}&to=${now}`, {
      headers: { cookie, accept: "application/json" },
    });
    if (!res.ok) throw new Error(`PrestoParking HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const list: any[] = await res.json();
    const rows = (Array.isArray(list) ? list : [])
      .filter((t) => t?.parkId != null)
      .map((t) => ({
        user_id: userId,
        park_id: String(t.parkId),
        started_at: toIso(t.begin),
        ended_at: toIso(t.end),
        license_plate: t.licenseplate ?? null,
        city: t.mandant ?? null,
        zone: t.zone ?? null,
        amount: typeof t.price === "number" ? t.price : null,
        fee: typeof t.txfee === "number" ? t.txfee : null,
        raw: t,
      }));
    if (rows.length) {
      const { error } = await supabase
        .from("prestoparking_invoices" as any)
        .upsert(rows as any, { onConflict: "user_id,park_id" });
      if (error) throw new Error(`Guardar: ${error.message}`);
    }
    return { ok: true as const, count: rows.length };
  });

export const downloadPrestoTicket = createServerFn({ method: "POST" })
  .middleware([withAppSecrets])
  .inputValidator((data: { id: string }) => {
    if (!data?.id) throw new Error("id requerido");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error: e1 } = await supabase
      .from("prestoparking_invoices" as any)
      .select("*")
      .eq("id", data.id)
      .single();
    if (e1 || !row) throw new Error(e1?.message ?? "Ticket no encontrado");
    const r: any = row;

    const cookie = await prestoLogin();
    const res = await fetch(`${BASE}recipeservice?parkId=${encodeURIComponent(r.park_id)}`, {
      headers: { cookie },
    });
    if (!res.ok) throw new Error(`PDF HTTP ${res.status}`);
    const pdf = new Uint8Array(await res.arrayBuffer());
    if (!(pdf[0] === 0x25 && pdf[1] === 0x50)) throw new Error("La respuesta no es un PDF");

    const day = r.started_at ? String(r.started_at).slice(0, 10) : "sin-fecha";
    const path = `${userId}/prestoparking/${day}_${r.park_id}.pdf`;
    const { error: e2 } = await supabase.storage
      .from("invoices")
      .upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (e2) throw new Error(`Storage: ${e2.message}`);
    await supabase.from("prestoparking_invoices" as any).update({ pdf_storage_path: path } as any).eq("id", data.id);

    const { data: signed, error: e3 } = await supabase.storage.from("invoices").createSignedUrl(path, 600);
    if (e3) throw new Error(`Signed URL: ${e3.message}`);
    return { ok: true as const, path, url: signed.signedUrl };
  });
