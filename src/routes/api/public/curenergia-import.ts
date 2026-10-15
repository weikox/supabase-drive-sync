import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "https://www.curenergia.es",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

function toNum(s: unknown): number | null {
  if (typeof s === "number") return s;
  if (typeof s !== "string" || !s) return null;
  const n = Number(s.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export const Route = createFileRoute("/api/public/curenergia-import")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        let body: any;
        try { body = await request.json(); } catch { return json({ error: "JSON inválido" }, 400); }
        const token = typeof body?.token === "string" ? body.token : "";
        if (token.length < 32) return json({ error: "Falta el código de acceso" }, 401);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: sess } = await supabaseAdmin
          .from("curenergia_sessions").select("user_id").eq("auth_token", token).eq("cookie", "bookmarklet").maybeSingle();
        if (!sess) return json({ error: "Botón caducado: cópialo de nuevo desde la app" }, 401);
        const userId = sess.user_id as string;

        if (Array.isArray(body.invoices)) {
          const rows = body.invoices.slice(0, 500).map((f: any) => ({
            user_id: userId,
            supply: f.supply === "gas" ? "gas" : "luz",
            contract_id: f.codContrato != null ? String(f.codContrato) : null,
            invoice_id: String(f.factura),
            invoice_num: f.numFacturaIva || null,
            issued_date: f.fecha || null,
            period_from: f.fecMinTerEne || null,
            period_to: f.fecMaxTerEne || null,
            amount: toNum(f.importeOrdenacion) ?? toNum(f.importe),
            consumption: f.consumo || null,
            status: f.descEstado || null,
          })).filter((r: any) => r.invoice_id && r.invoice_id !== "undefined");
          if (rows.length) {
            const { error } = await supabaseAdmin.from("curenergia_invoices").upsert(rows, { onConflict: "user_id,invoice_id" });
            if (error) return json({ error: error.message }, 500);
          }
          return json({ ok: true, count: rows.length });
        }

        if (body.pdf && typeof body.pdf.base64 === "string") {
          const { data: inv } = await supabaseAdmin.from("curenergia_invoices")
            .select("id, supply, invoice_id, invoice_num")
            .eq("user_id", userId).eq("invoice_id", String(body.pdf.invoice_id)).maybeSingle();
          if (!inv) return json({ error: "Factura no encontrada" }, 404);
          const bin = Uint8Array.from(atob(body.pdf.base64), (c) => c.charCodeAt(0));
          if (bin.length < 5 || String.fromCharCode(...bin.slice(0, 4)) !== "%PDF") return json({ error: "No es un PDF" }, 400);
          const path = `${userId}/curenergia/${inv.supply}/${String(inv.invoice_num ?? inv.invoice_id).replace(/[^\w.-]/g, "_")}.pdf`;
          const { error } = await supabaseAdmin.storage.from("invoices").upload(path, bin, { contentType: "application/pdf", upsert: true });
          if (error) return json({ error: error.message }, 500);
          await supabaseAdmin.from("curenergia_invoices").update({ pdf_storage_path: path }).eq("id", inv.id);
          return json({ ok: true });
        }
        return json({ error: "Nada que importar" }, 400);
      },
    },
  },
});
