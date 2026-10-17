export type EroskiItem = { description: string; numberUnits: number; unitPrice: number; netAmount: number };

/** Extracts the x-auth-token from a pasted "Copy as cURL" text (bash or cmd format) or a raw token. */
export function parseEroskiToken(text: string): string {
  const t = text.match(/x-auth-token:\s*([\w\-.]+)/i)?.[1] ?? text.match(/\b(ey[\w-]+\.[\w-]+\.[\w-]+)\b/)?.[1];
  if (!t) throw new Error("No encuentro el token en el texto pegado. Copia de nuevo la petición como cURL.");
  return t;
}

/** Parses product lines ("UDS NOMBRE €/UN €/TOT") from the text of an Eroski ticket PDF. */
export function parseEroskiItems(text: string): EroskiItem[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /DENOMINACI/i.test(l));
  const out: EroskiItem[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^\s*Total compra/i.test(l)) break;
    const m = l.trim().match(/^(\d+(?:[.,]\d+)?)\s+(.+?)\s+(-?\d+[.,]\d{2,3})\s+(-?\d+[.,]\d{2})(?:\s|$)/);
    if (!m) continue;
    const num = (s: string) => Number(s.replace(",", "."));
    out.push({ numberUnits: num(m[1]), description: m[2].trim(), unitPrice: num(m[3]), netAmount: num(m[4]) });
  }
  return out;
}
