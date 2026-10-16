/**
 * Recursive discovery: pick a parent folder, get every event below it.
 *
 * A fake tree of zero-byte files named like Tesla clips, walked through the same
 * stand-in directory handle the other library tests use. Reading a clip's text
 * throws, which proves the scan never opens a video.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { MAX_DEPTH, parseVerdict, scanLibrary, splitByGap } from '../src/lib/library.ts'

function handleFor(dir: string, name = path.basename(dir), listed: string[] = []): any {
  return {
    kind: 'directory',
    name,
    async *entries() {
      listed.push(dir)
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) yield [e.name, handleFor(full, e.name, listed)]
        else yield [e.name, {
          kind: 'file', name: e.name,
          async getFile() {
            return {
              name: e.name, size: fs.statSync(full).size,
              async text() {
                if (e.name.endsWith('.mp4')) throw new Error('a clip was read')
                return fs.readFileSync(full, 'utf-8')
              },
            } as unknown as File
          },
        }]
      }
    },
  }
}

const CAMS = ['front', 'back', 'left_repeater', 'right_repeater', 'left_pillar', 'right_pillar']
function clips(dir: string, keys: string[], cams = CAMS) {
  fs.mkdirSync(dir, { recursive: true })
  for (const k of keys) for (const c of cams) fs.writeFileSync(path.join(dir, `${k}-${c}.mp4`), '')
}

function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teslacam-'))
  const top = path.join(root, 'tesla')
  // Events/<event>: two windows and a verdict
  const ev1 = path.join(top, 'Events', '2026-10-05_09-49-11_highlight_badas_0.96_t60s')
  clips(ev1, ['2026-10-05_09-49-11', '2026-10-05_09-50-11'])
  fs.writeFileSync(path.join(ev1, 'verdict.json'), JSON.stringify({
    class: 'highlight', label: 'badas_0.96_t60s',
    windows: [{ key: '2026-10-05_09-49-11' }, { key: '2026-10-05_09-50-11' }],
  }))
  const ev2 = path.join(top, 'Events', '2026-10-06_08-00-00_incident_impact_12.3ms2_t35s')
  clips(ev2, ['2026-10-06_08-00-00'])
  fs.writeFileSync(path.join(ev2, 'verdict.json'), JSON.stringify({
    class: 'incident', label: 'impact_12.3ms2_t35s',
  }))
  // RecentClips/<date>: two drives with a 10 minute hole
  clips(path.join(top, 'RecentClips', '2026-10-04'), [
    '2026-10-04_10-00-00', '2026-10-04_10-01-05', '2026-10-04_10-02-10',
    '2026-10-04_10-12-10', '2026-10-04_10-13-15',
  ])
  // Too deep to be found, and a folder with no clips at all
  clips(path.join(top, 'a', 'b', 'c', 'd'), ['2026-10-01_01-00-00'])
  fs.mkdirSync(path.join(top, 'empty'))
  return { root, top, ev1, ev2 }
}

test('a parent folder yields every event below it, newest first', async () => {
  const { top } = tree()
  const lib = await scanLibrary(handleFor(top))
  assert.equal(lib.length, 4, 'two Events, two drives from the day folder')
  const times = lib.map((e) => e.startedAt.getTime())
  assert.deepEqual(times, [...times].sort((a, b) => b - a))
  assert.deepEqual(lib.map((e) => e.source),
    ['Events', 'Events', 'RecentClips', 'RecentClips'])
  assert.ok(lib.every((e) => !e.id.includes('/d')), 'nothing past the depth cap')
})

test('the depth cap is honoured and folders are listed lazily', async () => {
  const { top } = tree()
  const listed: string[] = []
  await scanLibrary(handleFor(top, 'tesla', listed))
  assert.equal(MAX_DEPTH, 3)
  assert.ok(!listed.some((d) => d.endsWith(path.join('a', 'b', 'c', 'd'))),
    'level four is never opened')
  // A clip-holding folder is an entry and is not searched further.
  const n = listed.filter((d) => d.endsWith('_t60s')).length
  assert.equal(n, 1)
})

test('a folder keeps all its windows as segments of one event', async () => {
  const { top } = tree()
  const lib = await scanLibrary(handleFor(top))
  const ev = lib.find((e) => e.name.includes('badas_0.96'))!
  assert.equal(ev.segments.length, 2)
  assert.equal(ev.source, 'Events')
  assert.ok(ev.segments[0].files.front && ev.segments[0].files.right_repeater)
})

test('a plain day folder is cut where footage is missing', async () => {
  const { top } = tree()
  const lib = await scanLibrary(handleFor(top))
  const day = lib.filter((e) => e.name === '2026-10-04')
  assert.deepEqual(day.map((e) => e.segments.length).sort(), [2, 3])
  assert.notEqual(day[0].id, day[1].id)
})

test('the folder picked directly stays one entry, as before', async () => {
  const { top } = tree()
  const lib = await scanLibrary(handleFor(path.join(top, 'RecentClips', '2026-10-04')))
  assert.equal(lib.length, 1)
  assert.equal(lib[0].segments.length, 5)
})

test('the verdict is read, the clips are not', async () => {
  const { top } = tree()
  const lib = await scanLibrary(handleFor(top))
  const hl = lib.find((e) => e.name.includes('badas_0.96'))!
  assert.equal(hl.verdict?.cls, 'highlight')
  assert.equal(hl.verdict?.kind, 'badas')
  assert.equal(hl.verdict?.prob, 0.96)
  assert.equal(hl.verdict?.peakSec, 60)
  const inc = lib.find((e) => e.name.includes('incident'))!
  assert.equal(inc.verdict?.kind, 'impact')
  assert.equal(inc.verdict?.accel, 12.3)
  assert.equal(inc.verdict?.peakSec, 35)
})

test('a seek target needs a known trigger window', async () => {
  const { top } = tree()
  const lib = await scanLibrary(handleFor(top))
  // Two windows and no trigger_key: the numbers are shown, the playhead is not moved.
  assert.equal(lib.find((e) => e.name.includes('badas_0.96'))!.verdict?.jump, undefined)
  // A single window is unambiguous.
  assert.deepEqual(lib.find((e) => e.name.includes('incident'))!.verdict?.jump,
    { segmentIndex: 0, atSec: 35 })

  const segs = [{ key: 'A' }, { key: 'B' }, { key: 'C' }] as any
  const v = parseVerdict(JSON.stringify({
    class: 'highlight', label: 'badas_0.91_t8s', trigger_key: 'B',
  }), segs)
  assert.deepEqual(v?.jump, { segmentIndex: 1, atSec: 8 })
  assert.equal(parseVerdict('not json', segs), undefined)
  assert.equal(parseVerdict('{"class":"highlight","label":"odd"}', segs)?.jump, undefined)
})

test('splitByGap leaves a continuous run whole', () => {
  const mk = (s: number) => ({ startedAt: new Date(2026, 9, 1, 10, 0, s) }) as any
  assert.equal(splitByGap([mk(0), mk(61), mk(125)]).length, 1)
  assert.equal(splitByGap([mk(0), mk(61), mk(300)]).length, 2)
})
