import { describe, expect, it } from "vitest";
import { isValidName, scopedName, toKebab } from "../../src/core/names.js";

describe("names", () => {
  it("accepts valid names", () => {
    for (const n of ["a", "plan-code", "plan_code", "a1-b2_c3"]) expect(isValidName(n)).toBe(true);
  });
  it("rejects invalid names", () => {
    for (const n of ["", "Plan", "-a", "a-", "a--b", "a_-b", "a b", "a.b"]) expect(isValidName(n)).toBe(false);
  });
  it("kebab-cases", () => {
    expect(toKebab("plan_code_x")).toBe("plan-code-x");
    expect(scopedName("my_pack", "plan_code")).toBe("my-pack-plan-code");
  });
});
