import { describe, expect, it } from "vitest";
import { getCurenergiaScrapflyKey } from "../utils/curenergia-config.server";

function reader(value: string, error: unknown = null) {
  return { from: () => ({ select: async () => ({ data: [{ key: "scrapfly_api_key", value }], error }) }) };
}

describe("Curenergía Scrapfly configuration", () => {
  it("reads SCRAPFLY_API_KEY from the authenticated secret backup", async () => {
    expect(await getCurenergiaScrapflyKey(reader("fixture-not-a-secret"))).toBe("fixture-not-a-secret");
  });
  it("keeps different users' configuration isolated", async () => {
    expect(await getCurenergiaScrapflyKey(reader("fixture-a"))).toBe("fixture-a");
    expect(await getCurenergiaScrapflyKey(reader("fixture-b"))).toBe("fixture-b");
  });
  it("reports unreadable backup instead of silently using direct requests", async () => {
    await expect(getCurenergiaScrapflyKey(reader("", { code: "42501" }))).rejects.toThrow("permiso de lectura");
  });
});