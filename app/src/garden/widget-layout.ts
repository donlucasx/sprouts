/**
 * R363 + R364 (10-05): the widget's layout, as numbers, so it can be tested without Android. Laid out for the SQUARE first (R364's
 * default, 2x2): the total big and alone at the top with a tiny "your garden" under it, the garden in the middle, ONE state line at the
 * bottom. A wide widget (4x2) keeps the total at the left and the garden at its right, the state line along the bottom. Every box is in
 * widget dp from the widget's top-left corner.
 */
export const W_PAD = 12;
/** A widget narrower than this (the 110 dp minimum, a 2x2 on a dense 5-column grid) keeps a thinner margin. */
const NARROW_W = 140, NARROW_PAD = 8;
export const padFor = (width: number) => (width < NARROW_W ? NARROW_PAD : W_PAD);
export const BIG_SIZE = 24;
/** The total shrinks to fit a narrow widget (a five-figure garden on a 2x2 dense grid), never under this. */
export const BIG_MIN = 16;
export const LABEL_SIZE = 11;
export const STATE_SIZE = 12;
/** The state line shrinks to fit the dense 2x2 ("A bud is ready. Water it." at 150 dp), never under this. */
export const STATE_MIN = 10;
/** Each line's box: Roboto's line height is about 1.17 em; a little more so a descender is never clipped. */
export const lineBox = (size: number) => Math.ceil(size * 1.25);
const GAP = 4;
/** Wide (text left, garden right) from this width to height ratio: 4x2 is about 2.1, 3x2 about 1.5 (stacked), the square 1. */
export const WIDE_RATIO = 1.8;
const COL_GAP = 10;

/**
 * Roboto's advance widths in em (Android's default sans-serif), rounded up, so an estimate never says a line fits when it does not.
 * Bold adds about 4 percent.
 */
const NARROW = new Set([..."ijlI.,:;'!|"]);
const WIDE = new Set([..."mwMW"]);
export function textWidth(text: string, size: number, bold = false): number {
  let em = 0;
  for (const c of text) {
    if (c === " ") em += 0.25;
    else if (NARROW.has(c)) em += 0.27;
    else if (WIDE.has(c)) em += 0.88;
    else if (/[0-9$+]/.test(c)) em += 0.57;
    else if (/[A-Z]/.test(c)) em += 0.66;
    else em += 0.55;
  }
  return em * size * (bold ? 1.04 : 1);
}

export type Box = { x: number; y: number; w: number; h: number };
export type WidgetLayout = { mode: "stacked" | "wide"; pad: number; bigSize: number; stateSize: number; stateLines: 1 | 2; header: Box; garden: Box; state: Box };

/** The widget's three boxes for a `width` by `height` widget showing `big` (the total), its `label` and the state `line`. */
export function widgetLayout(width: number, height: number, big: string, label: string, line = ""): WidgetLayout {
  const P = padFor(width), innerW = width - 2 * P, innerH = height - 2 * P;
  // wide only when the total's column (at its smallest size) leaves the garden most of the width
  const wide = width / Math.max(1, height) >= WIDE_RATIO && textWidth(big, BIG_MIN, true) <= innerW * 0.4;
  const fitSize = (room: number) => {
    let s = BIG_SIZE;
    while (s > BIG_MIN && textWidth(big, s, true) > room) s--;
    return s;
  };
  let stateSize = STATE_SIZE;
  while (stateSize > STATE_MIN && textWidth(line, stateSize, true) > innerW) stateSize--;
  // a line that does not fit at STATE_MIN (the bud's call on a 110 dp widget) wraps to two lines rather than cut "Water it."
  const stateLines: 1 | 2 = textWidth(line, stateSize, true) > innerW ? 2 : 1;
  const stateH = lineBox(STATE_SIZE) * stateLines;
  const state: Box = { x: P, y: height - P - stateH, w: innerW, h: stateH };
  if (wide) {
    // the total's column as wide as its own text (the larger of the two lines), at most 40 percent of the widget
    const bigSize = fitSize(innerW * 0.4);
    const colW = Math.ceil(Math.max(textWidth(big, bigSize, true), textWidth(label, LABEL_SIZE)) + 2);
    const header: Box = { x: P, y: P, w: colW, h: lineBox(bigSize) + lineBox(LABEL_SIZE) };
    const garden: Box = { x: P + colW + COL_GAP, y: P, w: innerW - colW - COL_GAP, h: Math.max(1, innerH - stateH - GAP) };
    return { mode: "wide", pad: P, bigSize, stateSize, stateLines, header, garden, state };
  }
  const bigSize = fitSize(innerW);
  const header: Box = { x: P, y: P, w: innerW, h: lineBox(bigSize) + lineBox(LABEL_SIZE) };
  const gy = header.y + header.h + GAP;
  const garden: Box = { x: P, y: gy, w: innerW, h: Math.max(1, state.y - GAP - gy) };
  return { mode: "stacked", pad: P, bigSize, stateSize, stateLines, header, garden, state };
}
