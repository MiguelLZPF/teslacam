/**
 * The size and layout of an exported video, from the cameras' own geometry.
 *
 * Upstream drew every camera into a 4:3 cell of a 1280x960-based canvas, which
 * stretched or letterboxed real footage (Tesla's clips are 724:469, about
 * 1.54:1: 1448x938 on the sides and back, 2896x1876 at the front). Here each
 * camera keeps its own aspect, the composite is sized from the real frames, and
 * the boxes tile the canvas exactly, so there are no bars and nothing stretches.
 * Everything is even-sized, as the H.264 encoder requires.
 *
 * Pure functions, no DOM: the exporter feeds them the sizes it read from the
 * demuxed files.
 */
import { FALLBACK_ASPECT, bestGrid, type Placement } from './arrange'
import type { LayoutName } from './compose'
import type { Camera } from './library'

/** Largest composite. Level 5.2 allows more, but a laptop encodes 2560x1440 at
 *  36 fps in about real time and nothing bigger. */
export const EXPORT_MAX_W = 2560
export const EXPORT_MAX_H = 1440
/** The main camera alone is capped lower: 1920 wide is plenty for one picture. */
export const SINGLE_MAX_W = 1920

export interface Native { w: number; h: number }
export interface PxRect { x: number; y: number; w: number; h: number }

export interface ExportPlan {
  width: number
  height: number
  /** Where each camera's picture goes, in output pixels. */
  rects: Map<Camera, PxRect>
  main: Camera | undefined
  /** Whether the clock and speed sit on the main picture (else on the whole canvas). */
  overlayOnMain: boolean
}

/** Even, and at least 2: the encoder rejects odd dimensions. */
export const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

/** Split `total` (even) into parts proportional to `weights`, every part even. */
export function splitEven(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  const out: number[] = []
  let used = 0
  let acc = 0
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i]
    const edge = i === weights.length - 1 ? total : even((acc / sum) * total)
    out.push(Math.max(2, edge - used))
    used = edge
  }
  return out
}

/** Bits per second for a canvas of this size at the clip frame rate. */
export function exportBitrate(width: number, height: number, fps: number): number {
  return Math.round(Math.min(24e6, Math.max(4e6, width * height * fps * 0.1)))
}

const aspectOf = (n: Native | undefined): number => (n && n.w > 0 && n.h > 0 ? n.w / n.h : FALLBACK_ASPECT)

/**
 * Plan the export.
 *  - 'single': the main camera alone at its native size, capped at SINGLE_MAX_W.
 *  - 'tesla': the main camera plus the others as tiles, in a column beside it or
 *    a row beneath it (`placement`, as on screen). The split follows from the
 *    cameras' aspects so that nothing needs bars.
 *  - 'wide': one row. 'grid': equal cells of the main camera's shape.
 */
export function planExport(
  layout: LayoutName, cams: Camera[], mainCam: Camera | undefined,
  natives: ReadonlyMap<Camera, Native>, placement: Placement = 'side',
): ExportPlan {
  const rects = new Map<Camera, PxRect>()
  if (!cams.length) return { width: 2, height: 2, rects, main: undefined, overlayOnMain: false }

  const main = mainCam && cams.includes(mainCam) ? mainCam : cams[0]
  const ordered = [main, ...cams.filter((c) => c !== main)]
  const A = (c: Camera) => aspectOf(natives.get(c))
  const nat = natives.get(main) ?? { w: 1448, h: 938 }

  if (layout === 'single' || ordered.length === 1) {
    const s = Math.min(1, SINGLE_MAX_W / nat.w, EXPORT_MAX_H / nat.h)
    const w = even(nat.w * s)
    const h = even(w / A(main))
    rects.set(main, { x: 0, y: 0, w, h })
    return { width: w, height: h, rects, main, overlayOnMain: true }
  }

  // Natural size (in "main native pixels"), then one scale factor to the caps.
  let w0: number
  let h0: number
  if (layout === 'tesla') {
    const tiles = ordered.slice(1)
    if (placement === 'side') {
      const S = tiles.reduce((n, c) => n + 1 / A(c), 0)       // tile heights, per unit tile width
      h0 = nat.h
      w0 = h0 * A(main) + h0 / S
    } else {
      const T = tiles.reduce((n, c) => n + A(c), 0)           // tile widths, per unit tile height
      w0 = nat.w
      h0 = w0 / A(main) + w0 / T
    }
  } else if (layout === 'wide') {
    h0 = nat.h
    w0 = h0 * ordered.reduce((n, c) => n + A(c), 0)
  } else {
    const { cols, rows } = bestGrid(ordered.length, 1600, 900, A(main))
    w0 = nat.w * cols
    h0 = nat.h * rows
  }
  const scale = Math.min(1, EXPORT_MAX_W / w0, EXPORT_MAX_H / h0)

  if (layout === 'tesla') {
    const tiles = ordered.slice(1)
    if (placement === 'side') {
      const H = even(h0 * scale)
      const S = tiles.reduce((n, c) => n + 1 / A(c), 0)
      const mw = even(H * A(main))
      const wt = even(H / S)
      const hs = splitEven(H, tiles.map((c) => 1 / A(c)))
      rects.set(main, { x: 0, y: 0, w: mw, h: H })
      let y = 0
      tiles.forEach((c, i) => { rects.set(c, { x: mw, y, w: wt, h: hs[i] }); y += hs[i] })
      return { width: mw + wt, height: H, rects, main, overlayOnMain: true }
    }
    const W = even(w0 * scale)
    const T = tiles.reduce((n, c) => n + A(c), 0)
    const mh = even(W / A(main))
    const ht = even(W / T)
    const ws = splitEven(W, tiles.map((c) => A(c)))
    rects.set(main, { x: 0, y: 0, w: W, h: mh })
    let x = 0
    tiles.forEach((c, i) => { rects.set(c, { x, y: mh, w: ws[i], h: ht }); x += ws[i] })
    return { width: W, height: mh + ht, rects, main, overlayOnMain: true }
  }

  if (layout === 'wide') {
    const H = even(h0 * scale)
    const ws = splitEven(Math.round(even(w0 * scale)), ordered.map((c) => A(c)))
    let x = 0
    ordered.forEach((c, i) => { rects.set(c, { x, y: 0, w: ws[i], h: H }); x += ws[i] })
    return { width: x, height: H, rects, main, overlayOnMain: false }
  }

  const { cols, rows } = bestGrid(ordered.length, 1600, 900, A(main))
  const cw = even((nat.w * scale))
  const ch = even(cw / A(main))
  ordered.forEach((c, i) => rects.set(c, {
    x: (i % cols) * cw, y: Math.floor(i / cols) * ch, w: cw, h: ch,
  }))
  return { width: cw * cols, height: ch * rows, rects, main, overlayOnMain: false }
}
