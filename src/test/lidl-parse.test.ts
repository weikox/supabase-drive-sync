import { describe, it, expect } from "vitest";
import { parseLidlItems, parseLidlInput } from "@/utils/lidl-parse";

describe("parseLidlItems", () => {
  it("parses itemsLine with discounts", () => {
    const items = parseLidlItems({ itemsLine: [
      { name: "Pan", quantity: "1", currentUnitPrice: "0,55", originalAmount: "0,55", discounts: [] },
      { name: "Manzana", quantity: "1,20", currentUnitPrice: "1,99", originalAmount: "2,39", discounts: [{ amount: "-0,30" }] },
    ] });
    expect(items[1]).toMatchObject({ numberUnits: 1.2, netAmount: 2.09 });
    expect(items[0].netAmount).toBe(0.55);
  });
  it("parses html receipt with discount", () => {
    const html = `<span class="article" data-art-id="1" data-art-description="Leche" data-unit-price="1,45">Leche 1,45</span>
<span class="article" data-art-id="2" data-art-description="Pl&aacute;tano" data-art-quantity="2" data-unit-price="0,50">x</span>
<span class="discount">Cupon</span><span class="discount">-0,20</span>`;
    const items = parseLidlItems({ htmlPrintedReceipt: html });
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ description: "Platano", numberUnits: 2, netAmount: 0.8 });
  });
});

describe("parseLidlInput", () => {
  it("extracts code from callback url", () => {
    expect(parseLidlInput("com.lidlplus.app://callback?code=ABC123&scope=openid").code).toBe("ABC123");
  });
});
