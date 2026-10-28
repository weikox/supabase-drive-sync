import { getAppSecret } from "./app-secrets";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";

type SecretReader = {
  from: (table: "app_secrets") => {
    select: (columns: string) => PromiseLike<{
      data: { key: string; value: string }[] | null;
      error: unknown;
    }>;
  };
};

export type LoginResponse = {
  status: number;
  body: string;
  json: any;
  headers: Record<string, string>;
  setCookies: string[];
};

/** Scrapfly API key for anti-bot bypass, read from app_secrets (request-scoped). */
export function getScrapflyKey(reader: SecretReader, runtimeKey?: string) {
  return getAppSecret(reader, "SCRAPFLY_API_KEY", runtimeKey);
}

async function directPost(url: string, body: string, headers: Record<string, string>): Promise<LoginResponse> {
  const res = await fetch(url, { method: "POST", headers, body });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  const h: Record<string, string> = {};
  res.headers.forEach((v, k) => { h[k.toLowerCase()] = v; });
  return {
    status: res.status,
    body: text,
    json,
    headers: h,
    setCookies: (res.headers as any).getSetCookie?.() ?? (h["set-cookie"] ? [h["set-cookie"]] : []),
  };
}

async function scrapflyPost(
  key: string,
  url: string,
  body: string,
  headers: Record<string, string>,
  country: string,
): Promise<LoginResponse> {
  const p = new URLSearchParams({ key, url, method: "POST", body, country, asp: "true", format: "json" });
  for (const [k, v] of Object.entries(headers)) p.append(`headers[${k}]`, v);
  const res = await fetch(`https://api.scrapfly.io/scrape?${p}`);
  const j: any = await res.json().catch(() => null);
  if (!res.ok || !j?.result) {
    console.error("Scrapfly login error", res.status, j?.message);
    throw new Error(`Scrapfly respondió HTTP ${res.status}${j?.message ? `: ${j.message}` : ""}`);
  }
  const content = String(j.result.content ?? "");
  let json: any = null;
  try { json = JSON.parse(content); } catch { /* not JSON */ }
  const headersOut: Record<string, string> = {};
  for (const [k, v] of Object.entries(j.result.response_headers ?? {})) {
    headersOut[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return {
    status: j.result.status_code ?? 200,
    body: content,
    json,
    headers: headersOut,
    setCookies: headersOut["set-cookie"] ? [headersOut["set-cookie"]] : [],
  };
}

/**
 * POSTs a form to a provider login endpoint. When a Scrapfly key is available the
 * request goes through Scrapfly (its IPs + anti-bot bypass), otherwise it is made
 * directly from the server.
 */
export async function postForm(opts: {
  url: string;
  fields: Record<string, string>;
  headers?: Record<string, string>;
  scrapflyKey?: string;
  country?: string;
}): Promise<LoginResponse> {
  const body = new URLSearchParams(opts.fields).toString();
  const headers = {
    "content-type": "application/x-www-form-urlencoded",
    "user-agent": UA,
    ...(opts.headers ?? {}),
  };
  return opts.scrapflyKey
    ? scrapflyPost(opts.scrapflyKey, opts.url, body, headers, opts.country ?? "es")
    : directPost(opts.url, body, headers);
}

/**
 * Generic provider request (any method, raw body). Routes through Scrapfly when a
 * key is given — required for providers that block server IPs (e.g. Curenergía).
 */
export async function providerRequest(opts: {
  url: string;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  scrapflyKey?: string;
  country?: string;
}): Promise<LoginResponse> {
  const method = (opts.method ?? "GET").toUpperCase();
  const headers = { "user-agent": UA, ...(opts.headers ?? {}) };
  if (opts.scrapflyKey) {
    const p = new URLSearchParams({
      key: opts.scrapflyKey, url: opts.url, method, country: opts.country ?? "es", asp: "true", format: "json",
    });
    if (opts.body) p.set("body", opts.body);
    for (const [k, v] of Object.entries(headers)) p.append(`headers[${k}]`, v);
    const res = await fetch(`https://api.scrapfly.io/scrape?${p}`);
    const j: any = await res.json().catch(() => null);
    if (!res.ok || !j?.result) {
      console.error("Scrapfly error", res.status, j?.message);
      throw new Error(`Scrapfly respondió HTTP ${res.status}${j?.message ? `: ${j.message}` : ""}`);
    }
    const content = String(j.result.content ?? "");
    let json: any = null;
    try { json = JSON.parse(content); } catch { /* not JSON */ }
    const headersOut: Record<string, string> = {};
    for (const [k, v] of Object.entries(j.result.response_headers ?? {})) {
      headersOut[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
    }
    const raw = headersOut["set-cookie"];
    return {
      status: j.result.status_code ?? 200,
      body: content,
      json,
      headers: headersOut,
      setCookies: raw ? String(raw).split(/,(?=[^;=]+=)/).map((s) => s.trim()) : [],
    };
  }
  const res = await fetch(opts.url, { method, headers, body: method === "GET" ? undefined : opts.body });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  const h: Record<string, string> = {};
  res.headers.forEach((v, k) => { h[k.toLowerCase()] = v; });
  return {
    status: res.status,
    body: text,
    json,
    headers: h,
    setCookies: (res.headers as any).getSetCookie?.() ?? (h["set-cookie"] ? [h["set-cookie"]] : []),
  };
}
