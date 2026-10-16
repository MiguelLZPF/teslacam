/**
 * teslacam.cscloud.dk
 *
 * A viewer for your own dashcam footage that never uploads a frame. The server
 * hosts this page; everything else - reading the folder, decoding the video,
 * pulling telemetry out of the bitstream, composing an export - happens in the
 * browser on your machine.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ExportBar from './components/ExportBar'
import Library from './components/Library'
import Picker from './components/Picker'
import Player from './components/Player'
import Timeline, { clock } from './components/Timeline'
import type { LayoutName, OverlayOptions, Unit } from './lib/compose'
import { loadMainCamera, saveMainCamera } from './lib/prefs'
import {
  BASE_CAMERAS, CAMERA_LABEL, CAMERAS, JUMP_LEAD_S, camerasIn, collectActions, eventPeaks, eventSeconds,
  measureDurations,
  segmentStart,
  type Camera, type EventAction, type TeslaEvent,
} from './lib/library'
import { speedIn, type Telemetry } from './lib/sei'

const LAYOUTS: { id: LayoutName; da: string }[] = [
  { id: 'tesla', da: 'Car layout' },
  { id: 'grid', da: 'Grid' },
  { id: 'wide', da: 'In a row' },
  { id: 'single', da: 'One camera' },
]

const RATES = [0.5, 1, 2, 4] as const

export default function App() {
  const [library, setLibrary] = useState<TeslaEvent[] | null>(null)
  const [selected, setSelected] = useState<TeslaEvent | null>(null)
  const [cameras, setCameras] = useState<Camera[]>([...BASE_CAMERAS])
  const [main, setMainState] = useState<Camera>(loadMainCamera)
  const setMain = (c: Camera) => { setMainState(c); saveMainCamera(c) }
  const [layout, setLayout] = useState<LayoutName>('tesla')
  const [unit, setUnit] = useState<Unit>('kmh')
  const [overlay, setOverlay] = useState<Omit<OverlayOptions, 'unit'>>({
    speed: true, clock: true, gear: true, place: true, labels: true,
  })

  // Player view: only the cameras, the overlay and the controls. Fullscreen is the
  // same view in a real fullscreen window; Esc leaves both.
  const [playerView, setPlayerView] = useState(false)
  const fsEntered = useRef(false)
  const setView = (on: boolean) => {
    setPlayerView(on)
    if (!on && fsEntered.current) {
      fsEntered.current = false
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
      return
    }
    setPlayerView(true)
    if (document.documentElement.requestFullscreen) {
      fsEntered.current = true
      void document.documentElement.requestFullscreen().catch(() => { fsEntered.current = false })
    }
  }

  const [playing, setPlaying] = useState(true)
  const [rate, setRate] = useState<number>(1)
  const [time, setTime] = useState(0)
  const [total, setTotal] = useState(0)
  const [seekTo, setSeekTo] = useState<number | null>(null)
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null)
  const [noTelemetry, setNoTelemetry] = useState(false)
  const [exporting, setExporting] = useState(false)
  // The two handles, in whole-event seconds. The out-point is null until
  // somebody moves it: the event's length grows as the segments are measured,
  // and a number set from the estimate would freeze the selection at three
  // assumed minutes for footage that turned out to be two minutes and four
  // seconds - the export panel then promised 180 seconds of a 128-second event.
  const [inSec, setInSec] = useState(0)
  const [outSec, setOutSec] = useState<number | null>(null)
  // Bumped when a segment reports its real length, so the timeline redraws.
  const [measured, setMeasured] = useState(0)
  // Manoeuvres pulled from the telemetry, marked on the timeline. Filled in
  // progressively as each segment is parsed.
  const [actions, setActions] = useState<EventAction[]>([])

  const opts: OverlayOptions = useMemo(() => ({ ...overlay, unit }), [overlay, unit])
  const available = selected ? camerasIn(selected) : []

  // Rendered often; a new function per render would restart the player's loop.
  const onTime = useCallback((t: number, tot: number) => { setTime(t); setTotal(tot) }, [])
  const onTelemetry = useCallback((t: Telemetry | null, empty: boolean) => {
    setTelemetry(t); setNoTelemetry(empty)
  }, [])

  const openEvent = (e: TeslaEvent) => {
    setSelected(e)
    // The pillar cameras are available as chips but start switched off.
    const here = camerasIn(e)
    const base = here.filter((c) => BASE_CAMERAS.includes(c))
    setCameras(base.length ? base : here)
    // An event with a known peak opens a few seconds before it. The position uses
    // the assumed minute per segment until the real lengths are measured.
    const j = e.verdict?.jump
    const start = j ? Math.max(0, segmentStart(e, j.segmentIndex) + j.atSec - JUMP_LEAD_S) : 0
    setTime(start)
    setSeekTo(start)
    setPlaying(true)
    setInSec(0)
    setOutSec(null)
    setActions([])
  }

  // Real lengths for the timeline. The last segment of an event is usually a
  // few seconds rather than a minute, so a timeline drawn from the assumed
  // minute puts the out-point past the end of the footage.
  useEffect(() => {
    if (!selected) return
    let live = true
    void measureDurations(selected, () => { if (live) setMeasured((n) => n + 1) })
    return () => { live = false }
  }, [selected])

  // Pull the manoeuvres out of every segment's telemetry for the timeline. Runs
  // after the event opens and updates as it goes, so markers appear segment by
  // segment rather than after the whole event is read.
  useEffect(() => {
    if (!selected) return
    let live = true
    void collectActions(selected, (a) => { if (live) setActions(a) }, () => !live)
    return () => { live = false }
  }, [selected])

  // I and O, as in every editor. Not while typing in a field.
  const end = selected ? Math.max(eventSeconds(selected), total) : 0
  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return
      if (e.key === 'i' || e.key === 'I') setInSec(Math.min(time, (outSec ?? end) - 0.5))
      else if (e.key === 'o' || e.key === 'O') setOutSec(Math.max(time, inSec + 0.5))
      else if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p) }
      else if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        toggleFullscreen()
      }
      else if (e.key === 'Escape' && playerView && !document.fullscreenElement) setView(false)
      else return
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, time, inSec, outSec, end, playerView])

  // Esc in fullscreen is handled by the browser: it leaves fullscreen and fires
  // this, and the player view that fullscreen opened closes with it.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && fsEntered.current) {
        fsEntered.current = false
        setPlayerView(false)
      }
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  if (!library) return <Picker onLoaded={(evts) => setLibrary(evts)} />

  if (!selected) {
    return (
      <Library events={library} onOpen={openEvent} onReset={() => setLibrary(null)} />
    )
  }

  // `measured` is read so the timeline redraws when a segment reports its real
  // length; the durations themselves live on the event object.
  void measured
  const duration = Math.max(eventSeconds(selected), total)

  return (
    <div className={playerView
      ? 'flex h-dvh w-full flex-col gap-2 px-2 py-2'
      : 'mx-auto w-full max-w-[1800px] px-3 pb-16 pt-3 sm:px-5'}>
      <header className={'mb-3 flex flex-wrap items-center gap-3' + (playerView ? ' hidden' : '')}>
        <button className="btn" onClick={() => { setSelected(null); setPlaying(false) }}>
          ← All recordings
        </button>
        <div className="min-w-0">
          <p className="truncate font-medium">{titleOf(selected)}</p>
          <p className="num truncate text-xs text-faint">
            {selected.segments.length} clips · {Math.round(duration)} seconds
            {selected.meta?.city ? ` · ${selected.meta.city}` : ''}
          </p>
        </div>
      </header>

      {/* The player is unmounted while exporting, not merely paused. Four
          <video> elements hold four decoders, and the browser allows only so
          many at once - with them alive the exporter's own VideoDecoder never
          produced a frame and the job sat at 0% forever. Nothing to watch
          during an export anyway. */}
      {exporting ? (
        <div className="grid aspect-[2/1] w-full place-content-center rounded-xl border border-line bg-surface text-center text-muted">
          <p>Exporting…</p>
          <p className="mt-1 text-sm text-faint">Playback is paused meanwhile.</p>
        </div>
      ) : (
        <div className={playerView ? 'min-h-0 flex-1' : 'h-[72dvh]'}>
        <Player
          fit
          event={selected}
          cameras={cameras}
          layout={layout}
          main={main}
          onMain={setMain}
          overlay={opts}
          lang="en"
          onTime={onTime}
          onTelemetry={onTelemetry}
          seekTo={seekTo}
          playing={playing}
          rate={rate}
          onEnded={() => setPlaying(false)}
        />
        </div>
      )}

      {/* Transport and the cut */}
      <div className={'card px-4 py-3' + (playerView ? '' : ' mt-3')}>
        <div className="mb-3 flex items-center gap-3">
          <button className="btn shrink-0" onClick={() => setPlaying(!playing)}
                  aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? '❚❚' : '▶'}
          </button>
          <span className="num shrink-0 text-sm text-muted">
            {clock(time)} / {clock(duration)}
          </span>
          <span className="ml-auto flex items-center gap-2">
            <button className="chip" aria-pressed={playerView}
                    onClick={() => setView(!playerView)}>
              {playerView ? 'Exit player view' : 'Player view'}
            </button>
            <button className="chip" onClick={toggleFullscreen} title="Key F">
              Fullscreen (F)
            </button>
          </span>
        </div>

        <Timeline
          event={selected}
          duration={duration}
          time={time}
          inSec={inSec}
          outSec={outSec ?? duration}
          actions={actions}
          peaks={eventPeaks(selected)}
          disabled={exporting}
          onSeek={(t) => { setPlaying(false); setSeekTo(t); setTime(t) }}
          onIn={(t) => setInSec(Math.max(0, t))}
          onOut={(t) => setOutSec(Math.min(duration, t))}
          onWhole={() => { setInSec(0); setOutSec(null) }}
        />

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-1.5">
            <span className="eyebrow">Speed</span>
            {RATES.map((r) => (
              <button key={r} className="chip" aria-pressed={rate === r}
                      onClick={() => setRate(r)}>{r}×</button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="eyebrow">Cameras</span>
            {available.map((cam) => (
              <button key={cam} className="chip" aria-pressed={cameras.includes(cam)}
                      onClick={() => setCameras((c) =>
                        c.includes(cam) ? c.filter((x) => x !== cam) : [...c, cam])}>
                {CAMERA_LABEL[cam].en}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="eyebrow">Layout</span>
            <select className="chip !px-2" value={layout}
                    onChange={(e) => setLayout(e.target.value as LayoutName)}>
              {LAYOUTS.map((l) => <option key={l.id} value={l.id}>{l.da}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="eyebrow">Main view</span>
            <select className="chip !px-2" aria-label="Main camera"
                    value={available.includes(main) ? main : (available[0] ?? main)}
                    onChange={(e) => setMain(e.target.value as Camera)}>
              {available.map((c) => <option key={c} value={c}>{CAMERA_LABEL[c].en}</option>)}
            </select>
          </div>
        </div>

        {/* The export acts on the selection above it, so it lives in the same
            card rather than in a dialog that covers the picture. */}
        <div className={playerView ? 'hidden' : ''}>
        <ExportBar
          event={selected}
          cameras={cameras}
          layout={layout}
          main={main}
          overlay={opts}
          fromSec={inSec}
          toSec={outSec ?? duration}
          onBusy={(busy) => { if (busy) setPlaying(false); setExporting(busy) }}
        />
        </div>
      </div>

      {/* Readout and overlay switches */}
      <div className={'mt-3 grid gap-3 sm:grid-cols-2' + (playerView ? ' hidden' : '')}>
        <div className="card px-4 py-3">
          <h2 className="eyebrow">Telemetry</h2>
          {noTelemetry ? (
            <p className="mt-2 text-sm text-muted">
              This recording has no telemetry. The car writes speed, gear and GPS
              into the video from firmware 2025.44.25; older clips do not have it.
            </p>
          ) : telemetry ? (
            <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <p className="num text-3xl">
                {speedIn(unit, telemetry.speedMps)}
                <span className="ml-1 text-sm text-muted">{unit === 'kmh' ? 'km/h' : 'mph'}</span>
              </p>
              <p className="num text-sm text-muted">
                Gear {telemetry.gear === 'reverse' ? 'R'
                  : telemetry.gear === 'drive' ? 'D'
                  : telemetry.gear === 'park' ? 'P' : 'N'}
              </p>
              <p className="num text-sm text-muted">Steering {telemetry.steeringDeg.toFixed(0)}°</p>
              {telemetry.braking && <p className="text-sm text-warn">Braking</p>}
              {telemetry.blinkerLeft && <p className="text-sm text-warn">Left indicator</p>}
              {telemetry.blinkerRight && <p className="text-sm text-warn">Right indicator</p>}
              {telemetry.autopilot !== 'none' && (
                <p className="text-sm text-live">{apLabel(telemetry.autopilot)}</p>
              )}
              <p className="num w-full text-xs text-faint">
                {telemetry.lat.toFixed(5)}, {telemetry.lon.toFixed(5)}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-faint">
              No data at this moment; the car was probably standing still.
            </p>
          )}
        </div>

        <div className="card px-4 py-3">
          <h2 className="eyebrow">Show on the picture</h2>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {([
              ['speed', 'Speed'], ['gear', 'Gear'], ['clock', 'Date and time'],
              ['place', 'Place'], ['labels', 'Camera names'],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <input type="checkbox" checked={overlay[key]}
                       onChange={(e) => setOverlay({ ...overlay, [key]: e.target.checked })} />
                {label}
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            <span className="eyebrow">Unit</span>
            <button className="chip" aria-pressed={unit === 'kmh'}
                    onClick={() => setUnit('kmh')}>km/h</button>
            <button className="chip" aria-pressed={unit === 'mph'}
                    onClick={() => setUnit('mph')}>mph</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function titleOf(e: TeslaEvent): string {
  const when = e.startedAt.toLocaleString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })
  return when.charAt(0).toUpperCase() + when.slice(1)
}

function apLabel(state: string): string {
  return state === 'self_driving' ? 'FSD'
    : state === 'autosteer' ? 'Autosteer'
    : state === 'tacc' ? 'Cruise control' : ''
}
