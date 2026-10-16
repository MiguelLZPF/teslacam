/** Main-camera layout and the stored preferences. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { layoutFor } from '../src/lib/compose.ts'
import { BASE_CAMERAS, CAMERAS, type Camera } from '../src/lib/library.ts'
import { loadMainCamera, loadTheme } from '../src/lib/prefs.ts'

const FOUR: Camera[] = [...BASE_CAMERAS]

test('the car layout puts the chosen camera in the large slot', () => {
  const front = layoutFor('tesla', FOUR)
  assert.deepEqual(front.get('front'), { x: 0.25, y: 0, w: 0.5, h: 0.5 })
  assert.equal(front.get('right_repeater')!.x, 0)

  const back = layoutFor('tesla', FOUR, 'back')
  assert.deepEqual(back.get('back'), { x: 0.25, y: 0, w: 0.5, h: 0.5 })
  assert.equal(back.size, 4)
  // The other three share the bottom row, each in its own third.
  const xs = FOUR.filter((c) => c !== 'back').map((c) => back.get(c)!.x).sort()
  assert.deepEqual(xs, [0, 1 / 3, 2 / 3])
  assert.ok(FOUR.filter((c) => c !== 'back').every((c) => back.get(c)!.y === 0.5))
})

test('four cameras including a pillar still use the car layout', () => {
  const cams: Camera[] = ['front', 'back', 'left_pillar', 'right_pillar']
  const l = layoutFor('tesla', cams, 'left_pillar')
  assert.deepEqual(l.get('left_pillar'), { x: 0.25, y: 0, w: 0.5, h: 0.5 })
  assert.equal(l.size, 4)
})

test('a main camera that is not selected changes nothing', () => {
  const a = layoutFor('tesla', ['front', 'back', 'left_repeater', 'right_repeater'], 'left_pillar')
  assert.deepEqual(a.get('front'), { x: 0.25, y: 0, w: 0.5, h: 0.5 })
})

test('single and grid lead with the main camera', () => {
  assert.deepEqual([...layoutFor('single', FOUR, 'back').keys()], ['back'])
  assert.equal(layoutFor('grid', FOUR, 'back').get('back')!.x, 0)
  assert.equal(layoutFor('grid', FOUR, 'back').get('back')!.y, 0)
})

test('six cameras fall back to a grid', () => {
  const l = layoutFor('tesla', [...CAMERAS], 'back')
  assert.equal(l.size, 6)
  assert.equal(l.get('back')!.w, 0.5)
})

test('without localStorage the defaults hold', () => {
  assert.equal(loadMainCamera(), 'front')
  assert.equal(loadTheme(), 'black')
})
