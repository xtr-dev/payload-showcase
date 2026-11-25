/**
 * Generates the seed's illustrations as SVG strings: glazed pots on warm backgrounds. Everything
 * is drawn locally so the seed needs no network access and nothing is hotlinked.
 */

export type VesselShape = 'vase' | 'bowl' | 'jar' | 'mug' | 'tumbler' | 'plate'

export interface VesselArtOptions {
  shape: VesselShape
  /** Background colour. */
  bg: string
  /** Large soft disc behind the pot. */
  sun: string
  /** Raw clay colour of the unglazed foot. */
  body: string
  /** Glaze colour poured over the top of the pot. */
  glaze: string
  /** Height (0-1, from the top of the pot) where the glaze ends. */
  dip?: number
  /** Draw only the pot and its shadow, without background, floor or grain (for compositions). */
  bare?: boolean
}

const SHAPES: Record<VesselShape, { d: string; top: number; bottom: number; extra?: string }> = {
  vase: {
    d: 'M330 500 C 296 468 288 420 318 362 C 344 312 362 282 356 232 C 352 202 338 186 344 168 L 456 168 C 462 186 448 202 444 232 C 438 282 456 312 482 362 C 512 420 504 468 470 500 Z',
    top: 168,
    bottom: 500,
  },
  bowl: {
    d: 'M210 318 L 590 318 C 584 412 516 474 452 486 L 448 500 L 352 500 L 348 486 C 284 474 216 412 210 318 Z',
    top: 318,
    bottom: 500,
    extra: '<ellipse cx="400" cy="318" rx="190" ry="22" fill="rgba(0,0,0,0.18)"/>',
  },
  jar: {
    d: 'M322 500 C 292 500 280 472 282 432 L 290 304 C 292 272 310 256 342 250 L 352 226 L 448 226 L 458 250 C 490 256 508 272 510 304 L 518 432 C 520 472 508 500 478 500 Z',
    top: 226,
    bottom: 500,
  },
  mug: {
    d: 'M300 260 L 480 260 L 472 478 C 471 492 462 500 448 500 L 332 500 C 318 500 309 492 308 478 Z',
    top: 260,
    bottom: 500,
    extra:
      '<path d="M478 304 C 548 300 556 420 474 432" fill="none" stroke="currentColor" stroke-width="22" stroke-linecap="round"/>',
  },
  tumbler: {
    d: 'M318 236 L 482 236 L 462 486 C 461 495 454 500 446 500 L 354 500 C 346 500 339 495 338 486 Z',
    top: 236,
    bottom: 500,
  },
  plate: {
    d: 'M170 452 C 170 410 280 384 400 384 C 520 384 630 410 630 452 C 630 486 520 504 400 504 C 280 504 170 486 170 452 Z',
    top: 384,
    bottom: 504,
    extra: '<ellipse cx="400" cy="446" rx="150" ry="34" fill="rgba(0,0,0,0.12)"/>',
  },
}

/** A wavy glaze line, so the glaze edge looks dipped and dripped rather than ruled. */
const glazeEdge = (y: number): string => {
  const parts = [`M0 0 H800 V${y}`]
  const steps = 10
  for (let i = steps; i > 0; i--) {
    const x1 = (i * 800) / steps
    const x0 = ((i - 1) * 800) / steps
    const drip = i % 3 === 0 ? 34 : i % 2 === 0 ? 14 : 4
    parts.push(`C ${x1 - 20} ${y + drip} ${x0 + 20} ${y + drip} ${x0} ${y}`)
  }
  parts.push('Z')
  return parts.join(' ')
}

export const vesselArt = ({
  shape,
  bg,
  sun,
  body,
  glaze,
  dip = 0.62,
  bare = false,
}: VesselArtOptions): string => {
  const s = SHAPES[shape]
  const glazeY = Math.round(s.top + (s.bottom - s.top) * dip)
  const id = `v-${shape}`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600" role="img">
  <defs>
    <clipPath id="${id}"><path d="${s.d}"/></clipPath>
    <linearGradient id="${id}-light" x1="0" x2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.22"/>
      <stop offset="0.45" stop-color="#fff" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.18"/>
    </linearGradient>
    <filter id="${id}-grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.09 0"/></filter>
  </defs>
  ${
    bare
      ? ''
      : `<rect width="800" height="600" fill="${bg}"/>
  <circle cx="560" cy="220" r="190" fill="${sun}"/>
  <rect y="500" width="800" height="100" fill="rgba(0,0,0,0.08)"/>`
  }
  <ellipse cx="400" cy="${s.bottom + 4}" rx="170" ry="16" fill="rgba(0,0,0,0.18)"/>
  <g style="color:${glaze}">${s.extra && shape === 'mug' ? s.extra : ''}</g>
  <path d="${s.d}" fill="${body}"/>
  <g clip-path="url(#${id})">
    <path d="${glazeEdge(glazeY)}" fill="${glaze}"/>
    <rect width="800" height="600" fill="url(#${id}-light)"/>
  </g>
  ${s.extra && shape !== 'mug' ? s.extra : ''}
  ${bare ? '' : `<rect width="800" height="600" filter="url(#${id}-grain)"/>`}
</svg>`
}

/** Renders a pot without background, re-keyed so several can share one SVG document. */
const barePot = (pot: VesselArtOptions, key: string): string =>
  vesselArt({ ...pot, bare: true })
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '')
    .replace(/id="v-/g, `id="${key}-`)
    .replace(/#v-/g, `#${key}-`)

/**
 * A tall studio scene with two shelves of pots, used for the arch-framed homepage hero.
 * Pots are drawn at 0.85 scale; in their own frame they are centred at x=400 with the base at y=500.
 */
export const shelvesArt = (palette: {
  bg: string
  shelf: string
  top: VesselArtOptions[]
  bottom: VesselArtOptions[]
}): string => {
  const row = (pots: VesselArtOptions[], shelfY: number, centres: number[], key: string) =>
    pots
      .map(
        (pot, i) =>
          `<g transform="translate(${centres[i] - 340} ${shelfY - 425}) scale(0.85)">${barePot(pot, `${key}${i}`)}</g>`,
      )
      .join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 1100" width="900" height="1100" role="img">
  <rect width="900" height="1100" fill="${palette.bg}"/>
  <circle cx="640" cy="230" r="210" fill="rgba(255,255,255,0.3)"/>
  ${row(palette.top, 500, [270, 640], 't')}
  <rect x="0" y="500" width="900" height="24" rx="4" fill="${palette.shelf}"/>
  <rect x="0" y="524" width="900" height="40" fill="rgba(0,0,0,0.06)"/>
  ${row(palette.bottom, 1010, [300, 650], 'b')}
  <rect x="0" y="1010" width="900" height="24" rx="4" fill="${palette.shelf}"/>
  <rect x="0" y="1034" width="900" height="66" fill="rgba(0,0,0,0.06)"/>
  <filter id="shelves-grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.09 0"/></filter>
  <rect width="900" height="1100" filter="url(#shelves-grain)"/>
</svg>`
}
