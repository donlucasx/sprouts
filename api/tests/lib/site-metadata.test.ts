import { describe, it, expect } from "vitest";
import { siteMetadata } from "@/app/metadata";

// Wallets show the site's title when it asks to connect: "Create Next App would like to connect!" (Backpack, 2026-09-29) is what
// a phishing kit looks like. The title and description are Sprouts' own.
describe("site metadata", () => {
  it("names Sprouts, not the template", () => {
    expect(siteMetadata.title).toBe("Sprouts");
    expect(String(siteMetadata.description)).toBe("A Yield Manager that rounds up your swaps and grows the change while you trade. SKR first, locked to your Seeker.");
    expect(JSON.stringify(siteMetadata)).not.toMatch(/Create Next App|create next app/);
  });
});
