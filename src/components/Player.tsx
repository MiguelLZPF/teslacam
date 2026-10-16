/**
 * Four cameras, one clock.
 *
 * A `<video>` per camera, all seeking together. The first camera present is the
 * timekeeper and the others are nudged back into line when they drift more than
 * a frame or two - browsers do not start several decoders in perfect lockstep,
 * and without correction the back camera ends up half a second ahead by the end
 * of a minute.
 *
 * Segments are separate files, so playing an event means swapping every `src`
 * at each boundary. The next segment is preloaded during the current one, or
 * the swap shows a black frame for as long as it takes to open a 40 MB file.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  drawLabelAt, drawOverlay,
  type LayoutName, type OverlayOptions,
} from '../lib/compose'
import {
  FALLBACK_ASPECT, MAX_MAIN_CROP, arrange, autoShare, pictureRect, shareFromPointer, stepShare,
  type FitMode,
} from '../lib/arrange'
import {
  CAMERA_LABEL, camerasIn, locate, segmentStart,
  type Camera, type TeslaEvent,
} from '../lib/library'
import { buildIndex, extractTelemetry, type Telemetry } from '../lib/sei'
import { IconGrip } from './icons'

const DRIFT_TOLERANCE = 0.08     // seconds before a camera is pulled back

export interface PlayerProps {
  event: TeslaEvent
  cameras: Camera[]
  layout: LayoutName
  /** The camera shown large. */
  main?: Camera
  /** A double-click on a tile asks for it to become the main view. */
  onMain?: (cam: Camera) => void
  /** A double-click on the main view toggles the player-only view. */
  onTogglePlayerView?: () => void
  /** Fit shows the whole frame; fill crops the edges so no bars are left. */
  fitMode: FitMode
  /** The main view's share of the width or height, or null for automatic. */
  share: number | null
  onShare: (share: number | null) => void
  overlay: OverlayOptions
  lang: 'da' | 'en'
  onTime: (t: number, total: number) => void
  onTelemetry: (t: Telemetry | null, noTelemetry: boolean) => void
  seekTo: number | null
  playing: boolean
  rate: number
  onEnded: () => void
}

export default function Player({
  event, cameras, layout, main, onMain, onTogglePlayerView, fitMode, share, onShare, overlay, lang,
  onTime, onTelemetry, seekTo, playing, rate, onEnded,
}: PlayerProps) {
  const present = useMemo(() => camerasIn(event).filter((c) => cameras.includes(c)), [event, cameras])

  // The container fills whatever the page gives it; the cameras tile all of it.
  const wrap = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  // The real shape of the footage, read from the timekeeper video once it loads.
  const [aspect, setAspect] = useState(FALLBACK_ASPECT)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setSize((o) => (Math.abs(o.w - r.width) < 0.5 && Math.abs(o.h - r.height) < 0.5
        ? o : { w: r.width, h: r.height }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const arrangement = useMemo(
    () => arrange(layout, present, main, size.w, size.h, share, aspect),
    [layout, present, main, size.w, size.h, share, aspect],
  )
  const boxes = arrangement.rects
  const split = arrangement.split
  // Latest values for the animation loop and the key handler.
  // In fit mode the main view covers its box when that crops little, so a small
  // shape mismatch leaves no bars beside it; manual shares keep the whole frame.
  const mainCover = fitMode === 'fill'
    || Boolean(split?.auto && (arrangement.mainCrop ?? 1) <= MAX_MAIN_CROP)
  const live = useRef({ arrangement, fitMode, aspect, size, share, mainCover })
  live.current = { arrangement, fitMode, aspect, size, share, mainCover }

  // [ and ] shrink and grow the main view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '[' && e.key !== ']') return
      const el = e.target as HTMLElement | null
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return
      const cur = live.current
      if (!cur.arrangement.split) return
      e.preventDefault()
      const now = cur.share ?? autoShare(present.length, cur.size.w, cur.size.h, cur.aspect)
      onShare(stepShare(now, e.key === ']' ? 1 : -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [present.length, onShare])

  // Dragging the divider: pointer capture keeps the drag alive outside it.
  const dragging = useRef(false)
  const onDividerMove = (e: React.PointerEvent) => {
    if (!dragging.current || !split || !wrap.current) return
    const r = wrap.current.getBoundingClientRect()
    onShare(shareFromPointer(split.placement, e.clientX - r.left, e.clientY - r.top, r.width, r.height))
  }
  const onDividerKey = (e: React.KeyboardEvent) => {
    if (!split) return
    const grow = split.placement === 'side' ? 'ArrowRight' : 'ArrowDown'
    const shrink = split.placement === 'side' ? 'ArrowLeft' : 'ArrowUp'
    if (e.key !== grow && e.key !== shrink) return
    e.preventDefault()
    onShare(stepShare(split.share, e.key === grow ? 1 : -1))
  }

  const refs = useRef(new Map<Camera, HTMLVideoElement>())
  const hud = useRef<HTMLCanvasElement>(null)
  const [index, setIndex] = useState(0)
  const [urls, setUrls] = useState<Map<Camera, string>>(new Map())
  // A seek that lands in a *different* segment can't be applied now: setIndex
  // swaps every src in a later effect and the videos reload to 0, so the offset
  // has to wait until the new segment's video is ready. Stashed here, applied in
  // onLoadedMetadata below.
  const pendingSeek = useRef<number | null>(null)
  const telemetry = useRef<{ at: ReturnType<typeof buildIndex>; empty: boolean }>({
    at: null, empty: true,
  })

  const segment = event.segments[index]

  // Read the current segment index inside the seek effect without making index a
  // dependency: setIndex would otherwise re-run the effect with the same seekTo
  // and clear pendingSeek before the new segment's video ever loads.
  const indexRef = useRef(index)
  indexRef.current = index

  // ---- object URLs for the current segment, revoked when it changes
  useEffect(() => {
    if (!segment) return
    const made = new Map<Camera, string>()
    for (const cam of present) {
      const file = segment.files[cam]
      if (file) made.set(cam, URL.createObjectURL(file))
    }
    setUrls(made)
    return () => { for (const u of made.values()) URL.revokeObjectURL(u) }
  }, [segment, present])

  // ---- telemetry for the current segment, read off the main thread
  useEffect(() => {
    if (!segment) return
    let cancelled = false
    telemetry.current = { at: null, empty: true }

    // Whichever camera carries the most samples: the back camera of a segment
    // can have fewer than the front, or none at all.
    const candidates = present.map((c) => segment.files[c]).filter(Boolean) as File[]
    if (!candidates.length) return

    ;(async () => {
      let best: Telemetry[] = []
      for (const file of candidates) {
        const { samples } = extractTelemetry(await file.arrayBuffer())
        if (samples.length > best.length) best = samples
        if (best.length) break        // the first camera with data is enough
      }
      if (cancelled) return
      telemetry.current = { at: buildIndex(best), empty: best.length === 0 }
    })()

    return () => { cancelled = true }
  }, [segment, present])

  // ---- the timekeeper drives everything else
  const lead = present[0]

  const syncOthers = useCallback((t: number) => {
    for (const cam of present) {
      if (cam === lead) continue
      const el = refs.current.get(cam)
      if (!el || el.readyState < 2) continue
      if (Math.abs(el.currentTime - t) > DRIFT_TOLERANCE) el.currentTime = t
    }
  }, [present, lead])

  useEffect(() => {
    for (const el of refs.current.values()) el.playbackRate = rate
  }, [rate, urls])

  useEffect(() => {
    for (const [cam, el] of refs.current) {
      if (!present.includes(cam)) continue
      if (playing) void el.play().catch(() => {})
      else el.pause()
    }
  }, [playing, urls, present])

  // ---- an outside seek, in whole-event seconds. Keyed on seekTo/event only:
  // see indexRef above for why index is deliberately not a dependency.
  useEffect(() => {
    if (seekTo === null) return
    const { index: i, offset } = locate(event, seekTo)
    if (i !== indexRef.current) {
      // Different segment: defer the offset until the new segment loads,
      // otherwise it lands on the old file and the new one starts at 0 - the
      // "jump to a point in another segment is unstable" bug.
      pendingSeek.current = offset
      setIndex(i)
    } else {
      pendingSeek.current = null
      for (const el of refs.current.values()) {
        if (el.readyState >= 1) el.currentTime = offset
      }
    }
  }, [seekTo, event])

  // ---- the HUD, drawn on a canvas over the videos
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const el = lead ? refs.current.get(lead) : null
      const canvas = hud.current
      if (!el || !canvas) return

      const t = el.currentTime
      syncOthers(t)

      const total = event.segments.reduce((n, s) => n + (s.durationSec ?? 60), 0)
      onTime(segmentStart(event, index) + t, total)

      const sample = telemetry.current.at ? telemetry.current.at(t) : null
      onTelemetry(sample, telemetry.current.empty)

      // Match the backing store to the displayed size, or the HUD is blurry on
      // a high-DPI screen and misplaced after a resize.
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = Math.round(rect.width * dpr)
      const h = Math.round(rect.height * dpr)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, w, h)

      // Positions come from the same arrangement the videos use, and from the
      // picture each video actually shows (whole frame, or the cropped box).
      const { arrangement: arr, fitMode: mode, aspect: asp, mainCover: cover } = live.current
      const pic = (cam: Camera) => {
        const r = arr.rects.get(cam)
        if (!r) return null
        const box = { w: r.w * w, h: r.h * h }
        const p = pictureRect(box, asp, cam === arr.main && cover ? 'fill' : mode)
        return { x: r.x * w + p.x, y: r.y * h + p.y, w: p.w, h: p.h }
      }
      if (overlay.labels) {
        for (const cam of arr.rects.keys()) {
          const p = pic(cam)
          if (!p) continue
          const font = Math.max(10 * dpr, Math.min(28 * dpr, p.h * 0.045))
          // The main picture carries the clock at its top left, so its camera
          // name sits at the bottom left instead of underneath it.
          const onMain = cam === arr.main && (layout === 'tesla' || layout === 'single')
          const y = onMain ? p.y + p.h - font * 1.6 - font * 0.4 : p.y + font * 0.4
          drawLabelAt(ctx, cam, p.x + font * 0.4, y, font, lang)
        }
      }
      // The clock, place and speed go on the main picture; with several equal
      // cameras (grid, wide) they go on the whole area as before.
      const region = (layout === 'tesla' || layout === 'single') && arr.main
        ? pic(arr.main) : { x: 0, y: 0, w, h }
      if (region) {
        ctx.save()
        ctx.translate(region.x, region.y)
        drawOverlay(ctx, { w: region.w, h: region.h }, {
          telemetry: sample,
          at: new Date(segment ? segment.startedAt.getTime() + t * 1000 : Date.now()),
          place: event.meta?.city,
          noTelemetry: telemetry.current.empty,
        }, overlay, lang, 0.6 * dpr)
        ctx.restore()
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [lead, layout, overlay, lang, event, index, segment, onTime, onTelemetry, syncOthers])

  const advance = () => {
    if (index + 1 < event.segments.length) {
      setIndex(index + 1)
      // The new sources autoplay below; without this the player stops between
      // every minute of a ten-minute event.
    } else {
      onEnded()
    }
  }

  const divider = split && size.w > 0 ? (() => {
    const mainRect = boxes.get(arrangement.main!)!
    return split.placement === 'side'
      ? { left: `calc(${mainRect.w * 100}% - 4px)`, top: 0, width: 8, height: '100%', cursor: 'col-resize' }
      : { left: 0, top: `calc(${mainRect.h * 100}% - 4px)`, width: '100%', height: 8, cursor: 'row-resize' }
  })() : null

  return (
    <div ref={wrap} className="relative h-full w-full overflow-hidden rounded-xl bg-black">
      {present.map((cam) => {
        const box = boxes.get(cam)
        if (!box) return null
        const isMain = cam === arrangement.main
        return (
          <video
            key={cam}
            ref={(el) => { if (el) refs.current.set(cam, el); else refs.current.delete(cam) }}
            src={urls.get(cam)}
            muted
            playsInline
            preload="auto"
            // The timekeeper reports the end of a segment; the others just
            // follow, so only one advance fires.
            onEnded={cam === lead ? advance : undefined}
            onLoadedMetadata={(e) => {
              if (cam !== lead) return
              const vw = e.currentTarget.videoWidth
              const vh = e.currentTarget.videoHeight
              if (vw > 0 && vh > 0) setAspect(vw / vh)
              const d = e.currentTarget.duration
              if (Number.isFinite(d)) segment && (segment.durationSec = d)
              // Apply a seek that was waiting for this segment to load. Set the
              // lead here and every camera that's ready; the rest are pulled
              // into line by syncOthers on the next frame.
              if (pendingSeek.current !== null) {
                const off = pendingSeek.current
                pendingSeek.current = null
                e.currentTarget.currentTime = off
                for (const el of refs.current.values()) {
                  if (el.readyState >= 1) el.currentTime = off
                }
              }
              if (playing) void e.currentTarget.play().catch(() => {})
            }}
            onDoubleClick={() => (isMain ? onTogglePlayerView?.() : onMain?.(cam))}
            className={'absolute bg-black ' + (fitMode === 'fill' || (isMain && mainCover) ? 'object-cover' : 'object-contain')}
            title={isMain ? 'Double-click: player view' : 'Double-click: make this the main view'}
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.w * 100}%`,
              height: `${box.h * 100}%`,
            }}
          />
        )
      })}
      <canvas ref={hud} className="pointer-events-none absolute inset-0 h-full w-full" />

      {divider && split && (
        <div
          role="separator"
          aria-orientation={split.placement === 'side' ? 'vertical' : 'horizontal'}
          aria-label="Resize the main view"
          aria-valuemin={50}
          aria-valuemax={90}
          aria-valuenow={Math.round(split.share * 100)}
          tabIndex={0}
          title="Drag to resize. Double-click to reset. Keys [ and ] also resize."
          className="group absolute z-10 flex items-center justify-center touch-none"
          style={divider}
          onPointerDown={(e) => {
            e.preventDefault()
            dragging.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
            onDividerMove(e)
          }}
          onPointerMove={onDividerMove}
          onPointerUp={(e) => { dragging.current = false; e.currentTarget.releasePointerCapture(e.pointerId) }}
          onPointerCancel={() => { dragging.current = false }}
          onDoubleClick={() => onShare(null)}
          onKeyDown={onDividerKey}
        >
          <span className="rounded-full bg-live/0 p-0.5 text-live opacity-0 transition-opacity group-hover:bg-black/70 group-hover:opacity-100 group-focus-visible:opacity-100">
            <IconGrip />
          </span>
          <span
            className={'pointer-events-none absolute bg-live/40 group-hover:bg-live ' + (split.placement === 'side' ? 'inset-y-0 left-1/2 w-px' : 'inset-x-0 top-1/2 h-px')}
          />
        </div>
      )}

      {!present.length && (
        <p className="absolute inset-0 grid place-content-center text-faint">
          Choose at least one camera
        </p>
      )}
    </div>
  )
}

export { CAMERA_LABEL }
