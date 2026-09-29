import { describe, it, expect } from "vitest";
import { soilSurface, SOIL_PATH } from "@/model/soil";

// The soil is a mound (quadratic, edges 40 below the soil line, crown 20 below). Everything that stands on it must use its
// surface, not the flat soil line: the 09-29 Saga check found the seeds and sprouts floating 17 to 22 px above the mound.
describe("soilSurface", () => {
  it("is 40 at the edges and 20 at the crown", () => {
    expect(soilSurface(0)).toBe(40);
    expect(soilSurface(1)).toBe(40);
    expect(soilSurface(0.5)).toBe(20);
  });

  it("follows the drawn curve where the first seeds sit", () => {
    expect(soilSurface(0.15)).toBeCloseTo(29.8, 5);
    expect(soilSurface(0.24)).toBeCloseTo(25.408, 5);
  });

  it("is the same curve the soil path draws", () => {
    expect(SOIL_PATH(300)).toBe("M0 40 Q 150 0 300 40 L 300 60 L 0 60 Z");
  });
});
