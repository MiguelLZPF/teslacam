/**
 * Where the cameras go inside the player, in pixels of whatever space there is.
 *
 * The first layout assumed 4:3 frames in a box of fixed shape, so a main camera
 * plus three tiles sat in a 4:3 area with black on the sides. Real Tesla clips
 * are 724:469 (about 1.54:1) and the player area is whatever the window leaves,
 * so the layout is computed from the actual container and the measured frame
 * aspect, and the cameras tile the whole container with no outer margin.
 *
 * Pure functions, no DOM: the player feeds them its measured size.
 */
import type { LayoutName, Rect } from './compose'
import type { Camera } from './library'

/** Tesla's own clips (all cameras, HW3 and HW4): 1448x938 and 2896x1876. */
export const FALLBACK_ASPECT = 724 / 469

export const SHARE_MIN = 0.5
export const SHARE_MAX = 0.9
export const SHARE_STEP = 0.05

export type FitMode = 'fit' | 'fill'
/** Where the tiles sit relative to the main view: beside it in a column, or beneath it in a row. */
export type Placement = 'side' | 'below'

export const clampShare = (s: number): number =>
  Number.isFinite(s) ? Math.min(SHARE_MAX, Math.max(SHARE_MIN, s)) : SHARE_MIN

/** One keyboard or button step, kept on a clean two-decimal value. */
export const stepShare = (current: number, dir: 1 | -1): number =>
  clampShare(Math.round((clampShare(current) + dir * SHARE_STEP) * 100) / 100)

/** A column of tiles on a wide area, a row on a tall one. */
export const placementFor = (w: number, h: number): Placement => (w >= h ? 'side' : 'below')

/** The shape of the picture a frame of `aspect` leaves inside a box. */
export function pictureRect(box: { w: number; h: number }, aspect: number, mode: FitMode) {
  if (mode === 'fill' || !(aspect > 0)) return { x: 0, y: 0, w: box.w, h: box.h }
  const w = Math.min(box.w, box.h * aspect)
  const h = w / aspect
  return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h }
}

/** Visible picture area of a frame of `aspect` inside a box (whole frame shown). */
const shown = (boxW: number, boxH: number, aspect: number): number => {
  const p = pictureRect({ w: boxW, h: boxH }, aspect, 'fit')
  return p.w * p.h
}

/**
 * The automatic main share: the tiles take exactly the room their pictures need,
 * so they have no bars and sit flush against the divider and the window edge, and
 * the main view takes everything else. (Anything wider than that for the tile
 * column is just black beside the tiles.) Used until the operator drags the divider.
 */
export function autoShare(
  cams: number, w: number, h: number, aspect: number = FALLBACK_ASPECT,
): number {
  const tiles = cams - 1
  if (tiles < 1 || w <= 0 || h <= 0 || !(aspect > 0)) return SHARE_MAX
  const side = placementFor(w, h) === 'side'
  const need = side ? (h / tiles) * aspect / w : w / tiles / aspect / h
  return clampShare(1 - need)
}

/** The part of a frame cut off when it covers a box (0 when the shapes match). */
export function cropFraction(boxW: number, boxH: number, aspect: number): number {
  if (!(boxW > 0 && boxH > 0 && aspect > 0)) return 0
  const b = boxW / boxH
  return b > aspect ? 1 - aspect / b : 1 - b / aspect
}

/** In fit mode the main view may cover its box when that crops no more than this,
 *  so a small shape mismatch does not leave bars beside it. */
export const MAX_MAIN_CROP = 0.25

/** Columns and rows that show the most picture for n equal cells. */
export function bestGrid(n: number, w: number, h: number, aspect: number = FALLBACK_ASPECT) {
  let best = { cols: 1, rows: n }
  let bestArea = -1
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const p = pictureRect({ w: w / cols, h: h / rows }, aspect, 'fit')
    const area = p.w * p.h
    if (area > bestArea + 1e-9) { bestArea = area; best = { cols, rows } }
  }
  return best
}

export interface Arrangement {
  /** Normalised to the container (0..1), so the HUD and the videos share it. */
  rects: Map<Camera, Rect>
  /** The camera whose picture carries the overlay (clock, speed). */
  main: Camera | undefined
  /** Set only for the main-plus-tiles layout. */
  split?: { placement: Placement; share: number; auto: boolean }
  /** Part of the main frame cut off if it covers its box (see MAX_MAIN_CROP). */
  mainCrop?: number
}

/**
 * Arrange the selected cameras across the whole container.
 *  - 'tesla': the main camera large, the others as tiles in a column (wide area)
 *    or a row (tall area); `share` is the main camera's part of the width or
 *    height, or null for the automatic value.
 *  - 'single': the main camera alone.
 *  - 'wide': one row. 'grid': whichever grid shows the most picture.
 */
export function arrange(
  layout: LayoutName, cams: Camera[], mainCam: Camera | undefined,
  w: number, h: number, share: number | null, aspect: number = FALLBACK_ASPECT,
): Arrangement {
  const rects = new Map<Camera, Rect>()
  if (!cams.length || w <= 0 || h <= 0) return { rects, main: undefined }

  const main = mainCam && cams.includes(mainCam) ? mainCam : cams[0]
  const ordered = [main, ...cams.filter((c) => c !== main)]

  if (layout === 'single' || ordered.length === 1) {
    rects.set(main, { x: 0, y: 0, w: 1, h: 1 })
    return { rects, main }
  }

  if (layout === 'wide') {
    const cw = 1 / ordered.length
    ordered.forEach((c, i) => rects.set(c, { x: i * cw, y: 0, w: cw, h: 1 }))
    return { rects, main }
  }

  if (layout === 'grid') {
    const { cols, rows } = bestGrid(ordered.length, w, h, aspect)
    ordered.forEach((c, i) => rects.set(c, {
      x: (i % cols) / cols, y: Math.floor(i / cols) / rows, w: 1 / cols, h: 1 / rows,
    }))
    return { rects, main }
  }

  const tiles = ordered.slice(1)
  const placement = placementFor(w, h)
  const auto = share === null
  const s = auto ? autoShare(ordered.length, w, h, aspect) : clampShare(share)
  if (placement === 'side') {
    rects.set(main, { x: 0, y: 0, w: s, h: 1 })
    tiles.forEach((c, i) => rects.set(c, { x: s, y: i / tiles.length, w: 1 - s, h: 1 / tiles.length }))
  } else {
    rects.set(main, { x: 0, y: 0, w: 1, h: s })
    tiles.forEach((c, i) => rects.set(c, { x: i / tiles.length, y: s, w: 1 / tiles.length, h: 1 - s }))
  }
  const mw = placement === 'side' ? s * w : w
  const mh = placement === 'side' ? h : s * h
  return { rects, main, split: { placement, share: s, auto }, mainCrop: cropFraction(mw, mh, aspect) }
}

/** Divider position from a pointer position inside the container. */
export function shareFromPointer(
  placement: Placement, x: number, y: number, w: number, h: number,
): number {
  const v = placement === 'side' ? x / Math.max(w, 1) : y / Math.max(h, 1)
  return clampShare(Math.round(v * 100) / 100)
}
