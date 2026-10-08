import { describe, it, expect } from "vitest";
import { SLOGAN, SLOGAN_LINES } from "@/lib/slogan";

describe("Welcome's slogan lines", () => {
  it("are SLOGAN, word for word", () => {
    expect(SLOGAN_LINES.join(" ")).toBe(SLOGAN);
  });
});
