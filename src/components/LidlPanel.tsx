import { Fragment, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { syncLidlTickets, downloadLidlTicket, startLidlLogin, finishLidlLogin, getLidlStatus } from "@/utils/lidl.functions";
import { getNaturgyInvoiceUrl } from "@/utils/naturgy.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, Download, DownloadCloud, ChevronDown, ChevronRight, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";

type Item = { description: string; numberUnits: number; netAmount: number };
type Row = {
  id: string; ticket_id: string; purchase_date: string | null; store: string | null;
  amount: number | null; items: Item[] | null; pdf_storage_path: string | null;
};

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sesión no encontrada, vuelve a iniciar sesión");
  return { Authorization: `Bearer ${token}` };
}

async function openPdf(url: string, filename: string) {
  const blobUrl = URL.createObjectURL(await (await fetch(url)).blob());
  const w = window.open(blobUrl, "_blank");
  if (!w) { const a = document.createElement("a"); a.href = blobUrl; a.download = filename; a.click(); }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

const fmt = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("es-ES") : "—";
const eur = (n: number | null) => (n != null ? `${Number(n).toFixed(2)} €` : "—");

export function LidlPanel() {
  const _sync = useServerFn(syncLidlTickets);
  const _dl = useServerFn(downloadLidlTicket);
  const _start = useServerFn(startLidlLogin);
  const _finish = useServerFn(finishLidlLogin);
  const _status = useServerFn(getLidlStatus);
  const [connected, setConnected] = useState(false);
  const [linking, setLinking] = useState(false);
  const _url = useServerFn(getNaturgyInvoiceUrl);
  const [rows, setRows] = useState<Row[]>([]);
  const [curl, setCurl] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase.from("lidl_tickets" as any).select("*")
      .order("purchase_date", { ascending: false, nullsFirst: false });
    if (error) toast.error(error.message); else setRows((data ?? []) as unknown as Row[]);
  }
  useEffect(() => { load(); refreshStatus(); }, []);
  async function refreshStatus() { try { const s = await _status({ headers: await authHeaders() } as any); setConnected(s.connected); } catch {} }
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  async function handleStart() {
    try { const r = await _start({ headers: await authHeaders() } as any); setAuthUrl(r.url); }
    catch (e: any) { toast.error(e?.message ?? "Error"); }
  }
  async function handleFinish() {
    setLinking(true);
    try { await _finish({ data: { text: curl }, headers: await authHeaders() } as any); setCurl(""); toast.success("Cuenta de Lidl Plus conectada"); await refreshStatus(); }
    catch (e: any) { toast.error(e?.message ?? "Error al conectar"); }
    finally { setLinking(false); }
  }

  const needCurl = () => { if (!connected) throw new Error("Primero conecta tu cuenta de Lidl Plus"); };
  const dl = async (id: string) => _dl({ data: { id }, headers: await authHeaders() } as any);

  async function handleSync() {
    setSyncing(true);
    try {
      needCurl();
      const r = await _sync({ headers: await authHeaders() } as any);
      toast.success(`${r.count} compras · ${r.nuevos} nuevas`);
      await load();
    } catch (e: any) { toast.error(e?.message ?? "Error al sincronizar"); }
    finally { setSyncing(false); }
  }

  async function handleRow(r: Row) {
    setBusyId(r.id);
    try {
      const name = `Lidl_${r.purchase_date?.slice(0, 10) ?? r.ticket_id}.pdf`;
      if (r.pdf_storage_path) {
        const u = await _url({ data: { path: r.pdf_storage_path }, headers: await authHeaders() } as any);
        await openPdf(u.url, name);
      } else {
        needCurl();
        await openPdf((await dl(r.id)).url, name);
        await load();
      }
    } catch (e: any) { toast.error(e?.message ?? "Error al descargar"); }
    finally { setBusyId(null); }
  }

  async function handleAll() {
    try { needCurl(); } catch (e: any) { return toast.error(e.message); }
    const pending = rows.filter((r) => !r.pdf_storage_path);
    if (!pending.length) return toast.info("Todos los tickets ya están descargados");
    setBulk(true);
    let ok = 0, fail = 0;
    for (const r of pending) { try { await dl(r.id); ok++; } catch { fail++; } }
    setBulk(false); await load();
    toast[fail === 0 ? "success" : "warning"](`Descargados ${ok} · ${fail} fallidos`);
  }

  function handleCsv() {
    const q = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const n = (v: any) => (v == null || v === "" ? "" : String(Number(v).toFixed(2)).replace(".", ","));
    const lines = [["Fecha", "Hora", "Tienda", "Ticket", "Producto", "Unidades", "Importe", "Total ticket"].join(";")];
    for (const r of rows) {
      const d = r.purchase_date ? new Date(r.purchase_date) : null;
      const day = d ? d.toLocaleDateString("es-ES") : "", hour = d ? d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "";
      const its = r.items?.length ? r.items : [null];
      for (const it of its) lines.push([q(day), q(hour), q(r.store), q(r.ticket_id), q(it?.description ?? ""),
        it ? String(it.numberUnits ?? "").replace(".", ",") : "", it ? n(it.netAmount) : "", n(r.amount)].join(";"));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `lidl_consumo_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    const sin = rows.filter((r) => !r.items?.length).length;
    if (sin) toast.info(`${sin} compras sin desglose: pulsa "Descargar todos" para completarlas`);
  }

  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const downloaded = rows.filter((r) => r.pdf_storage_path).length;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Tickets Lidl</h2>
          <p className="text-muted-foreground mt-1">Tus compras con Lidl Plus.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleCsv} disabled={rows.length === 0}>
            <FileSpreadsheet className="h-4 w-4 mr-2" /> Exportar datos (Excel)
          </Button>
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

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">{connected ? "Cuenta de Lidl Plus conectada ✓" : "Conectar tu cuenta de Lidl Plus (solo una vez)"}</CardTitle>
          <CardDescription>
            1) Abre F12 → Red en esta pestaña del navegador y pulsa "Abrir acceso a Lidl". 2) Entra con tu email, contraseña y el código SMS.
            3) Al terminar la página se queda en blanco: en Red busca la petición "callback" (o la que contenga "code="), copia su URL o cabecera "location" y pégala aquí. 4) Pulsa "Conectar".
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="outline" onClick={handleStart}>Generar enlace de acceso a Lidl</Button>
          {authUrl && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm"><a href={authUrl} target="_blank" rel="noopener noreferrer">Abrir acceso a Lidl</a></Button>
                <Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(authUrl); toast.success("Enlace copiado"); }}>Copiar enlace</Button>
              </div>
              <p className="text-xs text-muted-foreground break-all select-all">{authUrl}</p>
              <p className="text-xs text-muted-foreground">Usa solo el último enlace generado. Debe abrirse en accounts.lidl.com.</p>
            </div>
          )}
          <Textarea rows={3} value={curl} onChange={(e) => setCurl(e.target.value)} placeholder="com.lidlplus.app://callback?code=..." />
          <Button onClick={handleFinish} disabled={linking || !curl.trim()}>
            {linking && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Conectar
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
        <Card><CardHeader><CardDescription>Compras</CardDescription><CardTitle>{rows.length}</CardTitle></CardHeader></Card>
        <Card><CardHeader><CardDescription>Gasto total</CardDescription><CardTitle>{total.toFixed(2)} €</CardTitle></CardHeader></Card>
        <Card><CardHeader><CardDescription>PDFs descargados</CardDescription><CardTitle>{downloaded} / {rows.length}</CardTitle></CardHeader></Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          {rows.length === 0 ? (
            <p className="text-center py-12 text-muted-foreground">No hay tickets todavía.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Fecha</TableHead>
                    <TableHead>Tienda</TableHead>
                    <TableHead className="text-right">Importe</TableHead>
                    <TableHead className="text-right">PDF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <Fragment key={r.id}>
                      <TableRow className="cursor-pointer" onClick={() => setOpen(open === r.id ? null : r.id)}>
                        <TableCell>{open === r.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell>{fmt(r.purchase_date)}</TableCell>
                        <TableCell>{r.store ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{eur(r.amount)}</TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant={r.pdf_storage_path ? "outline" : "default"}
                            onClick={() => handleRow(r)} disabled={busyId === r.id || bulk}>
                            {busyId === r.id ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
                            {r.pdf_storage_path ? "Abrir" : "Descargar"}
                          </Button>
                        </TableCell>
                      </TableRow>
                      {open === r.id && (
                        <TableRow>
                          <TableCell />
                          <TableCell colSpan={4}>
                            {r.items?.length ? (
                              <ul className="text-sm space-y-1">
                                {r.items.map((it, i) => (
                                  <li key={i} className="flex justify-between gap-4">
                                    <span>{it.description} <span className="text-muted-foreground">× {it.numberUnits}</span></span>
                                    <span className="tabular-nums">{eur(it.netAmount)}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : <span className="text-sm text-muted-foreground">Sin desglose de artículos.</span>}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
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
