import { describe, it, expect } from "vitest";
import { pickSkrName } from "@/lib/skr";

// Lucas's Seeker owns hammathyme.skr but has no main domain set, so getMainDomain returns nothing (2026-09-27);
// the fallback lists the key's .skr names and picks one deterministically.
describe("pickSkrName", () => {
  it("prefers the main domain when one is set", () => {
    expect(pickSkrName({ domain: "lucas", tld: "skr" }, ["zed", "alpha"])).toBe("lucas.skr");
  });

  it("falls back to the key's only .skr name when no main domain is set", () => {
    expect(pickSkrName(null, ["hammathyme"])).toBe("hammathyme.skr");
  });

  it("picks the alphabetically first name when the key holds several and none is main", () => {
    expect(pickSkrName(null, ["zed", "alpha", "mid"])).toBe("alpha.skr");
  });

  it("accepts listed names that already carry the suffix, once", () => {
    expect(pickSkrName(null, ["hammathyme.skr"])).toBe("hammathyme.skr");
  });

  it("returns null when the key owns no .skr name at all", () => {
    expect(pickSkrName(null, [])).toBeNull();
  });
});
