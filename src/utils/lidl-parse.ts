export type LidlItem = { code?: string; description: string; numberUnits: number; unitPrice: number; netAmount: number };

const num = (v: any): number => {
  if (typeof v === "number") return v;
  let s = String(v ?? "").trim().replace(/[^\d.,-]/g, "");
  if (!s) return 0;
  const i = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  if (i >= 0) s = s.slice(0, i).replace(/[.,]/g, "") + "." + s.slice(i + 1);
  return Number(s) || 0;
};

const decode = (s: string) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
  .replace(/&([a-z])(acute|grave|tilde|uml|circ|cedil);/gi, "$1");

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Normalises a Lidl Plus v3 ticket (itemsLine JSON or htmlPrintedReceipt) into items. */
export function parseLidlItems(t: any): LidlItem[] {
  if (Array.isArray(t?.itemsLine)) {
    return t.itemsLine.map((it: any) => {
      const q = it.quantity != null && it.quantity !== "" ? num(it.quantity) : 1;
      const up = num(it.currentUnitPrice);
      const gross = it.originalAmount != null ? num(it.originalAmount) : q * up;
      const disc = (it.discounts ?? []).reduce((s: number, d: any) => s + Math.abs(num(d.amount)), 0);
      return { code: it.codeInput, description: decode(String(it.name ?? "")), numberUnits: q, unitPrice: up, netAmount: r2(gross - disc) };
    });
  }
  const html: string = t?.htmlPrintedReceipt ?? "";
  if (!html) return [];
  const out: LidlItem[] = [];
  const re = /<span[^>]*class="(article|discount)"[^>]*>([\s\S]*?)<\/span>/g;
  const attr = (tag: string, n: string) => tag.match(new RegExp(`${n}="([^"]*)"`))?.[1];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[0].slice(0, m[0].indexOf(">"));
    if (m[1] === "article") {
      const desc = attr(tag, "data-art-description");
      if (!desc) continue;
      const qa = attr(tag, "data-art-quantity");
      const q = qa ? num(qa) : 1, up = num(attr(tag, "data-unit-price"));
      out.push({ code: attr(tag, "data-art-id"), description: decode(desc), numberUnits: q, unitPrice: up, netAmount: r2(q * up) });
    } else if (out.length) {
      const txt = decode(m[2].replace(/<[^>]+>/g, "")).trim();
      if (/^-?\d+[.,]\d{2}$/.test(txt)) { const last = out[out.length - 1]; last.netAmount = r2(last.netAmount - Math.abs(num(txt))); }
    }
  }
  return out;
}

/** Extracts an authorization code (from callback URL / pasted text) or a refresh token. */
export function parseLidlInput(text: string): { code?: string; refreshToken?: string } {
  const code = text.match(/[?&]code=([\w\-.~%]+)/)?.[1];
  if (code) return { code: decodeURIComponent(code) };
  const t = text.trim();
  if (/^[\w\-.]{20,}$/.test(t)) return { refreshToken: t };
  throw new Error("No encuentro el código (code=...) ni un token válido en el texto pegado.");
}
