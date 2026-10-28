// Fixed AES-128-ECB key the Eroski login page uses to encrypt email/password
// before POSTing them ("sda8ef54psrghty0"). Kept in its own module so it can be
// unit-tested without pulling in server-only code.
const AES_KEY_B64 = "c2RhOGVmNTRwc3JnaHR5MA==";

/** base64(AES-128-ECB(plain)), then base64 again — exactly what window.btoa(encrypt(x)) produces. */
export async function eroskiEncrypt(plain: string): Promise<string> {
  const { createCipheriv } = await import("node:crypto");
  const key = Buffer.from(AES_KEY_B64, "base64");
  const cipher = createCipheriv("aes-128-ecb", key, null);
  const inner = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]).toString("base64");
  return Buffer.from(inner, "utf8").toString("base64");
}
