import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import {
  syncNaturgyInvoices,
  downloadNaturgyInvoice,
  getNaturgyInvoiceUrl,
} from "@/utils/naturgy.functions";
import { syncGomezInvoices, downloadGomezInvoice } from "@/utils/gomez.functions";
import { syncInimaInvoices, downloadInimaInvoice } from "@/utils/inima.functions";
import { syncDigiInvoices, verifyDigiCode, resendDigiCode, downloadDigiInvoice } from "@/utils/digi.functions";
import { Input } from "@/components/ui/input";
import { CurenergiaPanel } from "@/components/CurenergiaPanel";
import { PrestoParkingPanel } from "@/components/PrestoParkingPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, RefreshCw, Download, FileText, DownloadCloud } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mis facturas · Naturgy, Gómez, Inima, Digi y Curenergía" },
      { name: "description", content: "Descarga tus facturas de Naturgy y recibos de Gómez Group Metering en un solo sitio." },
      { property: "og:title", content: "Mis facturas · Naturgy, Gómez, Inima, Digi y Curenergía" },
      { property: "og:description", content: "Descarga tus facturas de Naturgy y recibos de Gómez Group Metering." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

type InvoiceRow = {
  id: string;
  invoice_id: string;
  invoice_num: string | null;
  issued_date: string | null;
  period_from: string | null;
  period_to: string | null;
  amount: number | null;
  status: string | null;
  pdf_storage_path: string | null;
  raw: any;
};

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sesión no encontrada, vuelve a iniciar sesión");
  return { Authorization: `Bearer ${token}` };
}

async function openPdfUrl(url: string, filename = "factura.pdf") {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const w = window.open(blobUrl, "_blank");
    if (!w) {
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch (e: any) {
    toast.error(`No se pudo abrir el PDF: ${e?.message ?? e}`);
  }
}

function Dashboard() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="container mx-auto py-20 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <h1 className="text-3xl font-bold tracking-tight mb-6">Mis facturas</h1>
      <Tabs defaultValue="naturgy">
        <TabsList className="mb-6 flex-wrap h-auto">
          <TabsTrigger value="naturgy">Naturgy</TabsTrigger>
          <TabsTrigger value="gomez">Gómez Group Metering</TabsTrigger>
          <TabsTrigger value="inima">Inima Water</TabsTrigger>
          <TabsTrigger value="digi">Digi</TabsTrigger>
          <TabsTrigger value="curenergia">Curenergía</TabsTrigger>
        </TabsList>
        <TabsContent value="naturgy"><NaturgyPanel /></TabsContent>
        <TabsContent value="gomez"><GomezPanel /></TabsContent>
        <TabsContent value="inima"><InimaPanel /></TabsContent>
        <TabsContent value="digi"><DigiPanel /></TabsContent>
        <TabsContent value="curenergia"><CurenergiaPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

type GomezRow = {
  id: string;
  receipt_id: string;
  receipt_date: string | null;
  supply: string | null;
  amount: number | null;
  pdf_storage_path: string | null;
};

function GomezPanel() {
  const _sync = useServerFn(syncGomezInvoices);
  const _dl = useServerFn(downloadGomezInvoice);
  const _url = useServerFn(getNaturgyInvoiceUrl);
  const [rows, setRows] = useState<GomezRow[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("gomez_invoices")
      .select("*")
      .order("receipt_date", { ascending: false, nullsFirst: false });
    if (error) toast.error(error.message);
    else setRows(data as GomezRow[]);
  }
  useEffect(() => { load(); }, []);

  const dl = async (id: string) => _dl({ data: { id }, headers: await authHeaders() } as any);

  async function handleSync() {
    setSyncing(true);
    try {
      const r = await _sync({ headers: await authHeaders() } as any);
      toast.success(`Sincronizados ${r.count} recibos`);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Error al sincronizar");
    } finally { setSyncing(false); }
  }

  async function handleRow(r: GomezRow) {
    setBusyId(r.id);
    try {
      const name = `Gomez_${r.receipt_date ?? r.receipt_id}.pdf`;
      if (r.pdf_storage_path) {
        const u = await _url({ data: { path: r.pdf_storage_path }, headers: await authHeaders() } as any);
        await openPdfUrl(u.url, name);
      } else {
        const res = await dl(r.id);
        await openPdfUrl(res.url, name);
        await load();
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Error al descargar");
    } finally { setBusyId(null); }
  }

  async function handleAll() {
    const pending = rows.filter((r) => !r.pdf_storage_path);
    if (!pending.length) return toast.info("Todos los recibos ya están descargados");
    setBulk(true);
    let ok = 0, fail = 0;
    for (const r of pending) { try { await dl(r.id); ok++; } catch { fail++; } }
    setBulk(false);
    await load();
    toast[fail === 0 ? "success" : "warning"](`Descargados ${ok} · ${fail} fallidos`);
  }

  const downloaded = rows.filter((r) => r.pdf_storage_path).length;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Recibos Gómez Group Metering</h2>
          <p className="text-muted-foreground mt-1">Liquidaciones de agua y calefacción.</p>
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
        <StatCard label="Total recibos" value={String(rows.length)} />
        <StatCard label="PDFs descargados" value={`${downloaded} / ${rows.length}`} />
        <StatCard label="Última liquidación" value={rows[0]?.receipt_date ?? "—"} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Recibos</CardTitle>
          <CardDescription>Pulsa "Sincronizar lista" para traer los recibos del portal.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-center py-12 text-muted-foreground">No hay recibos todavía.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Suministro</TableHead>
                    <TableHead className="text-right">Importe</TableHead>
                    <TableHead className="text-right">PDF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.receipt_date ?? "—"}</TableCell>
                      <TableCell className="text-xs">{r.supply ?? "—"}</TableCell>
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

type InimaRow = {
  id: string;
  invoice_num: string | null;
  issued_date: string | null;
  due_date: string | null;
  description: string | null;
  amount: number | null;
  status: string | null;
  pdf_storage_path: string | null;
};

function InimaPanel() {
  const _sync = useServerFn(syncInimaInvoices);
  const _dl = useServerFn(downloadInimaInvoice);
  const _url = useServerFn(getNaturgyInvoiceUrl);
  const [rows, setRows] = useState<InimaRow[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("inima_invoices")
      .select("*")
      .order("issued_date", { ascending: false, nullsFirst: false });
    if (error) toast.error(error.message);
    else setRows(data as InimaRow[]);
  }
  useEffect(() => { load(); }, []);

  const dl = async (id: string) => _dl({ data: { id }, headers: await authHeaders() } as any);

  async function handleSync() {
    setSyncing(true);
    try {
      const r = await _sync({ headers: await authHeaders() } as any);
      toast.success(`Sincronizadas ${r.count} facturas`);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Error al sincronizar");
    } finally { setSyncing(false); }
  }

  async function handleRow(r: InimaRow) {
    setBusyId(r.id);
    try {
      const name = `Inima_${(r.invoice_num ?? r.id).replace(/\//g, "-")}.pdf`;
      if (r.pdf_storage_path) {
        const u = await _url({ data: { path: r.pdf_storage_path }, headers: await authHeaders() } as any);
        await openPdfUrl(u.url, name);
      } else {
        const res = await dl(r.id);
        await openPdfUrl(res.url, name);
        await load();
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Error al descargar");
    } finally { setBusyId(null); }
  }

  async function handleAll() {
    const pending = rows.filter((r) => !r.pdf_storage_path);
    if (!pending.length) return toast.info("Todas las facturas ya están descargadas");
    setBulk(true);
    let ok = 0, fail = 0;
    for (const r of pending) { try { await dl(r.id); ok++; } catch { fail++; } }
    setBulk(false);
    await load();
    toast[fail === 0 ? "success" : "warning"](`Descargadas ${ok} · ${fail} fallidas`);
  }

  const downloaded = rows.filter((r) => r.pdf_storage_path).length;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Facturas Inima Water</h2>
          <p className="text-muted-foreground mt-1">Facturas del suministro de agua.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSync} disabled={syncing || bulk}>
            {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sincronizar lista
          </Button>
          <Button onClick={handleAll} disabled={bulk || syncing || rows.length === 0}>
            {bulk ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <DownloadCloud className="h-4 w-4 mr-2" />}
            Descargar todas
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
        <StatCard label="Total facturas" value={String(rows.length)} />
        <StatCard label="PDFs descargados" value={`${downloaded} / ${rows.length}`} />
        <StatCard label="Última emisión" value={rows[0]?.issued_date ?? "—"} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Facturas</CardTitle>
          <CardDescription>Pulsa "Sincronizar lista" para traer las facturas del portal.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-center py-12 text-muted-foreground">No hay facturas todavía.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nº factura</TableHead>
                    <TableHead>Emisión</TableHead>
                    <TableHead>Vencimiento</TableHead>
                    <TableHead className="text-right">Importe</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">PDF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.invoice_num ?? "—"}</TableCell>
                      <TableCell>{r.issued_date ?? "—"}</TableCell>
                      <TableCell>{r.due_date ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.amount != null ? `${Number(r.amount).toFixed(2)} €` : "—"}
                      </TableCell>
                      <TableCell>{r.status ? <Badge variant="outline">{r.status}</Badge> : "—"}</TableCell>
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

type DigiRow = {
  id: string; invoice_num: string | null; issued_date: string | null; amount: number | null;
  status: string | null; pdf_url: string | null; pdf_storage_path: string | null;
};

function DigiPanel() {
  const _sync = useServerFn(syncDigiInvoices);
  const _verify = useServerFn(verifyDigiCode);
  const _resend = useServerFn(resendDigiCode);
  const _dl = useServerFn(downloadDigiInvoice);
  const _url = useServerFn(getNaturgyInvoiceUrl);
  const [rows, setRows] = useState<DigiRow[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [needCode, setNeedCode] = useState(false);
  const [code, setCode] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  async function load() {
    const { data, error } = await supabase.from("digi_invoices").select("*")
      .order("issued_date", { ascending: false, nullsFirst: false });
    if (error) toast.error(error.message); else setRows(data as DigiRow[]);
  }
  useEffect(() => { load(); }, []);

  async function handleSync() {
    setSyncing(true);
    try {
      const r = await _sync({ headers: await authHeaders() } as any);
      if (r.error) toast.error(r.error);
      else if (r.needs2FA) { setNeedCode(true); toast.info("Digi te ha enviado un código por SMS"); }
      else { toast.success(`Sincronizadas ${r.count} facturas`); await load(); }
    } catch (e: any) { toast.error(e?.message ?? "Error al sincronizar"); }
    finally { setSyncing(false); }
  }

  async function handleVerify() {
    setSyncing(true);
    try {
      const r = await _verify({ data: { code }, headers: await authHeaders() } as any);
      setNeedCode(false); setCode("");
      if (r.error) toast.error(`Verificado, pero: ${r.error}`);
      else toast.success(`Verificado. Sincronizadas ${r.count} facturas`);
      await load();
    } catch (e: any) { toast.error(e?.message ?? "Código incorrecto"); }
    finally { setSyncing(false); }
  }

  async function handleRow(r: DigiRow) {
    setBusyId(r.id);
    try {
      const name = `Digi_${(r.invoice_num ?? r.id).replace(/\//g, "-")}.pdf`;
      if (r.pdf_storage_path) {
        const u = await _url({ data: { path: r.pdf_storage_path }, headers: await authHeaders() } as any);
        await openPdfUrl(u.url, name);
      } else {
        const res = await _dl({ data: { id: r.id }, headers: await authHeaders() } as any);
        if (!res.ok || !res.url) throw new Error(res.error ?? "Error al descargar");
        await openPdfUrl(res.url, name);
        await load();
      }
    } catch (e: any) { toast.error(e?.message ?? "Error al descargar"); }
    finally { setBusyId(null); }
  }

  async function handleDownloadAll() {
    const pending = rows.filter((r) => !r.pdf_storage_path && r.pdf_url);
    if (pending.length === 0) { toast.info("Todas las facturas ya están descargadas"); return; }
    setBulk(true);
    setBulkProgress({ done: 0, total: pending.length });
    let ok = 0, fail = 0;
    for (const r of pending) {
      try {
        const res = await _dl({ data: { id: r.id }, headers: await authHeaders() } as any);
        if (res.ok) ok++; else fail++;
      } catch { fail++; }
      setBulkProgress({ done: ok + fail, total: pending.length });
    }
    setBulk(false);
    setBulkProgress(null);
    await load();
    toast[fail === 0 ? "success" : "warning"](`Descargadas ${ok} · ${fail} fallidas`);
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Facturas Digi</h2>
          <p className="text-muted-foreground mt-1">Facturas de tu línea Digi.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Button variant="outline" onClick={handleSync} disabled={syncing || bulk} className="w-full sm:w-auto">
            {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sincronizar lista
          </Button>
          <Button onClick={handleDownloadAll} disabled={bulk || syncing || rows.length === 0} className="w-full sm:w-auto">
            {bulk ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <DownloadCloud className="h-4 w-4 mr-2" />}
            {bulk && bulkProgress ? `Descargando ${bulkProgress.done}/${bulkProgress.total}` : "Descargar todas"}
          </Button>
        </div>
      </div>
      {needCode && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Código de verificación</CardTitle>
            <CardDescription>Introduce el código que Digi ha enviado por SMS a tu móvil. Solo se pide la primera vez.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código SMS" inputMode="numeric" className="sm:max-w-48" />
            <Button onClick={handleVerify} disabled={syncing || !code.trim()}>Verificar</Button>
            <Button variant="ghost" onClick={async () => { await _resend({ headers: await authHeaders() } as any); toast.info("Código reenviado"); }}>Reenviar código</Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>Facturas</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-center py-12 text-muted-foreground">No hay facturas todavía.</p>
          ) : (
            <>
              {/* Vista móvil: tarjetas */}
              <div className="space-y-3 sm:hidden">
                {rows.map((r) => (
                  <div key={r.id} className="rounded-md border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs truncate">{r.invoice_num ?? "—"}</span>
                      {r.status ? <Badge variant="outline" className="shrink-0">{r.status}</Badge> : null}
                    </div>
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>{r.issued_date ?? "—"}</span>
                      <span className="tabular-nums font-medium text-foreground">{r.amount != null ? `${Number(r.amount).toFixed(2)} €` : "—"}</span>
                    </div>
                    <Button size="sm" variant={r.pdf_storage_path ? "outline" : "default"} className="w-full"
                      onClick={() => handleRow(r)} disabled={busyId === r.id || bulk || (!r.pdf_url && !r.pdf_storage_path)}>
                      {busyId === r.id ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
                      {r.pdf_storage_path ? "Abrir" : "Descargar"}
                    </Button>
                  </div>
                ))}
              </div>
              {/* Vista escritorio: tabla */}
              <div className="rounded-md border overflow-x-auto hidden sm:block">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Nº factura</TableHead><TableHead>Emisión</TableHead>
                    <TableHead className="text-right">Importe</TableHead><TableHead>Estado</TableHead>
                    <TableHead className="text-right">PDF</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.invoice_num ?? "—"}</TableCell>
                        <TableCell>{r.issued_date ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.amount != null ? `${Number(r.amount).toFixed(2)} €` : "—"}</TableCell>
                        <TableCell>{r.status ? <Badge variant="outline">{r.status}</Badge> : "—"}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant={r.pdf_storage_path ? "outline" : "default"}
                            onClick={() => handleRow(r)} disabled={busyId === r.id || bulk || (!r.pdf_url && !r.pdf_storage_path)}>
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
    </div>
  );
}

function NaturgyPanel() {
  const { user } = useAuth();
  const _syncFn = useServerFn(syncNaturgyInvoices);
  const _downloadFn = useServerFn(downloadNaturgyInvoice);
  const _getUrlFn = useServerFn(getNaturgyInvoiceUrl);

  const syncFn = async () =>
    _syncFn({ headers: await authHeaders() } as any);
  const downloadFn = async (args: { data: { id: string } }) =>
    _downloadFn({ ...args, headers: await authHeaders() } as any);
  const getUrlFn = async (args: { data: { path: string } }) =>
    _getUrlFn({ ...args, headers: await authHeaders() } as any);

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function loadInvoices() {
    const { data, error } = await supabase
      .from("naturgy_invoices")
      .select("*")
      .order("issued_date", { ascending: false, nullsFirst: false });
    if (error) toast.error(error.message);
    else setInvoices(data as InvoiceRow[]);
  }

  useEffect(() => {
    if (user) loadInvoices();
  }, [user]);

  async function handleSync() {
    setSyncing(true);
    try {
      const r = await syncFn();
      toast.success(`Sincronizadas ${r.count} facturas`);
      await loadInvoices();
    } catch (e: any) {
      toast.error(e?.message ?? "Error al sincronizar");
    } finally {
      setSyncing(false);
    }
  }


  async function handleDownload(row: InvoiceRow) {
    setBusyId(row.id);
    try {
      const r = await downloadFn({ data: { id: row.id } });
      await openPdfUrl(r.url, `${row.invoice_num ?? row.invoice_id}.pdf`);
      await loadInvoices();
      toast.success(`PDF descargado (${Math.round(r.size / 1024)} KB)`);
    } catch (e: any) {
      toast.error(e?.message ?? "Error al descargar");
    } finally {
      setBusyId(null);
    }
  }

  async function handleOpen(row: InvoiceRow) {
    if (!row.pdf_storage_path) return handleDownload(row);
    setBusyId(row.id);
    try {
      const r = await getUrlFn({ data: { path: row.pdf_storage_path } });
      await openPdfUrl(r.url, `${row.invoice_num ?? row.invoice_id}.pdf`);
    } catch (e: any) {
      toast.error(e?.message ?? "Error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDownloadAll() {
    const pending = invoices.filter((i) => !i.pdf_storage_path);
    if (pending.length === 0) {
      toast.info("Todas las facturas ya están descargadas");
      return;
    }
    setBulk(true);
    let ok = 0, fail = 0;
    for (const inv of pending) {
      try {
        await downloadFn({ data: { id: inv.id } });
        ok++;
      } catch {
        fail++;
      }
    }
    setBulk(false);
    await loadInvoices();
    toast[fail === 0 ? "success" : "warning"](`Descargadas ${ok} · ${fail} fallidas`);
  }


  const downloaded = invoices.filter((i) => i.pdf_storage_path).length;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Facturas Naturgy</h2>
          <p className="text-muted-foreground mt-1">
            Conexión directa a la API de Naturgy.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSync} disabled={syncing || bulk}>
            {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sincronizar lista
          </Button>
          <Button onClick={handleDownloadAll} disabled={bulk || syncing || invoices.length === 0}>
            {bulk ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <DownloadCloud className="h-4 w-4 mr-2" />}
            Descargar todas
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
        <StatCard label="Total facturas" value={String(invoices.length)} />
        <StatCard label="PDFs descargados" value={`${downloaded} / ${invoices.length}`} />
        <StatCard
          label="Última emisión"
          value={invoices[0]?.issued_date ?? "—"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Facturas</CardTitle>
          <CardDescription>
            Pulsa "Sincronizar lista" para traer la lista desde Naturgy y luego "Descargar" para guardar el PDF.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <div className="text-center py-12">
              <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <FileText className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground">
                No hay facturas. Pulsa "Sincronizar lista" para empezar.
              </p>
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nº factura</TableHead>
                    <TableHead>Emisión</TableHead>
                    <TableHead>Periodo</TableHead>
                    <TableHead className="text-right">Importe</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">PDF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-xs">{inv.invoice_num ?? inv.invoice_id}</TableCell>
                      <TableCell>{inv.issued_date ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {inv.period_from && inv.period_to
                          ? `${inv.period_from} → ${inv.period_to}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {inv.amount != null ? `${Number(inv.amount).toFixed(2)} €` : "—"}
                      </TableCell>
                      <TableCell>
                        {inv.status ? <Badge variant="outline">{inv.status}</Badge> : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {inv.pdf_storage_path ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpen(inv)}
                            disabled={busyId === inv.id}
                          >
                            {busyId === inv.id ? (
                              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                            ) : (
                              <Download className="h-4 w-4 mr-1.5" />
                            )}
                            Abrir
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => handleDownload(inv)}
                            disabled={busyId === inv.id || bulk}
                          >
                            {busyId === inv.id ? (
                              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                            ) : (
                              <Download className="h-4 w-4 mr-1.5" />
                            )}
                            Descargar
                          </Button>
                        )}
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-1 text-xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
