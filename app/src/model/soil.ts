// The soil is a mound: a quadratic from (0, 40) over a control point at (width/2, 0) to (width, 40), in a 60-high box whose top is the
// soil line. The control point is centred, so x runs linearly with the curve's parameter and the surface at x = t * width is exact.

/** The soil path for a garden `width` wide, drawn from the soil line. */
export const SOIL_PATH = (width: number) => `M0 40 Q ${width / 2} 0 ${width} 40 L ${width} 60 L 0 60 Z`;

/** How far below the soil line the mound's surface is at `t` (0 to 1 across the garden): 40 at the edges, 20 at the crown. */
export const soilSurface = (t: number) => 40 * ((1 - t) ** 2 + t ** 2);
