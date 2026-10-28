/**
 * Minimal cookie jar for server-side login flows (Node/Workers fetch does not
 * persist cookies across calls). Only the name/value pairs are kept.
 */
export class CookieJar {
  private jar = new Map<string, string>();

  add(setCookies: string[] | undefined) {
    for (const c of setCookies ?? []) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name) this.jar.set(name, value);
    }
  }

  header(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  get(name: string): string | undefined {
    return this.jar.get(name);
  }
}
