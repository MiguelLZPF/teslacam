/** Export size and layout math: aspect kept, even sizes, caps, no bars. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  EXPORT_MAX_H, EXPORT_MAX_W, SINGLE_MAX_W, even, exportBitrate, planExport, splitEven,
  type ExportPlan, type Native,
} from '../src/lib/exportplan.ts'
import type { Camera } from '../src/lib/library.ts'

const SIDE: Native = { w: 1448, h: 938 }
const HW4 = new Map<Camera, Native>([
  ['front', { w: 2896, h: 1876 }], ['back', SIDE], ['left_repeater', SIDE], ['right_repeater', SIDE],
  ['left_pillar', SIDE], ['right_pillar', SIDE],
])
const FOUR: Camera[] = ['front', 'left_repeater', 'right_repeater', 'back']
const ASPECT = 724 / 469

const allEven = (p: ExportPlan) => {
  assert.equal(p.width % 2, 0)
  assert.equal(p.height % 2, 0)
  for (const r of p.rects.values()) {
    for (const v of [r.x, r.y, r.w, r.h]) assert.equal(v % 2, 0, `even ${JSON.stringify(r)}`)
  }
}
const covers = (p: ExportPlan) => {
  const area = [...p.rects.values()].reduce((n, r) => n + r.w * r.h, 0)
  assert.equal(area, p.width * p.height, 'the boxes tile the canvas exactly')
  for (const r of p.rects.values()) {
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= p.width && r.y + r.h <= p.height)
  }
}
const keepsAspect = (p: ExportPlan, tol = 0.012) => {
  for (const [cam, r] of p.rects) {
    const a = HW4.get(cam)!
    assert.ok(Math.abs(r.w / r.h / (a.w / a.h) - 1) < tol, `${cam} ${r.w}x${r.h}`)
  }
}

test('the front alone keeps its shape and is capped at 1920 wide', () => {
  const p = planExport('single', ['front'], 'front', HW4)
  assert.equal(p.width, SINGLE_MAX_W)
  assert.ok(Math.abs(p.width / p.height - ASPECT) < 0.003)
  allEven(p); covers(p); keepsAspect(p)
  assert.equal(p.overlayOnMain, true)
})

test('a side camera alone is exported at its native size, not enlarged', () => {
  const p = planExport('single', ['front', 'back'], 'back', HW4)
  assert.deepEqual([p.width, p.height], [1448, 938])
  assert.deepEqual([...p.rects.keys()], ['back'])
})

test('main plus tiles beside it: no bars, every camera at its own aspect, capped', () => {
  const p = planExport('tesla', FOUR, 'front', HW4, 'side')
  assert.ok(p.width <= EXPORT_MAX_W && p.height <= EXPORT_MAX_H)
  allEven(p); covers(p); keepsAspect(p)
  const main = p.rects.get('front')!
  assert.deepEqual([main.x, main.y, main.h], [0, 0, p.height])
  // The three tiles form one column to the right of the main picture.
  const tiles = FOUR.filter((c) => c !== 'front').map((c) => p.rects.get(c)!)
  assert.ok(tiles.every((t) => t.x === main.w && t.w === p.width - main.w))
  assert.equal(tiles.reduce((n, t) => n + t.h, 0), p.height)
})

test('main plus tiles beneath it: a row under the main picture', () => {
  const p = planExport('tesla', FOUR, 'back', HW4, 'below')
  assert.ok(p.width <= EXPORT_MAX_W && p.height <= EXPORT_MAX_H)
  allEven(p); covers(p); keepsAspect(p)
  const main = p.rects.get('back')!
  assert.deepEqual([main.x, main.y, main.w], [0, 0, p.width])
  const tiles = FOUR.filter((c) => c !== 'back').map((c) => p.rects.get(c)!)
  assert.ok(tiles.every((t) => t.y === main.h))
  assert.equal(tiles.reduce((n, t) => n + t.w, 0), p.width)
})

test('wide is one row at the cameras own shape', () => {
  const p = planExport('wide', FOUR, 'front', HW4)
  assert.ok(p.width <= EXPORT_MAX_W && p.height <= EXPORT_MAX_H)
  allEven(p); covers(p); keepsAspect(p)
  assert.equal(new Set([...p.rects.values()].map((r) => r.y)).size, 1)
  assert.equal(p.overlayOnMain, false)
})

test('grid cells have the cameras shape and fit the cap', () => {
  const p = planExport('grid', FOUR, 'front', HW4)
  assert.ok(p.width <= EXPORT_MAX_W && p.height <= EXPORT_MAX_H)
  allEven(p)
  for (const r of p.rects.values()) assert.ok(Math.abs(r.w / r.h / ASPECT - 1) < 0.012)
  // Three cameras leave one empty cell: the canvas is still whole cells.
  const three = planExport('grid', ['front', 'back', 'left_repeater'], 'front', HW4)
  allEven(three)
})

test('older 4:3 cameras are not stretched to the new shape', () => {
  const old = new Map<Camera, Native>(FOUR.map((c) => [c, { w: 1280, h: 960 }]))
  const p = planExport('tesla', FOUR, 'front', old, 'side')
  allEven(p); covers(p)
  for (const r of p.rects.values()) assert.ok(Math.abs(r.w / r.h / (4 / 3) - 1) < 0.015)
})

test('sizes stay even and in bounds across odd inputs', () => {
  for (const nat of [{ w: 1281, h: 721 }, { w: 3001, h: 999 }, { w: 640, h: 360 }]) {
    const m = new Map<Camera, Native>(FOUR.map((c) => [c, nat]))
    for (const layout of ['tesla', 'wide', 'grid', 'single'] as const) {
      for (const placement of ['side', 'below'] as const) {
        const p = planExport(layout, FOUR, 'front', m, placement)
        allEven(p)
        assert.ok(p.width <= Math.max(EXPORT_MAX_W, nat.w + 2))
        assert.ok(p.height <= Math.max(EXPORT_MAX_H, nat.h + 2))
      }
    }
  }
  assert.equal(planExport('tesla', [], undefined, HW4).rects.size, 0)
})

test('even rounding and proportional splits', () => {
  assert.equal(even(1243.4), 1244)
  assert.equal(even(1.2), 2)
  const parts = splitEven(1244, [1, 1, 1])
  assert.equal(parts.reduce((a, b) => a + b, 0), 1244)
  assert.ok(parts.every((v) => v % 2 === 0))
  assert.ok(Math.max(...parts) - Math.min(...parts) <= 2)
})

test('the bitrate follows the pixels and stays bounded', () => {
  assert.equal(exportBitrate(640, 360, 36), 4_000_000)
  assert.ok(exportBitrate(2560, 1244, 36) > 10_000_000)
  assert.equal(exportBitrate(4096, 2304, 36), 24_000_000)
})
