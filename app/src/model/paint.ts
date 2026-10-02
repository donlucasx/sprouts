// The painted vocabulary's vector parts, shared by the app (as <Path>) and the widget string (as <path>): gen01's quadratic stem with
// gen03's three layers, the leaf outline (the fallback when a sprite cannot be drawn), and the transform that places a sprite by its anchor.
const f = (n: number) => Number(n.toFixed(2));
function ribbon(x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, bend: number): string {
  const mx = (x0 + x1) / 2 + bend, my = (y0 + y1) / 2, dx = x1 - x0, dy = y1 - y0, n = Math.hypot(dx, dy) || 1, nx = -dy / n, ny = dx / n;
  return `M${f(x0 + nx * w0 / 2)} ${f(y0 + ny * w0 / 2)} Q ${f(mx + nx * (w0 + w1) / 4)} ${f(my + ny * (w0 + w1) / 4)} ${f(x1 + nx * w1 / 2)} ${f(y1 + ny * w1 / 2)} L${f(x1 - nx * w1 / 2)} ${f(y1 - ny * w1 / 2)} Q ${f(mx - nx * (w0 + w1) / 4)} ${f(my - ny * (w0 + w1) / 4)} ${f(x0 - nx * w0 / 2)} ${f(y0 - ny * w0 / 2)} z`;
}
/** gen03_garden.py:58-64 stem3: the wash, a lighter streak off centre, a darker edge on one side. */
export function stemPaths(x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, bend: number, color: string) {
  const dx = x1 - x0, dy = y1 - y0, n = Math.hypot(dx, dy) || 1, nx = -dy / n;
  return [
    { d: ribbon(x0, y0, x1, y1, w0, w1, bend), fill: color, opacity: 0.72 },
    { d: ribbon(x0 + nx * w0 * 0.18, y0, x1 + nx * w1 * 0.18, y1, w0 * 0.3, w1 * 0.3, bend), fill: "#FFFFFF", opacity: 0.22 },
    { d: ribbon(x0 - nx * w0 * 0.3, y0, x1 - nx * w1 * 0.3, y1, w0 * 0.22, w1 * 0.22, bend), fill: "#1E3A2A", opacity: 0.18 },
  ];
}
/** gen03_garden.py half3, shape blade: one half of a leaf of length L and half width W, the paper gap left as the midrib. */
export function leafPath(L: number, W: number, side: -1 | 1): string {
  const gap = Math.max(0.9, 0.045 * L), pts: [number, number][] = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24, w = W * Math.sin(Math.PI * t) ** 0.85 * (1 - 0.15 * t); pts.push([side * Math.max(w, gap / 2 + 0.1), -L * t]); }
  const back: [number, number][] = [0.92, 0.6, 0.3, 0.06].map((t) => [side * gap / 2, -L * t]);
  return "M" + [...pts, ...back].map(([x, y]) => `${f(x)} ${f(y)}`).join(" L") + " z";
}
/** Places a sprite whose anchor is (ax, ay) inside its w by h box at (x, y), rotated, scaled (a second x scale for the succulent). */
export const spriteTransform = (m: { w: number; h: number; ax: number; ay: number }, x: number, y: number, rot: number, scale: number, xScale = scale) =>
  `translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${f(xScale)} ${f(scale)}) translate(${-m.ax} ${-m.ay})`;
/** gen01_garden.py:91-99 soil(): two ridges, the front one lined, the pooled edge; drawn from the soil line `soilY` over a band `bandH` tall (60 in the app). */
export function soilPaths(width: number, soilY: number, bandH: number) {
  const k = bandH / 60, w = width, h = soilY + bandH;
  const back = `M0 ${f(soilY + 6 * k)} Q ${f(w / 2)} ${f(soilY - 10 * k)} ${f(w)} ${f(soilY + 6 * k)} L${f(w)} ${f(h)} L0 ${f(h)} z`;
  const front = `M0 ${f(soilY + 34 * k)} Q ${f(w / 2)} ${f(soilY + 16 * k)} ${f(w)} ${f(soilY + 34 * k)} L${f(w)} ${f(h)} L0 ${f(h)} z`;
  const edge = `M0 ${f(h - 6 * k)} Q ${f(w / 2)} ${f(h - 14 * k)} ${f(w)} ${f(h - 6 * k)} L${f(w)} ${f(h)} L0 ${f(h)} z`;
  return [
    { d: back, fill: "#C9A77E", opacity: 0.85 },
    { d: front, fill: "#A9825C", opacity: 0.9 },
    { d: front, fill: "none", opacity: 0.35, stroke: "#7A6248", strokeWidth: 1.2 },
    { d: edge, fill: "#6B5340", opacity: 0.45 },
  ];
}
