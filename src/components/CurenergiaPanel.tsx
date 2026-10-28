import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  getCurenergiaImportToken, downloadCurenergiaInvoice, saveCurenergiaSession, syncCurenergiaInvoices,
} from "@/utils/curenergia.functions";
import { getNaturgyInvoiceUrl } from "@/utils/naturgy.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { buildCurenergiaBookmarklet } from "@/lib/curenergia-bookmarklet";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, Download, DownloadCloud, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";

type Row = {
  id: string; supply: string; invoice_num: string | null; issued_date: string | null;
  period_from: string | null; period_to: string | null; amount: number | null;
  consumption: string | null; status: string | null; pdf_storage_path: string | null;
};

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sesión no encontrada, vuelve a iniciar sesión");
  return { Authorization: `Bearer ${token}` };
}

async function openPdf(url: string, filename: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blobUrl = URL.createObjectURL(await res.blob());
  const w = window.open(blobUrl, "_blank");
  if (!w) {
    const a = document.createElement("a");
    a.href = blobUrl; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

export function CurenergiaPanel() {
  const _tok = useServerFn(getCurenergiaImportToken);
  const _dl = useServerFn(downloadCurenergiaInvoice);
  const _url = useServerFn(getNaturgyInvoiceUrl);
  const [rows, setRows] = useState<Row[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [bulk, setBulk] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [bm, setBm] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [curl, setCurl] = useState("");
  const _save = useServerFn(saveCurenergiaSession);
  const _sync = useServerFn(syncCurenergiaInvoices);

  async function connectAndSync() {
    setSyncing(true);
    try {
      const h = await authHeaders();
      await _save({ data: { curl }, headers: h } as any);
      const r: any = await _sync({ headers: h } as any);
      if (r?.error) { toast.error(r.error); return; }
      toast.success(`${r.count} facturas de luz y gas importadas`);
      setPasteOpen(false); setCurl("");
      await load();
    } catch (e: any) { toast.error(e?.message ?? "No se pudo conectar"); }
    finally { setSyncing(false); }
  }

  async function load() {
    const { data, error } = await supabase
      .from("curenergia_invoices").select("*")
      .order("issued_date", { ascending: false, nullsFirst: false });
    if (error) toast.error(error.message); else setRows(data as Row[]);
  }
  useEffect(() => { load(); }, []);

  async function sync() {
    setSyncing(true);
    try { await load(); toast.success("Lista actualizada"); } finally { setSyncing(false); }
  }

  async function openConnect(v: boolean) {
    setOpen(v);
    if (!v || bm) return;
    try {
      const { token } = await _tok({ headers: await authHeaders() } as any);
      const origin = window.location.hostname.startsWith("id-preview--")
        ? window.location.origin : window.location.origin;
      setBm(`${origin}|${token}`);
    } catch (e: any) { toast.error(e?.message ?? "No se pudo preparar el código"); }
  }

  async function downloadExt() {
    try {
      const res = await fetch("/curenergia-extension.zip");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await res.blob());
      a.download = "curenergia-extension.zip";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e: any) { toast.error(e?.message ?? "No se pudo descargar"); }
  }

  const dl = async (id: string) => {
    const r = await _dl({ data: { id }, headers: await authHeaders() } as any);
    if (r.error || !r.url) throw new Error(r.error ?? "Error al descargar");
    return { url: r.url };
  };

  async function handleRow(r: Row) {
    setBusyId(r.id);
    try {
      const name = `Curenergia_${r.supply}_${r.invoice_num ?? r.id}.pdf`;
      const u = r.pdf_storage_path
        ? await _url({ data: { path: r.pdf_storage_path }, headers: await authHeaders() } as any)
        : await dl(r.id);
      await openPdf(u.url, name);
      if (!r.pdf_storage_path) await load();
    } catch (e: any) { toast.error(e?.message ?? "Error al descargar"); }
    finally { setBusyId(null); }
  }

  async function handleAll(supply: string) {
    const pending = rows.filter((r) => r.supply === supply && !r.pdf_storage_path);
    if (!pending.length) return toast.info("Todas las facturas ya están descargadas");
    setBulk(supply);
    let ok = 0, fail = 0;
    for (const r of pending) { try { await dl(r.id); ok++; } catch { fail++; } }
    setBulk(null);
    await load();
    toast[fail === 0 ? "success" : "warning"](`Descargadas ${ok} · ${fail} fallidas`);
  }

  function list(supply: string) {
    const items = rows.filter((r) => r.supply === supply);
    const done = items.filter((r) => r.pdf_storage_path).length;
    return (
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle>{supply === "gas" ? "Gas" : "Luz"}</CardTitle>
            <CardDescription>{items.length} facturas · {done} PDFs guardados</CardDescription>
          </div>
          <Button className="w-full sm:w-auto" onClick={() => handleAll(supply)}
            disabled={!!bulk || syncing || items.length === 0}>
            {bulk === supply ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <DownloadCloud className="h-4 w-4 mr-2" />}
            Descargar todas
          </Button>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-center py-12 text-muted-foreground">No hay facturas todavía.</p>
          ) : (
            <>
              <div className="sm:hidden space-y-3">
                {items.map((r) => (
                  <div key={r.id} className="rounded-md border p-3 space-y-2">
                    <div className="flex justify-between">
                      <span className="font-medium">{r.issued_date ?? "—"}</span>
                      <span className="tabular-nums font-semibold">{r.amount != null ? `${Number(r.amount).toFixed(2)} €` : "—"}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.period_from} – {r.period_to} · {r.consumption ?? ""}
                    </div>
                    <Button size="sm" className="w-full" variant={r.pdf_storage_path ? "outline" : "default"}
                      onClick={() => handleRow(r)} disabled={busyId === r.id || !!bulk}>
                      {busyId === r.id ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
                      {r.pdf_storage_path ? "Abrir" : "Descargar"}
                    </Button>
                  </div>
                ))}
              </div>
              <div className="hidden sm:block rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nº factura</TableHead>
                      <TableHead>Emisión</TableHead>
                      <TableHead>Periodo</TableHead>
                      <TableHead>Consumo</TableHead>
                      <TableHead className="text-right">Importe</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">PDF</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.invoice_num ?? "—"}</TableCell>
                        <TableCell>{r.issued_date ?? "—"}</TableCell>
                        <TableCell className="text-xs">{r.period_from} – {r.period_to}</TableCell>
                        <TableCell>{r.consumption ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.amount != null ? `${Number(r.amount).toFixed(2)} €` : "—"}</TableCell>
                        <TableCell>{r.status ? <Badge variant="outline">{r.status}</Badge> : "—"}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant={r.pdf_storage_path ? "outline" : "default"}
                            onClick={() => handleRow(r)} disabled={busyId === r.id || !!bulk}>
                            {busyId === r.id ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
                            {r.pdf_storage_path ? "Abrir" : "Descargar"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Facturas Curenergía</h2>
          <p className="text-muted-foreground mt-1">Contratos de luz y gas.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
            <DialogTrigger asChild>
              <Button>Conectar</Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Conectar con Curenergía</DialogTitle>
                <DialogDescription>
                  Deja el cuadro vacío para entrar con tu usuario y contraseña (CURENERGIA_USER / CURENERGIA_PASS).
                  Si prefieres usar una sesión abierta, pega aquí el cURL (F12 → Red → «lista» → Copiar como cURL).
                  Se traerán luz y gas a la vez.
                </DialogDescription>
              </DialogHeader>
              <Textarea value={curl} onChange={(e) => setCurl(e.target.value)} rows={8}
                placeholder="Opcional: pega aquí el cURL. Déjalo vacío para usar CURENERGIA_USER / CURENERGIA_PASS." className="font-mono text-xs" />
              <DialogFooter>
                <Button onClick={connectAndSync} disabled={syncing}>
                  {syncing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Conectar y traer facturas
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={open} onOpenChange={openConnect}>
            <DialogTrigger asChild>
              <Button variant="outline"><KeyRound className="h-4 w-4 mr-2" />Extensión de Edge</Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Extensión para traer facturas</DialogTitle>
                <DialogDescription>
                  Se instala una sola vez. Después basta un clic estando en curenergia.es.
                </DialogDescription>
              </DialogHeader>
              <ol className="list-decimal pl-5 space-y-2 text-sm">
                <li>
                  <Button size="sm" variant="outline" onClick={downloadExt}><Download className="h-4 w-4 mr-1.5" />Descargar extensión</Button>
                  {" "}y descomprime el archivo.
                </li>
                <li>En Edge abre <code>edge://extensions</code>, activa «Modo de desarrollador» y pulsa «Cargar desempaquetada»; elige la carpeta.</li>
                <li>
                  Copia tu código de conexión y pégalo en la extensión:
                  <div className="flex gap-2 mt-2">
                    <input readOnly value={bm} className="flex-1 rounded-md border bg-muted px-2 py-1 font-mono text-xs" />
                    <Button size="sm" disabled={!bm} onClick={() => { navigator.clipboard.writeText(bm); toast.success("Código copiado"); }}>Copiar</Button>
                  </div>
                </li>
                <li>Entra en curenergia.es, abre «Mis facturas», pulsa el icono de la extensión y «Sincronizar luz y gas».</li>
                <li>Al terminar, vuelve aquí y pulsa «Actualizar lista».</li>
              </ol>
              <p className="text-xs text-muted-foreground">El código es personal: no lo compartas.</p>
            </DialogContent>
          </Dialog>
          <Button onClick={sync} disabled={syncing || !!bulk}>
            {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Actualizar lista
          </Button>
        </div>
      </div>
      <Tabs defaultValue="luz">
        <TabsList className="mb-4">
          <TabsTrigger value="luz">Luz</TabsTrigger>
          <TabsTrigger value="gas">Gas</TabsTrigger>
        </TabsList>
        <TabsContent value="luz">{list("luz")}</TabsContent>
        <TabsContent value="gas">{list("gas")}</TabsContent>
      </Tabs>
    </div>
  );
}
