import { describe, it, expect } from "vitest";
import { CookieJar } from "@/utils/cookie-jar.server";

describe("CookieJar", () => {
  it("keeps only name/value pairs from Set-Cookie headers", () => {
    const jar = new CookieJar();
    jar.add([
      "JSESSIONID=ABC123; Path=/; HttpOnly; Secure",
      "LocaleCookie=es; Path=/",
    ]);
    expect(jar.header()).toBe("JSESSIONID=ABC123; LocaleCookie=es");
    expect(jar.get("JSESSIONID")).toBe("ABC123");
  });

  it("overwrites a cookie when the server re-sets it", () => {
    const jar = new CookieJar();
    jar.add(["JSESSIONID=OLD; Path=/"]);
    jar.add(["JSESSIONID=NEW; Path=/"]);
    expect(jar.get("JSESSIONID")).toBe("NEW");
    expect(jar.header()).toBe("JSESSIONID=NEW");
  });

  it("ignores malformed entries and empty input", () => {
    const jar = new CookieJar();
    jar.add(undefined);
    jar.add(["garbage", "=novalue"]);
    expect(jar.header()).toBe("");
  });
});
