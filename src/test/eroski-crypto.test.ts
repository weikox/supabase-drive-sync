import { describe, it, expect } from "vitest";
import { eroskiEncrypt } from "@/utils/eroski-crypto";

// Golden values produced by the real Eroski login page (window.btoa(encrypt(x))).
// The live backend decrypted these successfully ("email no registrado"), so they
// pin the exact key/mode/padding and the double base64 encoding.
describe("eroskiEncrypt", () => {
  it("matches the login page output for an email", async () => {
    expect(await eroskiEncrypt("invalid.test.zzz@example.com")).toBe(
      "citEQ2haSDFRd0IwciswRHlIc0IrVVhkT2FUV1FPT012WEluT2tjL1JBMD0=",
    );
  });

  it("matches the login page output for a password", async () => {
    expect(await eroskiEncrypt("definitely-wrong-000")).toBe(
      "cE5KQU1vajllUng0OE9sSm5kNVdrZE9hbHU1MlBKMU1xVjh3VUZaTzVZST0=",
    );
  });

  it("is deterministic and decodes back to the plaintext", async () => {
    const a = await eroskiEncrypt("hola@eroski.es");
    const b = await eroskiEncrypt("hola@eroski.es");
    expect(a).toBe(b);
    const { createDecipheriv } = await import("node:crypto");
    const key = Buffer.from("c2RhOGVmNTRwc3JnaHR5MA==", "base64");
    const inner = Buffer.from(a, "base64").toString("utf8");
    const d = createDecipheriv("aes-128-ecb", key, null);
    expect(Buffer.concat([d.update(Buffer.from(inner, "base64")), d.final()]).toString("utf8")).toBe("hola@eroski.es");
  });
});
