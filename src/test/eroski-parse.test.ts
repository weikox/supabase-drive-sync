import { describe, it, expect } from "vitest";
import { parseEroskiItems, parseEroskiToken } from "@/utils/eroski-parse";

const text = `UDS. DENOMINACIÓN PRODUCTO €/UN €/TOT ING. CLUB AHORRO SOCIO VALES PAPEL VALES WEB/APP
6 BARRA GRANDE 1.09 6.54
6 CUBITOS HIELO 2 KG 1.15 6.90
3 BOLSA CAJA 0.15 0.45
Total compra 13.89 0.00 0.00 0.00 0.00`;

describe("eroski", () => {
  it("parses product lines from ticket text", () => {
    const items = parseEroskiItems(text);
    expect(items).toHaveLength(3);
    expect(items[1]).toEqual({ numberUnits: 6, description: "CUBITOS HIELO 2 KG", unitPrice: 1.15, netAmount: 6.9 });
  });
  it("extracts token from cmd-style curl", () => {
    expect(parseEroskiToken(`-H ^"x-auth-token: eyAb.cD-e.f_g^" ^`)).toBe("eyAb.cD-e.f_g");
  });
});
