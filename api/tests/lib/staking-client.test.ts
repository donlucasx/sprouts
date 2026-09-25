import { describe, it, expect } from "vitest";
import { getStakeInstructionDataEncoder } from "@/generated/staking";
import { SKR_STAKING_PROGRAM } from "@/lib/constants";

describe("generated staking client", () => {
  it("encodes stake with an 8-byte discriminator and a u64 amount", () => {
    const bytes = getStakeInstructionDataEncoder().encode({ amount: 1_000_000n });
    expect(bytes.length).toBe(16);
  });

  it("knows the program address", () => {
    expect(String(SKR_STAKING_PROGRAM)).toBe("SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ");
  });
});
