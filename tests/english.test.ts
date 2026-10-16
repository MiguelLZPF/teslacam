/**
 * The interface is English. These fail if Danish comes back: in the rendered
 * overlay, in the source, or in the built bundle (when dist/ exists).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { drawOverlay } from '../src/lib/compose.ts'
import { exportName } from '../src/lib/export.ts'
import { REASON_LABEL, CAMERA_LABEL } from '../src/lib/library.ts'
import type { Telemetry } from '../src/lib/sei.ts'

/** Danish words and units that must not appear in user-visible text. */
const MARKERS = [
  'km/t', 'da-DK', 'ingen ', 'Vælg', 'Søg', 'Afspil', 'Eksport', 'optagelse', 'kamera', 'sekunder',
  'hastighed', 'Bremser', 'Blink venstre', 'Blink højre', 'Venstre', 'Højre', 'Gitter', 'valgt',
  'tilbage', 'Alle optagelser', 'Hent ', 'Færdig', 'Klargør', 'Afbryd',
]

function recorder() {
  const texts: string[] = []
  const ctx: any = new Proxy({}, {
    get: (t: any, k: string) => {
      if (k === 'measureText') return (s: string) => ({ width: String(s).length * 8 })
      if (k in t) return t[k]
      return (...a: unknown[]) => { if (k === 'fillText') texts.push(String(a[0])) }
    },
    set: (t: any, k: string, v: unknown) => { t[k] = v; return true },
  })
  return { ctx, texts }
}

const T: Telemetry = {
  version: 0, gear: 'drive', frame: 0, speedMps: 13.9, acceleratorPct: 10, steeringDeg: 0,
  blinkerLeft: false, blinkerRight: false, braking: false, autopilot: 'none',
  lat: 0, lon: 0, headingDeg: 0, accelX: 0, accelY: 0, accelZ: 0,
}
const frame = (telemetry: Telemetry | null, noTelemetry = false) => ({
  telemetry, at: new Date(2026, 9, 5, 9, 49, 11), noTelemetry,
})
const opts = { speed: true, unit: 'kmh' as const, clock: true, gear: true, place: true, labels: true }

test('the speed readout says km/h, never km/t', () => {
  const { ctx, texts } = recorder()
  drawOverlay(ctx, { w: 1280, h: 960 }, frame(T), opts)            // default language
  assert.ok(texts.includes('km/h'), `drew ${JSON.stringify(texts)}`)
  assert.ok(!texts.some((t) => t.includes('km/t')))
  const mph = recorder()
  drawOverlay(mph.ctx, { w: 1280, h: 960 }, frame(T), { ...opts, unit: 'mph' }, 'en')
  assert.ok(mph.texts.includes('mph'))
})

test('the overlay states are English, whatever language flag is passed', () => {
  for (const lang of ['en', 'da'] as const) {
    const a = recorder()
    drawOverlay(a.ctx, { w: 1280, h: 960 }, frame(null, true), opts, lang)
    assert.ok(a.texts.includes('no telemetry'))
    const b = recorder()
    drawOverlay(b.ctx, { w: 1280, h: 960 }, frame(null, false), opts, lang)
    assert.ok(b.texts.includes('no data'))
    // The clock is an English date, such as 05/10/2026, 09:49:11.
    assert.ok(a.texts.some((t) => /^05\/10\/2026, 09:49:11$/.test(t)), JSON.stringify(a.texts))
  }
})

test('labels and the export file name are English', () => {
  for (const l of Object.values(CAMERA_LABEL)) assert.equal(l.da, l.en)
  for (const l of Object.values(REASON_LABEL)) assert.equal(l.da, l.en)
  const seg = { key: 'k', startedAt: new Date(2026, 7, 11, 12, 38, 9), files: {}, durationSec: 60 } as any
  const name = exportName({
    event: { segments: [seg], startedAt: seg.startedAt } as any,
    cameras: ['front', 'back', 'left_repeater', 'right_repeater'], layout: 'tesla',
    overlay: opts, fromSec: 0, toSec: 4, lang: 'en',
  })
  assert.match(name, /_4s_all\w*cam\.mp4$|_4s_allcam\.mp4$/)
  assert.ok(!/kam|alle/.test(name))
})

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out) } else out.push(p)
  }
  return out
}

test('no Danish markers or Danish letters in the source', () => {
  const files = walk('src').filter((f) => /\.(ts|tsx|css)$/.test(f)).concat(['index.html'])
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf-8')
    for (const m of MARKERS) assert.ok(!text.includes(m), `${f} contains "${m}"`)
    assert.ok(!/[æøåÆØÅ]/.test(text), `${f} contains a Danish letter`)
  }
})

test('no Danish markers in the built bundle', (t) => {
  if (!fs.existsSync('dist/assets')) return t.skip('no dist/ built')
  for (const f of walk('dist').filter((p) => /\.(js|css|html)$/.test(p))) {
    const text = fs.readFileSync(f, 'utf-8')
    for (const m of MARKERS) assert.ok(!text.includes(m), `${f} contains "${m}"`)
    assert.ok(!/[æøåÆØÅ]/.test(text), `${f} contains a Danish letter`)
  }
})
