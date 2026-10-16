/** Timeline peaks, hard-acceleration marks and the NAS handle fallback. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { eventPeaks, parseVerdict, type TeslaEvent } from '../src/lib/library.ts'
import { canRememberFolder, ensureRead, loadNasHandle } from '../src/lib/nas.ts'
import { detectActions, HARD_ACCEL_MPS2, type Telemetry } from '../src/lib/sei.ts'

const seg = (key: string, dur = 60) => ({ key, startedAt: new Date(), files: {}, durationSec: dur }) as any

function event(verdictJson: object, keys = ['A', 'B', 'C']): TeslaEvent {
  const segments = keys.map((k) => seg(k))
  return {
    id: 'x', source: 'Events', name: 'x', startedAt: new Date(), segments,
    verdict: parseVerdict(JSON.stringify(verdictJson), segments),
  } as TeslaEvent
}

test('the trigger peak and the other kept peaks are placed on the timeline', () => {
  const ev = event({
    class: 'highlight', label: 'badas_0.99_t20s', trigger_key: 'B',
    keeps: [
      { key: 'B', reason: 'badas_0.99_t20s' },
      { key: 'C', reason: 'badas_0.97_t51s' },
      { key: 'A', reason: 'impact_6.2ms2_t4s' },
    ],
  })
  const peaks = eventPeaks(ev)
  assert.deepEqual(peaks.map((p) => [p.atSec, p.label, p.strong]), [
    [4, '6.2', false],        // window A, 4 s in
    [80, '0.99', true],       // trigger: window B starts at 60, plus 20
    [171, '0.97', false],     // window C starts at 120, plus 51
  ])
})

test('without a trigger key only the kept windows are marked', () => {
  const ev = event({
    class: 'highlight', label: 'badas_0.99_t20s',
    keeps: [{ key: 'C', reason: 'badas_0.97_t51s' }],
  })
  const peaks = eventPeaks(ev)
  assert.equal(peaks.length, 1)
  assert.equal(peaks[0].strong, false)
})

test('keeps with an unknown window or an unreadable reason are skipped', () => {
  const ev = event({
    class: 'highlight', label: 'odd',
    keeps: [{ key: 'Z', reason: 'badas_0.9_t1s' }, { key: 'A', reason: 'whatever' }, null, { key: 'B' }],
  })
  assert.deepEqual(eventPeaks(ev), [])
})

test('a plain event has no peaks', () => {
  assert.deepEqual(eventPeaks({ segments: [seg('A')] } as any), [])
})

test('hard braking or swerving above 4 m/s2 is marked once per manoeuvre', () => {
  const base: Telemetry = {
    version: 0, gear: 'drive', frame: 0, speedMps: 10, acceleratorPct: 0, steeringDeg: 0,
    blinkerLeft: false, blinkerRight: false, braking: false, autopilot: 'none',
    lat: 0, lon: 0, headingDeg: 0, accelX: 0, accelY: 0, accelZ: 0,
  }
  const samples = Array.from({ length: 200 }, (_, i) => ({ ...base, frame: i }))
  for (let i = 60; i < 70; i++) { samples[i].accelX = 3; samples[i].accelY = 3.2 }   // about 4.4
  for (let i = 150; i < 153; i++) samples[i].accelX = 3.5                            // under
  const hard = detectActions(samples).filter((m) => m.kind === 'hard')
  assert.equal(HARD_ACCEL_MPS2, 4)
  assert.equal(hard.length, 1)
})

test('without IndexedDB the NAS handle is simply not remembered', async () => {
  assert.equal(canRememberFolder(), false)
  assert.equal(await loadNasHandle(), null)
  assert.equal(await ensureRead({} as any), false)
})
