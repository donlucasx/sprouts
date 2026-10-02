import { SvgXml } from 'react-native-svg'
import { useTheme } from '@/theme'

/**
 * The mark, k6b (RB22): the art of brand/exports/k6b/svg/k6b-green.svg, the crack and the midribs as true holes (masks), one colour.
 * Sprout green on light grounds, mint on dark (manual 2). Never under 16 px; the crack reads from 24.
 */
const ART = (fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="24.6 33.1 72.7 72.7"><defs>` +
  `<mask id="k6b-ms" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120"><rect width="120" height="120" fill="#fff"/>` +
  `<path d="M-5.85 -13.2 Q -2.6 -6.4 0 3.3 Q 2.6 -6.4 5.85 -13.2 z" fill="#000" transform="translate(58 88) rotate(14)"/></mask>` +
  `<mask id="k6b-mb" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120"><rect width="120" height="120" fill="#fff"/>` +
  `<g transform="translate(60.8 76.6) rotate(14)">` +
  `<path d="M0 -3.0 C -1.5 -12.0, -0.9 -20.4, -0.3 -25.8" fill="none" stroke="#000" stroke-width="2.1" stroke-linecap="round" transform="translate(-1 -10) rotate(-66)"/>` +
  `<path d="M0 -2.4 C 1.2 -9.6, 0.7 -16.3, 0.2 -20.6" fill="none" stroke="#000" stroke-width="1.7" stroke-linecap="round" transform="translate(1 -17) rotate(54)"/>` +
  `</g></mask></defs>` +
  `<g fill="${fill}" mask="url(#k6b-ms)"><path d="M-17.94 0 C-17.94 -8.4 -7.5 -12.6 0 -11.7 C9.0 -11.2 17.94 -5.9 17.94 0 C17.94 8.4 9.0 12.2 0 11.7 C-9.3 12.2 -17.94 8.4 -17.94 0 z" transform="translate(58 88) rotate(14)"/></g>` +
  `<g fill="${fill}" mask="url(#k6b-mb)"><g transform="translate(60.8 76.6) rotate(14)">` +
  `<path d="M-1.8 3.978 Q -2.6 -7.0 0.6 -18 L3.4 -18 Q 0.6 -7.0 1.8 3.978 z"/><circle cx="2.0" cy="-18" r="1.4"/>` +
  `<path d="M0 0 C -13.8 -6.6, -12.0 -23.4, 0 -30.0 C 7.8 -21.0, 7.2 -7.8, 0 0 z" transform="translate(-1 -10) rotate(-66)"/>` +
  `<path d="M0 0 C 11.0 -5.3, 9.6 -18.7, 0 -24.0 C -6.2 -16.8, -5.8 -6.2, 0 0 z" transform="translate(1 -17) rotate(54)"/>` +
  `</g></g></svg>`

export function Mark({ size = 32 }: { size?: number }) {
  const { colors } = useTheme()
  return <SvgXml xml={ART(colors.accent)} width={size} height={size} accessibilityLabel="Sprouts" />
}
