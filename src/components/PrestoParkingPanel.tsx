import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { syncPrestoTickets, downloadPrestoTicket } from "@/utils/prestoparking.functions";
import { getNaturgyInvoiceUrl } from "@/utils/naturgy.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, Download, DownloadCloud } from "lucide-react";
import { toast } from "sonner";

type Row = {
  id: string;
  park_id: string;
  started_at: string | null;
  ended_at: string | null;
  license_plate: string | null;
  city: string | null;
  zone: string | null;
  amount: number | null;
  pdf_storage_path: string | null;
};

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sesión no encontrada, vuelve a iniciar sesión");
  return { Authorization: `Bearer ${token}` };
}

const fmt = (s: string | null) =>
  s ? new Date(s).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "—";

async function openPdf(url: string, filename: string) {
  const res = await fetch(url);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const w = window.open(blobUrl, "_blank");
  if (!w) {
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

export function PrestoParkingPanel() {
  const _sync = useServerFn(syncPrestoTickets);
  const _dl = useServerFn(downloadPrestoTicket);
  const _url = useServerFn(getNaturgyInvoiceUrl);
  const [rows, setRows] = useState<Row[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("prestoparking_invoices" as any)
      .select("*")
      .order("started_at", { ascending: false, nullsFirst: false });
    if (error) toast.error(error.message);
    else setRows((data ?? []) as unknown as Row[]);
  }
  useEffect(() => { load(); }, []);

  const dl = async (id: string) => _dl({ data: { id }, headers: await authHeaders() } as any);

  async function handleSync() {
    setSyncing(true);
    try {
      const r = await _sync({ headers: await authHeaders() } as any);
      toast.success(`Sincronizados ${r.count} tickets`);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Error al sincronizar");
    } finally { setSyncing(false); }
  }

  async function handleRow(r: Row) {
    setBusyId(r.id);
    try {
      const name = `PrestoParking_${r.started_at?.slice(0, 10) ?? r.park_id}.pdf`;
      if (r.pdf_storage_path) {
        const u = await _url({ data: { path: r.pdf_storage_path }, headers: await authHeaders() } as any);
        await openPdf(u.url, name);
      } else {
        const res = await dl(r.id);
        await openPdf(res.url, name);
        await load();
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Error al descargar");
    } finally { setBusyId(null); }
  }

  async function handleAll() {
    const pending = rows.filter((r) => !r.pdf_storage_path);
    if (!pending.length) return toast.info("Todos los tickets ya están descargados");
    setBulk(true);
    let ok = 0, fail = 0;
    for (const r of pending) { try { await dl(r.id); ok++; } catch { fail++; } }
    setBulk(false);
    await load();
    toast[fail === 0 ? "success" : "warning"](`Descargados ${ok} · ${fail} fallidos`);
  }

  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const downloaded = rows.filter((r) => r.pdf_storage_path).length;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Tickets PrestoParking</h2>
          <p className="text-muted-foreground mt-1">Aparcamiento regulado en la calle (zona azul / roja).</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSync} disabled={syncing || bulk}>
            {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sincronizar lista
          </Button>
          <Button onClick={handleAll} disabled={bulk || syncing || rows.length === 0}>
            {bulk ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <DownloadCloud className="h-4 w-4 mr-2" />}
            Descargar todos
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
        <Card><CardHeader><CardDescription>Total tickets</CardDescription><CardTitle>{rows.length}</CardTitle></CardHeader></Card>
        <Card><CardHeader><CardDescription>Gasto total</CardDescription><CardTitle>{total.toFixed(2)} €</CardTitle></CardHeader></Card>
        <Card><CardHeader><CardDescription>PDFs descargados</CardDescription><CardTitle>{downloaded} / {rows.length}</CardTitle></CardHeader></Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Tickets</CardTitle>
          <CardDescription>Pulsa "Sincronizar lista" para traer los tickets de los últimos 3 años.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-center py-12 text-muted-foreground">No hay tickets todavía.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Inicio</TableHead>
                    <TableHead>Fin</TableHead>
                    <TableHead>Matrícula</TableHead>
                    <TableHead>Lugar</TableHead>
                    <TableHead className="text-right">Importe</TableHead>
                    <TableHead className="text-right">PDF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{fmt(r.started_at)}</TableCell>
                      <TableCell>{fmt(r.ended_at)}</TableCell>
                      <TableCell className="font-mono text-xs">{r.license_plate ?? "—"}</TableCell>
                      <TableCell className="text-xs">{[r.city, r.zone].filter(Boolean).join(" · ") || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.amount != null ? `${Number(r.amount).toFixed(2)} €` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant={r.pdf_storage_path ? "outline" : "default"}
                          onClick={() => handleRow(r)} disabled={busyId === r.id || bulk}>
                          {busyId === r.id ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
                          {r.pdf_storage_path ? "Abrir" : "Descargar"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
