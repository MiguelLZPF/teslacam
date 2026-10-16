/** The player's layout math and the remembered layout choices. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  FALLBACK_ASPECT, MAX_MAIN_CROP, SHARE_MAX, SHARE_MIN, arrange, autoShare, bestGrid, clampShare,
  cropFraction,
  pictureRect, placementFor, shareFromPointer, stepShare,
} from '../src/lib/arrange.ts'
import type { Camera } from '../src/lib/library.ts'
import { loadFit, loadMainCamera, loadShare, saveFit, saveShare } from '../src/lib/prefs.ts'

const FOUR: Camera[] = ['front', 'left_repeater', 'right_repeater', 'back']
const area = (r: { w: number; h: number }) => r.w * r.h

test('the divider is held between 50 and 90 percent', () => {
  assert.equal(clampShare(0.2), SHARE_MIN)
  assert.equal(clampShare(0.97), SHARE_MAX)
  assert.equal(clampShare(0.7), 0.7)
  assert.equal(clampShare(NaN), SHARE_MIN)
  assert.equal(shareFromPointer('side', 5, 0, 1000, 500), SHARE_MIN)
  assert.equal(shareFromPointer('side', 995, 0, 1000, 500), SHARE_MAX)
  assert.equal(shareFromPointer('side', 700, 0, 1000, 500), 0.7)
  assert.equal(shareFromPointer('below', 0, 300, 1000, 500), 0.6)
})

test('[ and ] move the share in clean steps and stop at the bounds', () => {
  assert.equal(stepShare(0.7, 1), 0.75)
  assert.equal(stepShare(0.7, -1), 0.65)
  assert.equal(stepShare(0.9, 1), 0.9)
  assert.equal(stepShare(0.5, -1), 0.5)
  // Repeated steps never drift off the two-decimal grid.
  let s = 0.5
  for (let i = 0; i < 8; i++) s = stepShare(s, 1)
  assert.equal(s, 0.9)
})

test('a wide area puts the tiles in a column, a tall one in a row', () => {
  assert.equal(placementFor(1440, 900), 'side')
  assert.equal(placementFor(900, 1440), 'below')
  assert.equal(placementFor(1000, 1000), 'side')

  const wide = arrange('tesla', FOUR, 'front', 1440, 900, 0.7)
  assert.equal(wide.split?.placement, 'side')
  assert.deepEqual(wide.rects.get('front'), { x: 0, y: 0, w: 0.7, h: 1 })
  const tile = wide.rects.get('back')!
  assert.ok(Math.abs(tile.x - 0.7) < 1e-9 && Math.abs(tile.w - 0.3) < 1e-9)
  assert.ok(Math.abs(tile.h - 1 / 3) < 1e-9)

  const tall = arrange('tesla', FOUR, 'front', 900, 1440, 0.7)
  assert.equal(tall.split?.placement, 'below')
  assert.deepEqual(tall.rects.get('front'), { x: 0, y: 0, w: 1, h: 0.7 })
  assert.ok(Math.abs(tall.rects.get('back')!.w - 1 / 3) < 1e-9)
})

test('the cameras tile the whole area: no overlap, no dead band', () => {
  for (const [w, h] of [[1440, 900], [2560, 1440], [900, 1440], [1000, 1000]]) {
    for (const layout of ['tesla', 'wide'] as const) {
      const a = arrange(layout, FOUR, 'back', w, h, null)
      const total = [...a.rects.values()].reduce((n, r) => n + area(r), 0)
      assert.ok(Math.abs(total - 1) < 1e-9, `${layout} ${w}x${h} covers the area`)
      for (const r of a.rects.values()) {
        assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9)
      }
    }
  }
})

test('the chosen camera is the main view, and a missing one falls back', () => {
  assert.equal(arrange('tesla', FOUR, 'back', 1440, 900, 0.7).main, 'back')
  assert.equal(arrange('tesla', FOUR, 'left_pillar', 1440, 900, 0.7).main, 'front')
  const single = arrange('single', FOUR, 'back', 1440, 900, null)
  assert.deepEqual([...single.rects.keys()], ['back'])
  assert.deepEqual(arrange('tesla', ['front'], 'front', 1440, 900, 0.7).rects.get('front'),
    { x: 0, y: 0, w: 1, h: 1 })
  assert.equal(arrange('tesla', [], undefined, 1440, 900, null).rects.size, 0)
})

test('the automatic share gives the tiles exactly the room their pictures need', () => {
  for (const [w, h] of [[1424, 648], [1432, 622], [2544, 1037], [2552, 1162]]) {
    const share = autoShare(4, w, h)
    assert.ok(share >= SHARE_MIN && share <= SHARE_MAX)
    const a = arrange('tesla', FOUR, 'front', w, h, null)
    const tile = a.rects.get('back')!
    // The tile box has the frame's own shape: no bars inside it, flush to the edge.
    const aspect = (tile.w * w) / (tile.h * h)
    assert.ok(Math.abs(aspect - FALLBACK_ASPECT) < 0.02, `${w}x${h} tile shape ${aspect.toFixed(3)}`)
    assert.ok(Math.abs(tile.x + tile.w - 1) < 1e-9, 'the tile column reaches the right edge')
    // The main view takes the rest, with no gap between it and the tiles.
    const main = a.rects.get('front')!
    assert.ok(Math.abs(main.x + main.w - tile.x) < 1e-9, 'no gap')
    assert.ok(a.mainCrop! >= 0 && a.mainCrop! < MAX_MAIN_CROP, `${w}x${h} crop ${a.mainCrop}`)
  }
  // A tall area gets the same treatment with a row.
  const tall = arrange('tesla', FOUR, 'front', 900, 1440, null)
  const t = tall.rects.get('back')!
  assert.ok(Math.abs((t.w * 900) / (t.h * 1440) - FALLBACK_ASPECT) < 0.02)
  assert.ok(Math.abs(t.y + t.h - 1) < 1e-9)
})

test('a manual share is honoured exactly and is not treated as automatic', () => {
  const a = arrange('tesla', FOUR, 'front', 1424, 648, 0.6)
  assert.equal(a.split?.auto, false)
  assert.equal(a.split?.share, 0.6)
  assert.equal(arrange('tesla', FOUR, 'front', 1424, 648, null).split?.auto, true)
})

test('crop fraction is zero for a matching shape and grows with the mismatch', () => {
  assert.equal(cropFraction(1544, 1000, 1.544), 0)
  assert.ok(Math.abs(cropFraction(1932, 1000, 1.544) - 0.2) < 0.01)
  assert.ok(cropFraction(1000, 1000, 1.544) > 0.3)
  assert.equal(cropFraction(0, 100, 1.5), 0)
})

test('fit keeps the whole frame, fill uses the whole box', () => {
  const box = { w: 800, h: 800 }
  const fit = pictureRect(box, FALLBACK_ASPECT, 'fit')
  assert.ok(Math.abs(fit.w / fit.h - FALLBACK_ASPECT) < 1e-9)
  assert.equal(fit.w, 800)
  assert.ok(fit.y > 0, 'bars above and below')
  assert.deepEqual(pictureRect(box, FALLBACK_ASPECT, 'fill'), { x: 0, y: 0, w: 800, h: 800 })
})

test('the grid picks the shape that shows the most picture', () => {
  assert.deepEqual(bestGrid(4, 2560, 1440), { cols: 2, rows: 2 })
  assert.deepEqual(bestGrid(2, 1600, 500), { cols: 2, rows: 1 })
  assert.deepEqual(bestGrid(2, 500, 1600), { cols: 1, rows: 2 })
})

test('stored choices fall back cleanly when storage is missing, broken or odd', () => {
  const g = globalThis as any
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const set = (v: unknown) => Object.defineProperty(globalThis, 'localStorage', { value: v, configurable: true })
  try {
    // Storage that throws on every call (blocked site data).
    set({ getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } })
    assert.equal(loadShare(), null)
    assert.equal(loadFit('normal'), 'fit')
    assert.equal(loadMainCamera(), 'front')
    saveShare(0.7); saveFit('player', 'fill')       // must not throw

    // Working storage: values round trip, are clamped, and views are separate.
    const mem = new Map<string, string>()
    set({ getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) } })
    saveShare(0.7); assert.equal(loadShare(), 0.7)
    saveShare(null); assert.equal(loadShare(), null)
    mem.set('teslacam.share', '3'); assert.equal(loadShare(), SHARE_MAX)
    mem.set('teslacam.share', 'junk'); assert.equal(loadShare(), null)
    saveFit('player', 'fill')
    assert.equal(loadFit('player'), 'fill')
    assert.equal(loadFit('normal'), 'fit')
    mem.set('teslacam.fit.normal', 'banana'); assert.equal(loadFit('normal'), 'fit')
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete g.localStorage
  }
})
