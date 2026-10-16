/** Opening a plain list of files, for browsers with no folder access (iPadOS Safari). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { scanFiles } from '../src/lib/library.ts'

const file = (name: string, text = ''): File =>
  ({ name, size: text.length, async text() { return text } }) as unknown as File
const CAMS = ['front', 'back', 'left_repeater', 'right_repeater']
const clips = (keys: string[]) => keys.flatMap((k) => CAMS.map((c) => file(`${k}-${c}.mp4`)))

test('picked clips are grouped by their Tesla time stamp into segments', async () => {
  const ev = await scanFiles(clips(['2026-10-05_09-49-11', '2026-10-05_09-50-12']))
  assert.equal(ev.length, 1)
  assert.equal(ev[0].segments.length, 2)
  assert.ok(ev[0].segments[0].files.front && ev[0].segments[0].files.right_repeater)
})

test('clips picked in any order, and from different drives, come out newest first', async () => {
  const ev = await scanFiles(clips([
    '2026-10-05_11-30-00', '2026-10-05_09-49-11', '2026-10-05_09-50-12', '2026-10-05_11-31-02',
  ]))
  assert.equal(ev.length, 2)                          // a gap of two hours splits the drives
  assert.ok(ev[0].startedAt.getTime() > ev[1].startedAt.getTime())
  assert.deepEqual(ev.map((e) => e.segments.length), [2, 2])
})

test('non clip files are ignored and an empty or foreign pick yields nothing', async () => {
  assert.deepEqual(await scanFiles([]), [])
  assert.deepEqual(await scanFiles([file('notes.txt'), file('IMG_0001.mp4')]), [])
  const ev = await scanFiles([...clips(['2026-10-05_09-49-11']), file('IMG_0001.mp4'), file('thumb.png')])
  assert.equal(ev.length, 1)
})

test('a lone verdict.json is attached to the one event; ambiguous ones are not guessed', async () => {
  const verdict = JSON.stringify({ class: 'highlight', label: 'badas_0.96_t20s', trigger_key: '2026-10-05_09-49-11' })
  const one = await scanFiles([...clips(['2026-10-05_09-49-11']), file('verdict.json', verdict)])
  assert.equal(one[0].verdict?.cls, 'highlight')
  assert.equal(one[0].verdict?.prob, 0.96)
  assert.deepEqual(one[0].verdict?.jump, { segmentIndex: 0, atSec: 20 })

  const two = await scanFiles([
    ...clips(['2026-10-05_09-49-11', '2026-10-05_14-00-00']), file('verdict.json', verdict),
  ])
  assert.equal(two.length, 2)
  assert.ok(two.every((e) => e.verdict === undefined), 'two events, one verdict: no guess')

  const twoVerdicts = await scanFiles([
    ...clips(['2026-10-05_09-49-11']), file('verdict.json', verdict), file('verdict.json', verdict),
  ])
  assert.equal(twoVerdicts[0].verdict, undefined)
  const broken = await scanFiles([...clips(['2026-10-05_09-49-11']), file('verdict.json', 'not json')])
  assert.equal(broken.length, 1)
  assert.equal(broken[0].verdict, undefined)
})
